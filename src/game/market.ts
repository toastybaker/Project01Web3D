import { COMMODITY_MARKET_CONFIG, MATCH_CONFIG, marketCorrectionMilestones, type CommodityId } from './config'
import { advanceCommodityCycle, commodityPrice, initialCommodityMarket, nextStockPrice, seeded01, stockAvailable, stockWaveQuantity, type CommodityMarket } from './economy'
import { ITEMS, STOCKS, type StockId } from './items'
import { PREPARED_FOOD_BASE_VALUE, PREPARED_FOOD_MARKUP, RECIPES, RECIPE_IDS, type RecipeId } from './recipes'

export type WeatherKind = 'clear' | 'rain' | 'mist' | 'sunny' | 'breeze'

export type MarketCorrection = {
  name: string
  headline: string
  clues: [string, string]
  stocks: Partial<Record<StockId, number>>
  commodities: Partial<Record<CommodityId, number>>
  resetCommodities?: boolean
}

export type SharedMarketSnapshot = {
  revision: number
  elapsedSeconds: number
  weather: WeatherKind
  weatherSeconds: number
  commodityMarket: CommodityMarket
  commodityPending: Partial<Record<CommodityId, number>>
  commodityPriceHistory: Partial<Record<CommodityId, number[]>>
  commodityCycle: number
  stockPrices: Record<StockId, number>
  stockHistory: Record<StockId, number[]>
  stockSupply: Record<StockId, number>
  foodMarket: Record<RecipeId, number>
  foodPriceHistory: Partial<Record<RecipeId, number[]>>
  marketCorrectionsApplied: number[]
  marketCorrectionName: string | null
  marketCorrectionSeconds: number
}

export const STOCK_IDS = Object.keys(STOCKS) as StockId[]

export function marketCorrectionFor(seed: number, number: number): MarketCorrection {
  const events: MarketCorrection[] = [
    { name: 'BROAD RALLY', headline: 'A market-wide rally lifts every listed company.', clues: ['Every stock will rise about 50%.', 'Raw-material prices will also rise as supply tightens.'], stocks: { apple: 1.5, samsung: 1.5, nvidia: 1.55, google: 1.5, amd: 1.55 }, commodities: { 'copper-ore': .72, 'iron-ore': .72, 'silver-ore': .75, 'gold-ore': .78 } },
    { name: 'MARKET CRASH', headline: 'A sudden sell-off cuts valuations across the exchange.', clues: ['Every stock will lose about half its value.', 'Crop demand will rise while investors leave stocks.'], stocks: { apple: .5, samsung: .5, nvidia: .5, google: .5, amd: .5 }, commodities: { wheat: .72, tomato: .72, lettuce: .75, pumpkin: .78, watermelon: .8 } },
    { name: 'MOBILE SPLIT', headline: 'Phone makers surge while chip firms retreat.', clues: ['Apple and Samsung will rise sharply.', 'Nvidia and AMD will drop sharply.'], stocks: { apple: 1.7, samsung: 1.65, google: 1.22, nvidia: .62, amd: .58 }, commodities: { apple: .8, orange: .8 } },
    { name: 'CHIP BOOM', headline: 'Computing demand sends chipmakers sharply higher.', clues: ['Nvidia and AMD will rise sharply.', 'Farm produce will reset to normal market levels.'], stocks: { apple: .9, samsung: 1.08, nvidia: 1.85, google: .92, amd: 1.9 }, commodities: {}, resetCommodities: true },
    { name: 'HARVEST RESET', headline: 'New harvest contracts reset commodity prices.', clues: ['All commodity prices will return to their starting levels.', 'Stock prices will split instead of moving together.'], stocks: { apple: 1.28, samsung: .82, nvidia: 1.2, google: .85, amd: 1.25 }, commodities: {}, resetCommodities: true },
    { name: 'MATERIAL SHORTAGE', headline: 'A workshop shortage drives ore prices upward.', clues: ['Every mine material will become much more valuable.', 'Technology stocks will weaken during the shortage.'], stocks: { apple: .92, samsung: .82, nvidia: .72, google: .9, amd: .7 }, commodities: { 'copper-ore': .52, 'iron-ore': .55, 'silver-ore': .6, 'gold-ore': .65, 'crystal-ore': .7 } },
  ]
  return events[Math.floor(seeded01(seed + number * 7919) * events.length) % events.length]
}

export function foodNeutral(recipe: RecipeId) {
  return RECIPES[recipe].group === 'early' ? 30 : RECIPES[recipe].group === 'middle' ? 15 : 8
}

export function createInitialFoodMarket() {
  return Object.fromEntries(RECIPE_IDS.map((id) => [id, foodNeutral(id)])) as Record<RecipeId, number>
}

export function commodityPriceSnapshot(market: CommodityMarket) {
  return Object.fromEntries((Object.keys(COMMODITY_MARKET_CONFIG) as CommodityId[]).map((id) => [
    id,
    commodityPrice(id, ITEMS[id].sellPrice ?? 0, market[id]),
  ])) as Record<CommodityId, number>
}

