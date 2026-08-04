import assert from 'node:assert/strict'
import { BASKET_CONFIG, CROP_CONFIG, FORAGE_CONFIG, ORE_CONFIG, PICKAXE_CONFIG } from '../src/game/config'
import { miningDuration, oreWeightsAtDepth, type OreItem, type PickaxeItem } from '../src/game/ore'

const expectedYield = (outcomes: readonly { chance: number; bonus: number }[]) => outcomes.reduce((sum, outcome) => sum + outcome.chance * (1 + outcome.bonus), 0)

function miningCoinsPerMinute(tool: PickaxeItem, depthZ: number, targetOverheadSeconds = 1.25) {
  const weights = oreWeightsAtDepth(depthZ)
  const unlocked = new Set<string>(PICKAXE_CONFIG[tool].unlocks)
  const mineable = (Object.entries(weights) as Array<[OreItem, number]>).filter(([ore]) => unlocked.has(ore))
  const total = mineable.reduce((sum, [, weight]) => sum + weight, 0)
  const valuePerNode = mineable.reduce((sum, [ore, weight]) => sum + weight / total * ORE_CONFIG[ore].value, 0) * expectedYield(PICKAXE_CONFIG[tool].fortune)
  const secondsPerNode = mineable.reduce((sum, [ore, weight]) => sum + weight / total * miningDuration(tool, ore) / 1000, 0) + targetOverheadSeconds
  return Math.round(valuePerNode * 60 / secondsPerNode)
}

const miningRates = {
  starter: miningCoinsPerMinute('worn-pickaxe', 8),
  iron: miningCoinsPerMinute('iron-pickaxe', -76),
  steel: miningCoinsPerMinute('steel-pickaxe', -125),
  crystal: miningCoinsPerMinute('crystal-pickaxe', -150),
}

assert(miningRates.starter >= 200_000 && miningRates.starter <= 320_000, 'starter mining no longer funds a first upgrade in a few focused minutes')
assert(miningRates.iron > miningRates.starter * 1.35, 'iron pickaxe lacks a meaningful throughput improvement')
assert(miningRates.steel > miningRates.iron * 1.45, 'steel pickaxe lacks a meaningful throughput improvement')
assert(miningRates.crystal > miningRates.steel * 1.7, 'crystal pickaxe lacks an end-game throughput improvement')

const cropRows = Object.entries(CROP_CONFIG).map(([crop, config]) => {
  const netPerHarvest = config.value * config.yield - config.seedPrice
  const netPerMinute64 = Math.round(netPerHarvest * 64 * 60 / config.growthSeconds)
  return { crop, netPerHarvest, netPerMinute64 }
})
assert(cropRows.every((row) => row.netPerHarvest > 0), 'a raw crop loses money before market movement')
assert(Math.min(...cropRows.map((row) => row.netPerMinute64)) >= 250_000, 'an actively worked farm cannot repay its deed during the middle game')
assert(Math.max(...cropRows.map((row) => row.netPerMinute64)) <= 600_000, 'raw farming overwhelms cooking and exploration')

const averageFruitValue = (FORAGE_CONFIG.apple.value + FORAGE_CONFIG.orange.value) / 2
const carrierRows = Object.entries(BASKET_CONFIG).map(([carrier, config]) => ({
  carrier,
  capacity: config.capacity,
  fullLoadValue: Math.round(config.capacity * averageFruitValue * expectedYield(config.fortune)),
}))
assert(carrierRows[0].fullLoadValue <= 150_000, 'hand gathering skips the first upgrade')
assert(carrierRows.every((row, index) => index === 0 || row.fullLoadValue > carrierRows[index - 1].fullLoadValue * 1.8), 'forage storage upgrades do not create distinct trip sizes')

// A focused but non-perfect route. It excludes stock speculation, secret deals,
// lottery winnings, cooking premiums, market surges, and minigame cash, so it is
// a conservative floor rather than a promised outcome.
let projectedCash = 100_000
projectedCash += miningRates.starter * 4
projectedCash -= PICKAXE_CONFIG['iron-pickaxe'].price
projectedCash += miningRates.iron * 10
projectedCash -= PICKAXE_CONFIG['steel-pickaxe'].price
projectedCash += miningRates.steel * 18
projectedCash -= PICKAXE_CONFIG['crystal-pickaxe'].price
projectedCash += miningRates.crystal * 28

assert(projectedCash >= 75_000_000, 'a highly active one-hour route cannot approach the intended late-game scale without gambling')
assert(projectedCash <= 180_000_000, 'deterministic gathering alone overshoots the intended one-hour scale')

console.table(Object.entries(miningRates).map(([tier, coinsPerMinute]) => ({ tier, coinsPerMinute })))
console.table(cropRows)
console.table(carrierRows)
console.log(`Conservative active-hour projection: ${Math.round(projectedCash).toLocaleString()} coins`)
