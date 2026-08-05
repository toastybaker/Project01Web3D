import assert from 'node:assert/strict'
import { BASKET_CONFIG, COMMODITY_MARKET_CONFIG, CROP_CONFIG, FORAGE_CONFIG, MATCH_CONFIG, ORE_CONFIG, PICKAXE_CONFIG, activeRareForageIds, forageSiteAvailability, fruitTreeCapacity, type CommodityId } from '../src/game/config'
import { advanceCommodityCycle, commodityPrice, initialCommodityMarket, marginalSale, type CommodityMarket } from '../src/game/economy'
import { ITEMS, type ItemId } from '../src/game/items'
import { MINIGAME_DURATION, minigameMilestones, minigameRewards, scheduledMinigame } from '../src/game/minigame'
import { canMineOre, miningDuration, miningYield, oreKindAtDepth, oreRespawnMs, type OreItem, type PickaxeItem } from '../src/game/ore'
import { PREPARED_FOOD_MARKUP, RECIPES, RECIPE_IDS, type FoodItemId, type RecipeId } from '../src/game/recipes'
import { MINE_NODE_SITES } from '../shared/mine-nodes.js'

const PLAYER_COUNT = 6
const FARM_COUNT = 8
const GLOBAL_EXPANSION_DEEDS = 2
const MATCH_SECONDS = MATCH_CONFIG.defaultDurationSeconds
const RUNS = Math.max(8, Number.parseInt(process.env.SIM_RUNS ?? '48', 10) || 48)
const SIM_FOOD_VALUE_MULTIPLIER = Math.max(.1, Number(process.env.SIM_FOOD_VALUE_MULTIPLIER) || PREPARED_FOOD_MARKUP)
const SIM_ORE_VALUE_MULTIPLIER = Math.max(.1, Number(process.env.SIM_ORE_VALUE_MULTIPLIER) || 1)
const MOVE_SPEED = 8.4
const FARM_CELLS = 64
const FARM_ACTION_SECONDS = 0.75
const FRUIT_REGROW_MS = FORAGE_CONFIG.apple.fruitRegrowSeconds * 1000
const CHECKPOINTS = [600, 1800, 3600] as const
const ROUTES = ['miner-left', 'miner-right', 'farm-lead', 'farm-second', 'forage', 'flex'] as const

type Route = typeof ROUTES[number]
type Crop = keyof typeof CROP_CONFIG
type ForageItem = 'apple' | 'orange' | 'truffle' | 'natural-discovery'
type ResourceItem = Crop | ForageItem | OreItem
type Zone = 'hub' | 'mine' | 'farm' | 'forage'
type Point = { x: number; z: number }
type Inventory = Partial<Record<ItemId, number>>

class Rng {
  private state: number
  constructor(seed: number) { this.state = seed >>> 0 || 0x9e3779b9 }
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let value = this.state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  int(max: number) { return Math.floor(this.next() * max) }
}

const orchardSeeded = (index: number, salt = 0) => {
  const value = Math.sin((index + 1) * 91.733 + salt * 37.17) * 43758.5453
  return value - Math.floor(value)
}
const FORAGE_TRAIL = [[0, 22], [1, 12], [-2, 0], [-8, -16], [-3, -34], [9, -52], [4, -72], [-12, -91], [-5, -112], [8, -132], [-2, -154], [10, -177], [2, -203]] as const
const forageTrailCenterAt = (z: number) => {
  if (z >= FORAGE_TRAIL[0][1]) return FORAGE_TRAIL[0][0]
  for (let index = 0; index < FORAGE_TRAIL.length - 1; index += 1) {
    const [ax, az] = FORAGE_TRAIL[index]
    const [bx, bz] = FORAGE_TRAIL[index + 1]
    if (z <= az && z >= bz) {
      const ratio = (az - z) / (az - bz)
      return ax + (bx - ax) * ratio
    }
  }
  return FORAGE_TRAIL.at(-1)![0]
}
const orchardSites = (cx: number, cz: number, count: number, salt: number) => Array.from({ length: count }, (_, index) => {
  const column = index % 5
  const row = Math.floor(index / 5)
  return { x: cx + (column - 2) * 8.4 + (orchardSeeded(index, salt) - 0.5) * 3.6, z: cz + (row - 1.5) * 8.8 + (orchardSeeded(index, salt + 1) - 0.5) * 3.8 }
})
const distributedFruitSites = (count: number, salt: number) => Array.from({ length: count }, (_, index) => {
  const columns = 7
  const rows = Math.ceil(count / columns)
  const column = index % columns
  const row = Math.floor(index / columns)
  let x = -174 + (348 * (column + 0.5)) / columns + (orchardSeeded(index, salt) - 0.5) * 16
  const z = -22 - (178 * (row + 0.5)) / rows + (orchardSeeded(index, salt + 1) - 0.5) * 13
  const trail = forageTrailCenterAt(z)
  if (Math.abs(x - trail) < 9) x += x <= trail ? -13 : 13
  return { x: Math.max(-188, Math.min(188, x)), z }
})

// Mirrors the server-private authored site list. The cardinality assertions below
// intentionally fail if the live layout drifts from the six-player model.
const APPLE_SITES = [
  { x: 3, z: -82 }, { x: -13, z: -87 }, { x: -18, z: -97 }, { x: 20, z: -102 },
  ...orchardSites(-49, -44, 8, 6101), ...orchardSites(54, -117, 12, 6127),
  ...orchardSites(-64, -181, 12, 6151), ...distributedFruitSites(34, 6173),
]
const ORANGE_SITES = [
  { x: 8, z: -89 }, { x: -15, z: -105 }, { x: 23, z: -112 },
  ...orchardSites(54, -69, 9, 6203), ...orchardSites(-52, -124, 12, 6229),
  ...distributedFruitSites(36, 6257),
]
const TRUFFLE_SITES = [{ x: -112, z: -66 }, { x: 97, z: -104 }, { x: -78, z: -204 }, { x: 126, z: -167 }, { x: 34, z: -151 }]
const DISCOVERY_SITES = [{ x: -178, z: -185 }, { x: 164, z: -201 }, { x: -139, z: -16 }]

type MineNode = { id: string; x: number; z: number; generation: number; readyAt: number }
type ForageNode = { id: string; item: ForageItem; x: number; z: number; capacity: number; fullAt: number }
type Farm = { id: number; owner: number | null; crop: Crop | null; cells: number; readyAt: number }
type CookJob = { recipe: RecipeId; quantity: number; readyAt: number }
type PlayerAction =
  | { type: 'mine'; completeAt: number; nodeId: string; target: Point; productive: number; travel: number }
  | { type: 'forage'; completeAt: number; nodeId: string; target: Point; productive: number; travel: number }
  | { type: 'sell'; completeAt: number; zone: Zone; target: Point; productive: number; travel: number; liquidate?: boolean }
  | { type: 'plant'; completeAt: number; farmId: number; crop: Crop; cells: number; target: Point; productive: number; travel: number }
  | { type: 'harvest'; completeAt: number; farmId: number; target: Point; productive: number; travel: number }
  | { type: 'shop'; completeAt: number; purchase: 'pickaxe' | 'basket' | 'deed' | 'furnace' | 'recipe'; item?: ItemId; target: Point; productive: number; travel: number }
  | { type: 'cook'; completeAt: number; target: Point; productive: number; travel: number }

