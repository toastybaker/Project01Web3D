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

async function moveAlong(room: Room, movement: Record<string, unknown>, from: [number, number], to: [number, number]) {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1])
  const steps = Math.max(1, Math.ceil(distance / 2))
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps
    room.send('move', { ...movement, position: [from[0] + (to[0] - from[0]) * progress, 0.86, from[1] + (to[1] - from[1]) * progress] })
    await new Promise((resolve) => setTimeout(resolve, 70))
  }
}

const port = 26_572
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), TEST_STARTING_CASH: '30000000', TEST_FARM_FIXTURES: '1', TEST_START_CLEAR_WEATHER: '1', TEST_FARM_GROWTH_MS: '140', TEST_RAIN_COOLDOWN_MS: '0' },
  stdio: ['pipe', 'pipe', 'pipe'],
})
const rooms: Room[] = []

try {
  await waitForServer(server)
  const client = new Client(`ws://127.0.0.1:${port}`)
  const farmerA = await client.joinOrCreate('woodland', { bypassLobby: true })
  const farmerB = await client.joinOrCreate('woodland', { bypassLobby: true })
  rooms.push(farmerA, farmerB)

  const snapshotA = message<{ selfId: string; owners: Record<number, string | null>; cells: Record<string, unknown> }>(farmerA, 'farm:snapshot')
  const snapshotB = message<{ selfId: string; owners: Record<number, string | null>; cells: Record<string, unknown> }>(farmerB, 'farm:snapshot')
  const deedSnapshotA = message<{ personalAvailable: boolean; globalRemaining: number }>(farmerA, 'deed:snapshot')
  const deedSnapshotB = message<{ personalAvailable: boolean; globalRemaining: number }>(farmerB, 'deed:snapshot')
  farmerA.send('lobby:ready', {})
  farmerB.send('lobby:ready', {})
  const [initialA, initialB, initialDeedA, initialDeedB] = await Promise.all([snapshotA, snapshotB, deedSnapshotA, deedSnapshotB])
  assert(Object.keys(initialA.owners).length === 8 && Object.keys(initialB.owners).length === 8, 'Farm snapshot is incomplete')
  assert(Object.values(initialA.owners).every((owner) => owner === null), 'Fresh farm snapshot contains an owner')
  assert(initialDeedA.personalAvailable && initialDeedB.personalAvailable, 'A player did not receive a personal deed entitlement')
  assert(initialDeedA.globalRemaining === 2 && initialDeedB.globalRemaining === 2, 'Shared expansion pool did not begin at two')

  const movement = { zone: 'farm', position: [-48.15, 0.86, -9.75], nickname: 'Farmer', cash: 100_000, progressValue: 100_000, stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: false }
  farmerA.send('move', movement)
  farmerB.send('move', movement)
  await new Promise((resolve) => setTimeout(resolve, 120))
  const noDeedClaim = message<{ requestId: string; ok: boolean; reason?: string }>(farmerB, 'farm:result', (result) => result.requestId === 'claim-without-deed')
  farmerB.send('farm:action', { requestId: 'claim-without-deed', op: 'claim', farmId: 0 })
  const noDeed = await noDeedClaim
  assert(!noDeed.ok && noDeed.reason === 'Need a farm deed', 'Farm claim succeeded without a purchased deed entitlement')

  type DeedResult = { requestId: string; ok: boolean; quantity: number; personalCount: number; globalCount: number; personalAvailable: boolean; globalRemaining: number; reason?: string }
  const lockedGlobalPurchase = message<DeedResult>(farmerA, 'deed:result', (result) => result.requestId === 'global-before-personal')
  farmerA.send('deed:purchase', { requestId: 'global-before-personal', kind: 'global', quantity: 1 })
  const lockedGlobal = await lockedGlobalPurchase
  assert(!lockedGlobal.ok && lockedGlobal.reason === 'Buy personal deed first' && lockedGlobal.globalRemaining === 2, 'Shared deed was not gated behind the personal deed')
  const leaderPersonalPurchase = message<DeedResult>(farmerA, 'deed:result', (result) => result.requestId === 'leader-buys-personal')
  farmerA.send('deed:purchase', { requestId: 'leader-buys-personal', kind: 'personal', quantity: 1 })
  const leaderPersonal = await leaderPersonalPurchase
  assert(leaderPersonal.ok && leaderPersonal.quantity === 1 && leaderPersonal.personalCount === 1 && leaderPersonal.globalCount === 0, 'First transaction did not stay personal-only')

  const leaderPurchase = message<DeedResult>(farmerA, 'deed:result', (result) => result.requestId === 'leader-buys-shared')
  const depletedStock = message<{ globalRemaining: number }>(farmerB, 'deed:stock', (stock) => stock.globalRemaining === 0)
  farmerA.send('deed:purchase', { requestId: 'leader-buys-shared', kind: 'global', quantity: 3 })
  const [leaderDeeds] = await Promise.all([leaderPurchase, depletedStock])
  assert(leaderDeeds.ok && leaderDeeds.quantity === 2, 'Leader could not buy both shared deeds after the personal deed')
  assert(leaderDeeds.personalCount === 0 && leaderDeeds.globalCount === 2 && leaderDeeds.globalRemaining === 0, 'Leader purchase used the wrong deed pool')

  const protectedPurchase = message<DeedResult>(farmerB, 'deed:result', (result) => result.requestId === 'protected-personal')
  farmerB.send('deed:purchase', { requestId: 'protected-personal', kind: 'personal', quantity: 1 })
  const protectedDeed = await protectedPurchase
  assert(protectedDeed.ok && protectedDeed.quantity === 1 && protectedDeed.personalCount === 1 && protectedDeed.globalCount === 0, 'Depleted shared stock blocked another player personal deed')

  const soldOutPurchase = message<DeedResult>(farmerB, 'deed:result', (result) => result.requestId === 'shared-sold-out')
  farmerB.send('deed:purchase', { requestId: 'shared-sold-out', kind: 'global', quantity: 1 })
  const soldOut = await soldOutPurchase
  assert(!soldOut.ok && soldOut.quantity === 0 && soldOut.globalRemaining === 0, 'Shared pool sold more than two expansion deeds')

  const duplicatePurchase = message<DeedResult>(farmerA, 'deed:result', (result) => result.requestId === 'leader-buys-shared')
  farmerA.send('deed:purchase', { requestId: 'leader-buys-shared', kind: 'global', quantity: 3 })
  const duplicate = await duplicatePurchase
  assert(duplicate.quantity === 2 && duplicate.globalRemaining === 0, 'Idempotent deed retry returned a different result')

  farmerA.send('move', movement)
  farmerB.send('move', movement)
  await new Promise((resolve) => setTimeout(resolve, 160))

  const ownerUpdateA = message<{ farmId: number; ownerId: string }>(farmerA, 'farm:update', (update) => update.farmId === 0 && Boolean(update.ownerId))
  const ownerUpdateB = message<{ farmId: number; ownerId: string }>(farmerB, 'farm:update', (update) => update.farmId === 0 && Boolean(update.ownerId))
  const resultA = message<{ requestId: string; ok: boolean }>(farmerA, 'farm:result', (result) => result.requestId === 'claim-a-01')
  const resultB = message<{ requestId: string; ok: boolean }>(farmerB, 'farm:result', (result) => result.requestId === 'claim-b-01')
  farmerA.send('farm:action', { requestId: 'claim-a-01', op: 'claim', farmId: 0 })
  farmerB.send('farm:action', { requestId: 'claim-b-01', op: 'claim', farmId: 0 })
  const [claimA, claimB, broadcastA, broadcastB] = await Promise.all([resultA, resultB, ownerUpdateA, ownerUpdateB])
  assert(Number(claimA.ok) + Number(claimB.ok) === 1, 'Simultaneous claims did not resolve to one owner')
  assert(broadcastA.ownerId === broadcastB.ownerId, 'Clients received different farm owners')
  const owner = broadcastA.ownerId === farmerA.sessionId ? farmerA : farmerB
  const intruder = owner === farmerA ? farmerB : farmerA

  const farmCenters = [[-54, -16], [-18, -14], [19, -17], [55, -13], [-53, -50], [-17, -49], [20, -53], [56, -48]] as const
  const farmsOwnedByA = broadcastA.ownerId === farmerA.sessionId ? [0] : []
  let farmerAPosition: [number, number] = [-48.15, -9.75]
  for (let farmId = 1; farmsOwnedByA.length < 3; farmId += 1) {
    const [centerX, centerZ] = farmCenters[farmId]
    const target: [number, number] = [centerX + 5.85, centerZ + 6.25]
    await moveAlong(farmerA, movement, farmerAPosition, target)
    farmerAPosition = target
    const claim = message<{ requestId: string; ok: boolean; reason?: string }>(farmerA, 'farm:result', (result) => result.requestId === `leader-claim-${farmId}`)
    farmerA.send('farm:action', { requestId: `leader-claim-${farmId}`, op: 'claim', farmId })
    const claimed = await claim
    assert(claimed.ok, `Leader could not consume a purchased deed for farm ${farmId}: ${claimed.reason ?? 'unknown'}`)
    farmsOwnedByA.push(farmId)
  }
  const fourthFarmId = farmCenters.findIndex((_, farmId) => farmId > 0 && !farmsOwnedByA.includes(farmId))
  assert(fourthFarmId >= 0, 'Validator could not find a fourth farm target')
  const [fourthX, fourthZ] = farmCenters[fourthFarmId]
  const fourthTarget: [number, number] = [fourthX + 5.85, fourthZ + 6.25]
  await moveAlong(farmerA, movement, farmerAPosition, fourthTarget)
  farmerAPosition = fourthTarget
  const fourthClaim = message<{ requestId: string; ok: boolean; reason?: string }>(farmerA, 'farm:result', (result) => result.requestId === 'leader-fourth-farm')
  farmerA.send('farm:action', { requestId: 'leader-fourth-farm', op: 'claim', farmId: fourthFarmId })
  const fourth = await fourthClaim
  assert(!fourth.ok && fourth.reason === 'Farm limit reached', 'A player was able to claim a fourth farm')

  const plantPosition = { ...movement, position: [-58.97, 0.86, -20.97] }
  const plantTarget: [number, number] = [-58.97, -20.97]
  await Promise.all([
    moveAlong(owner, movement, owner === farmerA ? farmerAPosition : [-48.15, -9.75], plantTarget),
    moveAlong(intruder, movement, intruder === farmerA ? farmerAPosition : [-48.15, -9.75], plantTarget),
  ])
  const denied = message<{ requestId: string; ok: boolean; reason?: string }>(intruder, 'farm:result', (result) => result.requestId === 'intruder-plant')
  intruder.send('farm:action', { requestId: 'intruder-plant', op: 'plant', farmId: 0, cellIndex: 0, crop: 'wheat' })
  assert(!(await denied).ok, 'Non-owner planted on another player farm')

  const plantedA = message<{ farmId: number; cellIndex: number; cell: { stage: string; crop: string } }>(farmerA, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 0 && update.cell?.stage === 'planted')
  const plantedB = message<{ farmId: number; cellIndex: number; cell: { stage: string; crop: string } }>(farmerB, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 0 && update.cell?.stage === 'planted')
  const plantResult = message<{ requestId: string; ok: boolean }>(owner, 'farm:result', (result) => result.requestId === 'owner-plant')
  owner.send('farm:action', { requestId: 'owner-plant', op: 'plant', farmId: 0, cellIndex: 0, crop: 'wheat' })
  const [ownerPlant, cellA, cellB] = await Promise.all([plantResult, plantedA, plantedB])
  assert(ownerPlant.ok && cellA.cell.crop === 'wheat' && cellB.cell.crop === 'wheat', 'Shared crop plant did not broadcast identically')

  const wateredA = message<{ farmId: number; cellIndex: number; cell: { stage: string } }>(farmerA, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 0 && update.cell?.stage === 'watered')
  const wateredB = message<{ farmId: number; cellIndex: number; cell: { stage: string } }>(farmerB, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 0 && update.cell?.stage === 'watered')
  const waterResult = message<{ requestId: string; ok: boolean; account?: { inventory?: Record<string, number> } }>(owner, 'farm:result', (result) => result.requestId === 'owner-water')
  owner.send('farm:action', { requestId: 'owner-water', op: 'water', farmId: 0, cellIndex: 0 })
  const [ownerWater] = await Promise.all([waterResult, wateredA, wateredB])
  assert(ownerWater.ok && ownerWater.account?.inventory?.['water-can'] === 1, 'Watering can was consumed or watering failed')

  const readyA = message<{ farmId: number; cellIndex: number; cell: { stage: string } }>(farmerA, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 0 && update.cell?.stage === 'ready')
  const readyB = message<{ farmId: number; cellIndex: number; cell: { stage: string } }>(farmerB, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 0 && update.cell?.stage === 'ready')
  await Promise.all([readyA, readyB])

  const late = await client.joinOrCreate('woodland', { bypassLobby: true })
  rooms.push(late)
  const lateSnapshot = message<{ owners: Record<number, string | null>; cells: Record<string, { stage: string; crop: string }> }>(late, 'farm:snapshot')
  late.send('lobby:ready', {})
  const joined = await lateSnapshot
  assert(joined.owners[0] === owner.sessionId, 'Late joiner missed farm ownership')
  assert(joined.cells['0:0']?.stage === 'ready' && joined.cells['0:0']?.crop === 'wheat', 'Late joiner missed crop state')

  const harvestUpdateA = message<{ farmId: number; cellIndex: number; cell: null }>(farmerA, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 0 && update.cell === null)
  const harvestUpdateB = message<{ farmId: number; cellIndex: number; cell: null }>(farmerB, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 0 && update.cell === null)
  const harvestResult = message<{ requestId: string; ok: boolean; quantity: number }>(owner, 'farm:result', (result) => result.requestId === 'owner-harvest')
  owner.send('farm:action', { requestId: 'owner-harvest', op: 'harvest', farmId: 0, cellIndex: 0 })
  const [harvest] = await Promise.all([harvestResult, harvestUpdateA, harvestUpdateB])
  assert(harvest.ok && harvest.quantity === 1, 'Harvest award was wrong')

  const dryPlantA = message<{ farmId: number; cellIndex: number; cell: { stage: string; crop: string } }>(farmerA, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 1 && update.cell?.stage === 'planted')
  const dryPlantB = message<{ farmId: number; cellIndex: number; cell: { stage: string; crop: string } }>(farmerB, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 1 && update.cell?.stage === 'planted')
  const dryPlantResult = message<{ requestId: string; ok: boolean }>(owner, 'farm:result', (result) => result.requestId === 'owner-dry-plant')
  owner.send('farm:action', { requestId: 'owner-dry-plant', op: 'plant', farmId: 0, cellIndex: 1, crop: 'wheat', watered: false })
  await Promise.all([dryPlantResult, dryPlantA, dryPlantB])

  const rainWaterA = message<{ farmId: number; cellIndex: number; cell: { stage: string } }>(farmerA, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 1 && update.cell?.stage === 'watered')
  const rainWaterB = message<{ farmId: number; cellIndex: number; cell: { stage: string } }>(farmerB, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 1 && update.cell?.stage === 'watered')
  farmerB.send('farm:rain', {})
  await Promise.all([rainWaterA, rainWaterB])

  const rainReadyA = message<{ farmId: number; cellIndex: number; cell: { stage: string } }>(farmerA, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 1 && update.cell?.stage === 'ready')
  const rainReadyB = message<{ farmId: number; cellIndex: number; cell: { stage: string } }>(farmerB, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 1 && update.cell?.stage === 'ready')
  await Promise.all([rainReadyA, rainReadyB])

  console.log(JSON.stringify({ status: 'pass', maxPlayers: 6, farms: 8, noDeedRejected: true, personalDeeds: true, sharedExpansionDeeds: 2, sharedLockedUntilPersonal: true, leaderOwns: farmsOwnedByA.length, fourthFarmRejected: true, personalProtected: protectedDeed.quantity, deedRetryIdempotent: true, oneOwner: true, nonOwnerRejected: true, sharedCrop: true, sharedRainWatering: true, lateJoin: true, harvestQuantity: harvest.quantity }, null, 2))
} finally {
  await Promise.allSettled(rooms.map((room) => room.leave()))
  server.kill()
}
