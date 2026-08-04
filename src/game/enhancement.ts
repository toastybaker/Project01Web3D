import { BASKET_CONFIG, PICKAXE_CONFIG, fortuneBonus, type FortuneOutcome } from './config'
import type { ItemId } from './items'

export const ENHANCEABLE_ITEMS = [
  'worn-pickaxe', 'iron-pickaxe', 'steel-pickaxe', 'crystal-pickaxe',
  'basket', 'reinforced-basket', 'master-basket', 'harvest-charm',
] as const

export type EnhanceableItem = typeof ENHANCEABLE_ITEMS[number]
export type EnhancementLevels = Partial<Record<EnhanceableItem, number>>
export type EnhancementRequirements = { coins: number; materials: Partial<Record<ItemId, number>> }
export type EnhancementAttempt = {
  ok: boolean
  reason?: 'max' | 'coins' | 'materials'
  cash: number
  inventory: Partial<Record<ItemId, number>>
  success?: boolean
  level: number
  target: number
}

const enhanceableSet = new Set<string>(ENHANCEABLE_ITEMS)
const chances = [0, 1, .95, .85, .72, .58, .38, .30, .24, .18, .12] as const
const coinCosts = [0, 40_000, 90_000, 180_000, 350_000, 650_000, 1_000_000, 1_600_000, 2_500_000, 4_000_000, 6_500_000] as const
const speedBonuses = [0, .005, .01, .02, .03, .045, .065, .09, .12, .155, .20] as const
const capacityBonuses = [0, .01, .02, .04, .06, .09, .13, .18, .24, .31, .40] as const

function materialRows(rows: Array<Partial<Record<ItemId, number>>>) { return [{}, ...rows] }

const pickaxeMaterials = materialRows([
  { 'copper-ore': 6 },
  { 'copper-ore': 10, 'iron-ore': 2 },
  { 'iron-ore': 8, 'silver-ore': 2 },
  { 'iron-ore': 12, 'silver-ore': 4, orange: 8 },
  { 'silver-ore': 10, 'gold-ore': 2, pumpkin: 1 },
  { 'silver-ore': 8, 'gold-ore': 4, truffle: 1, watermelon: 1 },
  { 'gold-ore': 8, 'crystal-ore': 2, truffle: 1, watermelon: 1 },
  { 'gold-ore': 6, 'crystal-ore': 4, 'natural-discovery': 1, watermelon: 2 },
  { 'crystal-ore': 6, 'ancient-ore': 1, 'natural-discovery': 1, truffle: 1, watermelon: 2 },
  { 'crystal-ore': 10, 'ancient-ore': 2, 'natural-discovery': 2, truffle: 1, watermelon: 3 },
])

const basketMaterials = materialRows([
  { apple: 12, orange: 8 },
  { apple: 18, orange: 12, 'copper-ore': 2 },
  { apple: 24, orange: 18, 'iron-ore': 4 },
  { apple: 30, orange: 24, 'iron-ore': 4, 'silver-ore': 2 },
  { apple: 36, orange: 30, 'silver-ore': 4, pumpkin: 1 },
  { apple: 45, orange: 36, 'gold-ore': 2, truffle: 1, pumpkin: 1 },
  { apple: 55, orange: 44, 'gold-ore': 2, 'crystal-ore': 1, truffle: 1 },
  { apple: 70, orange: 55, 'crystal-ore': 3, 'natural-discovery': 1, watermelon: 1 },
  { apple: 85, orange: 70, 'ancient-ore': 1, 'natural-discovery': 1, watermelon: 2 },
  { apple: 110, orange: 90, 'ancient-ore': 2, 'natural-discovery': 2, watermelon: 3 },
])

const charmMaterials = materialRows([
  { wheat: 8, apple: 4 },
  { tomato: 8, orange: 6, 'copper-ore': 2 },
  { lettuce: 6, 'iron-ore': 2, apple: 8 },
  { lettuce: 6, pumpkin: 1, 'silver-ore': 3, orange: 10 },
  { pumpkin: 2, 'silver-ore': 4, orange: 14 },
  { watermelon: 1, 'gold-ore': 2, truffle: 1, apple: 16 },
  { watermelon: 2, 'crystal-ore': 1, truffle: 1, orange: 20 },
  { watermelon: 2, 'crystal-ore': 2, 'natural-discovery': 1, apple: 20 },
  { watermelon: 3, 'ancient-ore': 1, 'natural-discovery': 1, truffle: 1 },
  { watermelon: 4, 'ancient-ore': 2, 'natural-discovery': 2, truffle: 1 },
])

