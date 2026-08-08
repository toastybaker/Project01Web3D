import { create } from 'zustand'
import { ITEMS, SHOPS, STOCKS, type ItemId, type ShopKind, type StockId } from './items'
import { isPickaxe, canMineOre, miningYield, oreRespawnMs, type OreItem, type PickaxeItem } from './ore'
import { BASKET_CONFIG, COMMODITY_MARKET_CONFIG, CROP_CONFIG, FORAGE_CONFIG, MATCH_CONFIG, ORE_CONFIG, PICKAXE_CONFIG, forageSiteAvailability, fruitTreeCapacity, marketCorrectionMilestones, nextRareForageRollAt, type CommodityId } from './config'
import { advanceCommodityCycle, commodityPrice, formatCoins, initialCommodityMarket, lotteryJackpot, lotteryPrice, lotteryTwoMatch, nextStockPrice, scaledValue, seeded01, settleCommoditySale, stockAvailable, stockWaveQuantity, type CommodityMarket } from './economy'
import { PREPARED_FOOD_BASE_VALUE, PREPARED_FOOD_MARKUP, RECIPES, RECIPE_IDS, type FoodItemId, type RecipeId } from './recipes'
import { COOKBOOK_BOX_REWARD_VALUE, FARM_RUSH_GROWTH_MS, FARM_RUSH_MAX_ORDERS, FARM_RUSH_ORDER_LIFETIME_MS, FORAGE_RUSH_DELIVERY_POINTS, FORAGE_RUSH_REQUIREMENTS, FORAGE_RUSH_RESPAWN_MS, MINING_RUSH_POINTS, MINING_RUSH_RESPAWN_MS, applyMinigameItemRewards, farmRushOrders, minigameMilestones, minigameRewards, miningRushOre, scheduledMinigame, type FarmRushCell, type FarmRushCrop, type FarmRushIngredient, type FarmRushTool, type ForageRushKind, type MinigameItemRewardRoll, type MinigameKind, type MinigameRewardItemId, type MiningRushOre } from './minigame'
import { onAuthoritativeAccount, sendMultiplayer, type AuthoritativeAccountAction, type AuthoritativeAccountSnapshot } from './multiplayer'
import { enhancedBasketCapacity, enhancedYield, enhancementLevel, enhancementName, enhancementRequirements, isEnhanceableItem, resolveEnhancementAttempt, type EnhanceableItem, type EnhancementAttemptOptions, type EnhancementLevels } from './enhancement'
import { merchantCycle, type MerchantCycle, type MerchantItemId } from './merchant'
import { STOCK_IDS, commodityPriceSnapshot, createInitialFoodHistory, createInitialFoodMarket, createInitialStockHistory, createInitialStockPrices, createInitialStockSupply, marketCorrectionFor, preparedFoodValue, weatherAtElapsed, type SharedMarketSnapshot } from './market'

export { marketCorrectionFor, preparedFoodValue } from './market'

export type ZoneId = 'hub' | 'forage' | 'farm' | 'mine'
export type Vec3 = [number, number, number]
export type AnchorMap = Record<string, Vec3>
export type WorldCollider = { x: number; z: number; radius: number }
export type CropStage = 'empty' | 'planted' | 'watered' | 'ready'
export type CropKind = keyof typeof CROP_CONFIG
export type FarmCellState = { crop: CropKind | null; stage: CropStage; readyAt: number | null }
export type OnlinePlayer = { id: string; nickname: string; zone: ZoneId; cash: number; progressValue?: number; stats: Stats; minigameOpen?: boolean; minigameKind?: MinigameKind; minigameMilestone?: number; minigameScore?: number }
export type PendingTradeRequest = { fromId: string; fromNickname: string }
export type LotteryTicket = { id: string; numbers: number[]; drawRound: number; tier?: 1 | 5 | 25; draw?: number[]; matches?: number; payout?: number }
export type BrokerNote = { id: string; title: string; text: string; round: number }
export type CookJob = { id: string; recipe: RecipeId; quantity: number; furnaceIndex: number; readyAt: number }
export type RushNodeState = { generation: number; readyAt: number }
export type MineNodeState = { generation: number; readyAt: number }
export type SharedForageNode = { id: string; item: 'apple' | 'orange' | 'truffle' | 'natural-discovery'; capacity: number; available: number; fullAt: number; serverNow?: number }
export type SharedForageSnapshot = { regrowMs: number; serverNow?: number; nodes: Record<string, SharedForageNode> }
export type SharedForageAward = SharedForageNode & { quantity: number }
type MinigameSnapshot = { zone: ZoneId; playerPosition: Vec3; hotbar: Array<ItemId | null>; selectedHotbar: number; inventoryOpen: boolean; startedAt: number }
export type FarmRushCooking = Array<{ orderIndex: number; recipe: RecipeId; readyAt: number }>
export type FarmRushTicket = { orderIndex: number; expiresAt: number }
export type MinigameStanding = { placement: number; nickname: string; score: number }
export type MinigameRewardResult = { kind: MinigameKind; placement: number; score: number; cash: number; items: Partial<Record<MinigameRewardItemId, number>>; standings: MinigameStanding[]; receivedAt: number }
export type SharedFarmSnapshot = { selfId: string; owners: Record<number, string | null>; cells: Record<string, FarmCellState> }
export type SharedFarmUpdate = { farmId: number; ownerId?: string | null; cellIndex?: number; cell?: FarmCellState | null }
export type SharedFarmResult = { requestId: string; ok: boolean; reason?: string; op?: 'claim' | 'plant' | 'water' | 'harvest' | 'rain'; farmId?: number; cellIndex?: number; crop?: CropKind; quantity?: number; account?: AuthoritativeAccountSnapshot }
export type SharedDeedSnapshot = { personalAvailable: boolean; globalRemaining: number }
export type SharedDeedResult = SharedDeedSnapshot & { requestId: string; ok: boolean; quantity: number; personalCount: number; globalCount: number; reason?: string; account?: AuthoritativeAccountSnapshot }
export type MerchantPurchaseResult = { requestId: string; ok: boolean; reason?: string; itemId?: MerchantItemId; price?: number; cycle?: MerchantCycle; account?: AuthoritativeAccountSnapshot }
export type MarketTransactionResult = {
  requestId: string
  ok: boolean
  kind: 'commodity' | 'food' | 'stock'
  reason?: string
  itemId?: CommodityId
  recipeId?: RecipeId
  stockId?: StockId
  direction?: 'buy' | 'sell'
  quantity: number
  total: number
  revision: number
  account?: AuthoritativeAccountSnapshot
}
export type SharedCookResult = { requestId: string; ok: boolean; op: 'queue' | 'collect'; reason?: string; recipeId?: RecipeId; quantity: number; itemId?: ItemId; account?: AuthoritativeAccountSnapshot }

const pendingFarmActions = new Map<string, { op: 'claim' | 'plant' | 'water' | 'harvest' | 'rain'; farmId: number; cellIndex?: number; seed?: ItemId; crop?: CropKind }>()
const pendingDeedPurchases = new Set<string>()
const pendingMerchantPurchases = new Set<string>()
const pendingShopPurchases = new Map<string, { itemId: ItemId; quantity: number }>()
const pendingMarketTransactions = new Map<string, { kind: 'commodity'; itemId: CommodityId; quantity: number } | { kind: 'food'; recipeId: RecipeId; quantity: number } | { kind: 'stock'; stockId: StockId; direction: 'buy' | 'sell'; quantity: number }>()
const pendingCookActions = new Map<string, { op: 'queue' | 'collect'; recipeId?: RecipeId; furnaceIndex: number }>()
const NON_TRADABLE_CONSUMABLES = new Set<ItemId>(['home-charm', 'farm-deed', 'shared-farm-deed', 'upgrade-coupon', 'upgrade-guard-4', 'upgrade-guard-5', 'upgrade-guard-6'])

type Prompt = { id: string; label: string } | null
type Stats = { foraged: number; mined: number; harvested: number; sold: number }
export type WeatherKind = 'clear' | 'rain' | 'mist' | 'sunny' | 'breeze'
export type Language = 'en' | 'ko'
export type GraphicsMode = 'auto' | 'low' | 'medium' | 'high'
export type SprintMode = 'toggle' | 'hold'
type MarketRates = { crop: number; forage: number; ore: number }
export type SecretDeal = { give: ItemId; quantity: number; payout: number; title: string }

export const SECRET_DEALS: Record<Exclude<ZoneId, 'hub'>, SecretDeal[]> = {
  forage: [
    { give: 'apple', quantity: 8, payout: 48_000, title: 'ORCHARD WANDERER' },
    { give: 'orange', quantity: 6, payout: 54_000, title: 'CITRUS KEEPER' },
    { give: 'truffle', quantity: 1, payout: 320_000, title: 'FOREST GOURMAND' },
  ],
  farm: [
    { give: 'tomato', quantity: 4, payout: 138_000, title: 'HARVEST COOK' },
    { give: 'lettuce', quantity: 4, payout: 330_000, title: 'MEADOW COOK' },
    { give: 'pumpkin', quantity: 2, payout: 795_000, title: 'LANTERN MAKER' },
  ],
  mine: [
    { give: 'copper-ore', quantity: 5, payout: 92_000, title: 'STONE CARVER' },
    { give: 'copper-ore', quantity: 3, payout: 44_000, title: 'COPPERSMITH' },
    { give: 'iron-ore', quantity: 2, payout: 52_000, title: 'LOST SMITH' },
  ],
}

export function secretZoneForRound(round: number): Exclude<ZoneId, 'hub'> {
  return (['forage', 'farm', 'mine'] as const)[(Math.max(1, round) - 1) % 3]
}

export function secretSiteForRound(zone: Exclude<ZoneId, 'hub'>, round: number, sessionSeed = 9731) {
  const zoneIndex = ({ forage: 0, farm: 1, mine: 2 } as const)[zone]
  const visit = Math.floor((Math.max(1, round) - 1) / 3)
  const start = Math.floor(seeded01(sessionSeed + zoneIndex * 6151) * 3)
  const direction = seeded01(sessionSeed + zoneIndex * 9157 + 31) < 0.5 ? 1 : 2
  return (start + visit * direction) % 3
}

export function secretDealForRound(zone: Exclude<ZoneId, 'hub'>, round: number) {
  const cycle = Math.floor((Math.max(1, round) - 1) / 3)
  return SECRET_DEALS[zone][cycle % SECRET_DEALS[zone].length]
}

export function secretPayoutForRound(deal: SecretDeal, round: number) {
  return scaledValue(deal.payout, round)
}

export function lotteryDraw(round: number) {
  const pool = Array.from({ length: 12 }, (_, index) => index + 1)
  const draw: number[] = []
  let seed = round * 7919 + 104729
  while (draw.length < 3) {
    seed = (seed * 48271) % 2147483647
    const index = seed % pool.length
    draw.push(pool.splice(index, 1)[0])
  }
  return draw.sort((a, b) => a - b)
}

const SPAWNS: Record<ZoneId, Vec3> = {
  hub: [0, 0, 14],
  forage: [0, 0, -69],
  farm: [0, 0, 17],
  mine: [0, 0, 34],
}

const GROWTH_MS = Object.fromEntries(Object.entries(CROP_CONFIG).map(([id, crop]) => [id, crop.growthSeconds * 1000])) as Record<CropKind, number>
const CROP_YIELD = Object.fromEntries(Object.entries(CROP_CONFIG).map(([id, crop]) => [id, crop.yield])) as Record<CropKind, number>

const defaultInventory: Partial<Record<ItemId, number>> = {
  'home-charm': 1,
}

type SaveData = {
  sessionSeed?: number
  matchStartedAt?: number
  cash?: number
  restockSeconds?: number
  roundSeconds?: number
  inventory?: Partial<Record<ItemId, number>>
  hotbar?: Array<ItemId | null>
  farmCells?: Record<string, FarmCellState>
  claimedFarm?: number | null
  claimedFarms?: number[]
  portfolio?: Partial<Record<StockId, number>>
  roundNumber?: number
  stats?: Stats
  lotteryTickets?: LotteryTicket[]
  secretClaimedRound?: number
  knownRecipes?: RecipeId[]
  recipeCards?: Partial<Record<RecipeId, number>>
  cookQueue?: CookJob[]
  foodMarket?: Partial<Record<RecipeId, number>>
  foodPriceHistory?: Partial<Record<RecipeId, number[]>>
  commodityMarket?: CommodityMarket
  commodityPending?: Partial<Record<CommodityId, number>>
  commodityPriceHistory?: Partial<Record<CommodityId, number[]>>
  commodityCycle?: number
  shopStock?: Partial<Record<ItemId, number>>
  stockPrices?: Record<StockId, number>
  stockHistory?: Record<StockId, number[]>
  stockSupply?: Record<StockId, number>
  marketCorrectionsApplied?: number[]
  enhancements?: EnhancementLevels
  miningBoostUntil?: number
  fortuneBoostCharges?: Partial<Record<EnhanceableItem, number>>
  appliedMinigameRewardIds?: string[]
  appliedMinigameSettlementIds?: string[]
  minigamesCompleted?: number[]
  sessionComplete?: boolean
}

function readJson<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T }
  catch { return null }
}

function migratedItem(id: string): ItemId | null {
  const legacy: Record<string, ItemId | null> = {
    'gold-pickaxe': 'steel-pickaxe',
    'mushroom-seeds': null,
    'forest-fruit': 'apple',
    'stone-ore': 'copper-ore',
    'rich-ore': 'gold-ore',
  }
  const migrated = id in legacy ? legacy[id] : id
  return migrated && migrated in ITEMS ? migrated as ItemId : null
}

function migrateSave(value: SaveData | null): SaveData | null {
  if (!value) return null
  const inventory: Partial<Record<ItemId, number>> = {}
  Object.entries(value.inventory ?? {}).forEach(([id, quantity]) => {
    const next = migratedItem(id)
    if (next && Number(quantity) > 0) inventory[next] = isEnhanceableItem(next) ? 1 : (inventory[next] ?? 0) + Number(quantity)
  })
  const farmCells = Object.fromEntries(Object.entries(value.farmCells ?? {}).map(([key, cell]) => [key, String(cell.crop) === 'mushroom' ? { ...cell, crop: 'lettuce' as const } : cell]))
  return { ...value, inventory, hotbar: value.hotbar?.map((id) => id ? migratedItem(id) : null), farmCells }
}

const query = new URLSearchParams(window.location.search)
const gateFresh = query.get('fresh') === '1' || query.get('gate') === 'final' || query.get('gate') === 'deep' || query.get('gate') === 'resource' || query.get('gate') === 'cell' || query.get('gate') === 'furnace' || query.get('gate') === 'result'
const saved = gateFresh ? null : migrateSave(readJson<SaveData>('project01-save-v12') ?? readJson<SaveData>('project01-save-v11'))
const requestedZone = query.get('zone')
const requestedPanel = query.get('panel')
const requestedEvent = query.get('event')
const requestedWeather = query.get('weather')
const gateWeather: WeatherKind | null = query.has('gate') && (requestedWeather === 'clear' || requestedWeather === 'sunny' || requestedWeather === 'rain' || requestedWeather === 'mist' || requestedWeather === 'breeze')
  ? requestedWeather
  : null
const requestedMinigame: MinigameKind = requestedEvent === 'farm' || requestedEvent === 'forage' ? requestedEvent : 'mining'
const requestedShop = requestedPanel && requestedPanel in SHOPS ? requestedPanel as ShopKind : null
const requestedBalanceRound = query.get('gate') === 'balance' ? Number(query.get('round')) : 0
const enhancementTestLevel = requestedPanel === 'enhance' && query.has('enhanceTest')
  ? Math.max(0, Math.min(10, Math.floor(Number(query.get('enhanceTest')) || 0)))
  : null
const enhancementTestGear: Partial<Record<ItemId, number>> = enhancementTestLevel === null ? {} : { 'worn-pickaxe': 1 }
const enhancementTestInventory: Partial<Record<ItemId, number>> = query.get('enhanceReady') === '1' ? {
  'copper-ore': 999, 'iron-ore': 999, 'silver-ore': 999, 'gold-ore': 999, 'crystal-ore': 999, 'ancient-ore': 999,
  apple: 999, orange: 999, wheat: 999, tomato: 999, lettuce: 999, pumpkin: 999, watermelon: 999, truffle: 999, 'natural-discovery': 999,
  'upgrade-coupon': 2, 'upgrade-guard-4': 2, 'upgrade-guard-5': 2, 'upgrade-guard-6': 2,
} : {}
const merchantTestCycle = query.get('merchantTest') === '1'
  ? merchantCycle({ matchSeed: 2, matchStartedAtMs: 0, matchDurationMs: 60 * 60 * 1000 }, 5)
  : null
const merchantTestInventory: Partial<Record<ItemId, number>> = merchantTestCycle ? {
  'mining-boost': 1,
  'fortune-boost': 1,
  'cook-timer': 1,
  'rain-bottle': 1,
} : {}
const foodMarketTest = query.get('foodTest') === '1'
const foodMarketTestInventory: Partial<Record<ItemId, number>> = foodMarketTest ? {
  'food-berry-jam': 3,
  'food-pumpkin-bread': 12,
  'food-harvest-feast': 2,
} : {}
const bypassLobby = query.has('gate') || requestedPanel !== null || requestedZone !== null
const savedGuideComplete = !query.has('fresh') && localStorage.getItem('project01-onboarding-v1') === '1'
const balanceRound = Number.isInteger(requestedBalanceRound) && requestedBalanceRound >= 1 && requestedBalanceRound <= 20 ? requestedBalanceRound : null
const initialZone: ZoneId = requestedZone === 'forage' || requestedZone === 'farm' || requestedZone === 'mine' ? requestedZone : 'hub'
const gateToolInventory: Partial<Record<ItemId, number>> = query.has('gate')
  ? initialZone === 'mine' ? { 'worn-pickaxe': 1 }
    : initialZone === 'farm' ? { 'water-can': 1 }
      : {}
  : {}
const savedVolumes = readJson<Partial<{ master: number; music: number; ambience: number; effects: number }>>('project01-audio')
const clampVolume = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
const initialVolumes = {
  master: clampVolume(savedVolumes?.master, 0.55),
  music: clampVolume(savedVolumes?.music, 0.42),
  ambience: clampVolume(savedVolumes?.ambience, 0.38),
  effects: clampVolume(savedVolumes?.effects, 0.62),
}
const initialInventory = { ...defaultInventory, ...saved?.inventory, ...gateToolInventory, ...enhancementTestGear, ...enhancementTestInventory, ...merchantTestInventory, ...foodMarketTestInventory }
const freshHotbar: Array<ItemId | null> = [
  initialZone === 'mine' && query.has('gate') ? 'worn-pickaxe' : initialZone === 'farm' && query.has('gate') ? 'water-can' : null,
  null, null, null, null, null, null, null, 'home-charm',
]
const savedSensitivity = (() => {
  const value = Number(localStorage.getItem('project01-camera-sensitivity'))
  return Number.isFinite(value) && value >= 0.35 && value <= 1.8 ? value : 1
})()
const savedInvertY = localStorage.getItem('project01-camera-invert-y') === '1'
const savedShiftLock = localStorage.getItem('project01-shift-lock') === '1'
const savedSprintMode: SprintMode = localStorage.getItem('project01-sprint-mode') === 'hold' ? 'hold' : 'toggle'
const savedGraphicsMode = (() => {
  const value = query.get('graphics') ?? localStorage.getItem('project01-graphics')
  if (value === 'quality') return 'high'
  if (value === 'performance') return 'low'
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'auto'
})() as GraphicsMode
const savedNickname = localStorage.getItem('project01-nickname')?.trim().slice(0, 18) || `Player ${Math.floor(1000 + Math.random() * 9000)}`

