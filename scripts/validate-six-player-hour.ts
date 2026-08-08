import assert from 'node:assert/strict'
import { BASKET_CONFIG, COMMODITY_MARKET_CONFIG, CROP_CONFIG, FORAGE_CONFIG, MATCH_CONFIG, ORE_CONFIG, PICKAXE_CONFIG, activeRareForageIds, forageSiteAvailability, fortuneBonus, fruitTreeCapacity, marketCorrectionMilestones, type CommodityId } from '../src/game/config'
import { commodityPrice, initialCommodityMarket, marginalSale, settleCommoditySale, type CommodityMarket } from '../src/game/economy'
import { ITEMS, STOCKS, type ItemId, type StockId } from '../src/game/items'
import { advanceMarketCycle, createInitialStockHistory, createInitialStockPrices, createInitialStockSupply, marketCorrectionFor, STOCK_IDS } from '../src/game/market'
import { enhancedBasketCapacity, enhancementChance, enhancementLevel, enhancementRequirements, enhancementResultLevel, expectedFortune as enhancementExpectedFortune, fortuneFor as enhancementFortune, resolveEnhancementAttempt, type EnhanceableItem, type EnhancementLevels } from '../src/game/enhancement'
import { MINIGAME_DURATION, minigameMilestones, minigameRewards, scheduledMinigame } from '../src/game/minigame'
import { canMineOre, miningDuration, miningYield, oreKindAtDepth, oreRespawnMs, type OreItem, type PickaxeItem } from '../src/game/ore'
import { PREPARED_FOOD_BASE_VALUE, PREPARED_FOOD_MARKUP, RECIPES, RECIPE_IDS, type FoodItemId, type RecipeId } from '../src/game/recipes'
import { MINE_NODE_SITES } from '../shared/mine-nodes.js'

const PLAYER_COUNT = Math.max(1, Math.min(6, Number.parseInt(process.env.SIM_PLAYER_COUNT ?? '6', 10) || 6))
const FARM_COUNT = 8
const GLOBAL_EXPANSION_DEEDS = Math.max(0, Math.min(FARM_COUNT - PLAYER_COUNT, Number.parseInt(process.env.SIM_GLOBAL_DEEDS ?? String(FARM_COUNT - PLAYER_COUNT), 10)))
const MATCH_MINUTES = Math.max(30, Math.min(180, Number.parseInt(process.env.SIM_MATCH_MINUTES ?? '60', 10) || 60))
const MATCH_SECONDS = MATCH_MINUTES * 60
const RUNS = Math.max(1, Number.parseInt(process.env.SIM_RUNS ?? '48', 10) || 48)
const SEED_OFFSET = Math.max(0, Number.parseInt(process.env.SIM_SEED_OFFSET ?? '0', 10) || 0)
const SIM_FOOD_VALUE_MULTIPLIER = Math.max(.1, Number(process.env.SIM_FOOD_VALUE_MULTIPLIER) || PREPARED_FOOD_MARKUP)
const SIM_FOOD_BASE_SCALE = Math.max(0, Number(process.env.SIM_FOOD_BASE_SCALE) || 1)
const SIM_ORE_VALUE_MULTIPLIER = Math.max(.1, Number(process.env.SIM_ORE_VALUE_MULTIPLIER) || 1)
const POPULATION_AUDIT = process.env.SIM_POPULATION_AUDIT === '1'
const POPULATION_RUNS = Math.max(1, Number.parseInt(process.env.SIM_POPULATION_RUNS ?? '8', 10) || 8)
const MOVE_SPEED = 8.4
const FARM_CELLS = 64
const FARM_ACTION_SECONDS = 0.75
const LIQUIDATION_SECONDS = 4 * 60
const OPTIMIZER_REVIEW_SECONDS = 45
const FRUIT_REGROW_MS = FORAGE_CONFIG.apple.fruitRegrowSeconds * 1000
const CHECKPOINTS = [...new Set([Math.min(600, MATCH_SECONDS), Math.min(1800, MATCH_SECONDS), MATCH_SECONDS])].sort((a, b) => a - b)
const ROUTES = ['optimizer-a', 'optimizer-b', 'farm-cook-mine', 'farm-cook-forage', 'mine-only', 'forage-only'] as const
const ACTIVE_ROUTES = ROUTES.slice(0, PLAYER_COUNT)

type Route = typeof ROUTES[number]
type Crop = keyof typeof CROP_CONFIG
type ForageItem = 'apple' | 'orange' | 'truffle' | 'natural-discovery'
type ResourceItem = Crop | ForageItem | OreItem
type Zone = 'hub' | 'mine' | 'farm' | 'forage'
type SimWeather = 'rain' | 'mist' | 'clear' | 'sunny' | 'breeze'
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
  { x: -10, z: -96 }, { x: 20, z: -104 }, { x: -28, z: -121 }, { x: 30, z: -132 },
  ...orchardSites(-49, -44, 8, 6101), ...orchardSites(54, -117, 12, 6127),
  ...orchardSites(-64, -181, 12, 6151), ...distributedFruitSites(34, 6173),
]
const ORANGE_SITES = [
  { x: 11, z: -99 }, { x: -24, z: -109 }, { x: 27, z: -118 },
  ...orchardSites(54, -69, 9, 6203), ...orchardSites(-52, -124, 12, 6229),
  ...distributedFruitSites(36, 6257),
]
const TRUFFLE_SITES = [{ x: -112, z: -66 }, { x: 97, z: -104 }, { x: -78, z: -204 }, { x: 126, z: -167 }, { x: 34, z: -151 }]
const DISCOVERY_SITES = [{ x: -178, z: -185 }, { x: 164, z: -201 }, { x: -139, z: -16 }]

type MineNode = { id: string; x: number; z: number; generation: number; readyAt: number }
type ForageNode = { id: string; item: ForageItem; x: number; z: number; capacity: number; fullAt: number }
type Planting = { id: number; crop: Crop; cells: number; readyAt: number }
type Farm = { id: number; owner: number | null; plantings: Planting[]; nextPlantingId: number }
type CookJob = { recipe: RecipeId; quantity: number; readyAt: number }
type StockTrade = { id: StockId; direction: 'buy' | 'sell'; quantity: number; unitPrice: number; removedBasis: number }
type PlayerAction =
  | { type: 'mine'; completeAt: number; nodeId: string; target: Point; productive: number; travel: number }
  | { type: 'forage'; completeAt: number; nodeId: string; target: Point; productive: number; travel: number }
  | { type: 'sell'; completeAt: number; zone: Zone; target: Point; productive: number; travel: number; liquidate?: boolean }
  | { type: 'plant'; completeAt: number; farmId: number; crop: Crop; cells: number; target: Point; productive: number; travel: number }
  | { type: 'harvest'; completeAt: number; farmId: number; plantingId: number; target: Point; productive: number; travel: number }
  | { type: 'shop'; completeAt: number; purchase: 'pickaxe' | 'basket' | 'deed' | 'water' | 'furnace' | 'recipe'; item?: ItemId; deedKind?: 'personal' | 'global'; target: Point; productive: number; travel: number }
  | { type: 'cook'; completeAt: number; target: Point; productive: number; travel: number }
  | { type: 'stock'; completeAt: number; trades: StockTrade[]; target: Point; productive: number; travel: number }
  | { type: 'enhance'; completeAt: number; item: EnhanceableItem; target: Point; productive: number; travel: number }

type PurchaseChoice = {
  purchase: 'pickaxe' | 'basket' | 'deed' | 'water' | 'furnace' | 'recipe'
  item?: ItemId
  cost: number
  projectedNpv?: number
  rationale?: string
}

type Metrics = {
  mineAttempts: number; mineSuccesses: number; mineDenied: number; mineWaitSeconds: number
  oreQuantity: number; fruitQuantity: number; rareQuantity: number; farmHarvestQuantity: number
  dishesCooked: number; cropsPlanted: number; sellTrips: number; travelSeconds: number
  productiveSeconds: number; idleSeconds: number; rewardsApplied: number; rewardCash: number
  optimizerPurchases: number; projectedInvestmentNpv: number
  stockTrades: number; stockRealizedProfit: number; stockInfoCost: number
  enhancementAttempts: number; enhancementSuccesses: number; enhancementCoinCost: number
}

type Player = {
  id: number; route: Route; skill: number; cash: number; zone: Zone; position: Point
  action: PlayerAction | null; inventory: Inventory; tool: PickaxeItem | null; basket: keyof typeof BASKET_CONFIG
  equipmentBasis: number; farms: number[]; waterCan: boolean; furnaces: number; knownRecipes: RecipeId[]; preferredRecipe: RecipeId | null; cookJobs: CookJob[]
  portfolio: Record<StockId, number>; stockCostBasis: Record<StockId, number>; marketReviewRevision: number; informedCorrections: number[]
  enhancements: EnhancementLevels
  optimizedLane: 'mine' | 'forage' | null
  metrics: Metrics
}

type Flow = {
  mined: Partial<Record<OreItem, number>>
  foraged: Partial<Record<ForageItem, number>>
  harvested: Partial<Record<Crop, number>>
  plantedCells: Partial<Record<Crop, number>>
  cookedIngredients: Partial<Record<ResourceItem, number>>
  enhancementConsumed: Partial<Record<ResourceItem, number>>
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
  fruitWorldPicked: number
  expansionDeedsSold: number
  flow: Flow
}

const emptyMetrics = (): Metrics => ({
  mineAttempts: 0, mineSuccesses: 0, mineDenied: 0, mineWaitSeconds: 0,
  oreQuantity: 0, fruitQuantity: 0, rareQuantity: 0, farmHarvestQuantity: 0,
  dishesCooked: 0, cropsPlanted: 0, sellTrips: 0, travelSeconds: 0,
  productiveSeconds: 0, idleSeconds: 0, rewardsApplied: 0, rewardCash: 0,
  optimizerPurchases: 0, projectedInvestmentNpv: 0,
  stockTrades: 0, stockRealizedProfit: 0, stockInfoCost: 0,
  enhancementAttempts: 0, enhancementSuccesses: 0, enhancementCoinCost: 0,
})

const isOptimizer = (route: Route) => route === 'optimizer-a' || route === 'optimizer-b'
const isFarmCook = (route: Route) => route === 'farm-cook-mine' || route === 'farm-cook-forage'
const usesFarm = (route: Route) => isOptimizer(route) || isFarmCook(route)
const usesMine = (route: Route) => isOptimizer(route) || route === 'farm-cook-mine' || route === 'mine-only'
const usesForage = (route: Route) => isOptimizer(route) || route === 'farm-cook-forage' || route === 'forage-only'
const PICKAXE_ORDER = ['worn-pickaxe', 'iron-pickaxe', 'steel-pickaxe', 'crystal-pickaxe'] as const
const BASKET_ORDER = ['hand', 'basket', 'reinforced-basket', 'master-basket'] as const
const emptyStocks = () => Object.fromEntries(STOCK_IDS.map((id) => [id, 0])) as Record<StockId, number>
const equippedLevel = (player: Player, item: PickaxeItem | keyof typeof BASKET_CONFIG) => item === 'hand' ? 0 : enhancementLevel(player.enhancements, item as EnhanceableItem)
const basketCapacity = (player: Player, basket: keyof typeof BASKET_CONFIG = player.basket, level = equippedLevel(player, basket)) => basket === 'hand' ? BASKET_CONFIG.hand.capacity : enhancedBasketCapacity(basket, level)
const basketFortune = (player: Player, basket: keyof typeof BASKET_CONFIG = player.basket, level = equippedLevel(player, basket)) => basket === 'hand' ? BASKET_CONFIG.hand.fortune : enhancementFortune(basket, level)
const basketExpectedYield = (player: Player, basket: keyof typeof BASKET_CONFIG = player.basket, level = equippedLevel(player, basket)) => basket === 'hand' ? 1 : enhancementExpectedFortune(basket, level)

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