type Metrics = {
  mineAttempts: number; mineSuccesses: number; mineDenied: number; mineWaitSeconds: number
  oreQuantity: number; fruitQuantity: number; rareQuantity: number; farmHarvestQuantity: number
  dishesCooked: number; cropsPlanted: number; sellTrips: number; travelSeconds: number
  productiveSeconds: number; idleSeconds: number; rewardsApplied: number
}

type Player = {
  id: number; route: Route; skill: number; cash: number; zone: Zone; position: Point
  action: PlayerAction | null; inventory: Inventory; tool: PickaxeItem | null; basket: keyof typeof BASKET_CONFIG
  equipmentBasis: number; farms: number[]; furnaces: number; knownRecipes: RecipeId[]; cookJobs: CookJob[]
  metrics: Metrics
}

type Flow = {
  mined: Partial<Record<OreItem, number>>
  foraged: Partial<Record<ForageItem, number>>
  harvested: Partial<Record<Crop, number>>
  plantedCells: Partial<Record<Crop, number>>
  cookedIngredients: Partial<Record<ResourceItem, number>>
  foodProduced: Partial<Record<FoodItemId, number>>
  sold: Partial<Record<ItemId, number>>
}

type MatchResult = {
  checkpoints: Record<number, number[]>
  finalCash: number[]
  players: Player[]
  wallSeconds: number
  minigames: string[]
  mineNodesDepleted: number
  fruitInitialCapacity: number
  fruitHarvested: number
  expansionDeedsSold: number
  flow: Flow
}

const emptyMetrics = (): Metrics => ({
  mineAttempts: 0, mineSuccesses: 0, mineDenied: 0, mineWaitSeconds: 0,
  oreQuantity: 0, fruitQuantity: 0, rareQuantity: 0, farmHarvestQuantity: 0,
  dishesCooked: 0, cropsPlanted: 0, sellTrips: 0, travelSeconds: 0,
  productiveSeconds: 0, idleSeconds: 0, rewardsApplied: 0,
})

const add = <T extends string>(record: Partial<Record<T, number>>, key: T, quantity: number) => {
  record[key] = (record[key] ?? 0) + quantity
}
const inventoryAdd = (player: Player, item: ItemId, quantity: number) => {
  player.inventory[item] = (player.inventory[item] ?? 0) + quantity
  if ((player.inventory[item] ?? 0) <= 0) delete player.inventory[item]
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)
const zoneSpawn: Record<Zone, Point> = { hub: { x: 0, z: 0 }, mine: { x: 0, z: 24 }, farm: { x: 0, z: 12 }, forage: { x: 0, z: 20 } }
const travelSeconds = (player: Player, zone: Zone, target: Point) => {
  const origin = player.zone === zone ? player.position : zoneSpawn[zone]
  const portal = player.zone === zone ? 0 : 10
  return portal + distance(origin, target) / (MOVE_SPEED * player.skill)
}
const percentile = (values: number[], p: number) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const ratio = index - lower
  return sorted[lower] + (sorted[Math.min(sorted.length - 1, lower + 1)] - sorted[lower]) * ratio
}
const median = (values: number[]) => percentile(values, 0.5)
const money = (value: number) => Math.round(value).toLocaleString('en-US')
const ratio = (value: number) => `${(value * 100).toFixed(1)}%`
const mode = <T extends string>(values: T[]) => [...new Set(values)].sort((a, b) => values.filter((value) => value === b).length - values.filter((value) => value === a).length)[0]

function buildForageNodes(): ForageNode[] {
  return [
    ...APPLE_SITES.map((point, index) => {
      const id = `ForageApple${String(index).padStart(3, '0')}`
      return { ...point, id, item: 'apple' as const, capacity: fruitTreeCapacity(id), fullAt: 0 }
    }),
    ...ORANGE_SITES.map((point, index) => {
      const id = `ForageOrange${String(index).padStart(3, '0')}`
      return { ...point, id, item: 'orange' as const, capacity: fruitTreeCapacity(id), fullAt: 0 }
    }),
    ...TRUFFLE_SITES.map((point, index) => ({ ...point, id: `ForageTruffle${String(index).padStart(3, '0')}`, item: 'truffle' as const, capacity: 1, fullAt: 0 })),
    ...DISCOVERY_SITES.map((point, index) => ({ ...point, id: `ForageDiscovery${String(index).padStart(2, '0')}`, item: 'natural-discovery' as const, capacity: 1, fullAt: 0 })),
  ]
}

function createPlayers(rng: Rng): Player[] {
  return ROUTES.map((route, id) => ({
    id, route, skill: 0.86 + rng.next() * 0.13, cash: MATCH_CONFIG.startingCash,
    zone: 'hub', position: { x: 0, z: 0 }, action: null,
    inventory: {}, tool: null, basket: 'hand', equipmentBasis: 0,
    farms: [], furnaces: 0, knownRecipes: [], cookJobs: [], metrics: emptyMetrics(),
  }))
}

function foodNeutral(recipe: RecipeId) { return RECIPES[recipe].group === 'early' ? 30 : RECIPES[recipe].group === 'middle' ? 15 : 8 }
function preparedFoodValue(recipeId: RecipeId, market: CommodityMarket, foodStock: number) {
  const recipe = RECIPES[recipeId]
  const ingredientValue = Object.entries(recipe.ingredients).reduce((sum, [item, quantity]) => {
    const id = item as CommodityId
    return sum + commodityPrice(id, ITEMS[id].sellPrice ?? 0, market[id]) * Number(quantity)
  }, 0)
  const stockRatio = foodNeutral(recipeId) / Math.max(1, foodStock)
  return Math.round(ingredientValue * recipe.multiplier * SIM_FOOD_VALUE_MULTIPLIER * Math.min(1.35, Math.max(0.75, stockRatio ** 0.5)))
}

