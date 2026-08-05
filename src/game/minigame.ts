import type { OreItem } from './ore'
import { RECIPES, RECIPE_IDS, type FoodItemId, type RecipeId } from './recipes'

export type MinigameKind = 'mining' | 'farm' | 'forage'

export const MINIGAME_DURATION: Record<MinigameKind, number> = {
  mining: 180,
  farm: 300,
  forage: 300,
}

export function minigameMilestones(durationSeconds: number) {
  const duration = Math.max(60, Math.floor(durationSeconds))
  return [Math.round(duration / 3), Math.round(duration * 2 / 3)]
}

export const COOKBOOK_BOX_REWARD_VALUE = 600_000

export const MINIGAME_CASH_PRIZES = [
  { share: .10, minimum: 1_500_000, maximum: 10_000_000 },
  { share: .065, minimum: 900_000, maximum: 6_500_000 },
  { share: .04, minimum: 550_000, maximum: 4_000_000 },
  { share: .025, minimum: 300_000, maximum: 2_500_000 },
  { share: .02, minimum: 250_000, maximum: 2_000_000 },
  { share: .015, minimum: 200_000, maximum: 1_500_000 },
  { share: .01, minimum: 150_000, maximum: 1_000_000 },
  { share: .0075, minimum: 100_000, maximum: 750_000 },
] as const

export type MinigameRewardItemId =
  | 'mining-boost'
  | 'fortune-boost'
  | 'cook-timer'
  | 'rain-bottle'
  | 'upgrade-coupon'
  | 'upgrade-guard-4'
  | 'upgrade-guard-5'
  | 'upgrade-guard-6'
  | 'cookbook-box'

export type MinigameRewardTier = 'common' | 'major' | 'rare'
export type MinigameEconomyStage = 'early' | 'middle' | 'late'
export type MinigameRewardItem = { itemId: MinigameRewardItemId; quantity: number }
export type MinigameRewardKey = {
  matchSeed: string | number
  milestone: number
  playerId: string
  placement: number
  rewardSlot: string
}
export type MinigameItemRewardRoll = {
  rewardId: string
  slot: string
  tier: MinigameRewardTier
  outcomeId: string
  items: MinigameRewardItem[]
}
export type MinigameRewardInput = {
  economyReference: number
  placement: number
  playerProgress?: number
  leaderProgress?: number
  matchSeed: string | number
  milestone: number
  playerId: string
  left?: boolean
}

type WeightedReward = { id: string; weight: number; items: readonly MinigameRewardItem[] }

const COMMON_REWARDS: readonly WeightedReward[] = [
  { id: 'mining-boost', weight: 22, items: [{ itemId: 'mining-boost', quantity: 1 }] },
  { id: 'fortune-boost', weight: 22, items: [{ itemId: 'fortune-boost', quantity: 1 }] },
  { id: 'cook-timer', weight: 18, items: [{ itemId: 'cook-timer', quantity: 1 }] },
  { id: 'rain-bottle', weight: 14, items: [{ itemId: 'rain-bottle', quantity: 1 }] },
  { id: 'upgrade-coupon', weight: 12, items: [{ itemId: 'upgrade-coupon', quantity: 1 }] },
  { id: 'upgrade-guard-4', weight: 7, items: [{ itemId: 'upgrade-guard-4', quantity: 1 }] },
  { id: 'cookbook-box', weight: 5, items: [{ itemId: 'cookbook-box', quantity: 1 }] },
]

const MAJOR_REWARDS: readonly WeightedReward[] = [
  { id: 'cookbook-box-2', weight: 25, items: [{ itemId: 'cookbook-box', quantity: 2 }] },
  { id: 'upgrade-guard-5', weight: 20, items: [{ itemId: 'upgrade-guard-5', quantity: 1 }] },
  { id: 'fortune-boost-2', weight: 20, items: [{ itemId: 'fortune-boost', quantity: 2 }] },
  { id: 'upgrade-coupon-2', weight: 15, items: [{ itemId: 'upgrade-coupon', quantity: 2 }] },
  { id: 'mining-and-cook', weight: 20, items: [{ itemId: 'mining-boost', quantity: 1 }, { itemId: 'cook-timer', quantity: 1 }] },
]

