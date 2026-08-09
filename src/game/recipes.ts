import type { ItemId } from './items'

export type RecipeId =
  | 'berry-jam' | 'apple-bread' | 'mushroom-skewer' | 'garden-salad' | 'citrus-mix'
  | 'meadow-stew' | 'orchard-pie' | 'pumpkin-bread' | 'farmhouse-plate'
  | 'melon-preserve' | 'harvest-feast' | 'truffle-banquet'

export type FoodItemId = `food-${RecipeId}`
export type RecipeGroup = 'early' | 'middle' | 'late'

export type RecipeDefinition = {
  id: RecipeId
  food: FoodItemId
  name: string
  group: RecipeGroup
  ingredients: Partial<Record<ItemId, number>>
  multiplier: number
  cookSeconds: number
}

// Common prepared-food premium. Recipe multipliers still distinguish dish
// complexity; this pays back the deed, furnace, and recipe setup within a
// one-hour cash-at-the-bell match.
export const PREPARED_FOOD_MARKUP = 2
export const PREPARED_FOOD_BASE_VALUE: Record<RecipeGroup, number> = {
  early: 180_000,
  middle: 650_000,
  late: 2_000_000,
}

export const RECIPES: Record<RecipeId, RecipeDefinition> = {
  'berry-jam': { id: 'berry-jam', food: 'food-berry-jam', name: 'Orchard Jam', group: 'early', ingredients: { apple: 3, orange: 2 }, multiplier: 1.18, cookSeconds: 30 },
  'apple-bread': { id: 'apple-bread', food: 'food-apple-bread', name: 'Apple Bread', group: 'early', ingredients: { apple: 2, wheat: 2 }, multiplier: 1.2, cookSeconds: 30 },
  'mushroom-skewer': { id: 'mushroom-skewer', food: 'food-mushroom-skewer', name: 'Farm Skewer', group: 'early', ingredients: { tomato: 2, lettuce: 1 }, multiplier: 1.22, cookSeconds: 30 },
  'garden-salad': { id: 'garden-salad', food: 'food-garden-salad', name: 'Garden Salad', group: 'early', ingredients: { tomato: 2, lettuce: 2 }, multiplier: 1.25, cookSeconds: 30 },
  'citrus-mix': { id: 'citrus-mix', food: 'food-citrus-mix', name: 'Citrus Mix', group: 'early', ingredients: { orange: 3, apple: 2 }, multiplier: 1.2, cookSeconds: 30 },
  'meadow-stew': { id: 'meadow-stew', food: 'food-meadow-stew', name: 'Meadow Stew', group: 'middle', ingredients: { lettuce: 2, tomato: 1, wheat: 1 }, multiplier: 1.35, cookSeconds: 40 },
  'orchard-pie': { id: 'orchard-pie', food: 'food-orchard-pie', name: 'Orchard Pie', group: 'middle', ingredients: { apple: 4, orange: 4, wheat: 2 }, multiplier: 1.38, cookSeconds: 40 },
  'pumpkin-bread': { id: 'pumpkin-bread', food: 'food-pumpkin-bread', name: 'Pumpkin Bread', group: 'middle', ingredients: { pumpkin: 1, wheat: 4 }, multiplier: 1.42, cookSeconds: 45 },
  'farmhouse-plate': { id: 'farmhouse-plate', food: 'food-farmhouse-plate', name: 'Farmhouse Plate', group: 'middle', ingredients: { tomato: 2, lettuce: 2, wheat: 1 }, multiplier: 1.45, cookSeconds: 45 },
  'melon-preserve': { id: 'melon-preserve', food: 'food-melon-preserve', name: 'Melon Preserve', group: 'late', ingredients: { watermelon: 1, orange: 4, apple: 3 }, multiplier: 1.48, cookSeconds: 60 },
  'harvest-feast': { id: 'harvest-feast', food: 'food-harvest-feast', name: 'Harvest Feast', group: 'late', ingredients: { pumpkin: 1, lettuce: 1, tomato: 1, wheat: 2 }, multiplier: 1.58, cookSeconds: 55 },
  'truffle-banquet': { id: 'truffle-banquet', food: 'food-truffle-banquet', name: 'Truffle Banquet', group: 'late', ingredients: { truffle: 1, pumpkin: 1, wheat: 3 }, multiplier: 1.65, cookSeconds: 60 },
}

export const RECIPE_IDS = Object.keys(RECIPES) as RecipeId[]

export function drawRecipe(random: () => number = Math.random): RecipeId {
  const roll = random()
  const group: RecipeGroup = roll < 0.6 ? 'early' : roll < 0.9 ? 'middle' : 'late'
  const options = RECIPE_IDS.filter((id) => RECIPES[id].group === group)
  return options[Math.floor(random() * options.length)]
}