function markedValue(player: Player, market: CommodityMarket, farms: Farm[], foodMarket: Record<RecipeId, number>) {
  let inventoryValue = 0
  for (const [rawId, rawQuantity] of Object.entries(player.inventory)) {
    const id = rawId as ItemId
    const quantity = rawQuantity ?? 0
    if (id.startsWith('food-')) {
      const recipe = id.slice(5) as RecipeId
      inventoryValue += preparedFoodValue(recipe, market, foodMarket[recipe]) * quantity
    } else if (id in COMMODITY_MARKET_CONFIG) {
      const commodity = id as CommodityId
      inventoryValue += marginalSale(commodity, ITEMS[id].sellPrice ?? 0, market[commodity], quantity).proceeds
    } else {
      inventoryValue += (ITEMS[id].buyPrice ?? ITEMS[id].sellPrice ?? 0) * quantity
    }
  }
  const plantedBasis = player.farms.reduce((sum, farmId) => {
    const farm = farms[farmId]
    return sum + (farm.crop ? CROP_CONFIG[farm.crop].seedPrice * farm.cells : 0)
  }, 0)
  return Math.round(player.cash + inventoryValue + player.equipmentBasis + plantedBasis + player.knownRecipes.length * 600_000)
}

function pickFarmCrop(player: Player): Crop {
  const recipeNeeds = new Map<Crop, number>()
  for (const recipeId of player.knownRecipes) {
    for (const [item, quantity] of Object.entries(RECIPES[recipeId].ingredients)) {
      if (item in CROP_CONFIG) recipeNeeds.set(item as Crop, (recipeNeeds.get(item as Crop) ?? 0) + Number(quantity))
    }
  }
  if (recipeNeeds.size) {
    return [...recipeNeeds].sort(([cropA, needA], [cropB, needB]) => {
      const coverageA = (player.inventory[cropA] ?? 0) / needA
      const coverageB = (player.inventory[cropB] ?? 0) / needB
      return coverageA - coverageB || CROP_CONFIG[cropA].growthSeconds - CROP_CONFIG[cropB].growthSeconds
    })[0][0]
  }
  const wealth = player.cash
  if (wealth >= 28_000_000) return 'watermelon'
  if (wealth >= 10_000_000) return 'pumpkin'
  if (wealth >= 4_000_000) return 'lettuce'
  if (wealth >= 1_200_000) return 'tomato'
  return 'wheat'
}

function schedule(player: Player, action: PlayerAction) {
  player.action = action
  player.metrics.productiveSeconds += action.productive
  player.metrics.travelSeconds += action.travel
}

function purchasePriority(player: Player, globalDeedsRemaining: number, elapsed: number): { purchase: 'pickaxe' | 'basket' | 'deed' | 'furnace' | 'recipe'; item?: ItemId; cost: number } | null {
  const reserve = 100_000
  const farmFocused = player.route === 'farm-lead' || player.route === 'farm-second'
  const forageFocused = player.route === 'forage'
  const wantsPersonalFarmAt = farmFocused ? 0 : forageFocused ? 900 : player.route === 'flex' ? 1200 : 1800

  // Farming is a mid/late engine, so a rational farm route buys the starter
  // pickaxe and uses early mining to finance its deed, furnace, and recipes.
  if (!player.tool && !forageFocused && player.cash >= PICKAXE_CONFIG['worn-pickaxe'].price) return { purchase: 'pickaxe', item: 'worn-pickaxe', cost: PICKAXE_CONFIG['worn-pickaxe'].price }
  if (player.tool === 'worn-pickaxe' && player.cash >= PICKAXE_CONFIG['iron-pickaxe'].price + reserve) return { purchase: 'pickaxe', item: 'iron-pickaxe', cost: PICKAXE_CONFIG['iron-pickaxe'].price }
  if (forageFocused && player.basket === 'hand' && player.cash >= BASKET_CONFIG.basket.price + reserve) return { purchase: 'basket', item: 'basket', cost: BASKET_CONFIG.basket.price }
  if (elapsed >= wantsPersonalFarmAt && player.farms.length === 0 && player.cash >= (ITEMS['farm-deed'].buyPrice ?? 0) + reserve) return { purchase: 'deed', item: 'farm-deed', cost: ITEMS['farm-deed'].buyPrice ?? 0 }
  if (player.route === 'farm-lead' && player.farms.length >= 1 && player.farms.length < 3 && globalDeedsRemaining > 0 && player.cash >= (ITEMS['farm-deed'].buyPrice ?? 0) + 800_000) return { purchase: 'deed', item: 'farm-deed', cost: ITEMS['farm-deed'].buyPrice ?? 0 }
  if (farmFocused && player.farms.length > 0 && player.furnaces === 0 && player.cash >= (ITEMS.furnace.buyPrice ?? 0) + 700_000) return { purchase: 'furnace', item: 'furnace', cost: ITEMS.furnace.buyPrice ?? 0 }
  if (farmFocused && player.furnaces > 0 && (player.inventory['cookbook-box'] ?? 0) > 0) return { purchase: 'recipe', item: 'cookbook-box', cost: 0 }
  if (farmFocused && player.furnaces === 1 && player.knownRecipes.length > 0 && elapsed >= 1_200 && player.cash >= (ITEMS.furnace.buyPrice ?? 0) + 700_000) return { purchase: 'furnace', item: 'furnace', cost: ITEMS.furnace.buyPrice ?? 0 }
  if (farmFocused && player.furnaces > 0 && player.knownRecipes.length < (elapsed < 1800 ? 3 : RECIPE_IDS.length) && player.cash >= (ITEMS['cookbook-box'].buyPrice ?? 0) + reserve) return { purchase: 'recipe', item: 'cookbook-box', cost: ITEMS['cookbook-box'].buyPrice ?? 0 }
  if (player.tool === 'iron-pickaxe' && elapsed >= 600 && player.cash >= PICKAXE_CONFIG['steel-pickaxe'].price + 300_000) return { purchase: 'pickaxe', item: 'steel-pickaxe', cost: PICKAXE_CONFIG['steel-pickaxe'].price }
  if (forageFocused && player.basket === 'basket' && elapsed >= 900 && player.cash >= BASKET_CONFIG['reinforced-basket'].price + 300_000) return { purchase: 'basket', item: 'reinforced-basket', cost: BASKET_CONFIG['reinforced-basket'].price }
  if (player.tool === 'steel-pickaxe' && elapsed >= 1500 && player.cash >= PICKAXE_CONFIG['crystal-pickaxe'].price + 500_000) return { purchase: 'pickaxe', item: 'crystal-pickaxe', cost: PICKAXE_CONFIG['crystal-pickaxe'].price }
  if (forageFocused && player.basket === 'reinforced-basket' && elapsed >= 1800 && player.cash >= BASKET_CONFIG['master-basket'].price + 500_000) return { purchase: 'basket', item: 'master-basket', cost: BASKET_CONFIG['master-basket'].price }
  return null
}

function chooseRecipeUnlock(player: Player, rng: Rng) {
  const locked = RECIPE_IDS.filter((id) => !player.knownRecipes.includes(id))
  const group = (['early', 'middle', 'late'] as const).find((candidate) => locked.some((id) => RECIPES[id].group === candidate))
  if (!group) return
  const eligible = locked.filter((id) => RECIPES[id].group === group)
  player.knownRecipes.push(eligible[rng.int(eligible.length)])
}

