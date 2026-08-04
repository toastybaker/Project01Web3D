import assert from 'node:assert/strict'
import { BASKET_CONFIG, PICKAXE_CONFIG } from '../src/game/config'
import { itemTooltip, type ItemId } from '../src/game/items'
import { canMineOre, miningDuration } from '../src/game/ore'
import {
  ENHANCEABLE_ITEMS,
  ENHANCEMENT_FORTUNE,
  basketCapacityBonus,
  enhancedBasketCapacity,
  enhancedYield,
  enhancementChance,
  enhancementCoinCost,
  enhancementLevel,
  enhancementName,
  enhancementRequirements,
  expectedFortune,
  fortuneFor,
  isEnhanceableItem,
  miningSpeedBonus,
  resolveEnhancementAttempt,
  type EnhanceableItem,
  type EnhancementLevels,
} from '../src/game/enhancement'

const close = (actual: number, expected: number, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
const fullInventory = (item: EnhanceableItem, target: number, stabilized = false) => {
  const inventory: Partial<Record<ItemId, number>> = { [item]: 1 }
  Object.keys(enhancementRequirements(item, target, stabilized).materials).forEach((id) => { inventory[id as ItemId] = 999 })
  return inventory
}

for (const item of ENHANCEABLE_ITEMS) {
  for (let level = 0; level <= 10; level += 1) {
    const row = fortuneFor(item, level)
    close(row.reduce((sum, entry) => sum + entry.chance, 0), 1)
    close(expectedFortune(item, level), row.reduce((sum, entry) => sum + entry.chance * (entry.bonus + 1), 0))
    assert.ok(Number.isInteger(enhancedYield(item, level, .371)))
  }
  assert.ok(expectedFortune(item, 6) >= expectedFortune(item, 0) * 1.25, `${item} +6 is not tangible`)
  const baseMaximum = item === 'harvest-charm' ? 3
    : item in PICKAXE_CONFIG ? Math.max(...PICKAXE_CONFIG[item as keyof typeof PICKAXE_CONFIG].fortune.map((entry) => entry.bonus + 1))
      : Math.max(...BASKET_CONFIG[item as keyof typeof BASKET_CONFIG].fortune.map((entry) => entry.bonus + 1))
  assert.ok(Math.max(...fortuneFor(item, 10).map((entry) => entry.bonus + 1)) <= baseMaximum)
}

for (const item of Object.keys(PICKAXE_CONFIG) as Array<keyof typeof PICKAXE_CONFIG>) {
  assert.deepEqual(fortuneFor(item, 0), PICKAXE_CONFIG[item].fortune)
}
for (const item of ['basket', 'reinforced-basket', 'master-basket'] as const) {
  assert.deepEqual(fortuneFor(item, 0), BASKET_CONFIG[item].fortune)
}

assert.equal(enhancedBasketCapacity('master-basket', 6), Math.floor(BASKET_CONFIG['master-basket'].capacity * 1.13))
assert.equal(basketCapacityBonus(10), .40)
assert.equal(miningSpeedBonus(10), .20)
assert.equal(canMineOre('worn-pickaxe', 'gold-ore'), false)
assert.equal(canMineOre('crystal-pickaxe', 'ancient-ore'), true)
assert.ok(miningDuration('worn-pickaxe', 'copper-ore', 10) < miningDuration('worn-pickaxe', 'copper-ore', 0))

const successInventory = fullInventory('iron-pickaxe', 1)
const success = resolveEnhancementAttempt('iron-pickaxe', 0, 1_000_000, successInventory, false, 0)
assert.equal(success.ok, true)
assert.equal(success.success, true)
assert.equal(success.level, 1)
assert.equal(success.cash, 1_000_000 - enhancementCoinCost(1))
assert.equal(success.inventory['copper-ore'], 993)

const softFailureInventory = fullInventory('iron-pickaxe', 2)
const softFailure = resolveEnhancementAttempt('iron-pickaxe', 1, 1_000_000, softFailureInventory, false, 1)
assert.equal(softFailure.success, false)
assert.equal(softFailure.level, 1)
assert.equal(softFailure.inventory['copper-ore'], 989)
assert.equal(softFailure.inventory['iron-ore'], 997)

const downgradeInventory = fullInventory('steel-pickaxe', 4)
const downgrade = resolveEnhancementAttempt('steel-pickaxe', 3, 2_000_000, downgradeInventory, false, 1)
assert.equal(downgrade.success, false)
assert.equal(downgrade.level, 2)
assert.equal(downgrade.cash, 2_000_000 - enhancementCoinCost(4))

const stabilizedInventory = fullInventory('crystal-pickaxe', 8, true)
const stabilized = resolveEnhancementAttempt('crystal-pickaxe', 7, 10_000_000, stabilizedInventory, true, 1)
assert.equal(stabilized.success, false)
assert.equal(stabilized.level, 7)
assert.equal(stabilized.cash, 10_000_000 - enhancementRequirements('crystal-pickaxe', 8, true).coins)

const levels: EnhancementLevels = { 'worn-pickaxe': 6, 'crystal-pickaxe': 0, basket: 4, 'harvest-charm': 3 }
const restored = JSON.parse(JSON.stringify(levels)) as EnhancementLevels
assert.equal(enhancementLevel(restored, 'worn-pickaxe'), 6)
assert.equal(enhancementLevel(restored, 'crystal-pickaxe'), 0)
assert.equal(enhancementLevel({}, 'worn-pickaxe'), 0)
assert.equal(enhancementName('crystal-pickaxe', 0), 'Crystal Pickaxe')
assert.equal(enhancementName('crystal-pickaxe', 6), 'Crystal Pickaxe +6')
assert.ok(itemTooltip('crystal-pickaxe', 6)?.some((line) => line.includes('% chance')))
assert.ok(itemTooltip('harvest-charm', 6)?.some((line) => line.includes('% chance')))
assert.equal(new Set(ENHANCEABLE_ITEMS).size, ENHANCEABLE_ITEMS.length)
assert.ok(ENHANCEABLE_ITEMS.every((item) => isEnhanceableItem(item)))

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296 }
}

