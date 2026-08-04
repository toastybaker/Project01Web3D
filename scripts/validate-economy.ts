import { BASKET_CONFIG, COMMODITY_MARKET_CONFIG, CROP_CONFIG, FORAGE_CONFIG, MATCH_CONFIG, ORE_CONFIG, PICKAXE_CONFIG, forageSiteAvailability, fruitTreeCapacity } from '../src/game/config'
import { advanceCommodityCycle, initialCommodityMarket, lotteryJackpot, lotteryPrice, lotteryTwoMatch, marginalSale, nextStockPrice, stockWaveQuantity } from '../src/game/economy'
import { STOCKS, type StockId } from '../src/game/items'
import { RECIPES } from '../src/game/recipes'
import { oreKindAtDepth, oreRespawnMs, oreWeightsAtDepth } from '../src/game/ore'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }

assert(MATCH_CONFIG.startingCash === 100_000, 'Starting cash drifted')
assert(PICKAXE_CONFIG['iron-pickaxe'].price === 750_000, 'Iron pickaxe price drifted')
assert(PICKAXE_CONFIG['steel-pickaxe'].price === 4_000_000, 'Steel pickaxe price drifted')
assert(PICKAXE_CONFIG['crystal-pickaxe'].price === 18_000_000, 'Crystal pickaxe price drifted')
assert(ORE_CONFIG['copper-ore'].value === 8_000 && ORE_CONFIG['ancient-ore'].value === 1_500_000, 'Ore endpoints drifted')
assert(CROP_CONFIG.wheat.seedPrice === 10_000 && CROP_CONFIG.watermelon.seedPrice === 750_000, 'Crop prices drifted')
assert(COMMODITY_MARKET_CONFIG.watermelon.neutral >= 100 && COMMODITY_MARKET_CONFIG.watermelon.demand[0] >= 15, 'Watermelon market cannot absorb a normal harvest')
assert(FORAGE_CONFIG.apple.value === 4_000 && FORAGE_CONFIG.orange.value === 6_000, 'Orchard fruit values drifted')
assert(BASKET_CONFIG.hand.capacity === 24 && BASKET_CONFIG.basket.capacity === 80 && BASKET_CONFIG['reinforced-basket'].capacity === 180 && BASKET_CONFIG['master-basket'].capacity === 360, 'Fruit storage progression drifted')
assert(Object.values(RECIPES).every((recipe) => Object.keys(recipe.ingredients).length <= 4 && recipe.multiplier <= 1.65 && recipe.cookSeconds >= 30 && recipe.cookSeconds <= 60), 'Recipe bounds failed')
const obtainableCookingItems = new Set(['apple', 'orange', 'truffle', 'wheat', 'tomato', 'lettuce', 'pumpkin', 'watermelon'])
assert(Object.values(RECIPES).every((recipe) => Object.keys(recipe.ingredients).every((item) => obtainableCookingItems.has(item))), 'Recipe requires an unavailable ingredient')

const fruitClock = 1_000_000
const appleCapacity = fruitTreeCapacity('ForageApple000')
assert(appleCapacity >= 3 && appleCapacity <= 5, 'Fruit capacity must be 3–5')
assert(forageSiteAvailability('ForageApple000', 0, fruitClock) === appleCapacity, 'Fruit trees must start full')
assert(forageSiteAvailability('ForageApple000', fruitClock + appleCapacity * 30_000, fruitClock) === 0, 'Harvested fruit tree did not empty')
assert(forageSiteAvailability('ForageApple000', fruitClock + (appleCapacity - 1) * 30_000, fruitClock) === 1, 'Fruit tree must regenerate one fruit per 30 seconds')
const expectedBonus = (outcomes: readonly { chance: number; bonus: number }[]) => outcomes.reduce((sum, outcome) => sum + outcome.chance * outcome.bonus, 0)
const fullProgressionBonus = (
  expectedBonus(BASKET_CONFIG.basket.fortune) * 15
  + expectedBonus(BASKET_CONFIG['reinforced-basket'].fortune) * 20
  + expectedBonus(BASKET_CONFIG['master-basket'].fortune) * 20
) / 60
const orchardFruit = 70 * 4 + 60 * 4
const orchardValue = 70 * 4 * FORAGE_CONFIG.apple.value + 60 * 4 * FORAGE_CONFIG.orange.value
assert(orchardFruit === 520 && orchardValue >= 2_400_000 && orchardValue <= 2_700_000, 'Full orchard target drifted')
assert(BASKET_CONFIG.hand.capacity * FORAGE_CONFIG.orange.value <= 150_000, 'Starter forage trip payout is too inflated')
assert(fullProgressionBonus > 0.5 && fullProgressionBonus < 1.3, 'Forage fortune curve is unreasonable')