const RARE_REWARDS: readonly WeightedReward[] = [
  { id: 'upgrade-guard-6', weight: 15, items: [{ itemId: 'upgrade-guard-6', quantity: 1 }] },
  { id: 'cookbook-box-3', weight: 20, items: [{ itemId: 'cookbook-box', quantity: 3 }] },
  { id: 'guard-5-and-fortune', weight: 20, items: [{ itemId: 'upgrade-guard-5', quantity: 1 }, { itemId: 'fortune-boost', quantity: 1 }] },
  { id: 'coupon-2-and-fortune', weight: 20, items: [{ itemId: 'upgrade-coupon', quantity: 2 }, { itemId: 'fortune-boost', quantity: 1 }] },
  { id: 'common-3', weight: 25, items: [] },
]

function validPlacement(placement: number): placement is number {
  return Number.isInteger(placement) && placement >= 1 && placement <= MINIGAME_CASH_PRIZES.length
}

function finiteNonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0
}

/** Cash before catch-up. Item rewards are intentionally absent from this calculation. */
export function minigameBaseCash(economyReference: number, placement: number): number {
  if (!validPlacement(placement)) return 0
  const row = MINIGAME_CASH_PRIZES[placement - 1]
  const progress = finiteNonNegative(economyReference)
  return Math.max(row.minimum, Math.min(row.maximum, Math.round(progress * row.share)))
}

export function minigameCatchUpCash(basePlacementCash: number, playerProgress?: number, leaderProgress?: number): number {
  const leader = finiteNonNegative(leaderProgress)
  if (leader <= 0 || playerProgress === undefined) return 0
  const ratio = finiteNonNegative(playerProgress) / leader
  if (ratio >= .70) return 0
  const catchUpRate = Math.min(.20, (.70 - ratio) * .50)
  return Math.min(1_000_000, Math.round(finiteNonNegative(basePlacementCash) * catchUpRate))
}

export function minigameCashReward(economyReference: number, placement: number, playerProgress?: number, leaderProgress?: number): number {
  const baseCash = minigameBaseCash(economyReference, placement)
  if (baseCash === 0) return 0
  return baseCash + minigameCatchUpCash(baseCash, playerProgress, leaderProgress)
}

/**
 * Compatibility shape for existing gameplay consumers. Recipe Boxes are now part
 * of deterministic item rolls, so this cash-only legacy view always reports zero boxes.
 */
export function minigameRewardPackage(economyReference: number, placement: number, playerProgress?: number, leaderProgress?: number) {
  const cash = minigameCashReward(economyReference, placement, playerProgress, leaderProgress)
  return { budget: cash, boxes: 0, cash }
}

export function minigameEconomyStage(economyReference: number): MinigameEconomyStage {
  const progress = finiteNonNegative(economyReference)
  return progress < 25_000_000 ? 'early' : progress <= 70_000_000 ? 'middle' : 'late'
}

function rewardKey(key: MinigameRewardKey, namespace: string): string {
  return JSON.stringify([
    String(key.matchSeed),
    Math.floor(key.milestone),
    key.playerId,
    Math.floor(key.placement),
    key.rewardSlot,
    namespace,
  ])
}

function deterministicRoll(key: MinigameRewardKey, namespace: string): number {
  const value = rewardKey(key, namespace)
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d)
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b)
  hash ^= hash >>> 16
  return (hash >>> 0) / 4294967296
}

function selectWeightedReward(pool: readonly WeightedReward[], roll: number): WeightedReward {
  const total = pool.reduce((sum, reward) => sum + reward.weight, 0)
  let cursor = roll * total
  for (const reward of pool) {
    cursor -= reward.weight
    if (cursor < 0) return reward
  }
  return pool[pool.length - 1]
}