type GameState = {
  zone: ZoneId
  teleportNonce: number
  sessionSeed: number
  matchStartedAt: number
  sessionStarted: boolean
  sessionDurationSeconds: number
  lobbyGlobalExpansionDeeds: number
  lobbyPlayerCount: number
  lobbyMaxGlobalExpansionDeeds: number
  lobbyConnected: boolean
  isHost: boolean
  lobbyReadyCount: number
  lobbyAllReady: boolean
  lobbySelfReady: boolean
  lobbyReadyPlayerIds: string[]
  guideOpen: boolean
  guideComplete: boolean
  tutorialActive: boolean
  tutorialStep: number
  anchors: AnchorMap
  colliders: WorldCollider[]
  playerPosition: Vec3
  playerYaw: number
  playerAnimation: string
  sceneReady: boolean
  cash: number
  restockSeconds: number
  roundSeconds: number
  roundNumber: number
  inventory: Partial<Record<ItemId, number>>
  hotbar: Array<ItemId | null>
  inventoryOrder: Array<ItemId | null>
  prompt: Prompt
  interactionProgress: number
  inventoryOpen: boolean
  shopOpen: boolean
  shopKind: ShopKind
  menuOpen: boolean
  lobbySettingsOpen: boolean
  farmCells: Record<string, FarmCellState>
  claimedFarms: number[]
  sharedFarmOnline: boolean
  sharedFarmSelfId: string | null
  farmOwners: Record<number, string | null>
  sharedFarmCells: Record<string, FarmCellState>
  sharedDeedOnline: boolean
  personalDeedAvailable: boolean
  globalDeedsRemaining: number
  deedPurchasePending: boolean
  collectedForage: Record<string, number>
  sharedForageOnline: boolean
  sharedForageAvailability: Record<string, number>
  forageAwardFullAt: Record<string, number>
  minedNodes: Record<string, number>
  mineGenerations: Record<string, number>
  mineAwardGenerations: Record<string, number>
  weather: WeatherKind
  weatherSeconds: number
  marketRates: MarketRates
  sharedMarketOnline: boolean
  marketRevision: number
  commodityMarket: CommodityMarket
  commodityPending: Partial<Record<CommodityId, number>>
  commodityPriceHistory: Partial<Record<CommodityId, number[]>>
  commodityCycle: number
  shopStock: Partial<Record<ItemId, number>>
  stockPrices: Record<StockId, number>
  stockHistory: Record<StockId, number[]>
  stockSupply: Record<StockId, number>
  portfolio: Partial<Record<StockId, number>>
  stockOpen: boolean
  stats: Stats
  sessionComplete: boolean
  toast: string | null
  audioVolumes: { master: number; music: number; ambience: number; effects: number }
  cameraSensitivity: number
  cameraInvertY: boolean
  shiftLocked: boolean
  sprintMode: SprintMode
  graphicsMode: GraphicsMode
  language: Language
  selectedHotbar: number
  nickname: string
  onlinePlayers: OnlinePlayer[]
  playerPanelOpen: boolean
  pendingTradeRequest: PendingTradeRequest | null
  lotteryOpen: boolean
  lotteryDraft: number[]
  lotteryTickets: LotteryTicket[]
  ticketInspectOpen: boolean
  travelOpen: boolean
  secretOpen: boolean
  secretClaimedRound: number
  secretRumor: string | null
  brokerNotes: BrokerNote[]
  brokerPurchases: string[]
  merchantCycle: MerchantCycle | null
  merchantPurchasePending: boolean
  itemUseOpen: ItemId | null
  noteInspectOpen: boolean
  cookbookOpen: boolean
  enhancementOpen: boolean
  enhancements: EnhancementLevels
  miningBoostUntil: number
  fortuneBoostCharges: Partial<Record<EnhanceableItem, number>>
  appliedMinigameRewardIds: string[]
  appliedMinigameSettlementIds: string[]
  knownRecipes: RecipeId[]
  recipeCards: Partial<Record<RecipeId, number>>
  cookQueue: CookJob[]
  activeFurnaceIndex: number | null
  furnaceReadyUntil: Record<number, number>
  foodMarket: Record<RecipeId, number>
  foodPriceHistory: Partial<Record<RecipeId, number[]>>
  marketCorrectionsApplied: number[]
  marketCorrectionName: string | null
  marketCorrectionSeconds: number
  minigameOpen: boolean
  minigameActive: boolean
  minigameMilestone: number
  minigameKind: MinigameKind
  eventBay: number
  minigamesCompleted: number[]
  minigameSnapshot: MinigameSnapshot | null
  rushNodes: Record<string, RushNodeState>
  rushInventory: Record<MiningRushOre, number>
  rushScore: number
  rushCombo: number
  rushLastMineAt: number
  farmRushCells: Record<string, FarmRushCell>
  farmRushTool: FarmRushTool
  farmRushInventory: Record<FarmRushIngredient, number>
  farmRushOrders: FarmRushTicket[]
  farmRushIssued: number
  farmRushNextOrderAt: number
  farmRushCooking: FarmRushCooking
  farmRushScore: number
  lastMinigameResult: MinigameRewardResult | null
  forageRushCollected: Record<string, number>
  forageRushRareSnapshot: string[] | null
  forageRushInventory: Record<ForageRushKind, number>
  forageRushProgress: Record<ForageRushKind, number>
  forageRushDelivered: Record<ForageRushKind, boolean>
  forageRushScore: number
  setZone: (zone: ZoneId) => void
  syncMatch: (seed: number, startedAt: number, durationSeconds?: number) => void
  setLobbyState: (connected: boolean, isHost: boolean, started: boolean, durationSeconds: number, globalExpansionDeeds?: number, playerCount?: number, maxGlobalExpansionDeeds?: number, readyCount?: number, allReady?: boolean, selfReady?: boolean, readyPlayerIds?: string[]) => void
  setAnchors: (anchors: AnchorMap) => void
  setColliders: (colliders: WorldCollider[]) => void
  setPlayerPosition: (position: Vec3, yaw?: number, animation?: string) => void
  setSceneReady: (ready: boolean) => void
  setPrompt: (prompt: Prompt) => void
  setInteractionProgress: (progress: number) => void
  toggleInventory: () => void
  setShopOpen: (open: boolean, kind?: ShopKind) => void
  setMenuOpen: (open: boolean) => void
  setLobbySettingsOpen: (open: boolean) => void
  setGuideOpen: (open: boolean) => void
  startTutorial: () => void
  setTutorialStep: (step: number) => void
  completeGuide: () => void
  trade: (item: ItemId, quantity: number) => void
  moveInventorySlot: (from: number, to: number) => void
  equipItem: (item: ItemId) => void
  setHotbarSlot: (index: number, item: ItemId | null) => void
  swapHotbarSlots: (from: number, to: number) => void
  addItem: (item: ItemId, quantity?: number) => void
  useCookbookBox: () => void
  farmAction: (farmIndex: number, index: number) => void
  claimFarm: (index: number) => void
  syncFarmSnapshot: (snapshot: SharedFarmSnapshot) => void
  syncFarmUpdate: (update: SharedFarmUpdate) => void
  applyFarmResult: (result: SharedFarmResult) => void
  syncDeedSnapshot: (snapshot: SharedDeedSnapshot) => void
  syncDeedStock: (globalRemaining: number) => void
  applyDeedResult: (result: SharedDeedResult) => void
  mineNode: (id: string, item: OreItem) => void
  syncMineSnapshot: (seed: number, nodes: Record<string, MineNodeState>) => void
  syncMineNode: (id: string, node: MineNodeState) => void
  awardMineNode: (id: string, item: OreItem, quantity: number, node: MineNodeState, tool: PickaxeItem) => void
  collectForage: (id: string, item: ItemId) => void
  syncForageSnapshot: (snapshot: SharedForageSnapshot) => void
  syncForageNode: (node: SharedForageNode) => void
  awardForageNode: (award: SharedForageAward) => void
  setStockOpen: (open: boolean) => void
  tradeStock: (id: StockId, quantity: number) => void
  syncMarketSnapshot: (snapshot: SharedMarketSnapshot) => void
  applyMarketTransaction: (result: MarketTransactionResult) => void
  setToast: (toast: string | null) => void
  setVolume: (channel: 'master' | 'music' | 'ambience' | 'effects', value: number) => void
  setCameraSensitivity: (value: number) => void
  setCameraInvertY: (value: boolean) => void
  setShiftLocked: (locked: boolean) => void
  setSprintMode: (mode: SprintMode) => void
  setGraphicsMode: (mode: GraphicsMode) => void
  setLanguage: (language: Language) => void
  setSelectedHotbar: (index: number) => void
  setNickname: (nickname: string) => void
  setOnlinePlayers: (players: OnlinePlayer[]) => void
  setPlayerPanelOpen: (open: boolean) => void
  setPendingTradeRequest: (request: PendingTradeRequest | null) => void
  setLotteryOpen: (open: boolean) => void
  toggleLotteryNumber: (value: number) => void
  buyLotteryTicket: (tier?: 1 | 5 | 25) => void
  setTicketInspectOpen: (open: boolean) => void
  setTravelOpen: (open: boolean) => void
  setSecretOpen: (open: boolean) => void
  claimSecretDeal: () => void
  buySecretInfo: (slot: number) => void
  syncMerchantCycle: (cycle: MerchantCycle) => void
  buyMerchantItem: (itemId: MerchantItemId) => void
  applyMerchantPurchase: (result: MerchantPurchaseResult) => void
  setItemUseOpen: (item: ItemId | null) => void
  setNoteInspectOpen: (open: boolean) => void
  setCookbookOpen: (open: boolean, furnaceIndex?: number) => void
  setEnhancementOpen: (open: boolean) => void
  enhanceEquipment: (item: EnhanceableItem, options?: EnhancementAttemptOptions) => void
  useMiningBoost: () => void
  useFortuneBoost: (item: EnhanceableItem) => void
  useCookTimer: () => void
  useRainBottle: (farmIndex: number) => void
  cookRecipe: (recipe: RecipeId, quantity?: number) => void
  collectCooked: (recipe?: RecipeId) => void
  sellFood: (recipe: RecipeId, quantity: number) => void
  finishMinigame: (score: number, placement?: number, economyReference?: number, settledReward?: { cash: number; itemRolls: MinigameItemRewardRoll[]; settlementId?: string; milestone?: number; kind?: MinigameKind; standings?: MinigameStanding[] }) => void
  setMinigameActive: (active: boolean) => void
  setEventBay: (bay: number) => void
  mineRushNode: (id: string) => void
  setFarmRushTool: (tool: FarmRushTool) => void
  farmRushAction: (id: string) => void
  tickFarmRush: () => void
  farmRushCook: (recipe: RecipeId) => void
  farmRushSubmit: (orderIndex: number) => void
  clearMinigameResult: () => void
  forageRushCollect: (id: string) => void
  awardForageRush: (id: string, readyAt: number) => void
  syncForageRush: (id: string, readyAt: number) => void
  syncForageRushRares: (ids: string[]) => void
  forageRushDeliver: (kind: ForageRushKind) => void
  applyPlayerTrade: (give: { cash: number; items: Record<string, number> }, receive: { cash: number; items: Record<string, number> }) => boolean
  tickGame: () => void
}

export function economyProgressValue(state: Pick<GameState, 'cash' | 'inventory' | 'portfolio' | 'farmCells' | 'claimedFarms' | 'knownRecipes'>) {
  const ownedValue = (Object.keys(state.inventory) as ItemId[]).reduce((sum, id) => sum + (ITEMS[id].buyPrice ?? 0) * (state.inventory[id] ?? 0), 0)
  const gatheredValue = (Object.keys(state.inventory) as ItemId[]).reduce((sum, id) => sum + (ITEMS[id].sellPrice ?? 0) * (state.inventory[id] ?? 0), 0)
  const preparedValue = RECIPE_IDS.reduce((sum, recipeId) => {
    const recipe = RECIPES[recipeId]
    const ingredientValue = Object.entries(recipe.ingredients).reduce((subtotal, [id, quantity]) => subtotal + (ITEMS[id as ItemId].sellPrice ?? 0) * Number(quantity), 0)
    const dishValue = (ingredientValue * PREPARED_FOOD_MARKUP + PREPARED_FOOD_BASE_VALUE[recipe.group]) * recipe.multiplier
    return sum + dishValue * (state.inventory[recipe.food] ?? 0)
  }, 0)
  const stockBasis = (Object.keys(STOCKS) as StockId[]).reduce((sum, id) => sum + STOCKS[id].basePrice * (state.portfolio[id] ?? 0), 0)
  const plantedValue = Object.values(state.farmCells).reduce((sum, cell) => sum + (cell.crop ? CROP_CONFIG[cell.crop].seedPrice : 0), 0)
  const claimedFarmValue = state.claimedFarms.length * (ITEMS['farm-deed'].buyPrice ?? 0)
  const recipeValue = state.knownRecipes.length * COOKBOOK_BOX_REWARD_VALUE
  return Math.round(state.cash + ownedValue + gatheredValue + preparedValue + stockBasis + plantedValue + claimedFarmValue + recipeValue)
}

const emptyOrder = Array.from({ length: 36 }, () => null as ItemId | null)
const initialOrder = [
  'water-can', 'worn-pickaxe', 'home-charm', 'farm-deed', 'lottery-ticket', 'cookbook-box', 'furnace', 'harvest-charm', 'basket', 'reinforced-basket',
  'master-basket', 'iron-pickaxe', 'steel-pickaxe', 'crystal-pickaxe', 'wheat-seeds', 'tomato-seeds', 'lettuce-seeds', 'pumpkin-seeds', 'watermelon-seeds',
  'wheat', 'tomato', 'lettuce', 'pumpkin', 'watermelon', 'berries', 'apple', 'orange', 'mushroom', 'wild-herbs', 'wildflower', 'truffle',
  'natural-discovery', 'copper-ore', 'iron-ore', 'silver-ore', 'gold-ore', 'crystal-ore', 'ancient-ore', ...emptyOrder,
].slice(0, 36) as Array<ItemId | null>

const initialShopStock: Partial<Record<ItemId, number>> = { 'farm-deed': 8 }
const stockIds = STOCK_IDS
const initialStockPrices = createInitialStockPrices()
const initialStockHistory = createInitialStockHistory()
const initialStockSupply = createInitialStockSupply(((balanceRound ?? 1) - 1) * MATCH_CONFIG.worldCycleSeconds)

export function secretStockOffer(round: number, prices: Record<StockId, number>, sessionSeed = 9731, correctionsApplied = 0, slot = 0, durationSeconds = MATCH_CONFIG.defaultDurationSeconds) {
  const correction = marketCorrectionFor(sessionSeed, correctionsApplied + 1)
  const index = (round * 7 + 2) % stockIds.length
  const id = stockIds[index]
  const stock = STOCKS[id]
  const current = prices[id]
  const updateIndex = Math.max(1, Math.ceil((round * MATCH_CONFIG.worldCycleSeconds) / MATCH_CONFIG.stockUpdateSeconds))
  const next = nextStockPrice(stock, current, updateIndex, index, sessionSeed)
  const tier = round <= 4 ? 0 : round <= 8 ? 1 : 2
  const costs = [180_000, 850_000, 2_800_000]
  const nextCorrection = marketCorrectionMilestones(durationSeconds)[correctionsApplied]
  const minuteRemaining = nextCorrection === undefined ? 0 : Math.max(0, durationSeconds / 60 - nextCorrection / 60)
  return { id, cost: costs[tier], clue: `At ${minuteRemaining}:00 remaining: ${correction.clues[slot % 2]}`, minuteRemaining, available: nextCorrection !== undefined }
}

const initialFoodMarket = createInitialFoodMarket()
const initialCommodityState = saved?.commodityMarket ?? initialCommodityMarket()

function freshFarmRushInventory(cropQuantity = 0): Record<FarmRushIngredient, number> {
  return {
    wheat: cropQuantity, tomato: cropQuantity, lettuce: cropQuantity, pumpkin: cropQuantity, watermelon: cropQuantity,
    apple: 99, orange: 99, truffle: 99,
  }
}

function emptyRushInventory(): Record<MiningRushOre, number> {
  return { 'copper-ore': 0, 'iron-ore': 0, 'silver-ore': 0, 'gold-ore': 0, 'crystal-ore': 0 }
}

function emptyForageProgress(): Record<ForageRushKind, number> {
  return { apple: 0, orange: 0, truffle: 0, discovery: 0 }
}

const initialFoodPriceHistory = foodMarketTest
  ? Object.fromEntries(RECIPE_IDS.map((id) => {
      const price = preparedFoodValue(id, initialCommodityState, saved?.foodMarket?.[id] ?? initialFoodMarket[id])
      return [id, [0.91, 1.04, 0.97, 1.08, 1].map((factor) => Math.round(price * factor))]
    }))
  : saved?.foodPriceHistory ?? createInitialFoodHistory(initialCommodityState, { ...initialFoodMarket, ...saved?.foodMarket })

function cleanedHotbar(hotbar: Array<ItemId | null>, inventory: Partial<Record<ItemId, number>>) {
  const seen = new Set<ItemId>()
  const next = hotbar.slice(0, 9).map((item) => {
    if (!item || (inventory[item] ?? 0) <= 0 || seen.has(item)) return null
    seen.add(item)
    return item
  })
  while (next.length < 9) next.push(null)
  return next
}

function hotbarWithNewItem(hotbar: Array<ItemId | null>, inventoryBefore: Partial<Record<ItemId, number>>, item: ItemId) {
  if (item === 'gold-coins') return hotbar
  if ((inventoryBefore[item] ?? 0) > 0 || hotbar.includes(item)) return hotbar
  const next = cleanedHotbar([...hotbar], inventoryBefore)
  const empty = next.findIndex((slot) => slot === null)
  if (empty >= 0) next[empty] = item
  return next
}

function hotbarWithInventoryDelta(hotbar: Array<ItemId | null>, inventoryBefore: Partial<Record<ItemId, number>>, inventoryAfter: Partial<Record<ItemId, number>>, preferredItem?: ItemId) {
  const next = cleanedHotbar(hotbar, inventoryAfter)
  const added = (Object.keys(inventoryAfter) as ItemId[]).filter((item) =>
    item !== 'gold-coins' && (inventoryAfter[item] ?? 0) > 0 && (inventoryBefore[item] ?? 0) <= 0,
  )
  if (preferredItem && added.includes(preferredItem)) {
    added.splice(added.indexOf(preferredItem), 1)
    added.unshift(preferredItem)
  }
  for (const item of added) {
    if (next.includes(item)) continue
    const empty = next.findIndex((slot) => slot === null)
    if (empty < 0) break
    next[empty] = item
  }
  return next
}

export function inventoryLayout(state: Pick<GameState, 'hotbar' | 'inventoryOrder' | 'inventory'>) {
  const hotbar = cleanedHotbar(state.hotbar, state.inventory)
  const seen = new Set<ItemId>(hotbar.filter((item): item is ItemId => Boolean(item)))
  const lower = state.inventoryOrder.slice(9).map((item) => {
    if (!item || seen.has(item) || (state.inventory[item] ?? 0) <= 0) return null
    seen.add(item)
    return item
  })
  const missing = (Object.keys(state.inventory) as ItemId[]).filter((item) =>
    (state.inventory[item] ?? 0) > 0 && !seen.has(item),
  )
  for (const item of missing) {
    const empty = lower.findIndex((slot) => slot === null)
    if (empty < 0) break
    lower[empty] = item
    seen.add(item)
  }
  return [...hotbar, ...lower].slice(0, state.inventoryOrder.length)
}

function layoutResult(state: Pick<GameState, 'hotbar' | 'inventoryOrder' | 'inventory'>, layout: Array<ItemId | null>) {
  const hotbar = cleanedHotbar(layout.slice(0, 9), state.inventory)
  const seen = new Set<ItemId>(hotbar.filter((item): item is ItemId => Boolean(item)))
  const inventoryOrder = layout.map((item, index) => {
    if (index < 9) return hotbar[index] ?? null
    if (!item || seen.has(item) || (state.inventory[item] ?? 0) <= 0) return null
    seen.add(item)
    return item
  })
  return { hotbar, inventoryOrder }
}

function cellKey(farmIndex: number, index: number) { return `${farmIndex}:${index}` }

const tutorialSnapshotKeys = [
  'zone', 'playerPosition', 'playerYaw', 'cash', 'restockSeconds', 'roundSeconds', 'roundNumber',
  'inventory', 'hotbar', 'inventoryOrder', 'farmCells', 'claimedFarms', 'collectedForage',
  'forageAwardFullAt', 'minedNodes', 'mineGenerations', 'mineAwardGenerations', 'weather',
  'weatherSeconds', 'marketRates', 'commodityMarket', 'commodityPending', 'commodityPriceHistory',
  'commodityCycle', 'shopStock', 'stockPrices', 'stockHistory', 'stockSupply', 'portfolio', 'stats',
  'knownRecipes', 'recipeCards', 'cookQueue', 'activeFurnaceIndex', 'furnaceReadyUntil', 'foodMarket',
  'foodPriceHistory', 'marketCorrectionsApplied', 'marketCorrectionName', 'marketCorrectionSeconds',
  'enhancements', 'miningBoostUntil', 'fortuneBoostCharges', 'selectedHotbar', 'sharedFarmOnline',
  'sharedFarmSelfId', 'farmOwners', 'sharedFarmCells', 'sharedDeedOnline', 'personalDeedAvailable',
  'globalDeedsRemaining', 'sharedForageOnline', 'sharedForageAvailability', 'sharedMarketOnline', 'marketRevision',
] as const satisfies ReadonlyArray<keyof GameState>

let tutorialSnapshot: Partial<GameState> | null = null

function captureTutorialSnapshot(state: GameState) {
  const snapshot: Partial<GameState> = {}
  for (const key of tutorialSnapshotKeys) {
    ;(snapshot as Record<string, unknown>)[key] = structuredClone(state[key])
  }
  return snapshot
}

