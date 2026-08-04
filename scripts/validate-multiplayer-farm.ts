import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Client, type Room } from 'colyseus.js'

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

const port = 26_572
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), TEST_FARM_GROWTH_MS: '140' },
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
  farmerA.send('lobby:ready', {})
  farmerB.send('lobby:ready', {})
  const [initialA, initialB] = await Promise.all([snapshotA, snapshotB])
  assert(Object.keys(initialA.owners).length === 8 && Object.keys(initialB.owners).length === 8, 'Farm snapshot is incomplete')
  assert(Object.values(initialA.owners).every((owner) => owner === null), 'Fresh farm snapshot contains an owner')

  const movement = { zone: 'farm', position: [-48.15, 0.86, -9.75], nickname: 'Farmer', cash: 100_000, progressValue: 100_000, stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: false }
  farmerA.send('move', movement)
  farmerB.send('move', movement)
  await new Promise((resolve) => setTimeout(resolve, 160))

  const ownerUpdateA = message<{ farmId: number; ownerId: string }>(farmerA, 'farm:update', (update) => update.farmId === 0 && Boolean(update.ownerId))
  const ownerUpdateB = message<{ farmId: number; ownerId: string }>(farmerB, 'farm:update', (update) => update.farmId === 0 && Boolean(update.ownerId))
  const resultA = message<{ requestId: string; ok: boolean }>(farmerA, 'farm:result', (result) => result.requestId === 'claim-a')
  const resultB = message<{ requestId: string; ok: boolean }>(farmerB, 'farm:result', (result) => result.requestId === 'claim-b')
  farmerA.send('farm:action', { requestId: 'claim-a', op: 'claim', farmId: 0 })
  farmerB.send('farm:action', { requestId: 'claim-b', op: 'claim', farmId: 0 })
  const [claimA, claimB, broadcastA, broadcastB] = await Promise.all([resultA, resultB, ownerUpdateA, ownerUpdateB])
  assert(Number(claimA.ok) + Number(claimB.ok) === 1, 'Simultaneous claims did not resolve to one owner')
  assert(broadcastA.ownerId === broadcastB.ownerId, 'Clients received different farm owners')
  const owner = broadcastA.ownerId === farmerA.sessionId ? farmerA : farmerB
  const intruder = owner === farmerA ? farmerB : farmerA

  const plantPosition = { ...movement, position: [-58.97, 0.86, -20.97] }
  owner.send('move', plantPosition)
  intruder.send('move', plantPosition)
  await new Promise((resolve) => setTimeout(resolve, 160))
  const denied = message<{ requestId: string; ok: boolean; reason?: string }>(intruder, 'farm:result', (result) => result.requestId === 'intruder-plant')
  intruder.send('farm:action', { requestId: 'intruder-plant', op: 'plant', farmId: 0, cellIndex: 0, crop: 'wheat' })
  assert(!(await denied).ok, 'Non-owner planted on another player farm')

  const plantedA = message<{ farmId: number; cellIndex: number; cell: { stage: string; crop: string } }>(farmerA, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 0 && update.cell?.stage === 'watered')
  const plantedB = message<{ farmId: number; cellIndex: number; cell: { stage: string; crop: string } }>(farmerB, 'farm:update', (update) => update.farmId === 0 && update.cellIndex === 0 && update.cell?.stage === 'watered')
  const plantResult = message<{ requestId: string; ok: boolean }>(owner, 'farm:result', (result) => result.requestId === 'owner-plant')
  owner.send('farm:action', { requestId: 'owner-plant', op: 'plant', farmId: 0, cellIndex: 0, crop: 'wheat', watered: true })
  const [ownerPlant, cellA, cellB] = await Promise.all([plantResult, plantedA, plantedB])
  assert(ownerPlant.ok && cellA.cell.crop === 'wheat' && cellB.cell.crop === 'wheat', 'Shared crop plant did not broadcast identically')

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

  console.log(JSON.stringify({ status: 'pass', farms: 8, oneOwner: true, nonOwnerRejected: true, sharedCrop: true, lateJoin: true, harvestQuantity: harvest.quantity }, null, 2))
} finally {
  await Promise.allSettled(rooms.map((room) => room.leave()))
  server.kill()
}
