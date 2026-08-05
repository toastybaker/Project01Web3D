import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Client, type Room } from 'colyseus.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function once<T>(room: Room, type: string, timeoutMs = 3_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs)
    room.onMessage(type, (payload: T) => { clearTimeout(timer); resolve(payload) })
  })
}

async function waitForServer(process: ChildProcessWithoutNullStreams) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Multiplayer server did not start')), 10_000)
    const onData = (chunk: Buffer) => {
      if (!chunk.toString().includes('Woodland multiplayer listening')) return
      clearTimeout(timer); process.stdout.off('data', onData); resolve()
    }
    process.stdout.on('data', onData)
    process.once('exit', (code) => reject(new Error(`Multiplayer server exited early (${code})`)))
  })
}

const originalWarn = console.warn
console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes('onMessage() not registered')) return
  originalWarn(...args)
}

const port = 26_575
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(), env: { ...process.env, PORT: String(port), TEST_ALLOW_EARLY_RESET: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
})
const rooms: Room[] = []

try {
  await waitForServer(server)
  const endpoint = `ws://127.0.0.1:${port}`
  const firstClient = new Client(endpoint)
  const first = await firstClient.joinOrCreate('woodland')
  rooms.push(first)
  for (let index = 1; index < 6; index += 1) rooms.push(await new Client(endpoint).joinById(first.roomId))
  assert(new Set(rooms.map((room) => room.roomId)).size === 1, 'Six players were not placed in one lobby')

  const reassigned = once<{ isHost: boolean; playerCount: number }>(rooms[1], 'lobby:state')
  await first.leave()
  rooms.shift()
  const hostState = await reassigned
  assert(hostState.isHost && hostState.playerCount === 5, 'Host was not reassigned after leaving the lobby')

  const replacement = await new Client(endpoint).joinById(rooms[0].roomId)
  rooms.push(replacement)
  let seventhRejected = false
  try {
    const seventh = await new Client(endpoint).joinById(rooms[0].roomId)
    await seventh.leave()
  } catch {
    seventhRejected = true
  }
  assert(seventhRejected, 'A seventh player joined a full six-player lobby')

  let prematureStarts = 0
  rooms.forEach((room) => room.onMessage('match:sync', () => { prematureStarts += 1 }))
  rooms[1].send('lobby:start', {})
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert(prematureStarts === 0, 'A non-host started the match')

  const syncs = rooms.map((room) => once<{ seed: number; startedAt: number; durationSeconds: number }>(room, 'match:sync'))
  rooms[0].send('lobby:start', {})
  const match = await Promise.all(syncs)
  assert(new Set(match.map((entry) => entry.seed)).size === 1, 'Players received different match seeds')
  assert(new Set(match.map((entry) => entry.startedAt)).size === 1, 'Players received different match start times')
  assert(match.every((entry) => entry.durationSeconds === 60 * 60), 'Players received different match durations')

  const reassignedDuringMatch = once<{ isHost: boolean; playerCount: number }>(rooms[1], 'lobby:state')
  await rooms[0].leave()
  rooms.shift()
  const runningHostState = await reassignedDuringMatch
  assert(runningHostState.isHost && runningHostState.playerCount === 5, 'Host was not reassigned during the match')

  const resetNotices = rooms.map((room) => once<Record<string, never>>(room, 'lobby:reset'))
  const restartedStatePromise = once<{ started: boolean }>(rooms[0], 'lobby:state')
  rooms[0].send('lobby:reset', {})
  await Promise.all(resetNotices)
  const restartedState = await restartedStatePromise
  assert(!restartedState.started, 'New Run did not reset the room to the lobby')

  console.log(JSON.stringify({ status: 'pass', lobbyPlayers: 6, seventhRejected, hostReassigned: true, inMatchHostReassigned: true, nonHostStartBlocked: true, synchronizedMatch: true, synchronizedNewRun: true }, null, 2))
} finally {
  await Promise.allSettled(rooms.map((room) => room.leave()))
  server.kill('SIGTERM')
}