function tutorialStepState(step: number, state: GameState): Partial<GameState> {
  const common = {
    tutorialStep: step,
    prompt: null,
    interactionProgress: 0,
    shopOpen: false,
    stockOpen: false,
    inventoryOpen: false,
    cookbookOpen: false,
    enhancementOpen: false,
    activeFurnaceIndex: null,
  }
  if (step === 2) return { ...common, zone: 'hub', teleportNonce: state.teleportNonce + 1, anchors: {}, colliders: [], playerPosition: SPAWNS.hub }
  if (step === 3) {
    return { ...common, zone: 'mine', teleportNonce: state.teleportNonce + 1, anchors: {}, colliders: [], playerPosition: SPAWNS.mine, cash: Math.max(state.cash, PICKAXE_CONFIG['worn-pickaxe'].price + 100_000) }
  }
  if (step === 4) {
    const inventory = { ...state.inventory, basket: 1 }
    return { ...common, zone: 'forage', teleportNonce: state.teleportNonce + 1, anchors: {}, colliders: [], playerPosition: SPAWNS.forage, inventory, hotbar: hotbarWithInventoryDelta(state.hotbar, state.inventory, inventory, 'basket') }
  }
  if (step === 5) {
    const inventory = { ...state.inventory, 'wheat-seeds': 4, 'water-can': 1, furnace: 1 }
    const hotbar = cleanedHotbar(['wheat-seeds', 'water-can', ...state.hotbar], inventory)
    return { ...common, zone: 'farm', teleportNonce: state.teleportNonce + 1, anchors: {}, colliders: [], playerPosition: [-44, 0, -5], inventory, hotbar, selectedHotbar: 0, claimedFarms: [0], farmCells: {}, weather: 'clear', weatherSeconds: MATCH_CONFIG.worldCycleSeconds }
  }
  if (step === 6) {
    const inventory = { ...state.inventory, furnace: 1, apple: Math.max(2, state.inventory.apple ?? 0), wheat: Math.max(2, state.inventory.wheat ?? 0) }
    return { ...common, zone: 'farm', teleportNonce: state.zone === 'farm' ? state.teleportNonce : state.teleportNonce + 1, anchors: state.zone === 'farm' ? state.anchors : {}, colliders: state.zone === 'farm' ? state.colliders : [], playerPosition: state.zone === 'farm' ? state.playerPosition : SPAWNS.farm, inventory, hotbar: hotbarWithInventoryDelta(state.hotbar, state.inventory, inventory, 'apple'), claimedFarms: [0], knownRecipes: state.knownRecipes.includes('apple-bread') ? state.knownRecipes : [...state.knownRecipes, 'apple-bread'] }
  }
  if (step === 7) return { ...common, zone: 'farm', teleportNonce: state.zone === 'farm' ? state.teleportNonce : state.teleportNonce + 1, anchors: state.zone === 'farm' ? state.anchors : {}, colliders: state.zone === 'farm' ? state.colliders : [], playerPosition: state.zone === 'farm' ? state.playerPosition : SPAWNS.farm }
  if (step === 8) return { ...common, zone: 'hub', teleportNonce: state.teleportNonce + 1, anchors: {}, colliders: [], playerPosition: SPAWNS.hub, cash: Math.max(state.cash, 3_000_000) }
  if (step === 9) {
    const requirements = enhancementRequirements('worn-pickaxe', 1)
    // Tutorial-only copies let the real upgrade panel compare each progression
    // path. The tutorial snapshot restores the player's real inventory later.
    const inventory = { ...state.inventory, 'worn-pickaxe': 1, basket: 1, 'harvest-charm': 1 }
    for (const [id, quantity] of Object.entries(requirements.materials) as Array<[ItemId, number]>) inventory[id] = Math.max(inventory[id] ?? 0, quantity)
    return { ...common, zone: 'hub', teleportNonce: state.zone === 'hub' ? state.teleportNonce : state.teleportNonce + 1, anchors: state.zone === 'hub' ? state.anchors : {}, colliders: state.zone === 'hub' ? state.colliders : [], playerPosition: state.zone === 'hub' ? state.playerPosition : SPAWNS.hub, inventory, hotbar: hotbarWithInventoryDelta(state.hotbar, state.inventory, inventory, 'worn-pickaxe'), cash: Math.max(state.cash, requirements.coins + 500_000) }
  }
  return { ...common }
}

