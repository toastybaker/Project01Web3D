import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Client, type Room } from 'colyseus.js'
import type { SharedMarketSnapshot } from '../src/game/market'

type Result = {
  requestId: string
  ok: boolean
  kind: 'commodity' | 'food' | 'stock'
  reason?: string
  itemId?: string
  recipeId?: string
  stockId?: string
  direction?: 'buy' | 'sell'
  quantity: number
  total: number
  revision: number
}

function once<T>(room: Room, type: string, timeoutMs = 4_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs)
    room.onMessage(type, (payload: T) => { clearTimeout(timer); resolve(payload) })
  })
}

function where<T>(room: Room, type: string, predicate: (payload: T) => boolean, timeoutMs = 4_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for matching ${type}`)), timeoutMs)
    room.onMessage(type, (payload: T) => {
      if (!predicate(payload)) return
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

async function waitForServer(process: ChildProcessWithoutNullStreams) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Market server did not start')), 10_000)
    const onData = (chunk: Buffer) => {
      if (!chunk.toString().includes('Woodland multiplayer listening')) return
      clearTimeout(timer)
      process.stdout.off('data', onData)
      resolve()
    }
    process.stdout.on('data', onData)
    process.once('exit', (code) => reject(new Error(`Market server exited early (${code})`)))
  })
}

const port = 26_583
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), TEST_STARTING_CASH: '100000000', TEST_MARKET_FIXTURES: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
})
const rooms: Room[] = []

try {
  await waitForServer(server)
  const client = new Client(`ws://127.0.0.1:${port}`)
  const profileA = 'market-profile-a-0000000001'
  const profileB = 'market-profile-b-0000000002'
  let playerA = await client.joinOrCreate('woodland', { profileId: profileA })
  const playerB = await client.joinById(playerA.roomId, { profileId: profileB })
  rooms.push(playerA, playerB)

  playerA.send('lobby:onboarding-ready', { ready: true })
  playerB.send('lobby:onboarding-ready', { ready: true })
  await new Promise((resolve) => setTimeout(resolve, 120))
  const startedA = once(playerA, 'match:sync')
  const startedB = once(playerB, 'match:sync')
  playerA.send('lobby:start', {})
  await Promise.all([startedA, startedB])

  const movement = { zone: 'hub', position: [0, .86, 14], cash: 100_000_000, progressValue: 100_000_000, stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: false }
  playerA.send('move', { ...movement, nickname: 'Market A' })
  playerB.send('move', { ...movement, nickname: 'Market B' })
  await new Promise((resolve) => setTimeout(resolve, 100))

  const initialAWait = once<SharedMarketSnapshot>(playerA, 'market:snapshot')
  const initialBWait = once<SharedMarketSnapshot>(playerB, 'market:snapshot')
  playerA.send('lobby:ready', {})
  playerB.send('lobby:ready', {})
  const [initialA, initialB] = await Promise.all([initialAWait, initialBWait])
  assert.deepEqual(initialA.stockPrices, initialB.stockPrices, 'Players received different stock prices')
  assert.deepEqual(initialA.stockSupply, initialB.stockSupply, 'Players received different stock supply')
  assert.deepEqual(initialA.commodityMarket, initialB.commodityMarket, 'Players received different commodity markets')
  assert(Object.values(initialA.stockHistory).every((history) => history.length === 1), 'A fresh match fabricated stock-price history')
  assert(Object.values(initialA.commodityPriceHistory).every((history) => history?.length === 1), 'A fresh match fabricated commodity-price history')
  assert(Object.values(initialA.foodPriceHistory).every((history) => history?.length === 1), 'A fresh match fabricated food-price history')

  const commodityRequestId = 'market-commodity-request-001'
  const commodityResultWait = where<Result>(playerA, 'market:result', (result) => result.requestId === commodityRequestId)
  const commodityAWait = where<SharedMarketSnapshot>(playerA, 'market:snapshot', (snapshot) => snapshot.revision > initialA.revision)
  const commodityBWait = where<SharedMarketSnapshot>(playerB, 'market:snapshot', (snapshot) => snapshot.revision > initialB.revision)
  playerA.send('market:commodity-sell', { requestId: commodityRequestId, itemId: 'apple', quantity: 12 })
  const [commodityResult, commodityA, commodityB] = await Promise.all([commodityResultWait, commodityAWait, commodityBWait])
  assert.equal(commodityResult.ok, true)
  assert.equal(commodityResult.quantity, 12)
  assert(commodityResult.total > 0, 'Commodity sale paid nothing')
  assert.deepEqual(commodityA.commodityPending, commodityB.commodityPending, 'Commodity supply diverged between clients')
  assert.equal(commodityA.revision, commodityB.revision)

  const duplicateResultWait = where<Result>(playerA, 'market:result', (result) => result.requestId === commodityRequestId)
  playerA.send('market:commodity-sell', { requestId: commodityRequestId, itemId: 'apple', quantity: 12 })
  const duplicateResult = await duplicateResultWait
  assert.deepEqual(duplicateResult, commodityResult, 'Duplicate commodity request returned a different settlement')
  const unchangedWait = once<SharedMarketSnapshot>(playerB, 'market:snapshot')
  playerB.send('lobby:ready', {})
  const unchanged = await unchangedWait
  assert.equal(unchanged.revision, commodityB.revision, 'Duplicate request changed market revision')

  const stockInitial = unchanged.stockSupply.apple
  const stockAResultWait = where<Result>(playerA, 'market:result', (result) => result.requestId === 'market-stock-a-001')
  const stockAViewWait = where<SharedMarketSnapshot>(playerB, 'market:snapshot', (snapshot) => snapshot.revision > unchanged.revision)
  playerA.send('market:stock-trade', { requestId: 'market-stock-a-001', stockId: 'apple', direction: 'buy', quantity: 3 })
  const [stockAResult, stockAView] = await Promise.all([stockAResultWait, stockAViewWait])
  assert.equal(stockAResult.quantity, Math.min(3, stockInitial))
  assert.equal(stockAView.stockSupply.apple, stockInitial - stockAResult.quantity, 'First stock purchase did not reduce shared supply')

  const stockBResultWait = where<Result>(playerB, 'market:result', (result) => result.requestId === 'market-stock-b-001')
  const stockBViewWait = where<SharedMarketSnapshot>(playerA, 'market:snapshot', (snapshot) => snapshot.revision > stockAView.revision)
  playerB.send('market:stock-trade', { requestId: 'market-stock-b-001', stockId: 'apple', direction: 'buy', quantity: 99 })
  const [stockBResult, stockBView] = await Promise.all([stockBResultWait, stockBViewWait])
  assert.equal(stockBResult.quantity, stockAView.stockSupply.apple, 'Second stock purchase did not receive exactly the remaining global supply')
  assert.equal(stockBView.stockSupply.apple, 0, 'Global stock did not sell out for everyone')

  const foodResultWait = where<Result>(playerA, 'market:result', (result) => result.requestId === 'market-food-001')
  const foodViewWait = where<SharedMarketSnapshot>(playerB, 'market:snapshot', (snapshot) => snapshot.revision > stockBView.revision)
  playerA.send('market:food-sell', { requestId: 'market-food-001', recipeId: 'apple-bread', quantity: 2 })
  const [foodResult, foodView] = await Promise.all([foodResultWait, foodViewWait])
  assert.equal(foodResult.ok, true)
  assert.equal(foodView.foodMarket['apple-bread'], stockBView.foodMarket['apple-bread'] + 2, 'Prepared-food supply was not shared')

  const roomId = playerA.roomId
  await playerA.leave()
  rooms.splice(rooms.indexOf(playerA), 1)
  playerA = await client.joinById(roomId, { profileId: profileA })
  rooms.push(playerA)
  const reconnectSnapshotWait = once<SharedMarketSnapshot>(playerA, 'market:snapshot')
  playerA.send('lobby:ready', {})
  const reconnectSnapshot = await reconnectSnapshotWait
  assert.deepEqual(reconnectSnapshot.stockSupply, foodView.stockSupply, 'Reconnect missed current global stock supply')
  assert.deepEqual(reconnectSnapshot.foodMarket, foodView.foodMarket, 'Reconnect missed current food market')

  const replayAfterReconnectWait = where<Result>(playerA, 'market:result', (result) => result.requestId === commodityRequestId)
  playerA.send('market:commodity-sell', { requestId: commodityRequestId, itemId: 'apple', quantity: 12 })
  const replayAfterReconnect = await replayAfterReconnectWait
  const { account: replayAccount, ...replayTransaction } = replayAfterReconnect as Result & { account?: { revision: number; cash: number } }
  const { account: _originalAccount, ...originalTransaction } = commodityResult as Result & { account?: { revision: number; cash: number } }
  assert.deepEqual(replayTransaction, originalTransaction, 'Profile reconnect did not replay the original idempotent transaction')
  assert.equal(replayAccount?.revision, reconnectSnapshot.account?.revision, 'Idempotent replay returned stale account state')
  assert.equal(replayAccount?.cash, reconnectSnapshot.account?.cash, 'Idempotent replay changed current cash')
  const finalSnapshotWait = once<SharedMarketSnapshot>(playerB, 'market:snapshot')
  playerB.send('lobby:ready', {})
  const finalSnapshot = await finalSnapshotWait
  assert.equal(finalSnapshot.revision, reconnectSnapshot.revision, 'Replayed reconnect request mutated shared market state')

  console.log(JSON.stringify({
    status: 'pass',
    sharedCommodityRevision: commodityB.revision,
    commoditySale: { quantity: commodityResult.quantity, total: commodityResult.total },
    stockSupply: { initial: stockInitial, afterA: stockAView.stockSupply.apple, afterB: stockBView.stockSupply.apple },
    foodStock: foodView.foodMarket['apple-bread'],
    duplicateExactlyOnce: true,
    reconnectSnapshot: true,
    reconnectReplayExactlyOnce: true,
  }, null, 2))
} finally {
  await Promise.allSettled(rooms.map((room) => room.leave()))
  server.kill('SIGTERM')
}
