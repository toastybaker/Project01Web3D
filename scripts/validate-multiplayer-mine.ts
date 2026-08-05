import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Client, type Room } from 'colyseus.js'
import { MINE_NODE_SITES } from '../shared/mine-nodes.js'
import { oreKindAtDepth } from '../src/game/ore'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function message<T>(room: Room, type: string, timeoutMs = 3_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs)
    room.onMessage(type, (payload: T) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

function messageWhere<T>(room: Room, type: string, predicate: (payload: T) => boolean, timeoutMs = 3_000): Promise<T> {
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

const port = 26_571
const originalWarn = console.warn
console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes('onMessage() not registered')) return
  originalWarn(...args)
}
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ['pipe', 'pipe', 'pipe'],
})

const rooms: Room[] = []
try {
  await waitForServer(server)
  const client = new Client(`ws://127.0.0.1:${port}`)
  const minerA = await client.joinOrCreate('woodland', { bypassLobby: true })
  const minerB = await client.joinOrCreate('woodland', { bypassLobby: true })
  rooms.push(minerA, minerB)

  const snapshotA = message<{ seed: number; nodes: Record<string, { generation: number; readyAt: number }> }>(minerA, 'mine:snapshot')
  const snapshotB = message<{ seed: number; nodes: Record<string, { generation: number; readyAt: number }> }>(minerB, 'mine:snapshot')
  minerA.send('lobby:ready', {})
  minerB.send('lobby:ready', {})
  const [initialA, initialB] = await Promise.all([snapshotA, snapshotB])
  assert(initialA.seed === initialB.seed, 'Players received different mine seeds')
  assert(Object.keys(initialA.nodes).length === MINE_NODE_SITES.length, 'Mine snapshot is missing node state')

  const site = MINE_NODE_SITES[0]
  const movement = { zone: 'mine', position: [site.x, 0.86, site.z], nickname: 'Tester', cash: 100_000, progressValue: 100_000, stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: false }
  minerA.send('move', movement)
  minerB.send('move', movement)
  await new Promise((resolve) => setTimeout(resolve, 180))

  const sharedForA = message<{ id: string; generation: number; readyAt: number }>(minerA, 'mine:node')
  const sharedForB = message<{ id: string; generation: number; readyAt: number }>(minerB, 'mine:node')
  const awardA = message<{ id: string; ore: string; quantity: number; generation: number; readyAt: number }>(minerA, 'mine:award')
  minerA.send('mine:request', { id: site.id, tool: 'worn-pickaxe' })
  const [nodeA, nodeB, award] = await Promise.all([sharedForA, sharedForB, awardA])

  assert(nodeA.id === site.id && nodeB.id === site.id && award.id === site.id, 'Wrong node changed')
  assert(nodeA.generation === 1 && nodeB.generation === 1, 'Shared generation did not advance once')
  assert(nodeA.readyAt === nodeB.readyAt && nodeA.readyAt === award.readyAt, 'Clients received different respawn timestamps')
  const remaining = nodeA.readyAt - Date.now()
  assert(remaining >= 27_000 && remaining <= 35_000, `Respawn is outside the 28-35 second target (${remaining}ms)`)

  let duplicateAward = false
  minerB.onMessage('mine:award', () => { duplicateAward = true })
  minerB.send('mine:request', { id: site.id, tool: 'worn-pickaxe' })
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert(!duplicateAward, 'A second player mined an already depleted shared node')

  const lateJoiner = await client.joinOrCreate('woodland', { bypassLobby: true })
  rooms.push(lateJoiner)
  const lateSnapshot = message<{ seed: number; nodes: Record<string, { generation: number; readyAt: number }> }>(lateJoiner, 'mine:snapshot')
  lateJoiner.send('lobby:ready', {})
  const joined = await lateSnapshot
  assert(joined.nodes[site.id]?.generation === 1, 'Late joiner missed the current ore generation')
  assert(joined.nodes[site.id]?.readyAt === nodeA.readyAt, 'Late joiner missed the shared depleted state')

  const raceSite = MINE_NODE_SITES[1]
  const raceMovement = { ...movement, position: [raceSite.x, 0.86, raceSite.z] }
  minerA.send('move', raceMovement)
  minerB.send('move', raceMovement)
  await new Promise((resolve) => setTimeout(resolve, 180))
  let raceAwards = 0
  minerA.onMessage('mine:award', (payload: { id?: string }) => { if (payload.id === raceSite.id) raceAwards += 1 })
  minerB.onMessage('mine:award', (payload: { id?: string }) => { if (payload.id === raceSite.id) raceAwards += 1 })
  minerA.send('mine:request', { id: raceSite.id, tool: 'worn-pickaxe' })
  minerB.send('mine:request', { id: raceSite.id, tool: 'worn-pickaxe' })
  await new Promise((resolve) => setTimeout(resolve, 350))
  assert(raceAwards === 1, `Simultaneous mining produced ${raceAwards} awards instead of one`)

  const deepSite = [...MINE_NODE_SITES].sort((left, right) => left.z - right.z)[0]
  minerA.send('move', { ...movement, position: [deepSite.x, 0.86, deepSite.z] })
  await new Promise((resolve) => setTimeout(resolve, 180))
  const deepAward = messageWhere<{ id: string; ore: string; quantity: number }>(minerA, 'mine:award', (payload) => payload.id === deepSite.id)
  minerA.send('mine:request', { id: deepSite.id, tool: 'crystal-pickaxe' })
  const deepResult = await deepAward
  assert(deepResult.quantity >= 1, 'Deepest authored mine node did not award ore')

  const ironSite = [...MINE_NODE_SITES]
    .sort((left, right) => left.z - right.z)
    .find((candidate) => candidate.id !== deepSite.id && oreKindAtDepth(candidate.id, candidate.z, 0, initialA.seed) === 'iron-ore')
  assert(ironSite, 'Deterministic mine seed did not provide an iron node for validation')
  minerA.send('move', { ...movement, position: [ironSite.x, 0.86, ironSite.z] })
  await new Promise((resolve) => setTimeout(resolve, 180))
  const ironAward = messageWhere<{ id: string; ore: string; quantity: number }>(minerA, 'mine:award', (payload) => payload.id === ironSite.id)
  minerA.send('mine:request', { id: ironSite.id, tool: 'worn-pickaxe' })
  const ironResult = await ironAward
  assert(ironResult.ore === 'iron-ore' && ironResult.quantity >= 1, 'Starter Pickaxe could not mine a deterministic iron node')

  const respawnA = messageWhere<{ id: string; generation: number; readyAt: number }>(minerA, 'mine:node', (node) => node.id === site.id && node.readyAt === 0, 37_000)
  const respawnB = messageWhere<{ id: string; generation: number; readyAt: number }>(minerB, 'mine:node', (node) => node.id === site.id && node.readyAt === 0, 37_000)
  const [activeA, activeB] = await Promise.all([respawnA, respawnB])
  assert(activeA.id === site.id && activeB.id === site.id, 'Wrong node respawned')
  assert(activeA.generation === 1 && activeB.generation === 1, 'Respawn changed generation twice')
  assert(activeA.readyAt === 0 && activeB.readyAt === 0, 'Respawn did not reactivate the shared node')

  console.log(JSON.stringify({
    status: 'pass',
    nodes: MINE_NODE_SITES.length,
    sharedNode: site.id,
    award: `${award.quantity} ${award.ore}`,
    respawnSeconds: Math.round(remaining / 100) / 10,
    duplicateAward,
    simultaneousAwards: raceAwards,
    deepestNode: `${deepSite.id}@${deepSite.z.toFixed(1)}:${deepResult.ore}`,
    ironNode: `${ironSite.id}@${ironSite.z.toFixed(1)}:${ironResult.quantity}`,
    lateJoinGeneration: joined.nodes[site.id].generation,
    sharedRespawn: activeA.readyAt === 0 && activeB.readyAt === 0,
  }, null, 2))
} finally {
  await Promise.allSettled(rooms.map((room) => room.leave()))
  server.kill()
  console.warn = originalWarn
}
