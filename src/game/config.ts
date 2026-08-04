export const MATCH_CONFIG = {
  startingCash: 100_000,
  defaultDurationSeconds: 60 * 60,
  selectableDurationsSeconds: [30, 45, 60, 90].map((minutes) => minutes * 60),
  totalRounds: 15,
  worldCycleSeconds: 4 * 60,
  stockUpdateSeconds: 4 * 60,
  commodityCycleSeconds: 4 * 60,
  secretNpcCycleSeconds: 4 * 60,
  minimumMiningMs: 420,
} as const

export type FortuneOutcome = { chance: number; bonus: number }

export const PICKAXE_CONFIG = {
  'worn-pickaxe': {
    name: 'Starter Pickaxe', price: 0, speed: 1,
    unlocks: ['copper-ore', 'iron-ore'],
    fortune: [{ chance: 0.95, bonus: 0 }, { chance: 0.05, bonus: 1 }],
  },
  'iron-pickaxe': {
    name: 'Iron Pickaxe', price: 750_000, speed: 1.35,
    unlocks: ['copper-ore', 'iron-ore', 'silver-ore'],
    fortune: [{ chance: 0.82, bonus: 0 }, { chance: 0.15, bonus: 1 }, { chance: 0.03, bonus: 2 }],
  },
  'steel-pickaxe': {
    name: 'Steel Pickaxe', price: 4_000_000, speed: 1.75,
    unlocks: ['copper-ore', 'iron-ore', 'silver-ore', 'gold-ore'],
    fortune: [{ chance: 0.65, bonus: 0 }, { chance: 0.25, bonus: 1 }, { chance: 0.08, bonus: 2 }, { chance: 0.02, bonus: 3 }],
  },
  'crystal-pickaxe': {
    name: 'Crystal Pickaxe', price: 18_000_000, speed: 2.25,
    unlocks: ['copper-ore', 'iron-ore', 'silver-ore', 'gold-ore', 'crystal-ore', 'ancient-ore'],
    fortune: [{ chance: 0.48, bonus: 0 }, { chance: 0.35, bonus: 1 }, { chance: 0.12, bonus: 2 }, { chance: 0.04, bonus: 3 }, { chance: 0.01, bonus: 4 }],
  },
} as const

export const ORE_CONFIG = {
  'copper-ore': { name: 'Copper Ore', value: 8_000, hardness: 1, respawn: [35, 50] },
  'iron-ore': { name: 'Iron Ore', value: 18_000, hardness: 1.6, respawn: [40, 55] },
  'silver-ore': { name: 'Silver Ore', value: 55_000, hardness: 2.4, respawn: [50, 75] },
  'gold-ore': { name: 'Gold Ore', value: 150_000, hardness: 3.5, respawn: [60, 85] },
  'crystal-ore': { name: 'Crystal', value: 500_000, hardness: 5, respawn: [75, 105] },
  'ancient-ore': { name: 'Ancient Ore', value: 1_500_000, hardness: 7.5, respawn: [90, 125] },
} as const

export const BASKET_CONFIG = {
  hand: { name: 'Hand Gathering', price: 0, capacity: 24, fortune: [{ chance: 1, bonus: 0 }] },
  basket: {
    name: 'Gathering Basket', price: 500_000, capacity: 80,
    fortune: [{ chance: 0.82, bonus: 0 }, { chance: 0.15, bonus: 1 }, { chance: 0.03, bonus: 2 }],
  },
  'reinforced-basket': {
    name: "Forager's Crate", price: 3_000_000, capacity: 180,
    fortune: [{ chance: 0.62, bonus: 0 }, { chance: 0.28, bonus: 1 }, { chance: 0.08, bonus: 2 }, { chance: 0.02, bonus: 3 }],
  },
  'master-basket': {
    name: 'Orchard Cart', price: 12_000_000, capacity: 360,
    fortune: [{ chance: 0.39, bonus: 0 }, { chance: 0.40, bonus: 1 }, { chance: 0.15, bonus: 2 }, { chance: 0.05, bonus: 3 }, { chance: 0.01, bonus: 4 }],
  },
} as const

