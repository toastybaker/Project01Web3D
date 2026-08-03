import { BASKET_CONFIG, CROP_CONFIG, FORAGE_CONFIG, ORE_CONFIG, PICKAXE_CONFIG } from './config'

export type ItemId =
  | 'farm-deed' | 'lottery-ticket' | 'information-note' | 'cookbook-box' | 'furnace' | 'water-can' | 'home-charm' | 'gold-coins'
  | 'worn-pickaxe' | 'iron-pickaxe' | 'steel-pickaxe' | 'crystal-pickaxe'
  | 'basket' | 'reinforced-basket' | 'master-basket'
  | 'wheat-seeds' | 'tomato-seeds' | 'lettuce-seeds' | 'pumpkin-seeds' | 'watermelon-seeds'
  | 'wheat' | 'tomato' | 'lettuce' | 'pumpkin' | 'watermelon'
  | 'berries' | 'apple' | 'orange' | 'mushroom' | 'wild-herbs' | 'wildflower' | 'truffle' | 'natural-discovery'
  | 'copper-ore' | 'iron-ore' | 'silver-ore' | 'gold-ore' | 'crystal-ore' | 'ancient-ore'
  | 'food-berry-jam' | 'food-apple-bread' | 'food-mushroom-skewer' | 'food-garden-salad' | 'food-citrus-mix'
  | 'food-meadow-stew' | 'food-orchard-pie' | 'food-pumpkin-bread' | 'food-farmhouse-plate'
  | 'food-melon-preserve' | 'food-harvest-feast' | 'food-truffle-banquet'

export type ShopKind = 'common' | 'forage' | 'forage-sell' | 'farm' | 'produce' | 'mine' | 'ore'
export type StockId = 'apple' | 'samsung' | 'nvidia' | 'google' | 'amd'

export type ItemDefinition = {
  id: ItemId
  name: string
  icon: string
  buyPrice?: number
  sellPrice?: number
  category: 'tool' | 'seed' | 'crop' | 'forage' | 'ore' | 'utility' | 'cooking'
  limited?: boolean
  hotbar?: boolean
}

