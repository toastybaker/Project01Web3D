import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Client, type Room } from 'colyseus.js'

const originalWarn = console.warn
console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes('onMessage() not registered')) return
  originalWarn(...args)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function message<T>(room: Room, type: string, predicate: (payload: T) => boolean = () => true, timeoutMs = 4_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs)
    room.onMessage(type, (payload: T) => {
      if (!predicate(payload)) return
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

async function waitForServer(process: ChildProcessWithoutNullStreams) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Multiplayer server did not start')), 10_000)
    const onData = (chunk: Buffer) => {
      if (!chunk.toString().includes('Woodland multiplayer listening')) return
      clearTimeout(timer)
      process.stdout.off('data', onData)
      resolve()
    }
    process.stdout.on('data', onData)
    process.once('exit', (code) => reject(new Error(`Multiplayer server exited early (${code})`)))
  })
}

type Account = {
  inventory: Record<string, number>
  cookQueue: Array<{ id: string; recipe: string; quantity: number; furnaceIndex: number; readyAt: number }>
  ownedFarms: number[]
}

type CookResult = {
  requestId: string
  ok: boolean
  op: 'queue' | 'collect'
  reason?: string
  quantity: number
  itemId?: string
  account: Account
}

const port = 26_579
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), TEST_STARTING_CASH: '30000000', TEST_COOK_FIXTURES: '1', TEST_COOK_DURATION_MS: '140', TEST_START_CLEAR_WEATHER: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let serverErrors = ''
server.stderr.on('data', (chunk: Buffer) => { serverErrors += chunk.toString() })
const rooms: Room[] = []

try {
  await waitForServer(server)
  const client = new Client(`ws://127.0.0.1:${port}`)
  const profileId = 'cooking-validator-profile-01'
  const cook = await client.joinOrCreate('woodland', { profileId })
  rooms.push(cook)

  const readyState = message<{ allReady: boolean }>(cook, 'lobby:state', (state) => state.allReady)
  cook.send('lobby:onboarding-ready', { ready: true })
  await readyState
  const match = message(cook, 'match:sync')
  cook.send('lobby:start', {})
  await match

  cook.send('move', { zone: 'farm', position: [-48.15, 0.86, -9.75], nickname: 'Cook', stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: false })
  await new Promise((resolve) => setTimeout(resolve, 120))
  const deed = message<{ requestId: string; ok: boolean }>(cook, 'deed:result', (result) => result.requestId === 'cook-deed')
  cook.send('deed:purchase', { requestId: 'cook-deed', kind: 'personal', quantity: 1 })
  assert((await deed).ok, 'Cooking validator could not buy its personal farm deed')
  const claim = message<{ requestId: string; ok: boolean; account: Account }>(cook, 'farm:result', (result) => result.requestId === 'cook-farm')
  cook.send('farm:action', { requestId: 'cook-farm', op: 'claim', farmId: 0 })
  const claimed = await claim
  assert(claimed.ok && claimed.account.ownedFarms.includes(0), 'Cooking validator could not claim a furnace farm')

  const queuedMessage = message<CookResult>(cook, 'cook:result', (result) => result.requestId === 'cook-queue-1')
  cook.send('cook:queue', { requestId: 'cook-queue-1', recipeId: 'apple-bread', quantity: 2, furnaceIndex: 0 })
  const queued = await queuedMessage
  assert(queued.ok && queued.quantity === 2 && queued.account.cookQueue.length === 1, 'Server did not create the requested cooking batch')
  assert(queued.account.inventory.apple === 16 && queued.account.inventory.wheat === 16, 'Server did not consume exact recipe ingredients')

  const duplicateQueueMessage = message<CookResult>(cook, 'cook:result', (result) => result.requestId === 'cook-queue-1')
  cook.send('cook:queue', { requestId: 'cook-queue-1', recipeId: 'apple-bread', quantity: 2, furnaceIndex: 0 })
  const duplicateQueue = await duplicateQueueMessage
  assert(duplicateQueue.account.cookQueue.length === 1 && duplicateQueue.account.inventory.apple === 16, 'Retry duplicated a cooking batch or ingredient charge')

  const earlyCollectMessage = message<CookResult>(cook, 'cook:result', (result) => result.requestId === 'cook-collect-early')
  cook.send('cook:collect', { requestId: 'cook-collect-early', recipeId: 'apple-bread', furnaceIndex: 0 })
  const earlyCollect = await earlyCollectMessage
  assert(!earlyCollect.ok && earlyCollect.reason === 'Nothing ready', 'Cooking batch was collectible before its timer finished')

  await new Promise((resolve) => setTimeout(resolve, 180))
  const collectedMessage = message<CookResult>(cook, 'cook:result', (result) => result.requestId === 'cook-collect-1')
  cook.send('cook:collect', { requestId: 'cook-collect-1', recipeId: 'apple-bread', furnaceIndex: 0 })
  const collected = await collectedMessage
  assert(collected.ok && collected.quantity === 2 && collected.itemId === 'food-apple-bread', 'Finished food did not collect as the prepared dish')
  assert(collected.account.inventory['food-apple-bread'] === 2 && collected.account.cookQueue.length === 0, 'Collection did not atomically transfer and clear the batch')

  const duplicateCollectMessage = message<CookResult>(cook, 'cook:result', (result) => result.requestId === 'cook-collect-1')
  cook.send('cook:collect', { requestId: 'cook-collect-1', recipeId: 'apple-bread', furnaceIndex: 0 })
  const duplicateCollect = await duplicateCollectMessage
  assert(duplicateCollect.account.inventory['food-apple-bread'] === 2, 'Retry duplicated a finished dish')

  const soldMessage = message<{ requestId: string; ok: boolean; quantity: number; account: Account }>(cook, 'market:result', (result) => result.requestId === 'cook-sell-1')
  cook.send('market:food-sell', { requestId: 'cook-sell-1', recipeId: 'apple-bread', quantity: 2 })
  const sold = await soldMessage
  assert(sold.ok && sold.quantity === 2 && !sold.account.inventory['food-apple-bread'], 'Server-owned cooked food could not be sold')

  console.log(JSON.stringify({
    status: 'pass',
    queued: queued.quantity,
    ingredientChargeExactlyOnce: true,
    earlyCollectionBlocked: true,
    collected: collected.quantity,
    collectionExactlyOnce: true,
    sold: sold.quantity,
  }, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  if (serverErrors.trim()) console.error(serverErrors.trim())
  process.exitCode = 1
} finally {
  await Promise.allSettled(rooms.map((room) => room.leave()))
  server.kill()
  console.warn = originalWarn
}
