import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Client, type Room } from 'colyseus.js'
import { minigameMilestones, scheduledMinigame } from '../src/game/minigame'

function messageWhere<T>(room: Room, type: string, predicate: (payload: T) => boolean, timeoutMs = 5_000) {
  return new Promise<T>((resolve, reject) => {
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
    const timer = setTimeout(() => reject(new Error('Forage Rush server did not start')), 10_000)
    const onData = (chunk: Buffer) => {
      if (!chunk.toString().includes('Woodland multiplayer listening')) return
      clearTimeout(timer)
      process.stdout.off('data', onData)
      resolve()
    }
    process.stdout.on('data', onData)
    process.once('exit', (code) => reject(new Error(`Forage Rush server exited early (${code})`)))
  })
}

type MatchSync = { seed: number; durationSeconds: number }
type ForageState = { id: string; readyAt: number }
type ForageAward = { id: string; readyAt: number }
type RareSnapshot = { milestone: number; ids: string[] }
type Result = { placement: number; score: number; standings: Array<{ placement: number; nickname: string; score: number }> }

const port = 26_581
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), TEST_ALLOW_EARLY_MINIGAME: '1', TEST_FORAGE_RUSH_RARE_RESPAWN_MS: '180' },
  stdio: ['pipe', 'pipe', 'pipe'],
})
const rooms: Room[] = []