export const ITEMS: Record<ItemId, ItemDefinition> = {
  'farm-deed': { id: 'farm-deed', name: 'Farm Deed', icon: '/assets/ui/items/land-deed.png', buyPrice: 5_000_000, category: 'utility', limited: true, hotbar: false },
  'lottery-ticket': { id: 'lottery-ticket', name: 'Lottery', icon: '/assets/ui/items/lottery-ticket.png', buyPrice: 30_000, category: 'utility' },
  'information-note': { id: 'information-note', name: 'Broker Note', icon: '/assets/ui/cooking/cookbook.png', category: 'utility' },
  'cookbook-box': { id: 'cookbook-box', name: 'Cookbook Box', icon: '/assets/ui/cooking/cookbook.png', buyPrice: 600_000, category: 'cooking' },
  furnace: { id: 'furnace', name: 'Farm Furnace', icon: '/assets/ui/cooking/furnace-idle-v2.png', buyPrice: 2_000_000, category: 'cooking', hotbar: false },
  'water-can': { id: 'water-can', name: 'Watering Can', icon: '/assets/ui/items/water-can-v2.png', buyPrice: 90_000, category: 'tool' },
  'worn-pickaxe': { id: 'worn-pickaxe', name: PICKAXE_CONFIG['worn-pickaxe'].name, icon: '/assets/ui/items/worn-pickaxe.png', category: 'tool' },
  'iron-pickaxe': { id: 'iron-pickaxe', name: PICKAXE_CONFIG['iron-pickaxe'].name, icon: '/assets/ui/items/iron-pickaxe.png', buyPrice: PICKAXE_CONFIG['iron-pickaxe'].price, category: 'tool', limited: true },
  'steel-pickaxe': { id: 'steel-pickaxe', name: PICKAXE_CONFIG['steel-pickaxe'].name, icon: '/assets/ui/items/gold-pickaxe.png', buyPrice: PICKAXE_CONFIG['steel-pickaxe'].price, category: 'tool', limited: true },
  'crystal-pickaxe': { id: 'crystal-pickaxe', name: PICKAXE_CONFIG['crystal-pickaxe'].name, icon: '/assets/ui/items/crystal-pickaxe.png', buyPrice: PICKAXE_CONFIG['crystal-pickaxe'].price, category: 'tool', limited: true },
  basket: { id: 'basket', name: BASKET_CONFIG.basket.name, icon: '/assets/ui/items/basket.png', buyPrice: BASKET_CONFIG.basket.price, category: 'tool', limited: true, hotbar: false },
  'reinforced-basket': { id: 'reinforced-basket', name: BASKET_CONFIG['reinforced-basket'].name, icon: '/assets/ui/items/forager-crate.png', buyPrice: BASKET_CONFIG['reinforced-basket'].price, category: 'tool', limited: true, hotbar: false },
  'master-basket': { id: 'master-basket', name: BASKET_CONFIG['master-basket'].name, icon: '/assets/ui/items/orchard-cart.png', buyPrice: BASKET_CONFIG['master-basket'].price, category: 'tool', limited: true, hotbar: false },
  'wheat-seeds': { id: 'wheat-seeds', name: 'Wheat Seeds', icon: '/assets/ui/items/wheat-seeds-v2.png', buyPrice: CROP_CONFIG.wheat.seedPrice, category: 'seed' },
  'tomato-seeds': { id: 'tomato-seeds', name: 'Tomato Seeds', icon: '/assets/ui/items/tomato-seeds.png', buyPrice: CROP_CONFIG.tomato.seedPrice, category: 'seed' },
  'lettuce-seeds': { id: 'lettuce-seeds', name: 'Lettuce Seeds', icon: '/assets/ui/items/lettuce-seeds.png', buyPrice: CROP_CONFIG.lettuce.seedPrice, category: 'seed' },
  'pumpkin-seeds': { id: 'pumpkin-seeds', name: 'Pumpkin Seeds', icon: '/assets/ui/items/pumpkin-seeds.png', buyPrice: CROP_CONFIG.pumpkin.seedPrice, category: 'seed' },
  'watermelon-seeds': { id: 'watermelon-seeds', name: 'Watermelon Seeds', icon: '/assets/ui/items/watermelon-seeds.png', buyPrice: CROP_CONFIG.watermelon.seedPrice, category: 'seed' },
  wheat: { id: 'wheat', name: CROP_CONFIG.wheat.name, icon: '/assets/ui/items/wheat-v2.png', sellPrice: CROP_CONFIG.wheat.value, category: 'crop' },
  tomato: { id: 'tomato', name: CROP_CONFIG.tomato.name, icon: '/assets/ui/items/tomato.png', sellPrice: CROP_CONFIG.tomato.value, category: 'crop' },
  lettuce: { id: 'lettuce', name: CROP_CONFIG.lettuce.name, icon: '/assets/ui/items/lettuce.png', sellPrice: CROP_CONFIG.lettuce.value, category: 'crop' },
  pumpkin: { id: 'pumpkin', name: CROP_CONFIG.pumpkin.name, icon: '/assets/ui/items/pumpkin.png', sellPrice: CROP_CONFIG.pumpkin.value, category: 'crop' },
  watermelon: { id: 'watermelon', name: CROP_CONFIG.watermelon.name, icon: '/assets/ui/items/watermelon.png', sellPrice: CROP_CONFIG.watermelon.value, category: 'crop' },
  berries: { id: 'berries', name: FORAGE_CONFIG.berries.name, icon: '/assets/ui/forage/berries.svg', sellPrice: FORAGE_CONFIG.berries.value, category: 'forage' },
  apple: { id: 'apple', name: FORAGE_CONFIG.apple.name, icon: '/assets/ui/forage/apple-v2.png', sellPrice: FORAGE_CONFIG.apple.value, category: 'forage' },
  orange: { id: 'orange', name: FORAGE_CONFIG.orange.name, icon: '/assets/ui/forage/orange-v2.png', sellPrice: FORAGE_CONFIG.orange.value, category: 'forage' },
  mushroom: { id: 'mushroom', name: FORAGE_CONFIG.mushroom.name, icon: '/assets/ui/forage/mushroom.svg', sellPrice: FORAGE_CONFIG.mushroom.value, category: 'forage' },
  'wild-herbs': { id: 'wild-herbs', name: FORAGE_CONFIG['wild-herbs'].name, icon: '/assets/ui/forage/wild-herbs.svg', sellPrice: FORAGE_CONFIG['wild-herbs'].value, category: 'forage' },
  wildflower: { id: 'wildflower', name: FORAGE_CONFIG.wildflower.name, icon: '/assets/ui/forage/wildflower.svg', sellPrice: FORAGE_CONFIG.wildflower.value, category: 'forage' },
  truffle: { id: 'truffle', name: FORAGE_CONFIG.truffle.name, icon: '/assets/ui/forage/truffle-v2.png', sellPrice: FORAGE_CONFIG.truffle.value, category: 'forage' },
  'natural-discovery': { id: 'natural-discovery', name: FORAGE_CONFIG['natural-discovery'].name, icon: '/assets/ui/forage/natural-discovery-v2.png', sellPrice: FORAGE_CONFIG['natural-discovery'].value, category: 'forage' },
  'copper-ore': { id: 'copper-ore', name: ORE_CONFIG['copper-ore'].name, icon: '/assets/ui/items/copper-ore.png', sellPrice: ORE_CONFIG['copper-ore'].value, category: 'ore' },
  'iron-ore': { id: 'iron-ore', name: ORE_CONFIG['iron-ore'].name, icon: '/assets/ui/items/iron-ore.png', sellPrice: ORE_CONFIG['iron-ore'].value, category: 'ore' },
  'silver-ore': { id: 'silver-ore', name: ORE_CONFIG['silver-ore'].name, icon: '/assets/ui/items/stone-ore.png', sellPrice: ORE_CONFIG['silver-ore'].value, category: 'ore' },
  'gold-ore': { id: 'gold-ore', name: ORE_CONFIG['gold-ore'].name, icon: '/assets/ui/items/rich-ore.png', sellPrice: ORE_CONFIG['gold-ore'].value, category: 'ore' },
  'crystal-ore': { id: 'crystal-ore', name: ORE_CONFIG['crystal-ore'].name, icon: '/assets/ui/items/crystal-ore.png', sellPrice: ORE_CONFIG['crystal-ore'].value, category: 'ore' },
  'ancient-ore': { id: 'ancient-ore', name: ORE_CONFIG['ancient-ore'].name, icon: '/assets/ui/items/rich-ore.png', sellPrice: ORE_CONFIG['ancient-ore'].value, category: 'ore' },
  'food-berry-jam': { id: 'food-berry-jam', name: 'Orchard Jam', icon: '/assets/ui/cooking/berry-jam.png', category: 'cooking' },
  'food-apple-bread': { id: 'food-apple-bread', name: 'Apple Bread', icon: '/assets/ui/cooking/apple-bread.png', category: 'cooking' },
  'food-mushroom-skewer': { id: 'food-mushroom-skewer', name: 'Farm Skewer', icon: '/assets/ui/cooking/mushroom-skewer.png', category: 'cooking' },
  'food-garden-salad': { id: 'food-garden-salad', name: 'Garden Salad', icon: '/assets/ui/cooking/garden-salad.png', category: 'cooking' },
  'food-citrus-mix': { id: 'food-citrus-mix', name: 'Citrus Mix', icon: '/assets/ui/cooking/citrus-mix.png', category: 'cooking' },
  'food-meadow-stew': { id: 'food-meadow-stew', name: 'Meadow Stew', icon: '/assets/ui/cooking/meadow-stew.png', category: 'cooking' },
  'food-orchard-pie': { id: 'food-orchard-pie', name: 'Orchard Pie', icon: '/assets/ui/cooking/orchard-pie.png', category: 'cooking' },
  'food-pumpkin-bread': { id: 'food-pumpkin-bread', name: 'Pumpkin Bread', icon: '/assets/ui/cooking/pumpkin-bread.png', category: 'cooking' },
  'food-farmhouse-plate': { id: 'food-farmhouse-plate', name: 'Farmhouse Plate', icon: '/assets/ui/cooking/farmhouse-plate.png', category: 'cooking' },
  'food-melon-preserve': { id: 'food-melon-preserve', name: 'Melon Preserve', icon: '/assets/ui/cooking/melon-preserve.png', category: 'cooking' },
  'food-harvest-feast': { id: 'food-harvest-feast', name: 'Harvest Feast', icon: '/assets/ui/cooking/harvest-feast.png', category: 'cooking' },
  'food-truffle-banquet': { id: 'food-truffle-banquet', name: 'Truffle Banquet', icon: '/assets/ui/cooking/truffle-banquet.png', category: 'cooking' },
  'home-charm': { id: 'home-charm', name: 'Return Charm', icon: '/assets/ui/items/home-charm.svg', category: 'utility' },
  'gold-coins': { id: 'gold-coins', name: 'Coins', icon: '/assets/ui/items/gold-coins.png', category: 'utility' },
}

