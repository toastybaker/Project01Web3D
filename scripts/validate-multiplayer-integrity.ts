import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Client, type Room } from 'colyseus.js'
import { fruitTreeCapacity, MATCH_CONFIG } from '../src/game/config'
import { minigameMilestones, scheduledMinigame } from '../src/game/minigame'
import { MINE_NODE_SITES } from '../shared/mine-nodes.js'

const originalWarn = console.warn
console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes('onMessage() not registered')) return
  originalWarn(...args)
}

type Account = {
  cash: number
  inventory: Record<string, number>
  portfolio: Record<string, number>
  personalDeedOwned: boolean
  deedEntitlement: number
  ownedFarms: number[]
  stats: { foraged: number; mined: number; harvested: number; sold: number }
}

type AccountMessage = { account?: Account & { revision: number; roomKey: number; action?: { type?: string; ok?: boolean; key?: string; requestId?: string } } }

function waitFor<T>(room: Room, type: string, predicate: (payload: T) => boolean = () => true, timeoutMs = 5_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs)
    room.onMessage(type, (payload: T) => {
      if (!predicate(payload)) return
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitForServer(process: ChildProcessWithoutNullStreams) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Integrity server did not start')), 10_000)
    const onData = (chunk: Buffer) => {
      if (!chunk.toString().includes('Woodland multiplayer listening')) return
      clearTimeout(timer)
      process.stdout.off('data', onData)
      resolve()
    }
    process.stdout.on('data', onData)
    process.once('exit', (code) => reject(new Error(`Integrity server exited early (${code})`)))
  })
}

function accountOf(payload: AccountMessage) {
  assert(payload?.account, 'Authoritative account snapshot missing')
  return payload.account
}

async function walk(room: Room, from: [number, number], to: [number, number]) {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1])
  const steps = Math.max(1, Math.ceil(distance / 2.7))
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps
    room.send('move', { zone: 'farm', position: [from[0] + (to[0] - from[0]) * t, 0.86, from[1] + (to[1] - from[1]) * t], minigameOpen: false })
    await pause(180)
  }
}

const port = 26_593
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    TEST_STARTING_CASH: '10000000',
    TEST_ALLOW_EARLY_MINIGAME: '1',
    TEST_FORAGE_REGROW_MS: '100',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})
const rooms: Room[] = []

