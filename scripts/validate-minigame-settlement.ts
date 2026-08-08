import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Client, type Room } from 'colyseus.js'
import { minigameMilestones, scheduledMinigame, type MinigameKind } from '../src/game/minigame'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function message<T>(room: Room, type: string, timeoutMs = 4_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs)
    room.onMessage(type, (payload: T) => { clearTimeout(timer); resolve(payload) })
  })
}

async function waitForServer(process: ChildProcessWithoutNullStreams) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Settlement test server did not start')), 10_000)
    const onData = (chunk: Buffer) => {
      if (!chunk.toString().includes('Woodland multiplayer listening')) return
      clearTimeout(timer); process.stdout.off('data', onData); resolve()
    }
    process.stdout.on('data', onData)
    process.once('exit', (code) => reject(new Error(`Settlement test server exited early (${code})`)))
  })
}

const memory = new Map<string, string>()
const originalWarn = console.warn
console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes('onMessage() not registered')) return
  originalWarn(...args)
}
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
    clear: () => memory.clear(),
  },
  window: { location: { search: '?gate=final' } },
})

const port = 26_576
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), TEST_ALLOW_EARLY_MINIGAME: '1', TEST_ALLOW_SCORE_INJECTION: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
})
const rooms: Room[] = []

try {
  await waitForServer(server)
  const endpoint = `ws://127.0.0.1:${port}`
  const profileA = 'profile-a-1234567890'
  const profileB = 'profile-b-1234567890'
  const playerA = await new Client(endpoint).joinOrCreate('woodland', { profileId: profileA })
  const playerB = await new Client(endpoint).joinById(playerA.roomId, { profileId: profileB })
  rooms.push(playerA, playerB)
  playerA.send('lobby:ready', {})
  playerB.send('lobby:ready', {})
  playerA.send('lobby:onboarding-ready', { ready: true })
  playerB.send('lobby:onboarding-ready', { ready: true })
  await new Promise((resolve) => setTimeout(resolve, 80))

  const syncA = message<{ seed: number; durationSeconds: number }>(playerA, 'match:sync')
  const syncB = message<{ seed: number; durationSeconds: number }>(playerB, 'match:sync')
  playerA.send('lobby:start', {})
  const [matchA, matchB] = await Promise.all([syncA, syncB])
  check(matchA.seed === matchB.seed, 'Reconnect clients did not share a match seed')

  const milestone = minigameMilestones(matchA.durationSeconds)[0]
  const kind: MinigameKind = scheduledMinigame(milestone, matchA.seed, matchA.durationSeconds)
  const movement = { zone: 'hub', position: [0, .86, 14], cash: 100_000, progressValue: 100_000, stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: true, minigameKind: kind, minigameMilestone: milestone, minigameScore: 0 }
  playerA.send('move', { ...movement, nickname: 'Profile A' })
  playerB.send('move', { ...movement, nickname: 'Profile B' })
  await new Promise((resolve) => setTimeout(resolve, 160))

  const startA = message<{ gameplayAt: number }>(playerA, 'minigame:start')
  const startB = message<{ gameplayAt: number }>(playerB, 'minigame:start')
  playerA.send('minigame:ready', { milestone, kind })
  playerB.send('minigame:ready', { milestone, kind })
  const [eventA, eventB] = await Promise.all([startA, startB])
  check(eventA.gameplayAt === eventB.gameplayAt, 'Players received different event start times')
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, eventA.gameplayAt - Date.now()) + 40))

  const resultA = message<{ settlementId: string; cashReward: number; itemRolls: unknown[]; standings: Array<{ placement: number; nickname: string; score: number }> }>(playerA, 'minigame:result')
  const resultB = message<{ settlementId: string; cashReward: number; itemRolls: unknown[]; standings: Array<{ placement: number; nickname: string; score: number }> }>(playerB, 'minigame:result')
  playerA.send('minigame:finish', { milestone, score: 240, progressValue: 100_000 })
  playerB.send('minigame:finish', { milestone, score: 120, progressValue: 100_000 })
  const [rewardA, rewardB] = await Promise.all([resultA, resultB])
  check(rewardA.settlementId !== rewardB.settlementId, 'Two profiles shared one settlement key')
  check(rewardA.standings.length === 2 && rewardB.standings.length === 2, 'Results included placements for players who did not enter the event')
  check(rewardA.standings[0]?.nickname === 'Profile A' && rewardA.standings[0]?.score === 240 && rewardA.standings[1]?.nickname === 'Profile B' && rewardA.standings[1]?.score === 120, 'Results did not preserve the actual two-player ranking')

  const retry = message<typeof rewardA>(playerA, 'minigame:result')
  playerA.send('minigame:finish', { milestone, score: 999_999, progressValue: 5_000_000_000 })
  const retryResult = await retry
  check(retryResult.settlementId === rewardA.settlementId, 'Duplicate finish created a second settlement')
  check(retryResult.cashReward === rewardA.cashReward && JSON.stringify(retryResult.itemRolls) === JSON.stringify(rewardA.itemRolls), 'Duplicate finish changed the settled reward')

  await playerA.leave()
  rooms.splice(rooms.indexOf(playerA), 1)
  const reconnect = await new Client(endpoint).joinById(playerB.roomId, { profileId: profileA })
  rooms.push(reconnect)
  const replayed: typeof rewardA[] = []
  reconnect.onMessage('minigame:result', (payload: typeof rewardA) => replayed.push(payload))
  reconnect.send('lobby:ready', {})
  reconnect.send('minigame:result:request', {})
  await new Promise((resolve) => setTimeout(resolve, 300))
  check(replayed.length >= 1, 'Reconnect did not receive the pending settlement')
  check(replayed.every((entry) => entry.settlementId === rewardA.settlementId && entry.cashReward === rewardA.cashReward && JSON.stringify(entry.itemRolls) === JSON.stringify(rewardA.itemRolls)), 'Reconnect replay changed the reward')

  const { useGameStore } = await import('../src/game/store')
  useGameStore.setState({ cash: 100, inventory: {}, minigameOpen: false, minigameSnapshot: null, appliedMinigameRewardIds: [], appliedMinigameSettlementIds: [] })
  const reward = { settlementId: rewardA.settlementId, cash: 50, itemRolls: [{ rewardId: `${rewardA.settlementId}:roll`, items: [{ itemId: 'cookbook-box', quantity: 1 }] }] }
  useGameStore.getState().finishMinigame(20, 1, 100, reward)
  useGameStore.getState().finishMinigame(999, 1, 999, reward)
  check(useGameStore.getState().cash === 150, 'Client applied settlement cash more than once')
  check(useGameStore.getState().inventory['cookbook-box'] === 1, 'Client applied settlement items more than once')
  check(useGameStore.getState().hotbar.includes('cookbook-box'), 'Client settlement reward skipped the hotbar row')
  check(useGameStore.getState().appliedMinigameSettlementIds.length === 1, 'Client settlement ledger did not stay idempotent')

  console.log(JSON.stringify({ status: 'pass', sameMatch: true, twoPlayerRankingOnly: true, duplicateFinishStable: true, reconnectReplay: true, clientCashAndItemsExactlyOnce: true }, null, 2))
} finally {
  await Promise.allSettled(rooms.map((room) => room.leave()))
  server.kill('SIGTERM')
}