export const FORAGE_CONFIG = {
  berries: { name: 'Berries', value: 4_000, baseYield: [3, 6], regrowSeconds: [180, 300] },
  apple: { name: 'Apple', value: 4_000, baseYield: [3, 5], regrowSeconds: [180, 300], fruitRegrowSeconds: 30 },
  orange: { name: 'Orange', value: 6_000, baseYield: [3, 5], regrowSeconds: [180, 300], fruitRegrowSeconds: 30 },
  mushroom: { name: 'Common Mushroom', value: 20_000, baseYield: [1, 3], regrowSeconds: [180, 300] },
  'wild-herbs': { name: 'Herb', value: 30_000, baseYield: [1, 3], regrowSeconds: [180, 300] },
  wildflower: { name: 'Wildflower', value: 40_000, baseYield: [1, 2], regrowSeconds: [180, 300] },
  truffle: { name: 'Rare Truffle', value: 90_000, baseYield: [1, 1], regrowSeconds: [600, 900] },
  'natural-discovery': { name: 'Natural Discovery', value: 250_000, baseYield: [1, 1], regrowSeconds: [1200, 1800] },
  seedDropChance: 0.01,
  starterSeedShare: 0.9,
} as const

export function forageSiteAvailability(id: string, fullAt = 0, now = Date.now()) {
  const fruit = id.startsWith('ForageApple') ? FORAGE_CONFIG.apple
    : id.startsWith('ForageOrange') ? FORAGE_CONFIG.orange
      : null
  if (!fruit) return fullAt <= now ? 1 : 0
  const capacity = fruitTreeCapacity(id)
  if (fullAt <= now) return capacity
  const missing = Math.ceil((fullAt - now) / (fruit.fruitRegrowSeconds * 1000))
  return Math.max(0, Math.min(capacity, capacity - missing))
}

export function fruitTreeCapacity(id: string) {
  let hash = 2166136261
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return 3 + (Math.abs(hash) % 3)
}

const RARE_FORAGE_ROLLS = {
  main: {
    truffle: { seconds: 120, chance: 0.65, count: 1 },
    discovery: { seconds: 240, chance: 0.38, count: 1 },
  },
  rush: {
    truffle: { seconds: 20, chance: 1, count: 2 },
    discovery: { seconds: 30, chance: 1, count: 1 },
  },
} as const

function rareHash(value: string) {
  let hash = 2166136261
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return (hash >>> 0) / 4294967296
}

export function activeRareForageIds(ids: string[], rush: boolean, sessionSeed: number, matchStartedAt: number, now = Date.now()) {
  const active = new Set<string>()
  const mode = rush ? 'rush' : 'main'
  for (const kind of ['truffle', 'discovery'] as const) {
    const prefix = rush ? kind === 'truffle' ? 'ForageRushTruffle' : 'ForageRushDiscovery' : kind === 'truffle' ? 'ForageTruffle' : 'ForageDiscovery'
    const candidates = ids.filter((id) => id.startsWith(prefix)).sort()
    if (!candidates.length) continue
    const settings = RARE_FORAGE_ROLLS[mode][kind]
    const cycle = Math.max(0, Math.floor((now - matchStartedAt) / (settings.seconds * 1000)))
    if (rareHash(`${sessionSeed}:${mode}:${kind}:${cycle}:chance`) >= settings.chance) continue
    const ranked = [...candidates].sort((a, b) => rareHash(`${sessionSeed}:${mode}:${kind}:${cycle}:${a}`) - rareHash(`${sessionSeed}:${mode}:${kind}:${cycle}:${b}`))
    if (settings.count === 1 && cycle > 0 && ranked.length > 1) {
      const previous = [...candidates].sort((a, b) => rareHash(`${sessionSeed}:${mode}:${kind}:${cycle - 1}:${a}`) - rareHash(`${sessionSeed}:${mode}:${kind}:${cycle - 1}:${b}`))[0]
      if (ranked[0] === previous) [ranked[0], ranked[1]] = [ranked[1], ranked[0]]
    }
    ranked.slice(0, settings.count).forEach((id) => active.add(id))
  }
  return active
}