export const SHOPS: Record<ShopKind, { title: string; items: ItemId[]; action: 'buy' | 'sell' }> = {
  common: { title: 'COMMON SHOP', items: ['farm-deed', 'cookbook-box', 'lottery-ticket'], action: 'buy' },
  forage: { title: 'FORAGING SHOP', items: ['basket', 'reinforced-basket', 'master-basket'], action: 'buy' },
  'forage-sell': { title: 'FORAGE MARKET', items: ['apple', 'orange', 'truffle', 'natural-discovery'], action: 'sell' },
  farm: { title: 'FARM SHOP', items: ['wheat-seeds', 'tomato-seeds', 'lettuce-seeds', 'pumpkin-seeds', 'watermelon-seeds', 'water-can', 'furnace'], action: 'buy' },
  produce: { title: 'PRODUCE STAND', items: ['wheat', 'tomato', 'lettuce', 'pumpkin', 'watermelon'], action: 'sell' },
  mine: { title: 'MINING SHOP', items: ['iron-pickaxe', 'steel-pickaxe', 'crystal-pickaxe'], action: 'buy' },
  ore: { title: 'ORE STAND', items: ['copper-ore', 'iron-ore', 'silver-ore', 'gold-ore', 'crystal-ore', 'ancient-ore'], action: 'sell' },
}

