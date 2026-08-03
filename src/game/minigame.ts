import type { OreItem } from './ore'

export type MinigameKind = 'mining' | 'farm' | 'forage'

export const MINIGAME_DURATION: Record<MinigameKind, number> = {
  mining: 180,
  farm: 240,
  forage: 300,
}

/** The two scheduled events are always different, while direct test URLs can pick any event. */
export function scheduledMinigame(milestone: number): MinigameKind {
  const first: MinigameKind = ['mining', 'farm', 'forage'][Math.abs(Math.floor(milestone / 1200)) % 3] as MinigameKind
  if (milestone <= 20 * 60) return first
  return ({ mining: 'farm', farm: 'forage', forage: 'mining' } as const)[first]
}

export type MiningRushOre = 'copper-ore' | 'iron-ore' | 'silver-ore' | 'gold-ore' | 'crystal-ore'

export const MINING_RUSH_POINTS: Record<MiningRushOre, number> = {
  'copper-ore': 1,
  'iron-ore': 2,
  'silver-ore': 4,
  'gold-ore': 7,
  'crystal-ore': 12,
}

export const FARM_RUSH_CROPS = ['wheat', 'tomato', 'lettuce', 'pumpkin', 'watermelon'] as const
export type FarmRushCrop = typeof FARM_RUSH_CROPS[number]
export type FarmRushTool = FarmRushCrop | 'water'
export type FarmRushCell = { crop: FarmRushCrop | null; stage: 'empty' | 'planted' | 'watered' | 'ready'; readyAt: number }
export type FarmRushOrder = { name: string; ingredients: Partial<Record<FarmRushCrop, number>>; cookSeconds: number; points: number }

const FARM_INGREDIENT_POINTS: Record<FarmRushCrop, number> = { wheat: 1, tomato: 2, lettuce: 3, pumpkin: 5, watermelon: 8 }
const FARM_ORDER_BLUEPRINTS: Array<Omit<FarmRushOrder, 'points'>> = [
  { name: 'Grain Bowl', ingredients: { wheat: 2 }, cookSeconds: 3 },
  { name: 'Garden Plate', ingredients: { tomato: 1, lettuce: 1 }, cookSeconds: 4 },
  { name: 'Pumpkin Bake', ingredients: { pumpkin: 1, wheat: 1 }, cookSeconds: 5 },
  { name: 'Harvest Dish', ingredients: { pumpkin: 1, lettuce: 1, tomato: 1 }, cookSeconds: 6 },
  { name: 'Melon Plate', ingredients: { watermelon: 1, wheat: 1 }, cookSeconds: 7 },
  { name: 'Field Supper', ingredients: { wheat: 2, tomato: 1, lettuce: 1 }, cookSeconds: 6 },
]

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
    const blueprint = FARM_ORDER_BLUEPRINTS[(value >>> 0) % FARM_ORDER_BLUEPRINTS.length]
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
