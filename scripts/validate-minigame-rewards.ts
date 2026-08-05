import assert from 'node:assert/strict'
import {
  MINIGAME_CASH_PRIZES,
  applyMinigameItemRewards,
  minigameBaseCash,
  minigameCashReward,
  minigameCatchUpCash,
  minigameEconomyStage,
  minigameItemRewards,
  minigameRewardPackage,
  minigameRewards,
  rollMinigameItemReward,
  type MinigameRewardItemId,
  type MinigameRewardKey,
  type MinigameRewardTier,
} from '../src/game/minigame'

const expectedCash = [
  [1_500_000, 900_000, 550_000, 300_000, 250_000, 200_000, 150_000, 100_000],
  [5_000_000, 3_250_000, 2_000_000, 1_250_000, 1_000_000, 750_000, 500_000, 375_000],
  [10_000_000, 6_500_000, 4_000_000, 2_500_000, 2_000_000, 1_500_000, 1_000_000, 750_000],
] as const

for (const [rowIndex, progress] of [10_000_000, 50_000_000, 100_000_000].entries()) {
  expectedCash[rowIndex].forEach((cash, index) => assert.equal(minigameBaseCash(progress, index + 1), cash))
}
assert.equal(minigameBaseCash(0, 1), 1_500_000)
assert.equal(minigameBaseCash(Number.NaN, 8), 100_000)
assert.equal(minigameBaseCash(100_000_000_000, 1), 10_000_000)
assert.equal(minigameBaseCash(50_000_000, 0), 0)
assert.equal(minigameBaseCash(50_000_000, 9), 0)

const catchUpBase = 5_000_000
assert.equal(minigameCatchUpCash(catchUpBase, 65, 100), 125_000)
assert.equal(minigameCatchUpCash(catchUpBase, 50, 100), 500_000)
assert.equal(minigameCatchUpCash(catchUpBase, 30, 100), 1_000_000)
assert.equal(minigameCatchUpCash(10_000_000, 0, 100), 1_000_000)
assert.equal(minigameCatchUpCash(catchUpBase, 70, 100), 0)
assert.equal(minigameCatchUpCash(catchUpBase, 1, 0), 0)

for (let sample = 0; sample < 100_000; sample += 1) {
  const progress = (sample * 104_729) % 150_000_001
  const ratio = (sample % 101) / 100
  const rewards = MINIGAME_CASH_PRIZES.map((_, index) => minigameCashReward(progress, index + 1, ratio * 100, 100))
  for (let index = 1; index < rewards.length; index += 1) {
    assert.ok(rewards[index - 1] > rewards[index], `cash ordering failed at ${progress}, rank ${index + 1}`)
  }
  const firstWithoutCatchUp = minigameCashReward(progress, 1, 100, 100)
  for (let placement = 2; placement <= 8; placement += 1) {
    assert.ok(firstWithoutCatchUp > minigameCashReward(progress, placement, 0, 100), `first place lost ordering at ${progress}, rank ${placement}`)
  }
}

assert.equal(minigameEconomyStage(24_999_999), 'early')
assert.equal(minigameEconomyStage(25_000_000), 'middle')
assert.equal(minigameEconomyStage(70_000_000), 'middle')
assert.equal(minigameEconomyStage(70_000_001), 'late')

const allowedIds = new Set<MinigameRewardItemId>([
  'mining-boost',
  'fortune-boost',
  'cook-timer',
  'rain-bottle',
  'upgrade-coupon',
  'upgrade-guard-4',
  'upgrade-guard-5',
  'upgrade-guard-6',
  'cookbook-box',
])

const poolExpectations: Record<MinigameRewardTier, Record<string, number>> = {
  common: { 'mining-boost': .22, 'fortune-boost': .22, 'cook-timer': .18, 'rain-bottle': .14, 'upgrade-coupon': .12, 'upgrade-guard-4': .07, 'cookbook-box': .05 },
  major: { 'cookbook-box-2': .25, 'upgrade-guard-5': .20, 'fortune-boost-2': .20, 'upgrade-coupon-2': .15, 'mining-and-cook': .20 },
  rare: { 'upgrade-guard-6': .15, 'cookbook-box-3': .20, 'guard-5-and-fortune': .20, 'coupon-2-and-fortune': .20, 'common-3': .25 },
}