function cookingCandidate(player: Player, market: CommodityMarket, foodMarket: Record<RecipeId, number>) {
  let best: { recipe: RecipeId; quantity: number; score: number } | null = null
  const capacity = Math.max(10, player.furnaces * 10)
  for (const recipeId of player.knownRecipes) {
    const recipe = RECIPES[recipeId]
    const possible = Object.entries(recipe.ingredients).reduce((count, [item, needed]) => Math.min(count, Math.floor((player.inventory[item as ItemId] ?? 0) / Number(needed))), capacity)
    if (possible <= 0) continue
    const ingredientValue = Object.entries(recipe.ingredients).reduce((sum, [item, needed]) => {
      const id = item as CommodityId
      return sum + commodityPrice(id, ITEMS[id].sellPrice ?? 0, market[id]) * Number(needed)
    }, 0)
    const score = (preparedFoodValue(recipeId, market, foodMarket[recipeId]) - ingredientValue) / recipe.cookSeconds
    if (!best || score > best.score) best = { recipe: recipeId, quantity: possible, score }
  }
  return best
}

function forageLoad(player: Player) {
  return (player.inventory.apple ?? 0) + (player.inventory.orange ?? 0) + (player.inventory.truffle ?? 0) + (player.inventory['natural-discovery'] ?? 0)
}

function ingredientReserve(player: Player, item: ItemId) {
  if (!(player.route === 'farm-lead' || player.route === 'farm-second')) return 0
  return player.knownRecipes.reduce((maximum, recipeId) => Math.max(maximum, Number(RECIPES[recipeId].ingredients[item] ?? 0) * 10), 0)
}

function needsForageIngredients(player: Player) {
  return player.knownRecipes.some((recipeId) => Object.entries(RECIPES[recipeId].ingredients).some(([item, quantity]) => {
    return (item === 'apple' || item === 'orange' || item === 'truffle') && (player.inventory[item] ?? 0) < Number(quantity) * 6
  }))
}

function inventoryBaseValue(player: Player, categories: Array<'ore' | 'crop' | 'forage' | 'cooking'>) {
  return Object.entries(player.inventory).reduce((sum, [rawId, quantity]) => {
    const id = rawId as ItemId
    return categories.includes(ITEMS[id].category as 'ore' | 'crop' | 'forage' | 'cooking') ? sum + (ITEMS[id].sellPrice ?? 100_000) * (quantity ?? 0) : sum
  }, 0)
}

