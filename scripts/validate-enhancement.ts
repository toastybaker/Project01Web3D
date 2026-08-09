import assert from 'node:assert/strict'
import { BASKET_CONFIG, PICKAXE_CONFIG } from '../src/game/config'
import { itemTooltip, type ItemId } from '../src/game/items'
import { canMineOre, miningDuration } from '../src/game/ore'
import * as enhancement from '../src/game/enhancement'
import {
  ENHANCEABLE_ITEMS,
  ENHANCEMENT_FORTUNE,
  ENHANCEMENT_VOUCHER,
  ENHANCEMENT_WARDS,
  basketCapacityBonus,
  canUseEnhancementVoucher,
  canUseEnhancementWard,
  enhancedBasketCapacity,
  enhancedYield,
  enhancementBaseCoinCost,
  enhancementChance,
  enhancementCoinCost,
  enhancementCoinMultiplier,
  enhancementLevel,
  enhancementName,
  enhancementRequirements,
  enhancementVoucherDiscount,
  enhancementWardForTarget,
  expectedFortune,
  fortuneFor,
  isEnhanceableItem,
  miningSpeedBonus,
  resolveEnhancementAttempt,
  type EnhanceableItem,
  type EnhancementAttemptOptions,
  type EnhancementInventory,
  type EnhancementLevels,
} from '../src/game/enhancement'

