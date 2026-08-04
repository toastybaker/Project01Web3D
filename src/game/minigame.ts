import type { OreItem } from './ore'
import type { FoodItemId, RecipeId } from './recipes'

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

const MINIGAME_REWARD_SHARES = [0.12, 0.07, 0.04, 0.015] as const
const MINIGAME_REWARD_CAPS = [8_000_000, 5_000_000, 3_000_000, 1_000_000] as const
export const COOKBOOK_BOX_REWARD_VALUE = 600_000

export function minigameRewardPackage(economyReference: number, placement: number, playerCash?: number, leaderCash?: number) {
  if (placement < 1) return { budget: 0, boxes: 0, cash: 0 }
  const rankIndex = Math.min(3, Math.max(0, placement - 1))
  const budget = Math.min(MINIGAME_REWARD_CAPS[rankIndex], Math.round(Math.max(1, economyReference) * MINIGAME_REWARD_SHARES[rankIndex]))
  const boxes = placement === 1 ? 2 : placement === 2 ? 1 : 0
  let cash = Math.max(0, budget - boxes * COOKBOOK_BOX_REWARD_VALUE)
  const gap = playerCash !== undefined && leaderCash !== undefined ? Math.max(0, leaderCash - playerCash) : 0
  const catchup = Math.min(Math.round(budget * .2), Math.round(gap * .04))
  cash += catchup
  return { budget: budget + catchup, boxes, cash }
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
export type FarmRushTool = FarmRushCrop | 'water'
export type FarmRushCell = { crop: FarmRushCrop | null; stage: 'empty' | 'planted' | 'watered' | 'ready'; readyAt: number }
export type FarmRushOrder = { recipe: RecipeId; name: string; food: FoodItemId; ingredients: Partial<Record<FarmRushCrop, number>>; cookSeconds: number; points: number }

const FARM_INGREDIENT_POINTS: Record<FarmRushCrop, number> = { wheat: 1, tomato: 2, lettuce: 3, pumpkin: 5, watermelon: 8 }
const FARM_ORDER_BLUEPRINTS: Array<Omit<FarmRushOrder, 'points'>> = [
  { recipe: 'mushroom-skewer', name: 'Farm Skewer', food: 'food-mushroom-skewer', ingredients: { tomato: 2, lettuce: 1 }, cookSeconds: 4 },
  { recipe: 'garden-salad', name: 'Garden Salad', food: 'food-garden-salad', ingredients: { tomato: 2, lettuce: 2 }, cookSeconds: 4 },
  { recipe: 'meadow-stew', name: 'Meadow Stew', food: 'food-meadow-stew', ingredients: { lettuce: 2, tomato: 1, wheat: 1 }, cookSeconds: 5 },
  { recipe: 'pumpkin-bread', name: 'Pumpkin Bread', food: 'food-pumpkin-bread', ingredients: { pumpkin: 1, wheat: 2 }, cookSeconds: 6 },
  { recipe: 'farmhouse-plate', name: 'Farmhouse Plate', food: 'food-farmhouse-plate', ingredients: { wheat: 2, tomato: 1, lettuce: 1 }, cookSeconds: 6 },
  { recipe: 'melon-preserve', name: 'Melon Preserve', food: 'food-melon-preserve', ingredients: { watermelon: 1, wheat: 1 }, cookSeconds: 7 },
  { recipe: 'harvest-feast', name: 'Harvest Feast', food: 'food-harvest-feast', ingredients: { pumpkin: 1, lettuce: 1, tomato: 1, wheat: 2 }, cookSeconds: 7 },
]

export const FARM_RUSH_RECIPE_IDS = FARM_ORDER_BLUEPRINTS.map((order) => order.recipe)

export function farmRushOrderPoints(ingredients: Partial<Record<FarmRushCrop, number>>): number {
  const entries = Object.entries(ingredients).filter(([, quantity]) => Boolean(quantity)) as Array<[FarmRushCrop, number]>
  const base = entries.reduce((sum, [crop, quantity]) => sum + FARM_INGREDIENT_POINTS[crop] * quantity, 0)
  const total = entries.reduce((sum, [, quantity]) => sum + quantity, 0)
  const complexity = 1 + Math.max(0, entries.length - 1) * .45 + Math.max(0, total - 1) * .12
  return Math.round(base * complexity)
}

export function farmRushOrders(milestone: number, count = 18): FarmRushOrder[] {
  return Array.from({ length: count }, (_, index) => {
    let value = Math.imul(milestone + index * 104729, 48271) >>> 0
    value ^= value >>> 16
    const blueprint = index === 0
      ? FARM_ORDER_BLUEPRINTS[0]
      : FARM_ORDER_BLUEPRINTS[(value >>> 0) % FARM_ORDER_BLUEPRINTS.length]
    return { ...blueprint, ingredients: { ...blueprint.ingredients }, points: farmRushOrderPoints(blueprint.ingredients) }
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