const rolls = 100_000
for (const [itemIndex, item] of ENHANCEABLE_ITEMS.entries()) {
  for (let level = 0; level <= 10; level += 1) {
    const row = ENHANCEMENT_FORTUNE[item][level]
    const counts = Array(row.length).fill(0) as number[]
    const random = seededRandom(43_721 + itemIndex * 193 + level * 17)
    for (let index = 0; index < rolls; index += 1) counts[enhancedYield(item, level, random()) - 1] += 1
    row.forEach((entry, index) => close(counts[index] / rolls, entry.chance, .006))
  }
}

function expectedCoinsTo(target: number) {
  const size = target
  const matrix = Array.from({ length: size }, () => Array(size + 1).fill(0) as number[])
  for (let level = 0; level < target; level += 1) {
    const attemptTarget = level + 1
    const success = enhancementChance(attemptTarget)
    const failureLevel = attemptTarget >= 4 ? Math.max(0, level - 1) : level
    matrix[level][level] += 1
    if (level + 1 < target) matrix[level][level + 1] -= success
    matrix[level][failureLevel] -= 1 - success
    matrix[level][size] = enhancementCoinCost(attemptTarget)
  }
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot
    for (let row = pivot + 1; row < size; row += 1) if (Math.abs(matrix[row][pivot]) > Math.abs(matrix[best][pivot])) best = row
    ;[matrix[pivot], matrix[best]] = [matrix[best], matrix[pivot]]
    const divisor = matrix[pivot][pivot]
    for (let column = pivot; column <= size; column += 1) matrix[pivot][column] /= divisor
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue
      const factor = matrix[row][pivot]
      for (let column = pivot; column <= size; column += 1) matrix[row][column] -= factor * matrix[pivot][column]
    }
  }
  return matrix[0][size]
}

const progressionTargets: Record<number, number> = {
  3: 350_000,
  4: 915_000,
  5: 2_450_000,
  6: 7_600_000,
  7: 24_900_000,
  8: 90_000_000,
  9: 409_000_000,
  10: 2_800_000_000,
}
Object.entries(progressionTargets).forEach(([target, expected]) => {
  const actual = expectedCoinsTo(Number(target))
  assert.ok(Math.abs(actual - expected) / expected < .025, `+${target}: ${actual} vs ${expected}`)
})

console.log(JSON.stringify({
  fortuneTables: ENHANCEABLE_ITEMS.length * 11,
  simulatedRolls: ENHANCEABLE_ITEMS.length * 11 * rolls,
  progression: Object.fromEntries(Object.keys(progressionTargets).map((target) => [`+${target}`, Math.round(expectedCoinsTo(Number(target)))])),
  transactionChecks: 4,
  status: 'passed',
}, null, 2))