function simulateMatch(matchIndex: number): MatchResult {
  const matchSeed = 913_711 + matchIndex * 104_729
  const rng = new Rng(matchSeed)
  const players = createPlayers(rng)
  const mines: MineNode[] = MINE_NODE_SITES.map((site: { id: string; x: number; z: number }) => ({ ...site, generation: 0, readyAt: 0 }))
  const mineById = new Map(mines.map((node) => [node.id, node]))
  const forage = buildForageNodes()
  const forageById = new Map(forage.map((node) => [node.id, node]))
  const rareIds = forage.filter((node) => node.item === 'truffle' || node.item === 'natural-discovery').map((node) => node.id)
  const rareCollected = new Set<string>()
  const farms: Farm[] = Array.from({ length: FARM_COUNT }, (_, id) => ({ id, owner: null, crop: null, cells: 0, readyAt: 0 }))
  const farmCenters: Point[] = [{ x: -54, z: -16 }, { x: -18, z: -14 }, { x: 19, z: -17 }, { x: 55, z: -13 }, { x: -53, z: -50 }, { x: -17, z: -49 }, { x: 20, z: -53 }, { x: 56, z: -48 }]
  let globalDeedsRemaining = GLOBAL_EXPANSION_DEEDS
  const personalDeedUsed = new Set<number>()
  let expansionDeedsSold = 0
  let market = initialCommodityMarket()
  const foodMarket = Object.fromEntries(RECIPE_IDS.map((id) => [id, foodNeutral(id)])) as Record<RecipeId, number>
  const flow: Flow = { mined: {}, foraged: {}, harvested: {}, plantedCells: {}, cookedIngredients: {}, foodProduced: {}, sold: {} }
  const checkpoints: Record<number, number[]> = {}
  const appliedEventRewards = new Set<string>()
  const eventKinds: string[] = []
  let eventWallSeconds = 0
  let mineNodesDepleted = 0

  const sellInventory = (player: Player, zone: Exclude<Zone, 'hub'>, liquidate = false, countTrip = true) => {
    const allowedCategories = zone === 'mine' ? ['ore'] : zone === 'forage' ? ['forage'] : ['crop', 'cooking']
    for (const [rawId, rawQuantity] of Object.entries({ ...player.inventory })) {
      const id = rawId as ItemId
      const quantity = Math.max(0, Math.floor((rawQuantity ?? 0) - (liquidate ? 0 : ingredientReserve(player, id))))
      if (!quantity || !allowedCategories.includes(ITEMS[id].category)) continue
      let proceeds = 0
      if (id.startsWith('food-')) {
        const recipe = id.slice(5) as RecipeId
        for (let index = 0; index < quantity; index += 1) {
          proceeds += preparedFoodValue(recipe, market, foodMarket[recipe])
          foodMarket[recipe] += 1
        }
      } else if (id in COMMODITY_MARKET_CONFIG) {
        const commodity = id as CommodityId
        const baseValue = (ITEMS[id].sellPrice ?? 0) * (ITEMS[id].category === 'ore' ? SIM_ORE_VALUE_MULTIPLIER : 1)
        const sale = marginalSale(commodity, baseValue, market[commodity], quantity)
        proceeds = sale.proceeds
        market[commodity] = sale.stock
      } else {
        proceeds = (ITEMS[id].sellPrice ?? 0) * quantity
      }
      player.cash += proceeds
      inventoryAdd(player, id, -quantity)
      add(flow.sold, id, quantity)
    }
    if (countTrip) player.metrics.sellTrips += 1
  }

  const completeAction = (player: Player, elapsed: number) => {
    const action = player.action
    if (!action || action.completeAt > elapsed) return
    player.action = null
    player.position = action.target
    if (action.type === 'mine') {
      player.zone = 'mine'
      player.metrics.mineAttempts += 1
      const node = mineById.get(action.nodeId)!
      const ore = oreKindAtDepth(node.id, node.z, node.generation, matchSeed)
      if (node.readyAt > elapsed || !canMineOre(player.tool, ore)) {
        player.metrics.mineDenied += 1
        return
      }
      const quantity = miningYield(player.tool, () => rng.next())
      inventoryAdd(player, ore, quantity)
      add(flow.mined, ore, quantity)
      player.metrics.mineSuccesses += 1
      player.metrics.oreQuantity += quantity
      mineNodesDepleted += 1
      node.generation += 1
      node.readyAt = elapsed + oreRespawnMs(node.id, node.generation, matchSeed) / 1000
      return
    }
    if (action.type === 'forage') {
      player.zone = 'forage'
      const node = forageById.get(action.nodeId)!
      const capacityLeft = BASKET_CONFIG[player.basket].capacity - forageLoad(player)
      if (capacityLeft <= 0) return
      if (node.item === 'apple' || node.item === 'orange') {
        const available = forageSiteAvailability(node.id, node.fullAt, elapsed * 1000)
        const accepted = Math.min(available, capacityLeft)
        if (accepted <= 0) return
        const remaining = available - accepted
        node.fullAt = remaining >= node.capacity ? 0 : elapsed * 1000 + (node.capacity - remaining) * FRUIT_REGROW_MS
        inventoryAdd(player, node.item, accepted)
        add(flow.foraged, node.item, accepted)
        player.metrics.fruitQuantity += accepted
      } else {
        const cycleSeconds = node.item === 'truffle' ? 120 : 240
        const token = `${node.item}:${Math.floor(elapsed / cycleSeconds)}`
        const active = activeRareForageIds(rareIds, false, matchSeed, 0, elapsed * 1000)
        if (!active.has(node.id) || rareCollected.has(token)) return
        rareCollected.add(token)
        inventoryAdd(player, node.item, 1)
        add(flow.foraged, node.item, 1)
        player.metrics.rareQuantity += 1
      }
      return
    }
    if (action.type === 'sell') {
      player.zone = action.zone
      sellInventory(player, action.zone as Exclude<Zone, 'hub'>, Boolean(action.liquidate))
      return
    }
    if (action.type === 'plant') {
      player.zone = 'farm'
      const farm = farms[action.farmId]
      farm.crop = action.crop
      farm.cells = action.cells
      farm.readyAt = elapsed + CROP_CONFIG[action.crop].growthSeconds
      add(flow.plantedCells, action.crop, action.cells)
      player.metrics.cropsPlanted += action.cells
      return
    }
    if (action.type === 'harvest') {
      player.zone = 'farm'
      const farm = farms[action.farmId]
      if (!farm.crop || farm.readyAt > elapsed) return
      const quantity = farm.cells * CROP_CONFIG[farm.crop].yield
      inventoryAdd(player, farm.crop, quantity)
      add(flow.harvested, farm.crop, quantity)
      player.metrics.farmHarvestQuantity += quantity
      farm.crop = null
      farm.cells = 0
      farm.readyAt = 0
      return
    }
    if (action.type === 'shop') {
      player.zone = action.purchase === 'basket' ? 'forage' : action.purchase === 'pickaxe' ? 'mine' : action.purchase === 'deed' || action.purchase === 'recipe' ? 'hub' : 'farm'
      if (action.purchase === 'pickaxe' && action.item) player.tool = action.item as PickaxeItem
      if (action.purchase === 'basket' && action.item) player.basket = action.item as keyof typeof BASKET_CONFIG
      if (action.purchase === 'furnace') player.furnaces += 1
      if (action.purchase === 'recipe') {
        if ((player.inventory['cookbook-box'] ?? 0) > 0) inventoryAdd(player, 'cookbook-box', -1)
        chooseRecipeUnlock(player, rng)
      }
      if (action.purchase === 'deed') {
        const openFarm = farms.find((farm) => farm.owner === null)
        if (openFarm) {
          const personal = !personalDeedUsed.has(player.id)
          if (personal) personalDeedUsed.add(player.id)
          else {
            globalDeedsRemaining -= 1
            expansionDeedsSold += 1
          }
          openFarm.owner = player.id
          player.farms.push(openFarm.id)
        }
      }
      return
    }
  }

  const scheduleShop = (player: Player, elapsed: number, purchase: ReturnType<typeof purchasePriority>) => {
    if (!purchase) return false
    const target = purchase.purchase === 'pickaxe' ? { x: -7, z: 18 }
      : purchase.purchase === 'basket' ? { x: -8, z: 18 }
        : purchase.purchase === 'furnace' ? { x: 10, z: 10 }
          : { x: 0, z: 0 }
    const zone: Zone = purchase.purchase === 'pickaxe' ? 'mine' : purchase.purchase === 'basket' ? 'forage' : purchase.purchase === 'furnace' ? 'farm' : 'hub'
    const travel = travelSeconds(player, zone, target)
    player.cash -= purchase.cost
    player.equipmentBasis += purchase.cost
    schedule(player, { type: 'shop', completeAt: elapsed + Math.ceil(travel + 4), purchase: purchase.purchase, item: purchase.item, target, productive: 2, travel })
    return true
  }

  const scheduleCook = (player: Player, elapsed: number) => {
    if (!player.furnaces || player.cookJobs.length >= player.furnaces * 3) return false
    const candidate = cookingCandidate(player, market, foodMarket)
    if (!candidate) return false
    const recipe = RECIPES[candidate.recipe]
    const lastReady = player.cookJobs.reduce((latest, job) => Math.max(latest, job.readyAt), elapsed)
    if (lastReady + recipe.cookSeconds > MATCH_SECONDS - 90) return false
    for (const [rawItem, rawNeeded] of Object.entries(recipe.ingredients)) {
      const item = rawItem as ResourceItem
      const needed = Number(rawNeeded) * candidate.quantity
      inventoryAdd(player, item as ItemId, -needed)
      add(flow.cookedIngredients, item, needed)
    }
    player.cookJobs.push({ recipe: candidate.recipe, quantity: candidate.quantity, readyAt: lastReady + recipe.cookSeconds })
    const target = farmCenters[player.farms[0] ?? 0]
    const travel = travelSeconds(player, 'farm', target)
    schedule(player, { type: 'cook', completeAt: elapsed + Math.ceil(travel + 3), target, productive: 3, travel })
    return true
  }

  const scheduleFarm = (player: Player, elapsed: number) => {
    for (const farmId of player.farms) {
      const farm = farms[farmId]
      const target = farmCenters[farmId]
      if (farm.crop && farm.readyAt <= elapsed) {
        const travel = travelSeconds(player, 'farm', target)
        const productive = 6 + farm.cells * FARM_ACTION_SECONDS
        schedule(player, { type: 'harvest', completeAt: elapsed + Math.ceil(travel + productive), farmId, target, productive, travel })
        return true
      }
    }
    for (const farmId of player.farms) {
      const farm = farms[farmId]
      if (farm.crop) continue
      const crop = pickFarmCrop(player)
      const cropConfig = CROP_CONFIG[crop]
      const cells = Math.min(FARM_CELLS, Math.floor(Math.max(0, player.cash - 100_000) / cropConfig.seedPrice))
      if (cells < 8) continue
      const fullCycleSeconds = cropConfig.growthSeconds + 16 + cells * FARM_ACTION_SECONDS * 2
      if (elapsed + fullCycleSeconds > MATCH_SECONDS - 90) continue
      player.cash -= cells * cropConfig.seedPrice
      const target = farmCenters[farmId]
      const travel = travelSeconds(player, 'farm', target)
      const productive = 8 + cells * FARM_ACTION_SECONDS
      schedule(player, { type: 'plant', completeAt: elapsed + Math.ceil(travel + productive), farmId, crop, cells, target, productive, travel })
      return true
    }
    return false
  }

  const scheduleSell = (player: Player, elapsed: number, force = false) => {
    const hasOre = inventoryBaseValue(player, ['ore']) >= 350_000
    const sellableFarmValue = Object.entries(player.inventory).reduce((sum, [rawId, rawQuantity]) => {
      const id = rawId as ItemId
      if (!['crop', 'cooking'].includes(ITEMS[id].category)) return sum
      const quantity = Math.max(0, (rawQuantity ?? 0) - ingredientReserve(player, id))
      if (id.startsWith('food-')) {
        const recipe = id.slice(5) as RecipeId
        return sum + quantity * preparedFoodValue(recipe, market, foodMarket[recipe])
      }
      return sum + quantity * (ITEMS[id].sellPrice ?? 100_000)
    }, 0)
    const hasFarm = sellableFarmValue >= 450_000
    const forageThreshold = forageLoad(player) >= Math.max(8, BASKET_CONFIG[player.basket].capacity * 0.72)
    const hasAnyOre = inventoryBaseValue(player, ['ore']) > 0
    const hasAnyFarm = sellableFarmValue > 0
    const hasAnyForage = forageLoad(player) > 0
    if (!(force ? hasAnyOre || hasAnyFarm || hasAnyForage : hasOre || hasFarm || forageThreshold)) return false
    const zone: Zone = (force ? hasAnyForage : forageThreshold) ? 'forage' : (force ? hasAnyFarm : hasFarm) ? 'farm' : 'mine'
    const hasCookedFood = Object.entries(player.inventory).some(([id, quantity]) => id.startsWith('food-') && (quantity ?? 0) > 0)
    const target = zone === 'mine' ? { x: 7, z: 18 } : zone === 'forage' ? { x: 8, z: 18 } : hasCookedFood ? { x: 13, z: 9 } : { x: 7, z: 9 }
    const travel = travelSeconds(player, zone, target)
    schedule(player, { type: 'sell', completeAt: elapsed + Math.ceil(travel + 4), zone, target, productive: 2, travel, liquidate: force })
    return true
  }

  const scheduleForage = (player: Player, elapsed: number) => {
    if (forageLoad(player) >= BASKET_CONFIG[player.basket].capacity) return false
    const activeRare = activeRareForageIds(rareIds, false, matchSeed, 0, elapsed * 1000)
    const available = forage.filter((node) => {
      if (node.item === 'apple' || node.item === 'orange') return forageSiteAvailability(node.id, node.fullAt, elapsed * 1000) > 0
      const cycleSeconds = node.item === 'truffle' ? 120 : 240
      return activeRare.has(node.id) && !rareCollected.has(`${node.item}:${Math.floor(elapsed / cycleSeconds)}`)
    })
    if (!available.length) return false
    const origin = player.zone === 'forage' ? player.position : zoneSpawn.forage
    const targetNode = available.reduce((best, node) => {
      const value = ITEMS[node.item].sellPrice ?? 0
      const score = distance(origin, node) - Math.min(42, value / 8_000)
      return !best || score < best.score ? { node, score } : best
    }, null as { node: ForageNode; score: number } | null)!.node
    const travel = travelSeconds(player, 'forage', targetNode)
    schedule(player, { type: 'forage', completeAt: elapsed + Math.ceil(travel + 1.2), nodeId: targetNode.id, target: targetNode, productive: 1.2, travel })
    return true
  }

  const scheduleMine = (player: Player, elapsed: number) => {
    const lane = player.id % 2 === 0 ? -1 : 1
    const origin = player.zone === 'mine' ? player.position : zoneSpawn.mine
    let target: { node: MineNode; score: number } | null = null
    for (const node of mines) {
      if (node.readyAt > elapsed) continue
      const ore = oreKindAtDepth(node.id, node.z, node.generation, matchSeed)
      if (!canMineOre(player.tool, ore)) continue
      const move = distance(origin, node) / (MOVE_SPEED * player.skill)
      const mining = miningDuration(player.tool, ore) / 1000 / player.skill
      const lanePenalty = node.x * lane < -4 ? 1.8 : 0
      const valueBonus = Math.log10(ORE_CONFIG[ore].value) * 0.18
      const score = move + mining + lanePenalty - valueBonus
      if (!target || score < target.score) target = { node, score }
    }
    if (!target) {
      player.metrics.mineWaitSeconds += 1
      return false
    }
    const ore = oreKindAtDepth(target.node.id, target.node.z, target.node.generation, matchSeed)
    const travel = travelSeconds(player, 'mine', target.node)
    const productive = miningDuration(player.tool, ore) / 1000 / player.skill + 0.45
    schedule(player, { type: 'mine', completeAt: elapsed + Math.ceil(travel + productive), nodeId: target.node.id, target: target.node, productive, travel })
    return true
  }

  const runMinigame = (elapsed: number) => {
    const kind = scheduledMinigame(elapsed, matchSeed, MATCH_SECONDS)
    eventKinds.push(kind)
    const values = players.map((player) => markedValue(player, market, farms, foodMarket))
    const economyReference = median(values)
    const leaderProgress = Math.max(...values)
    const scored = players.map((player) => {
      const affinity = kind === 'mining' && player.route.startsWith('miner') ? 0.16
        : kind === 'farm' && player.route.startsWith('farm') ? 0.16
          : kind === 'forage' && player.route === 'forage' ? 0.16 : 0
      return { player, score: Math.round(1000 * (player.skill + affinity + rng.next() * 0.16)) }
    }).sort((a, b) => b.score - a.score || a.player.id - b.player.id)
    for (let index = 0; index < scored.length; index += 1) {
      const { player } = scored[index]
      const key = `${elapsed}:${player.id}`
      assert(!appliedEventRewards.has(key), `reward applied twice: ${key}`)
      appliedEventRewards.add(key)
      const reward = minigameRewards({ economyReference, placement: index + 1, playerProgress: values[player.id], leaderProgress, matchSeed, milestone: elapsed, playerId: `sim-${matchIndex}-${player.id}` })
      player.cash += reward.cash
      for (const roll of reward.itemRolls) for (const item of roll.items) inventoryAdd(player, item.itemId, item.quantity)
      player.metrics.rewardsApplied += 1
    }
    const readySeconds = 5 + rng.int(11)
    eventWallSeconds += readySeconds + MINIGAME_DURATION[kind]
  }

  const milestones = new Set(minigameMilestones(MATCH_SECONDS))
  for (let elapsed = 0; elapsed <= MATCH_SECONDS; elapsed += 1) {
    if (elapsed > 0 && elapsed % MATCH_CONFIG.commodityCycleSeconds === 0) market = advanceCommodityCycle(market, elapsed / MATCH_CONFIG.commodityCycleSeconds, 'clear', matchSeed)
    if (elapsed > 0 && elapsed % MATCH_CONFIG.worldCycleSeconds === 0) {
      const roundNumber = elapsed / MATCH_CONFIG.worldCycleSeconds
      RECIPE_IDS.forEach((id, index) => {
        const demandBase = RECIPES[id].group === 'early' ? 8 : RECIPES[id].group === 'middle' ? 4 : 2
        const demand = Math.max(1, demandBase + ((roundNumber + index * 3) % 3) - 1)
        foodMarket[id] = Math.max(1, foodMarket[id] - demand)
      })
    }
    if (milestones.has(elapsed)) runMinigame(elapsed)

    const order = players.map((_, index) => index).sort((a, b) => ((a * 17 + elapsed * 31 + matchIndex) % 23) - ((b * 17 + elapsed * 31 + matchIndex) % 23))
    for (const playerIndex of order) {
      const player = players[playerIndex]
      const completed = player.cookJobs.filter((job) => job.readyAt <= elapsed)
      player.cookJobs = player.cookJobs.filter((job) => job.readyAt > elapsed)
      for (const job of completed) {
        inventoryAdd(player, RECIPES[job.recipe].food, job.quantity)
        add(flow.foodProduced, RECIPES[job.recipe].food, job.quantity)
        player.metrics.dishesCooked += job.quantity
      }
      completeAction(player, elapsed)
      if (elapsed === MATCH_SECONDS || player.action) continue

      // Cash wins the match. Rational players stop starting long jobs near the
      // bell and make the remaining market trips needed to liquidate.
      if (elapsed >= MATCH_SECONDS - 120) {
        if (scheduleSell(player, elapsed, true)) continue
        player.metrics.idleSeconds += 1
        continue
      }
      const purchase = purchasePriority(player, globalDeedsRemaining, elapsed)
      if (scheduleShop(player, elapsed, purchase)) continue
      if ((player.route === 'farm-lead' || player.route === 'farm-second') && scheduleCook(player, elapsed)) continue
      if (player.farms.length && scheduleFarm(player, elapsed)) continue
      if (needsForageIngredients(player) && scheduleForage(player, elapsed)) continue
      if (scheduleSell(player, elapsed)) continue

      const forageBias = player.route === 'forage' || (player.route === 'flex' && elapsed % 600 >= 360)
      if (forageBias && scheduleForage(player, elapsed)) continue
      if (scheduleMine(player, elapsed)) continue
      if (scheduleForage(player, elapsed)) continue
      player.metrics.idleSeconds += 1
    }
    if (CHECKPOINTS.includes(elapsed as typeof CHECKPOINTS[number])) checkpoints[elapsed] = players.map((player) => markedValue(player, market, farms, foodMarket))
  }

  // Snapshot real cash at the bell. The cleanup sales below are accounting-only
  // so mass-balance assertions can still prove that no resources were duplicated.
  const finalCash = players.map((player) => player.cash)
  players.forEach((player) => {
    sellInventory(player, 'mine', true, false)
    sellInventory(player, 'forage', true, false)
    sellInventory(player, 'farm', true, false)
  })

  const flowSources = { ...flow.foraged, ...flow.harvested } as Partial<Record<ResourceItem, number>>
  for (const [item, consumed] of Object.entries(flow.cookedIngredients) as Array<[ResourceItem, number]>) {
    assert(consumed <= (flowSources[item] ?? 0), `${item} cooking consumed ${consumed}, sourced ${flowSources[item] ?? 0}`)
  }
  for (const crop of Object.keys(CROP_CONFIG) as Crop[]) assert((flow.harvested[crop] ?? 0) <= (flow.plantedCells[crop] ?? 0) * CROP_CONFIG[crop].yield, `${crop} harvest exceeded planted yield`)
  for (const ore of Object.keys(ORE_CONFIG) as OreItem[]) assert.equal(flow.mined[ore] ?? 0, flow.sold[ore] ?? 0, `${ore} mass did not close after liquidation`)
  for (const item of ['apple', 'orange', 'truffle', 'natural-discovery'] as ForageItem[]) {
    assert.equal(flow.foraged[item] ?? 0, (flow.sold[item] ?? 0) + (flow.cookedIngredients[item] ?? 0), `${item} mass did not close after liquidation`)
  }
  for (const crop of Object.keys(CROP_CONFIG) as Crop[]) assert.equal(flow.harvested[crop] ?? 0, (flow.sold[crop] ?? 0) + (flow.cookedIngredients[crop] ?? 0), `${crop} mass did not close after liquidation`)
  for (const recipeId of RECIPE_IDS) {
    const food = RECIPES[recipeId].food
    assert.equal(flow.foodProduced[food] ?? 0, flow.sold[food] ?? 0, `${food} mass did not close after liquidation`)
  }
  assert(farms.filter((farm) => farm.owner !== null).length <= FARM_COUNT, 'more than eight farms were claimed')
  assert(globalDeedsRemaining >= 0 && expansionDeedsSold <= GLOBAL_EXPANSION_DEEDS, 'global expansion deed stock went negative')
  assert(players.every((player) => player.farms.length <= 3), 'a player exceeded the intentional three-farm maximum')
  assert(appliedEventRewards.size === PLAYER_COUNT * 2, 'minigame rewards were not applied exactly once')
  assert(new Set(eventKinds).size === 2, 'the two scheduled minigames were not distinct')

  const fruitInitialCapacity = forage.filter((node) => node.item === 'apple' || node.item === 'orange').reduce((sum, node) => sum + node.capacity, 0)
  const fruitHarvested = (flow.foraged.apple ?? 0) + (flow.foraged.orange ?? 0)
  const fruitCeiling = fruitInitialCapacity + (APPLE_SITES.length + ORANGE_SITES.length) * Math.ceil(MATCH_SECONDS / (FRUIT_REGROW_MS / 1000))
  assert(fruitHarvested <= fruitCeiling, `fruit mass exceeded capacity/regeneration ceiling: ${fruitHarvested} > ${fruitCeiling}`)
  assert(mineNodesDepleted === players.reduce((sum, player) => sum + player.metrics.mineSuccesses, 0), 'mine node depletion and successful requests diverged')

  return { checkpoints, finalCash, players, wallSeconds: MATCH_SECONDS + eventWallSeconds, minigames: eventKinds, mineNodesDepleted, fruitInitialCapacity, fruitHarvested, expansionDeedsSold, flow }
}

