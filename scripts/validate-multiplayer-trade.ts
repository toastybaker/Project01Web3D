import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Client, type Room } from 'colyseus.js'

function once<T>(room: Room, type: string, timeoutMs = 4_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs)
    room.onMessage(type, (payload: T) => { clearTimeout(timer); resolve(payload) })
  })
}

async function waitForServer(process: ChildProcessWithoutNullStreams) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Trade server did not start')), 10_000)
    const onData = (chunk: Buffer) => {
      if (!chunk.toString().includes('Woodland multiplayer listening')) return
      clearTimeout(timer)
      process.stdout.off('data', onData)
      resolve()
    }
    process.stdout.on('data', onData)
    process.once('exit', (code) => reject(new Error(`Trade server exited early (${code})`)))
  })
}

type Opened = { tradeId: string; partnerId: string; partnerNickname: string }
type Offer = { cash: number; items: Record<string, number> }
type Update = { tradeId: string; offers: Record<string, Offer>; ready: Record<string, boolean>; error?: string; reason?: string }
type Commit = { tradeId: string; give: Offer; receive: Offer }

const port = 26_582
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), TEST_STARTING_CASH: '3000000', TEST_TRADE_FIXTURES: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
})
const rooms: Room[] = []

try {
  await waitForServer(server)
  const client = new Client(`ws://127.0.0.1:${port}`)
  const playerA = await client.joinOrCreate('woodland', { bypassLobby: true })
  const playerB = await client.joinById(playerA.roomId, { bypassLobby: true })
  rooms.push(playerA, playerB)
  const movement = { zone: 'hub', position: [0, .86, 14], cash: 3_000_000, stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: false }
  playerA.send('move', { ...movement, nickname: 'Trader A' })
  playerB.send('move', { ...movement, nickname: 'Trader B' })
  await new Promise((resolve) => setTimeout(resolve, 100))

  let forcedOpen = false
  playerB.onMessage('trade:opened', () => { forcedOpen = true })
  const request = once<{ fromId: string; fromNickname: string }>(playerB, 'trade:request')
  playerA.send('trade:request', { targetId: playerB.sessionId })
  const incoming = await request
  assert.equal(incoming.fromId, playerA.sessionId)
  assert.equal(incoming.fromNickname, 'Trader A')
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(forcedOpen, false, 'A trade request forced the recipient into the trade screen')

  const openedA = once<Opened>(playerA, 'trade:opened')
  const openedB = once<Opened>(playerB, 'trade:opened')
  playerB.send('trade:accept', { fromId: playerA.sessionId })
  const [sessionA, sessionB] = await Promise.all([openedA, openedB])
  assert.equal(sessionA.tradeId, sessionB.tradeId)

  const rejectedA = once<Update>(playerA, 'trade:update')
  playerA.send('trade:update', { tradeId: sessionA.tradeId, offer: { cash: 1_250_000, items: { apple: 2, 'home-charm': 1, 'farm-deed': 1, 'worn-pickaxe': 1 } }, ready: false })
  const rejected = await rejectedA
  assert.equal(rejected.error, 'invalid-offer', 'Server accepted protected items in a trade offer')
  assert.equal(rejected.reason, 'item-not-tradable')

  const updateA = once<Update>(playerA, 'trade:update')
  const updateB = once<Update>(playerB, 'trade:update')
  playerA.send('trade:update', { tradeId: sessionA.tradeId, offer: { cash: 1_250_000, items: { apple: 2 } }, ready: false })
  const [offerA, offerB] = await Promise.all([updateA, updateB])
  assert.deepEqual(offerA.offers[playerA.sessionId].items, { apple: 2 })
  assert.deepEqual(offerA.offers, offerB.offers, 'Players received different trade offers')
  assert.equal(offerA.offers[playerA.sessionId].cash, 1_250_000)

  const readyUpdate = once<Update>(playerB, 'trade:update')
  playerA.send('trade:update', { tradeId: sessionA.tradeId, offer: offerA.offers[playerA.sessionId], ready: true })
  await readyUpdate
  const commitA = once<Commit>(playerA, 'trade:commit')
  const commitB = once<Commit>(playerB, 'trade:commit')
  playerB.send('trade:update', { tradeId: sessionA.tradeId, offer: { cash: 200_000, items: { orange: 3 } }, ready: true })
  const [settledA, settledB] = await Promise.all([commitA, commitB])
  assert.deepEqual(settledA.give, { cash: 1_250_000, items: { apple: 2 } })
  assert.deepEqual(settledA.receive, { cash: 200_000, items: { orange: 3 } })
  assert.deepEqual(settledB.give, settledA.receive)
  assert.deepEqual(settledB.receive, settledA.give)

  console.log(JSON.stringify({ status: 'pass', requestWasNotificationOnly: true, protectedItemsRejected: ['home-charm', 'farm-deed', 'worn-pickaxe'], synchronizedOffers: true, committedAfterBothReady: true }, null, 2))
} finally {
  await Promise.allSettled(rooms.map((room) => room.leave()))
  server.kill('SIGTERM')
}