export const useGameStore = create<GameState>((set, get) => ({
  zone: initialZone,
  teleportNonce: 0,
  sessionSeed: saved?.sessionSeed ?? Math.floor(Math.random() * 1_000_000_000),
  matchStartedAt: saved?.matchStartedAt ?? Date.now(),
  sessionStarted: bypassLobby,
  sessionDurationSeconds: MATCH_CONFIG.defaultDurationSeconds,
  lobbyGlobalExpansionDeeds: 2,
  lobbyPlayerCount: 1,
  lobbyMaxGlobalExpansionDeeds: 7,
  lobbyConnected: bypassLobby,
  isHost: false,
  lobbyReadyCount: bypassLobby ? 1 : 0,
  lobbyAllReady: bypassLobby,
  lobbySelfReady: bypassLobby || savedGuideComplete,
  lobbyReadyPlayerIds: [],
  guideOpen: !bypassLobby && (query.get('guide') === '1' || !savedGuideComplete),
  guideComplete: savedGuideComplete,
  tutorialActive: false,
  tutorialStep: 0,
  anchors: {},
  colliders: [],
  playerPosition: SPAWNS[initialZone],
  playerYaw: 0,
  playerAnimation: 'Armature|Idle_Loop',
  sceneReady: false,
  cash: balanceRound ? 104_582_500 : saved?.cash ?? MATCH_CONFIG.startingCash,
  restockSeconds: saved?.restockSeconds ?? MATCH_CONFIG.worldCycleSeconds,
  roundSeconds: saved?.roundSeconds ?? MATCH_CONFIG.worldCycleSeconds,
  roundNumber: balanceRound ?? saved?.roundNumber ?? 1,
  inventory: initialInventory,
  hotbar: cleanedHotbar(saved?.hotbar?.slice(0, 9) ?? freshHotbar, initialInventory),
  inventoryOrder: initialOrder,
  prompt: null,
  interactionProgress: 0,
  inventoryOpen: false,
  shopOpen: requestedShop !== null,
  shopKind: requestedShop ?? 'common',
  menuOpen: false,
  lobbySettingsOpen: !bypassLobby && savedGuideComplete,
  farmCells: saved?.farmCells ?? (query.get('gate') === 'cell' && initialZone === 'farm' ? { '0:27': { crop: 'tomato', stage: 'ready', readyAt: null } } : {}),
  claimedFarms: saved?.claimedFarms ?? (saved?.claimedFarm === null || saved?.claimedFarm === undefined ? [] : [saved.claimedFarm]),
  sharedFarmOnline: false,
  sharedFarmSelfId: null,
  farmOwners: {},
  sharedFarmCells: {},
  sharedDeedOnline: false,
  personalDeedAvailable: true,
  globalDeedsRemaining: 2,
  deedPurchasePending: false,
  collectedForage: {},
  sharedForageOnline: false,
  sharedForageAvailability: {},
  forageAwardFullAt: {},
  minedNodes: {},
  mineGenerations: {},
  mineAwardGenerations: {},
  weather: gateWeather ?? 'rain',
  weatherSeconds: gateWeather ? 3_600 : 45,
  marketRates: { crop: 1, forage: 1, ore: 1 },
  sharedMarketOnline: false,
  marketRevision: 0,
  commodityMarket: initialCommodityState,
  commodityPending: saved?.commodityPending ?? {},
  commodityPriceHistory: saved?.commodityPriceHistory ?? Object.fromEntries(Object.entries(commodityPriceSnapshot(initialCommodityState)).map(([id, price]) => [id, [price]])),
  commodityCycle: saved?.commodityCycle ?? 0,
  shopStock: { ...initialShopStock, ...saved?.shopStock },
  stockPrices: { ...initialStockPrices, ...saved?.stockPrices },
  stockHistory: { ...initialStockHistory, ...saved?.stockHistory },
  stockSupply: { ...initialStockSupply, ...saved?.stockSupply },
  portfolio: saved?.portfolio ?? {},
  stockOpen: requestedPanel === 'stocks',
  stats: saved?.stats ?? { foraged: 0, mined: 0, harvested: 0, sold: 0 },
  sessionComplete: saved?.sessionComplete ?? (requestedPanel === 'results' && balanceRound === MATCH_CONFIG.totalRounds),
  toast: null,
  audioVolumes: initialVolumes,
  cameraSensitivity: savedSensitivity,
  cameraInvertY: savedInvertY,
  shiftLocked: savedShiftLock,
  sprintMode: savedSprintMode,
  graphicsMode: savedGraphicsMode,
  language: query.get('lang') === 'ko' || (query.get('lang') !== 'en' && localStorage.getItem('project01-language') === 'ko') ? 'ko' : 'en',
  selectedHotbar: 0,
  nickname: savedNickname,
  onlinePlayers: [],
  playerPanelOpen: false,
  pendingTradeRequest: null,
  lotteryOpen: requestedPanel === 'lottery',
  lotteryDraft: [],
  lotteryTickets: saved?.lotteryTickets ?? [],
  ticketInspectOpen: requestedPanel === 'tickets',
  travelOpen: false,
  secretOpen: requestedPanel === 'secret',
  secretClaimedRound: saved?.secretClaimedRound ?? 0,
  secretRumor: null,
  brokerNotes: [],
  brokerPurchases: [],
  merchantCycle: merchantTestCycle,
  merchantPurchasePending: false,
  itemUseOpen: null,
  noteInspectOpen: false,
  cookbookOpen: requestedPanel === 'cookbook',
  enhancementOpen: requestedPanel === 'enhance',
  enhancements: enhancementTestLevel === null ? saved?.enhancements ?? {} : { 'worn-pickaxe': enhancementTestLevel },
  miningBoostUntil: saved?.miningBoostUntil ?? 0,
  fortuneBoostCharges: saved?.fortuneBoostCharges ?? {},
  appliedMinigameRewardIds: saved?.appliedMinigameRewardIds ?? [],
  appliedMinigameSettlementIds: saved?.appliedMinigameSettlementIds ?? [],
  knownRecipes: foodMarketTest ? [...RECIPE_IDS] : saved?.knownRecipes ?? [],
  recipeCards: saved?.recipeCards ?? {},
  cookQueue: (saved?.cookQueue ?? []).map((job) => ({ ...job, quantity: job.quantity ?? 1, furnaceIndex: job.furnaceIndex ?? saved?.claimedFarms?.[0] ?? saved?.claimedFarm ?? 0 })),
  activeFurnaceIndex: null,
  furnaceReadyUntil: {},
  foodMarket: { ...initialFoodMarket, ...saved?.foodMarket },
  foodPriceHistory: initialFoodPriceHistory,
  marketCorrectionsApplied: saved?.marketCorrectionsApplied ?? [],
  marketCorrectionName: null,
  marketCorrectionSeconds: 0,
  minigameOpen: requestedPanel === 'minigame',
  minigameActive: false,
  minigameMilestone: requestedPanel === 'minigame' ? 20 * 60 : 0,
  minigameKind: requestedMinigame,
  eventBay: 0,
  minigamesCompleted: balanceRound
    ? minigameMilestones(MATCH_CONFIG.defaultDurationSeconds).filter((milestone) => milestone <= (balanceRound - 1) * MATCH_CONFIG.worldCycleSeconds)
    : saved?.minigamesCompleted ?? [],
  minigameSnapshot: requestedPanel === 'minigame' ? { zone: initialZone, playerPosition: SPAWNS[initialZone], hotbar: [null, null, null, null, null, null, null, null, 'home-charm'], selectedHotbar: 0, inventoryOpen: false, startedAt: Date.now() } : null,
  rushNodes: {},
  rushInventory: requestedPanel === 'minigame' && requestedMinigame === 'mining' && query.get('gate') === 'resource'
    ? { 'copper-ore': 8, 'iron-ore': 5, 'silver-ore': 3, 'gold-ore': 2, 'crystal-ore': 1 }
    : emptyRushInventory(),
  rushScore: 0,
  rushCombo: 0,
  rushLastMineAt: 0,
  farmRushCells: {},
  farmRushTool: 'wheat',
  farmRushInventory: freshFarmRushInventory(query.get('gate') === 'furnace' ? 6 : 0),
  farmRushOrders: [],
  farmRushIssued: 0,
  farmRushNextOrderAt: 0,
  farmRushCooking: [],
  farmRushScore: 0,
  lastMinigameResult: query.get('gate') === 'result'
    ? { kind: 'farm', placement: 2, score: 184, cash: 900_000, items: { 'cookbook-box': 1, 'fortune-boost': 1 }, standings: [{ placement: 1, nickname: 'Player 2048', score: 228 }, { placement: 2, nickname: savedNickname, score: 184 }], receivedAt: Date.now() }
    : null,
  forageRushCollected: {},
  forageRushRareSnapshot: null,
  forageRushInventory: { apple: 0, orange: 0, truffle: 0, discovery: 0 },
  forageRushProgress: emptyForageProgress(),
  forageRushDelivered: { apple: false, orange: false, truffle: false, discovery: false },
  forageRushScore: 0,
  setZone: (zone) => set((state) => ({ zone, teleportNonce: state.teleportNonce + 1, anchors: zone === state.zone ? state.anchors : {}, colliders: zone === state.zone ? state.colliders : [], playerPosition: SPAWNS[zone], prompt: null, interactionProgress: 0, shopOpen: false, stockOpen: false, inventoryOpen: false, playerPanelOpen: false, lotteryOpen: false, ticketInspectOpen: false, travelOpen: false, secretOpen: false, cookbookOpen: false, enhancementOpen: false, itemUseOpen: null })),
  syncMatch: (sessionSeed, matchStartedAt, requestedDuration = MATCH_CONFIG.defaultDurationSeconds) => set((state) => {
    if (balanceRound || state.minigameOpen || state.tutorialActive || !Number.isFinite(sessionSeed) || !Number.isFinite(matchStartedAt)) return state
    const sessionDurationSeconds = MATCH_CONFIG.selectableDurationsSeconds.includes(requestedDuration as typeof MATCH_CONFIG.selectableDurationsSeconds[number]) ? requestedDuration : MATCH_CONFIG.defaultDurationSeconds
    const elapsed = Math.max(0, Math.floor((Date.now() - matchStartedAt) / 1000))
    const roundNumber = Math.floor(elapsed / MATCH_CONFIG.worldCycleSeconds) + 1
    const roundSeconds = Math.max(1, MATCH_CONFIG.worldCycleSeconds - (elapsed % MATCH_CONFIG.worldCycleSeconds))
    return { sessionSeed, matchStartedAt, sessionStarted: true, sessionDurationSeconds, lobbyConnected: true, lobbySettingsOpen: false, guideOpen: false, roundNumber, roundSeconds, restockSeconds: roundSeconds }
  }),
  setLobbyState: (lobbyConnected, isHost, sessionStarted, requestedDuration, requestedGlobalExpansionDeeds, requestedPlayerCount, requestedMaxGlobalExpansionDeeds, requestedReadyCount, requestedAllReady, requestedSelfReady, requestedReadyPlayerIds) => set((state) => ({
    lobbyConnected,
    isHost,
    sessionStarted: bypassLobby ? true : state.tutorialActive ? state.sessionStarted : sessionStarted,
    lobbySettingsOpen: sessionStarted && !state.tutorialActive ? false : state.lobbySettingsOpen,
    sessionDurationSeconds: MATCH_CONFIG.selectableDurationsSeconds.includes(requestedDuration as typeof MATCH_CONFIG.selectableDurationsSeconds[number]) ? requestedDuration : state.sessionDurationSeconds,
    lobbyGlobalExpansionDeeds: Number.isInteger(requestedGlobalExpansionDeeds) && Number(requestedGlobalExpansionDeeds) >= 0 && Number(requestedGlobalExpansionDeeds) <= 7 ? Number(requestedGlobalExpansionDeeds) : state.lobbyGlobalExpansionDeeds,
    lobbyPlayerCount: Number.isInteger(requestedPlayerCount) && Number(requestedPlayerCount) >= 1 ? Number(requestedPlayerCount) : state.lobbyPlayerCount,
    lobbyMaxGlobalExpansionDeeds: Number.isInteger(requestedMaxGlobalExpansionDeeds) && Number(requestedMaxGlobalExpansionDeeds) >= 0 ? Number(requestedMaxGlobalExpansionDeeds) : state.lobbyMaxGlobalExpansionDeeds,
    lobbyReadyCount: Number.isInteger(requestedReadyCount) && Number(requestedReadyCount) >= 0 ? Number(requestedReadyCount) : state.lobbyReadyCount,
    lobbyAllReady: typeof requestedAllReady === 'boolean' ? requestedAllReady : state.lobbyAllReady,
    lobbySelfReady: typeof requestedSelfReady === 'boolean' ? requestedSelfReady : state.lobbySelfReady,
    lobbyReadyPlayerIds: Array.isArray(requestedReadyPlayerIds) ? requestedReadyPlayerIds.filter((id): id is string => typeof id === 'string') : state.lobbyReadyPlayerIds,
    guideOpen: sessionStarted && !state.tutorialActive ? false : state.guideOpen,
  })),
  setAnchors: (anchors) => set({ anchors }),
  setColliders: (colliders) => set({ colliders }),
  setPlayerPosition: (playerPosition, playerYaw, playerAnimation) => set((state) => ({
    playerPosition,
    playerYaw: Number.isFinite(playerYaw) ? Number(playerYaw) : state.playerYaw,
    playerAnimation: playerAnimation || state.playerAnimation,
  })),
  setSceneReady: (sceneReady) => set({ sceneReady }),
  setPrompt: (prompt) => set({ prompt, interactionProgress: 0 }),
  setInteractionProgress: (interactionProgress) => set({ interactionProgress }),
  toggleInventory: () => set((state) => ({ inventoryOpen: !state.inventoryOpen, shopOpen: false, stockOpen: false, menuOpen: false, lotteryOpen: false, ticketInspectOpen: false, secretOpen: false, enhancementOpen: false, interactionProgress: 0 })),
  setShopOpen: (shopOpen, shopKind = get().shopKind) => set({ shopOpen, shopKind, stockOpen: false, inventoryOpen: false, menuOpen: false, lotteryOpen: false, ticketInspectOpen: false, secretOpen: false, enhancementOpen: false, interactionProgress: 0 }),
  setMenuOpen: (menuOpen) => set({ menuOpen, lobbySettingsOpen: false, inventoryOpen: false, shopOpen: false, stockOpen: false, enhancementOpen: false, interactionProgress: 0 }),
  setLobbySettingsOpen: (lobbySettingsOpen) => set({ lobbySettingsOpen, menuOpen: false, playerPanelOpen: false, inventoryOpen: false, shopOpen: false, stockOpen: false, enhancementOpen: false, interactionProgress: 0 }),
  setGuideOpen: (guideOpen) => set({ guideOpen, lobbySettingsOpen: false, menuOpen: false, playerPanelOpen: false, inventoryOpen: false, shopOpen: false, stockOpen: false, enhancementOpen: false, interactionProgress: 0 }),
  startTutorial: () => {
    const state = get()
    if (state.sessionStarted || state.tutorialActive) return
    tutorialSnapshot = captureTutorialSnapshot(state)
    const inventory: Partial<Record<ItemId, number>> = { 'home-charm': 1 }
    set({
      tutorialActive: true,
      tutorialStep: 1,
      guideOpen: false,
      lobbySettingsOpen: false,
      zone: 'hub',
      teleportNonce: state.teleportNonce + 1,
      anchors: {},
      colliders: [],
      playerPosition: SPAWNS.hub,
      cash: 3_000_000,
      inventory,
      hotbar: [null, null, null, null, null, null, null, null, 'home-charm'],
      inventoryOrder: [...initialOrder],
      selectedHotbar: 0,
      farmCells: {},
      claimedFarms: [],
      collectedForage: {},
      forageAwardFullAt: {},
      minedNodes: {},
      mineGenerations: {},
      mineAwardGenerations: {},
      stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 },
      portfolio: {},
      cookQueue: [],
      knownRecipes: [],
      recipeCards: {},
      enhancements: {},
      marketCorrectionName: null,
      marketCorrectionSeconds: 0,
      weather: 'clear',
      weatherSeconds: MATCH_CONFIG.worldCycleSeconds,
      sharedFarmOnline: false,
      sharedFarmSelfId: null,
      farmOwners: {},
      sharedFarmCells: {},
      sharedDeedOnline: false,
      sharedForageOnline: false,
      sharedForageAvailability: {},
      sharedMarketOnline: false,
      shopOpen: false,
      stockOpen: false,
      inventoryOpen: false,
      cookbookOpen: false,
      enhancementOpen: false,
      prompt: null,
      interactionProgress: 0,
    })
  },
  setTutorialStep: (requestedStep) => set((state) => {
    if (!state.tutorialActive) return state
    const step = Math.max(1, Math.min(13, Math.floor(requestedStep)))
    return tutorialStepState(step, state)
  }),
  completeGuide: () => {
    localStorage.setItem('project01-onboarding-v1', '1')
    const state = get()
    sendMultiplayer('lobby:onboarding-ready', { ready: true })
    if (state.tutorialActive && tutorialSnapshot) {
      const restored = tutorialSnapshot
      tutorialSnapshot = null
      set({
        ...restored,
        tutorialActive: false,
        tutorialStep: 0,
        guideOpen: false,
        guideComplete: true,
        lobbySelfReady: true,
        lobbySettingsOpen: !state.sessionStarted && state.isHost,
        teleportNonce: state.teleportNonce + 1,
        anchors: {},
        colliders: [],
        prompt: null,
        interactionProgress: 0,
      })
      return
    }
    set({ guideOpen: false, tutorialActive: false, tutorialStep: 0, guideComplete: true, lobbySelfReady: true, lobbySettingsOpen: !state.sessionStarted && state.isHost })
  },
  trade: (item, quantity) => {
    if (!quantity) return
    const state = get()
    const shop = SHOPS[state.shopKind]
    const definition = ITEMS[item]
    const owned = state.inventory[item] ?? 0
    if (quantity < 0 && state.shopKind === 'food' && item.startsWith('food-')) {
      get().sellFood(item.slice(5) as RecipeId, Math.abs(quantity))
      return
    }
    const marketRate = definition.category === 'crop' ? state.marketRates.crop : definition.category === 'forage' ? state.marketRates.forage : definition.category === 'ore' ? state.marketRates.ore : 1
    if (quantity > 0) {
      if (shop.action === 'sell' || !definition.buyPrice) return
      if (isEnhanceableItem(item) && owned > 0) return set({ toast: 'Already owned' })
      if ((item === 'farm-deed' || item === 'shared-farm-deed') && state.sharedDeedOnline) {
        if (state.deedPurchasePending) return set({ toast: 'Purchase pending' })
        const personal = item === 'farm-deed'
        if (!personal && state.personalDeedAvailable) return set({ toast: 'Buy personal deed first' })
        const available = personal ? (state.personalDeedAvailable ? 1 : 0) : state.globalDeedsRemaining
        const wanted = Math.min(quantity, available)
        if (!wanted) return set({ toast: personal ? 'Already owned' : 'Sold out' })
        const affordable = Math.min(wanted, Math.floor(state.cash / definition.buyPrice))
        if (!affordable) return set({ toast: 'Not enough coins' })
        const requestId = crypto.randomUUID()
        pendingDeedPurchases.add(requestId)
        if (sendMultiplayer('deed:purchase', { requestId, kind: personal ? 'personal' : 'global', quantity: affordable })) return set({ deedPurchasePending: true })
        pendingDeedPurchases.delete(requestId)
        return set({ toast: 'Shop unavailable' })
      }
      const available = definition.limited ? state.shopStock[item] ?? 0 : quantity
      const bought = Math.min(quantity, available)
      if (!bought) return set({ toast: 'Sold out' })
      let affordable = Math.min(bought, Math.floor(state.cash / definition.buyPrice))
      if (isEnhanceableItem(item)) affordable = Math.min(1, affordable)
      if (!affordable) return set({ toast: 'Not enough coins' })
      if (item === 'furnace' && state.claimedFarms.length === 0) return set({ toast: 'Own a farm first' })
      if (state.lobbyConnected && !state.tutorialActive) {
        if ([...pendingShopPurchases.values()].some((pending) => pending.itemId === item)) return set({ toast: 'Purchase pending' })
        const requestId = crypto.randomUUID()
        pendingShopPurchases.set(requestId, { itemId: item, quantity: affordable })
        if (sendMultiplayer('shop:buy', { requestId, itemId: item, quantity: affordable, shopKind: state.shopKind })) return set({ toast: 'Purchase pending' })
        pendingShopPurchases.delete(requestId)
        return set({ toast: 'Shop unavailable' })
      }
      const inventory = { ...state.inventory, [item]: owned + affordable }
      return set({
        cash: state.cash - definition.buyPrice * affordable,
        inventory,
        hotbar: hotbarWithNewItem(state.hotbar, state.inventory, item),
        enhancements: isEnhanceableItem(item) ? { ...state.enhancements, [item]: state.enhancements[item] ?? 0 } : state.enhancements,
        shopStock: definition.limited ? { ...state.shopStock, [item]: available - affordable } : state.shopStock,
        toast: `+${affordable} ${definition.name}`,
      })
    }
    if (shop.action === 'buy' || !definition.sellPrice) return
    const sold = Math.min(owned, Math.abs(quantity))
    if (!sold) return set({ toast: 'None owned' })
    const commodity = item in COMMODITY_MARKET_CONFIG ? item as CommodityId : null
    if (commodity && state.sharedMarketOnline) {
      if ([...pendingMarketTransactions.values()].some((pending) => pending.kind === 'commodity' && pending.itemId === commodity)) return set({ toast: 'Sale pending' })
      const requestId = crypto.randomUUID()
      pendingMarketTransactions.set(requestId, { kind: 'commodity', itemId: commodity, quantity: sold })
      if (sendMultiplayer('market:commodity-sell', { requestId, itemId: commodity, quantity: sold })) return
      pendingMarketTransactions.delete(requestId)
      return set({ toast: 'Market unavailable' })
    }
    const inventory = { ...state.inventory, [item]: owned - sold }
    const sale = commodity
      ? settleCommoditySale(commodity, definition.sellPrice, state.commodityMarket[commodity], state.commodityPending[commodity] ?? 0, sold)
      : { proceeds: scaledValue(definition.sellPrice, state.roundNumber, marketRate) * sold, quotedStock: 0, pendingSupply: 0, shock: false }
    const commodityMarket = commodity && sale.shock ? { ...state.commodityMarket, [commodity]: sale.quotedStock } : state.commodityMarket
    const commodityPending = commodity ? { ...state.commodityPending, [commodity]: sale.pendingSupply } : state.commodityPending
    set({ cash: state.cash + sale.proceeds, commodityMarket, commodityPending, inventory, hotbar: cleanedHotbar(state.hotbar, inventory), stats: { ...state.stats, sold: state.stats.sold + sold }, toast: `+${formatCoins(sale.proceeds)}` })
  },
  moveInventorySlot: (from, to) => set((state) => {
    if (from === to || from < 0 || to < 0 || from >= state.inventoryOrder.length || to >= state.inventoryOrder.length) return state
    const layout = inventoryLayout(state)
    ;[layout[from], layout[to]] = [layout[to], layout[from]]
    return layoutResult(state, layout)
  }),
  equipItem: (item) => set((state) => {
    if ((state.inventory[item] ?? 0) <= 0 || item === 'gold-coins') return state
    const layout = inventoryLayout(state)
    const target = state.selectedHotbar
    const source = layout.indexOf(item)
    if (source >= 0) [layout[source], layout[target]] = [layout[target], layout[source]]
    else layout[target] = item
    return { ...layoutResult(state, layout), inventoryOpen: false, toast: ITEMS[item].name }
  }),
  setHotbarSlot: (index, item) => set((state) => {
    if (index < 0 || index > 8 || (item && ((state.inventory[item] ?? 0) <= 0 || item === 'gold-coins'))) return state
    const layout = inventoryLayout(state)
    if (item) {
      const source = layout.indexOf(item)
      if (source >= 0) [layout[source], layout[index]] = [layout[index], layout[source]]
      else layout[index] = item
    } else if (layout[index]) {
      const lowerEmpty = layout.findIndex((slot, slotIndex) => slotIndex >= 9 && slot === null)
      if (lowerEmpty >= 0) [layout[lowerEmpty], layout[index]] = [layout[index], null]
      else layout[index] = null
    }
    return layoutResult(state, layout)
  }),
  swapHotbarSlots: (from, to) => set((state) => {
    if (from < 0 || to < 0 || from > 8 || to > 8 || from === to) return state
    const layout = inventoryLayout(state)
    ;[layout[from], layout[to]] = [layout[to], layout[from]]
    return layoutResult(state, layout)
  }),
  addItem: (item, quantity = 1) => set((state) => ({
    inventory: { ...state.inventory, [item]: (state.inventory[item] ?? 0) + quantity },
    hotbar: hotbarWithNewItem(state.hotbar, state.inventory, item),
  })),
  useCookbookBox: () => set((state) => {
    if ((state.inventory['cookbook-box'] ?? 0) <= 0) return state
    const locked = RECIPE_IDS.filter((id) => !state.knownRecipes.includes(id))
    if (!locked.length) return { toast: 'All recipes learned' }
    const earliestGroup = (['early', 'middle', 'late'] as const).find((group) => locked.some((id) => RECIPES[id].group === group)) ?? 'late'
    const eligible = locked.filter((id) => RECIPES[id].group === earliestGroup)
    const recipe = state.tutorialActive && locked.includes('apple-bread') ? 'apple-bread' : eligible[Math.floor(Math.random() * eligible.length)]
    const inventory = { ...state.inventory, 'cookbook-box': (state.inventory['cookbook-box'] ?? 0) - 1 }
    return {
      inventory,
      hotbar: cleanedHotbar(state.hotbar, inventory),
      knownRecipes: [...state.knownRecipes, recipe],
      recipeCards: { ...state.recipeCards, [recipe]: (state.recipeCards[recipe] ?? 0) + 1 },
      cookbookOpen: state.tutorialActive ? true : state.cookbookOpen,
      toast: `Unlocked ${RECIPES[recipe].name}!`,
    }
  }),
  farmAction: (farmIndex, index) => {
    const state = get()
    const useSharedFarm = state.sharedFarmOnline && !state.tutorialActive
    const onlineOwner = useSharedFarm ? state.farmOwners[farmIndex] : null
    if (useSharedFarm ? onlineOwner !== state.sharedFarmSelfId : !state.claimedFarms.includes(farmIndex)) return set({ toast: 'Not your farm' })
    const held = state.hotbar[state.selectedHotbar]
    const key = cellKey(farmIndex, index)
    const cell = (useSharedFarm ? state.sharedFarmCells[key] : state.farmCells[key]) ?? { crop: null, stage: 'empty' as const, readyAt: null }
    if (useSharedFarm) {
      const cropBySeed: Partial<Record<ItemId, CropKind>> = {
        'wheat-seeds': 'wheat', 'tomato-seeds': 'tomato', 'lettuce-seeds': 'lettuce',
        'pumpkin-seeds': 'pumpkin', 'watermelon-seeds': 'watermelon',
      }
      const op = cell.stage === 'empty' ? 'plant' : cell.stage === 'planted' ? 'water' : cell.stage === 'ready' ? 'harvest' : null
      if (!op) return set({ toast: `${Math.max(1, Math.ceil(((cell.readyAt ?? Date.now()) - Date.now()) / 1000))}s` })
      const crop = held ? cropBySeed[held] : null
      if (op === 'plant' && (!held || !crop)) return set({ toast: 'Select seeds' })
      if (op === 'plant' && (state.inventory[held!] ?? 0) <= 0) return set({ toast: 'Need seeds' })
      if (op === 'water' && held !== 'water-can') return set({ toast: 'Select watering can' })
      const requestId = crypto.randomUUID()
      pendingFarmActions.set(requestId, { op, farmId: farmIndex, cellIndex: index, seed: op === 'plant' ? held! : undefined, crop: crop ?? cell.crop ?? undefined })
      if (sendMultiplayer('farm:action', { requestId, op, farmId: farmIndex, cellIndex: index, crop, watered: op === 'plant' && state.weather === 'rain' })) return
      pendingFarmActions.delete(requestId)
    }
    if (cell.stage === 'empty') {
      const cropBySeed: Partial<Record<ItemId, CropKind>> = {
        'wheat-seeds': 'wheat', 'tomato-seeds': 'tomato', 'lettuce-seeds': 'lettuce',
        'pumpkin-seeds': 'pumpkin', 'watermelon-seeds': 'watermelon',
      }
      const crop = held ? cropBySeed[held] : null
      if (!held || !crop) return set({ toast: 'Select seeds' })
      const owned = state.inventory[held] ?? 0
      if (!owned) return set({ toast: 'Need seeds' })
      const inventory = { ...state.inventory, [held]: owned - 1 }
      const watered = !state.tutorialActive && state.weather === 'rain'
      const planted: FarmCellState = watered ? { crop, stage: 'watered', readyAt: Date.now() + (state.tutorialActive ? 4_000 : GROWTH_MS[crop]) } : { crop, stage: 'planted', readyAt: null }
      return set({ farmCells: { ...state.farmCells, [key]: planted }, inventory, hotbar: cleanedHotbar(state.hotbar, inventory), toast: watered ? 'Planted · watered' : 'Planted' })
    }
    if (cell.stage === 'planted') {
      if (held !== 'water-can') return set({ toast: 'Select watering can' })
      const crop = cell.crop ?? 'tomato'
      return set({ farmCells: { ...state.farmCells, [key]: { ...cell, stage: 'watered', readyAt: Date.now() + (state.tutorialActive ? 4_000 : GROWTH_MS[crop]) } }, toast: 'Watered' })
    }
    if (cell.stage === 'watered') return set({ toast: `${Math.max(1, Math.ceil(((cell.readyAt ?? Date.now()) - Date.now()) / 1000))}s` })
    const item = cell.crop ?? 'tomato'
    const boostedCharm = (state.fortuneBoostCharges['harvest-charm'] ?? 0) > 0
    const charmMultiplier = (state.inventory['harvest-charm'] ?? 0) > 0 ? enhancedYield('harvest-charm', enhancementLevel(state.enhancements, 'harvest-charm') + (boostedCharm ? 1 : 0)) : 1
    const quantity = CROP_YIELD[item] * charmMultiplier
    const farmCells = { ...state.farmCells }
    delete farmCells[key]
    set({
      farmCells,
      fortuneBoostCharges: boostedCharm ? { ...state.fortuneBoostCharges, 'harvest-charm': Math.max(0, (state.fortuneBoostCharges['harvest-charm'] ?? 0) - 1) } : state.fortuneBoostCharges,
      inventory: { ...state.inventory, [item]: (state.inventory[item] ?? 0) + quantity },
      hotbar: hotbarWithNewItem(state.hotbar, state.inventory, item),
      stats: { ...state.stats, harvested: state.stats.harvested + quantity },
      toast: `+${quantity} ${ITEMS[item].name}`,
    })
  },
  claimFarm: (index) => {
    const state = get()
    if (state.sharedFarmOnline) {
      if (state.farmOwners[index] === state.sharedFarmSelfId) return set({ toast: 'Your farm' })
      if (state.farmOwners[index]) return set({ toast: 'Farm already claimed' })
      const deeds = state.inventory['farm-deed'] ?? 0
      if (!deeds) return set({ toast: 'Need a farm deed' })
      const requestId = crypto.randomUUID()
      pendingFarmActions.set(requestId, { op: 'claim', farmId: index })
      if (sendMultiplayer('farm:action', { requestId, op: 'claim', farmId: index })) return
      pendingFarmActions.delete(requestId)
    }
    if (state.claimedFarms.includes(index)) return set({ toast: 'Your farm' })
    const deeds = state.inventory['farm-deed'] ?? 0
    if (!deeds) return set({ toast: 'Need a farm deed' })
    const inventory = { ...state.inventory, 'farm-deed': deeds - 1 }
    set({ claimedFarms: [...state.claimedFarms, index].sort((a, b) => a - b), inventory, hotbar: cleanedHotbar(state.hotbar, inventory), toast: `Farm ${index + 1} claimed` })
  },
  syncFarmSnapshot: ({ selfId, owners, cells }) => set((state) => state.tutorialActive ? state : { sharedFarmOnline: true, sharedFarmSelfId: selfId, farmOwners: owners, sharedFarmCells: cells }),
  syncFarmUpdate: ({ farmId, ownerId, cellIndex, cell }) => set((state) => {
    if (state.tutorialActive) return state
    const farmOwners = ownerId === undefined ? state.farmOwners : { ...state.farmOwners, [farmId]: ownerId }
    if (cellIndex === undefined) return { farmOwners }
    const key = cellKey(farmId, cellIndex)
    const sharedFarmCells = { ...state.sharedFarmCells }
    if (cell && cell.stage !== 'empty') sharedFarmCells[key] = cell
    else delete sharedFarmCells[key]
    return { farmOwners, sharedFarmCells }
  }),
  applyFarmResult: (result) => set((state) => {
    const pending = pendingFarmActions.get(result.requestId)
    if (!pending) return result.account ? { sharedFarmOnline: true } : state
    pendingFarmActions.delete(result.requestId)
    if (!result.ok) return { toast: result.reason || 'Farm action failed' }
    if (result.account) return { sharedFarmOnline: true, toast: result.op === 'claim' ? `Farm ${(result.farmId ?? pending.farmId) + 1} claimed` : result.op === 'harvest' ? `+${result.quantity ?? 0} ${result.crop ? ITEMS[result.crop].name : 'crop'}` : result.reason === 'watered' ? 'Planted · watered' : result.op === 'water' ? 'Watered' : result.op === 'rain' ? 'Farm watered' : 'Farm updated' }
    if (pending.op === 'claim') {
      const deeds = state.inventory['farm-deed'] ?? 0
      const inventory = { ...state.inventory, 'farm-deed': Math.max(0, deeds - 1) }
      return { claimedFarms: state.claimedFarms.includes(pending.farmId) ? state.claimedFarms : [...state.claimedFarms, pending.farmId].sort((a, b) => a - b), inventory, hotbar: cleanedHotbar(state.hotbar, inventory), toast: `Farm ${pending.farmId + 1} claimed` }
    }
    if (pending.op === 'plant' && pending.seed) {
      const inventory = { ...state.inventory, [pending.seed]: Math.max(0, (state.inventory[pending.seed] ?? 0) - 1) }
      return { inventory, hotbar: cleanedHotbar(state.hotbar, inventory), toast: result.reason === 'watered' ? 'Planted · watered' : 'Planted' }
    }
    if (pending.op === 'rain') {
      const inventory = { ...state.inventory, 'rain-bottle': Math.max(0, (state.inventory['rain-bottle'] ?? 0) - 1) }
      return { inventory, toast: 'Farm watered' }
    }
    if (pending.op === 'water') return { toast: 'Watered' }
    const crop = result.crop ?? pending.crop ?? 'tomato'
    const baseQuantity = Math.max(0, Math.floor(result.quantity ?? CROP_YIELD[crop]))
    const boosted = (state.fortuneBoostCharges['harvest-charm'] ?? 0) > 0
    const charmMultiplier = (state.inventory['harvest-charm'] ?? 0) > 0 ? enhancedYield('harvest-charm', enhancementLevel(state.enhancements, 'harvest-charm') + (boosted ? 1 : 0)) : 1
    const quantity = baseQuantity * charmMultiplier
    const inventory = { ...state.inventory, [crop]: (state.inventory[crop] ?? 0) + quantity }
    const fortuneBoostCharges = boosted ? { ...state.fortuneBoostCharges, 'harvest-charm': Math.max(0, (state.fortuneBoostCharges['harvest-charm'] ?? 0) - 1) } : state.fortuneBoostCharges
    return { inventory, fortuneBoostCharges, hotbar: hotbarWithNewItem(state.hotbar, state.inventory, crop), stats: { ...state.stats, harvested: state.stats.harvested + quantity }, toast: `+${quantity} ${ITEMS[crop].name}` }
  }),
  syncDeedSnapshot: ({ personalAvailable, globalRemaining }) => set((state) => state.tutorialActive ? state : ({
    sharedDeedOnline: true,
    personalDeedAvailable: Boolean(personalAvailable),
    globalDeedsRemaining: Math.max(0, Math.floor(Number(globalRemaining) || 0)),
  })),
  syncDeedStock: (globalRemaining) => set((state) => state.tutorialActive ? state : ({ globalDeedsRemaining: Math.max(0, Math.floor(Number(globalRemaining) || 0)) })),
  applyDeedResult: (result) => set((state) => {
    const pending = pendingDeedPurchases.has(result.requestId)
    if (pending) pendingDeedPurchases.delete(result.requestId)
    const shared = {
      sharedDeedOnline: true,
      personalDeedAvailable: Boolean(result.personalAvailable),
      globalDeedsRemaining: Math.max(0, Math.floor(Number(result.globalRemaining) || 0)),
      deedPurchasePending: pending ? false : state.deedPurchasePending,
    }
    if (!pending) return shared
    if (!result.ok || result.quantity <= 0) return { ...shared, toast: result.reason || 'Sold out' }
    if (result.account) return { ...shared, toast: `+${result.quantity} ${ITEMS[result.personalCount > 0 ? 'farm-deed' : 'shared-farm-deed'].name}` }
    const quantity = Math.max(0, Math.floor(result.quantity))
    const price = ITEMS['farm-deed'].buyPrice ?? 0
    const inventory = { ...state.inventory, 'farm-deed': (state.inventory['farm-deed'] ?? 0) + quantity }
    return { ...shared, cash: state.cash - price * quantity, inventory, hotbar: hotbarWithNewItem(state.hotbar, state.inventory, 'farm-deed'), toast: `+${quantity} ${ITEMS['farm-deed'].name}` }
  }),
  mineNode: (id, item) => {
    const state = get()
    if ((state.minedNodes[id] ?? 0) > Date.now()) return
    const held = state.hotbar[state.selectedHotbar]
    const pickaxe = isPickaxe(held) ? held : null
    if (!pickaxe) return set({ toast: 'Select a pickaxe' })
    if (!canMineOre(pickaxe, item)) return set({ toast: 'Pickaxe tier too low' })
    const boosted = (state.fortuneBoostCharges[pickaxe] ?? 0) > 0
    const quantity = miningYield(pickaxe, Math.random(), enhancementLevel(state.enhancements, pickaxe) + (boosted ? 1 : 0))
    const nextGeneration = (state.mineGenerations[id] ?? 0) + 1
    const cooldown = oreRespawnMs(id, nextGeneration, state.sessionSeed)
    set({
      minedNodes: { ...state.minedNodes, [id]: Date.now() + cooldown },
      mineGenerations: { ...state.mineGenerations, [id]: nextGeneration },
      mineAwardGenerations: { ...state.mineAwardGenerations, [id]: nextGeneration },
      fortuneBoostCharges: boosted ? { ...state.fortuneBoostCharges, [pickaxe]: Math.max(0, (state.fortuneBoostCharges[pickaxe] ?? 0) - 1) } : state.fortuneBoostCharges,
      inventory: { ...state.inventory, [item]: (state.inventory[item] ?? 0) + quantity },
      hotbar: hotbarWithNewItem(state.hotbar, state.inventory, item),
      stats: { ...state.stats, mined: state.stats.mined + quantity },
      toast: `+${quantity} ${ITEMS[item].name}`,
    })
  },
  syncMineSnapshot: (seed, nodes) => set((state) => {
    if (state.tutorialActive) return state
    const minedNodes: Record<string, number> = {}
    const mineGenerations: Record<string, number> = {}
    for (const [id, node] of Object.entries(nodes ?? {})) {
      if (!id.startsWith('MineOre') || !Number.isFinite(node?.generation) || !Number.isFinite(node?.readyAt)) continue
      minedNodes[id] = Math.max(0, Number(node.readyAt))
      mineGenerations[id] = Math.max(0, Math.floor(Number(node.generation)))
    }
    const nextSeed = Number.isFinite(seed) ? Math.floor(seed) : state.sessionSeed
    return { sessionSeed: nextSeed, minedNodes, mineGenerations, mineAwardGenerations: nextSeed === state.sessionSeed ? state.mineAwardGenerations : {} }
  }),
  syncMineNode: (id, node) => set((state) => {
    if (state.tutorialActive) return state
    if (!id.startsWith('MineOre') || !Number.isFinite(node?.generation) || !Number.isFinite(node?.readyAt)) return state
    return {
      minedNodes: { ...state.minedNodes, [id]: Math.max(0, Number(node.readyAt)) },
      mineGenerations: { ...state.mineGenerations, [id]: Math.max(0, Math.floor(Number(node.generation))) },
    }
  }),
  awardMineNode: (id, item, quantity, node, tool) => set((state) => {
    if (state.tutorialActive) return state
    const generation = Math.max(0, Math.floor(Number(node?.generation)))
    if (!id.startsWith('MineOre') || !(item in ORE_CONFIG) || !isPickaxe(tool) || !Number.isFinite(node?.readyAt) || (state.mineAwardGenerations[id] ?? -1) >= generation) return state
    if (consumeAuthoritativeAction('mine', id)) return {
      minedNodes: { ...state.minedNodes, [id]: Math.max(0, Number(node.readyAt)) },
      mineGenerations: { ...state.mineGenerations, [id]: generation },
      mineAwardGenerations: { ...state.mineAwardGenerations, [id]: generation },
      toast: `+${Math.max(1, Math.floor(Number(quantity) || 1))} ${ITEMS[item].name}`,
    }
    const awarded = Math.max(1, Math.min(5, Math.floor(Number(quantity) || 1)))
    const boostedPickaxe = (state.fortuneBoostCharges[tool] ?? 0) > 0 ? tool : null
    return {
      minedNodes: { ...state.minedNodes, [id]: Math.max(0, Number(node.readyAt)) },
      mineGenerations: { ...state.mineGenerations, [id]: generation },
      mineAwardGenerations: { ...state.mineAwardGenerations, [id]: generation },
      fortuneBoostCharges: boostedPickaxe ? { ...state.fortuneBoostCharges, [boostedPickaxe]: Math.max(0, (state.fortuneBoostCharges[boostedPickaxe] ?? 0) - 1) } : state.fortuneBoostCharges,
      inventory: { ...state.inventory, [item]: (state.inventory[item] ?? 0) + awarded },
      hotbar: hotbarWithNewItem(state.hotbar, state.inventory, item),
      stats: { ...state.stats, mined: state.stats.mined + awarded },
      toast: `+${awarded} ${ITEMS[item].name}`,
    }
  }),
  collectForage: (id, item) => {
    const state = get()
    const now = Date.now()
    const storedReadyAt = state.collectedForage[id] ?? 0
    const availableFruit = state.sharedForageOnline ? state.sharedForageAvailability[id] ?? 0 : forageSiteAvailability(id, storedReadyAt, now)
    if (availableFruit <= 0) return
    const basket = (state.inventory['master-basket'] ?? 0) > 0 ? 'master-basket'
      : (state.inventory['reinforced-basket'] ?? 0) > 0 ? 'reinforced-basket'
        : (state.inventory.basket ?? 0) > 0 ? 'basket' : 'hand'
    const resourceConfig = FORAGE_CONFIG as unknown as Record<string, { baseYield: readonly [number, number]; regrowSeconds: readonly [number, number]; capacity?: number; fruitRegrowSeconds?: number }>
    const config = resourceConfig[item]
    if (!config) return
    const [minimum, maximum] = config.baseYield
    const siteRoll = Math.abs([...id].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261)) / 4294967296
    const isFruitTree = id.startsWith('ForageApple') || id.startsWith('ForageOrange')
    const fruitStored = (state.inventory.apple ?? 0) + (state.inventory.orange ?? 0)
    const boosted = basket !== 'hand' && (state.fortuneBoostCharges[basket] ?? 0) > 0
    const basketLevel = basket === 'hand' ? 0 : enhancementLevel(state.enhancements, basket)
    const capacity = basket === 'hand' ? BASKET_CONFIG.hand.capacity : enhancedBasketCapacity(basket, basketLevel)
    const storageRemaining = capacity - fruitStored
    if (isFruitTree && storageRemaining <= 0) return set({ toast: 'Fruit storage full' })
    if (state.sharedForageOnline && sendMultiplayer('forage:request', {
      id,
      item,
      remainingCapacity: isFruitTree ? storageRemaining : 1,
      position: state.playerPosition,
    })) return
    const baseYield = isFruitTree ? Math.min(availableFruit, storageRemaining) : minimum + Math.floor(siteRoll * (maximum - minimum + 1))
    const bonus = basket === 'hand' ? 0 : enhancedYield(basket, basketLevel + (boosted ? 1 : 0)) - 1
    const quantity = isFruitTree ? Math.min(baseYield + bonus, storageRemaining) : baseYield + bonus
    const [minRegrow, maxRegrow] = config.regrowSeconds
    const regrow = minRegrow + siteRoll * (maxRegrow - minRegrow)
    const rareFind = item === 'truffle' || item === 'natural-discovery'
    const readyAt = rareFind
      ? nextRareForageRollAt(item, false, state.matchStartedAt, now)
      : isFruitTree
      ? Math.max(now, storedReadyAt) + baseYield * (config.fruitRegrowSeconds ?? 30) * 1000
      : now + regrow * 1000
    const seedDrop = Math.random() < FORAGE_CONFIG.seedDropChance
    const seed: ItemId = Math.random() < FORAGE_CONFIG.starterSeedShare ? 'wheat-seeds' : 'tomato-seeds'
    const inventory = { ...state.inventory, [item]: (state.inventory[item] ?? 0) + quantity }
    if (seedDrop) inventory[seed] = (inventory[seed] ?? 0) + 1
    set({
      inventory,
      fortuneBoostCharges: boosted ? { ...state.fortuneBoostCharges, [basket]: Math.max(0, (state.fortuneBoostCharges[basket] ?? 0) - 1) } : state.fortuneBoostCharges,
      hotbar: hotbarWithNewItem(state.hotbar, state.inventory, item),
      collectedForage: { ...state.collectedForage, [id]: readyAt },
      stats: { ...state.stats, foraged: state.stats.foraged + quantity },
      toast: `+${quantity} ${ITEMS[item].name}${bonus ? `  +${bonus} Fortune` : ''}${seedDrop ? '  +Seed' : ''}`,
    })
  },
  syncForageSnapshot: (snapshot) => set((state) => {
    if (state.tutorialActive) return state
    if (!snapshot?.nodes || !Number.isFinite(snapshot.regrowMs)) return state
    const collectedForage = Object.fromEntries(Object.entries(state.collectedForage).filter(([id]) => !id.startsWith('ForageApple') && !id.startsWith('ForageOrange') && !id.startsWith('ForageTruffle') && !id.startsWith('ForageDiscovery')))
    const localNow = Date.now()
    const serverNow = Number.isFinite(snapshot.serverNow) ? Number(snapshot.serverNow) : localNow
    for (const node of Object.values(snapshot.nodes)) {
      if (!node?.id || (node.item !== 'apple' && node.item !== 'orange' && node.item !== 'truffle' && node.item !== 'natural-discovery') || !Number.isFinite(node.fullAt)) continue
      if (node.fullAt > 0) collectedForage[node.id] = localNow + Math.max(0, node.fullAt - serverNow)
    }
    return { sharedForageOnline: true, sharedForageAvailability: Object.fromEntries(Object.values(snapshot.nodes).map((node) => [node.id, Math.max(0, Math.floor(Number(node.available) || 0))])), collectedForage }
  }),
  syncForageNode: (node) => set((state) => {
    if (state.tutorialActive) return state
    if (!node?.id || (node.item !== 'apple' && node.item !== 'orange' && node.item !== 'truffle' && node.item !== 'natural-discovery') || !Number.isFinite(node.fullAt)) return state
    const collectedForage = { ...state.collectedForage }
    const sharedForageAvailability = { ...state.sharedForageAvailability, [node.id]: Math.max(0, Math.floor(Number(node.available) || 0)) }
    const serverNow = Number.isFinite(node.serverNow) ? Number(node.serverNow) : Date.now()
    if (node.fullAt > 0) collectedForage[node.id] = Date.now() + Math.max(0, node.fullAt - serverNow)
    else delete collectedForage[node.id]
    return { sharedForageOnline: true, sharedForageAvailability, collectedForage }
  }),
  awardForageNode: (award) => set((state) => {
    if (state.tutorialActive) return state
    if (!award?.id || (award.item !== 'apple' && award.item !== 'orange' && award.item !== 'truffle' && award.item !== 'natural-discovery') || !Number.isFinite(award.fullAt) || !Number.isFinite(award.quantity)) return state
    const serverNow = Number.isFinite(award.serverNow) ? Number(award.serverNow) : Date.now()
    const localFullAt = award.fullAt > 0 ? Date.now() + Math.max(0, award.fullAt - serverNow) : 0
    if ((state.forageAwardFullAt[award.id] ?? 0) >= localFullAt) return state
    if (consumeAuthoritativeAction('forage', award.id)) return {
      sharedForageOnline: true,
      sharedForageAvailability: { ...state.sharedForageAvailability, [award.id]: Math.max(0, Math.floor(Number(award.available) || 0)) },
      collectedForage: { ...state.collectedForage, [award.id]: localFullAt },
      forageAwardFullAt: { ...state.forageAwardFullAt, [award.id]: localFullAt },
      toast: `+${Math.max(1, Math.floor(Number(award.quantity) || 1))} ${ITEMS[award.item].name}`,
    }
    const basket = (state.inventory['master-basket'] ?? 0) > 0 ? 'master-basket'
      : (state.inventory['reinforced-basket'] ?? 0) > 0 ? 'reinforced-basket'
        : (state.inventory.basket ?? 0) > 0 ? 'basket' : 'hand'
    const isFruitTree = award.item === 'apple' || award.item === 'orange'
    const fruitStored = (state.inventory.apple ?? 0) + (state.inventory.orange ?? 0)
    const boosted = basket !== 'hand' && (state.fortuneBoostCharges[basket] ?? 0) > 0
    const basketLevel = basket === 'hand' ? 0 : enhancementLevel(state.enhancements, basket)
    const capacity = basket === 'hand' ? BASKET_CONFIG.hand.capacity : enhancedBasketCapacity(basket, basketLevel)
    const storageRemaining = isFruitTree ? Math.max(0, capacity - fruitStored) : Number.MAX_SAFE_INTEGER
    const baseYield = Math.min(Math.max(0, Math.floor(award.quantity)), storageRemaining)
    if (baseYield <= 0) return {
      sharedForageOnline: true,
      sharedForageAvailability: { ...state.sharedForageAvailability, [award.id]: Math.max(0, Math.floor(Number(award.available) || 0)) },
      collectedForage: { ...state.collectedForage, [award.id]: localFullAt },
      forageAwardFullAt: { ...state.forageAwardFullAt, [award.id]: localFullAt },
      toast: 'Fruit storage full',
    }
    const bonus = basket === 'hand' ? 0 : enhancedYield(basket, basketLevel + (boosted ? 1 : 0)) - 1
    const quantity = Math.min(baseYield + bonus, storageRemaining)
    const seedDrop = Math.random() < FORAGE_CONFIG.seedDropChance
    const seed: ItemId = Math.random() < FORAGE_CONFIG.starterSeedShare ? 'wheat-seeds' : 'tomato-seeds'
    const inventory = { ...state.inventory, [award.item]: (state.inventory[award.item] ?? 0) + quantity }
    if (seedDrop) inventory[seed] = (inventory[seed] ?? 0) + 1
    return {
      sharedForageOnline: true,
      sharedForageAvailability: { ...state.sharedForageAvailability, [award.id]: Math.max(0, Math.floor(Number(award.available) || 0)) },
      inventory,
      fortuneBoostCharges: boosted ? { ...state.fortuneBoostCharges, [basket]: Math.max(0, (state.fortuneBoostCharges[basket] ?? 0) - 1) } : state.fortuneBoostCharges,
      hotbar: hotbarWithNewItem(state.hotbar, state.inventory, award.item),
      collectedForage: { ...state.collectedForage, [award.id]: localFullAt },
      forageAwardFullAt: { ...state.forageAwardFullAt, [award.id]: localFullAt },
      stats: { ...state.stats, foraged: state.stats.foraged + quantity },
      toast: `+${quantity} ${ITEMS[award.item].name}${bonus ? `  +${bonus} Fortune` : ''}${seedDrop ? '  +Seed' : ''}`,
    }
  }),
  setStockOpen: (stockOpen) => set({ stockOpen, shopOpen: false, inventoryOpen: false, menuOpen: false, enhancementOpen: false, interactionProgress: 0 }),
  tradeStock: (id, quantity) => {
    const state = get()
    const stock = STOCKS[id]
    const elapsedSeconds = (state.roundNumber - 1) * MATCH_CONFIG.worldCycleSeconds + (MATCH_CONFIG.worldCycleSeconds - state.roundSeconds)
    if (!stockAvailable(stock, elapsedSeconds)) return set({ toast: `Opens at ${stock.releaseMinute}m` })
    const price = state.stockPrices[id]
    const owned = state.portfolio[id] ?? 0
    if (state.sharedMarketOnline) {
      if ([...pendingMarketTransactions.values()].some((pending) => pending.kind === 'stock' && pending.stockId === id)) return set({ toast: 'Order pending' })
      const direction = quantity > 0 ? 'buy' as const : 'sell' as const
      const requested = direction === 'buy'
        ? Math.min(Math.max(0, Math.floor(quantity)), Math.floor(state.cash / Math.max(1, price)))
        : Math.min(owned, Math.abs(Math.floor(quantity)))
      if (!requested) return set({ toast: direction === 'buy' ? (state.stockSupply[id] ? 'Not enough coins' : 'Sold out') : 'None owned' })
      const requestId = crypto.randomUUID()
      pendingMarketTransactions.set(requestId, { kind: 'stock', stockId: id, direction, quantity: requested })
      if (sendMultiplayer('market:stock-trade', { requestId, stockId: id, direction, quantity: requested })) return
      pendingMarketTransactions.delete(requestId)
      return set({ toast: 'Market unavailable' })
    }
    if (quantity > 0) {
      const count = Math.min(quantity, state.stockSupply[id], Math.floor(state.cash / price))
      if (!count) return set({ toast: state.stockSupply[id] ? 'Not enough coins' : 'Sold out' })
      return set({ cash: state.cash - price * count, stockSupply: { ...state.stockSupply, [id]: state.stockSupply[id] - count }, portfolio: { ...state.portfolio, [id]: owned + count }, toast: `+${count} ${stock.ticker}` })
    }
    const count = Math.min(owned, Math.abs(quantity))
    if (!count) return set({ toast: 'None owned' })
    const proceeds = price * count
    set({ cash: state.cash + proceeds, stockSupply: { ...state.stockSupply, [id]: state.stockSupply[id] + count }, portfolio: { ...state.portfolio, [id]: owned - count }, toast: `+${formatCoins(proceeds)}` })
  },
  syncMarketSnapshot: (snapshot) => set((state) => {
    if (state.tutorialActive) return state
    if (!snapshot || !Number.isFinite(snapshot.revision) || snapshot.revision < state.marketRevision) return state
    return {
      sharedMarketOnline: true,
      marketRevision: snapshot.revision,
      weather: snapshot.weather,
      weatherSeconds: Math.max(0, Math.floor(snapshot.weatherSeconds)),
      commodityMarket: { ...snapshot.commodityMarket },
      commodityPending: { ...snapshot.commodityPending },
      commodityPriceHistory: Object.fromEntries(Object.entries(snapshot.commodityPriceHistory).map(([id, history]) => [id, [...history]])),
      commodityCycle: snapshot.commodityCycle,
      stockPrices: { ...snapshot.stockPrices },
      stockHistory: Object.fromEntries(Object.entries(snapshot.stockHistory).map(([id, history]) => [id, [...history]])) as Record<StockId, number[]>,
      stockSupply: { ...snapshot.stockSupply },
      foodMarket: { ...snapshot.foodMarket },
      foodPriceHistory: Object.fromEntries(Object.entries(snapshot.foodPriceHistory).map(([id, history]) => [id, [...history]])),
      marketCorrectionsApplied: [...snapshot.marketCorrectionsApplied],
      marketCorrectionName: snapshot.marketCorrectionName,
      marketCorrectionSeconds: Math.max(0, Math.floor(snapshot.marketCorrectionSeconds)),
    }
  }),
  applyMarketTransaction: (result) => {
    const pending = pendingMarketTransactions.get(result.requestId)
    if (!pending) return
    pendingMarketTransactions.delete(result.requestId)
    if (!result.ok) return set({ toast: result.reason === 'sold-out' ? 'Sold out' : result.reason === 'closed' ? 'Market closed' : 'Trade failed' })
    if (result.account) return set({ sharedMarketOnline: true, toast: result.kind === 'stock' && result.direction === 'buy' ? `+${result.quantity} ${STOCKS[result.stockId!].ticker}` : `+${formatCoins(result.total)}` })
    const quantity = Math.max(0, Math.min(pending.quantity, Math.floor(result.quantity)))
    if (!quantity) return set({ toast: result.reason === 'sold-out' ? 'Sold out' : 'Trade failed' })
    const total = Math.max(0, Math.floor(result.total))
    const state = get()
    if (pending.kind === 'commodity' && result.kind === 'commodity' && result.itemId === pending.itemId) {
      if ((state.inventory[pending.itemId] ?? 0) < quantity) return set({ toast: 'Inventory changed' })
      const inventory = { ...state.inventory, [pending.itemId]: (state.inventory[pending.itemId] ?? 0) - quantity }
      return set({ cash: state.cash + total, inventory, hotbar: cleanedHotbar(state.hotbar, inventory), stats: { ...state.stats, sold: state.stats.sold + quantity }, toast: `+${formatCoins(total)}` })
    }
    if (pending.kind === 'food' && result.kind === 'food' && result.recipeId === pending.recipeId) {
      const food = RECIPES[pending.recipeId].food as FoodItemId
      if ((state.inventory[food] ?? 0) < quantity) return set({ toast: 'Inventory changed' })
      const inventory = { ...state.inventory, [food]: (state.inventory[food] ?? 0) - quantity }
      return set({ cash: state.cash + total, inventory, hotbar: cleanedHotbar(state.hotbar, inventory), stats: { ...state.stats, sold: state.stats.sold + quantity }, toast: `+${formatCoins(total)}` })
    }
    if (pending.kind === 'stock' && result.kind === 'stock' && result.stockId === pending.stockId && result.direction === pending.direction) {
      const owned = state.portfolio[pending.stockId] ?? 0
      if (pending.direction === 'buy') {
        if (state.cash < total) return set({ toast: 'Balance changed' })
        return set({ cash: state.cash - total, portfolio: { ...state.portfolio, [pending.stockId]: owned + quantity }, toast: `+${quantity} ${STOCKS[pending.stockId].ticker}` })
      }
      if (owned < quantity) return set({ toast: 'Holdings changed' })
      return set({ cash: state.cash + total, portfolio: { ...state.portfolio, [pending.stockId]: owned - quantity }, toast: `+${formatCoins(total)}` })
    }
    set({ toast: 'Trade failed' })
  },
  setToast: (toast) => set({ toast }),
  setVolume: (channel, value) => {
    const audioVolumes = { ...get().audioVolumes, [channel]: clampVolume(value, get().audioVolumes[channel]) }
    localStorage.setItem('project01-audio', JSON.stringify(audioVolumes))
    set({ audioVolumes })
  },
  setCameraSensitivity: (cameraSensitivity) => {
    localStorage.setItem('project01-camera-sensitivity', String(cameraSensitivity))
    set({ cameraSensitivity })
  },
  setCameraInvertY: (cameraInvertY) => {
    localStorage.setItem('project01-camera-invert-y', cameraInvertY ? '1' : '0')
    set({ cameraInvertY })
  },
  setShiftLocked: (shiftLocked) => {
    localStorage.setItem('project01-shift-lock', shiftLocked ? '1' : '0')
    set({ shiftLocked })
  },
  setSprintMode: (sprintMode) => {
    localStorage.setItem('project01-sprint-mode', sprintMode)
    set({ sprintMode })
  },
  setGraphicsMode: (graphicsMode) => {
    localStorage.setItem('project01-graphics', graphicsMode)
    set({ graphicsMode })
  },
  setLanguage: (language) => {
    localStorage.setItem('project01-language', language)
    document.documentElement.lang = language
    set({ language })
  },
  setSelectedHotbar: (selectedHotbar) => set({ selectedHotbar }),
  setNickname: (nickname) => {
    const clean = nickname.trim().replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 18)
    if (!clean) return
    localStorage.setItem('project01-nickname', clean)
    set({ nickname: clean })
  },
  setOnlinePlayers: (onlinePlayers) => set({ onlinePlayers }),
  setPlayerPanelOpen: (playerPanelOpen) => set({ playerPanelOpen, lobbySettingsOpen: false, inventoryOpen: false, shopOpen: false, stockOpen: false, menuOpen: false, enhancementOpen: false }),
  setPendingTradeRequest: (pendingTradeRequest) => set({ pendingTradeRequest }),
  setLotteryOpen: (lotteryOpen) => set({ lotteryOpen, shopOpen: false, ticketInspectOpen: false, secretOpen: false, enhancementOpen: false }),
  toggleLotteryNumber: (value) => set((state) => {
    if (value < 1 || value > 12) return state
    const lotteryDraft = state.lotteryDraft.includes(value)
      ? state.lotteryDraft.filter((number) => number !== value)
      : state.lotteryDraft.length < 3 ? [...state.lotteryDraft, value].sort((a, b) => a - b) : state.lotteryDraft
    return { lotteryDraft }
  }),
  buyLotteryTicket: (tier = 1) => set((state) => {
    if (state.lotteryDraft.length !== 3) return { toast: 'Choose 3 numbers' }
    const price = lotteryPrice(state.roundNumber) * tier
    if (state.cash < price) return { toast: 'Not enough coins' }
    const ticket: LotteryTicket = { id: `${state.roundNumber}-${Date.now()}`, numbers: [...state.lotteryDraft], drawRound: state.roundNumber, tier }
    const inventory = { ...state.inventory, 'lottery-ticket': (state.inventory['lottery-ticket'] ?? 0) + 1 }
    return {
      cash: state.cash - price,
      inventory,
      hotbar: hotbarWithNewItem(state.hotbar, state.inventory, 'lottery-ticket'),
      lotteryTickets: [...state.lotteryTickets, ticket],
      lotteryDraft: [],
      lotteryOpen: false,
      toast: `Ticket ${ticket.numbers.join(' · ')}`,
    }
  }),
  setTicketInspectOpen: (ticketInspectOpen) => set({ ticketInspectOpen, inventoryOpen: false, lotteryOpen: false, secretOpen: false, enhancementOpen: false }),
  setTravelOpen: (travelOpen) => set({ travelOpen, inventoryOpen: false, shopOpen: false, stockOpen: false, menuOpen: false, lotteryOpen: false, ticketInspectOpen: false, secretOpen: false, cookbookOpen: false, enhancementOpen: false }),
  setSecretOpen: (secretOpen) => set({ secretOpen, shopOpen: false, stockOpen: false, inventoryOpen: false, lotteryOpen: false, ticketInspectOpen: false, enhancementOpen: false }),
  claimSecretDeal: () => set((state) => {
    if (state.zone === 'hub' || secretZoneForRound(state.roundNumber) !== state.zone || state.secretClaimedRound === state.roundNumber) return { toast: 'Gone for now', secretOpen: false }
    const deal = secretDealForRound(state.zone, state.roundNumber)
    const owned = state.inventory[deal.give] ?? 0
    if (owned < deal.quantity) return { toast: `Need ${deal.quantity} ${ITEMS[deal.give].name}` }
    const inventory = { ...state.inventory, [deal.give]: owned - deal.quantity }
    const payout = secretPayoutForRound(deal, state.roundNumber)
    return { cash: state.cash + payout, inventory, hotbar: cleanedHotbar(state.hotbar, inventory), secretClaimedRound: state.roundNumber, secretOpen: false, toast: `+${formatCoins(payout)}` }
  }),
  buySecretInfo: (slot) => set((state) => {
    if (slot < 0 || slot > 1) return state
    const purchaseKey = `${state.roundNumber}:${slot}`
    if (state.brokerPurchases.includes(purchaseKey)) return { toast: 'Already purchased' }
    const offer = secretStockOffer(state.roundNumber, state.stockPrices, state.sessionSeed, state.marketCorrectionsApplied.length, slot, state.sessionDurationSeconds)
    if (!offer.available) return { toast: 'No more information' }
    if (state.cash < offer.cost) return { toast: 'Not enough coins' }
    const note: BrokerNote = { id: `${purchaseKey}:${Date.now()}`, title: `INFO ${slot + 1}`, text: offer.clue, round: state.roundNumber }
    const inventory = { ...state.inventory, 'information-note': (state.inventory['information-note'] ?? 0) + 1 }
    return { cash: state.cash - offer.cost, inventory, hotbar: hotbarWithNewItem(state.hotbar, state.inventory, 'information-note'), brokerNotes: [...state.brokerNotes, note], brokerPurchases: [...state.brokerPurchases, purchaseKey], toast: 'Information added' }
  }),
  syncMerchantCycle: (merchantCycle) => set({ merchantCycle }),
  buyMerchantItem: (itemId) => {
    const state = get()
    if (state.merchantPurchasePending) return
    const offer = state.merchantCycle?.inventory.find((entry) => entry.id === itemId)
    if (!offer || offer.stock < 1) return set({ toast: 'Sold out' })
    if (state.cash < offer.price) return set({ toast: 'Not enough coins' })
    const requestId = crypto.randomUUID()
    pendingMerchantPurchases.add(requestId)
    if (sendMultiplayer('merchant:buy', { requestId, cycleId: state.merchantCycle?.id, itemId })) return set({ merchantPurchasePending: true })
    pendingMerchantPurchases.delete(requestId)
    set({ toast: 'Merchant unavailable' })
  },
  applyMerchantPurchase: (result) => set((state) => {
    if (result.cycle) state = { ...state, merchantCycle: result.cycle }
    const pending = pendingMerchantPurchases.has(result.requestId)
    if (pending) pendingMerchantPurchases.delete(result.requestId)
    const shared = { merchantCycle: result.cycle ?? state.merchantCycle, merchantPurchasePending: pending ? false : state.merchantPurchasePending }
    if (!pending) return shared
    if (!result.ok || !result.itemId || !Number.isFinite(result.price)) return { ...shared, toast: result.reason || 'Could not buy' }
    if (result.account) return { ...shared, toast: `+1 ${ITEMS[result.itemId as ItemId]?.name ?? result.itemId}` }
    const itemId = result.itemId as ItemId
    const price = Math.max(0, Math.floor(result.price ?? 0))
    if (state.cash < price) return { ...shared, toast: 'Not enough coins' }
    const inventory = { ...state.inventory, [itemId]: (state.inventory[itemId] ?? 0) + 1 }
    return { ...shared, cash: state.cash - price, inventory, hotbar: hotbarWithNewItem(state.hotbar, state.inventory, itemId), toast: `+1 ${ITEMS[itemId].name}` }
  }),
  setItemUseOpen: (itemUseOpen) => set({ itemUseOpen, inventoryOpen: false, shopOpen: false, stockOpen: false, secretOpen: false }),
  setNoteInspectOpen: (noteInspectOpen) => set({ noteInspectOpen, inventoryOpen: false, secretOpen: false, ticketInspectOpen: false, enhancementOpen: false }),
  setCookbookOpen: (cookbookOpen, requestedFurnace) => set((state) => {
    const placedFurnaces = (state.inventory.furnace ?? 0) > 0 ? state.claimedFarms.slice(0, 1) : []
    const activeFurnaceIndex = cookbookOpen
      ? (requestedFurnace !== undefined && placedFurnaces.includes(requestedFurnace) ? requestedFurnace : state.activeFurnaceIndex ?? placedFurnaces[0] ?? null)
      : state.activeFurnaceIndex
    const furnaceReadyUntil = cookbookOpen && activeFurnaceIndex !== null
      ? { ...state.furnaceReadyUntil, [activeFurnaceIndex]: 0 }
      : state.furnaceReadyUntil
    return { cookbookOpen, activeFurnaceIndex, furnaceReadyUntil, shopOpen: false, stockOpen: false, inventoryOpen: false, lotteryOpen: false, ticketInspectOpen: false, secretOpen: false, menuOpen: false, enhancementOpen: false }
  }),
  setEnhancementOpen: (enhancementOpen) => set({ enhancementOpen, shopOpen: false, stockOpen: false, inventoryOpen: false, menuOpen: false, playerPanelOpen: false, lotteryOpen: false, ticketInspectOpen: false, noteInspectOpen: false, travelOpen: false, secretOpen: false, cookbookOpen: false, interactionProgress: 0 }),
  enhanceEquipment: (item, options = {}) => set((state) => {
    if (state.minigameOpen || (state.inventory[item] ?? 0) !== 1) return { toast: 'Item not owned' }
    const current = enhancementLevel(state.enhancements, item)
    if (current >= 10) return { toast: 'Max level' }
    const result = resolveEnhancementAttempt(item, current, state.cash, state.inventory, options, state.tutorialActive && current === 0 ? 0 : Math.random())
    if (!result.ok) return { toast: result.reason === 'coins' ? 'Not enough coins' : result.reason === 'materials' ? 'Missing materials' : result.reason === 'ward' ? 'Protection unavailable' : result.reason === 'voucher' ? 'Discount unavailable' : 'Max level' }
    const inventory = result.inventory as Partial<Record<ItemId, number>>
    const enhancements = { ...state.enhancements, [item]: result.level }
    const toast = result.success
      ? `Upgraded · ${enhancementName(item, result.level)}`
      : result.level === current
        ? `Upgrade failed · kept +${current}`
        : `Upgrade failed · dropped to +${result.level}`
    return { cash: result.cash, inventory, hotbar: cleanedHotbar(state.hotbar, inventory), enhancements, toast }
  }),
  useMiningBoost: () => set((state) => {
    if (state.minigameOpen) return { toast: 'Use after the event' }
    if ((state.inventory['mining-boost'] ?? 0) < 1) return state
    if (state.miningBoostUntil > Date.now()) return { toast: 'Mining Tonic already active' }
    const inventory = { ...state.inventory, 'mining-boost': (state.inventory['mining-boost'] ?? 0) - 1 }
    return { inventory, miningBoostUntil: Date.now() + 180_000, toast: 'Mining Tonic · 3:00' }
  }),
  useFortuneBoost: (item) => set((state) => {
    if (state.minigameOpen) return { toast: 'Use after the event' }
    if ((state.inventory['fortune-boost'] ?? 0) < 1 || (state.inventory[item] ?? 0) < 1) return state
    if ((state.fortuneBoostCharges[item] ?? 0) > 0) return { toast: 'Luck Tonic already active' }
    const charges = item.endsWith('pickaxe') ? 20 : item === 'harvest-charm' ? 32 : 30
    const inventory = { ...state.inventory, 'fortune-boost': (state.inventory['fortune-boost'] ?? 0) - 1 }
    return { inventory, fortuneBoostCharges: { ...state.fortuneBoostCharges, [item]: charges }, toast: `Luck Tonic · ${charges} uses` }
  }),
  useCookTimer: () => set((state) => {
    if (state.minigameOpen) return { toast: 'Use after the event' }
    if ((state.inventory['cook-timer'] ?? 0) < 1) return state
    const now = Date.now()
    let remaining = 90_000
    let savedTime = 0
    const cookQueue = state.cookQueue.map((job) => {
      if (remaining <= 0 || job.readyAt <= now) return job
      const reduction = Math.min(30_000, remaining, job.readyAt - now)
      remaining -= reduction
      savedTime += reduction
      return { ...job, readyAt: job.readyAt - reduction }
    })
    if (savedTime <= 0) return { toast: 'Nothing cooking' }
    const inventory = { ...state.inventory, 'cook-timer': (state.inventory['cook-timer'] ?? 0) - 1 }
    return { inventory, cookQueue, toast: `Cook Timer · -${Math.round(savedTime / 1000)}s` }
  }),
  useRainBottle: (farmIndex) => {
    const state = get()
    if (state.minigameOpen || (state.inventory['rain-bottle'] ?? 0) < 1) return
    const owns = state.sharedFarmOnline ? state.farmOwners[farmIndex] === state.sharedFarmSelfId : state.claimedFarms.includes(farmIndex)
    if (!owns) return set({ toast: 'Choose your farm' })
    if (state.sharedFarmOnline) {
      const requestId = crypto.randomUUID()
      pendingFarmActions.set(requestId, { op: 'rain', farmId: farmIndex })
      if (sendMultiplayer('farm:action', { requestId, op: 'rain', farmId: farmIndex })) return
      pendingFarmActions.delete(requestId)
    }
    const planted = Object.entries(state.farmCells).filter(([key, cell]) => key.startsWith(`${farmIndex}:`) && cell.stage === 'planted' && cell.crop)
    if (!planted.length) return set({ toast: 'No dry crops' })
    const farmCells = { ...state.farmCells }
    planted.forEach(([key, cell]) => { farmCells[key] = { ...cell, stage: 'watered', readyAt: Date.now() + GROWTH_MS[cell.crop!] } })
    const inventory = { ...state.inventory, 'rain-bottle': (state.inventory['rain-bottle'] ?? 0) - 1 }
    set({ inventory, farmCells, toast: 'Farm watered' })
  },
  cookRecipe: (recipeId, requestedQuantity = 1) => {
    const state = get()
    if (!state.knownRecipes.includes(recipeId)) return set({ toast: 'Recipe not learned' })
    const furnaceIndex = state.activeFurnaceIndex
    const placedFurnaces = (state.inventory.furnace ?? 0) > 0 ? state.claimedFarms.slice(0, 1) : []
    if (furnaceIndex === null || !placedFurnaces.includes(furnaceIndex)) return set({ toast: 'Use a farm furnace' })
    const furnaceQueue = state.cookQueue.filter((job) => job.furnaceIndex === furnaceIndex && job.readyAt > Date.now())
    if (furnaceQueue.length >= 3) return set({ toast: 'Furnace queue full' })
    const recipe = RECIPES[recipeId]
    const ingredients = Object.entries(recipe.ingredients) as Array<[ItemId, number]>
    const ingredientLimit = Math.min(...ingredients.map(([item, quantity]) => Math.floor((state.inventory[item] ?? 0) / quantity)))
    const batchCapacity = Math.max(10, (state.inventory.furnace ?? 1) * 10)
    const quantity = Math.max(1, Math.min(batchCapacity, Math.floor(requestedQuantity), ingredientLimit))
    if (ingredientLimit < 1) return set({ toast: 'Missing ingredients' })
    if (state.sharedMarketOnline && !state.tutorialActive) {
      if ([...pendingCookActions.values()].some((pending) => pending.op === 'queue' && pending.furnaceIndex === furnaceIndex)) return set({ toast: 'Starting…' })
      const requestId = crypto.randomUUID()
      pendingCookActions.set(requestId, { op: 'queue', recipeId, furnaceIndex })
      if (sendMultiplayer('cook:queue', { requestId, recipeId, quantity, furnaceIndex })) return set({ toast: 'Starting…' })
      pendingCookActions.delete(requestId)
      return set({ toast: 'Furnace unavailable' })
    }
    const inventory = { ...state.inventory }
    ingredients.forEach(([item, amount]) => { inventory[item] = (inventory[item] ?? 0) - amount * quantity })
    const lastReady = furnaceQueue.at(-1)?.readyAt ?? Date.now()
    const job: CookJob = { id: `${recipeId}-${furnaceIndex}-${Date.now()}`, recipe: recipeId, quantity, furnaceIndex, readyAt: Math.max(Date.now(), lastReady) + (state.tutorialActive ? 3_000 : recipe.cookSeconds * 1000) }
    return set({ inventory, hotbar: cleanedHotbar(state.hotbar, inventory), cookQueue: [...state.cookQueue, job], furnaceReadyUntil: { ...state.furnaceReadyUntil, [furnaceIndex]: 0 }, toast: `${recipe.name} ×${quantity}` })
  },
  collectCooked: (recipeId) => {
    const state = get()
    const furnaceIndex = state.activeFurnaceIndex
    if (furnaceIndex === null) return set({ toast: 'Use a farm furnace' })
    const now = Date.now()
    const collected = state.cookQueue.filter((job) => job.furnaceIndex === furnaceIndex && job.readyAt <= now && (!recipeId || job.recipe === recipeId))
    if (!collected.length) return set({ toast: 'Nothing ready' })
    if (state.sharedMarketOnline && !state.tutorialActive) {
      if ([...pendingCookActions.values()].some((pending) => pending.op === 'collect' && pending.furnaceIndex === furnaceIndex && pending.recipeId === recipeId)) return set({ toast: 'Collecting…' })
      const requestId = crypto.randomUUID()
      pendingCookActions.set(requestId, { op: 'collect', recipeId, furnaceIndex })
      if (sendMultiplayer('cook:collect', { requestId, recipeId, furnaceIndex })) return set({ toast: 'Collecting…' })
      pendingCookActions.delete(requestId)
      return set({ toast: 'Furnace unavailable' })
    }
    const collectedIds = new Set(collected.map((job) => job.id))
    const inventory = { ...state.inventory }
    let hotbar = state.hotbar
    const totals = new Map<FoodItemId, number>()
    collected.forEach((job) => {
      const food = RECIPES[job.recipe].food as FoodItemId
      totals.set(food, (totals.get(food) ?? 0) + (job.quantity ?? 1))
    })
    totals.forEach((quantity, food) => {
      hotbar = hotbarWithNewItem(hotbar, inventory, food)
      inventory[food] = (inventory[food] ?? 0) + quantity
    })
    const remainingReady = state.cookQueue.some((job) => !collectedIds.has(job.id) && job.furnaceIndex === furnaceIndex && job.readyAt <= now)
    const total = [...totals.values()].reduce((sum, quantity) => sum + quantity, 0)
    const label = totals.size === 1 ? ITEMS[[...totals.keys()][0]].name : 'dishes'
    return set({
      inventory,
      hotbar,
      cookQueue: state.cookQueue.filter((job) => !collectedIds.has(job.id)),
      furnaceReadyUntil: { ...state.furnaceReadyUntil, [furnaceIndex]: remainingReady ? Number.MAX_SAFE_INTEGER : 0 },
      toast: `+${total} ${label}`,
    })
  },
  sellFood: (recipeId, quantity) => {
    const state = get()
    const food = RECIPES[recipeId].food as FoodItemId
    const sold = Math.min(Math.max(0, Math.floor(quantity)), state.inventory[food] ?? 0)
    if (!sold) return set({ toast: 'None ready' })
    if (state.sharedMarketOnline) {
      if ([...pendingMarketTransactions.values()].some((pending) => pending.kind === 'food' && pending.recipeId === recipeId)) return set({ toast: 'Sale pending' })
      const requestId = crypto.randomUUID()
      pendingMarketTransactions.set(requestId, { kind: 'food', recipeId, quantity: sold })
      if (sendMultiplayer('market:food-sell', { requestId, recipeId, quantity: sold })) return
      pendingMarketTransactions.delete(requestId)
      return set({ toast: 'Market unavailable' })
    }
    let stock = state.foodMarket[recipeId]
    let proceeds = 0
    for (let index = 0; index < sold; index += 1) { proceeds += preparedFoodValue(recipeId, state.commodityMarket, stock); stock += 1 }
    const inventory = { ...state.inventory, [food]: (state.inventory[food] ?? 0) - sold }
    set({ cash: state.cash + proceeds, inventory, hotbar: cleanedHotbar(state.hotbar, inventory), foodMarket: { ...state.foodMarket, [recipeId]: stock }, stats: { ...state.stats, sold: state.stats.sold + sold }, toast: `+${formatCoins(proceeds)}` })
  },
  applyPlayerTrade: (give, receive) => {
    if (consumeAuthoritativeAction('trade')) return true
    const state = get()
    if (state.minigameOpen) return false
    if (give.cash > state.cash) return false
    const giveEntries = Object.entries(give.items).filter(([id]) => id in ITEMS) as Array<[ItemId, number]>
    const receiveEntries = Object.entries(receive.items).filter(([id]) => id in ITEMS) as Array<[ItemId, number]>
    if (giveEntries.some(([id, quantity]) => isEnhanceableItem(id) || NON_TRADABLE_CONSUMABLES.has(id) || quantity < 0 || quantity > (state.inventory[id] ?? 0))) return false
    if (receiveEntries.some(([id, quantity]) => isEnhanceableItem(id) || NON_TRADABLE_CONSUMABLES.has(id) || quantity < 0)) return false
    const inventory = { ...state.inventory }
    giveEntries.forEach(([id, quantity]) => { inventory[id] = Math.max(0, (inventory[id] ?? 0) - Math.floor(quantity)) })
    let hotbar = cleanedHotbar(state.hotbar, inventory)
    receiveEntries.forEach(([id, quantity]) => {
      hotbar = hotbarWithNewItem(hotbar, inventory, id)
      inventory[id] = (inventory[id] ?? 0) + Math.max(0, Math.floor(quantity))
    })
    set({ cash: state.cash - give.cash + Math.max(0, receive.cash), inventory, hotbar, toast: 'Trade complete' })
    return true
  },
  mineRushNode: (id) => {
    const state = get()
    if (!state.minigameOpen || state.minigameKind !== 'mining' || !id.startsWith(`RushOre${state.eventBay}_`)) return
    const node = state.rushNodes[id] ?? { generation: 0, readyAt: 0 }
    if (node.readyAt > Date.now()) return
    sendMultiplayer('minigame:action', { milestone: state.minigameMilestone, kind: 'mining', action: 'mine', id })
    set((currentState) => {
      const currentNode = currentState.rushNodes[id] ?? { generation: 0, readyAt: 0 }
      if (!currentState.minigameOpen || currentState.minigameKind !== 'mining' || currentNode.readyAt > Date.now()) return currentState
      const kind = miningRushOre(currentState.minigameMilestone, id, currentNode.generation)
      const combo = Date.now() - currentState.rushLastMineAt <= 1800 ? currentState.rushCombo + 1 : 1
      const multiplier = 1 + Math.min(.3, Math.floor(combo / 5) * .05)
      const score = currentState.rushScore + Math.round(MINING_RUSH_POINTS[kind] * multiplier)
      return {
        rushScore: score,
        rushCombo: combo,
        rushLastMineAt: Date.now(),
        rushInventory: { ...currentState.rushInventory, [kind]: currentState.rushInventory[kind] + 1 },
        rushNodes: { ...currentState.rushNodes, [id]: { generation: currentNode.generation + 1, readyAt: Date.now() + MINING_RUSH_RESPAWN_MS } },
        toast: `+1 ${ITEMS[kind].name}`,
      }
    })
  },
  setFarmRushTool: (farmRushTool) => set((state) => state.minigameOpen && state.minigameKind === 'farm' ? { farmRushTool } : state),
  farmRushAction: (id) => {
    const currentState = get()
    if (currentState.minigameOpen && currentState.minigameKind === 'farm' && id.startsWith(`FarmRushCell${currentState.eventBay}_`)) sendMultiplayer('minigame:action', { milestone: currentState.minigameMilestone, kind: 'farm', action: 'cell', id, tool: currentState.farmRushTool })
    set((state) => {
    if (!state.minigameOpen || state.minigameKind !== 'farm' || !id.startsWith(`FarmRushCell${state.eventBay}_`)) return state
    const current = state.farmRushCells[id] ?? { crop: null, stage: 'empty' as const, readyAt: 0 }
    const now = Date.now()
    const matured = current.stage === 'watered' && current.readyAt <= now
    if (matured || current.stage === 'ready') {
      if (!current.crop) return state
      return {
        farmRushCells: { ...state.farmRushCells, [id]: { crop: null, stage: 'empty', readyAt: 0 } },
        farmRushInventory: { ...state.farmRushInventory, [current.crop]: state.farmRushInventory[current.crop] + 1 },
        toast: `+1 ${CROP_CONFIG[current.crop].name}`,
      }
    }
    if (current.stage === 'empty') {
      if (state.farmRushTool === 'water') return { toast: 'Choose a seed' }
      return { farmRushCells: { ...state.farmRushCells, [id]: { crop: state.farmRushTool, stage: 'planted', readyAt: 0 } } }
    }
    if (current.stage === 'planted') {
      if (state.farmRushTool !== 'water') return { toast: 'Needs water' }
      return { farmRushCells: { ...state.farmRushCells, [id]: { ...current, stage: 'watered', readyAt: now + FARM_RUSH_GROWTH_MS[current.crop!] } } }
    }
    return { toast: `${Math.max(1, Math.ceil((current.readyAt - now) / 1000))}s` }
    })
  },
  tickFarmRush: () => set((state) => {
    if (!state.minigameOpen || state.minigameKind !== 'farm') return state
    const now = Date.now()
    let farmRushOrders = state.farmRushOrders.filter((ticket) => ticket.expiresAt > now)
    let farmRushIssued = state.farmRushIssued
    while (farmRushOrders.length < FARM_RUSH_MAX_ORDERS) {
      farmRushOrders = [...farmRushOrders, { orderIndex: farmRushIssued, expiresAt: now + FARM_RUSH_ORDER_LIFETIME_MS }]
      farmRushIssued += 1
    }
    return { farmRushOrders, farmRushIssued, farmRushNextOrderAt: now }
  }),
  farmRushCook: (recipeId) => {
    const currentState = get()
    if (currentState.minigameOpen && currentState.minigameKind === 'farm') {
      const orders = farmRushOrders(currentState.minigameMilestone)
      const now = Date.now()
      const ticket = currentState.farmRushOrders.find((candidate) => candidate.expiresAt > now && orders[candidate.orderIndex % orders.length].recipe === recipeId && !currentState.farmRushCooking.some((job) => job.orderIndex === candidate.orderIndex))
      if (ticket) sendMultiplayer('minigame:action', { milestone: currentState.minigameMilestone, kind: 'farm', action: 'cook', recipeId, orderIndex: ticket.orderIndex })
    }
    set((state) => {
    if (!state.minigameOpen || state.minigameKind !== 'farm') return state
    const pendingJobs = state.farmRushCooking.filter((job) => job.readyAt > Date.now())
    if (pendingJobs.length >= 3) return { toast: 'Furnace queue full' }
    const orders = farmRushOrders(state.minigameMilestone)
    const ticket = state.farmRushOrders.find((candidate) => {
      if (candidate.expiresAt <= Date.now()) return false
      const order = orders[candidate.orderIndex % orders.length]
      return order.recipe === recipeId
        && !state.farmRushCooking.some((job) => job.orderIndex === candidate.orderIndex)
        && Object.entries(order.ingredients).every(([item, quantity]) => state.farmRushInventory[item as FarmRushIngredient] >= Number(quantity))
    })
    if (!ticket) return { toast: state.farmRushOrders.some((candidate) => orders[candidate.orderIndex % orders.length].recipe === recipeId) ? 'Missing ingredients' : 'No matching order' }
    const order = orders[ticket.orderIndex % orders.length]
    const farmRushInventory = { ...state.farmRushInventory }
    Object.entries(order.ingredients).forEach(([item, quantity]) => { farmRushInventory[item as FarmRushIngredient] -= Number(quantity) })
    const previousReadyAt = pendingJobs.at(-1)?.readyAt ?? Date.now()
    const readyAt = Math.max(Date.now(), previousReadyAt) + order.cookSeconds * 1000
    return { farmRushInventory, farmRushCooking: [...state.farmRushCooking, { orderIndex: ticket.orderIndex, recipe: recipeId, readyAt }], toast: `${order.name} queued` }
    })
  },
  farmRushSubmit: (orderIndex) => {
    const currentState = get()
    if (currentState.minigameOpen && currentState.minigameKind === 'farm') sendMultiplayer('minigame:action', { milestone: currentState.minigameMilestone, kind: 'farm', action: 'submit', orderIndex })
    set((state) => {
    if (!state.minigameOpen || state.minigameKind !== 'farm') return state
    const ticket = state.farmRushOrders.find((candidate) => candidate.orderIndex === orderIndex)
    if (!ticket || ticket.expiresAt <= Date.now()) return { toast: 'Order expired' }
    const order = farmRushOrders(state.minigameMilestone)[orderIndex % farmRushOrders(state.minigameMilestone).length]
    const now = Date.now()
    const cookingIndex = state.farmRushCooking.findIndex((job) => job.recipe === order.recipe && job.readyAt <= now)
    if (cookingIndex < 0) return { toast: 'Dish not ready' }
    const timeMultiplier = 1 + .5 * Math.max(0, Math.min(1, (ticket.expiresAt - now) / FARM_RUSH_ORDER_LIFETIME_MS))
    const awarded = Math.round(order.points * timeMultiplier)
    const remaining = state.farmRushOrders.filter((candidate) => candidate.orderIndex !== orderIndex && candidate.expiresAt > now)
    let farmRushIssued = state.farmRushIssued
    while (remaining.length < FARM_RUSH_MAX_ORDERS) {
      remaining.push({ orderIndex: farmRushIssued, expiresAt: now + FARM_RUSH_ORDER_LIFETIME_MS })
      farmRushIssued += 1
    }
    const farmRushCooking = [...state.farmRushCooking]
    farmRushCooking.splice(cookingIndex, 1)
    return {
      farmRushCooking,
      farmRushOrders: remaining,
      farmRushIssued,
      farmRushScore: state.farmRushScore + awarded,
      toast: `+${awarded} · ${timeMultiplier.toFixed(2)}×`,
    }
    })
  },
  forageRushCollect: (id) => set((state) => {
    if (!state.minigameOpen || state.minigameKind !== 'forage' || (state.forageRushCollected[id] ?? 0) > Date.now()) return state
    const kind: ForageRushKind | null = id.startsWith('ForageRushApple') ? 'apple' : id.startsWith('ForageRushOrange') ? 'orange' : id.startsWith('ForageRushTruffle') ? 'truffle' : id.startsWith('ForageRushDiscovery') ? 'discovery' : null
    if (!kind) return state
    const amount = kind === 'apple' || kind === 'orange' ? fruitTreeCapacity(id.replace('ForageRush', 'Forage')) : 1
    const respawn = kind === 'apple' || kind === 'orange' ? FORAGE_RUSH_RESPAWN_MS.fruit : FORAGE_RUSH_RESPAWN_MS.rare
    return { forageRushCollected: { ...state.forageRushCollected, [id]: Date.now() + respawn }, forageRushInventory: { ...state.forageRushInventory, [kind]: state.forageRushInventory[kind] + amount } }
  }),
  awardForageRush: (id, readyAt) => set((state) => {
    if (!state.minigameOpen || state.minigameKind !== 'forage' || (state.forageRushCollected[id] ?? 0) > Date.now()) return state
    const kind: ForageRushKind | null = id.startsWith('ForageRushApple') ? 'apple' : id.startsWith('ForageRushOrange') ? 'orange' : id.startsWith('ForageRushTruffle') ? 'truffle' : id.startsWith('ForageRushDiscovery') ? 'discovery' : null
    if (!kind) return state
    const amount = kind === 'apple' || kind === 'orange' ? fruitTreeCapacity(id.replace('ForageRush', 'Forage')) : 1
    return {
      forageRushCollected: { ...state.forageRushCollected, [id]: Math.max(Date.now(), Number(readyAt) || 0) },
      forageRushInventory: { ...state.forageRushInventory, [kind]: state.forageRushInventory[kind] + amount },
    }
  }),
  syncForageRush: (id, readyAt) => set((state) => state.minigameOpen && state.minigameKind === 'forage' ? { forageRushCollected: { ...state.forageRushCollected, [id]: Math.max(state.forageRushCollected[id] ?? 0, readyAt) } } : state),
  syncForageRushRares: (ids) => set((state) => state.minigameOpen && state.minigameKind === 'forage'
    ? { forageRushRareSnapshot: [...new Set(ids.filter((id) => id.startsWith('ForageRushTruffle') || id.startsWith('ForageRushDiscovery')))].sort() }
    : state),
  forageRushDeliver: (kind) => {
    const currentState = get()
    if (currentState.minigameOpen && currentState.minigameKind === 'forage' && !currentState.forageRushDelivered[kind]) sendMultiplayer('minigame:action', { milestone: currentState.minigameMilestone, kind: 'forage', action: 'deliver', tool: kind })
    set((state) => {
    if (!state.minigameOpen || state.minigameKind !== 'forage' || state.forageRushDelivered[kind]) return state
    const required = FORAGE_RUSH_REQUIREMENTS[kind]
    const current = state.forageRushProgress[kind]
    const deposited = Math.min(state.forageRushInventory[kind], required - current)
    if (deposited <= 0) return { toast: `${current}/${required}` }
    const progress = current + deposited
    const previousPoints = Math.round(FORAGE_RUSH_DELIVERY_POINTS[kind] * current / required)
    const nextPoints = Math.round(FORAGE_RUSH_DELIVERY_POINTS[kind] * progress / required)
    return {
      forageRushInventory: { ...state.forageRushInventory, [kind]: state.forageRushInventory[kind] - deposited },
      forageRushProgress: { ...state.forageRushProgress, [kind]: progress },
      forageRushDelivered: { ...state.forageRushDelivered, [kind]: progress >= required },
      forageRushScore: state.forageRushScore + nextPoints - previousPoints,
      toast: `${progress}/${required}`,
    }
    })
  },
  finishMinigame: (score, placement = 1, suppliedReference, settledReward) => set((state) => {
    const pendingSettlementId = settledReward?.settlementId
    const authoritativeSettlement = pendingSettlementId ? consumeAuthoritativeAction('minigame', pendingSettlementId) : false
    const effectiveSettledReward = authoritativeSettlement && settledReward ? { ...settledReward, cash: 0, itemRolls: [] } : settledReward
    const snapshot = state.minigameSnapshot
    if ((!state.minigameOpen || !snapshot) && !pendingSettlementId) return state
    if ((!state.minigameOpen || !snapshot) && pendingSettlementId) {
      if (state.appliedMinigameSettlementIds.includes(pendingSettlementId)) return state
      const itemRolls = effectiveSettledReward?.itemRolls ?? []
      const applied = applyMinigameItemRewards(state.inventory as Partial<Record<MinigameRewardItemId, number>>, state.appliedMinigameRewardIds, itemRolls)
      const inventory = applied.inventory as Partial<Record<ItemId, number>>
      const itemSummary: Partial<Record<MinigameRewardItemId, number>> = {}
      itemRolls.filter((roll) => applied.newlyAppliedRewardIds.includes(roll.rewardId)).forEach((roll) => roll.items.forEach(({ itemId, quantity }) => { itemSummary[itemId] = (itemSummary[itemId] ?? 0) + quantity }))
      return {
        inventory,
        hotbar: hotbarWithInventoryDelta(state.hotbar, state.inventory, inventory),
        cash: state.cash + Math.max(0, Math.floor(effectiveSettledReward?.cash ?? 0)),
        appliedMinigameRewardIds: applied.appliedRewardIds,
        appliedMinigameSettlementIds: [...state.appliedMinigameSettlementIds, pendingSettlementId],
        lastMinigameResult: { kind: settledReward?.kind ?? state.minigameKind, placement, score, cash: authoritativeSettlement ? Math.max(0, Math.floor(settledReward?.cash ?? 0)) : Math.max(0, Math.floor(effectiveSettledReward?.cash ?? 0)), items: itemSummary, standings: settledReward?.standings ?? [{ placement, nickname: state.nickname, score }], receivedAt: Date.now() },
      }
    }
    const milestone = state.minigameMilestone
    if (!snapshot) return state
    const pausedMs = Math.max(0, Date.now() - snapshot.startedAt)
    const ownedValue = (Object.keys(state.inventory) as ItemId[]).reduce((sum, id) => sum + (ITEMS[id].buyPrice ?? 0) * (state.inventory[id] ?? 0), 0)
    const stockBasis = stockIds.reduce((sum, id) => sum + STOCKS[id].basePrice * (state.portfolio[id] ?? 0), 0)
    const plantedValue = Object.values(state.farmCells).reduce((sum, cell) => sum + (cell.crop ? CROP_CONFIG[cell.crop].seedPrice : 0), 0)
    const economyReference = Math.max(1, suppliedReference ?? state.cash + ownedValue + stockBasis + plantedValue)
    const playerProgress = economyProgressValue(state)
    const leaderProgress = Math.max(playerProgress, ...state.onlinePlayers.map((player) => player.progressValue ?? player.cash))
    const computedReward = minigameRewards({ economyReference, placement, playerProgress, leaderProgress, matchSeed: state.sessionSeed, milestone, playerId: state.nickname })
    const settlementId = settledReward?.settlementId ?? `local:${state.sessionSeed}:${milestone}`
    const alreadySettled = state.appliedMinigameSettlementIds.includes(settlementId)
    const reward = alreadySettled || authoritativeSettlement ? 0 : effectiveSettledReward ? Math.max(0, Math.floor(effectiveSettledReward.cash)) : computedReward.cash
    const itemRolls = effectiveSettledReward?.itemRolls ?? computedReward.itemRolls
    const applied = applyMinigameItemRewards(state.inventory as Partial<Record<MinigameRewardItemId, number>>, state.appliedMinigameRewardIds, itemRolls)
    const inventory = applied.inventory as Partial<Record<ItemId, number>>
    const itemSummary: Partial<Record<MinigameRewardItemId, number>> = {}
    itemRolls.filter((roll) => applied.newlyAppliedRewardIds.includes(roll.rewardId)).forEach((roll) => roll.items.forEach(({ itemId, quantity }) => { itemSummary[itemId] = (itemSummary[itemId] ?? 0) + quantity }))
    const shiftReady = (value: number) => value > snapshot.startedAt ? value + pausedMs : value
    return {
      minigameOpen: false,
      minigameActive: false,
      minigameSnapshot: null,
      enhancementOpen: false,
      menuOpen: false,
      playerPanelOpen: false,
      cookbookOpen: false,
      shopOpen: false,
      stockOpen: false,
      inventoryOpen: snapshot.inventoryOpen,
      eventBay: 0,
      rushNodes: {}, rushInventory: emptyRushInventory(), rushScore: 0, rushCombo: 0, rushLastMineAt: 0,
      farmRushCells: {}, farmRushInventory: freshFarmRushInventory(), farmRushOrders: [], farmRushIssued: 0, farmRushNextOrderAt: 0, farmRushCooking: [], farmRushScore: 0,
      forageRushCollected: {}, forageRushRareSnapshot: null, forageRushInventory: { apple: 0, orange: 0, truffle: 0, discovery: 0 }, forageRushProgress: emptyForageProgress(), forageRushDelivered: { apple: false, orange: false, truffle: false, discovery: false }, forageRushScore: 0,
      minigamesCompleted: state.minigamesCompleted.includes(milestone) ? state.minigamesCompleted : [...state.minigamesCompleted, milestone],
      zone: snapshot.zone,
      teleportNonce: state.teleportNonce + 1,
      anchors: {}, colliders: [], playerPosition: snapshot.playerPosition,
      inventory,
      hotbar: hotbarWithInventoryDelta(snapshot.hotbar, state.inventory, inventory), selectedHotbar: snapshot.selectedHotbar,
      cash: state.cash + reward,
      appliedMinigameRewardIds: applied.appliedRewardIds,
      appliedMinigameSettlementIds: alreadySettled ? state.appliedMinigameSettlementIds : [...state.appliedMinigameSettlementIds, settlementId],
      lastMinigameResult: placement > 0 ? { kind: settledReward?.kind ?? state.minigameKind, placement, score, cash: authoritativeSettlement ? Math.max(0, Math.floor(settledReward?.cash ?? 0)) : reward, items: itemSummary, standings: settledReward?.standings ?? [{ placement, nickname: state.nickname, score }], receivedAt: Date.now() } : state.lastMinigameResult,
      farmCells: Object.fromEntries(Object.entries(state.farmCells).map(([key, cell]) => [key, cell.readyAt ? { ...cell, readyAt: shiftReady(cell.readyAt) } : cell])),
      cookQueue: state.cookQueue.map((job) => ({ ...job, readyAt: shiftReady(job.readyAt) })),
      collectedForage: Object.fromEntries(Object.entries(state.collectedForage).map(([id, readyAt]) => [id, shiftReady(readyAt)])),
      minedNodes: Object.fromEntries(Object.entries(state.minedNodes).map(([id, readyAt]) => [id, shiftReady(readyAt)])),
      miningBoostUntil: state.miningBoostUntil > snapshot.startedAt ? state.miningBoostUntil + pausedMs : state.miningBoostUntil,
      toast: placement < 1 ? 'Event left' : `${placement === 1 ? '1st' : placement === 2 ? '2nd' : placement === 3 ? '3rd' : `${placement}th`} · +${formatCoins(reward)}`,
    }
  }),
  clearMinigameResult: () => set({ lastMinigameResult: null }),
  setMinigameActive: (active) => set((state) => state.minigameOpen ? { minigameActive: active } : state),
  setEventBay: (bay) => set((state) => {
    const eventBay = Math.max(0, Math.min(7, Math.floor(bay)))
    if (eventBay === state.eventBay) return state
    return { eventBay, teleportNonce: state.minigameOpen ? state.teleportNonce + 1 : state.teleportNonce, prompt: null, interactionProgress: 0 }
  }),
  tickGame: () => set((state) => {
    if (state.tutorialActive) {
      const now = Date.now()
      const farmCells = Object.fromEntries(Object.entries(state.farmCells).map(([key, cell]) => [key, cell.stage === 'watered' && (cell.readyAt ?? Infinity) <= now ? { ...cell, stage: 'ready' as const } : cell]))
      return { farmCells }
    }
    if (!state.sessionStarted || state.sessionComplete || state.minigameOpen) return state
    const elapsedBeforeTick = (state.roundNumber - 1) * MATCH_CONFIG.worldCycleSeconds + (MATCH_CONFIG.worldCycleSeconds - state.roundSeconds)
    const dueMinigame = minigameMilestones(state.sessionDurationSeconds).find((milestone) => elapsedBeforeTick >= milestone && !state.minigamesCompleted.includes(milestone))
    if (dueMinigame) return {
      ...state,
      minigameOpen: true,
      minigameActive: false,
      minigameMilestone: dueMinigame,
      minigameKind: scheduledMinigame(dueMinigame, state.sessionSeed, state.sessionDurationSeconds),
      eventBay: 0,
      minigameSnapshot: { zone: state.zone, playerPosition: state.playerPosition, hotbar: [...state.hotbar], selectedHotbar: state.selectedHotbar, inventoryOpen: state.inventoryOpen, startedAt: Date.now() },
      rushNodes: {}, rushInventory: emptyRushInventory(), rushScore: 0, rushCombo: 0, rushLastMineAt: 0,
      farmRushCells: {}, farmRushTool: 'wheat', farmRushInventory: freshFarmRushInventory(), farmRushOrders: [], farmRushIssued: 0, farmRushNextOrderAt: 0, farmRushCooking: [], farmRushScore: 0,
      forageRushCollected: {}, forageRushRareSnapshot: null, forageRushInventory: { apple: 0, orange: 0, truffle: 0, discovery: 0 }, forageRushProgress: emptyForageProgress(), forageRushDelivered: { apple: false, orange: false, truffle: false, discovery: false }, forageRushScore: 0,
      zone: 'hub',
      teleportNonce: state.teleportNonce + 1,
      anchors: {}, colliders: [], playerPosition: SPAWNS.hub, prompt: null, interactionProgress: 0,
      shopOpen: false, stockOpen: false, inventoryOpen: false, menuOpen: false, playerPanelOpen: false, pendingTradeRequest: null,
      lotteryOpen: false, ticketInspectOpen: false, travelOpen: false, secretOpen: false, cookbookOpen: false, enhancementOpen: false, itemUseOpen: null,
    }
    const completing = elapsedBeforeTick + 1 >= state.sessionDurationSeconds
    const restockSeconds = state.restockSeconds <= 1 ? MATCH_CONFIG.worldCycleSeconds : state.restockSeconds - 1
    const roundSeconds = completing ? 0 : state.roundSeconds <= 1 ? MATCH_CONFIG.worldCycleSeconds : state.roundSeconds - 1
    const newRound = state.roundSeconds <= 1
    const roundNumber = completing ? state.roundNumber : newRound ? state.roundNumber + 1 : state.roundNumber
    let cash = state.cash
    let lotteryTickets = state.lotteryTickets
    const inventory = { ...state.inventory }
    let hotbar = state.hotbar
    let lotteryToast: string | null = null
    if (newRound) {
      const draw = lotteryDraw(state.roundNumber)
      let payout = 0
      const expiredTickets = state.lotteryTickets.filter((ticket) => ticket.drawRound === state.roundNumber)
      expiredTickets.forEach((ticket) => {
        const matches = ticket.numbers.filter((number) => draw.includes(number)).length
        const ticketPayout = (matches === 3 ? lotteryJackpot(ticket.drawRound) : matches === 2 ? lotteryTwoMatch(ticket.drawRound) : 0) * (ticket.tier ?? 1)
        payout += ticketPayout
      })
      lotteryTickets = state.lotteryTickets.filter((ticket) => ticket.drawRound !== state.roundNumber)
      inventory['lottery-ticket'] = Math.max(0, (inventory['lottery-ticket'] ?? 0) - expiredTickets.length)
      hotbar = cleanedHotbar(hotbar, inventory)
      cash += payout
      lotteryToast = payout > 0 ? `Draw ${draw.join(' · ')}  +${formatCoins(payout)}` : `Draw ${draw.join(' · ')}`
    }
    const weatherChanged = state.weatherSeconds <= 1
    const weatherOrder: WeatherKind[] = ['rain', 'mist', 'clear', 'sunny', 'breeze']
    const weatherIndex = Math.max(0, weatherOrder.indexOf(state.weather))
    const weather: WeatherKind = weatherChanged ? weatherOrder[(weatherIndex + 1) % weatherOrder.length] : state.weather
    const weatherSeconds = weatherChanged ? (weather === 'rain' ? 55 : weather === 'mist' ? 60 : weather === 'sunny' ? 75 : weather === 'breeze' ? 70 : 90) : state.weatherSeconds - 1
    if (weatherChanged && weather === 'rain' && state.sharedFarmOnline && !state.sharedMarketOnline) sendMultiplayer('farm:rain', {})
    const farmCells = Object.fromEntries(Object.entries(state.farmCells).map(([index, cell]) => {
      if (weatherChanged && weather === 'rain' && cell.stage === 'planted') {
        const crop = cell.crop ?? 'tomato'
        return [index, { ...cell, stage: 'watered' as const, readyAt: Date.now() + GROWTH_MS[crop] }]
      }
      if (weatherChanged && weather === 'sunny' && cell.stage === 'watered' && cell.readyAt) {
        return [index, { ...cell, readyAt: Date.now() + Math.round((cell.readyAt - Date.now()) * .85) }]
      }
      return [index, cell.stage === 'watered' && (cell.readyAt ?? Infinity) <= Date.now() ? { ...cell, stage: 'ready' as const } : cell]
    }))
    let commodityPending = state.commodityPending
    let commodityMarket = state.commodityMarket
    if (newRound && !state.sharedMarketOnline) {
      const settledMarket = { ...state.commodityMarket }
      ;(Object.keys(COMMODITY_MARKET_CONFIG) as CommodityId[]).forEach((id) => { settledMarket[id] += state.commodityPending[id] ?? 0 })
      commodityMarket = advanceCommodityCycle(settledMarket, roundNumber, weather, state.sessionSeed)
      commodityPending = {}
    }
    const marketRates = state.marketRates
    const elapsedSeconds = (roundNumber - 1) * MATCH_CONFIG.worldCycleSeconds + (MATCH_CONFIG.worldCycleSeconds - roundSeconds)
    const updateStocks = !state.sharedMarketOnline && elapsedSeconds > 0 && elapsedSeconds % MATCH_CONFIG.stockUpdateSeconds === 0
    const releaseStock = updateStocks
    const stockPrices = { ...state.stockPrices }
    const stockHistory = { ...state.stockHistory }
    const stockSupply = { ...state.stockSupply }
    if (updateStocks) stockIds.forEach((id, index) => {
      if (!stockAvailable(STOCKS[id], elapsedSeconds)) return
      const history = state.stockHistory[id]
      const previous = history.at(-1) ?? STOCKS[id].basePrice
      const next = nextStockPrice(STOCKS[id], previous, Math.floor(elapsedSeconds / MATCH_CONFIG.stockUpdateSeconds), index, state.sessionSeed)
      stockPrices[id] = next
      stockHistory[id] = [...history, next].slice(-5)
    })
    if (releaseStock) stockIds.forEach((id) => {
      const stock = STOCKS[id]
      const elapsedMinutes = elapsedSeconds / 60
      if (stockAvailable(stock, elapsedSeconds)) stockSupply[id] += stockWaveQuantity(stock, elapsedMinutes)
    })
    let marketCorrectionsApplied = state.marketCorrectionsApplied
    let marketCorrectionName = state.marketCorrectionName
    let marketCorrectionSeconds = Math.max(0, state.marketCorrectionSeconds - 1)
    const commodityPriceHistory = { ...state.commodityPriceHistory }
    const dueCorrection = state.sharedMarketOnline ? undefined : marketCorrectionMilestones(state.sessionDurationSeconds).find((milestone) => elapsedSeconds >= milestone && !state.marketCorrectionsApplied.includes(milestone))
    if (dueCorrection) {
      const correction = marketCorrectionFor(state.sessionSeed, state.marketCorrectionsApplied.length + 1)
      marketCorrectionsApplied = [...state.marketCorrectionsApplied, dueCorrection]
      marketCorrectionName = correction.headline
      marketCorrectionSeconds = 10
      stockIds.forEach((id) => {
        const multiplier = correction.stocks[id] ?? 1
        if (multiplier === 1) return
        const next = Math.max(Math.round(STOCKS[id].basePrice * .15), Math.min(Math.round(STOCKS[id].basePrice * 12), Math.round(stockPrices[id] * multiplier)))
        stockPrices[id] = next
        stockHistory[id] = [...stockHistory[id], next].slice(-5)
      })
      if (!newRound && !correction.resetCommodities) {
        commodityMarket = { ...commodityMarket }
        ;(Object.keys(COMMODITY_MARKET_CONFIG) as CommodityId[]).forEach((id) => { commodityMarket[id] += commodityPending[id] ?? 0 })
      }
      commodityPending = {}
      commodityMarket = correction.resetCommodities ? initialCommodityMarket() : { ...commodityMarket }
      ;(Object.entries(correction.commodities) as Array<[CommodityId, number]>).forEach(([id, multiplier]) => {
        commodityMarket[id] = Math.max(1, Math.round(commodityMarket[id] * multiplier))
      })
    }
    if (!state.sharedMarketOnline && (newRound || dueCorrection)) {
      const prices = commodityPriceSnapshot(commodityMarket)
      ;(Object.keys(COMMODITY_MARKET_CONFIG) as CommodityId[]).forEach((id) => {
        commodityPriceHistory[id] = [...(state.commodityPriceHistory[id] ?? []), prices[id]].slice(-5)
      })
    }
    let collectedForage = Object.fromEntries(Object.entries(state.collectedForage).filter(([, readyAt]) => readyAt > Date.now()))
    if (weatherChanged && weather === 'sunny') collectedForage = Object.fromEntries(Object.entries(collectedForage).map(([id, readyAt]) => [id, Date.now() + Math.round((readyAt - Date.now()) * .85)]))
    const minedNodes = state.minedNodes
    let cookQueue = state.cookQueue
    if (weatherChanged && weather === 'breeze') cookQueue = cookQueue.map((job) => job.readyAt <= Date.now() ? job : { ...job, readyAt: Date.now() + Math.round((job.readyAt - Date.now()) * .9) })
    const foodMarket = { ...state.foodMarket }
    if (newRound && !state.sharedMarketOnline) RECIPE_IDS.forEach((id, index) => {
      const recipe = RECIPES[id]
      const demandBase = recipe.group === 'early' ? 8 : recipe.group === 'middle' ? 4 : 2
      const demand = Math.max(1, demandBase + ((roundNumber + index * 3) % 3) - 1)
      foodMarket[id] = Math.max(1, foodMarket[id] - demand)
    })
    const foodPriceHistory = { ...state.foodPriceHistory }
    if (!state.sharedMarketOnline && (newRound || dueCorrection)) RECIPE_IDS.forEach((id) => {
      const price = preparedFoodValue(id, commodityMarket, foodMarket[id])
      foodPriceHistory[id] = [...(foodPriceHistory[id] ?? []), price].slice(-5)
    })
    const furnaceReadyUntil = { ...state.furnaceReadyUntil }
    state.cookQueue.forEach((job) => {
      if (job.readyAt <= Date.now()) furnaceReadyUntil[job.furnaceIndex] = Number.MAX_SAFE_INTEGER
    })
    return {
      restockSeconds,
      roundSeconds,
      roundNumber,
      sessionComplete: completing,
      cash,
      lotteryTickets,
      farmCells,
      weather,
      weatherSeconds,
      marketRates,
      commodityMarket,
      commodityPending,
      commodityPriceHistory,
      commodityCycle: newRound && !state.sharedMarketOnline ? state.commodityCycle + 1 : state.commodityCycle,
      stockPrices,
      stockHistory,
      stockSupply,
      collectedForage,
      minedNodes,
      inventory,
      hotbar,
      cookQueue,
      furnaceReadyUntil,
      foodMarket,
      foodPriceHistory,
      marketCorrectionsApplied,
      marketCorrectionName,
      marketCorrectionSeconds,
      shopStock: state.restockSeconds <= 1 ? { ...initialShopStock } : state.shopStock,
      toast: lotteryToast ?? (newRound ? `Round ${roundNumber}` : weatherChanged ? weather[0].toUpperCase() + weather.slice(1) : state.toast),
    }
  }),
}))