assert.equal(MINE_NODE_SITES.length, 278, 'live shared mine layout no longer has 278 nodes')
assert.equal(APPLE_SITES.length, 70, 'apple site mirror drifted from server')
assert.equal(ORANGE_SITES.length, 60, 'orange site mirror drifted from server')
assert.equal(TRUFFLE_SITES.length, 5, 'truffle site mirror drifted from server')
assert.equal(DISCOVERY_SITES.length, 3, 'discovery site mirror drifted from server')
assert.equal(buildForageNodes().length, 138, 'shared forage layout no longer has 138 nodes')
assert.equal(FARM_COUNT, PLAYER_COUNT + GLOBAL_EXPANSION_DEEDS)

const results: MatchResult[] = []
for (let run = 0; run < RUNS; run += 1) results.push(simulateMatch(run))

const checkpointRows = CHECKPOINTS.map((seconds) => {
  const values = results.flatMap((result) => result.checkpoints[seconds])
  return { minute: seconds / 60, p10: Math.round(percentile(values, 0.1)), p50: Math.round(percentile(values, 0.5)), p90: Math.round(percentile(values, 0.9)) }
})
const liquidCash = results.flatMap((result) => result.finalCash)
const liquidCashRow = {
  p10: Math.round(percentile(liquidCash, 0.1)),
  p50: Math.round(percentile(liquidCash, 0.5)),
  p90: Math.round(percentile(liquidCash, 0.9)),
}
const routeRows = ROUTES.map((route) => {
  const players = results.map((result) => result.players.find((player) => player.route === route)!)
  const finalValues = results.map((result, index) => result.checkpoints[3600][players[index].id])
  return {
    route,
    p10: Math.round(percentile(finalValues, 0.1)), p50: Math.round(percentile(finalValues, 0.5)), p90: Math.round(percentile(finalValues, 0.9)),
    medianCash: Math.round(median(results.map((result, index) => result.finalCash[players[index].id]))),
    farms: Number(median(players.map((player) => player.farms.length)).toFixed(1)),
    dishes: Math.round(median(players.map((player) => player.metrics.dishesCooked))),
    tool: mode(players.map((player) => player.tool ?? 'none')), basket: mode(players.map((player) => player.basket)),
    mineDenial: ratio(median(players.map((player) => player.metrics.mineDenied / Math.max(1, player.metrics.mineAttempts)))),
    downtime: ratio(median(players.map((player) => (player.metrics.travelSeconds + player.metrics.idleSeconds + player.metrics.mineWaitSeconds) / MATCH_SECONDS))),
  }
})