const stabilization: Partial<Record<number, EnhancementRequirements>> = {
  8: { coins: 1_000_000, materials: { 'natural-discovery': 1, truffle: 1, 'crystal-ore': 2 } },
  9: { coins: 2_000_000, materials: { 'natural-discovery': 1, truffle: 1, 'ancient-ore': 1 } },
  10: { coins: 4_000_000, materials: { 'natural-discovery': 2, truffle: 1, 'ancient-ore': 2 } },
}

function outcomes(...percentages: number[]): FortuneOutcome[] {
  return percentages.map((chance, bonus) => ({ chance: chance / 100, bonus }))
}

const worn = [
  outcomes(95, 5), outcomes(90, 10), outcomes(84, 16), outcomes(77, 23), outcomes(69, 31), outcomes(60, 40),
  outcomes(50, 50), outcomes(42, 58), outcomes(35, 65), outcomes(28, 72), outcomes(20, 80),
]
const iron = [
  outcomes(82, 15, 3), outcomes(77, 18, 5), outcomes(72, 21, 7), outcomes(65, 27, 8), outcomes(58, 31, 11), outcomes(48, 37, 15),
  outcomes(38, 42, 20), outcomes(28, 44, 28), outcomes(19, 43, 38), outcomes(11, 39, 50), outcomes(5, 30, 65),
]
const steel = [
  outcomes(65, 25, 8, 2), outcomes(60, 27, 10, 3), outcomes(55, 29, 12, 4), outcomes(48, 33, 15, 4), outcomes(41, 34, 19, 6), outcomes(34, 36, 21, 9),
  outcomes(26, 35, 25, 14), outcomes(18, 30, 30, 22), outcomes(11, 24, 33, 32), outcomes(5, 16, 34, 45), outcomes(0, 8, 32, 60),
]
const reinforced = [outcomes(62, 28, 8, 2), ...steel.slice(1)]
const crystal = [
  outcomes(48, 35, 12, 4, 1), outcomes(42, 38, 14, 5, 1), outcomes(36, 40, 16, 7, 1), outcomes(30, 41, 18, 9, 2), outcomes(24, 41, 21, 11, 3), outcomes(18, 40, 24, 14, 4),
  outcomes(12, 38, 27, 17, 6), outcomes(6, 29, 31, 23, 11), outcomes(3, 20, 31, 29, 17), outcomes(1, 10, 25, 36, 28), outcomes(0, 3, 12, 35, 50),
]
const master = [
  outcomes(39, 40, 15, 5, 1), outcomes(34, 42, 17, 6, 1), outcomes(28, 43, 20, 7, 2), outcomes(22, 44, 23, 9, 2), outcomes(17, 42, 25, 12, 4), outcomes(13, 39, 28, 15, 5),
  outcomes(9, 35, 30, 19, 7), outcomes(5, 29, 31, 24, 11), outcomes(2, 21, 30, 29, 18), outcomes(0, 11, 25, 36, 28), outcomes(0, 3, 11, 36, 50),
]
const charm = [
  outcomes(100, 0, 0), outcomes(95, 5, 0), outcomes(90, 10, 0), outcomes(83, 16, 1), outcomes(76, 21, 3), outcomes(68, 27, 5),
  outcomes(58, 34, 8), outcomes(47, 40, 13), outcomes(35, 44, 21), outcomes(23, 42, 35), outcomes(12, 35, 53),
]

export const ENHANCEMENT_FORTUNE: Record<EnhanceableItem, FortuneOutcome[][]> = {
  'worn-pickaxe': worn,
  'iron-pickaxe': iron,
  'steel-pickaxe': steel,
  'crystal-pickaxe': crystal,
  basket: iron,
  'reinforced-basket': reinforced,
  'master-basket': master,
  'harvest-charm': charm,
}

export function isEnhanceableItem(item: string | null | undefined): item is EnhanceableItem {
  return Boolean(item && enhanceableSet.has(item))
}

export function enhancementLevel(levels: EnhancementLevels, item: EnhanceableItem) {
  return Math.max(0, Math.min(10, Math.floor(Number(levels[item]) || 0)))
}

export function enhancementName(item: EnhanceableItem, level: number, includeZero = false) {
  const base = item === 'harvest-charm' ? 'Harvest Charm'
    : item in PICKAXE_CONFIG ? PICKAXE_CONFIG[item as keyof typeof PICKAXE_CONFIG].name
      : BASKET_CONFIG[item as keyof typeof BASKET_CONFIG].name
  const safe = Math.max(0, Math.min(10, Math.floor(level)))
  return safe > 0 || includeZero ? `${base} +${safe}` : base
}