function createPlayers(rng: Rng, routes: readonly Route[] = ROUTES): Player[] {
  return routes.map((route, id) => ({
    id, route, skill: 0.86 + rng.next() * 0.13, cash: MATCH_CONFIG.startingCash,
    zone: 'hub', position: { x: 0, z: 0 }, action: null,
    inventory: {}, tool: null, basket: 'hand', equipmentBasis: 0,
    farms: [], waterCan: false, furnaces: 0, knownRecipes: [], preferredRecipe: null, cookJobs: [], optimizedLane: null, metrics: emptyMetrics(),
    portfolio: emptyStocks(), stockCostBasis: emptyStocks(), marketReviewRevision: -1, informedCorrections: [],
    enhancements: {},
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
  const neutralValue = (ingredientValue * SIM_FOOD_VALUE_MULTIPLIER + PREPARED_FOOD_BASE_VALUE[recipe.group] * SIM_FOOD_BASE_SCALE) * recipe.multiplier
  return Math.round(neutralValue * Math.min(1.35, Math.max(0.75, stockRatio ** 0.5)))
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
    return sum + farm.plantings.reduce((plantingSum, planting) => plantingSum + CROP_CONFIG[planting.crop].seedPrice * planting.cells, 0)
  }, 0)
  const stockCostBasis = STOCK_IDS.reduce((sum, id) => sum + player.stockCostBasis[id], 0)
  return Math.round(player.cash + inventoryValue + player.equipmentBasis + plantedBasis + stockCostBasis + player.knownRecipes.length * 600_000)
}

function recipeOperatingScore(recipeId: RecipeId, market: CommodityMarket, foodMarket: Record<RecipeId, number>) {
  const recipe = RECIPES[recipeId]
  const ingredientValue = Object.entries(recipe.ingredients).reduce((sum, [item, quantity]) => {
    const id = item as CommodityId
    return sum + commodityPrice(id, ITEMS[id].sellPrice ?? 0, market[id]) * Number(quantity)
  }, 0)
  return (preparedFoodValue(recipeId, market, foodMarket[recipeId]) - ingredientValue) / recipe.cookSeconds
}

function pickFarmCrop(player: Player, market: CommodityMarket, foodMarket: Record<RecipeId, number>, farms: Farm[]): Crop {
  const recipeNeeds = new Map<Crop, number>()
  const preferred = [...player.knownRecipes].sort((a, b) => recipeOperatingScore(b, market, foodMarket) - recipeOperatingScore(a, market, foodMarket))[0]
  if (preferred) {
    player.preferredRecipe = preferred
    const targetBatches = Math.max(8, player.furnaces * 10)
    for (const [item, quantity] of Object.entries(RECIPES[preferred].ingredients)) {
      if (item in CROP_CONFIG) recipeNeeds.set(item as Crop, Number(quantity) * targetBatches)
    }
  }
  if (recipeNeeds.size) {
    return [...recipeNeeds].sort(([cropA, needA], [cropB, needB]) => {
      const plantedA = player.farms.reduce((sum, farmId) => sum + farms[farmId].plantings.filter((planting) => planting.crop === cropA).reduce((cells, planting) => cells + planting.cells * CROP_CONFIG[cropA].yield, 0), 0)
      const plantedB = player.farms.reduce((sum, farmId) => sum + farms[farmId].plantings.filter((planting) => planting.crop === cropB).reduce((cells, planting) => cells + planting.cells * CROP_CONFIG[cropB].yield, 0), 0)
      const coverageA = ((player.inventory[cropA] ?? 0) + plantedA) / Math.max(1, needA)
      const coverageB = ((player.inventory[cropB] ?? 0) + plantedB) / Math.max(1, needB)
      return coverageA - coverageB || CROP_CONFIG[cropA].growthSeconds - CROP_CONFIG[cropB].growthSeconds
    })[0][0]
  }
  return (Object.keys(CROP_CONFIG) as Crop[]).filter((crop) => player.cash >= CROP_CONFIG[crop].seedPrice * 8).sort((a, b) => {
    const profitA = commodityPrice(a, CROP_CONFIG[a].value, market[a]) * CROP_CONFIG[a].yield - CROP_CONFIG[a].seedPrice
    const profitB = commodityPrice(b, CROP_CONFIG[b].value, market[b]) * CROP_CONFIG[b].yield - CROP_CONFIG[b].seedPrice
    return profitB / (CROP_CONFIG[b].growthSeconds + 12) - profitA / (CROP_CONFIG[a].growthSeconds + 12)
  })[0] ?? 'wheat'
}

function schedule(player: Player, action: PlayerAction) {
  player.action = action
  player.metrics.productiveSeconds += action.productive
  player.metrics.travelSeconds += action.travel
}

function scriptedPurchasePriority(player: Player, globalDeedsRemaining: number, elapsed: number): PurchaseChoice | null {
  const reserve = 100_000
  const farmRoute = isFarmCook(player.route)
  const mineSpecialist = player.route === 'mine-only'
  const forageSpecialist = player.route === 'forage-only'
  const forageBootstrap = player.route === 'farm-cook-forage'
  const farmCoreReady = player.farms.length > 0 && player.waterCan && player.furnaces > 0 && player.knownRecipes.length > 0
  const remaining = MATCH_SECONDS - elapsed
  const farmEntryWindow = Math.min(1_200, Math.max(540, MATCH_SECONDS * .38))

  // Farm/cook is intentionally a mid-game engine. Farm policies bootstrap with
  // one declared gathering lane; optimizers continue evaluating both lanes
  // after the farm is operating, while specialists never buy farm systems.
  const wantsStarterPickaxe = player.route === 'farm-cook-mine' || player.route === 'mine-only'
  if (wantsStarterPickaxe && !player.tool && player.cash >= PICKAXE_CONFIG['worn-pickaxe'].price) {
    return { purchase: 'pickaxe', item: 'worn-pickaxe', cost: PICKAXE_CONFIG['worn-pickaxe'].price }
  }
  if ((forageSpecialist || forageBootstrap) && player.basket === 'hand' && player.cash >= BASKET_CONFIG.basket.price + reserve) {
    return { purchase: 'basket', item: 'basket', cost: BASKET_CONFIG.basket.price }
  }
  // Buying the deed as soon as a small seed reserve remains has better NPV
  // than waiting for the whole cooking stack: raw crops begin growing in the
  // background while the declared bootstrap lane finances the furnace.
  const farmEntryCost = (ITEMS['farm-deed'].buyPrice ?? 0) + 300_000
  if (farmRoute && player.farms.length === 0 && remaining >= farmEntryWindow && player.cash >= farmEntryCost) {
    return { purchase: 'deed', item: 'farm-deed', cost: ITEMS['farm-deed'].buyPrice ?? 0 }
  }
  if (farmRoute && player.farms.length > 0 && !player.waterCan && player.cash >= (ITEMS['water-can'].buyPrice ?? 0) + 80_000) {
    return { purchase: 'water', item: 'water-can', cost: ITEMS['water-can'].buyPrice ?? 0 }
  }
  if (farmRoute && player.farms.length > 0 && player.furnaces === 0 && player.cash >= (ITEMS.furnace.buyPrice ?? 0) + 700_000) {
    return { purchase: 'furnace', item: 'furnace', cost: ITEMS.furnace.buyPrice ?? 0 }
  }
  if (farmRoute && player.furnaces > 0 && (player.inventory['cookbook-box'] ?? 0) > 0) {
    return { purchase: 'recipe', item: 'cookbook-box', cost: 0 }
  }
  if (farmRoute && player.furnaces > 0 && player.knownRecipes.length === 0 && player.cash >= (ITEMS['cookbook-box'].buyPrice ?? 0) + 200_000) {
    return { purchase: 'recipe', item: 'cookbook-box', cost: ITEMS['cookbook-box'].buyPrice ?? 0 }
  }

  const recipeTarget = elapsed < 1_200 ? 2 : elapsed < 2_100 ? 5 : elapsed < 3_000 ? 9 : player.knownRecipes.length
  if (farmCoreReady && remaining >= 600 && player.knownRecipes.length < recipeTarget && player.cash >= (ITEMS['cookbook-box'].buyPrice ?? 0) + 500_000) {
    return { purchase: 'recipe', item: 'cookbook-box', cost: ITEMS['cookbook-box'].buyPrice ?? 0 }
  }

  const expansionMinute = player.route === 'farm-cook-mine' ? 1_500 : 1_800
  if (farmCoreReady && elapsed >= expansionMinute && remaining >= 1_200 && player.farms.length < 3 && globalDeedsRemaining > 0 && player.cash >= (ITEMS['farm-deed'].buyPrice ?? 0) + 1_200_000) {
    return { purchase: 'deed', item: 'farm-deed', cost: ITEMS['farm-deed'].buyPrice ?? 0 }
  }

  if (farmCoreReady && remaining >= 900 && player.furnaces < Math.min(3, Math.max(2, player.farms.length)) && elapsed >= 1_200 && player.cash >= (ITEMS.furnace.buyPrice ?? 0) + 1_000_000) {
    return { purchase: 'furnace', item: 'furnace', cost: ITEMS.furnace.buyPrice ?? 0 }
  }

  if (mineSpecialist && remaining >= 480 && player.tool === 'worn-pickaxe' && player.cash >= PICKAXE_CONFIG['iron-pickaxe'].price + 300_000) {
    return { purchase: 'pickaxe', item: 'iron-pickaxe', cost: PICKAXE_CONFIG['iron-pickaxe'].price }
  }
  if (mineSpecialist && remaining >= 780 && player.tool === 'iron-pickaxe' && elapsed >= 600 && player.cash >= PICKAXE_CONFIG['steel-pickaxe'].price + 700_000) {
    return { purchase: 'pickaxe', item: 'steel-pickaxe', cost: PICKAXE_CONFIG['steel-pickaxe'].price }
  }
  if (mineSpecialist && remaining >= 1_200 && player.tool === 'steel-pickaxe' && elapsed >= 1_500 && player.cash >= PICKAXE_CONFIG['crystal-pickaxe'].price + 1_500_000) {
    return { purchase: 'pickaxe', item: 'crystal-pickaxe', cost: PICKAXE_CONFIG['crystal-pickaxe'].price }
  }
  if ((forageSpecialist || forageBootstrap) && player.basket === 'hand' && farmCoreReady && player.cash >= BASKET_CONFIG.basket.price + reserve) {
    return { purchase: 'basket', item: 'basket', cost: BASKET_CONFIG.basket.price }
  }
  if ((forageSpecialist || forageBootstrap) && remaining >= 600 && player.basket === 'basket' && elapsed >= 900 && player.cash >= BASKET_CONFIG['reinforced-basket'].price + 700_000) {
    return { purchase: 'basket', item: 'reinforced-basket', cost: BASKET_CONFIG['reinforced-basket'].price }
  }
  if (forageSpecialist && remaining >= 1_200 && player.basket === 'reinforced-basket' && elapsed >= 1_800 && player.cash >= BASKET_CONFIG['master-basket'].price + 1_500_000) {
    return { purchase: 'basket', item: 'master-basket', cost: BASKET_CONFIG['master-basket'].price }
  }
  return null
}

function chooseRecipeUnlock(player: Player, rng: Rng) {
  const locked = RECIPE_IDS.filter((id) => !player.knownRecipes.includes(id))
  const group = (['early', 'middle', 'late'] as const).find((candidate) => locked.some((id) => RECIPES[id].group === candidate))
  if (!group) return
  const eligible = locked.filter((id) => RECIPES[id].group === group)
  const unlocked = eligible[rng.int(eligible.length)]
  player.knownRecipes.push(unlocked)
  // A rational player plans crops and forage around the first usable recipe
  // immediately. Waiting until every ingredient already exists made fruit-based
  // unlocks plant unrelated crops forever and exaggerated recipe luck.
  player.preferredRecipe ??= unlocked
}

function cookingCandidate(player: Player, market: CommodityMarket, foodMarket: Record<RecipeId, number>) {
  let best: { recipe: RecipeId; quantity: number; score: number } | null = null
  const capacity = Math.max(10, player.furnaces * 10)
  for (const recipeId of player.knownRecipes) {
    const recipe = RECIPES[recipeId]
    const possible = Object.entries(recipe.ingredients).reduce((count, [item, needed]) => Math.min(count, Math.floor((player.inventory[item as ItemId] ?? 0) / Number(needed))), capacity)
    if (possible <= 0) continue
    const ingredientValuePerDish = Object.entries(recipe.ingredients).reduce((sum, [item, needed]) => {
      const id = item as CommodityId
      return sum + commodityPrice(id, ITEMS[id].sellPrice ?? 0, market[id]) * Number(needed)
    }, 0)
    let sale = 0
    for (let quantity = 1; quantity <= possible; quantity += 1) {
      sale += preparedFoodValue(recipeId, market, foodMarket[recipeId] + quantity - 1)
      const profit = sale - ingredientValuePerDish * quantity
      const score = profit / recipe.cookSeconds
      if (profit > 0 && (!best || score > best.score)) best = { recipe: recipeId, quantity, score }
    }
  }
  return best
}

function forageLoad(player: Player) {
  return (player.inventory.apple ?? 0) + (player.inventory.orange ?? 0)
}

function recipeReserveBatches(player: Player, recipeId: RecipeId) {
  const cookCapacity = Math.max(2, player.furnaces * 10)
  const fruitPerDish = Number(RECIPES[recipeId].ingredients.apple ?? 0) + Number(RECIPES[recipeId].ingredients.orange ?? 0)
  if (fruitPerDish <= 0) return cookCapacity
  return Math.max(1, Math.min(cookCapacity, Math.floor(basketCapacity(player) / fruitPerDish)))
}

function ingredientReserve(player: Player, item: ItemId) {
  if (!usesFarm(player.route)) return 0
  const recipes = player.preferredRecipe ? [player.preferredRecipe] : player.knownRecipes
  return recipes.reduce((maximum, recipeId) => Math.max(maximum, Number(RECIPES[recipeId].ingredients[item] ?? 0) * recipeReserveBatches(player, recipeId)), 0)
}

function farmCapitalReserve(player: Player, elapsed: number) {
  if (!usesFarm(player.route)) return 100_000
  // While assembling the cooking core, put at most a quarter of liquid cash
  // into the current crop. The rest keeps compounding toward the next fixed
  // purchase; reserving either everything or nothing creates false deadlocks.
  if (player.furnaces === 0) {
    const target = (ITEMS.furnace.buyPrice ?? 0) + 700_000
    return Math.max(80_000, Math.min(target, Math.floor(player.cash * 0.75)))
  }
  if (player.knownRecipes.length === 0) {
    const target = (ITEMS['cookbook-box'].buyPrice ?? 0) + 200_000
    return Math.max(80_000, Math.min(target, Math.floor(player.cash * 0.75)))
  }
  if (elapsed >= MATCH_SECONDS - 600) return 40_000
  return 100_000
}

function neededForageIngredients(player: Player) {
  const needed = new Set<ForageItem>()
  const recipes = player.preferredRecipe ? [player.preferredRecipe] : player.knownRecipes
  for (const recipeId of recipes) {
    for (const [item, quantity] of Object.entries(RECIPES[recipeId].ingredients)) {
      if ((item === 'apple' || item === 'orange' || item === 'truffle') && (player.inventory[item] ?? 0) < Number(quantity) * recipeReserveBatches(player, recipeId)) needed.add(item)
    }
  }
  return needed
}

function needsForageIngredients(player: Player) {
  return neededForageIngredients(player).size > 0
}

function inventoryBaseValue(player: Player, categories: Array<'ore' | 'crop' | 'forage' | 'cooking'>) {
  return Object.entries(player.inventory).reduce((sum, [rawId, quantity]) => {
    const id = rawId as ItemId
    return categories.includes(ITEMS[id].category as 'ore' | 'crop' | 'forage' | 'cooking') ? sum + (ITEMS[id].sellPrice ?? 100_000) * (quantity ?? 0) : sum
  }, 0)
}

function simulateMatch(matchIndex: number, routes: readonly Route[] = ACTIVE_ROUTES): MatchResult {
  const matchSeed = 913_711 + matchIndex * 104_729
  const rng = new Rng(matchSeed)
  const players = createPlayers(rng, routes)
  const playerRngs = players.map((player) => new Rng(matchSeed ^ Math.imul(player.id + 1, 0x9e3779b1)))
  const eventRng = new Rng(matchSeed ^ 0xa5a5a5a5)
  const mines: MineNode[] = MINE_NODE_SITES.map((site: { id: string; x: number; z: number }) => ({ ...site, generation: 0, readyAt: 0 }))
  const mineById = new Map(mines.map((node) => [node.id, node]))
  const forage = buildForageNodes()
  const forageById = new Map(forage.map((node) => [node.id, node]))
  const rareIds = forage.filter((node) => node.item === 'truffle' || node.item === 'natural-discovery').map((node) => node.id)
  const rareCollected = new Set<string>()
  const farms: Farm[] = Array.from({ length: FARM_COUNT }, (_, id) => ({ id, owner: null, plantings: [], nextPlantingId: 1 }))
  const farmCenters: Point[] = [{ x: -54, z: -16 }, { x: -18, z: -14 }, { x: 19, z: -17 }, { x: 55, z: -13 }, { x: -53, z: -50 }, { x: -17, z: -49 }, { x: 20, z: -53 }, { x: 56, z: -48 }]
  let globalDeedsRemaining = GLOBAL_EXPANSION_DEEDS
  const personalDeedUsed = new Set<number>()
  let expansionDeedsSold = 0
  let market = initialCommodityMarket()
  let commodityPending: Partial<Record<CommodityId, number>> = {}
  let stockPrices = createInitialStockPrices()
  let stockHistory = createInitialStockHistory()
  let stockSupply = createInitialStockSupply()
  let marketRevision = 0
  const correctionsApplied: number[] = []
  let foodMarket = Object.fromEntries(RECIPE_IDS.map((id) => [id, foodNeutral(id)])) as Record<RecipeId, number>
  const flow: Flow = { mined: {}, foraged: {}, harvested: {}, plantedCells: {}, cookedIngredients: {}, enhancementConsumed: {}, foodProduced: {}, sold: {} }
  const checkpoints: Record<number, number[]> = {}
  const appliedEventRewards = new Set<string>()
  const eventKinds: string[] = []
  let eventWallSeconds = 0
  let mineNodesDepleted = 0
  let fruitWorldPicked = 0
  const reservedMineNodes = new Map<string, number>()
  const weatherOrder: SimWeather[] = ['rain', 'mist', 'clear', 'sunny', 'breeze']
  let weather: SimWeather = 'rain'
  let weatherSeconds = 45

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
        const sale = settleCommoditySale(commodity, baseValue, market[commodity], commodityPending[commodity] ?? 0, quantity)
        proceeds = sale.proceeds
        if (sale.shock) market[commodity] = sale.quotedStock
        commodityPending[commodity] = sale.pendingSupply
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
      if (reservedMineNodes.get(action.nodeId) === player.id) reservedMineNodes.delete(action.nodeId)
      const node = mineById.get(action.nodeId)!
      const ore = oreKindAtDepth(node.id, node.z, node.generation, matchSeed)
      if (node.readyAt > elapsed || !canMineOre(player.tool, ore)) {
        player.metrics.mineDenied += 1
        return
      }
      const quantity = miningYield(player.tool, () => playerRngs[player.id].next(), player.tool ? equippedLevel(player, player.tool) : 0)
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
      if (node.item === 'apple' || node.item === 'orange') {
        const capacityLeft = basketCapacity(player) - forageLoad(player)
        if (capacityLeft <= 0) return
        const available = forageSiteAvailability(node.id, node.fullAt, elapsed * 1000)
        const baseAccepted = Math.min(available, capacityLeft)
        if (baseAccepted <= 0) return
        const bonus = player.basket === 'hand' ? 0 : fortuneBonus(basketFortune(player), () => playerRngs[player.id].next())
        const awarded = Math.min(capacityLeft, baseAccepted + bonus)
        const remaining = available - baseAccepted
        node.fullAt = remaining >= node.capacity ? 0 : elapsed * 1000 + (node.capacity - remaining) * FRUIT_REGROW_MS
        inventoryAdd(player, node.item, awarded)
        add(flow.foraged, node.item, awarded)
        player.metrics.fruitQuantity += awarded
        fruitWorldPicked += baseAccepted
      } else {
        const cycleSeconds = node.item === 'truffle' ? 120 : 240
        const token = `${node.item}:${Math.floor(elapsed / cycleSeconds)}`
        const active = activeRareForageIds(rareIds, false, matchSeed, 0, elapsed * 1000)
        if (!active.has(node.id) || rareCollected.has(token)) return
        rareCollected.add(token)
        const bonus = player.basket === 'hand' ? 0 : fortuneBonus(basketFortune(player), () => playerRngs[player.id].next())
        const awarded = 1 + bonus
        inventoryAdd(player, node.item, awarded)
        add(flow.foraged, node.item, awarded)
        player.metrics.rareQuantity += awarded
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
      farm.plantings.push({ id: farm.nextPlantingId++, crop: action.crop, cells: action.cells, readyAt: elapsed + CROP_CONFIG[action.crop].growthSeconds })
      add(flow.plantedCells, action.crop, action.cells)
      player.metrics.cropsPlanted += action.cells
      return
    }
    if (action.type === 'harvest') {
      player.zone = 'farm'
      const farm = farms[action.farmId]
      const plantingIndex = farm.plantings.findIndex((planting) => planting.id === action.plantingId)
      const planting = farm.plantings[plantingIndex]
      if (!planting || planting.readyAt > elapsed) return
      const quantity = planting.cells * CROP_CONFIG[planting.crop].yield
      inventoryAdd(player, planting.crop, quantity)
      add(flow.harvested, planting.crop, quantity)
      player.metrics.farmHarvestQuantity += quantity
      farm.plantings.splice(plantingIndex, 1)
      return
    }
    if (action.type === 'stock') {
      player.zone = 'hub'
      for (const trade of action.trades) {
        const total = trade.unitPrice * trade.quantity
        if (trade.direction === 'buy') {
          player.portfolio[trade.id] += trade.quantity
          player.stockCostBasis[trade.id] += total
        } else {
          player.cash += total
          stockSupply[trade.id] += trade.quantity
          player.metrics.stockRealizedProfit += total - trade.removedBasis
        }
        player.metrics.stockTrades += 1
      }
      return
    }
    if (action.type === 'enhance') {
      player.zone = 'hub'
      const current = enhancementLevel(player.enhancements, action.item)
      const result = resolveEnhancementAttempt(action.item, current, player.cash, player.inventory, {}, playerRngs[player.id].next())
      if (!result.ok) return
      player.cash = result.cash
      player.inventory = result.inventory as Inventory
      player.enhancements = { ...player.enhancements, [action.item]: result.level }
      const spent = enhancementRequirements(action.item, result.target).coins
      Object.entries(enhancementRequirements(action.item, result.target).materials).forEach(([id, quantity]) => add(flow.enhancementConsumed, id as ResourceItem, Number(quantity)))
      player.equipmentBasis += spent
      player.metrics.enhancementAttempts += 1
      player.metrics.enhancementCoinCost += spent
      if (result.success) player.metrics.enhancementSuccesses += 1
      return
    }
    if (action.type === 'shop') {
      player.zone = action.purchase === 'basket' ? 'forage' : action.purchase === 'pickaxe' ? 'mine' : action.purchase === 'deed' || action.purchase === 'recipe' ? 'hub' : 'farm'
      if (action.purchase === 'pickaxe' && action.item) player.tool = action.item as PickaxeItem
      if (action.purchase === 'basket' && action.item) player.basket = action.item as keyof typeof BASKET_CONFIG
      if (action.purchase === 'water') player.waterCan = true
      if (action.purchase === 'furnace') player.furnaces += 1
      if (action.purchase === 'recipe') {
        if ((player.inventory['cookbook-box'] ?? 0) > 0) inventoryAdd(player, 'cookbook-box', -1)
        chooseRecipeUnlock(player, playerRngs[player.id])
      }
      if (action.purchase === 'deed') {
        const openFarm = farms.find((farm) => farm.owner === null)
        assert(openFarm, `reserved ${action.deedKind ?? 'unknown'} deed completed without an open farm`)
        openFarm.owner = player.id
        player.farms.push(openFarm.id)
      }
      return
    }
  }

  const scheduleShop = (player: Player, elapsed: number, purchase: PurchaseChoice | null) => {
    if (!purchase) return false
    let deedKind: 'personal' | 'global' | undefined
    if (purchase.purchase === 'deed') {
      deedKind = personalDeedUsed.has(player.id) ? 'global' : 'personal'
      // Reserve finite shared stock when the transaction begins. Waiting until
      // travel completes lets two players buy the same final deed in one tick.
      if (deedKind === 'global') {
        if (globalDeedsRemaining <= 0) return false
        globalDeedsRemaining -= 1
        expansionDeedsSold += 1
      } else {
        personalDeedUsed.add(player.id)
      }
    }
    const target = purchase.purchase === 'pickaxe' ? { x: -7, z: 18 }
      : purchase.purchase === 'basket' ? { x: -8, z: 18 }
        : purchase.purchase === 'water' || purchase.purchase === 'furnace' ? { x: 10, z: 10 }
          : { x: 0, z: 0 }
    const zone: Zone = purchase.purchase === 'pickaxe' ? 'mine' : purchase.purchase === 'basket' ? 'forage' : purchase.purchase === 'water' || purchase.purchase === 'furnace' ? 'farm' : 'hub'
    const travel = travelSeconds(player, zone, target)
    player.cash -= purchase.cost
    player.equipmentBasis += purchase.cost
    if (purchase.projectedNpv !== undefined) {
      assert(purchase.projectedNpv > 0, `optimizer scheduled a non-positive investment: ${purchase.rationale ?? purchase.purchase}`)
      player.metrics.optimizerPurchases += 1
      // Consecutive plans overlap most of the same remaining horizon, so adding
      // their NPVs double-counts future income. Keep the strongest observed
      // terminal-cash advantage as diagnostics instead.
      player.metrics.projectedInvestmentNpv = Math.max(player.metrics.projectedInvestmentNpv, purchase.projectedNpv)
    }
    schedule(player, { type: 'shop', completeAt: elapsed + Math.ceil(travel + 4), purchase: purchase.purchase, item: purchase.item, deedKind, target, productive: 2, travel })
    return true
  }

  const correctionMilestones = marketCorrectionMilestones(MATCH_SECONDS)
  const stockCapitalReserve = (player: Player, elapsed: number) => {
    if (!usesFarm(player.route)) return 200_000
    if (player.farms.length === 0) return ITEMS['farm-deed'].buyPrice ?? 0
    if (!player.waterCan) return ITEMS['water-can'].buyPrice ?? 0
    if (player.furnaces === 0) return ITEMS.furnace.buyPrice ?? 0
    if (player.knownRecipes.length === 0) return ITEMS['cookbook-box'].buyPrice ?? 0
    return Math.max(150_000, farmCapitalReserve(player, elapsed))
  }
  const publicStockSignal = (id: StockId) => {
    const history = stockHistory[id]
    const latest = history.at(-1) ?? STOCKS[id].basePrice
    const previous = history.at(-2) ?? latest
    const momentum = previous > 0 ? latest / previous - 1 : 0
    const basePull = latest > 0 ? STOCKS[id].basePrice / latest - 1 : 0
    return .01 + Math.max(-.12, Math.min(.12, momentum * .22)) + Math.max(-.05, Math.min(.05, basePull * .04)) - STOCKS[id].volatility * .018
  }
  const scheduleStockReview = (player: Player, elapsed: number, liquidate = false) => {
    if (!isOptimizer(player.route)) return false
    if (!liquidate && player.marketReviewRevision === marketRevision) return false
    player.marketReviewRevision = marketRevision

    const nextCorrection = correctionMilestones.find((milestone) => milestone > elapsed)
    const correctionIndex = nextCorrection === undefined ? -1 : correctionMilestones.indexOf(nextCorrection)
    const canLearnCorrection = player.route === 'optimizer-a' && nextCorrection !== undefined && nextCorrection - elapsed <= MATCH_CONFIG.stockUpdateSeconds
    const infoCost = correctionIndex < 0 ? 0 : [180_000, 850_000, 2_800_000][Math.min(2, correctionIndex)]
    const reserve = stockCapitalReserve(player, elapsed)
    let learnedNow = false
    const infoBudget = Math.max(0, player.cash - reserve - infoCost)
    const expectedInformationValue = canLearnCorrection ? Array.from({ length: 24 }, (_, sample) => marketCorrectionFor(matchSeed + sample * 97_931, correctionIndex + 1)).reduce((sum, correction) => {
      const bestUpside = STOCK_IDS.reduce((best, id) => {
        const multiplier = correction.stocks[id] ?? 1
        const quantity = Math.min(stockSupply[id], Math.floor(infoBudget / Math.max(1, stockPrices[id])))
        return Math.max(best, Math.max(0, multiplier - 1) * stockPrices[id] * quantity)
      }, 0)
      const avoidedLoss = STOCK_IDS.reduce((avoided, id) => avoided + player.portfolio[id] * stockPrices[id] * Math.max(0, 1 - (correction.stocks[id] ?? 1)), 0)
      return sum + bestUpside + avoidedLoss
    }, 0) / 24 : 0
    if (canLearnCorrection && !player.informedCorrections.includes(nextCorrection!) && player.cash >= reserve + infoCost && expectedInformationValue > infoCost * 1.15) {
      player.cash -= infoCost
      player.metrics.stockInfoCost += infoCost
      player.informedCorrections.push(nextCorrection!)
      learnedNow = true
    }
    const informedCorrection = nextCorrection !== undefined && player.informedCorrections.includes(nextCorrection)
      ? marketCorrectionFor(matchSeed, correctionIndex + 1)
      : null
    const signal = (id: StockId) => informedCorrection ? (informedCorrection.stocks[id] ?? 1) - 1 : publicStockSignal(id)
    const trades: StockTrade[] = []

    for (const id of STOCK_IDS) {
      const held = player.portfolio[id]
      if (!held || (!liquidate && signal(id) >= -.035)) continue
      const removedBasis = player.stockCostBasis[id]
      player.portfolio[id] = 0
      player.stockCostBasis[id] = 0
      trades.push({ id, direction: 'sell', quantity: held, unitPrice: stockPrices[id], removedBasis })
    }

    if (!liquidate) {
      const ranked = [...STOCK_IDS].sort((a, b) => signal(b) - signal(a) || STOCKS[a].volatility - STOCKS[b].volatility)
      const best = ranked[0]
      const bestSignal = signal(best)
      const threshold = informedCorrection ? .12 : .022
      if (bestSignal > threshold && stockSupply[best] > 0) {
        const currentBasis = STOCK_IDS.reduce((sum, id) => sum + player.stockCostBasis[id], 0)
        const progress = markedValue(player, market, farms, foodMarket)
        const portfolioCap = progress * (informedCorrection ? .55 : .24)
        const availableCash = Math.max(0, player.cash - reserve)
        const budget = Math.max(0, Math.min(availableCash, portfolioCap - currentBasis))
        const quantity = Math.min(stockSupply[best], Math.floor(budget / stockPrices[best]))
        if (quantity > 0) {
          const total = stockPrices[best] * quantity
          player.cash -= total
          stockSupply[best] -= quantity
          trades.push({ id: best, direction: 'buy', quantity, unitPrice: stockPrices[best], removedBasis: 0 })
        }
      }
    }

    if (!trades.length && !learnedNow) return false
    const target = { x: 0, z: 0 }
    const travel = travelSeconds(player, 'hub', target) + (learnedNow ? 12 : 0)
    schedule(player, { type: 'stock', completeAt: elapsed + Math.ceil(travel + 4), trades, target, productive: 4, travel })
    return true
  }

  const scheduleCook = (player: Player, elapsed: number) => {
    if (!player.furnaces || player.cookJobs.length >= player.furnaces * 3) return false
    const candidate = cookingCandidate(player, market, foodMarket)
    if (!candidate) return false
    player.preferredRecipe = candidate.recipe
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
    if (!player.waterCan && weather !== 'rain') return false
    for (const farmId of player.farms) {
      const farm = farms[farmId]
      const target = farmCenters[farmId]
      const planting = farm.plantings.filter((candidate) => candidate.readyAt <= elapsed).sort((a, b) => a.readyAt - b.readyAt)[0]
      if (planting) {
        const travel = travelSeconds(player, 'farm', target)
        const productive = 4 + planting.cells * FARM_ACTION_SECONDS
        schedule(player, { type: 'harvest', completeAt: elapsed + Math.ceil(travel + productive), farmId, plantingId: planting.id, target, productive, travel })
        return true
      }
    }
    for (const farmId of player.farms) {
      const farm = farms[farmId]
      const occupiedCells = farm.plantings.reduce((sum, planting) => sum + planting.cells, 0)
      const availableCells = FARM_CELLS - occupiedCells
      if (availableCells < 8) continue
      const crop = pickFarmCrop(player, market, foodMarket, farms)
      const cropConfig = CROP_CONFIG[crop]
      const cells = Math.min(16, availableCells, Math.floor(Math.max(0, player.cash - farmCapitalReserve(player, elapsed)) / cropConfig.seedPrice))
      if (cells < 8) continue
      const plantingPasses = weather === 'rain' ? 1 : 2
      const fullCycleSeconds = cropConfig.growthSeconds + 16 + cells * FARM_ACTION_SECONDS * (plantingPasses + 1)
      if (elapsed + fullCycleSeconds > MATCH_SECONDS - 90) continue
      player.cash -= cells * cropConfig.seedPrice
      const target = farmCenters[farmId]
      const travel = travelSeconds(player, 'farm', target)
      const productive = 8 + cells * FARM_ACTION_SECONDS * plantingPasses
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
    const sellableForageValue = Object.entries(player.inventory).reduce((sum, [rawId, rawQuantity]) => {
      const id = rawId as ItemId
      if (ITEMS[id].category !== 'forage') return sum
      const quantity = Math.max(0, (rawQuantity ?? 0) - ingredientReserve(player, id))
      return sum + quantity * (ITEMS[id].sellPrice ?? 0)
    }, 0)
    // Storage upgrades only have strategic value if a rational player uses
    // them. The former fixed 250k cash-out threshold sent reinforced-crate and
    // cart users back to market at nearly the same load as a starter basket,
    // overstating travel and understating the live capacity progression.
    const forageThreshold = forageLoad(player) >= Math.max(8, basketCapacity(player) * 0.72)
    const hasAnyOre = inventoryBaseValue(player, ['ore']) > 0
    const hasAnyFarm = sellableFarmValue > 0
    const hasAnyForage = sellableForageValue > 0
    if (!(force ? hasAnyOre || hasAnyFarm || hasAnyForage : hasOre || hasFarm || forageThreshold)) return false
    const zone: Zone = (force ? hasAnyForage : forageThreshold) ? 'forage' : (force ? hasAnyFarm : hasFarm) ? 'farm' : 'mine'
    const hasCookedFood = Object.entries(player.inventory).some(([id, quantity]) => id.startsWith('food-') && (quantity ?? 0) > 0)
    const target = zone === 'mine' ? { x: 7, z: 18 } : zone === 'forage' ? { x: 8, z: 18 } : hasCookedFood ? { x: 13, z: 9 } : { x: 7, z: 9 }
    const travel = travelSeconds(player, zone, target)
    schedule(player, { type: 'sell', completeAt: elapsed + Math.ceil(travel + 4), zone, target, productive: 2, travel, liquidate: force })
    return true
  }

  type ForageOpportunity = { node: ForageNode; rate: number; travel: number; quantity: number }
  const bestForageOpportunity = (player: Player, elapsed: number, ingredientRun = false, basketOverride = player.basket, itemFilter?: ReadonlySet<ForageItem>, levelOverride = basketOverride === player.basket ? equippedLevel(player, basketOverride) : 0): ForageOpportunity | null => {
    const capacity = basketCapacity(player, basketOverride, levelOverride)
    const expectedYield = basketExpectedYield(player, basketOverride, levelOverride)
    const ingredientTargets = itemFilter ?? (ingredientRun ? neededForageIngredients(player) : null)
    const activeRare = activeRareForageIds(rareIds, false, matchSeed, 0, elapsed * 1000)
    const available = forage.filter((node) => {
      if (ingredientTargets && !ingredientTargets.has(node.item)) return false
      if (node.item === 'apple' || node.item === 'orange') {
        return forageLoad(player) < capacity && forageSiteAvailability(node.id, node.fullAt, elapsed * 1000) > 0
      }
      const cycleSeconds = node.item === 'truffle' ? 120 : 240
      return activeRare.has(node.id) && !rareCollected.has(`${node.item}:${Math.floor(elapsed / cycleSeconds)}`)
    })
    let best: ForageOpportunity | null = null
    for (const node of available) {
      const isFruit = node.item === 'apple' || node.item === 'orange'
      const baseQuantity = isFruit ? forageSiteAvailability(node.id, node.fullAt, elapsed * 1000) : 1
      const bonus = expectedYield - 1
      const quantity = isFruit ? Math.min(capacity - forageLoad(player), baseQuantity + bonus) : baseQuantity + bonus
      if (quantity <= 0) continue
      const baseValue = ITEMS[node.item].sellPrice ?? 0
      const unitValue = node.item in COMMODITY_MARKET_CONFIG
        ? commodityPrice(node.item as CommodityId, baseValue, market[node.item as CommodityId])
        : baseValue
      const travel = travelSeconds(player, 'forage', node)
      const rate = unitValue * quantity / Math.max(0.1, travel + 1.2)
      if (!best || rate > best.rate) best = { node, rate, travel, quantity }
    }
    return best
  }

  const scheduleForage = (player: Player, elapsed: number, ingredientRun = false, chosen?: ForageOpportunity | null) => {
    const opportunity = chosen ?? bestForageOpportunity(player, elapsed, ingredientRun)
    if (!opportunity) return false
    schedule(player, { type: 'forage', completeAt: elapsed + Math.ceil(opportunity.travel + 1.2), nodeId: opportunity.node.id, target: opportunity.node, productive: 1.2, travel: opportunity.travel })
    return true
  }

  type MineOpportunity = { node: MineNode; rate: number; travel: number; productive: number }
  const bestMineOpportunity = (player: Player, elapsed: number, toolOverride = player.tool, levelOverride = toolOverride && toolOverride === player.tool ? equippedLevel(player, toolOverride) : 0): MineOpportunity | null => {
    if (!toolOverride) return null
    const lane = player.id % 2 === 0 ? -1 : 1
    let best: MineOpportunity | null = null
    for (const node of mines) {
      if (node.readyAt > elapsed) continue
      const reservedBy = reservedMineNodes.get(node.id)
      if (reservedBy !== undefined && reservedBy !== player.id) continue
      const ore = oreKindAtDepth(node.id, node.z, node.generation, matchSeed)
      if (!canMineOre(toolOverride, ore)) continue
      const travel = travelSeconds(player, 'mine', node)
      const productive = miningDuration(toolOverride, ore, levelOverride) / 1000 / player.skill + 0.45
      const lanePenalty = node.x * lane < -4 ? 1.8 : 0
      const unitValue = commodityPrice(ore, ORE_CONFIG[ore].value * SIM_ORE_VALUE_MULTIPLIER, market[ore])
      const rate = unitValue * enhancementExpectedFortune(toolOverride, levelOverride) / Math.max(0.1, travel + productive + lanePenalty)
      if (!best || rate > best.rate) best = { node, rate, travel, productive }
    }
    return best
  }

  const scheduleMine = (player: Player, elapsed: number, chosen?: MineOpportunity | null) => {
    const opportunity = chosen ?? bestMineOpportunity(player, elapsed)
    if (!opportunity) {
      player.metrics.mineWaitSeconds += 1
      return false
    }
    reservedMineNodes.set(opportunity.node.id, player.id)
    schedule(player, { type: 'mine', completeAt: elapsed + Math.ceil(opportunity.travel + opportunity.productive), nodeId: opportunity.node.id, target: opportunity.node, productive: opportunity.productive, travel: opportunity.travel })
    return true
  }

  const scheduleEnhancement = (player: Player, elapsed: number) => {
    if (!isOptimizer(player.route)) return false
    const horizon = MATCH_SECONDS - elapsed - LIQUIDATION_SECONDS
    if (horizon <= 180) return false
    const candidates: EnhanceableItem[] = []
    if (player.tool) candidates.push(player.tool)
    if (player.basket !== 'hand') candidates.push(player.basket)
    let best: { item: EnhanceableItem; npv: number } | null = null
    for (const item of candidates) {
      const current = enhancementLevel(player.enhancements, item)
      if (current >= 10) continue
      const target = current + 1
      const requirements = enhancementRequirements(item, target)
      if (player.cash < requirements.coins + stockCapitalReserve(player, elapsed)) continue
      if (Object.entries(requirements.materials).some(([id, quantity]) => (player.inventory[id as ItemId] ?? 0) < Number(quantity))) continue
      const materialValue = Object.entries(requirements.materials).reduce((sum, [rawId, rawQuantity]) => {
        const id = rawId as ItemId
        const quantity = Number(rawQuantity)
        if (id in COMMODITY_MARKET_CONFIG) return sum + commodityPrice(id as CommodityId, ITEMS[id].sellPrice ?? 0, market[id as CommodityId]) * quantity
        return sum + (ITEMS[id].sellPrice ?? ITEMS[id].buyPrice ?? 0) * quantity
      }, 0)
      const rateAt = (level: number) => {
        if (item.endsWith('pickaxe')) return bestMineOpportunity(player, elapsed, item as PickaxeItem, level)?.rate ?? 0
        return bestForageOpportunity(player, elapsed, false, item as keyof typeof BASKET_CONFIG, undefined, level)?.rate ?? 0
      }
      const currentRate = rateAt(current)
      const successRate = rateAt(target)
      const failedLevel = enhancementResultLevel(current, false)
      const failedRate = rateAt(failedLevel)
      const chance = enhancementChance(target)
      const expectedRate = successRate * chance + failedRate * (1 - chance)
      const npv = (expectedRate - currentRate) * horizon - requirements.coins - materialValue
      if (npv > 0 && (!best || npv > best.npv)) best = { item, npv }
    }
    if (!best) return false
    const target = { x: 12, z: -2 }
    const travel = travelSeconds(player, 'hub', target)
    schedule(player, { type: 'enhance', completeAt: elapsed + Math.ceil(travel + 4), item: best.item, target, productive: 4, travel })
    return true
  }

  // Receding-horizon optimizer. Unlike the bounded comparison policies, this
  // does not follow a themed shopping order. Every available investment is
  // compared against the best live gathering alternative over the time left
  // in the match, including travel, capital, recipe uncertainty, and the time
  // needed to finance unfinished farm infrastructure.
  const optimizerReviewCache = new Map<number, { until: number; key: string; choice: PurchaseChoice | null }>()
  const optimizerPurchase = (player: Player, elapsed: number): PurchaseChoice | null => {
    if (!isOptimizer(player.route)) return null
    const remaining = MATCH_SECONDS - elapsed
    const horizon = remaining - LIQUIDATION_SECONDS
    if (horizon <= 90) return null
    const reviewKey = [
      player.tool ?? 'none', player.basket, player.farms.length, Number(player.waterCan),
      player.furnaces, player.knownRecipes.join(','), Math.floor(player.cash / 250_000), player.zone,
      Math.floor(elapsed / MATCH_CONFIG.commodityCycleSeconds),
    ].join(':')
    const cachedReview = optimizerReviewCache.get(player.id)
    if (cachedReview && cachedReview.key === reviewKey && elapsed < cachedReview.until) return cachedReview.choice

    const projectedMineTripRate = (tool: PickaxeItem | null) => {
      if (!tool) return 0
      const toolLevel = tool === player.tool ? equippedLevel(player, tool) : 0
      const available = mines.filter((node) => node.readyAt <= elapsed && canMineOre(tool, oreKindAtDepth(node.id, node.z, node.generation, matchSeed)))
      let position = player.zone === 'mine' ? player.position : zoneSpawn.mine
      let seconds = player.zone === 'mine' ? 0 : 10
      let grossBaseValue = 0
      const quantities: Partial<Record<OreItem, number>> = {}
      for (let step = 0; step < 24 && available.length && grossBaseValue < 350_000; step += 1) {
        let bestIndex = -1
        let bestScore = -1
        for (let index = 0; index < available.length; index += 1) {
          const node = available[index]
          const ore = oreKindAtDepth(node.id, node.z, node.generation, matchSeed)
          const travel = distance(position, node) / (MOVE_SPEED * player.skill)
          const productive = miningDuration(tool, ore, toolLevel) / 1000 / player.skill + .45
          const value = commodityPrice(ore, ORE_CONFIG[ore].value * SIM_ORE_VALUE_MULTIPLIER, market[ore]) * enhancementExpectedFortune(tool, toolLevel)
          const score = value / Math.max(.1, travel + productive)
          if (score > bestScore) { bestIndex = index; bestScore = score }
        }
        if (bestIndex < 0) break
        const [node] = available.splice(bestIndex, 1)
        const ore = oreKindAtDepth(node.id, node.z, node.generation, matchSeed)
        const quantity = enhancementExpectedFortune(tool, toolLevel)
        seconds += distance(position, node) / (MOVE_SPEED * player.skill) + miningDuration(tool, ore, toolLevel) / 1000 / player.skill + .45
        position = node
        quantities[ore] = (quantities[ore] ?? 0) + quantity
        grossBaseValue += ORE_CONFIG[ore].value * SIM_ORE_VALUE_MULTIPLIER * quantity
      }
      if (grossBaseValue <= 0) return 0
      seconds += distance(position, { x: 7, z: 18 }) / (MOVE_SPEED * player.skill) + 4
      const proceeds = (Object.entries(quantities) as Array<[OreItem, number]>).reduce((sum, [ore, quantity]) => {
        const sale = marginalSale(ore, ORE_CONFIG[ore].value * SIM_ORE_VALUE_MULTIPLIER, market[ore], Math.max(1, Math.round(quantity)))
        return sum + sale.proceeds
      }, 0)
      return proceeds / Math.max(1, seconds)
    }
    const projectedForageTripRate = (basketId: keyof typeof BASKET_CONFIG) => {
      const basketLevel = basketId === player.basket ? equippedLevel(player, basketId) : 0
      const capacity = basketCapacity(player, basketId, basketLevel)
      const expectedYield = basketExpectedYield(player, basketId, basketLevel)
      const remainingCapacity = Math.max(0, capacity - forageLoad(player))
      if (remainingCapacity <= 0) return 0
      const activeRare = activeRareForageIds(rareIds, false, matchSeed, 0, elapsed * 1000)
      const available = forage.filter((node) => {
        if (node.item === 'apple' || node.item === 'orange') return forageSiteAvailability(node.id, node.fullAt, elapsed * 1000) > 0
        const cycleSeconds = node.item === 'truffle' ? 120 : 240
        return activeRare.has(node.id) && !rareCollected.has(`${node.item}:${Math.floor(elapsed / cycleSeconds)}`)
      })
      let position = player.zone === 'forage' ? player.position : zoneSpawn.forage
      let seconds = player.zone === 'forage' ? 0 : 10
      let carried = 0
      let grossBaseValue = 0
      const targetLoad = Math.min(remainingCapacity, Math.max(8, capacity * .72))
      const quantities: Partial<Record<ForageItem, number>> = {}
      for (let step = 0; step < 72 && available.length && carried < targetLoad; step += 1) {
        let bestIndex = -1
        let bestScore = -1
        let bestQuantity = 0
        for (let index = 0; index < available.length; index += 1) {
          const node = available[index]
          const baseQuantity = node.item === 'apple' || node.item === 'orange' ? forageSiteAvailability(node.id, node.fullAt, elapsed * 1000) : 1
          const fortune = expectedYield - 1
          const quantity = Math.min(remainingCapacity - carried, baseQuantity + fortune)
          if (quantity <= 0) continue
          const baseValue = ITEMS[node.item].sellPrice ?? 0
          const unitValue = node.item in COMMODITY_MARKET_CONFIG ? commodityPrice(node.item as CommodityId, baseValue, market[node.item as CommodityId]) : baseValue
          const travel = distance(position, node) / (MOVE_SPEED * player.skill)
          const score = unitValue * quantity / Math.max(.1, travel + 1.2)
          if (score > bestScore) { bestIndex = index; bestScore = score; bestQuantity = quantity }
        }
        if (bestIndex < 0) break
        const [node] = available.splice(bestIndex, 1)
        seconds += distance(position, node) / (MOVE_SPEED * player.skill) + 1.2
        position = node
        carried += bestQuantity
        quantities[node.item] = (quantities[node.item] ?? 0) + bestQuantity
        grossBaseValue += (ITEMS[node.item].sellPrice ?? 0) * bestQuantity
      }
      if (carried <= 0) return 0
      seconds += distance(position, { x: 8, z: 18 }) / (MOVE_SPEED * player.skill) + 4
      const proceeds = (Object.entries(quantities) as Array<[ForageItem, number]>).reduce((sum, [item, quantity]) => {
        if (item in COMMODITY_MARKET_CONFIG) {
          const id = item as CommodityId
          return sum + marginalSale(id, ITEMS[id].sellPrice ?? 0, market[id], Math.max(1, Math.round(quantity))).proceeds
        }
        return sum + (ITEMS[item].sellPrice ?? 0) * quantity
      }, 0)
      return proceeds / Math.max(1, seconds)
    }

    const shopTravel = (purchase: PurchaseChoice['purchase']) => {
      const target = purchase === 'pickaxe' ? { x: -7, z: 18 }
        : purchase === 'basket' ? { x: -8, z: 18 }
          : purchase === 'water' || purchase === 'furnace' ? { x: 10, z: 10 }
            : { x: 0, z: 0 }
      const zone: Zone = purchase === 'pickaxe' ? 'mine' : purchase === 'basket' ? 'forage' : purchase === 'water' || purchase === 'furnace' ? 'farm' : 'hub'
      return travelSeconds(player, zone, target) + 4
    }
    const currentMineRate = projectedMineTripRate(player.tool)
    const currentForageRate = projectedForageTripRate(player.basket)
    const laneSwitchMargin = horizon < 1_800 ? 1.18 : 1.10
    if (!player.optimizedLane) player.optimizedLane = currentMineRate > currentForageRate ? 'mine' : 'forage'
    else if (player.optimizedLane === 'mine' && currentForageRate > currentMineRate * laneSwitchMargin) player.optimizedLane = 'forage'
    else if (player.optimizedLane === 'forage' && currentMineRate > currentForageRate * laneSwitchMargin) player.optimizedLane = 'mine'

    const mineRateCache = new Map<PickaxeItem | 'none', number>([['none', 0], [player.tool ?? 'none', currentMineRate]])
    const forageRateCache = new Map<keyof typeof BASKET_CONFIG, number>([[player.basket, currentForageRate]])
    const mineRate = (tool: PickaxeItem | null) => {
      const key = tool ?? 'none'
      if (!mineRateCache.has(key)) mineRateCache.set(key, projectedMineTripRate(tool))
      return mineRateCache.get(key) ?? 0
    }
    const forageRate = (basket: keyof typeof BASKET_CONFIG) => {
      if (!forageRateCache.has(basket)) forageRateCache.set(basket, projectedForageTripRate(basket))
      return forageRateCache.get(basket) ?? 0
    }
    const forageIngredientRateCache = new Map<string, number>()
    const forageIngredientRate = (basket: keyof typeof BASKET_CONFIG, item: 'apple' | 'orange' | 'truffle') => {
      const key = `${basket}:${item}`
      if (!forageIngredientRateCache.has(key)) {
        const opportunity = bestForageOpportunity(player, elapsed, false, basket, new Set<ForageItem>([item]))
        forageIngredientRateCache.set(key, opportunity ? opportunity.quantity / Math.max(.1, opportunity.travel + 1.2) : 0)
      }
      return forageIngredientRateCache.get(key) ?? 0
    }
    const projectedFoodRevenue = (recipeId: RecipeId, dishRate: number, seconds: number) => {
      if (dishRate <= 0 || seconds <= 0) return 0
      const cycleSeconds = MATCH_CONFIG.worldCycleSeconds
      const recipeIndex = RECIPE_IDS.indexOf(recipeId)
      const demandBase = RECIPES[recipeId].group === 'early' ? 8 : RECIPES[recipeId].group === 'middle' ? 4 : 2
      let cycle = Math.floor(elapsed / cycleSeconds)
      let cycleRemaining = cycleSeconds - (elapsed % cycleSeconds)
      let remaining = seconds
      let projectedStock = foodMarket[recipeId]
      let revenue = 0
      while (remaining > 0.001) {
        const segment = Math.min(remaining, cycleRemaining)
        const dishes = dishRate * segment
        // Sales happen throughout a route rather than at one ideal quote. The
        // midpoint stock captures the same self-saturation as sequential live
        // sales without looping once per projected dish.
        const midpointStock = projectedStock + dishes * 0.5
        revenue += preparedFoodValue(recipeId, market, midpointStock) * dishes
        projectedStock += dishes
        remaining -= segment
        cycleRemaining -= segment
        if (cycleRemaining <= 0.001 && remaining > 0.001) {
          const demand = Math.max(1, demandBase + (((cycle + 1) + recipeIndex * 3) % 3) - 1)
          projectedStock = Math.max(1, projectedStock - demand)
          cycle += 1
          cycleRemaining = cycleSeconds
        }
      }
      return revenue
    }
    const recipeEngineProjection = (recipeId: RecipeId, farmCount: number, furnaceCount: number, basket: keyof typeof BASKET_CONFIG) => {
      if (furnaceCount <= 0) return { dishRate: 0, activeShare: 0, ingredientCost: 0 }
      const recipe = RECIPES[recipeId]
      let cropPassiveSeconds = 0
      let activeSecondsPerDish = 1.5
      let ingredientCapital = 0
      for (const [rawItem, rawQuantity] of Object.entries(recipe.ingredients)) {
        const item = rawItem as CommodityId
        const quantity = Number(rawQuantity)
        if (item in CROP_CONFIG) {
          const crop = item as Crop
          const config = CROP_CONFIG[crop]
          const cellsPerDish = quantity / config.yield
          cropPassiveSeconds += cellsPerDish * config.growthSeconds
          // The live farm path spends 8s + two cell passes to plant/water and
          // 4s + one cell pass to harvest each 16-cell batch. Convert that
          // authored interaction cost into player-seconds per finished dish.
          activeSecondsPerDish += cellsPerDish * (FARM_ACTION_SECONDS * 3 + 12 / 16)
          ingredientCapital += quantity * config.seedPrice / config.yield
        } else if (item === 'apple' || item === 'orange' || item === 'truffle') {
          const itemRate = forageIngredientRate(basket, item)
          if (itemRate <= 0) return { dishRate: 0, activeShare: 0, ingredientCost: 0 }
          activeSecondsPerDish += quantity / itemRate
          ingredientCapital += commodityPrice(item, ITEMS[item].sellPrice ?? 0, market[item]) * quantity
        }
      }
      const cropLimit = cropPassiveSeconds > 0 ? farmCount * FARM_CELLS / cropPassiveSeconds : Number.POSITIVE_INFINITY
      if (cropPassiveSeconds > 0 && farmCount <= 0) return { dishRate: 0, activeShare: 0, ingredientCost: 0 }
      const furnaceLimit = furnaceCount * 10 / recipe.cookSeconds
      const laborLimit = 1 / Math.max(.1, activeSecondsPerDish)
      const realizedDishRate = Math.min(cropLimit, furnaceLimit, laborLimit)
      return { dishRate: realizedDishRate, activeShare: Math.min(1, realizedDishRate * activeSecondsPerDish), ingredientCost: ingredientCapital }
    }

    // Bounded finite-horizon plan search. This evaluates complete investment
    // sequences, not isolated upgrades: a deed may be weak by itself but strong
    // when followed by water, a furnace, and a usable recipe. Every leaf is
    // scored in expected liquid cash at the bell after reserving liquidation
    // time. The live second-by-second simulation remains the final authority.
    type PlannerState = {
      tool: PickaxeItem | null
      basket: keyof typeof BASKET_CONFIG
      farms: number
      water: boolean
      furnaces: number
      recipeUnlocks: number
      cash: number
      seconds: number
      path: PurchaseChoice[]
    }
    const riskDiscount = player.route === 'optimizer-a' ? .90 : .80
    const knownRecipeMask = player.knownRecipes.reduce((mask, id) => mask | (1 << RECIPE_IDS.indexOf(id)), 0)
    const expectedRecipeCache = new Map<string, number>()
    const expectedRecipeIncrement = (farmCount: number, furnaceCount: number, basket: keyof typeof BASKET_CONFIG, unlocks: number, gatheringRate: number, operatingSeconds: number) => {
      if (farmCount <= 0 || furnaceCount <= 0) return 0
      const cachePrefix = `${farmCount}:${furnaceCount}:${basket}:${Math.round(gatheringRate / 1000)}:${Math.round(operatingSeconds / 15)}`
      const recurse = (mask: number, draws: number): number => {
        const key = `${cachePrefix}:${mask}:${draws}`
        const cached = expectedRecipeCache.get(key)
        if (cached !== undefined) return cached
        const bestKnown = RECIPE_IDS.reduce((best, recipeId, index) => {
          if (!(mask & (1 << index))) return best
          const projection = recipeEngineProjection(recipeId, farmCount, furnaceCount, basket)
          const dishes = projection.dishRate * operatingSeconds
          const cookingMargin = projectedFoodRevenue(recipeId, projection.dishRate, operatingSeconds) - projection.ingredientCost * dishes
          const displacedGathering = gatheringRate * projection.activeShare * operatingSeconds
          const incremental = cookingMargin * riskDiscount - displacedGathering
          return Math.max(best, incremental)
        }, 0)
        if (draws <= 0 || mask === (1 << RECIPE_IDS.length) - 1) {
          expectedRecipeCache.set(key, bestKnown)
          return bestKnown
        }
        const locked = RECIPE_IDS.map((id, index) => ({ id, index })).filter(({ index }) => !(mask & (1 << index)))
        const group = (['early', 'middle', 'late'] as const).find((candidate) => locked.some(({ id }) => RECIPES[id].group === candidate))
        const eligible = group ? locked.filter(({ id }) => RECIPES[id].group === group) : []
        const expected = eligible.length
          ? eligible.reduce((sum, { index }) => sum + recurse(mask | (1 << index), draws - 1), 0) / eligible.length
          : bestKnown
        expectedRecipeCache.set(key, expected)
        return expected
      }
      return recurse(knownRecipeMask, Math.min(unlocks, RECIPE_IDS.length - player.knownRecipes.length))
    }
    const projectedOperatingCash = (state: PlannerState, operatingSeconds: number) => {
      if (operatingSeconds <= 0) return 0
      const gathering = Math.max(mineRate(state.tool), forageRate(state.basket), 1)
      const cookingReady = state.farms > 0 && state.water && state.furnaces > 0 && player.knownRecipes.length + state.recipeUnlocks > 0
      const cookingIncrement = cookingReady ? expectedRecipeIncrement(state.farms, state.furnaces, state.basket, state.recipeUnlocks, gathering, operatingSeconds) : 0
      return gathering * operatingSeconds + Math.max(0, cookingIncrement)
    }
    const personalDeedsRemaining = personalDeedUsed.has(player.id) ? 0 : 1
    const openFarmCount = farms.filter((farm) => farm.owner === null).length
    const maxPlannerFarms = Math.min(3, player.farms.length + personalDeedsRemaining + globalDeedsRemaining, player.farms.length + openFarmCount)
    const boxesOnHand = Math.max(0, Math.floor(player.inventory['cookbook-box'] ?? 0))
    const plannerActions = (state: PlannerState): PurchaseChoice[] => {
      const actions: PurchaseChoice[] = []
      const toolIndex = state.tool ? PICKAXE_ORDER.indexOf(state.tool) : -1
      const nextTool = PICKAXE_ORDER[toolIndex + 1]
      if (nextTool) actions.push({ purchase: 'pickaxe', item: nextTool, cost: PICKAXE_CONFIG[nextTool].price })
      const basketIndex = BASKET_ORDER.indexOf(state.basket)
      const nextBasket = BASKET_ORDER[basketIndex + 1]
      if (nextBasket && nextBasket !== 'hand') actions.push({ purchase: 'basket', item: nextBasket, cost: BASKET_CONFIG[nextBasket].price })
      if (state.farms < maxPlannerFarms) actions.push({ purchase: 'deed', item: 'farm-deed', cost: ITEMS['farm-deed'].buyPrice ?? 0 })
      if (state.farms > 0 && !state.water) actions.push({ purchase: 'water', item: 'water-can', cost: ITEMS['water-can'].buyPrice ?? 0 })
      const furnaceCap = Math.min(6, Math.max(3, state.farms * 2))
      if (state.farms > 0 && state.water && state.furnaces < furnaceCap && (state.furnaces === 0 || player.knownRecipes.length + state.recipeUnlocks > 0)) {
        actions.push({ purchase: 'furnace', item: 'furnace', cost: ITEMS.furnace.buyPrice ?? 0 })
      }
      if (state.furnaces > 0 && player.knownRecipes.length + state.recipeUnlocks < RECIPE_IDS.length) {
        const cost = state.recipeUnlocks < boxesOnHand ? 0 : ITEMS['cookbook-box'].buyPrice ?? 0
        actions.push({ purchase: 'recipe', item: 'cookbook-box', cost })
      }
      return actions
    }
    const applyPlannerAction = (state: PlannerState, action: PurchaseChoice): PlannerState => {
      const next: PlannerState = { ...state, path: [...state.path, action] }
      if (action.purchase === 'pickaxe') next.tool = action.item as PickaxeItem
      if (action.purchase === 'basket') next.basket = action.item as keyof typeof BASKET_CONFIG
      if (action.purchase === 'deed') next.farms += 1
      if (action.purchase === 'water') next.water = true
      if (action.purchase === 'furnace') next.furnaces += 1
      if (action.purchase === 'recipe') next.recipeUnlocks += 1
      return next
    }
    const terminalCash = (state: PlannerState) => state.cash + projectedOperatingCash(state, Math.max(0, horizon - state.seconds))
    const baseState: PlannerState = {
      tool: player.tool,
      basket: player.basket,
      farms: player.farms.length,
      water: player.waterCan,
      furnaces: player.furnaces,
      recipeUnlocks: 0,
      cash: player.cash,
      seconds: 0,
      path: [],
    }
    const baseline = terminalCash(baseState)
    let bestState = baseState
    let bestTerminal = baseline
    let beam = [baseState]
    const beamWidth = 12
    const beamDepth = 5
    for (let depth = 0; depth < beamDepth; depth += 1) {
      const expanded: PlannerState[] = []
      for (const state of beam) {
        const rateWindow = Math.max(1, Math.min(MATCH_CONFIG.worldCycleSeconds, horizon - state.seconds))
        const incomeRate = Math.max(1, projectedOperatingCash(state, rateWindow) / rateWindow)
        for (const action of plannerActions(state)) {
          const reserve = action.cost > 0 ? Math.max(25_000, Math.min(350_000, Math.round(state.cash * .08))) : 0
          const financeWait = Math.max(0, action.cost + reserve - state.cash) / incomeRate
          const transaction = state.path.length === 0 ? shopTravel(action.purchase) : Math.max(12, shopTravel(action.purchase) * .72)
          const actionSeconds = financeWait + transaction
          if (state.seconds + actionSeconds >= horizon - 60) continue
          const financedCash = state.cash + incomeRate * financeWait
          const next = applyPlannerAction(state, action)
          next.cash = financedCash - action.cost
          next.seconds = state.seconds + actionSeconds
          const projected = terminalCash(next)
          if (projected > bestTerminal) {
            bestTerminal = projected
            bestState = next
          }
          expanded.push(next)
        }
      }
      const deduped = new Map<string, PlannerState>()
      for (const state of expanded) {
        const key = `${state.tool ?? 'none'}:${state.basket}:${state.farms}:${Number(state.water)}:${state.furnaces}:${state.recipeUnlocks}`
        const current = deduped.get(key)
        if (!current || terminalCash(state) > terminalCash(current)) deduped.set(key, state)
      }
      beam = [...deduped.values()].sort((a, b) => terminalCash(b) - terminalCash(a)).slice(0, beamWidth)
      if (!beam.length) break
    }
    const first = bestState.path[0]
    const projectedNpv = Math.round(bestTerminal - baseline)
    if (!first || projectedNpv <= 0) {
      optimizerReviewCache.set(player.id, { until: elapsed + OPTIMIZER_REVIEW_SECONDS, key: reviewKey, choice: null })
      return null
    }
    const currentReserve = first.cost > 0 ? Math.max(25_000, Math.min(350_000, Math.round(player.cash * .08))) : 0
    if (player.cash < first.cost + currentReserve) {
      optimizerReviewCache.set(player.id, { until: elapsed + OPTIMIZER_REVIEW_SECONDS, key: reviewKey, choice: null })
      return null
    }
    const choice = {
      ...first,
      projectedNpv,
      rationale: `finite-horizon plan: ${bestState.path.map((action) => action.item ?? action.purchase).join(' -> ')}`,
    }
    optimizerReviewCache.set(player.id, { until: elapsed + OPTIMIZER_REVIEW_SECONDS, key: reviewKey, choice })
    return choice
  }

  const runMinigame = (elapsed: number) => {
    const kind = scheduledMinigame(elapsed, matchSeed, MATCH_SECONDS)
    eventKinds.push(kind)
    const values = players.map((player) => markedValue(player, market, farms, foodMarket))
    const economyReference = median(values)
    const leaderProgress = Math.max(...values)
    // Event equipment is equalized, so route identity must not silently grant
    // a score bonus. Individual execution and event variance decide placement.
    const scored = players.map((player) => ({ player, score: Math.round(1000 * (player.skill + eventRng.next() * 0.16)) }))
      .sort((a, b) => b.score - a.score || a.player.id - b.player.id)
    for (let index = 0; index < scored.length; index += 1) {
      const { player } = scored[index]
      const key = `${elapsed}:${player.id}`
      assert(!appliedEventRewards.has(key), `reward applied twice: ${key}`)
      appliedEventRewards.add(key)
      const reward = minigameRewards({ economyReference, placement: index + 1, playerProgress: values[player.id], leaderProgress, matchSeed, milestone: elapsed, playerId: `sim-${matchIndex}-${player.id}` })
      player.cash += reward.cash
      player.metrics.rewardCash += reward.cash
      for (const roll of reward.itemRolls) for (const item of roll.items) inventoryAdd(player, item.itemId, item.quantity)
      player.metrics.rewardsApplied += 1
    }
    const readySeconds = 5 + eventRng.int(11)
    eventWallSeconds += readySeconds + MINIGAME_DURATION[kind]
  }

  const milestones = new Set(minigameMilestones(MATCH_SECONDS))
  for (let elapsed = 0; elapsed <= MATCH_SECONDS; elapsed += 1) {
    if (elapsed > 0) {
      weatherSeconds -= 1
      if (weatherSeconds <= 0) {
        weather = weatherOrder[(weatherOrder.indexOf(weather) + 1) % weatherOrder.length]
        weatherSeconds = weather === 'rain' ? 55 : weather === 'mist' ? 60 : weather === 'sunny' ? 75 : weather === 'breeze' ? 70 : 90
        if (weather === 'sunny') {
          farms.forEach((farm) => farm.plantings.forEach((planting) => { if (planting.readyAt > elapsed) planting.readyAt = elapsed + Math.round((planting.readyAt - elapsed) * .85) }))
          forage.forEach((node) => { if ((node.item === 'apple' || node.item === 'orange') && node.fullAt > elapsed * 1000) node.fullAt = elapsed * 1000 + Math.round((node.fullAt - elapsed * 1000) * .85) })
        }
      }
    }
    if (elapsed > 0 && elapsed % MATCH_CONFIG.worldCycleSeconds === 0) {
      const cycle = elapsed / MATCH_CONFIG.worldCycleSeconds
      const advanced = advanceMarketCycle(market, commodityPending, stockPrices, stockHistory, stockSupply, foodMarket, cycle, weather, matchSeed)
      market = advanced.commodityMarket
      commodityPending = {}
      stockPrices = advanced.stockPrices
      stockHistory = advanced.stockHistory
      stockSupply = advanced.stockSupply
      foodMarket = advanced.foodMarket
      marketRevision += 1
    }
    if (correctionMilestones.includes(elapsed)) {
      const correction = marketCorrectionFor(matchSeed, correctionsApplied.length + 1)
      const settled = { ...market }
      ;(Object.keys(COMMODITY_MARKET_CONFIG) as CommodityId[]).forEach((id) => { settled[id] += commodityPending[id] ?? 0 })
      commodityPending = {}
      market = correction.resetCommodities ? initialCommodityMarket() : settled
      ;(Object.entries(correction.commodities) as Array<[CommodityId, number]>).forEach(([id, multiplier]) => {
        market[id] = Math.max(1, Math.round(market[id] * multiplier))
      })
      STOCK_IDS.forEach((id) => {
        const multiplier = correction.stocks[id] ?? 1
        if (multiplier === 1) return
        const next = Math.max(Math.round(STOCKS[id].basePrice * .15), Math.min(Math.round(STOCKS[id].basePrice * 12), Math.round(stockPrices[id] * multiplier)))
        stockPrices[id] = next
        stockHistory[id] = [...stockHistory[id], next].slice(-5)
      })
      correctionsApplied.push(elapsed)
      marketRevision += 1
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
      if (elapsed >= MATCH_SECONDS - LIQUIDATION_SECONDS) {
        if (scheduleStockReview(player, elapsed, true)) continue
        if (scheduleSell(player, elapsed, true)) continue
        player.metrics.idleSeconds += 1
        continue
      }
      const purchase = isOptimizer(player.route)
        ? optimizerPurchase(player, elapsed)
        : scriptedPurchasePriority(player, globalDeedsRemaining, elapsed)
      if (scheduleShop(player, elapsed, purchase)) continue
      if (scheduleEnhancement(player, elapsed)) continue
      if (scheduleStockReview(player, elapsed)) continue
      if (usesFarm(player.route) && scheduleCook(player, elapsed)) continue
      if (player.farms.length && scheduleFarm(player, elapsed)) continue
      if (usesFarm(player.route) && needsForageIngredients(player) && scheduleForage(player, elapsed, true)) continue
      if (scheduleSell(player, elapsed)) continue

      const farmCoreReady = player.farms.length > 0 && player.waterCan && player.furnaces > 0 && player.knownRecipes.length > 0
      if (isOptimizer(player.route)) {
        if (!farmCoreReady && player.route === 'optimizer-a') {
          if (scheduleMine(player, elapsed)) continue
        }
        if (!farmCoreReady && player.route === 'optimizer-b') {
          if (scheduleForage(player, elapsed)) continue
        }
        const mine = bestMineOpportunity(player, elapsed)
        const forageOption = bestForageOpportunity(player, elapsed)
        if (player.optimizedLane === 'mine') {
          if (scheduleMine(player, elapsed, mine)) continue
          if (scheduleForage(player, elapsed, false, forageOption)) continue
        } else {
          if (scheduleForage(player, elapsed, false, forageOption)) continue
          if (scheduleMine(player, elapsed, mine)) continue
        }
      } else if (player.route === 'mine-only') {
        if (scheduleMine(player, elapsed)) continue
      } else if (player.route === 'forage-only') {
        if (scheduleForage(player, elapsed)) continue
      } else if (!farmCoreReady && player.route === 'farm-cook-mine') {
        if (scheduleMine(player, elapsed)) continue
      } else if (!farmCoreReady && player.route === 'farm-cook-forage') {
        if (scheduleForage(player, elapsed)) continue
      }
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
  for (const ore of Object.keys(ORE_CONFIG) as OreItem[]) assert.equal(flow.mined[ore] ?? 0, (flow.sold[ore] ?? 0) + (flow.enhancementConsumed[ore] ?? 0), `${ore} mass did not close after liquidation`)
  for (const item of ['apple', 'orange', 'truffle', 'natural-discovery'] as ForageItem[]) {
    assert.equal(flow.foraged[item] ?? 0, (flow.sold[item] ?? 0) + (flow.cookedIngredients[item] ?? 0) + (flow.enhancementConsumed[item] ?? 0), `${item} mass did not close after liquidation`)
  }
  for (const crop of Object.keys(CROP_CONFIG) as Crop[]) assert.equal(flow.harvested[crop] ?? 0, (flow.sold[crop] ?? 0) + (flow.cookedIngredients[crop] ?? 0) + (flow.enhancementConsumed[crop] ?? 0), `${crop} mass did not close after liquidation`)
  for (const recipeId of RECIPE_IDS) {
    const food = RECIPES[recipeId].food
    assert.equal(flow.foodProduced[food] ?? 0, flow.sold[food] ?? 0, `${food} mass did not close after liquidation`)
  }
  assert(farms.filter((farm) => farm.owner !== null).length <= FARM_COUNT, 'more than eight farms were claimed')
  assert(globalDeedsRemaining >= 0 && expansionDeedsSold <= GLOBAL_EXPANSION_DEEDS, 'global expansion deed stock went negative')
  assert(players.every((player) => player.farms.length <= 3), 'a player exceeded the intentional three-farm maximum')
  assert(appliedEventRewards.size === players.length * milestones.size, 'minigame rewards were not applied exactly once')
  assert(eventKinds.length === milestones.size, 'scheduled minigame count drifted')
  assert(eventKinds.every((kind, index) => index === 0 || kind !== eventKinds[index - 1]), 'consecutive minigames repeated')
  assert(STOCK_IDS.every((id) => stockSupply[id] >= 0), 'shared stock supply went negative')
  assert(players.every((player) => STOCK_IDS.every((id) => player.portfolio[id] >= 0 && player.stockCostBasis[id] >= 0)), 'portfolio state went negative')
  assert(players.filter((player) => isOptimizer(player.route)).every((player) => STOCK_IDS.every((id) => player.portfolio[id] === 0)), 'an optimizer failed to liquidate stocks before the bell')

  const fruitInitialCapacity = forage.filter((node) => node.item === 'apple' || node.item === 'orange').reduce((sum, node) => sum + node.capacity, 0)
  const fruitHarvested = (flow.foraged.apple ?? 0) + (flow.foraged.orange ?? 0)
  const fruitCeiling = fruitInitialCapacity + (APPLE_SITES.length + ORANGE_SITES.length) * Math.ceil(MATCH_SECONDS / (FRUIT_REGROW_MS / 1000))
  assert(fruitWorldPicked <= fruitCeiling, `fruit world depletion exceeded capacity/regeneration ceiling: ${fruitWorldPicked} > ${fruitCeiling}`)
  assert(mineNodesDepleted === players.reduce((sum, player) => sum + player.metrics.mineSuccesses, 0), 'mine node depletion and successful requests diverged')

  return { checkpoints, finalCash, players, wallSeconds: MATCH_SECONDS + eventWallSeconds, minigames: eventKinds, mineNodesDepleted, fruitInitialCapacity, fruitHarvested, fruitWorldPicked, expansionDeedsSold, flow }
}

assert.equal(MINE_NODE_SITES.length, 278, 'live shared mine layout no longer has 278 nodes')
assert.equal(APPLE_SITES.length, 70, 'apple site mirror drifted from server')
assert.equal(ORANGE_SITES.length, 60, 'orange site mirror drifted from server')
assert.equal(TRUFFLE_SITES.length, 5, 'truffle site mirror drifted from server')
assert.equal(DISCOVERY_SITES.length, 3, 'discovery site mirror drifted from server')
assert.equal(buildForageNodes().length, 138, 'shared forage layout no longer has 138 nodes')
assert(GLOBAL_EXPANSION_DEEDS <= FARM_COUNT - PLAYER_COUNT, 'configured global deed stock exceeds remaining farm capacity')

const results: MatchResult[] = []
for (let run = 0; run < RUNS; run += 1) results.push(simulateMatch(SEED_OFFSET + run))

const populationRows = POPULATION_AUDIT ? ROUTES.map((route, routeIndex) => {
  const routes = Array.from({ length: PLAYER_COUNT }, () => route)
  const populationResults = Array.from({ length: POPULATION_RUNS }, (_, run) => simulateMatch(50_000 + routeIndex * 1_000 + run, routes))
  const players = populationResults.flatMap((result) => result.players)
  const finalCash = populationResults.flatMap((result) => result.finalCash)
  const mineAttempts = players.reduce((sum, player) => sum + player.metrics.mineAttempts, 0)
  const mineDenied = players.reduce((sum, player) => sum + player.metrics.mineDenied, 0)
  const teamFarms = populationResults.map((result) => result.players.reduce((sum, player) => sum + player.farms.length, 0))
  return {
    route,
    cashP10: Math.round(percentile(finalCash, .1)),
    cashP50: Math.round(percentile(finalCash, .5)),
    cashP90: Math.round(percentile(finalCash, .9)),
    teamFarms: Number(median(teamFarms).toFixed(1)),
    mineDenial: mineDenied / Math.max(1, mineAttempts),
    fruitPerPlayer: Math.round(median(players.map((player) => player.metrics.fruitQuantity))),
    orePerPlayer: Math.round(median(players.map((player) => player.metrics.oreQuantity))),
    idleShare: median(players.map((player) => player.metrics.idleSeconds / MATCH_SECONDS)),
  }
}) : []

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
const routeRows = ACTIVE_ROUTES.map((route) => {
  const players = results.map((result) => result.players.find((player) => player.route === route)!)
  const finalValues = results.map((result, index) => result.finalCash[players[index].id])
  return {
    route,
    p10: Math.round(percentile(finalValues, 0.1)), p50: Math.round(percentile(finalValues, 0.5)), p90: Math.round(percentile(finalValues, 0.9)),
    farms: Number(median(players.map((player) => player.farms.length)).toFixed(1)),
    furnaces: Number(median(players.map((player) => player.furnaces)).toFixed(1)),
    recipes: Number(median(players.map((player) => player.knownRecipes.length)).toFixed(1)),
    dishes: Math.round(median(players.map((player) => player.metrics.dishesCooked))),
    ore: Math.round(median(players.map((player) => player.metrics.oreQuantity))),
    fruit: Math.round(median(players.map((player) => player.metrics.fruitQuantity))),
    harvest: Math.round(median(players.map((player) => player.metrics.farmHarvestQuantity))),
    sellTrips: Math.round(median(players.map((player) => player.metrics.sellTrips))),
    rewardCash: Math.round(median(players.map((player) => player.metrics.rewardCash))),
    optimizerPurchases: Math.round(median(players.map((player) => player.metrics.optimizerPurchases))),
    projectedInvestmentNpv: Math.round(median(players.map((player) => player.metrics.projectedInvestmentNpv))),
    stockTrades: Math.round(median(players.map((player) => player.metrics.stockTrades))),
    stockProfit: Math.round(median(players.map((player) => player.metrics.stockRealizedProfit))),
    stockInfoCost: Math.round(median(players.map((player) => player.metrics.stockInfoCost))),
    enhancementAttempts: Math.round(median(players.map((player) => player.metrics.enhancementAttempts))),
    enhancementSuccesses: Math.round(median(players.map((player) => player.metrics.enhancementSuccesses))),
    enhancementCoinCost: Math.round(median(players.map((player) => player.metrics.enhancementCoinCost))),
    tool: mode(players.map((player) => player.tool ?? 'none')), basket: mode(players.map((player) => player.basket)),
    mineDenial: ratio(median(players.map((player) => player.metrics.mineDenied / Math.max(1, player.metrics.mineAttempts)))),
    travel: ratio(median(players.map((player) => player.metrics.travelSeconds / MATCH_SECONDS))),
    idle: ratio(median(players.map((player) => player.metrics.idleSeconds / MATCH_SECONDS))),
    downtime: ratio(median(players.map((player) => (player.metrics.travelSeconds + player.metrics.idleSeconds + player.metrics.mineWaitSeconds) / MATCH_SECONDS))),
  }
})

const firstHalf = results.slice(0, Math.floor(results.length / 2)).flatMap((result) => result.checkpoints[MATCH_SECONDS])
const secondHalf = results.slice(Math.floor(results.length / 2)).flatMap((result) => result.checkpoints[MATCH_SECONDS])
const splitMedianA = median(firstHalf)
const splitMedianB = median(secondHalf)
const stabilityDelta = Math.abs(splitMedianA - splitMedianB) / Math.max(1, (splitMedianA + splitMedianB) / 2)
const allPlayers = results.flatMap((result) => result.players)
for (const player of allPlayers) {
  if (player.route === 'mine-only') {
    assert.equal(player.farms.length, 0, 'mine-only policy leaked into farming')
    assert.equal(player.furnaces, 0, 'mine-only policy bought a furnace')
    assert.equal(player.basket, 'hand', 'mine-only policy bought forage storage')
  }
  if (player.route === 'forage-only') {
    assert.equal(player.farms.length, 0, 'forage-only policy leaked into farming')
    assert.equal(player.furnaces, 0, 'forage-only policy bought a furnace')
    assert.equal(player.tool, null, 'forage-only policy bought a pickaxe')
  }
  if (player.route === 'farm-cook-mine') assert(player.tool === 'worn-pickaxe' || player.tool === null, 'farm-cook-mine upgraded beyond its declared bootstrap tool')
  if (player.route === 'farm-cook-forage') assert.equal(player.tool, null, 'farm-cook-forage leaked into mining')
}
const farmOwnership = results.map((result) => result.players.reduce((sum, player) => sum + player.farms.length, 0))
const expansionSales = results.map((result) => result.expansionDeedsSold)
const wallTimes = results.map((result) => result.wallSeconds)
const uniqueEventPairs = new Set(results.map((result) => result.minigames.join('+')))
const winnerCounts = Object.fromEntries(ACTIVE_ROUTES.map((route) => [route, 0])) as Partial<Record<Route, number>>
for (const result of results) {
  const winningCash = Math.max(...result.finalCash)
  const winner = result.players.find((player) => result.finalCash[player.id] === winningCash)!
  winnerCounts[winner.route] = (winnerCounts[winner.route] ?? 0) + 1
}
const mineDenialShare = allPlayers.reduce((sum, player) => sum + player.metrics.mineDenied, 0) / Math.max(1, allPlayers.reduce((sum, player) => sum + player.metrics.mineAttempts, 0))
const mineWaitShare = allPlayers.reduce((sum, player) => sum + player.metrics.mineWaitSeconds, 0) / (RUNS * PLAYER_COUNT * MATCH_SECONDS)
const totalFruit = results.reduce((sum, result) => sum + result.fruitHarvested, 0)
const totalFruitWorldPicked = results.reduce((sum, result) => sum + result.fruitWorldPicked, 0)
const totalFruitCeiling = results.reduce((sum, result) => sum + result.fruitInitialCapacity + 130 * Math.ceil(MATCH_SECONDS / 30), 0)

console.log(`\n${PLAYER_COUNT}-player accelerated ${MATCH_MINUTES}-minute match · ${RUNS} deterministic matches · ${RUNS * PLAYER_COUNT} player-runs`)
console.table(checkpointRows.map((row) => ({ minute: row.minute, P10: money(row.p10), P50: money(row.p50), P90: money(row.p90) })))
console.table([{ checkpoint: `${MATCH_MINUTES}m liquid cash`, P10: money(liquidCashRow.p10), P50: money(liquidCashRow.p50), P90: money(liquidCashRow.p90) }])
console.table(routeRows.map((row) => ({ route: row.route, cashP10: money(row.p10), cashP50: money(row.p50), cashP90: money(row.p90), eventCash: money(row.rewardCash), farms: row.farms, furnaces: row.furnaces, recipes: row.recipes, dishes: row.dishes, ore: row.ore, fruit: row.fruit, harvest: row.harvest, sellTrips: row.sellTrips, stockTrades: row.stockTrades || '-', stockProfit: row.stockProfit ? money(row.stockProfit) : '-', infoCost: row.stockInfoCost ? money(row.stockInfoCost) : '-', enhances: `${row.enhancementSuccesses}/${row.enhancementAttempts}`, enhanceCoins: row.enhancementCoinCost ? money(row.enhancementCoinCost) : '-', investments: row.optimizerPurchases || '-', projectedNpv: row.projectedInvestmentNpv ? money(row.projectedInvestmentNpv) : '-', tool: row.tool, basket: row.basket, mineDenial: row.mineDenial, travel: row.travel, idle: row.idle, downtime: row.downtime })))
console.table(ACTIVE_ROUTES.map((route) => ({ route, wins: winnerCounts[route] ?? 0, share: ratio((winnerCounts[route] ?? 0) / RUNS) })))
if (populationRows.length) {
  console.log(`\n${PLAYER_COUNT}-player same-strategy crowd audit · ${POPULATION_RUNS} deterministic matches per policy`)
  console.table(populationRows.map((row) => ({ route: row.route, cashP10: money(row.cashP10), cashP50: money(row.cashP50), cashP90: money(row.cashP90), teamFarms: row.teamFarms, mineDenial: ratio(row.mineDenial), fruit: row.fruitPerPlayer, ore: row.orePerPlayer, idle: ratio(row.idleShare) })))
}
if (process.env.SIM_TRACE === '1') {
  console.table(results.flatMap((result, run) => result.players.map((player) => ({
    run, route: player.route, cash: player.cash, farms: player.farms.length, furnaces: player.furnaces,
    recipes: player.knownRecipes.join(',') || '-', dishes: player.metrics.dishesCooked,
    ore: player.metrics.oreQuantity, fruit: player.metrics.fruitQuantity, harvest: player.metrics.farmHarvestQuantity,
    stockTrades: player.metrics.stockTrades, stockProfit: player.metrics.stockRealizedProfit, infoCost: player.metrics.stockInfoCost,
    enhancement: `${player.metrics.enhancementSuccesses}/${player.metrics.enhancementAttempts}`, enhancementCoins: player.metrics.enhancementCoinCost,
  }))))
}

console.log(JSON.stringify({
  status: 'passed-physical-invariants',
  runs: RUNS,
  seedOffset: SEED_OFFSET,
  liquidCashAtBell: liquidCashRow,
  sharedWorld: { mineNodes: MINE_NODE_SITES.length, forageNodes: buildForageNodes().length, farms: FARM_COUNT, players: PLAYER_COUNT },
  stability: { splitHalfP50A: Math.round(splitMedianA), splitHalfP50B: Math.round(splitMedianB), delta: ratio(stabilityDelta), note: stabilityDelta <= 0.05 ? 'stable' : 'review sample variance' },
  contention: { mineDenialShare: ratio(mineDenialShare), mineNoReadyWaitShare: ratio(mineWaitShare) },
  capacity: { fruitAwarded: totalFruit, fruitWorldPicked: totalFruitWorldPicked, conservativeFruitCeiling: totalFruitCeiling, worldUtilization: ratio(totalFruitWorldPicked / totalFruitCeiling) },
  ownership: { medianTeamFarms: median(farmOwnership), medianExpansionDeedsSold: median(expansionSales), maxPlayerFarms: Math.max(...allPlayers.map((player) => player.farms.length)) },
  winners: Object.fromEntries(ACTIVE_ROUTES.map((route) => [route, { wins: winnerCounts[route] ?? 0, share: ratio((winnerCounts[route] ?? 0) / RUNS) }])),
  events: { observedPairs: [...uniqueEventPairs], medianWallMinutes: Number((median(wallTimes) / 60).toFixed(1)), rewardsAppliedExactlyOnce: true },
  populationAudit: populationRows.length ? Object.fromEntries(populationRows.map((row) => [row.route, { cashP10: row.cashP10, cashP50: row.cashP50, cashP90: row.cashP90, teamFarms: row.teamFarms, mineDenialShare: ratio(row.mineDenial), fruitPerPlayer: row.fruitPerPlayer, orePerPlayer: row.orePerPlayer, idleShare: ratio(row.idleShare) }])) : 'set SIM_POPULATION_AUDIT=1 to run',
  scope: 'Shared-world strategy contest with two value-maximizing farm/cook/gathering optimizers using contested stock supply, live pending-supply commodity settlement, public market signals, optional paid correction information, rational equipment enhancement attempts, and explicit liquidation. Direct player trading, lottery play, merchant consumables, and adversarial clients remain separate validation scopes.',
}, null, 2))

if (stabilityDelta > 0.05) console.warn(`WARNING: split-half P50 differs by ${ratio(stabilityDelta)}; increase SIM_RUNS before making tuning decisions.`)
