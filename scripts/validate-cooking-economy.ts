import assert from 'node:assert/strict'
import { ITEMS, SHOPS } from '../src/game/items'
import { PREPARED_FOOD_BASE_VALUE, PREPARED_FOOD_MARKUP, RECIPES, type RecipeId } from '../src/game/recipes'

const batchSize = 10

const rows = Object.values(RECIPES).map((recipe) => {
  const ingredientOpportunityCost = Object.entries(recipe.ingredients).reduce((sum, [id, quantity]) => {
    return sum + (ITEMS[id as keyof typeof ITEMS].sellPrice ?? 0) * Number(quantity)
  }, 0)
  const salePerDish = Math.round((ingredientOpportunityCost * PREPARED_FOOD_MARKUP + PREPARED_FOOD_BASE_VALUE[recipe.group]) * recipe.multiplier)
  const operatingProfitPerDish = salePerDish - ingredientOpportunityCost
  const operatingProfitPerMinute = Math.round(operatingProfitPerDish * batchSize * 60 / recipe.cookSeconds)
  return { recipe: recipe.id, group: recipe.group, ingredientOpportunityCost, salePerDish, operatingProfitPerMinute }
})

const byId = Object.fromEntries(rows.map((row) => [row.recipe, row])) as Record<RecipeId, (typeof rows)[number]>
const strongest = rows.reduce((best, row) => row.operatingProfitPerMinute > best.operatingProfitPerMinute ? row : best)
const preparedFoods = Object.values(RECIPES).map((recipe) => recipe.food)
const groupRows = (group: 'early' | 'middle' | 'late') => rows.filter((row) => row.group === group)
const groupSpread = (group: 'early' | 'middle' | 'late') => {
  const profits = groupRows(group).map((row) => row.salePerDish - row.ingredientOpportunityCost)
  return Math.max(...profits) / Math.max(1, Math.min(...profits))
}
const groupMedian = (group: 'early' | 'middle' | 'late') => {
  const values = groupRows(group).map((row) => row.salePerDish - row.ingredientOpportunityCost).sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)]
}

assert.equal(SHOPS.food.action, 'sell', 'prepared food market must be sell-only')
assert.deepEqual(SHOPS.food.items, preparedFoods, 'prepared food market no longer lists every dish')

assert(rows.every((row) => row.salePerDish > row.ingredientOpportunityCost), 'a prepared dish loses money at neutral supply')
assert(groupSpread('early') <= 2, 'early recipe luck is too decisive')
assert(groupSpread('middle') <= 1.6, 'middle recipe luck is too decisive')
assert(groupSpread('late') <= 1.2, 'late recipe luck is too decisive')
assert(groupMedian('early') < groupMedian('middle') && groupMedian('middle') < groupMedian('late'), 'recipe tiers no longer provide clear progression')
const setupCost = (ITEMS['farm-deed'].buyPrice ?? 0) + (ITEMS['water-can'].buyPrice ?? 0) + (ITEMS.furnace.buyPrice ?? 0) + (ITEMS['cookbook-box'].buyPrice ?? 0)
assert((byId['apple-bread'].salePerDish - byId['apple-bread'].ingredientOpportunityCost) * batchSize < setupCost, 'one ordinary early batch repays the entire cooking setup')
assert(strongest.group === 'late', 'late-game cooking no longer has a clear premium recipe')
assert(strongest.operatingProfitPerMinute > 35_000_000, 'late cooking no longer repays its ingredient and setup burden')
assert(strongest.operatingProfitPerMinute < 55_000_000, 'neutral late cooking exceeds the intended ingredient-limited reference')

console.table(rows)
console.log(JSON.stringify({
  status: 'passed',
  batchSize,
  setupCost,
  groupSpread: { early: groupSpread('early'), middle: groupSpread('middle'), late: groupSpread('late') },
  strongest,
  neutralPaybackMinutes: Number((setupCost / strongest.operatingProfitPerMinute).toFixed(2)),
}, null, 2))