let authoritativeRoomKey: number | null = null
let authoritativeRevision = -1
let recentAuthoritativeAction: { action: AuthoritativeAccountAction; receivedAt: number } | null = null

const boundedAccountNumber = (value: unknown, maximum = 1_000_000) => Number.isSafeInteger(value) ? Math.max(0, Math.min(maximum, Number(value))) : 0

function consumeAuthoritativeAction(type: AuthoritativeAccountAction['type'], key?: string) {
  const marker = recentAuthoritativeAction
  if (!marker || Date.now() - marker.receivedAt > 15_000 || marker.action.type !== type || !marker.action.ok || key !== undefined && marker.action.key !== key) return false
  recentAuthoritativeAction = null
  return true
}

onAuthoritativeAccount((account) => {
  if (useGameStore.getState().tutorialActive) return
  if (!account || typeof account !== 'object' || typeof account.profileId !== 'string') return
  if (!Number.isSafeInteger(account.roomKey) || !Number.isSafeInteger(account.revision) || !Number.isFinite(account.cash)) return
  if (authoritativeRoomKey !== account.roomKey) authoritativeRevision = -1
  if (account.revision < authoritativeRevision) return
  const action = account.action
  if (action && typeof action === 'object' && typeof action.type === 'string') recentAuthoritativeAction = { action, receivedAt: Date.now() }
  authoritativeRoomKey = account.roomKey
  authoritativeRevision = account.revision
  const inventory = Object.fromEntries(Object.entries(account.inventory ?? {}).filter(([id, quantity]) => Object.prototype.hasOwnProperty.call(ITEMS, id) && id !== 'gold-coins' && boundedAccountNumber(quantity) > 0).map(([id, quantity]) => [id, boundedAccountNumber(quantity)])) as Partial<Record<ItemId, number>>
  const sharedDeeds = inventory['shared-farm-deed'] ?? 0
  if (sharedDeeds > 0) {
    inventory['farm-deed'] = (inventory['farm-deed'] ?? 0) + sharedDeeds
    delete inventory['shared-farm-deed']
  }
  const portfolio = Object.fromEntries(Object.entries(account.portfolio ?? {}).filter(([id, quantity]) => Object.prototype.hasOwnProperty.call(STOCKS, id) && boundedAccountNumber(quantity) > 0).map(([id, quantity]) => [id, boundedAccountNumber(quantity)])) as Partial<Record<StockId, number>>
  const stats: Stats = {
    foraged: boundedAccountNumber(account.stats?.foraged),
    mined: boundedAccountNumber(account.stats?.mined),
    harvested: boundedAccountNumber(account.stats?.harvested),
    sold: boundedAccountNumber(account.stats?.sold),
  }
  const ownedFarms = [...new Set((account.ownedFarms ?? []).filter((farmId) => Number.isSafeInteger(farmId) && farmId >= 0 && farmId < 8).map((farmId) => Math.floor(farmId)))].sort((a, b) => a - b)
  const shopAction = action?.type === 'shop' && action.requestId ? action : null
  const cookAction = action?.type === 'cook' && action.requestId ? action : null
  const cookQueue = (account.cookQueue ?? []).filter((job): job is AuthoritativeAccountSnapshot['cookQueue'][number] =>
    Boolean(job) && typeof job.id === 'string' && RECIPE_IDS.includes(job.recipe as RecipeId) && Number.isSafeInteger(job.quantity) && job.quantity > 0 && Number.isSafeInteger(job.furnaceIndex) && job.furnaceIndex >= 0 && job.furnaceIndex < 8 && Number.isFinite(job.readyAt),
  ).map((job) => ({ ...job, recipe: job.recipe as RecipeId }))
  if (shopAction) pendingShopPurchases.delete(shopAction.requestId!)
  if (cookAction) pendingCookActions.delete(cookAction.requestId!)
  const preferredItem = (cookAction?.ok && cookAction.itemId && Object.prototype.hasOwnProperty.call(ITEMS, cookAction.itemId)
    ? cookAction.itemId
    : shopAction?.ok && shopAction.itemId && Object.prototype.hasOwnProperty.call(ITEMS, shopAction.itemId)
      ? shopAction.itemId
      : undefined) as ItemId | undefined
  useGameStore.setState((state) => ({
    cash: boundedAccountNumber(account.cash, 5_000_000_000),
    inventory,
    portfolio,
    claimedFarms: ownedFarms,
    cookQueue,
    stats,
    personalDeedAvailable: !Boolean(account.personalDeedOwned),
    deedPurchasePending: action?.type === 'deed' && action.requestId ? false : state.deedPurchasePending,
    hotbar: hotbarWithInventoryDelta(state.hotbar, state.inventory, inventory, preferredItem),
    toast: cookAction
      ? cookAction.ok
        ? cookAction.itemId ? `+${cookAction.quantity ?? 0} ${ITEMS[cookAction.itemId as ItemId]?.name ?? 'dish'}` : `${cookAction.quantity ?? 0} queued`
        : cookAction.reason || 'Furnace unavailable'
      : shopAction ? (shopAction.ok ? `+${shopAction.quantity ?? 0} ${shopAction.itemId ? ITEMS[shopAction.itemId as ItemId]?.name ?? shopAction.itemId : 'item'}` : shopAction.reason || 'Purchase failed') : state.toast,
  }))
})