const firstHalf = results.slice(0, Math.floor(results.length / 2)).flatMap((result) => result.checkpoints[3600])
const secondHalf = results.slice(Math.floor(results.length / 2)).flatMap((result) => result.checkpoints[3600])
const splitMedianA = median(firstHalf)
const splitMedianB = median(secondHalf)
const stabilityDelta = Math.abs(splitMedianA - splitMedianB) / Math.max(1, (splitMedianA + splitMedianB) / 2)
const allPlayers = results.flatMap((result) => result.players)
const farmOwnership = results.map((result) => result.players.reduce((sum, player) => sum + player.farms.length, 0))
const expansionSales = results.map((result) => result.expansionDeedsSold)
const wallTimes = results.map((result) => result.wallSeconds)
const uniqueEventPairs = new Set(results.map((result) => result.minigames.join('+')))
const winnerCounts = Object.fromEntries(ROUTES.map((route) => [route, 0])) as Record<Route, number>
for (const result of results) {
  const winningCash = Math.max(...result.finalCash)
  const winner = result.players.find((player) => result.finalCash[player.id] === winningCash)!
  winnerCounts[winner.route] += 1
}
const mineDenialShare = allPlayers.reduce((sum, player) => sum + player.metrics.mineDenied, 0) / Math.max(1, allPlayers.reduce((sum, player) => sum + player.metrics.mineAttempts, 0))
const mineWaitShare = allPlayers.reduce((sum, player) => sum + player.metrics.mineWaitSeconds, 0) / (RUNS * PLAYER_COUNT * MATCH_SECONDS)
const totalFruit = results.reduce((sum, result) => sum + result.fruitHarvested, 0)
const totalFruitCeiling = results.reduce((sum, result) => sum + result.fruitInitialCapacity + 130 * Math.ceil(MATCH_SECONDS / 30), 0)