const close = (actual: number, expected: number, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
const fullInventory = (item: EnhanceableItem, target: number, options: EnhancementAttemptOptions = {}) => {
  const inventory: EnhancementInventory = { [item]: 1 }
  Object.keys(enhancementRequirements(item, target, options).materials).forEach((id) => { inventory[id as ItemId] = 999 })
  if (options.ward) inventory[options.ward] = 1
  if (options.voucher) inventory[ENHANCEMENT_VOUCHER] = 1
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
const oreIds = ['copper-ore', 'iron-ore', 'silver-ore', 'gold-ore', 'crystal-ore', 'ancient-ore'] as const
for (const [item, config] of Object.entries(PICKAXE_CONFIG) as Array<[keyof typeof PICKAXE_CONFIG, (typeof PICKAXE_CONFIG)[keyof typeof PICKAXE_CONFIG]]>) {
  for (const ore of oreIds) assert.equal(canMineOre(item, ore), (config.unlocks as readonly string[]).includes(ore), `${item} ore limit drifted`)
}
const multiplierLimits: Record<EnhanceableItem, number> = {
  'worn-pickaxe': 2,
  'iron-pickaxe': 3,
  'steel-pickaxe': 4,
  'crystal-pickaxe': 5,
  basket: 3,
  'reinforced-basket': 4,
  'master-basket': 5,
  'harvest-charm': 3,
}
for (const [item, maximum] of Object.entries(multiplierLimits) as Array<[EnhanceableItem, number]>) {
  assert.equal(Math.max(...fortuneFor(item, 10).map((entry) => entry.bonus + 1)), maximum, `${item} Fortune limit drifted`)
  assert.equal(enhancementLevel({ [item]: 99 }, item), 10, `${item} level cap drifted`)
}
for (const item of ['basket', 'reinforced-basket', 'master-basket'] as const) {
  assert.equal(enhancedBasketCapacity(item, 10), Math.floor(BASKET_CONFIG[item].capacity * 1.4), `${item} capacity cap drifted`)
}
assert.ok(miningDuration('worn-pickaxe', 'copper-ore', 10) < miningDuration('worn-pickaxe', 'copper-ore', 0))

const expectedCoinMultipliers: Record<EnhanceableItem, number> = {
  'worn-pickaxe': .75,
  'iron-pickaxe': 1,
  'steel-pickaxe': 1.5,
  'crystal-pickaxe': 2.25,
  basket: 1,
  'reinforced-basket': 1.5,
  'master-basket': 2.25,
  'harvest-charm': 1,
}
for (const item of ENHANCEABLE_ITEMS) {
  assert.equal(enhancementCoinMultiplier(item), expectedCoinMultipliers[item], `${item} coin multiplier drifted`)
  for (let target = 1; target <= 10; target += 1) {
    const expected = Math.round(enhancementBaseCoinCost(target) * expectedCoinMultipliers[item] / 10_000) * 10_000
    assert.equal(enhancementCoinCost(item, target), expected, `${item} +${target} rounded coin cost drifted`)
  }
}
assert.equal(enhancementCoinCost('worn-pickaxe', 6), 750_000)
assert.equal(enhancementCoinCost('master-basket', 8), 5_630_000)
assert.equal(enhancementCoinCost('crystal-pickaxe', 10), 14_630_000)

const expectedRecipes = {
  pickaxe: [
    { 'copper-ore': 6 },
    { 'copper-ore': 10, 'iron-ore': 2 },
    { 'iron-ore': 8, 'silver-ore': 2 },
    { 'iron-ore': 12, 'silver-ore': 4, orange: 8 },
    { 'silver-ore': 10, 'gold-ore': 2, pumpkin: 1 },
    { 'silver-ore': 8, 'gold-ore': 4, truffle: 1, watermelon: 1 },
    { 'gold-ore': 8, 'crystal-ore': 2, truffle: 1, watermelon: 1 },
    { 'gold-ore': 6, 'crystal-ore': 4, 'natural-discovery': 1, watermelon: 2 },
    { 'crystal-ore': 8, 'ancient-ore': 2, 'natural-discovery': 1, truffle: 1, watermelon: 2 },
    { 'crystal-ore': 12, 'ancient-ore': 3, 'natural-discovery': 2, truffle: 2, watermelon: 4 },
  ],
  basket: [
    { apple: 12, orange: 8 },
    { apple: 18, orange: 12, 'copper-ore': 2 },
    { apple: 24, orange: 18, 'iron-ore': 4 },
    { apple: 30, orange: 24, 'iron-ore': 4, 'silver-ore': 2 },
    { apple: 36, orange: 30, 'silver-ore': 4, pumpkin: 1 },
    { apple: 45, orange: 36, 'silver-ore': 4, 'gold-ore': 2, truffle: 1, watermelon: 1 },
    { apple: 55, orange: 44, 'gold-ore': 4, 'crystal-ore': 2, truffle: 1, watermelon: 1 },
    { apple: 70, orange: 55, 'crystal-ore': 3, 'ancient-ore': 1, 'natural-discovery': 1, watermelon: 1 },
    { apple: 85, orange: 70, 'crystal-ore': 5, 'ancient-ore': 2, 'natural-discovery': 1, truffle: 1, watermelon: 2 },
    { apple: 110, orange: 90, 'crystal-ore': 8, 'ancient-ore': 3, 'natural-discovery': 2, truffle: 1, watermelon: 3 },
  ],
  charm: [
    { wheat: 8, apple: 4 },
    { tomato: 8, orange: 6, 'copper-ore': 2 },
    { lettuce: 6, 'iron-ore': 2, apple: 8 },
    { lettuce: 6, pumpkin: 1, 'silver-ore': 3, orange: 10 },
    { pumpkin: 3, 'silver-ore': 6, orange: 20 },
    { watermelon: 1, 'silver-ore': 4, 'gold-ore': 2, truffle: 1, tomato: 8, apple: 16 },
    { watermelon: 2, 'gold-ore': 4, 'crystal-ore': 1, truffle: 1, orange: 20 },
    { watermelon: 2, 'crystal-ore': 2, 'ancient-ore': 1, 'natural-discovery': 1, apple: 20 },
    { watermelon: 3, 'crystal-ore': 5, 'ancient-ore': 1, 'natural-discovery': 1, truffle: 1, 'gold-ore': 2 },
    { watermelon: 4, 'crystal-ore': 8, 'ancient-ore': 2, 'natural-discovery': 2, truffle: 1, 'gold-ore': 4 },
  ],
} satisfies Record<string, Array<Partial<Record<ItemId, number>>>>

const neutralMaterialValues: Partial<Record<ItemId, number>> = {
  apple: 4_000, orange: 6_000, wheat: 12_000, tomato: 23_000, lettuce: 55_000,
  pumpkin: 265_000, watermelon: 775_000, 'copper-ore': 8_000, 'iron-ore': 18_000,
  'silver-ore': 55_000, 'gold-ore': 150_000, 'crystal-ore': 500_000, 'ancient-ore': 1_500_000,
  truffle: 90_000, 'natural-discovery': 250_000,
}
const expectedRecipeValues = {
  pickaxe: [48_000, 116_000, 254_000, 484_000, 1_115_000, 1_905_000, 3_065_000, 4_700_000, 8_890_000, 14_280_000],
  basket: [96_000, 160_000, 276_000, 446_000, 809_000, 1_781_000, 2_949_000, 4_635_000, 8_150_000, 12_395_000],
  charm: [112_000, 236_000, 398_000, 820_000, 1_245_000, 1_633_000, 2_860_000, 4_380_000, 6_965_000, 11_290_000],
}
const recipeItems = { pickaxe: 'iron-pickaxe', basket: 'basket', charm: 'harvest-charm' } as const
for (const family of Object.keys(recipeItems) as Array<keyof typeof recipeItems>) {
  expectedRecipes[family].forEach((recipe, index) => {
    const target = index + 1
    assert.deepEqual(enhancementRequirements(recipeItems[family], target).materials, recipe, `${family} +${target} recipe drifted`)
    const value = Object.entries(recipe).reduce((sum, [id, quantity]) => sum + (neutralMaterialValues[id as ItemId] ?? 0) * Number(quantity), 0)
    assert.equal(value, expectedRecipeValues[family][index], `${family} +${target} neutral value drifted`)
  })
}

const successInventory = fullInventory('iron-pickaxe', 1)
const success = resolveEnhancementAttempt('iron-pickaxe', 0, 1_000_000, successInventory, {}, 0)
assert.equal(success.ok, true)
assert.equal(success.success, true)
assert.equal(success.level, 1)
assert.equal(success.cash, 1_000_000 - enhancementCoinCost('iron-pickaxe', 1))
assert.equal(success.inventory['copper-ore'], 993)

const softFailureInventory = fullInventory('iron-pickaxe', 2)
const softFailure = resolveEnhancementAttempt('iron-pickaxe', 1, 1_000_000, softFailureInventory, {}, 1)
assert.equal(softFailure.success, false)
assert.equal(softFailure.level, 1)
assert.equal(softFailure.inventory['copper-ore'], 989)
assert.equal(softFailure.inventory['iron-ore'], 997)

const downgradeInventory = fullInventory('steel-pickaxe', 4)
const downgrade = resolveEnhancementAttempt('steel-pickaxe', 3, 2_000_000, downgradeInventory, {}, 1)
assert.equal(downgrade.success, false)
assert.equal(downgrade.level, 2)
assert.equal(downgrade.cash, 2_000_000 - enhancementCoinCost('steel-pickaxe', 4))

assert.equal(Object.hasOwn(enhancement, 'canStabilize'), false)
assert.equal(enhancementWardForTarget(4), 'upgrade-guard-4')
assert.equal(enhancementWardForTarget(5), 'upgrade-guard-5')
assert.equal(enhancementWardForTarget(6), 'upgrade-guard-6')
assert.equal(enhancementWardForTarget(7), undefined)
for (let target = 7; target <= 10; target += 1) {
  for (const ward of Object.values(ENHANCEMENT_WARDS)) assert.equal(canUseEnhancementWard(ward, target), false)
}

const wardFailureInventory = fullInventory('crystal-pickaxe', 6, { ward: ENHANCEMENT_WARDS[6] })
const wardFailure = resolveEnhancementAttempt('crystal-pickaxe', 5, 10_000_000, wardFailureInventory, { ward: ENHANCEMENT_WARDS[6] }, 1)
assert.equal(wardFailure.ok, true)
assert.equal(wardFailure.success, false)
assert.equal(wardFailure.level, 5)
assert.equal(wardFailure.inventory[ENHANCEMENT_WARDS[6]], 0)
assert.equal(wardFailure.inventory['silver-ore'], 991)
assert.equal(wardFailure.cash, 10_000_000 - enhancementCoinCost('crystal-pickaxe', 6))

const wardSuccessInventory = fullInventory('steel-pickaxe', 5, { ward: ENHANCEMENT_WARDS[5] })
const wardSuccess = resolveEnhancementAttempt('steel-pickaxe', 4, 10_000_000, wardSuccessInventory, { ward: ENHANCEMENT_WARDS[5] }, 0)
assert.equal(wardSuccess.success, true)
assert.equal(wardSuccess.level, 5)
assert.equal(wardSuccess.inventory[ENHANCEMENT_WARDS[5]], 0)

const invalidWardInventory = fullInventory('iron-pickaxe', 7)
invalidWardInventory[ENHANCEMENT_WARDS[6]] = 1
const invalidWard = resolveEnhancementAttempt('iron-pickaxe', 6, 10_000_000, invalidWardInventory, { ward: ENHANCEMENT_WARDS[6] }, 1)
assert.equal(invalidWard.ok, false)
assert.equal(invalidWard.reason, 'ward')
assert.equal(invalidWard.inventory, invalidWardInventory)

assert.equal(enhancementVoucherDiscount(4_000_000), 750_000)
assert.equal(canUseEnhancementVoucher(6), true)
assert.equal(canUseEnhancementVoucher(7), false)
const combinedOptions = { ward: ENHANCEMENT_WARDS[6], voucher: true } as const
const combinedInventory = fullInventory('crystal-pickaxe', 6, combinedOptions)
const combined = resolveEnhancementAttempt('crystal-pickaxe', 5, 10_000_000, combinedInventory, combinedOptions, 1)
const combinedRequirements = enhancementRequirements('crystal-pickaxe', 6, { voucher: true })
assert.equal(combined.ok, true)
assert.equal(combined.level, 5)
assert.equal(combined.inventory[ENHANCEMENT_WARDS[6]], 0)
assert.equal(combined.inventory[ENHANCEMENT_VOUCHER], 0)
assert.equal(combinedRequirements.coinDiscount, 675_000)
assert.equal(combinedRequirements.coins, 1_575_000)
assert.deepEqual(combinedRequirements.materials, enhancementRequirements('crystal-pickaxe', 6).materials)
assert.equal(combined.cash, 10_000_000 - combinedRequirements.coins)

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

function expectedCostTo(target: number, attemptCost: (target: number) => number) {
  const size = target
  const matrix = Array.from({ length: size }, () => Array(size + 1).fill(0) as number[])
  for (let level = 0; level < target; level += 1) {
    const attemptTarget = level + 1
    const success = enhancementChance(attemptTarget)
    const failureLevel = attemptTarget >= 4 ? Math.max(0, level - 1) : level
    matrix[level][level] += 1
    if (level + 1 < target) matrix[level][level + 1] -= success
    matrix[level][failureLevel] -= 1 - success
    matrix[level][size] = attemptCost(attemptTarget)
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

function expectedCoinsTo(target: number) {
  return expectedCostTo(target, enhancementBaseCoinCost)
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

const expectedPlusSix: Record<EnhanceableItem, { coins: number; materials: number }> = {
  'worn-pickaxe': { coins: 5_680_000, materials: 12_830_000 },
  'iron-pickaxe': { coins: 7_580_000, materials: 12_830_000 },
  'steel-pickaxe': { coins: 11_370_000, materials: 12_830_000 },
  'crystal-pickaxe': { coins: 17_050_000, materials: 12_830_000 },
  basket: { coins: 7_580_000, materials: 11_110_000 },
  'reinforced-basket': { coins: 11_370_000, materials: 11_110_000 },
  'master-basket': { coins: 17_050_000, materials: 11_110_000 },
  'harvest-charm': { coins: 7_580_000, materials: 14_610_000 },
}
const plusSixResults = Object.fromEntries(ENHANCEABLE_ITEMS.map((item) => {
  const expected = expectedPlusSix[item]
  const coins = expectedCostTo(6, (target) => enhancementCoinCost(item, target))
  const materials = expectedCostTo(6, (target) => Object.entries(enhancementRequirements(item, target).materials)
    .reduce((sum, [id, quantity]) => sum + (neutralMaterialValues[id as ItemId] ?? 0) * Number(quantity), 0))
  assert.ok(Math.abs(coins - expected.coins) / expected.coins < .01, `${item} expected +6 coins: ${coins} vs ${expected.coins}`)
  assert.ok(Math.abs(materials - expected.materials) / expected.materials < .01, `${item} expected +6 materials: ${materials} vs ${expected.materials}`)
  return [item, { coins: Math.round(coins), materials: Math.round(materials) }]
}))

console.log(JSON.stringify({
  fortuneTables: ENHANCEABLE_ITEMS.length * 11,
  simulatedRolls: ENHANCEABLE_ITEMS.length * 11 * rolls,
  progression: Object.fromEntries(Object.keys(progressionTargets).map((target) => [`+${target}`, Math.round(expectedCoinsTo(Number(target)))])),
  expectedPlusSix: plusSixResults,
  transactionChecks: 10,
  status: 'passed',
}, null, 2))