function mergeRewardItems(items: readonly MinigameRewardItem[]): MinigameRewardItem[] {
  const quantities = new Map<MinigameRewardItemId, number>()
  for (const item of items) quantities.set(item.itemId, (quantities.get(item.itemId) ?? 0) + item.quantity)
  return [...quantities].map(([itemId, quantity]) => ({ itemId, quantity }))
}

/** Roll one deterministic pool slot. Rare three-common bundles use three derived slots. */
export function rollMinigameItemReward(tier: MinigameRewardTier, key: MinigameRewardKey): MinigameItemRewardRoll {
  const pool = tier === 'common' ? COMMON_REWARDS : tier === 'major' ? MAJOR_REWARDS : RARE_REWARDS
  const selected = selectWeightedReward(pool, deterministicRoll(key, `pool:${tier}`))
  let items = selected.items.map((item) => ({ ...item }))
  if (tier === 'rare' && selected.id === 'common-3') {
    items = Array.from({ length: 3 }, (_, index) => rollMinigameItemReward('common', {
      ...key,
      rewardSlot: `${key.rewardSlot}:common-${index + 1}`,
    }).items).flat()
  }
  return {
    rewardId: rewardKey(key, 'award'),
    slot: key.rewardSlot,
    tier,
    outcomeId: selected.id,
    items: mergeRewardItems(items),
  }
}

type PackageSlot = { tier: MinigameRewardTier; slot: string; chance?: number }

function minigamePackageSlots(stage: MinigameEconomyStage, placement: number): PackageSlot[] {
  if (!validPlacement(placement)) return []
  if (stage === 'early') {
    if (placement === 1) return [{ tier: 'major', slot: 'major-1' }, { tier: 'common', slot: 'common-1' }]
    if (placement === 2) return [{ tier: 'major', slot: 'major-1' }]
    if (placement === 3) return [{ tier: 'common', slot: 'common-1' }]
    return [{ tier: 'common', slot: 'common-1', chance: placement <= 6 ? .35 : .15 }]
  }
  if (stage === 'middle') {
    if (placement === 1) return [{ tier: 'major', slot: 'major-1' }, { tier: 'common', slot: 'common-1' }, { tier: 'common', slot: 'common-2' }]
    if (placement === 2) return [{ tier: 'major', slot: 'major-1' }, { tier: 'common', slot: 'common-1' }]
    if (placement === 3) return [{ tier: 'major', slot: 'major-1' }]
    return [{ tier: 'common', slot: 'common-1', chance: placement <= 6 ? 1 : .35 }]
  }
  if (placement === 1) return [{ tier: 'rare', slot: 'rare-1' }, { tier: 'common', slot: 'common-1' }]
  if (placement === 2) return [{ tier: 'major', slot: 'major-1' }, { tier: 'common', slot: 'common-1' }, { tier: 'common', slot: 'common-2' }]
  if (placement === 3) return [{ tier: 'major', slot: 'major-1' }, { tier: 'common', slot: 'common-1' }]
  return [{ tier: 'common', slot: 'common-1', chance: placement <= 6 ? 1 : .50 }]
}

export function minigameItemRewards(input: Omit<MinigameRewardInput, 'playerProgress' | 'leaderProgress'>): MinigameItemRewardRoll[] {
  if (input.left || !validPlacement(input.placement)) return []
  const baseKey = {
    matchSeed: input.matchSeed,
    milestone: input.milestone,
    playerId: input.playerId,
    placement: input.placement,
  }
  return minigamePackageSlots(minigameEconomyStage(input.economyReference), input.placement)
    .filter((slot) => slot.chance === undefined || deterministicRoll({ ...baseKey, rewardSlot: slot.slot }, 'gate') < slot.chance)
    .map((slot) => rollMinigameItemReward(slot.tier, { ...baseKey, rewardSlot: slot.slot }))
}