export function enhancementChance(target: number) { return chances[Math.max(0, Math.min(10, Math.floor(target)))] ?? 0 }
export function enhancementCoinCost(target: number) { return coinCosts[Math.max(0, Math.min(10, Math.floor(target)))] ?? 0 }
export function miningSpeedBonus(level: number) { return speedBonuses[Math.max(0, Math.min(10, Math.floor(level)))] ?? 0 }
export function basketCapacityBonus(level: number) { return capacityBonuses[Math.max(0, Math.min(10, Math.floor(level)))] ?? 0 }

export function fortuneFor(item: EnhanceableItem, level: number) {
  return ENHANCEMENT_FORTUNE[item][Math.max(0, Math.min(10, Math.floor(level)))]
}

export function expectedFortune(item: EnhanceableItem, level: number) {
  return fortuneFor(item, level).reduce((sum, outcome) => sum + outcome.chance * (outcome.bonus + 1), 0)
}

export function enhancedBasketCapacity(item: 'basket' | 'reinforced-basket' | 'master-basket', level: number) {
  return Math.floor(BASKET_CONFIG[item].capacity * (1 + basketCapacityBonus(level)))
}

export function enhancedMiningSpeed(item: keyof typeof PICKAXE_CONFIG, level: number) {
  return PICKAXE_CONFIG[item].speed * (1 + miningSpeedBonus(level))
}

export function enhancedYield(item: EnhanceableItem, level: number, random = Math.random()) {
  return 1 + fortuneBonus(fortuneFor(item, level), random)
}

export function enhancementRequirements(item: EnhanceableItem, target: number, stabilized = false): EnhancementRequirements {
  const safeTarget = Math.max(1, Math.min(10, Math.floor(target)))
  const baseMaterials = item === 'harvest-charm' ? charmMaterials[safeTarget]
    : item.endsWith('pickaxe') ? pickaxeMaterials[safeTarget]
      : basketMaterials[safeTarget]
  const extra = stabilized ? stabilization[safeTarget] : undefined
  const materials = { ...baseMaterials }
  Object.entries(extra?.materials ?? {}).forEach(([id, quantity]) => {
    const itemId = id as ItemId
    materials[itemId] = (materials[itemId] ?? 0) + Number(quantity)
  })
  return { coins: enhancementCoinCost(safeTarget) + (extra?.coins ?? 0), materials }
}

export function canStabilize(target: number) { return target >= 8 && target <= 10 }

export function enhancementResultLevel(current: number, success: boolean, stabilized = false) {
  const safe = Math.max(0, Math.min(10, Math.floor(current)))
  if (success) return Math.min(10, safe + 1)
  if (safe + 1 >= 4 && !stabilized) return Math.max(0, safe - 1)
  return safe
}

export function enhancementRoll(current: number, random = Math.random(), stabilized = false) {
  const target = Math.min(10, Math.max(0, Math.floor(current)) + 1)
  const success = random < enhancementChance(target)
  return { success, target, level: enhancementResultLevel(current, success, stabilized && canStabilize(target)) }
}

export function resolveEnhancementAttempt(
  item: EnhanceableItem,
  current: number,
  cash: number,
  inventory: Partial<Record<ItemId, number>>,
  stabilized = false,
  random = Math.random(),
): EnhancementAttempt {
  const safeCurrent = Math.max(0, Math.min(10, Math.floor(current)))
  const target = Math.min(10, safeCurrent + 1)
  if (safeCurrent >= 10) return { ok: false, reason: 'max', cash, inventory, level: safeCurrent, target }
  const protectedAttempt = stabilized && canStabilize(target)
  const requirements = enhancementRequirements(item, target, protectedAttempt)
  if (cash < requirements.coins) return { ok: false, reason: 'coins', cash, inventory, level: safeCurrent, target }
  const missing = Object.entries(requirements.materials).some(([id, quantity]) => (inventory[id as ItemId] ?? 0) < Number(quantity))
  if (missing) return { ok: false, reason: 'materials', cash, inventory, level: safeCurrent, target }
  const nextInventory = { ...inventory }
  Object.entries(requirements.materials).forEach(([id, quantity]) => {
    const itemId = id as ItemId
    nextInventory[itemId] = (nextInventory[itemId] ?? 0) - Number(quantity)
  })
  const result = enhancementRoll(safeCurrent, random, protectedAttempt)
  return {
    ok: true,
    cash: cash - requirements.coins,
    inventory: nextInventory,
    success: result.success,
    level: result.level,
    target,
  }
}