const rollCount = 100_000
for (const tier of ['common', 'major', 'rare'] as const) {
  const counts: Record<string, number> = {}
  for (let index = 0; index < rollCount; index += 1) {
    const key: MinigameRewardKey = { matchSeed: `match-${index % 997}`, milestone: 1200 + index, playerId: `player-${index}`, placement: index % 8 + 1, rewardSlot: `${tier}-${index}` }
    const roll = rollMinigameItemReward(tier, key)
    counts[roll.outcomeId] = (counts[roll.outcomeId] ?? 0) + 1
    assert.ok(roll.items.length > 0)
    assert.ok(roll.items.every((item) => allowedIds.has(item.itemId) && Number.isInteger(item.quantity) && item.quantity > 0))
    assert.deepEqual(rollMinigameItemReward(tier, key), roll, `${tier} roll is not deterministic`)
  }
  for (const [outcome, probability] of Object.entries(poolExpectations[tier])) {
    const actual = (counts[outcome] ?? 0) / rollCount
    assert.ok(Math.abs(actual - probability) < .006, `${tier}/${outcome}: ${actual} != ${probability}`)
  }
}

const deterministicInput = {
  economyReference: 80_000_000,
  placement: 1,
  playerProgress: 30_000_000,
  leaderProgress: 100_000_000,
  matchSeed: 'idempotent-match',
  milestone: 2400,
  playerId: 'player-7',
}
const deterministicResult = minigameRewards(deterministicInput)
assert.deepEqual(minigameRewards(deterministicInput), deterministicResult)
assert.equal(deterministicResult.baseCash, 8_000_000)
assert.equal(deterministicResult.catchUpCash, 1_000_000)
assert.equal(deterministicResult.cash, 9_000_000)
assert.deepEqual(deterministicResult.itemRolls.map((roll) => roll.tier), ['rare', 'common'])
assert.equal(new Set(deterministicResult.itemRolls.map((roll) => roll.rewardId)).size, deterministicResult.itemRolls.length)

const once = applyMinigameItemRewards({}, [], deterministicResult.itemRolls)
const twice = applyMinigameItemRewards(once.inventory, once.appliedRewardIds, deterministicResult.itemRolls)
assert.deepEqual(twice.inventory, once.inventory)
assert.deepEqual(twice.appliedRewardIds, once.appliedRewardIds)
assert.deepEqual(twice.newlyAppliedRewardIds, [])

const changedKeys = [
  { ...deterministicInput, matchSeed: 'another-match' },
  { ...deterministicInput, milestone: deterministicInput.milestone + 1 },
  { ...deterministicInput, playerId: 'player-8' },
  { ...deterministicInput, placement: 2 },
]
for (const changed of changedKeys) {
  const changedRolls = minigameItemRewards(changed)
  assert.notDeepEqual(changedRolls.map((roll) => roll.rewardId), deterministicResult.itemRolls.map((roll) => roll.rewardId))
}

const leaving = minigameRewards({ ...deterministicInput, placement: 0, left: true })
assert.deepEqual(leaving, { baseCash: 0, catchUpCash: 0, cash: 0, itemRolls: [] })
assert.deepEqual(minigameRewardPackage(50_000_000, 0), { budget: 0, boxes: 0, cash: 0 })

for (const progress of [10_000_000, 50_000_000, 100_000_000]) {
  for (let placement = 1; placement <= 8; placement += 1) {
    const cashBeforeItems = minigameCashReward(progress, placement, 30, 100)
    const itemRolls = minigameItemRewards({ economyReference: progress, placement, matchSeed: 73, milestone: 1200, playerId: `p-${placement}` })
    assert.equal(minigameCashReward(progress, placement, 30, 100), cashBeforeItems, 'item prizes reduced cash')
    assert.ok(itemRolls.every((roll) => roll.items.every((item) => allowedIds.has(item.itemId))))
  }
}

function chanceRate(economyReference: number, placement: number) {
  let awards = 0
  for (let index = 0; index < rollCount; index += 1) {
    awards += Number(minigameItemRewards({ economyReference, placement, matchSeed: index, milestone: 1200, playerId: `gate-${index}` }).length > 0)
  }
  return awards / rollCount
}

for (const [progress, placement, expected] of [
  [10_000_000, 4, .35],
  [10_000_000, 7, .15],
  [50_000_000, 7, .35],
  [100_000_000, 7, .50],
] as const) {
  const actual = chanceRate(progress, placement)
  assert.ok(Math.abs(actual - expected) < .006, `package gate ${progress}/${placement}: ${actual} != ${expected}`)
}

console.log(JSON.stringify({
  cashOrderingSamples: 100_000,
  rewardRolls: rollCount * 3,
  packageGateRolls: rollCount * 4,
  itemIds: [...allowedIds],
  deterministicRewardIds: deterministicResult.itemRolls.map((roll) => roll.rewardId),
  status: 'passed',
}, null, 2))
