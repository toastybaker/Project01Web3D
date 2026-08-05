import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Client, type Room } from 'colyseus.js'

type Presence = {
  id: string
  position: [number, number, number]
  yaw: number
  animation: string
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
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

const port = 26_576
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ['pipe', 'pipe', 'pipe'],
})
const rooms: Room[] = []

try {
  await waitForServer(server)
  const endpoint = `ws://127.0.0.1:${port}`
  const sender = await new Client(endpoint).joinOrCreate('woodland', { bypassLobby: true })
  const observer = await new Client(endpoint).joinById(sender.roomId, { bypassLobby: true })
  rooms.push(sender, observer)

  const sprinting = messageWhere<Presence>(observer, 'presence:move', (presence) => presence.id === sender.sessionId && presence.position[0] === 8)
  sender.send('move', {
    zone: 'hub', position: [8, 0.86, -6], yaw: 1.2, animation: 'Armature|Sprint_Loop',
    nickname: 'Runner', cash: 100_000, progressValue: 100_000,
    stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: false,
  })
  const sprintPresence = await sprinting
  assert(Math.abs(sprintPresence.yaw - 1.2) < 0.001, 'Remote facing yaw was not replicated')
  assert(sprintPresence.animation === 'Armature|Sprint_Loop', 'Remote sprint animation was not replicated')

  const sanitized = messageWhere<Presence>(observer, 'presence:move', (presence) => presence.id === sender.sessionId && presence.position[0] === 9)
  sender.send('move', {
    zone: 'hub', position: [9, 0.86, -6], yaw: 20, animation: 'not-a-real-animation',
    nickname: 'Runner', cash: 100_000, progressValue: 100_000,
    stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: false,
  })
  const sanitizedPresence = await sanitized
  assert(sanitizedPresence.yaw >= -Math.PI && sanitizedPresence.yaw <= Math.PI, 'Remote yaw was not normalized')
  assert(sanitizedPresence.animation === 'Armature|Sprint_Loop', 'Invalid animation replaced the last valid animation')

  const jumping = messageWhere<Presence>(observer, 'presence:move', (presence) => presence.id === sender.sessionId && presence.position[0] === 10)
  sender.send('move', {
    zone: 'hub', position: [10, 1.8, -6], yaw: 1.2, animation: 'Armature|Jump_Loop',
    nickname: 'Runner', cash: 100_000, progressValue: 100_000,
    stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: false,
  })
  const jumpPresence = await jumping
  assert(jumpPresence.animation === 'Armature|Jump_Loop', 'Remote jump animation was not replicated')

  console.log(JSON.stringify({ status: 'pass', sameRoom: true, yawReplicated: true, sprintReplicated: true, jumpReplicated: true, invalidAnimationRejected: true }, null, 2))
} finally {
  await Promise.allSettled(rooms.map((room) => room.leave()))
  server.kill('SIGTERM')
}