export type StockDefinition = {
  id: StockId
  name: string
  ticker: string
  logo: string
  color: string
  basePrice: number
  releaseMinute: number
  volatility: number
  waveSize: number
}

export const STOCKS: Record<StockId, StockDefinition> = {
  apple: { id: 'apple', name: 'Apple', ticker: 'AAPL', logo: '/assets/brands/apple.svg', color: '#d9d9d9', basePrice: 55_000, releaseMinute: 0, volatility: 0.18, waveSize: 4 },
  samsung: { id: 'samsung', name: 'Samsung', ticker: 'SMSN', logo: '/assets/brands/samsung.svg', color: '#5f83d8', basePrice: 180_000, releaseMinute: 0, volatility: 0.24, waveSize: 3 },
  nvidia: { id: 'nvidia', name: 'NVIDIA', ticker: 'NVDA', logo: '/assets/brands/nvidia.svg', color: '#76b900', basePrice: 1_650_000, releaseMinute: 0, volatility: 0.38, waveSize: 2 },
  google: { id: 'google', name: 'Google', ticker: 'GOOG', logo: '/assets/brands/google.svg', color: '#4285f4', basePrice: 8_500_000, releaseMinute: 0, volatility: 0.22, waveSize: 1 },
  amd: { id: 'amd', name: 'AMD', ticker: 'AMD', logo: '/assets/brands/amd.svg', color: '#ed1c24', basePrice: 32_000_000, releaseMinute: 0, volatility: 0.46, waveSize: 1 },
}

export const INVENTORY_ITEMS = Object.keys(ITEMS).filter((id) => id !== 'gold-coins') as ItemId[]

function fortuneLine(outcomes: readonly { chance: number; bonus: number }[]) {
  return outcomes.map(({ chance, bonus }) => `${Math.round(chance * 100)}% ×${bonus + 1}`).join(' · ')
}

export function itemTooltip(id: ItemId): string[] | null {
  if (id === 'water-can') return ['Waters one planted crop.']
  if (id === 'furnace') return ['+10 batch capacity each.', 'Three queued recipes.']
  if (id === 'home-charm') return ['LMB Common · RMB Choose destination']
  if (id === 'lottery-ticket') return ['RMB View chosen numbers']
  if (id === 'information-note') return ['RMB Read information']
  if (id in PICKAXE_CONFIG) {
    const pickaxe = PICKAXE_CONFIG[id as keyof typeof PICKAXE_CONFIG]
    return [`${pickaxe.speed.toFixed(2)}× mining speed`, ...pickaxe.fortune.map(({ chance, bonus }) => `${Math.round(chance * 100)}% chance: ${bonus + 1}× yield`)]
  }
  if (id in BASKET_CONFIG) {
    const carrier = BASKET_CONFIG[id as keyof typeof BASKET_CONFIG]
    return [`Stores ${carrier.capacity} fruit`, ...carrier.fortune.map(({ chance, bonus }) => `${Math.round(chance * 100)}% chance: ${bonus + 1}× yield`)]
  }
  return null
}