const durableSaveKeys = [
  'sessionSeed', 'matchStartedAt', 'cash', 'restockSeconds', 'roundSeconds', 'inventory', 'hotbar', 'farmCells',
  'claimedFarms', 'portfolio', 'roundNumber', 'stats', 'lotteryTickets', 'secretClaimedRound', 'knownRecipes',
  'recipeCards', 'cookQueue', 'foodMarket', 'foodPriceHistory', 'commodityMarket', 'commodityPending', 'commodityPriceHistory', 'commodityCycle', 'shopStock',
  'stockPrices', 'stockHistory', 'stockSupply', 'marketCorrectionsApplied', 'enhancements', 'miningBoostUntil',
  'fortuneBoostCharges', 'appliedMinigameRewardIds', 'appliedMinigameSettlementIds', 'minigamesCompleted', 'sessionComplete',
] as const satisfies ReadonlyArray<keyof ReturnType<typeof useGameStore.getState>>

function saveDurableState(state: ReturnType<typeof useGameStore.getState>) {
  localStorage.setItem('project01-save-v12', JSON.stringify({
    sessionSeed: state.sessionSeed,
    matchStartedAt: state.matchStartedAt,
    cash: state.cash,
    restockSeconds: state.restockSeconds,
    roundSeconds: state.roundSeconds,
    inventory: state.inventory,
    hotbar: state.hotbar,
    farmCells: state.farmCells,
    claimedFarms: state.claimedFarms,
    portfolio: state.portfolio,
    roundNumber: state.roundNumber,
    stats: state.stats,
    lotteryTickets: state.lotteryTickets,
    secretClaimedRound: state.secretClaimedRound,
    knownRecipes: state.knownRecipes,
    recipeCards: state.recipeCards,
    cookQueue: state.cookQueue,
    foodMarket: state.foodMarket,
    foodPriceHistory: state.foodPriceHistory,
    commodityMarket: state.commodityMarket,
    commodityPending: state.commodityPending,
    commodityPriceHistory: state.commodityPriceHistory,
    commodityCycle: state.commodityCycle,
    shopStock: state.shopStock,
    stockPrices: state.stockPrices,
    stockHistory: state.stockHistory,
    stockSupply: state.stockSupply,
    marketCorrectionsApplied: state.marketCorrectionsApplied,
    enhancements: state.enhancements,
    miningBoostUntil: state.miningBoostUntil,
    fortuneBoostCharges: state.fortuneBoostCharges,
    appliedMinigameRewardIds: state.appliedMinigameRewardIds,
    appliedMinigameSettlementIds: state.appliedMinigameSettlementIds,
    minigamesCompleted: state.minigamesCompleted,
    sessionComplete: state.sessionComplete,
  }))
}

useGameStore.subscribe((state, previous) => {
  if (balanceRound) return
  if (state.tutorialActive || previous.tutorialActive) return
  if (!durableSaveKeys.some((key) => state[key] !== previous[key])) return
  saveDurableState(state)
})

if (query.get('qa') === '1') {
  ;(window as Window & { __PROJECT01_STORE__?: typeof useGameStore }).__PROJECT01_STORE__ = useGameStore
}