console.log(`\nSix-player accelerated hour · ${RUNS} deterministic matches · ${RUNS * PLAYER_COUNT} player-runs`)
console.table(checkpointRows.map((row) => ({ minute: row.minute, P10: money(row.p10), P50: money(row.p50), P90: money(row.p90) })))
console.table([{ checkpoint: '60m liquid cash', P10: money(liquidCashRow.p10), P50: money(liquidCashRow.p50), P90: money(liquidCashRow.p90) }])
console.table(routeRows.map((row) => ({ route: row.route, P10: money(row.p10), P50: money(row.p50), P90: money(row.p90), finalCash: money(row.medianCash), farms: row.farms, dishes: row.dishes, tool: row.tool, basket: row.basket, mineDenial: row.mineDenial, downtime: row.downtime })))
console.table(ROUTES.map((route) => ({ route, wins: winnerCounts[route], share: ratio(winnerCounts[route] / RUNS) })))

console.log(JSON.stringify({
  status: 'passed-physical-invariants',
  runs: RUNS,
  liquidCashAt60m: liquidCashRow,
  sharedWorld: { mineNodes: MINE_NODE_SITES.length, forageNodes: buildForageNodes().length, farms: FARM_COUNT, players: PLAYER_COUNT },
  stability: { splitHalfP50A: Math.round(splitMedianA), splitHalfP50B: Math.round(splitMedianB), delta: ratio(stabilityDelta), note: stabilityDelta <= 0.05 ? 'stable' : 'review sample variance' },
  contention: { mineDenialShare: ratio(mineDenialShare), mineNoReadyWaitShare: ratio(mineWaitShare) },
  capacity: { fruitHarvested: totalFruit, conservativeFruitCeiling: totalFruitCeiling, utilization: ratio(totalFruit / totalFruitCeiling) },
  ownership: { medianTeamFarms: median(farmOwnership), medianExpansionDeedsSold: median(expansionSales), maxPlayerFarms: Math.max(...allPlayers.map((player) => player.farms.length)) },
  winners: Object.fromEntries(ROUTES.map((route) => [route, { wins: winnerCounts[route], share: ratio(winnerCounts[route] / RUNS) }])),
  events: { observedPairs: [...uniqueEventPairs], medianWallMinutes: Number((median(wallTimes) / 60).toFixed(1)), rewardsAppliedExactlyOnce: true },
  scope: 'Content routes only; stock speculation, trading, lottery, enhancements, and secret information are intentionally excluded.',
}, null, 2))

if (stabilityDelta > 0.05) console.warn(`WARNING: split-half P50 differs by ${ratio(stabilityDelta)}; increase SIM_RUNS before making tuning decisions.`)