export function minigameRewards(input: MinigameRewardInput) {
  if (input.left || !validPlacement(input.placement)) {
    return { baseCash: 0, catchUpCash: 0, cash: 0, itemRolls: [] as MinigameItemRewardRoll[] }
  }
  const baseCash = minigameBaseCash(input.economyReference, input.placement)
  const catchUpCash = minigameCatchUpCash(baseCash, input.playerProgress, input.leaderProgress)
  const itemRolls = minigameItemRewards(input)
  return { baseCash, catchUpCash, cash: baseCash + catchUpCash, itemRolls }
}

/** Pure idempotent inventory application for replay-safe result messages. */
export function applyMinigameItemRewards(
  inventory: Readonly<Partial<Record<MinigameRewardItemId, number>>>,
  appliedRewardIds: Iterable<string>,
  rolls: readonly MinigameItemRewardRoll[],
) {
  const nextInventory = { ...inventory }
  const applied = new Set(appliedRewardIds)
  const newlyAppliedRewardIds: string[] = []
  for (const roll of rolls) {
    if (applied.has(roll.rewardId)) continue
    for (const item of roll.items) nextInventory[item.itemId] = (nextInventory[item.itemId] ?? 0) + item.quantity
    applied.add(roll.rewardId)
    newlyAppliedRewardIds.push(roll.rewardId)
  }
  return { inventory: nextInventory, appliedRewardIds: [...applied], newlyAppliedRewardIds }
}

/** The two scheduled events are always different, while direct test URLs can pick any event. */
export function scheduledMinigame(milestone: number, sessionSeed = 9731, durationSeconds = 60 * 60): MinigameKind {
  const kinds: MinigameKind[] = ['mining', 'farm', 'forage']
  const seededIndex = Math.abs(Math.imul(Math.floor(sessionSeed) ^ 0x45d9f3b, 2654435761)) % kinds.length
  if (milestone <= minigameMilestones(durationSeconds)[0]) return kinds[seededIndex]
  const secondOffset = 1 + (Math.abs(Math.imul(Math.floor(sessionSeed) ^ 0x27d4eb2d, 1597334677)) % 2)
  return kinds[(seededIndex + secondOffset) % kinds.length]
}

export type MiningRushOre = 'copper-ore' | 'iron-ore' | 'silver-ore' | 'gold-ore' | 'crystal-ore'

export const MINING_RUSH_POINTS: Record<MiningRushOre, number> = {
  'copper-ore': 1,
  'iron-ore': 2,
  'silver-ore': 4,
  'gold-ore': 7,
  'crystal-ore': 12,
}

// Long enough that waiting on one socket breaks the combo, while a nearby socket
// remains faster. This keeps the compact bay active without adding travel time.
export const MINING_RUSH_RESPAWN_MS = 2_600

export const FARM_RUSH_CROPS = ['wheat', 'tomato', 'lettuce', 'pumpkin', 'watermelon'] as const
export type FarmRushCrop = typeof FARM_RUSH_CROPS[number]
export const FARM_RUSH_PANTRY = ['apple', 'orange', 'truffle'] as const
export type FarmRushIngredient = FarmRushCrop | typeof FARM_RUSH_PANTRY[number]
export type FarmRushTool = FarmRushCrop | 'water'
export type FarmRushCell = { crop: FarmRushCrop | null; stage: 'empty' | 'planted' | 'watered' | 'ready'; readyAt: number }
export type FarmRushOrder = { recipe: RecipeId; name: string; food: FoodItemId; ingredients: Partial<Record<FarmRushIngredient, number>>; cookSeconds: number; points: number }

const FARM_INGREDIENT_POINTS: Record<FarmRushIngredient, number> = {
  wheat: 1, tomato: 2, lettuce: 3, pumpkin: 5, watermelon: 8,
  apple: 2, orange: 3, truffle: 10,
}
const FARM_ORDER_BLUEPRINTS: Array<Omit<FarmRushOrder, 'points'>> = RECIPE_IDS.map((id) => {
  const recipe = RECIPES[id]
  return {
    recipe: id,
    name: recipe.name,
    food: recipe.food,
    ingredients: { ...recipe.ingredients } as Partial<Record<FarmRushIngredient, number>>,
    cookSeconds: recipe.group === 'early' ? 4 : recipe.group === 'middle' ? 6 : 7,
  }
})