const oreShare = (z: number) => {
  const weights = oreWeightsAtDepth(z)
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
  return Object.fromEntries(Object.entries(weights).map(([id, weight]) => [id, weight / total])) as Record<keyof typeof weights, number>
}
const entranceOre = oreShare(8)
const middleOre = oreShare(-76)
const deepOre = oreShare(-150)
assert(entranceOre['copper-ore'] >= 0.89 && entranceOre['iron-ore'] <= 0.11, 'Entrance ore mix must stay near 90/10')
assert(entranceOre['silver-ore'] === 0 && entranceOre['gold-ore'] === 0 && entranceOre['crystal-ore'] === 0 && entranceOre['ancient-ore'] === 0, 'Rare ore leaked into entrance')
assert(deepOre['copper-ore'] > deepOre['iron-ore'] && deepOre['copper-ore'] > 0.35, 'Common ore must remain dominant at full depth')
assert(deepOre['ancient-ore'] > 0 && deepOre['ancient-ore'] < 0.02, 'Ancient ore depth tail is out of bounds')
assert(middleOre['silver-ore'] > entranceOre['silver-ore'] && deepOre['silver-ore'] > middleOre['silver-ore'], 'Silver depth curve is not progressive')

const rareOres = new Set(['gold-ore', 'crystal-ore', 'ancient-ore'])
for (let seed = 0; seed < 500; seed += 1) assert(!rareOres.has(oreKindAtDepth('MineOre244', -190, 0, seed)), 'Initial rare-ore gate leaked')
let rerolledRare = false
for (let seed = 0; seed < 2_000; seed += 1) if (rareOres.has(oreKindAtDepth('MineOre244', -190, 1, seed))) rerolledRare = true
assert(rerolledRare, 'Rare ores never enter deep-node rerolls')
for (let generation = 1; generation < 40; generation += 1) {
  const cooldown = oreRespawnMs('MineOre244', generation, 913_711)
  assert(cooldown >= 28_000 && cooldown <= 35_000, `Ore respawn escaped target range: ${cooldown}`)
}

const lotteryEv = ((27 / 220) * lotteryTwoMatch() + (1 / 220) * lotteryJackpot()) / lotteryPrice()
assert(lotteryEv >= 0.92 && lotteryEv <= 0.96, `Lottery EV ${(lotteryEv * 100).toFixed(2)}%`)

const commodityRows = []
for (const id of Object.keys(COMMODITY_MARKET_CONFIG) as Array<keyof typeof COMMODITY_MARKET_CONFIG>) {
  const config = COMMODITY_MARKET_CONFIG[id]
  const neutral = initialCommodityMarket()[id]
  const one = marginalSale(id, 100_000, neutral, 1)
  const floodQuantity = Math.max(10, Math.ceil(config.neutral * 0.8))
  const flood = marginalSale(id, 100_000, neutral, floodQuantity)
  assert(one.proceeds > 0 && flood.proceeds > one.proceeds, `${id} bulk sale failed`)
  assert(flood.proceeds / floodQuantity < one.proceeds, `${id} is not marginally priced`)
  commodityRows.push({ item: id, neutral, firstUnit: one.proceeds, floodedAverage: Math.round(flood.proceeds / floodQuantity) })
}
const watermelonBatch = marginalSale('watermelon', CROP_CONFIG.watermelon.value, COMMODITY_MARKET_CONFIG.watermelon.neutral, 16)
assert(watermelonBatch.proceeds > CROP_CONFIG.watermelon.seedPrice * 16, 'A normal watermelon batch loses money at neutral demand')

let market = initialCommodityMarket()
for (let cycle = 1; cycle <= MATCH_CONFIG.totalRounds; cycle += 1) market = advanceCommodityCycle(market, cycle, cycle % 3 === 0 ? 'rain' : 'clear')
assert(Object.values(market).every(Number.isFinite), 'Commodity cycle produced invalid stock')

const stockRows = []
for (const [index, id] of (Object.keys(STOCKS) as StockId[]).entries()) {
  const stock = STOCKS[id]
  let price = stock.basePrice
  let minimum = price
  let maximum = price
  let supply = 0
  for (let update = 1; update <= 15; update += 1) {
    price = nextStockPrice(stock, price, update, index)
    minimum = Math.min(minimum, price)
    maximum = Math.max(maximum, price)
    supply += stockWaveQuantity(stock, update * 4)
  }
  assert(minimum >= stock.basePrice * 0.08 && maximum <= stock.basePrice * 20, `${id} safety bounds failed`)
  assert(minimum !== maximum && supply > 0, `${id} does not move/release`)
  let sawLargeRise = false
  let sawLargeFall = false
  for (let seed = 1; seed <= 80; seed += 1) {
    const sampled = nextStockPrice(stock, stock.basePrice, 2 + seed, index, 9000 + seed * 37)
    sawLargeRise ||= sampled >= stock.basePrice * 1.5
    sawLargeFall ||= sampled <= stock.basePrice * 0.6
  }
  assert(sawLargeRise && sawLargeFall, `${id} cannot reach both broad upside and downside tails`)
  stockRows.push({ id, minimum, maximum, ratio: Number((maximum / minimum).toFixed(2)), supply })
}

console.table(commodityRows)
console.table(stockRows)
console.log(`Lottery EV ${(lotteryEv * 100).toFixed(2)}% · 12 commodity cycles stable · ${Object.keys(RECIPES).length} recipes valid`)