export function nextRareForageRollAt(item: 'truffle' | 'natural-discovery', rush: boolean, matchStartedAt: number, now = Date.now()) {
  const settings = RARE_FORAGE_ROLLS[rush ? 'rush' : 'main'][item === 'truffle' ? 'truffle' : 'discovery']
  const cycleMs = settings.seconds * 1000
  const cycle = Math.max(0, Math.floor((now - matchStartedAt) / cycleMs))
  return matchStartedAt + (cycle + 1) * cycleMs + 50
}

export const CROP_CONFIG = {
  wheat: { name: 'Wheat', seedPrice: 10_000, growthSeconds: 30, yield: 1, value: 12_000 },
  tomato: { name: 'Tomato', seedPrice: 40_000, growthSeconds: 60, yield: 2, value: 23_000 },
  lettuce: { name: 'Lettuce', seedPrice: 100_000, growthSeconds: 90, yield: 2, value: 55_000 },
  pumpkin: { name: 'Pumpkin', seedPrice: 250_000, growthSeconds: 120, yield: 1, value: 265_000 },
  watermelon: { name: 'Watermelon', seedPrice: 750_000, growthSeconds: 180, yield: 1, value: 775_000 },
} as const

export const COMMODITY_MARKET_CONFIG = {
  wheat: { neutral: 600, demand: [120, 180], elasticity: 0.70, minimum: 0.50, maximum: 3.00 },
  tomato: { neutral: 300, demand: [60, 90], elasticity: 0.70, minimum: 0.50, maximum: 3.00 },
  lettuce: { neutral: 180, demand: [35, 55], elasticity: 0.70, minimum: 0.50, maximum: 3.00 },
  pumpkin: { neutral: 80, demand: [15, 25], elasticity: 0.70, minimum: 0.50, maximum: 3.00 },
  watermelon: { neutral: 20, demand: [3, 6], elasticity: 0.70, minimum: 0.50, maximum: 3.00 },
  berries: { neutral: 500, demand: [100, 160], elasticity: 0.60, minimum: 0.60, maximum: 2.20 },
  apple: { neutral: 400, demand: [80, 120], elasticity: 0.60, minimum: 0.60, maximum: 2.20 },
  orange: { neutral: 300, demand: [60, 90], elasticity: 0.60, minimum: 0.60, maximum: 2.20 },
  mushroom: { neutral: 240, demand: [45, 70], elasticity: 0.60, minimum: 0.60, maximum: 2.20 },
  'wild-herbs': { neutral: 180, demand: [30, 50], elasticity: 0.60, minimum: 0.60, maximum: 2.20 },
  wildflower: { neutral: 120, demand: [20, 35], elasticity: 0.60, minimum: 0.60, maximum: 2.20 },
  truffle: { neutral: 12, demand: [1, 3], elasticity: 0.60, minimum: 0.60, maximum: 2.20 },
  'copper-ore': { neutral: 600, demand: [110, 170], elasticity: 0.55, minimum: 0.65, maximum: 1.80 },
  'iron-ore': { neutral: 400, demand: [70, 110], elasticity: 0.55, minimum: 0.65, maximum: 1.80 },
  'silver-ore': { neutral: 180, demand: [30, 50], elasticity: 0.55, minimum: 0.65, maximum: 1.80 },
  'gold-ore': { neutral: 80, demand: [12, 24], elasticity: 0.55, minimum: 0.65, maximum: 1.80 },
  'crystal-ore': { neutral: 30, demand: [4, 10], elasticity: 0.55, minimum: 0.65, maximum: 1.80 },
  'ancient-ore': { neutral: 8, demand: [0, 2], elasticity: 0.55, minimum: 0.65, maximum: 1.80 },
} as const

export type CommodityId = keyof typeof COMMODITY_MARKET_CONFIG

export function fortuneBonus(outcomes: readonly FortuneOutcome[], random = Math.random()) {
  let roll = Math.min(0.999999, Math.max(0, random))
  for (const outcome of outcomes) {
    roll -= outcome.chance
    if (roll < 0) return outcome.bonus
  }
  return outcomes.at(-1)?.bonus ?? 0
}
