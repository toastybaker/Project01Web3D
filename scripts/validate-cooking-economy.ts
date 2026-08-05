import assert from 'node:assert/strict'
import { ITEMS } from '../src/game/items'
import { RECIPES, type RecipeId } from '../src/game/recipes'

const batchSize = 20

const rows = Object.values(RECIPES).map((recipe) => {
  const ingredientOpportunityCost = Object.entries(recipe.ingredients).reduce((sum, [id, quantity]) => {
    return sum + (ITEMS[id as keyof typeof ITEMS].sellPrice ?? 0) * Number(quantity)
  }, 0)
  const salePerDish = Math.round(ingredientOpportunityCost * recipe.multiplier)
  const operatingProfitPerDish = salePerDish - ingredientOpportunityCost
  const operatingProfitPerMinute = Math.round(operatingProfitPerDish * batchSize * 60 / recipe.cookSeconds)
  return { recipe: recipe.id, group: recipe.group, ingredientOpportunityCost, salePerDish, operatingProfitPerMinute }
})

const byId = Object.fromEntries(rows.map((row) => [row.recipe, row])) as Record<RecipeId, (typeof rows)[number]>
const strongest = rows.reduce((best, row) => row.operatingProfitPerMinute > best.operatingProfitPerMinute ? row : best)

assert(byId['apple-bread'].operatingProfitPerMinute < 300_000, 'early cooking became the fastest opening route')
assert(strongest.group === 'late', 'late-game cooking no longer has a clear premium recipe')
assert(strongest.operatingProfitPerMinute > 5_000_000, 'two-furnace late cooking no longer beats strong Crystal mining')
assert(strongest.operatingProfitPerMinute < 8_000_000, 'neutral late cooking exceeds the intended sustainable range')

console.table(rows)
console.log(JSON.stringify({
  status: 'passed',
  batchSize,
  setupCost: (ITEMS['farm-deed'].buyPrice ?? 0) + (ITEMS.furnace.buyPrice ?? 0) * 2,
  strongest,
  neutralPaybackMinutes: Number((((ITEMS['farm-deed'].buyPrice ?? 0) + (ITEMS.furnace.buyPrice ?? 0) * 2) / strongest.operatingProfitPerMinute).toFixed(2)),
}, null, 2))
