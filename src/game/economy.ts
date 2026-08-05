import { COMMODITY_MARKET_CONFIG, CROP_CONFIG, MATCH_CONFIG, type CommodityId } from './config'
import type { StockDefinition } from './items'

export type CommodityMarket = Record<CommodityId, number>

export function economyScale(_cycle: number) { return 1 }
export function scaledValue(base: number, _cycle: number, rate = 1) { return Math.max(1, Math.round(base * rate)) }

export function formatCoins(value: number, compact = false) {
  const amount = Math.max(0, Math.round(value))
  if (!compact || amount < 1_000_000) return amount.toLocaleString('en-US')
  const divisor = amount >= 1_000_000_000 ? 1_000_000_000 : 1_000_000
  const suffix = divisor === 1_000_000_000 ? 'B' : 'M'
  const short = amount / divisor
  return `${short >= 100 ? short.toFixed(0) : short >= 10 ? short.toFixed(1) : short.toFixed(2)}${suffix}`
}

export function lotteryPrice(_cycle = 1) { return 30_000 }
export function lotteryTwoMatch(_cycle = 1) { return 190_000 }
export function lotteryJackpot(_cycle = 1) { return 950_000 }

export function seeded01(seed: number) {
  let value = Math.floor(seed) | 0
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296
}

export function initialCommodityMarket(): CommodityMarket {
  return Object.fromEntries(Object.entries(COMMODITY_MARKET_CONFIG).map(([id, config]) => [id, config.neutral])) as CommodityMarket
}

export function commodityMultiplier(id: CommodityId, stock: number) {
  const config = COMMODITY_MARKET_CONFIG[id]
  const stockRatio = config.neutral / Math.max(stock, config.neutral * 0.05)
  const raw = config.minimum + (1 - config.minimum) * Math.pow(stockRatio, config.elasticity)
  return Math.min(config.maximum, Math.max(config.minimum, raw))
}

export function commodityPrice(id: CommodityId, baseValue: number, stock: number) {
  const crop = id in CROP_CONFIG ? CROP_CONFIG[id as keyof typeof CROP_CONFIG] : null
  const cropFloor = crop ? Math.ceil(crop.seedPrice / crop.yield) : 1
  return Math.max(cropFloor, Math.round(baseValue * commodityMultiplier(id, stock)))
}

export function marginalSale(id: CommodityId, baseValue: number, stock: number, quantity: number) {
  let nextStock = Math.max(0, stock)
  let proceeds = 0
  for (let index = 0; index < Math.max(0, Math.floor(quantity)); index += 1) {
    proceeds += commodityPrice(id, baseValue, nextStock)
    nextStock += 1
  }
  return { proceeds, stock: nextStock }
}

export function advanceCommodityCycle(market: CommodityMarket, cycle: number, weather: 'clear' | 'rain' | 'mist' | 'sunny' | 'breeze', matchSeed = 9731) {
  const next = { ...market }
  ;(Object.keys(COMMODITY_MARKET_CONFIG) as CommodityId[]).forEach((id, index) => {
    const config = COMMODITY_MARKET_CONFIG[id]
    const demandRoll = seeded01(matchSeed + cycle * 1009 + index * 97 + 17)
    let demand = config.demand[0] + Math.round((config.demand[1] - config.demand[0]) * demandRoll)
    if (weather === 'rain' && (id === 'mushroom' || id === 'wild-herbs' || id === 'wheat')) demand = Math.round(demand * 1.18)
    if (weather === 'mist' && (id === 'apple' || id === 'orange' || id === 'berries')) demand = Math.round(demand * 1.12)
    const supplyEvent = seeded01(matchSeed + cycle * 2017 + index * 131 + 43) < 0.13
      ? Math.round(config.neutral * (0.04 + seeded01(matchSeed + cycle * 3037 + index * 151) * 0.08))
      : 0
    next[id] = Math.max(config.neutral * 0.03, next[id] - demand + supplyEvent)
  })
  return next
}

export function stockAvailable(stock: StockDefinition, elapsedSeconds: number) {
  return elapsedSeconds >= stock.releaseMinute * 60
}

export function stockWaveQuantity(stock: StockDefinition, elapsedMinutes: number) {
  if (elapsedMinutes < stock.releaseMinute) return 0
  return stock.waveSize + Math.min(4, Math.floor((elapsedMinutes - stock.releaseMinute) / 15))
}

export function nextStockPrice(stock: StockDefinition, previous: number, updateIndex: number, stockIndex: number, matchSeed = 9731) {
  const regime = stock.volatility <= 0.14 ? 'stable' : stock.volatility < 0.28 ? 'growth' : 'speculative'
  const a = Math.max(1e-8, seeded01(matchSeed + updateIndex * 313 + stockIndex * 911))
  const b = seeded01(matchSeed + updateIndex * 577 + stockIndex * 353)
  const normalish = Math.sqrt(-2 * Math.log(a)) * Math.cos(Math.PI * 2 * b)
  let change = regime === 'stable' ? 0.004 + normalish * stock.volatility * 0.34
    : regime === 'growth' ? 0.008 + normalish * stock.volatility * 0.52
      : 0.006 + normalish * stock.volatility * 0.72
  const shock = seeded01(matchSeed + updateIndex * 1237 + stockIndex * 199)
  const tail = seeded01(matchSeed + updateIndex * 1877 + stockIndex * 43)
  if (shock < 0.012) change = 1.0 + tail
  else if (shock > 0.988) change = -(0.42 + tail * 0.35)
  else if (shock < 0.07) change += 0.28 + tail * 0.42
  else if (shock > 0.93) change -= 0.25 + tail * 0.35
  const next = Math.round(previous * Math.max(0.01, 1 + change))
  return Math.min(stock.basePrice * 20, Math.max(Math.round(stock.basePrice * 0.08), next))
}

export function sessionSecondsRemaining(worldCycle: number, cycleSeconds: number, durationSeconds = MATCH_CONFIG.defaultDurationSeconds) {
  return Math.max(0, durationSeconds - ((Math.max(1, worldCycle) - 1) * MATCH_CONFIG.worldCycleSeconds + (MATCH_CONFIG.worldCycleSeconds - cycleSeconds)))
}