export const FARM_RUSH_RECIPE_IDS = [...RECIPE_IDS]

export function farmRushRecipe(id: RecipeId): FarmRushOrder {
  const blueprint = FARM_ORDER_BLUEPRINTS.find((entry) => entry.recipe === id)
  if (!blueprint) throw new Error(`Unknown Farm Rush recipe: ${id}`)
  return { ...blueprint, ingredients: { ...blueprint.ingredients }, points: farmRushOrderPoints(blueprint.ingredients) }
}

export function farmRushOrderPoints(ingredients: Partial<Record<FarmRushIngredient, number>>): number {
  const entries = Object.entries(ingredients).filter(([, quantity]) => Boolean(quantity)) as Array<[FarmRushIngredient, number]>
  const base = entries.reduce((sum, [crop, quantity]) => sum + FARM_INGREDIENT_POINTS[crop] * quantity, 0)
  const total = entries.reduce((sum, [, quantity]) => sum + quantity, 0)
  const complexity = 1 + Math.max(0, entries.length - 1) * .45 + Math.max(0, total - 1) * .12
  return Math.round(base * complexity)
}

export const FARM_RUSH_ORDER_SEQUENCE_LENGTH = 120

export function farmRushOrders(milestone: number, count = FARM_RUSH_ORDER_SEQUENCE_LENGTH): FarmRushOrder[] {
  return Array.from({ length: count }, (_, index) => {
    let value = Math.imul(milestone, 48271) >>> 0
    value ^= value >>> 16
    const offset = value % FARM_ORDER_BLUEPRINTS.length
    const blueprint = index === 0
      ? FARM_ORDER_BLUEPRINTS[0]
      : FARM_ORDER_BLUEPRINTS[(offset + (index - 1) * 5) % FARM_ORDER_BLUEPRINTS.length]
    return farmRushRecipe(blueprint.recipe)
  })
}

export const FARM_RUSH_GROWTH_MS: Record<FarmRushCrop, number> = {
  wheat: 4_000,
  tomato: 6_000,
  lettuce: 8_000,
  pumpkin: 10_000,
  watermelon: 12_000,
}

export const FARM_RUSH_MAX_ORDERS = 3
export const FARM_RUSH_ORDER_LIFETIME_MS = 40_000

export type ForageRushKind = 'apple' | 'orange' | 'truffle' | 'discovery'
export const FORAGE_RUSH_REQUIREMENTS: Record<ForageRushKind, number> = { apple: 12, orange: 12, truffle: 3, discovery: 1 }
export const FORAGE_RUSH_DELIVERY_POINTS: Record<ForageRushKind, number> = { apple: 120, orange: 120, truffle: 210, discovery: 320 }

export function miningRushOre(milestone: number, socketId: string, generation: number): MiningRushOre {
  // Each bay uses the same 25-node value sequence. The final number is the local socket,
  // not the bay number, so nobody receives a stronger ore budget because of their bay.
  const parts = socketId.match(/\d+/g) ?? ['0']
  const socket = Number(parts[parts.length - 1] ?? 0)
  let value = Math.imul(milestone + generation * 104729 + socket * 7919, 48271) >>> 0
  value ^= value >>> 16
  const roll = (value >>> 0) / 4294967296
  return roll < .46 ? 'copper-ore' : roll < .72 ? 'iron-ore' : roll < .88 ? 'silver-ore' : roll < .97 ? 'gold-ore' : 'crystal-ore'
}

export function isRushOre(value: string): value is `RushOre${string}` {
  return value.startsWith('RushOre')
}

export function asOreItem(value: MiningRushOre): OreItem { return value }
