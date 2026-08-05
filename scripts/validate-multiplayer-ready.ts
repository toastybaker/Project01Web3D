import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Client, type Room } from 'colyseus.js'
import { minigameMilestones, scheduledMinigame, type MinigameKind } from '../src/game/minigame'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function message<T>(room: Room, type: string, timeoutMs = 3_000): Promise<T> {
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

const port = 26_574
const originalWarn = console.warn
console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes('onMessage() not registered')) return
  originalWarn(...args)
}
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: ['pipe', 'pipe', 'pipe'],
})
const rooms: Room[] = []

try {
  await waitForServer(server)
  const client = new Client(`ws://127.0.0.1:${port}`)
  const playerA = await client.joinOrCreate('woodland')
  const playerB = await client.joinOrCreate('woodland')
  rooms.push(playerA, playerB)
  playerA.send('lobby:ready', {}); playerB.send('lobby:ready', {})

  const syncA = message<{ seed: number; startedAt: number; durationSeconds: number }>(playerA, 'match:sync')
  const syncB = message<{ seed: number; startedAt: number; durationSeconds: number }>(playerB, 'match:sync')
  playerA.send('lobby:start', {})
  const [matchA, matchB] = await Promise.all([syncA, syncB])
  assert(matchA.seed === matchB.seed, 'Players received different match seeds')
  const milestone = minigameMilestones(matchA.durationSeconds)[0]
  const kind: MinigameKind = scheduledMinigame(milestone, matchA.seed, matchA.durationSeconds)
  const movement = { zone: 'hub', position: [0, .86, 14], cash: 100_000, progressValue: 100_000, stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: true, minigameKind: kind, minigameMilestone: milestone, minigameScore: 0 }
  playerA.send('move', { ...movement, nickname: 'Ready A' })
  playerB.send('move', { ...movement, nickname: 'Ready B' })
  await new Promise((resolve) => setTimeout(resolve, 180))

  let startsA = 0
  let startsB = 0
  playerA.onMessage('minigame:start', () => { startsA += 1 })
  playerB.onMessage('minigame:start', () => { startsB += 1 })
  playerA.send('minigame:ready', { milestone, kind })
  await new Promise((resolve) => setTimeout(resolve, 350))
  assert(startsA === 0 && startsB === 0, 'One ready player started the event before the lobby was ready')

  const startA = message<{ milestone: number; kind: MinigameKind; gameplayAt: number }>(playerA, 'minigame:start')
  const startB = message<{ milestone: number; kind: MinigameKind; gameplayAt: number }>(playerB, 'minigame:start')
  playerB.send('minigame:ready', { milestone, kind })
  const [eventA, eventB] = await Promise.all([startA, startB])
  assert(eventA.milestone === milestone && eventB.milestone === milestone, 'Ready gate started the wrong milestone')
  assert(eventA.kind === kind && eventB.kind === kind, 'Ready gate started the wrong minigame')
  assert(eventA.gameplayAt === eventB.gameplayAt, 'Players received different gameplay start times')
  const warningMs = eventA.gameplayAt - Date.now()
  assert(warningMs > 8_000 && warningMs <= 9_050, `Ready gate warning was not nine seconds (${warningMs}ms)`)
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert(startsA === 1 && startsB === 1, `Start was broadcast repeatedly (${startsA}/${startsB})`)

  console.log(JSON.stringify({ status: 'pass', players: 2, kind, milestone, warningMs }, null, 2))
} finally {
  await Promise.all(rooms.map((room) => room.leave()))
  server.kill('SIGTERM')
}
