import assert from 'node:assert/strict'
import {
  DEFAULT_MATCH_DURATION_MS,
  MERCHANT_CYCLE_MS,
  MERCHANT_ITEMS,
  MERCHANT_ITEM_IDS,
  MERCHANT_MAX_SLOTS,
  consumeMerchantStock,
  currentMerchantCycle,
  isMerchantItemEligible,
  merchantCycleIdentity,
  merchantItemRoll,
  merchantPrice,
  merchantSchedule,
  merchantStage,
  type MerchantItemId,
} from '../src/game/merchant'

const expectedNames: Record<MerchantItemId, string> = {
  'mining-boost': 'Mining Tonic',
  'fortune-boost': 'Luck Tonic',
  'cook-timer': 'Cook Timer',
  'rain-bottle': 'Rain Bottle',
  'upgrade-coupon': 'Forge Coupon',
  'cookbook-box': 'Cookbook Box',
  'upgrade-guard-4': '+4 Ward',
  'upgrade-guard-5': '+5 Ward',
  'upgrade-guard-6': '+6 Ward',
}

assert.deepEqual(new Set(MERCHANT_ITEM_IDS), new Set(Object.keys(expectedNames)), 'merchant item IDs drifted')
for (const id of MERCHANT_ITEM_IDS) {
  const definition = MERCHANT_ITEMS[id]
  assert.equal(definition.name, expectedNames[id])
  assert(definition.appearanceChance > 0 && definition.appearanceChance < 1)
  assert(Number.isSafeInteger(definition.globalStock) && definition.globalStock > 0)
}

assert.equal(merchantStage(0, DEFAULT_MATCH_DURATION_MS), 'first')
assert.equal(merchantStage(DEFAULT_MATCH_DURATION_MS / 3, DEFAULT_MATCH_DURATION_MS), 'middle')
assert.equal(merchantStage(DEFAULT_MATCH_DURATION_MS * 2 / 3, DEFAULT_MATCH_DURATION_MS), 'final')
assert.equal(merchantPrice('cook-timer', 'first'), 330_000)
assert.equal(merchantPrice('cook-timer', 'middle'), 410_000)
assert.equal(merchantPrice('cook-timer', 'final'), 490_000)
assert.equal(merchantPrice('upgrade-guard-6', 'middle'), 2_500_000)
assert.equal(merchantPrice('upgrade-guard-6', 'final'), 3_000_000)

const eligibilityThresholds: Partial<Record<MerchantItemId, number>> = {
  'upgrade-coupon': .25,
  'upgrade-guard-4': .15,
  'upgrade-guard-5': .33,
  'upgrade-guard-6': .60,
}
for (const [id, progress] of Object.entries(eligibilityThresholds) as Array<[MerchantItemId, number]>) {
  const thresholdMs = DEFAULT_MATCH_DURATION_MS * progress
  assert.equal(isMerchantItemEligible(id, thresholdMs - 1, DEFAULT_MATCH_DURATION_MS), false, `${id} unlocked early`)
  assert.equal(isMerchantItemEligible(id, thresholdMs, DEFAULT_MATCH_DURATION_MS), true, `${id} did not unlock at its threshold`)
}

assert.equal(merchantCycleIdentity(77.9, 1_234.9, 2), 'merchant:77:1234:2')
assert.equal(merchantItemRoll(77, 3, 'mining-boost'), merchantItemRoll(77, 3, 'mining-boost'), 'item roll is not deterministic')
assert.notEqual(merchantItemRoll(77, 3, 'mining-boost'), merchantItemRoll(77, 3, 'fortune-boost'), 'item roll domains collided')

const sampleOptions = { matchSeed: 77, matchStartedAtMs: 1_000_000, matchDurationMs: DEFAULT_MATCH_DURATION_MS }
const sample = merchantSchedule(sampleOptions)
assert.equal(sample.length, 15)
assert.equal(currentMerchantCycle(sampleOptions, sampleOptions.matchStartedAtMs - 1), null)
assert.equal(currentMerchantCycle(sampleOptions, sampleOptions.matchStartedAtMs + DEFAULT_MATCH_DURATION_MS), null)
for (const cycle of sample) {
  assert.equal(currentMerchantCycle(sampleOptions, cycle.startsAtMs)?.id, cycle.id)
  assert.equal(cycle.startsAtMs, sampleOptions.matchStartedAtMs + cycle.index * MERCHANT_CYCLE_MS)
  assert.equal(cycle.endsAtMs, Math.min(sampleOptions.matchStartedAtMs + DEFAULT_MATCH_DURATION_MS, cycle.startsAtMs + MERCHANT_CYCLE_MS))
}

const sampleItem = sample.flatMap((cycle) => cycle.inventory.map((entry) => ({ cycle, entry })))[0]
assert(sampleItem, 'sample schedule did not contain inventory')
const originalStock = sampleItem.entry.stock
const purchase = consumeMerchantStock(sampleItem.cycle, sampleItem.entry.id)
assert.equal(purchase.ok, true)
if (purchase.ok) {
  assert.equal(purchase.remainingStock, originalStock - 1)
  assert.equal(sampleItem.entry.stock, originalStock, 'stock reducer mutated the source snapshot')
  let sold = purchase.cycle
  for (let count = 1; count < originalStock; count += 1) {
    const next = consumeMerchantStock(sold, sampleItem.entry.id)
    assert.equal(next.ok, true)
    if (next.ok) sold = next.cycle
  }
  const soldOut = consumeMerchantStock(sold, sampleItem.entry.id)
  assert.deepEqual(soldOut.ok ? null : soldOut.reason, 'sold-out')
}

