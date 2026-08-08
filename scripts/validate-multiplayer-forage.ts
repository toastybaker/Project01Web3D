import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Client, type Room } from 'colyseus.js'
import { fruitTreeCapacity } from '../src/game/config'

type ForageItem = 'apple' | 'orange' | 'truffle' | 'natural-discovery'
type ForageNode = { id: string; item: ForageItem; capacity: number; available: number; fullAt: number }
type ForageSnapshot = { regrowMs: number; nodes: Record<string, ForageNode> }
type ForageAward = ForageNode & { quantity: number }
type ForageDenied = { id: string; item?: string; reason: string }

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function messageWhere<T>(room: Room, type: string, predicate: (payload: T) => boolean = () => true, timeoutMs = 3_000): Promise<T> {
  return new Promise((resolve, reject) => {
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

async function moveAlong(room: Room, movement: Record<string, unknown>, from: [number, number], to: [number, number]) {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1])
  const steps = Math.max(1, Math.ceil(distance / 2))
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps
    room.send('move', { ...movement, position: [from[0] + (to[0] - from[0]) * progress, 0.86, from[1] + (to[1] - from[1]) * progress] })
    await new Promise((resolve) => setTimeout(resolve, 65))
  }
}

function regrowthSequence(room: Room, id: string, capacity: number, timeoutMs: number) {
  return new Promise<{ values: number[]; fullAt: number[]; times: number[] }>((resolve, reject) => {
    const values: number[] = []
    const fullAt: number[] = []
    const times: number[] = []
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${id} to refill`)), timeoutMs)
    room.onMessage('forage:node', (node: ForageNode) => {
      if (node.id !== id || node.available !== values.length + 1) return
      values.push(node.available)
      fullAt.push(node.fullAt)
      times.push(Date.now())
      if (values.length < capacity) return
      clearTimeout(timer)
      resolve({ values, fullAt, times })
    })
  })
}

const memory = new Map<string, string>()
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
  removeItem: (key: string) => { memory.delete(key) },
  clear: () => { memory.clear() },
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() { return memory.size },
}
Object.assign(globalThis, { localStorage: storage, window: { location: { search: '?gate=final' } } })
const [{ useGameStore }, { setMultiplayerSender }, { BASKET_CONFIG }] = await Promise.all([
  import('../src/game/store'), import('../src/game/multiplayer'), import('../src/game/config'),
])
let clientRequest: { type: string; payload: unknown } | null = null
setMultiplayerSender((type, payload) => { clientRequest = { type, payload } })
useGameStore.setState({
  sharedForageOnline: true,
  sharedForageAvailability: { ForageApple001: fruitTreeCapacity('ForageApple001') },
  collectedForage: {},
  inventory: { ...useGameStore.getState().inventory, apple: BASKET_CONFIG.hand.capacity - 1, orange: 0, basket: 0, 'reinforced-basket': 0, 'master-basket': 0 },
})
useGameStore.getState().collectForage('ForageApple001', 'apple')
assert(clientRequest?.type === 'forage:request' && (clientRequest.payload as { remainingCapacity?: number }).remainingCapacity === 1, 'Client did not send its one-slot remaining forage capacity')
setMultiplayerSender(null)

const port = 26_576
const testRegrowMs = 10_000
const originalWarn = console.warn
console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes('onMessage() not registered')) return
  originalWarn(...args)
}
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), TEST_FORAGE_REGROW_MS: String(testRegrowMs), TEST_RARE_FORAGE_ALWAYS: '1', TEST_RARE_FORAGE_ROLL_MS: '120' },
  stdio: ['pipe', 'pipe', 'pipe'],
})
const rooms: Room[] = []

try {
  await waitForServer(server)
  const client = new Client(`ws://127.0.0.1:${port}`)
  const playerA = await client.joinOrCreate('woodland')
  const playerB = await client.joinOrCreate('woodland', { bypassLobby: true })
  rooms.push(playerA, playerB)

  const snapshotA = messageWhere<ForageSnapshot>(playerA, 'forage:snapshot')
  const snapshotB = messageWhere<ForageSnapshot>(playerB, 'forage:snapshot')
  playerA.send('lobby:ready', {})
  playerB.send('lobby:ready', {})
  playerA.send('lobby:onboarding-ready', { ready: true })
  await Promise.all([snapshotA, snapshotB])
  const startedSnapshotA = messageWhere<ForageSnapshot>(playerA, 'forage:snapshot')
  const startedSnapshotB = messageWhere<ForageSnapshot>(playerB, 'forage:snapshot')
  playerA.send('lobby:start', {})
  const [initialA, initialB] = await Promise.all([startedSnapshotA, startedSnapshotB])
  const ids = Object.keys(initialA.nodes)
  assert(ids.length === 138 && Object.keys(initialB.nodes).length === 138, 'Forage snapshot must contain all 138 shared forage nodes')
  assert(ids.filter((id) => /^ForageApple\d{3}$/.test(id)).length === 70, 'Forage snapshot must contain exactly 70 apple nodes')
  assert(ids.filter((id) => /^ForageOrange\d{3}$/.test(id)).length === 60, 'Forage snapshot must contain exactly 60 orange nodes')
  assert(ids.filter((id) => /^ForageTruffle\d{3}$/.test(id)).length === 5, 'Forage snapshot must contain exactly five truffle nodes')
  assert(ids.filter((id) => /^ForageDiscovery\d{2}$/.test(id)).length === 3, 'Forage snapshot must contain exactly three discovery nodes')
  assert(initialA.regrowMs === testRegrowMs && initialB.regrowMs === testRegrowMs, 'Clients received the wrong regeneration interval')
  for (const [id, node] of Object.entries(initialA.nodes)) {
    const fruit = node.item === 'apple' || node.item === 'orange'
    assert(node.capacity === (fruit ? fruitTreeCapacity(id) : 1), `${id} has the wrong capacity`)
    if (fruit) assert(node.available === node.capacity && node.fullAt === 0, `${id} did not start full`)
    assert(initialB.nodes[id]?.capacity === node.capacity, `${id} differs between initial client snapshots`)
  }

  const movement = { zone: 'forage', position: [3, 0.86, -82], nickname: 'Forager', cash: 100_000, progressValue: 100_000, stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: false }
  playerA.send('move', movement)
  playerB.send('move', movement)
  await new Promise((resolve) => setTimeout(resolve, 100))

  const invalidId = messageWhere<ForageDenied>(playerA, 'forage:denied', (denied) => denied.reason === 'invalid-id')
  playerA.send('forage:request', { id: 'ForageApple070', item: 'apple', remainingCapacity: 1 })
  assert((await invalidId).id === 'ForageApple070', 'Out-of-range forage ID was not rejected')
  const invalidItem = messageWhere<ForageDenied>(playerA, 'forage:denied', (denied) => denied.reason === 'invalid-item')
  playerA.send('forage:request', { id: 'ForageApple000', item: 'banana', remainingCapacity: 1 })
  await invalidItem
  const mismatchedItem = messageWhere<ForageDenied>(playerA, 'forage:denied', (denied) => denied.reason === 'item-mismatch')
  playerA.send('forage:request', { id: 'ForageApple000', item: 'orange', remainingCapacity: 1 })
  await mismatchedItem

  const tooFar = messageWhere<ForageDenied>(playerA, 'forage:denied', (denied) => denied.reason === 'too-far')
  playerA.send('forage:request', { id: 'ForageApple001', item: 'apple', remainingCapacity: 1 })
  assert((await tooFar).id === 'ForageApple001', 'Remote forage-node harvest was not rejected')

  const partialTargetId = 'ForageApple016'
  await moveAlong(playerA, movement, [3, -82], [-8.77834661842644, -65.39751780599545])
  const partialCapacity = fruitTreeCapacity(partialTargetId)
  const partialNode = messageWhere<ForageNode>(playerA, 'forage:node', (node) => node.id === partialTargetId && node.available === 0)
  const partialCapacityAward = messageWhere<ForageAward>(playerA, 'forage:award', (award) => award.id === partialTargetId && award.quantity === partialCapacity)
  playerA.send('forage:request', { id: partialTargetId, item: 'apple', remainingCapacity: 1 })
  const [partiallyDepleted, oneSlotAward] = await Promise.all([partialNode, partialCapacityAward])
  assert(partiallyDepleted.available === 0 && oneSlotAward.quantity === partialCapacity, 'Server trusted the client-supplied capacity instead of its authoritative inventory')

  const targetId = 'ForageApple022'
  await Promise.all([
    moveAlong(playerA, movement, [-8.77834661842644, -65.39751780599545], [-24.822923637741326, -81.38835681166601]),
    moveAlong(playerB, movement, [3, -82], [-24.822923637741326, -81.38835681166601]),
  ])
  const capacity = fruitTreeCapacity(targetId)
  const depletedA = messageWhere<ForageNode>(playerA, 'forage:node', (node) => node.id === targetId && node.available === 0)
  const depletedB = messageWhere<ForageNode>(playerB, 'forage:node', (node) => node.id === targetId && node.available === 0)
  let raceAwards = 0
  let raceQuantity = 0
  playerA.onMessage('forage:award', (award: ForageAward) => { if (award.id === targetId) { raceAwards += 1; raceQuantity += award.quantity } })
  playerB.onMessage('forage:award', (award: ForageAward) => { if (award.id === targetId) { raceAwards += 1; raceQuantity += award.quantity } })
  playerA.send('forage:request', { id: targetId, item: 'apple', remainingCapacity: capacity })
  playerB.send('forage:request', { id: targetId, item: 'apple', remainingCapacity: capacity })
  const [raceNodeA, raceNodeB] = await Promise.all([depletedA, depletedB])
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert(raceAwards === 1, `Simultaneous harvest produced ${raceAwards} awards instead of one`)
  assert(raceQuantity === capacity, `Race winner received ${raceQuantity}; expected whole-tree count ${capacity}`)
  const atomicRaceAwards = raceAwards
  const atomicRaceQuantity = raceQuantity
  assert(raceNodeA.fullAt === raceNodeB.fullAt && raceNodeA.fullAt > Date.now(), 'Clients received different depletion clocks')

  const rareTargetId = 'ForageTruffle000'
  await new Promise((resolve) => setTimeout(resolve, 320))
  const persistentJoiner = await client.joinOrCreate('woodland', { bypassLobby: true })
  rooms.push(persistentJoiner)
  const persistentSnapshot = messageWhere<ForageSnapshot>(persistentJoiner, 'forage:snapshot')
  persistentJoiner.send('lobby:ready', {})
  const persistentRare = await persistentSnapshot
  assert(persistentRare.nodes[rareTargetId]?.available === 1, 'An uncollected rare forage node despawned during later spawn rolls')
  await persistentJoiner.leave()
  rooms.splice(rooms.indexOf(persistentJoiner), 1)
  await Promise.all([
    moveAlong(playerA, movement, [-24.822923637741326, -81.38835681166601], [-112, -66]),
    moveAlong(playerB, movement, [-24.822923637741326, -81.38835681166601], [-112, -66]),
  ])
  const rareNodeA = messageWhere<ForageNode>(playerA, 'forage:node', (node) => node.id === rareTargetId && node.available === 0)
  const rareNodeB = messageWhere<ForageNode>(playerB, 'forage:node', (node) => node.id === rareTargetId && node.available === 0)
  let rareAwards = 0
  playerA.onMessage('forage:award', (award: ForageAward) => { if (award.id === rareTargetId) rareAwards += 1 })
  playerB.onMessage('forage:award', (award: ForageAward) => { if (award.id === rareTargetId) rareAwards += 1 })
  playerA.send('forage:request', { id: rareTargetId, item: 'truffle', remainingCapacity: 1 })
  playerB.send('forage:request', { id: rareTargetId, item: 'truffle', remainingCapacity: 1 })
  await Promise.all([rareNodeA, rareNodeB])
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert(rareAwards === 1, `Simultaneous rare harvest produced ${rareAwards} awards instead of one`)

  await playerB.leave()
  rooms.splice(rooms.indexOf(playerB), 1)
  const lateJoiner = await client.joinOrCreate('woodland', { bypassLobby: true })
  rooms.push(lateJoiner)
  const lateSnapshot = messageWhere<ForageSnapshot>(lateJoiner, 'forage:snapshot')
  lateJoiner.send('lobby:ready', {})
  const joined = await lateSnapshot
  assert(joined.nodes[targetId]?.available === 0, 'Late joiner missed the depleted orchard state')
  assert(joined.nodes[targetId]?.fullAt === raceNodeA.fullAt, 'Late joiner received a different regeneration clock')
  assert(joined.nodes[rareTargetId]?.available === 0, 'Late joiner missed the depleted rare forage state')

  const firstRegrowthA = messageWhere<ForageNode>(playerA, 'forage:node', (node) => node.id === targetId && node.available === 1, testRegrowMs + 2_000)
  const firstRegrowthLate = messageWhere<ForageNode>(lateJoiner, 'forage:node', (node) => node.id === targetId && node.available === 1, testRegrowMs + 2_000)
  const [oneFruitA, oneFruitLate] = await Promise.all([firstRegrowthA, firstRegrowthLate])
  assert(oneFruitA.fullAt === oneFruitLate.fullAt, 'Clients disagreed on the first regenerated fruit')

  const redepletedA = messageWhere<ForageNode>(playerA, 'forage:node', (node) => node.id === targetId && node.available === 0 && node.fullAt > raceNodeA.fullAt, 6_000)
  const redepletedLate = messageWhere<ForageNode>(lateJoiner, 'forage:node', (node) => node.id === targetId && node.available === 0 && node.fullAt > raceNodeA.fullAt, 6_000)
  const partialAward = messageWhere<ForageAward>(playerA, 'forage:award', (award) => award.id === targetId && award.quantity === 1, 6_000)
  await moveAlong(playerA, movement, [-112, -66], [-24.822923637741326, -81.38835681166601])
  playerA.send('forage:request', { id: targetId, item: 'apple', remainingCapacity: 1 })
  const [secondDepletionA, secondDepletionLate, oneFruitAward] = await Promise.all([redepletedA, redepletedLate, partialAward])
  assert(oneFruitAward.quantity === 1, 'Harvest did not grant the currently available partial-tree count')
  assert(secondDepletionA.fullAt === secondDepletionLate.fullAt, 'Partial harvest reset clients to different clocks')

  const sequenceA = regrowthSequence(playerA, targetId, capacity, capacity * testRegrowMs + 2_000)
  const sequenceLate = regrowthSequence(lateJoiner, targetId, capacity, capacity * testRegrowMs + 2_000)
  const [refillA, refillLate] = await Promise.all([sequenceA, sequenceLate])
  const expected = Array.from({ length: capacity }, (_, index) => index + 1)
  assert(JSON.stringify(refillA.values) === JSON.stringify(expected), `Player A saw non-deterministic refill ${refillA.values.join(',')}`)
  assert(JSON.stringify(refillLate.values) === JSON.stringify(expected), `Late joiner saw non-deterministic refill ${refillLate.values.join(',')}`)
  assert(refillA.fullAt.slice(0, -1).every((fullAt) => fullAt === secondDepletionA.fullAt), 'Regeneration clock changed before the tree was full')
  assert(refillLate.fullAt.slice(0, -1).every((fullAt) => fullAt === secondDepletionA.fullAt), 'Late joiner regeneration clock changed before full')
  assert(refillA.fullAt.at(-1) === 0 && refillLate.fullAt.at(-1) === 0, 'Full tree did not clear its regeneration clock')
  const intervals = refillA.times.slice(1).map((time, index) => time - refillA.times[index])
  const cumulativeIntervals = refillA.times.slice(1).map((time) => time - refillA.times[0])
  assert(cumulativeIntervals.every((elapsed, index) => Math.abs(elapsed - (index + 1) * testRegrowMs) <= 160), `Regeneration clock drifted: ${intervals.join(',')}`)

  console.log(JSON.stringify({
    status: 'pass',
    clientsAtOnce: 2,
    nodes: ids.length,
    apples: 70,
    oranges: 60,
    truffles: 5,
    discoveries: 3,
    targetId,
    capacity,
    malformedRequestsRejected: 3,
    remoteHarvestRejected: true,
    oneSlotAward: oneSlotAward.quantity,
    partialTreeRemaining: partiallyDepleted.available,
    rareAtomicAwards: rareAwards,
    uncollectedRarePersisted: true,
    clientCapacityRequest: 1,
    simultaneousAwards: atomicRaceAwards,
    raceQuantity: atomicRaceQuantity,
    lateJoinAvailable: joined.nodes[targetId].available,
    partialHarvestQuantity: oneFruitAward.quantity,
    deterministicRefill: refillA.values,
  }, null, 2))
} finally {
  await Promise.allSettled(rooms.map((room) => room.leave()))
  server.kill()
  console.warn = originalWarn
}
