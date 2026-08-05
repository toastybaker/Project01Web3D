import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Client, type Room } from 'colyseus.js'
import type { MerchantCycle, MerchantItemId } from '../src/game/merchant'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function message<T>(room: Room, type: string, predicate: (payload: T) => boolean = () => true, timeoutMs = 3_000): Promise<T> {
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

type Purchase = { requestId: string; ok: boolean; reason?: string; itemId?: MerchantItemId; price?: number; cycle?: MerchantCycle }

const port = 26_573
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ['pipe', 'pipe', 'pipe'],
})
const rooms: Room[] = []

try {
  await waitForServer(server)
  const client = new Client(`ws://127.0.0.1:${port}`)
  const buyerA = await client.joinOrCreate('woodland', { bypassLobby: true })
  const buyerB = await client.joinOrCreate('woodland', { bypassLobby: true })
  rooms.push(buyerA, buyerB)

  const snapshotA = message<MerchantCycle>(buyerA, 'merchant:snapshot')
  const snapshotB = message<MerchantCycle>(buyerB, 'merchant:snapshot')
  buyerA.send('lobby:ready', {})
  buyerB.send('lobby:ready', {})
  const [cycleA, cycleB] = await Promise.all([snapshotA, snapshotB])
  assert(cycleA.id === cycleB.id, 'Players received different merchant cycles')
  assert(JSON.stringify(cycleA.inventory) === JSON.stringify(cycleB.inventory), 'Players received different merchant stock')
  assert(cycleA.inventory.length >= 1 && cycleA.inventory.length <= 4, 'Merchant slot count is invalid')

  const richPresence = { zone: 'hub', position: [0, .86, 14], nickname: 'Buyer', cash: 1_000_000_000, progressValue: 1_000_000_000, stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: false }
  buyerA.send('move', richPresence)
  buyerB.send('move', richPresence)
  await new Promise((resolve) => setTimeout(resolve, 150))

  const target = cycleA.inventory[0]
  let latestCycle = cycleA
  for (let index = 0; index < target.stock; index += 1) {
    const buyer = index % 2 ? buyerB : buyerA
    const requestId = `buy-${index}`
    const resultPromise = message<Purchase>(buyer, 'merchant:result', (result) => result.requestId === requestId)
    const sharedPromise = message<MerchantCycle>(index % 2 ? buyerA : buyerB, 'merchant:snapshot', (cycle) => cycle.id === cycleA.id && (cycle.inventory.find((entry) => entry.id === target.id)?.stock ?? -1) === target.stock - index - 1)
    buyer.send('merchant:buy', { requestId, cycleId: cycleA.id, itemId: target.id })
    const [result, shared] = await Promise.all([resultPromise, sharedPromise])
    assert(result.ok && result.itemId === target.id && result.price === target.price, 'Valid merchant purchase failed')
    latestCycle = shared
  }

  assert(latestCycle.inventory.find((entry) => entry.id === target.id)?.stock === 0, 'Shared stock did not reach zero')
  const soldOutPromise = message<Purchase>(buyerB, 'merchant:result', (result) => result.requestId === 'sold-out')
  buyerB.send('merchant:buy', { requestId: 'sold-out', cycleId: cycleA.id, itemId: target.id })
  const soldOut = await soldOutPromise
  assert(!soldOut.ok && soldOut.reason === 'Sold out', 'Merchant sold beyond global stock')

  const retryPromise = message<Purchase>(buyerA, 'merchant:result', (result) => result.requestId === 'buy-0')
  buyerA.send('merchant:buy', { requestId: 'buy-0', cycleId: cycleA.id, itemId: target.id })
  const retry = await retryPromise
  assert(retry.ok && retry.itemId === target.id, 'Idempotent purchase retry changed result')
  assert(retry.cycle?.inventory.find((entry) => entry.id === target.id)?.stock === target.stock - 1, 'Retry did not return its original purchase snapshot')

  console.log(JSON.stringify({ status: 'pass', cycle: cycleA.index, slots: cycleA.inventory.length, item: target.id, initialStock: target.stock, soldOut: true, shared: true, retryIdempotent: true }, null, 2))
} finally {
  await Promise.allSettled(rooms.map((room) => room.leave()))
  server.kill()
}