export function preparedFoodValue(recipeId: RecipeId, market: CommodityMarket, foodStock: number) {
  const recipe = RECIPES[recipeId]
  const ingredientValue = Object.entries(recipe.ingredients).reduce((sum, [item, quantity]) => {
    const id = item as CommodityId
    return sum + commodityPrice(id, ITEMS[id].sellPrice ?? 0, market[id]) * Number(quantity)
  }, 0)
  const ratio = foodNeutral(recipeId) / Math.max(1, foodStock)
  const foodMultiplier = Math.min(1.35, Math.max(0.75, ratio ** 0.5))
  const neutralValue = (ingredientValue * PREPARED_FOOD_MARKUP + PREPARED_FOOD_BASE_VALUE[recipe.group]) * recipe.multiplier
  return Math.round(neutralValue * foodMultiplier)
}

export function createInitialStockPrices() {
  return Object.fromEntries(STOCK_IDS.map((id) => [id, STOCKS[id].basePrice])) as Record<StockId, number>
}

export function createInitialStockHistory() {
  return Object.fromEntries(STOCK_IDS.map((id) => [id, [STOCKS[id].basePrice]])) as Record<StockId, number[]>
}

export function createInitialStockSupply(elapsedSeconds = 0) {
  return Object.fromEntries(STOCK_IDS.map((id) => [
    id,
    stockAvailable(STOCKS[id], elapsedSeconds) ? STOCKS[id].waveSize * 2 : 0,
  ])) as Record<StockId, number>
}

export function createInitialCommodityHistory(market: CommodityMarket = initialCommodityMarket()) {
  return Object.fromEntries(Object.entries(commodityPriceSnapshot(market)).map(([id, price]) => [id, [price]])) as Partial<Record<CommodityId, number[]>>
}

export function createInitialFoodHistory(market: CommodityMarket = initialCommodityMarket(), food = createInitialFoodMarket()) {
  return Object.fromEntries(RECIPE_IDS.map((id) => [id, [preparedFoodValue(id, market, food[id])]])) as Partial<Record<RecipeId, number[]>>
}

const FIRST_RAIN_SECONDS = 45
const WEATHER_LOOP: ReadonlyArray<{ kind: WeatherKind; seconds: number }> = [
  { kind: 'mist', seconds: 60 },
  { kind: 'clear', seconds: 90 },
  { kind: 'sunny', seconds: 75 },
  { kind: 'breeze', seconds: 70 },
  { kind: 'rain', seconds: 55 },
]

export function weatherAtElapsed(elapsedSeconds: number) {
  let elapsed = Math.max(0, Math.floor(elapsedSeconds))
  if (elapsed < FIRST_RAIN_SECONDS) return { weather: 'rain' as const, seconds: FIRST_RAIN_SECONDS - elapsed }
  elapsed -= FIRST_RAIN_SECONDS
  const loopSeconds = WEATHER_LOOP.reduce((sum, segment) => sum + segment.seconds, 0)
  elapsed %= loopSeconds
  for (const segment of WEATHER_LOOP) {
    if (elapsed < segment.seconds) return { weather: segment.kind, seconds: segment.seconds - elapsed }
    elapsed -= segment.seconds
  }
  return { weather: 'mist' as const, seconds: WEATHER_LOOP[0].seconds }
}

export function advanceMarketCycle(
  commodityMarket: CommodityMarket,
  commodityPending: Partial<Record<CommodityId, number>>,
  stockPrices: Record<StockId, number>,
  stockHistory: Record<StockId, number[]>,
  stockSupply: Record<StockId, number>,
  foodMarket: Record<RecipeId, number>,
  cycle: number,
  weather: WeatherKind,
  matchSeed: number,
) {
  const settled = { ...commodityMarket }
  ;(Object.keys(COMMODITY_MARKET_CONFIG) as CommodityId[]).forEach((id) => { settled[id] += commodityPending[id] ?? 0 })
  const nextCommodityMarket = advanceCommodityCycle(settled, cycle + 1, weather, matchSeed)
  const nextStockPrices = { ...stockPrices }
  const nextStockHistory = { ...stockHistory }
  const nextStockSupply = { ...stockSupply }
  STOCK_IDS.forEach((id, index) => {
    const stock = STOCKS[id]
    const elapsedSeconds = cycle * MATCH_CONFIG.stockUpdateSeconds
    if (!stockAvailable(stock, elapsedSeconds)) return
    const previous = nextStockHistory[id].at(-1) ?? stock.basePrice
    const next = nextStockPrice(stock, previous, cycle, index, matchSeed)
    nextStockPrices[id] = next
    nextStockHistory[id] = [...nextStockHistory[id], next].slice(-5)
    nextStockSupply[id] += stockWaveQuantity(stock, elapsedSeconds / 60)
  })
  const nextFoodMarket = { ...foodMarket }
  RECIPE_IDS.forEach((id, index) => {
    const demandBase = RECIPES[id].group === 'early' ? 8 : RECIPES[id].group === 'middle' ? 4 : 2
    const demand = Math.max(1, demandBase + (((cycle + 1) + index * 3) % 3) - 1)
    nextFoodMarket[id] = Math.max(1, nextFoodMarket[id] - demand)
  })
  return { commodityMarket: nextCommodityMarket, stockPrices: nextStockPrices, stockHistory: nextStockHistory, stockSupply: nextStockSupply, foodMarket: nextFoodMarket }
}

export function dueMarketCorrections(durationSeconds: number, elapsedSeconds: number, applied: number[]) {
  return marketCorrectionMilestones(durationSeconds).filter((milestone) => milestone <= elapsedSeconds && !applied.includes(milestone))
}