const guardThresholdMinutes: Record<'upgrade-guard-4' | 'upgrade-guard-5' | 'upgrade-guard-6', number> = {
  'upgrade-guard-4': 9,
  'upgrade-guard-5': 19.8,
  'upgrade-guard-6': 36,
}
const firstEligibleCycleMinutes: Record<keyof typeof guardThresholdMinutes, number> = {
  'upgrade-guard-4': 12,
  'upgrade-guard-5': 20,
  'upgrade-guard-6': 36,
}
const guardMatchAppearances: Record<keyof typeof guardThresholdMinutes, number> = {
  'upgrade-guard-4': 0,
  'upgrade-guard-5': 0,
  'upgrade-guard-6': 0,
}
const rawPassCounts = Object.fromEntries(MERCHANT_ITEM_IDS.map((id) => [id, 0])) as Record<MerchantItemId, number>
const eligibleRollCounts = Object.fromEntries(MERCHANT_ITEM_IDS.map((id) => [id, 0])) as Record<MerchantItemId, number>

const scheduleCount = 10_000
let simulatedCycles = 0
for (let seed = 0; seed < scheduleCount; seed += 1) {
  const options = { matchSeed: seed, matchStartedAtMs: 0, matchDurationMs: DEFAULT_MATCH_DURATION_MS }
  const first = merchantSchedule(options)
  const second = merchantSchedule(options)
  assert.deepEqual(second, first, `seed ${seed} produced a nondeterministic schedule`)
  assert.equal(first.length, 15, `seed ${seed} did not cover the full hour`)
  const appearedThisMatch = new Set<MerchantItemId>()

  for (const cycle of first) {
    simulatedCycles += 1
    assert(cycle.inventory.length > 0, `seed ${seed}, cycle ${cycle.index} was empty`)
    assert(cycle.inventory.length <= MERCHANT_MAX_SLOTS, `seed ${seed}, cycle ${cycle.index} exceeded the slot cap`)
    assert.equal(new Set(cycle.inventory.map((entry) => entry.id)).size, cycle.inventory.length, 'duplicate item in one inventory')
    const elapsedMs = cycle.index * MERCHANT_CYCLE_MS

    for (const id of MERCHANT_ITEM_IDS) {
      if (!isMerchantItemEligible(id, elapsedMs, DEFAULT_MATCH_DURATION_MS)) continue
      eligibleRollCounts[id] += 1
      if (merchantItemRoll(seed, cycle.index, id) < MERCHANT_ITEMS[id].appearanceChance) rawPassCounts[id] += 1
    }

    for (const entry of cycle.inventory) {
      appearedThisMatch.add(entry.id)
      assert.equal(isMerchantItemEligible(entry.id, elapsedMs, DEFAULT_MATCH_DURATION_MS), true, `${entry.id} appeared before eligibility`)
      assert.equal(entry.stock, MERCHANT_ITEMS[entry.id].globalStock, `${entry.id} stock drifted`)
      assert.equal(entry.maxStock, MERCHANT_ITEMS[entry.id].globalStock, `${entry.id} maximum stock drifted`)
      assert.equal(entry.price, merchantPrice(entry.id, cycle.stage), `${entry.id} price drifted`)
      if (entry.id in guardThresholdMinutes) {
        const guardId = entry.id as keyof typeof guardThresholdMinutes
        const minute = elapsedMs / 60_000
        assert(minute >= guardThresholdMinutes[guardId], `${guardId} appeared at minute ${minute}`)
        assert(minute >= firstEligibleCycleMinutes[guardId], `${guardId} appeared before its first eligible restock`)
      }
    }
  }

  for (const id of Object.keys(guardMatchAppearances) as Array<keyof typeof guardMatchAppearances>) {
    if (appearedThisMatch.has(id)) guardMatchAppearances[id] += 1
  }
}

for (const id of MERCHANT_ITEM_IDS) {
  const observed = rawPassCounts[id] / eligibleRollCounts[id]
  assert(Math.abs(observed - MERCHANT_ITEMS[id].appearanceChance) < .006, `${id} raw roll rate ${observed} drifted from ${MERCHANT_ITEMS[id].appearanceChance}`)
}
assert(guardMatchAppearances['upgrade-guard-6'] > 0, '+6 Guard never appeared across the simulations')
assert(guardMatchAppearances['upgrade-guard-6'] < scheduleCount, '+6 Guard appeared in every simulated match')

console.log(JSON.stringify({
  schedules: scheduleCount,
  cycles: simulatedCycles,
  inventories: 'all nonempty and capped at four',
  firstEligibleCycleMinutes,
  guardMatchAppearances,
  rawAppearanceRates: Object.fromEntries(MERCHANT_ITEM_IDS.map((id) => [id, Number((rawPassCounts[id] / eligibleRollCounts[id]).toFixed(4))])),
  status: 'passed',
}, null, 2))