try {
  await waitForServer(server)
  const endpoint = `ws://127.0.0.1:${port}`
  const playerA = await new Client(endpoint).joinOrCreate('woodland', { profileId: 'forage-rush-player-a' })
  const playerB = await new Client(endpoint).joinById(playerA.roomId, { profileId: 'forage-rush-player-b' })
  rooms.push(playerA, playerB)
  playerA.send('lobby:ready', {})
  playerB.send('lobby:ready', {})
  playerA.send('lobby:onboarding-ready', { ready: true })
  playerB.send('lobby:onboarding-ready', { ready: true })
  playerA.send('lobby:update', { durationSeconds: 180 * 60 })
  await new Promise((resolve) => setTimeout(resolve, 100))

  const syncA = messageWhere<MatchSync>(playerA, 'match:sync', () => true)
  const syncB = messageWhere<MatchSync>(playerB, 'match:sync', () => true)
  playerA.send('lobby:start', {})
  const [matchA, matchB] = await Promise.all([syncA, syncB])
  assert.equal(matchA.seed, matchB.seed)
  const milestone = minigameMilestones(matchA.durationSeconds).find((candidate) => scheduledMinigame(candidate, matchA.seed, matchA.durationSeconds) === 'forage')
  assert(milestone, 'The long-match event schedule did not include Forage Rush')

  const baseMove = { zone: 'hub', position: [0, .86, 14], cash: 100_000, progressValue: 100_000, stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: true, minigameKind: 'forage', minigameMilestone: milestone }
  playerA.send('move', { ...baseMove, nickname: 'Runner A', minigameScore: 0 })
  playerB.send('move', { ...baseMove, nickname: 'Runner B', minigameScore: 420 })
  await new Promise((resolve) => setTimeout(resolve, 120))

  const rareUpdatesA: string[][] = []
  const rareUpdatesB: string[][] = []
  playerA.onMessage('minigame:forage-rares', (payload: RareSnapshot) => { if (payload.milestone === milestone) rareUpdatesA.push([...payload.ids].sort()) })
  playerB.onMessage('minigame:forage-rares', (payload: RareSnapshot) => { if (payload.milestone === milestone) rareUpdatesB.push([...payload.ids].sort()) })
  const initialRaresA = messageWhere<RareSnapshot>(playerA, 'minigame:forage-rares', (payload) => payload.milestone === milestone && payload.ids.length > 0)
  const initialRaresB = messageWhere<RareSnapshot>(playerB, 'minigame:forage-rares', (payload) => payload.milestone === milestone && payload.ids.length > 0)
  const startA = messageWhere<{ gameplayAt: number }>(playerA, 'minigame:start', () => true)
  const startB = messageWhere<{ gameplayAt: number }>(playerB, 'minigame:start', () => true)
  playerA.send('minigame:ready', { milestone, kind: 'forage' })
  playerB.send('minigame:ready', { milestone, kind: 'forage' })
  const [eventA, eventB, firstRaresA, firstRaresB] = await Promise.all([startA, startB, initialRaresA, initialRaresB])
  assert.equal(eventA.gameplayAt, eventB.gameplayAt, 'Players received different Forage Rush start clocks')
  const initialRareIds = [...firstRaresA.ids].sort()
  assert.deepEqual(initialRareIds, [...firstRaresB.ids].sort(), 'Players received different initial rare locations')
  assert.equal(initialRareIds.filter((id) => id.startsWith('ForageRushTruffle')).length, 3, 'Two-player race did not begin with three shared truffle opportunities')
  assert.equal(initialRareIds.filter((id) => id.startsWith('ForageRushDiscovery')).length, 1, 'Two-player race did not begin with one shared discovery opportunity')
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, eventA.gameplayAt - Date.now()) + 35))

  const stableUpdateCountA = rareUpdatesA.length
  const stableUpdateCountB = rareUpdatesB.length
  await new Promise((resolve) => setTimeout(resolve, 260))
  assert(rareUpdatesA.slice(stableUpdateCountA).every((ids) => JSON.stringify(ids) === JSON.stringify(initialRareIds)), 'An uncollected rare disappeared for player A on a timer')
  assert(rareUpdatesB.slice(stableUpdateCountB).every((ids) => JSON.stringify(ids) === JSON.stringify(initialRareIds)), 'An uncollected rare disappeared for player B on a timer')

  const rareTarget = initialRareIds.find((id) => id.startsWith('ForageRushTruffle'))
  assert(rareTarget, 'No truffle was available to validate the shared respawn lifecycle')
  let rareAwardCount = 0
  playerA.onMessage('minigame:forage-award', (payload: ForageAward) => { if (payload.id === rareTarget) rareAwardCount += 1 })
  playerB.onMessage('minigame:forage-award', (payload: ForageAward) => { if (payload.id === rareTarget) rareAwardCount += 1 })
  const removedRareA = messageWhere<RareSnapshot>(playerA, 'minigame:forage-rares', (payload) => payload.milestone === milestone && !payload.ids.includes(rareTarget))
  const removedRareB = messageWhere<RareSnapshot>(playerB, 'minigame:forage-rares', (payload) => payload.milestone === milestone && !payload.ids.includes(rareTarget))
  const replacementRareA = messageWhere<RareSnapshot>(playerA, 'minigame:forage-rares', (payload) => payload.milestone === milestone && payload.ids.length === initialRareIds.length && !payload.ids.includes(rareTarget))
  const replacementRareB = messageWhere<RareSnapshot>(playerB, 'minigame:forage-rares', (payload) => payload.milestone === milestone && payload.ids.length === initialRareIds.length && !payload.ids.includes(rareTarget))
  playerA.send('minigame:forage:request', { milestone, id: rareTarget })
  playerB.send('minigame:forage:request', { milestone, id: rareTarget })
  const [removedA, removedB] = await Promise.all([removedRareA, removedRareB])
  assert.deepEqual([...removedA.ids].sort(), [...removedB.ids].sort(), 'The collected rare did not disappear for both players together')
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(rareAwardCount, 1, 'Two simultaneous players received the same shared rare find')
  const [replacementA, replacementB] = await Promise.all([replacementRareA, replacementRareB])
  assert.deepEqual([...replacementA.ids].sort(), [...replacementB.ids].sort(), 'Players received different replacement rare locations')
  for (const id of initialRareIds.filter((candidate) => candidate !== rareTarget)) assert(replacementA.ids.includes(id), `Uncollected rare ${id} disappeared during another site's respawn`)
  const replacementId = replacementA.ids.find((id) => !initialRareIds.includes(id))
  assert(replacementId, 'Collected truffle did not reroll into a new designated location')

  const targetId = 'ForageRushApple000'
  let awardCount = 0
  playerA.onMessage('minigame:forage-award', (payload: ForageAward) => { if (payload.id === targetId) awardCount += 1 })
  playerB.onMessage('minigame:forage-award', (payload: ForageAward) => { if (payload.id === targetId) awardCount += 1 })
  const depletedA = messageWhere<ForageState>(playerA, 'minigame:forage', (payload) => payload.id === targetId)
  const depletedB = messageWhere<ForageState>(playerB, 'minigame:forage', (payload) => payload.id === targetId)
  playerA.send('minigame:forage:request', { milestone, id: targetId })
  playerB.send('minigame:forage:request', { milestone, id: targetId })
  const [stateA, stateB] = await Promise.all([depletedA, depletedB])
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(awardCount, 1, 'Two simultaneous players received the same shared fruit site')
  assert.equal(stateA.readyAt, stateB.readyAt, 'Players received different shared Forage Rush cooldowns')

  const resultA = messageWhere<Result>(playerA, 'minigame:result', () => true)
  const resultB = messageWhere<Result>(playerB, 'minigame:result', () => true)
  const finishedAt = Date.now()
  playerA.send('minigame:finish', { milestone, score: 10_000, progressValue: 100_000 })
  playerB.send('minigame:finish', { milestone, score: 420, progressValue: 100_000 })
  const [settledA, settledB] = await Promise.all([resultA, resultB])
  assert(Date.now() - finishedAt < 3_500, 'Finished players did not settle promptly')
  assert.equal(settledA.standings.length, 2, 'Result screen included nonexistent placements')
  assert.deepEqual(settledA.standings, settledB.standings, 'Players received different final rankings')
  assert.equal(settledA.standings[0]?.nickname, 'Runner A')
  assert.equal(settledA.standings[0]?.score, 0, 'Settlement trusted forged client score')
  assert.equal(settledA.standings[1]?.nickname, 'Runner B')
  assert.equal(settledA.standings[1]?.score, 0, 'Settlement trusted forged client score')

  console.log(JSON.stringify({ status: 'pass', sharedFruitAwardCount: awardCount, sharedRareAwardCount: rareAwardCount, replacementRareId: replacementId, identicalCooldown: true, earlyFinishMs: Date.now() - finishedAt, standings: settledA.standings }, null, 2))
} finally {
  await Promise.allSettled(rooms.map((room) => room.leave()))
  server.kill('SIGTERM')
}