try {
  await waitForServer(server)
  const client = new Client(`ws://127.0.0.1:${port}`)
  const profileA = 'integrity-player-a-2026'
  const profileB = 'integrity-player-b-2026'
  const playerA = await client.joinOrCreate('woodland', { profileId: profileA })
  const playerB = await client.joinById(playerA.roomId, { profileId: profileB })
  rooms.push(playerA, playerB)

  const allReady = waitFor<{ allReady?: boolean }>(playerA, 'lobby:state', (payload) => payload.allReady === true)
  playerA.send('lobby:onboarding-ready', { ready: true })
  playerB.send('lobby:onboarding-ready', { ready: true })
  await allReady
  const matchA = waitFor<{ seed: number }>(playerA, 'match:sync')
  const matchB = waitFor<{ seed: number }>(playerB, 'match:sync')
  playerA.send('lobby:start', {})
  const [match, matchForB] = await Promise.all([matchA, matchB])
  assert.equal(match.seed, matchForB.seed, 'Match seed differed between players')

  const hostileMine = await client.joinById(playerA.roomId, { profileId: 'integrity-hostile-mine-2026', bypassLobby: true })
  rooms.push(hostileMine)
  const mineSite = MINE_NODE_SITES[0]
  hostileMine.send('move', { zone: 'mine', position: [mineSite.x, 0.86, mineSite.z], minigameOpen: false })
  const mineDenied = waitFor<AccountMessage & { reason?: string }>(hostileMine, 'mine:denied', (payload) => payload.reason === 'not-owned')
  hostileMine.send('mine:request', { id: mineSite.id, tool: 'crystal-pickaxe', enhancement: 999 })
  const deniedMine = await mineDenied
  assert.equal(deniedMine.reason, 'not-owned', 'A client-supplied top pickaxe was accepted')
  assert.equal(accountOf(deniedMine).inventory['crystal-ore'] ?? 0, 0, 'Denied mine changed inventory')
  await hostileMine.leave()
  rooms.splice(rooms.indexOf(hostileMine), 1)

  const hostileForage = await client.joinById(playerA.roomId, { profileId: 'integrity-hostile-forage-2026', bypassLobby: true })
  rooms.push(hostileForage)
  const forageId = 'ForageApple000'
  const forageCapacity = fruitTreeCapacity(forageId)
  hostileForage.send('move', { zone: 'forage', position: [-10, 0.86, -96], minigameOpen: false })
  const forageAward = waitFor<AccountMessage & { id?: string; quantity?: number }>(hostileForage, 'forage:award', (payload) => payload.id === forageId)
  hostileForage.send('forage:request', { id: forageId, item: 'apple', remainingCapacity: 999_999 })
  const acceptedForage = await forageAward
  assert((acceptedForage.quantity ?? 0) <= forageCapacity, 'Forged forage capacity increased the award')
  assert((accountOf(acceptedForage).inventory.apple ?? 0) <= 24, 'Forged forage capacity bypassed hand storage')
  await hostileForage.leave()
  rooms.splice(rooms.indexOf(hostileForage), 1)

  const shopRequest = 'shop-integrity-a-01'
  const shopSnapshot = waitFor<AccountMessage>(playerA, 'market:snapshot', (payload) => payload.account?.action?.requestId === shopRequest)
  playerA.send('shop:buy', { requestId: shopRequest, itemId: 'lottery-ticket', quantity: 76, shopKind: 'common' })
  const afterSpend = accountOf(await shopSnapshot)
  assert(afterSpend.cash < 2_500_000, 'Spend-down setup did not leave an unpaid deed')
  const unpaidDeed = waitFor<AccountMessage & { ok?: boolean; reason?: string }>(playerA, 'deed:result', (payload) => payload.account?.action?.requestId === 'deed-integrity-unpaid')
  playerA.send('deed:purchase', { requestId: 'deed-integrity-unpaid', kind: 'personal', quantity: 1 })
  const deedDenied = await unpaidDeed
  assert.equal(deedDenied.ok, false, 'Unpaid deed purchase was accepted')
  assert.equal(accountOf(deedDenied).personalDeedOwned, false, 'Unpaid deed changed entitlement')

  const invalidCommodity = waitFor<AccountMessage & { ok?: boolean }>(playerA, 'market:result', (payload) => payload.account?.action?.requestId === 'market-integrity-commodity')
  playerA.send('market:commodity-sell', { requestId: 'market-integrity-commodity', itemId: 'not-a-commodity', quantity: 99 })
  assert.equal((await invalidCommodity).ok, false, 'Nonexistent commodity sale was accepted')
  const invalidFood = waitFor<AccountMessage & { ok?: boolean }>(playerA, 'market:result', (payload) => payload.account?.action?.requestId === 'market-integrity-food')
  playerA.send('market:food-sell', { requestId: 'market-integrity-food', recipeId: 'not-a-food', quantity: 99 })
  assert.equal((await invalidFood).ok, false, 'Nonexistent food sale was accepted')
  const invalidStock = waitFor<AccountMessage & { ok?: boolean }>(playerA, 'market:result', (payload) => payload.account?.action?.requestId === 'market-integrity-stock')
  playerA.send('market:stock-trade', { requestId: 'market-integrity-stock', stockId: 'not-a-stock', direction: 'sell', quantity: 99 })
  assert.equal((await invalidStock).ok, false, 'Nonexistent stock sale was accepted')

  const incomingTrade = waitFor<{ fromId?: string }>(playerB, 'trade:request', (payload) => payload.fromId === playerA.sessionId)
  playerA.send('trade:request', { targetId: playerB.sessionId })
  await incomingTrade
  const openedA = waitFor<{ tradeId: string }>(playerA, 'trade:opened')
  const openedB = waitFor<{ tradeId: string }>(playerB, 'trade:opened')
  playerB.send('trade:accept', { fromId: playerA.sessionId })
  const [tradeA, tradeB] = await Promise.all([openedA, openedB])
  assert.equal(tradeA.tradeId, tradeB.tradeId, 'Trade sessions diverged')
  const unknownOffer = waitFor<{ error?: string }>(playerA, 'trade:update', (payload) => payload.error === 'invalid-offer')
  playerA.send('trade:update', { tradeId: tradeA.tradeId, offer: { cash: 0, items: { 'unknown-permanent-item': 1 } }, ready: true })
  assert.equal((await unknownOffer).error, 'invalid-offer', 'Unknown trade item was silently normalized')
  const billionOffer = waitFor<{ error?: string }>(playerA, 'trade:update', (payload) => payload.error === 'invalid-offer')
  playerA.send('trade:update', { tradeId: tradeA.tradeId, offer: { cash: 1_000_000_000, items: {} }, ready: true })
  assert.equal((await billionOffer).error, 'invalid-offer', 'Billion-cash trade offer was accepted')
  playerA.send('trade:cancel', { tradeId: tradeA.tradeId })

  const milestone = minigameMilestones(MATCH_CONFIG.defaultDurationSeconds)[0]
  const kind = scheduledMinigame(milestone, match.seed, MATCH_CONFIG.defaultDurationSeconds)
  playerA.send('move', { zone: 'hub', position: [0, 0.86, 14], minigameOpen: true, minigameKind: kind, minigameMilestone: milestone })
  playerB.send('move', { zone: 'hub', position: [0, 0.86, 14], minigameOpen: true, minigameKind: kind, minigameMilestone: milestone })
  const startA = waitFor<{ milestone: number; kind: string }>(playerA, 'minigame:start', (payload) => payload.milestone === milestone && payload.kind === kind)
  const startB = waitFor<{ milestone: number; kind: string }>(playerB, 'minigame:start', (payload) => payload.milestone === milestone && payload.kind === kind)
  playerA.send('minigame:ready', { milestone, kind })
  playerB.send('minigame:ready', { milestone, kind })
  await Promise.all([startA, startB])
  await pause(5_200)
  const resultA = waitFor<{ score?: number; settlementId?: string }>(playerA, 'minigame:result', (payload) => typeof payload.settlementId === 'string')
  const resultB = waitFor<{ score?: number; settlementId?: string }>(playerB, 'minigame:result', (payload) => typeof payload.settlementId === 'string')
  playerA.send('minigame:finish', { milestone, score: 9_999_999, progressValue: 9_999_999_999 })
  playerB.send('minigame:finish', { milestone, score: 9_999_999, progressValue: 9_999_999_999 })
  const [forgedResultA, forgedResultB] = await Promise.all([resultA, resultB])
  assert.equal(forgedResultA.score, 0, 'Forged minigame score reached settlement')
  assert.equal(forgedResultB.score, 0, 'Forged minigame score reached the other settlement')
  playerA.send('move', { zone: 'hub', position: [0, 0.86, 14], minigameOpen: false })
  playerB.send('move', { zone: 'hub', position: [0, 0.86, 14], minigameOpen: false })

  const deedResult = waitFor<AccountMessage & { ok?: boolean; quantity?: number }>(playerB, 'deed:result', (payload) => payload.account?.action?.requestId === 'deed-integrity-paid')
  playerB.send('deed:purchase', { requestId: 'deed-integrity-paid', kind: 'personal', quantity: 1 })
  const paidDeed = await deedResult
  assert.equal(paidDeed.ok, true, 'Honest paid deed purchase failed')
  assert.equal(paidDeed.quantity, 1)

  const farmId = 2
  const farmCenter: [number, number] = [19, -17]
  const farmClaimPoint: [number, number] = [farmCenter[0] + 5.85, farmCenter[1] + 6.25]
  playerB.send('move', { zone: 'farm', position: [0, 0.86, 17], minigameOpen: false })
  await pause(220)
  await walk(playerB, [0, 17], farmClaimPoint)
  const farmResult = waitFor<AccountMessage & { ok?: boolean; farmId?: number }>(playerB, 'farm:result', (payload) => payload.account?.action?.requestId === 'farm-integrity-claim')
  playerB.send('farm:action', { requestId: 'farm-integrity-claim', op: 'claim', farmId })
  const claimed = await farmResult
  assert.equal(claimed.ok, true, 'Honest deed could not claim a farm')
  assert(accountOf(claimed).ownedFarms.includes(farmId), 'Claimed farm was missing from account ledger')

  await playerB.leave()
  rooms.splice(rooms.indexOf(playerB), 1)
  await pause(250)
  const reconnected = await client.joinById(playerA.roomId, { profileId: profileB })
  rooms.push(reconnected)
  const farmSnapshot = waitFor<{ owners: Record<number, string | null>; account?: Account }>(reconnected, 'farm:snapshot')
  const deedSnapshot = waitFor<{ personalAvailable?: boolean; account?: Account }>(reconnected, 'deed:snapshot')
  const accountSnapshot = waitFor<AccountMessage>(reconnected, 'market:snapshot', (payload) => Boolean(payload.account))
  reconnected.send('lobby:ready', {})
  const [rehydratedFarm, rehydratedDeed, rehydratedAccount] = await Promise.all([farmSnapshot, deedSnapshot, accountSnapshot])
  assert.equal(rehydratedFarm.owners[farmId], reconnected.sessionId, 'Reconnect left a ghost farm owner session')
  assert.equal(rehydratedDeed.personalAvailable, false, 'Reconnect restored an unpaid personal deed')
  assert(accountOf(rehydratedAccount).ownedFarms.includes(farmId), 'Reconnect lost farm ownership ledger')
  assert.equal(accountOf(rehydratedAccount).personalDeedOwned, true, 'Reconnect lost deed entitlement')

  console.log(JSON.stringify({
    status: 'pass',
    probes: {
      fakeTopPickaxeRejected: deniedMine.reason === 'not-owned',
      fakeForageCapacityCapped: (acceptedForage.quantity ?? 0) <= forageCapacity,
      unpaidDeedRejected: deedDenied.ok === false,
      nonexistentSalesRejected: true,
      billionCashUnknownTradeRejected: true,
      forgedMinigameScoreIgnored: forgedResultA.score === 0 && forgedResultB.score === 0,
      reconnectReboundFarmAndDeed: rehydratedFarm.owners[farmId] === reconnected.sessionId && rehydratedDeed.personalAvailable === false,
    },
  }, null, 2))
} finally {
  await Promise.allSettled(rooms.map((room) => room.leave()))
  server.kill('SIGTERM')
  console.warn = originalWarn
}
