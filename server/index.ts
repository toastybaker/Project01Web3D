import { Room, Server, type Client } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { FARM_RUSH_CROPS, FARM_RUSH_GROWTH_MS, FARM_RUSH_MAX_ORDERS, FARM_RUSH_ORDER_LIFETIME_MS, FORAGE_RUSH_COMPLETION_BONUS, FORAGE_RUSH_DELIVERY_POINTS, FORAGE_RUSH_REQUIREMENTS, FORAGE_RUSH_RESPAWN_MS, MINING_RUSH_POINTS, MINING_RUSH_RESPAWN_MS, farmRushOrders, farmRushRecipe, minigameMilestones, minigameRewards, miningRushOre, scheduledMinigame, type FarmRushCrop, type FarmRushIngredient, type ForageRushKind } from '../src/game/minigame'
import { consumeMerchantStock, currentMerchantCycle, type MerchantCycle, type MerchantItemId } from '../src/game/merchant'
import { BASKET_CONFIG, COMMODITY_MARKET_CONFIG, CROP_CONFIG, MATCH_CONFIG, activeRareForageIds, fruitTreeCapacity, nextRareForageRollAt, type CommodityId } from '../src/game/config'
import { canMineOre, miningYield, oreKindAtDepth, oreRespawnMs, type PickaxeItem } from '../src/game/ore'
import { MINE_NODE_BY_ID, MINE_NODE_SITES } from '../shared/mine-nodes.js'
import { initialCommodityMarket, settleCommoditySale, stockAvailable, type CommodityMarket } from '../src/game/economy'
import { ITEMS, SHOPS, STOCKS, type ItemId, type ShopKind, type StockId } from '../src/game/items'
import { RECIPE_IDS, RECIPES, type RecipeId } from '../src/game/recipes'
import { STOCK_IDS, advanceMarketCycle, commodityPriceSnapshot, createInitialCommodityHistory, createInitialFoodHistory, createInitialFoodMarket, createInitialStockHistory, createInitialStockPrices, createInitialStockSupply, dueMarketCorrections, marketCorrectionFor, preparedFoodValue, weatherAtElapsed, type SharedMarketSnapshot, type WeatherKind } from '../src/game/market'

type ZoneId = 'hub' | 'forage' | 'farm' | 'mine'
type MinigameKind = 'mining' | 'farm' | 'forage'
type PublicStats = { foraged: number; mined: number; harvested: number; sold: number }
type Presence = { id: string; nickname: string; zone: ZoneId; position: [number, number, number]; yaw?: number; animation?: string; heldItem?: ItemId | null; cash: number; progressValue?: number; stats: PublicStats; seenAt: number; minigameOpen?: boolean; minigameKind?: MinigameKind; minigameMilestone?: number; minigameScore?: number; eventBay?: number }
type TradeOffer = { cash: number; items: Record<string, number> }
type TradeSession = { id: string; a: string; b: string; offers: Record<string, TradeOffer>; ready: Record<string, boolean> }
type MinigameStanding = { placement: number; nickname: string; score: number }
type MinigameResult = { score: number; progressValue: number; nickname: string }
type EventReadyGate = { participants: Set<string>; ready: Set<string>; gameplayAt: number | null; timeout: ReturnType<typeof setTimeout> }
type EventRareKind = 'truffle' | 'discovery'
type EventForageRareState = { active: Set<string>; generations: Record<EventRareKind, number>; pending: Record<EventRareKind, number>; timers: Set<ReturnType<typeof setTimeout>> }
type SharedOreNode = { generation: number; readyAt: number }
type ForageItem = 'apple' | 'orange' | 'truffle' | 'natural-discovery'
type ForageNodeDefinition = { id: string; item: ForageItem; capacity: number; x: number; z: number; rare?: boolean }
type SharedForageNode = ForageNodeDefinition & { fullAt: number; rareAvailable?: boolean }
type CropKind = keyof typeof CROP_CONFIG
type SharedFarmCell = { crop: CropKind | null; stage: 'empty' | 'planted' | 'watered' | 'ready'; readyAt: number | null }
type SharedFarm = { ownerId: string | null; cells: Map<number, SharedFarmCell> }
type AccountAction = { type: 'shop' | 'mine' | 'forage' | 'market' | 'deed' | 'farm' | 'cook' | 'merchant' | 'trade' | 'minigame'; requestId?: string; key?: string; ok: boolean; reason?: string; itemId?: string; stockId?: string; direction?: 'buy' | 'sell'; quantity?: number; total?: number }
type ServerCookJob = { id: string; recipe: RecipeId; quantity: number; furnaceIndex: number; readyAt: number }
type AccountPayload = { profileId: string; roomKey: number; revision: number; cash: number; inventory: Partial<Record<ItemId, number>>; portfolio: Partial<Record<StockId, number>>; personalDeedOwned: boolean; deedEntitlement: number; ownedFarms: number[]; cookQueue: ServerCookJob[]; stats: PublicStats; action?: AccountAction }
type PlayerAccount = { profileId: string; roomKey: number; revision: number; cash: number; inventory: Partial<Record<ItemId, number>>; portfolio: Partial<Record<StockId, number>>; personalDeedOwned: boolean; deedEntitlement: number; ownedFarms: Set<number>; cookQueue: ServerCookJob[]; stats: PublicStats; activeSessionId: string | null; lastSeenAt: number; appliedRewardKeys: Set<string> }
type RushMiningNode = { generation: number; readyAt: number }
type RushFarmCell = { crop: FarmRushCrop | null; stage: 'empty' | 'planted' | 'watered'; readyAt: number }
type RushFarmJob = { orderIndex: number; recipe: RecipeId; readyAt: number }
type RushEventScore = {
  profileId: string
  milestone: number
  kind: MinigameKind
  score: number
  miningNodes: Map<string, RushMiningNode>
  miningCombo: number
  miningLastAt: number
  farmCells: Map<string, RushFarmCell>
  farmInventory: Partial<Record<FarmRushIngredient, number>>
  farmOrders: Map<number, number>
  farmNextOrder: number
  farmCooking: RushFarmJob[]
  forageInventory: Record<ForageRushKind, number>
  forageProgress: Record<ForageRushKind, number>
  forageCompletedAt: number | null
}
type FarmResult = { requestId: string; ok: boolean; reason?: string; op?: 'claim' | 'plant' | 'water' | 'harvest' | 'rain'; farmId?: number; cellIndex?: number; crop?: CropKind; quantity?: number; account?: AccountPayload }
type DeedResult = { requestId: string; ok: boolean; quantity: number; personalCount: number; globalCount: number; personalAvailable: boolean; globalRemaining: number; reason?: string; account?: AccountPayload }
type MerchantPurchaseResult = { requestId: string; ok: boolean; reason?: string; itemId?: MerchantItemId; price?: number; cycle?: MerchantCycle; account?: AccountPayload }
type MinigameSettlement = { settlementId: string; profileId: string; matchSeed: number; milestone: number; kind: MinigameKind; score: number; placement: number; economyReference: number; cashReward: number; itemRolls: ReturnType<typeof minigameRewards>['itemRolls']; standings: MinigameStanding[] }
type MarketTransactionResult = { requestId: string; ok: boolean; kind: 'commodity' | 'food' | 'stock'; reason?: string; itemId?: CommodityId; recipeId?: RecipeId; stockId?: StockId; direction?: 'buy' | 'sell'; quantity: number; total: number; revision: number; account?: AccountPayload }
type CookResult = { requestId: string; ok: boolean; op: 'queue' | 'collect'; reason?: string; recipeId?: RecipeId; quantity: number; itemId?: ItemId }

const normalizeProfileId = (value: unknown) => {
  const candidate = typeof value === 'string' ? value.trim() : ''
  return /^[a-zA-Z0-9_-]{16,80}$/.test(candidate) ? candidate : null
}

const MAX_PLAYERS = 6
const MAX_FARMS = 8
const DEFAULT_GLOBAL_EXPANSION_DEEDS = 2
const ALLOW_EARLY_TEST_RESET = process.env.TEST_ALLOW_EARLY_RESET === '1'
const ALLOW_EARLY_TEST_MINIGAME = process.env.TEST_ALLOW_EARLY_MINIGAME === '1'
const ALLOW_TEST_SCORE_INJECTION = process.env.TEST_ALLOW_SCORE_INJECTION === '1'
const FORCE_TEST_RARES = process.env.TEST_RARE_FORAGE_ALWAYS === '1'
const FORAGE_REGROW_MS = Number(process.env.TEST_FORAGE_REGROW_MS) > 0 ? Number(process.env.TEST_FORAGE_REGROW_MS) : 30_000
const FORAGE_RUSH_RARE_RESPAWN_MS = Number(process.env.TEST_FORAGE_RUSH_RARE_RESPAWN_MS) > 0 ? Number(process.env.TEST_FORAGE_RUSH_RARE_RESPAWN_MS) : FORAGE_RUSH_RESPAWN_MS.rare
const RAIN_CYCLE_COOLDOWN_MS = Number(process.env.TEST_RAIN_COOLDOWN_MS) >= 0 ? Number(process.env.TEST_RAIN_COOLDOWN_MS) : 340_000
const TEST_MARKET_FIXTURES = process.env.TEST_MARKET_FIXTURES === '1'
const TEST_TRADE_FIXTURES = process.env.TEST_TRADE_FIXTURES === '1'
const TEST_FARM_FIXTURES = process.env.TEST_FARM_FIXTURES === '1'
const TEST_COOK_FIXTURES = process.env.TEST_COOK_FIXTURES === '1'
const TEST_COOK_DURATION_MS = Number(process.env.TEST_COOK_DURATION_MS) > 0 ? Number(process.env.TEST_COOK_DURATION_MS) : 0
const TEST_START_CLEAR_WEATHER = process.env.TEST_START_CLEAR_WEATHER === '1'
const ACCOUNT_MAX_CASH = 5_000_000_000
const ACCOUNT_MAX_ITEM_QUANTITY = 1_000_000
const STALE_SESSION_MS = 45_000
const configuredStartingCash = Number(process.env.TEST_STARTING_CASH)
const ACCOUNT_STARTING_CASH = Number.isSafeInteger(configuredStartingCash) && configuredStartingCash >= 0 && configuredStartingCash <= ACCOUNT_MAX_CASH
  ? configuredStartingCash
  : MATCH_CONFIG.startingCash
const startingInventory = (): Partial<Record<ItemId, number>> => TEST_MARKET_FIXTURES
  ? { 'home-charm': 1, apple: 24, 'food-apple-bread': 2 }
  : TEST_TRADE_FIXTURES
    ? { 'home-charm': 1, apple: 2, orange: 3 }
    : TEST_COOK_FIXTURES
      ? { 'home-charm': 1, furnace: 1, apple: 20, wheat: 20 }
    : TEST_FARM_FIXTURES
      ? { 'home-charm': 1, 'wheat-seeds': 10, 'water-can': 1, 'rain-bottle': 1 }
    : { 'home-charm': 1 }
const FARM_CENTERS = [[-54, -16], [-18, -14], [19, -17], [55, -13], [-53, -50], [-17, -49], [20, -53], [56, -48]] as const
const CROP_IDS = new Set<CropKind>(Object.keys(CROP_CONFIG) as CropKind[])
const PLAYER_ANIMATIONS = new Set(['Armature|Idle_Loop', 'Armature|Walk_Loop', 'Armature|Sprint_Loop', 'Armature|Jump_Loop', 'Armature|Interact', 'Armature|PickUp_Table', 'Armature|Sword_Attack'])
const DISPLAYABLE_ITEMS = new Set<ItemId>(Object.keys(ITEMS) as ItemId[])
const HELD_PICKAXES = new Set<PickaxeItem>(['worn-pickaxe', 'iron-pickaxe', 'steel-pickaxe', 'crystal-pickaxe'])
const FORAGE_TRAIL = [[0, 22], [1, 12], [-2, 0], [-8, -16], [-3, -34], [9, -52], [4, -72], [-12, -91], [-5, -112], [8, -132], [-2, -154], [10, -177], [2, -203]] as const
const forageSeeded = (index: number, salt = 0) => {
  const value = Math.sin((index + 1) * 91.733 + salt * 37.17) * 43758.5453
  return value - Math.floor(value)
}
const forageTrailCenterAt = (z: number) => {
  if (z >= FORAGE_TRAIL[0][1]) return FORAGE_TRAIL[0][0]
  for (let index = 0; index < FORAGE_TRAIL.length - 1; index += 1) {
    const [ax, az] = FORAGE_TRAIL[index]
    const [bx, bz] = FORAGE_TRAIL[index + 1]
    if (z <= az && z >= bz) {
      const t = (az - z) / (az - bz)
      return ax + (bx - ax) * t
    }
  }
  return FORAGE_TRAIL.at(-1)![0]
}
const orchardSites = (cx: number, cz: number, count: number, salt: number) => Array.from({ length: count }, (_, index) => {
  const column = index % 5
  const row = Math.floor(index / 5)
  return [cx + (column - 2) * 8.4 + (forageSeeded(index, salt) - 0.5) * 3.6, cz + (row - 1.5) * 8.8 + (forageSeeded(index, salt + 1) - 0.5) * 3.8] as const
})
const distributedFruitSites = (count: number, salt: number) => Array.from({ length: count }, (_, index) => {
  const columns = 7
  const rows = Math.ceil(count / columns)
  const column = index % columns
  const row = Math.floor(index / columns)
  let x = -174 + (348 * (column + 0.5)) / columns + (forageSeeded(index, salt) - 0.5) * 16
  const z = -22 - (178 * (row + 0.5)) / rows + (forageSeeded(index, salt + 1) - 0.5) * 13
  const trail = forageTrailCenterAt(z)
  if (Math.abs(x - trail) < 9) x += x <= trail ? -13 : 13
  return [Math.max(-188, Math.min(188, x)), z] as const
})
const FORAGE_APPLE_SITES = [
  [-10, -96], [20, -104], [-28, -121], [30, -132],
  ...orchardSites(-49, -44, 8, 6101), ...orchardSites(54, -117, 12, 6127),
  ...orchardSites(-64, -181, 12, 6151), ...distributedFruitSites(34, 6173),
] as ReadonlyArray<readonly [number, number]>
const FORAGE_ORANGE_SITES = [
  [11, -99], [-24, -109], [27, -118],
  ...orchardSites(54, -69, 9, 6203), ...orchardSites(-52, -124, 12, 6229),
  ...distributedFruitSites(36, 6257),
] as ReadonlyArray<readonly [number, number]>
const FORAGE_TRUFFLE_SITES = [[-112, -66], [97, -104], [-78, -204], [126, -167], [34, -151]] as const
const FORAGE_DISCOVERY_SITES = [[-178, -185], [164, -201], [-139, -16]] as const
const FORAGE_RUSH_TRUFFLE_IDS = [...FORAGE_TRUFFLE_SITES.map((_, index) => `ForageRushTruffle${String(index).padStart(3, '0')}`), ...Array.from({ length: 6 }, (_, index) => `ForageRushTruffle${String(index + 20).padStart(3, '0')}`)]
const FORAGE_RUSH_DISCOVERY_IDS = [...FORAGE_DISCOVERY_SITES.map((_, index) => `ForageRushDiscovery${String(index).padStart(2, '0')}`), ...Array.from({ length: 3 }, (_, index) => `ForageRushDiscovery${String(index + 10).padStart(2, '0')}`)]
const FORAGE_NODE_DEFINITIONS: ForageNodeDefinition[] = [
  ...FORAGE_APPLE_SITES.map(([x, z], index) => ({ id: `ForageApple${String(index).padStart(3, '0')}`, item: 'apple' as const, capacity: fruitTreeCapacity(`ForageApple${String(index).padStart(3, '0')}`), x, z })),
  ...FORAGE_ORANGE_SITES.map(([x, z], index) => ({ id: `ForageOrange${String(index).padStart(3, '0')}`, item: 'orange' as const, capacity: fruitTreeCapacity(`ForageOrange${String(index).padStart(3, '0')}`), x, z })),
  ...FORAGE_TRUFFLE_SITES.map(([x, z], index) => ({ id: `ForageTruffle${String(index).padStart(3, '0')}`, item: 'truffle' as const, capacity: 1, x, z, rare: true })),
  ...FORAGE_DISCOVERY_SITES.map(([x, z], index) => ({ id: `ForageDiscovery${String(index).padStart(2, '0')}`, item: 'natural-discovery' as const, capacity: 1, x, z, rare: true })),
]
const FORAGE_NODE_BY_ID = new Map(FORAGE_NODE_DEFINITIONS.map((node) => [node.id, node]))
const NON_TRADABLE_EQUIPMENT = new Set<ItemId>(['home-charm', 'farm-deed', 'shared-farm-deed', 'worn-pickaxe', 'iron-pickaxe', 'steel-pickaxe', 'crystal-pickaxe', 'basket', 'reinforced-basket', 'master-basket', 'harvest-charm', 'upgrade-coupon', 'upgrade-guard-4', 'upgrade-guard-5', 'upgrade-guard-6'])
const UNIQUE_SHOP_ITEMS = new Set<ItemId>(['worn-pickaxe', 'iron-pickaxe', 'steel-pickaxe', 'crystal-pickaxe', 'basket', 'reinforced-basket', 'master-basket', 'harvest-charm'])
const SHOP_ZONE: Record<'common' | 'forage' | 'farm' | 'mine', ZoneId> = { common: 'hub', forage: 'forage', farm: 'farm', mine: 'mine' }
const ZONE_SPAWNS: Record<ZoneId, [number, number, number]> = {
  hub: [0, 0.86, 14],
  forage: [0, 0.86, -69],
  farm: [0, 0.86, 17],
  mine: [0, 0.86, 34],
}
const emptyStats = (): PublicStats => ({ foraged: 0, mined: 0, harvested: 0, sold: 0 })
const farmGrowthMs = (crop: CropKind) => Number(process.env.TEST_FARM_GROWTH_MS) > 0 ? Number(process.env.TEST_FARM_GROWTH_MS) : CROP_CONFIG[crop].growthSeconds * 1000

const zoneBounds: Record<ZoneId, { x: number; zMin: number; zMax: number }> = {
  hub: { x: 68, zMin: -68, zMax: 68 },
  forage: { x: 218, zMin: -222, zMax: 48 },
  farm: { x: 100, zMin: -112, zMax: 38 },
  // The authored cave perimeter reaches z=-253 and the deepest node cluster
  // reaches roughly z=-249. Keep the authoritative movement envelope aligned
  // with that scene so lower-cave interaction requests are not clamped away.
  mine: { x: 68, zMin: -258, zMax: 77 },
}

class WoodlandRoom extends Room {
  maxClients = MAX_PLAYERS
  private matchSeed = Math.floor(Math.random() * 1_000_000_000)
  private matchStartedAt = 0
  private matchDurationSeconds = MATCH_CONFIG.defaultDurationSeconds
  private matchStarted = false
  private roomStartedAt = Date.now()
  private hostId: string | null = null
  private lobbyEligible = new Set<string>()
  private lobbyReady = new Set<string>()
  private players = new Map<string, Presence>()
  private accounts = new Map<string, PlayerAccount>()
  private profileBySession = new Map<string, string>()
  private sessionByProfile = new Map<string, string>()
  private movementState = new Map<string, { zone: ZoneId; position: [number, number, number]; movedAt: number; initialized: boolean }>()
  private trades = new Map<string, TradeSession>()
  private minigameResults = new Map<number, Map<string, MinigameResult>>()
  private minigameRewardLedger = new Map<string, MinigameSettlement>()
  private eventScores = new Map<string, RushEventScore>()
  private minigameTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private eventBays = new Map<string, Map<string, number>>()
  private eventStartedAt = new Map<string, number>()
  private eventReady = new Map<string, EventReadyGate>()
  private eventForageReadyAt = new Map<string, number>()
  private eventForageRares = new Map<number, EventForageRareState>()
  private oreNodes = new Map<string, SharedOreNode>(MINE_NODE_SITES.map(({ id }) => [id, { generation: 0, readyAt: 0 }]))
  private oreTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private forageNodes = new Map<string, SharedForageNode>(FORAGE_NODE_DEFINITIONS.map((node) => [node.id, { ...node, fullAt: 0 }]))
  private forageTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private forageRareTimer: ReturnType<typeof setTimeout> | null = null
  private orePauseStartedAt = 0
  private farms = new Map<number, SharedFarm>(FARM_CENTERS.map((_, index) => [index, { ownerId: null, cells: new Map() }]))
  private farmTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private farmResults = new Map<string, Map<string, FarmResult>>()
  private cookResults = new Map<string, Map<string, CookResult>>()
  private configuredGlobalExpansionDeeds = DEFAULT_GLOBAL_EXPANSION_DEEDS
  private globalDeedsRemaining = this.configuredGlobalExpansionDeeds
  private deedResults = new Map<string, Map<string, DeedResult>>()
  private lastRainAt = 0
  private merchantCycleState: MerchantCycle | null = null
  private merchantResults = new Map<string, Map<string, MerchantPurchaseResult>>()
  private shopResults = new Map<string, Map<string, { requestId: string; ok: boolean; itemId?: ItemId; quantity: number; reason?: string }>>()
  private settledMinigames = new Set<number>()
  private marketRevision = 0
  private marketElapsedSecond = 0
  private marketWeather: WeatherKind = TEST_START_CLEAR_WEATHER ? 'clear' : 'rain'
  private marketWeatherSeconds = 45
  private commodityMarket: CommodityMarket = initialCommodityMarket()
  private commodityPending: Partial<Record<CommodityId, number>> = {}
  private commodityPriceHistory = createInitialCommodityHistory(this.commodityMarket)
  private commodityCycle = 0
  private stockPrices = createInitialStockPrices()
  private stockHistory = createInitialStockHistory()
  private stockSupply = createInitialStockSupply()
  private foodMarket = createInitialFoodMarket()
  private foodPriceHistory = createInitialFoodHistory(this.commodityMarket, this.foodMarket)
  private marketCorrectionsApplied: number[] = []
  private marketCorrectionName: string | null = null
  private marketCorrectionUntil = 0
  private marketTransactions = new Map<string, MarketTransactionResult>()
  private marketTimer: ReturnType<typeof setInterval> | null = null

  private sendTo(id: string, type: string, payload: unknown) {
    this.clients.find((client) => client.sessionId === id)?.send(type, payload)
  }

  private profileIdFor(sessionId: string) {
    return this.profileBySession.get(sessionId) ?? `session-${sessionId}`
  }

  private createAccount(profileId: string): PlayerAccount {
    return {
      profileId,
      roomKey: this.matchSeed,
      revision: 0,
      cash: ACCOUNT_STARTING_CASH,
      inventory: startingInventory(),
      portfolio: {},
      personalDeedOwned: false,
      deedEntitlement: 0,
      ownedFarms: new Set(),
      cookQueue: [],
      stats: emptyStats(),
      activeSessionId: null,
      lastSeenAt: Date.now(),
      appliedRewardKeys: new Set(),
    }
  }

  private accountForProfile(profileId: string) {
    let account = this.accounts.get(profileId)
    if (!account) {
      account = this.createAccount(profileId)
      this.accounts.set(profileId, account)
    }
    return account
  }

  private accountForSession(sessionId: string) {
    return this.accountForProfile(this.profileIdFor(sessionId))
  }

  private sessionIsActive(sessionId: string) {
    const profileId = this.profileBySession.get(sessionId)
    return Boolean(profileId && this.accounts.get(profileId)?.activeSessionId === sessionId)
  }

  private bumpAccount(account: PlayerAccount) {
    account.revision += 1
    account.roomKey = this.matchSeed
    return account
  }

  private accountPayload(account: PlayerAccount, action?: AccountAction): AccountPayload {
    return {
      profileId: account.profileId,
      roomKey: account.roomKey,
      revision: account.revision,
      cash: Math.max(0, Math.min(ACCOUNT_MAX_CASH, Math.floor(account.cash))),
      inventory: Object.fromEntries(Object.entries(account.inventory).filter(([, quantity]) => Number(quantity) > 0).map(([id, quantity]) => [id, Math.max(0, Math.min(ACCOUNT_MAX_ITEM_QUANTITY, Math.floor(Number(quantity))))])) as Partial<Record<ItemId, number>>,
      portfolio: Object.fromEntries(Object.entries(account.portfolio).filter(([, quantity]) => Number(quantity) > 0).map(([id, quantity]) => [id, Math.max(0, Math.min(ACCOUNT_MAX_ITEM_QUANTITY, Math.floor(Number(quantity))))])) as Partial<Record<StockId, number>>,
      personalDeedOwned: account.personalDeedOwned,
      deedEntitlement: Math.max(0, Math.floor(account.deedEntitlement)),
      ownedFarms: [...account.ownedFarms].sort((a, b) => a - b),
      cookQueue: account.cookQueue.map((job) => ({ ...job })),
      stats: { ...account.stats },
      action,
    }
  }

  private withAccount<T extends object>(client: Client, payload: T, action?: AccountAction) {
    return { ...payload, account: this.accountPayload(this.accountForSession(client.sessionId), action) }
  }

  private sendAccountRefresh(client: Client, action?: AccountAction) {
    client.send('market:snapshot', { ...this.marketSnapshot(), account: this.accountPayload(this.accountForSession(client.sessionId), action) })
  }

  private accountProgress(account: PlayerAccount) {
    const inventoryValue = Object.entries(account.inventory).reduce((sum, [id, quantity]) => {
      const definition = ITEMS[id as ItemId]
      if (!definition) return sum
      return sum + (definition.sellPrice ?? definition.buyPrice ?? 0) * Math.max(0, Number(quantity) || 0)
    }, 0)
    const stockValue = Object.entries(account.portfolio).reduce((sum, [id, quantity]) => sum + (STOCKS[id as StockId]?.basePrice ?? 0) * Math.max(0, Number(quantity) || 0), 0)
    return Math.max(1, Math.min(ACCOUNT_MAX_CASH, Math.floor(account.cash + inventoryValue + stockValue + account.ownedFarms.size * (ITEMS['farm-deed'].buyPrice ?? 0))))
  }

  private accountHas(account: PlayerAccount, item: ItemId, quantity = 1) {
    return Number.isSafeInteger(quantity) && quantity >= 0 && (account.inventory[item] ?? 0) >= quantity
  }

  private changeInventory(account: PlayerAccount, item: ItemId, delta: number) {
    const next = Math.floor((account.inventory[item] ?? 0) + delta)
    if (next <= 0) delete account.inventory[item]
    else account.inventory[item] = Math.min(ACCOUNT_MAX_ITEM_QUANTITY, next)
  }

  private resetAccount(account: PlayerAccount) {
    account.roomKey = this.matchSeed
    account.revision = 0
    account.cash = ACCOUNT_STARTING_CASH
    account.inventory = startingInventory()
    account.portfolio = {}
    account.personalDeedOwned = false
    account.deedEntitlement = 0
    account.ownedFarms.clear()
    account.cookQueue = []
    account.stats = emptyStats()
    account.appliedRewardKeys.clear()
    account.lastSeenAt = Date.now()
  }

  private resetAccounts() {
    this.accounts.forEach((account) => this.resetAccount(account))
    this.shopResults.clear()
    this.cookResults.clear()
    this.marketTransactions.clear()
  }

  private rebindProfile(client: Client, profileId: string) {
    const account = this.accountForProfile(profileId)
    const previousSession = this.sessionByProfile.get(profileId)
    if (previousSession && previousSession !== client.sessionId) {
      const previousActive = this.players.has(previousSession) || this.clients.some((entry) => entry.sessionId === previousSession)
      const previousSeenAt = this.players.get(previousSession)?.seenAt ?? account.lastSeenAt
      if (previousActive && Date.now() - previousSeenAt <= STALE_SESSION_MS) throw new Error('Profile already connected')
      if (previousActive) {
        for (const trade of this.trades.values()) if (trade.a === previousSession || trade.b === previousSession) {
          this.sendTo(this.other(trade, previousSession), 'trade:cancel', { tradeId: trade.id, reason: 'Session replaced' })
          this.trades.delete(trade.id)
        }
        this.players.delete(previousSession)
        this.movementState.delete(previousSession)
        this.lobbyEligible.delete(previousSession)
        this.lobbyReady.delete(previousSession)
        this.releaseEventBay(previousSession)
        this.leaveReadyGates(previousSession)
        if (this.hostId === previousSession) this.hostId = null
        this.broadcast('presence:leave', previousSession)
      }
      this.profileBySession.delete(previousSession)
      this.movementState.delete(previousSession)
    }
    this.profileBySession.set(client.sessionId, profileId)
    this.sessionByProfile.set(profileId, client.sessionId)
    account.activeSessionId = client.sessionId
    account.lastSeenAt = Date.now()
    for (const farm of this.farms.values()) if (farm.ownerId === previousSession) farm.ownerId = client.sessionId
    return account
  }

  private settlementKey(profileId: string, milestone: number) {
    return `${profileId}:${this.matchSeed}:${milestone}`
  }

  private settlementPayload(settlement: MinigameSettlement) {
    return {
      settlementId: settlement.settlementId,
      milestone: settlement.milestone,
      kind: settlement.kind,
      score: settlement.score,
      placement: settlement.placement,
      economyReference: settlement.economyReference,
      cashReward: settlement.cashReward,
      itemRolls: settlement.itemRolls,
      standings: settlement.standings,
    }
  }

  private sendSettlement(client: Client, settlement: MinigameSettlement) {
    client.send('minigame:result', this.withAccount(client, this.settlementPayload(settlement), { type: 'minigame', key: settlement.settlementId, ok: true, quantity: 1, total: settlement.cashReward }))
  }

  private sendPendingSettlements(client: Client, milestone?: number) {
    const profileId = this.profileIdFor(client.sessionId)
    for (const settlement of this.minigameRewardLedger.values()) {
      if (settlement.profileId !== profileId || settlement.matchSeed !== this.matchSeed) continue
      if (milestone !== undefined && settlement.milestone !== milestone) continue
      this.sendSettlement(client, settlement)
    }
  }

  private effectiveMatchStartedAt(now = Date.now()) {
    if (!this.matchStarted || !this.orePauseStartedAt) return this.matchStartedAt
    return this.matchStartedAt + Math.max(0, now - this.orePauseStartedAt)
  }

  private matchSyncPayload(now = Date.now()) {
    return { seed: this.matchSeed, startedAt: this.effectiveMatchStartedAt(now), durationSeconds: this.matchDurationSeconds }
  }

  private broadcastMatchSync() {
    if (this.matchStarted) this.broadcast('match:sync', this.matchSyncPayload())
  }

  private oreSnapshot() {
    return {
      seed: this.matchSeed,
      nodes: Object.fromEntries([...this.oreNodes.entries()].map(([id, node]) => [id, { ...node }])),
    }
  }

  private sendOreSnapshot(client: Client) {
    client.send('mine:snapshot', this.withAccount(client, this.oreSnapshot()))
  }

  private forageAvailability(node: SharedForageNode, now = Date.now()) {
    if (node.rare) return node.rareAvailable ? 1 : 0
    if (node.fullAt <= now) return node.capacity
    const missing = Math.ceil((node.fullAt - now) / FORAGE_REGROW_MS)
    return Math.max(0, Math.min(node.capacity, node.capacity - missing))
  }

  private forageNodePayload(node: SharedForageNode, now = Date.now()) {
    const available = this.forageAvailability(node, now)
    return { id: node.id, item: node.item, capacity: node.capacity, available, fullAt: available >= node.capacity ? 0 : node.fullAt }
  }

  private forageSnapshot() {
    const now = Date.now()
    return {
      regrowMs: FORAGE_REGROW_MS,
      nodes: Object.fromEntries([...this.forageNodes.values()].map((node) => [node.id, this.forageNodePayload(node, now)])),
    }
  }

  private sendForageSnapshot(client: Client) {
    client.send('forage:snapshot', this.withAccount(client, this.forageSnapshot()))
  }

  private clearForageTimer(id: string) {
    const timer = this.forageTimers.get(id)
    if (timer) clearTimeout(timer)
    this.forageTimers.delete(id)
  }

  private clearRareForageTimer() {
    if (this.forageRareTimer) clearTimeout(this.forageRareTimer)
    this.forageRareTimer = null
  }

  private refreshRareForage(now = Date.now(), broadcast = true) {
    this.clearRareForageTimer()
    const rareNodes = [...this.forageNodes.values()].filter((node) => node.rare)
    if (!rareNodes.length) return
    const rareIds = rareNodes.map((node) => node.id)
    const active = FORCE_TEST_RARES
      ? new Set(rareNodes.filter((node) => node.id === 'ForageTruffle000' || node.id === 'ForageDiscovery00').map((node) => node.id))
      : this.matchStarted ? activeRareForageIds(rareIds, false, this.matchSeed, this.matchStartedAt, now) : new Set<string>()
    for (const node of rareNodes) {
      const nextAt = nextRareForageRollAt(node.item === 'truffle' ? 'truffle' : 'natural-discovery', false, this.matchStartedAt || now, now)
      const available = active.has(node.id) && node.fullAt <= now
      node.rareAvailable = available
      node.fullAt = available ? 0 : Math.max(node.fullAt, nextAt)
      if (broadcast) this.broadcast('forage:node', this.forageNodePayload(node, now))
    }
    if (!this.matchStarted) return
    const nextTruffle = nextRareForageRollAt('truffle', false, this.matchStartedAt, now)
    const nextDiscovery = nextRareForageRollAt('natural-discovery', false, this.matchStartedAt, now)
    this.forageRareTimer = setTimeout(() => this.refreshRareForage(Date.now()), Math.max(0, Math.min(nextTruffle, nextDiscovery) - now) + 20)
  }

  private scheduleForageRegrowth(id: string) {
    this.clearForageTimer(id)
    const node = this.forageNodes.get(id)
    if (!node || node.rare || node.fullAt <= 0) return
    const now = Date.now()
    const available = this.forageAvailability(node, now)
    if (available >= node.capacity) {
      node.fullAt = 0
      return
    }
    const nextRegrowAt = node.fullAt - (node.capacity - available - 1) * FORAGE_REGROW_MS
    this.forageTimers.set(id, setTimeout(() => {
      this.forageTimers.delete(id)
      const current = this.forageNodes.get(id)
      if (!current || current.fullAt <= 0) return
      const tickNow = Date.now()
      if (this.forageAvailability(current, tickNow) >= current.capacity) current.fullAt = 0
      this.broadcast('forage:node', this.forageNodePayload(current, tickNow))
      this.scheduleForageRegrowth(id)
    }, Math.max(0, nextRegrowAt - now) + 15))
  }

  private resetForageNodes() {
    this.forageTimers.forEach((timer) => clearTimeout(timer))
    this.forageTimers.clear()
    this.clearRareForageTimer()
    this.forageNodes = new Map(FORAGE_NODE_DEFINITIONS.map((node) => [node.id, { ...node, fullAt: 0 }]))
    this.refreshRareForage(Date.now(), false)
    if (this.clients.length) this.broadcast('forage:snapshot', this.forageSnapshot())
  }

  private farmSnapshot(client: Client) {
    const owners: Record<number, string | null> = {}
    const cells: Record<string, SharedFarmCell> = {}
    for (const [farmId, farm] of this.farms) {
      owners[farmId] = farm.ownerId
      for (const [cellIndex, cell] of farm.cells) cells[`${farmId}:${cellIndex}`] = { ...cell }
    }
    client.send('farm:snapshot', this.withAccount(client, { selfId: client.sessionId, owners, cells }))
  }

  private deedSnapshot(client: Client) {
    const account = this.accountForSession(client.sessionId)
    client.send('deed:snapshot', this.withAccount(client, {
      personalAvailable: !account.personalDeedOwned,
      globalRemaining: this.globalDeedsRemaining,
    }))
  }

  private maxGlobalExpansionDeeds() {
    const playerCount = Math.max(1, this.lobbyEligible.size || this.clients.length)
    return Math.max(0, MAX_FARMS - playerCount)
  }

  private clampGlobalExpansionDeeds() {
    this.configuredGlobalExpansionDeeds = Math.min(this.configuredGlobalExpansionDeeds, this.maxGlobalExpansionDeeds())
    if (!this.matchStarted) this.globalDeedsRemaining = Math.min(this.globalDeedsRemaining, this.configuredGlobalExpansionDeeds)
  }

  private currentMerchant() {
    const matchStartedAtMs = this.matchStarted ? this.effectiveMatchStartedAt() : this.roomStartedAt
    const cycle = currentMerchantCycle({ matchSeed: this.matchSeed, matchStartedAtMs, matchDurationMs: this.matchDurationSeconds * 1000 }, Date.now())
    if (!cycle) return null
    if (this.merchantCycleState?.id !== cycle.id) this.merchantCycleState = cycle
    return this.merchantCycleState
  }

  private sendMerchantSnapshot(client: Client) {
    const cycle = this.currentMerchant()
    if (cycle) client.send('merchant:snapshot', this.withAccount(client, cycle))
  }

  private resetMerchant() {
    this.merchantCycleState = null
    this.merchantResults.clear()
    this.clients.forEach((client) => this.sendMerchantSnapshot(client))
  }

  private marketSnapshot(now = Date.now()): SharedMarketSnapshot {
    const correctionSeconds = this.marketCorrectionName ? Math.max(0, Math.ceil((this.marketCorrectionUntil - now) / 1000)) : 0
    return {
      revision: this.marketRevision,
      elapsedSeconds: this.marketElapsedSecond,
      weather: this.marketWeather,
      weatherSeconds: this.marketWeatherSeconds,
      commodityMarket: { ...this.commodityMarket },
      commodityPending: { ...this.commodityPending },
      commodityPriceHistory: Object.fromEntries(Object.entries(this.commodityPriceHistory).map(([id, history]) => [id, [...history]])),
      commodityCycle: this.commodityCycle,
      stockPrices: { ...this.stockPrices },
      stockHistory: Object.fromEntries(Object.entries(this.stockHistory).map(([id, history]) => [id, [...history]])) as Record<StockId, number[]>,
      stockSupply: { ...this.stockSupply },
      foodMarket: { ...this.foodMarket },
      foodPriceHistory: Object.fromEntries(Object.entries(this.foodPriceHistory).map(([id, history]) => [id, [...history]])),
      marketCorrectionsApplied: [...this.marketCorrectionsApplied],
      marketCorrectionName: correctionSeconds > 0 ? this.marketCorrectionName : null,
      marketCorrectionSeconds: correctionSeconds,
    }
  }

  private sendMarketSnapshot(client: Client) {
    client.send('market:snapshot', this.withAccount(client, this.marketSnapshot()))
  }

  private broadcastMarketSnapshot() {
    this.broadcast('market:snapshot', this.marketSnapshot())
  }

  private recordMarketPriceHistory() {
    const commodityPrices = commodityPriceSnapshot(this.commodityMarket)
    ;(Object.keys(COMMODITY_MARKET_CONFIG) as CommodityId[]).forEach((id) => {
      this.commodityPriceHistory[id] = [...(this.commodityPriceHistory[id] ?? []), commodityPrices[id]].slice(-5)
    })
    RECIPE_IDS.forEach((id) => {
      const price = preparedFoodValue(id, this.commodityMarket, this.foodMarket[id])
      this.foodPriceHistory[id] = [...(this.foodPriceHistory[id] ?? []), price].slice(-5)
    })
  }

  private resetMarket() {
    this.marketElapsedSecond = 0
    this.marketWeather = TEST_START_CLEAR_WEATHER ? 'clear' : 'rain'
    this.marketWeatherSeconds = 45
    this.commodityMarket = initialCommodityMarket()
    this.commodityPending = {}
    this.commodityPriceHistory = createInitialCommodityHistory(this.commodityMarket)
    this.commodityCycle = 0
    this.stockPrices = createInitialStockPrices()
    this.stockHistory = createInitialStockHistory()
    this.stockSupply = createInitialStockSupply()
    this.foodMarket = createInitialFoodMarket()
    this.foodPriceHistory = createInitialFoodHistory(this.commodityMarket, this.foodMarket)
    this.marketCorrectionsApplied = []
    this.marketCorrectionName = null
    this.marketCorrectionUntil = 0
    this.marketTransactions.clear()
    this.marketRevision += 1
    if (this.clients.length) this.broadcastMarketSnapshot()
  }

  private waterFarmsFromRain(now = Date.now()) {
    this.lastRainAt = now
    for (const [farmId, farm] of this.farms) for (const [cellIndex, current] of farm.cells) {
      if (current.stage !== 'planted' || !current.crop) continue
      const cell: SharedFarmCell = { ...current, stage: 'watered', readyAt: now + farmGrowthMs(current.crop) }
      farm.cells.set(cellIndex, cell)
      this.broadcast('farm:update', { farmId, cellIndex, cell })
      this.scheduleFarmReady(farmId, cellIndex)
    }
  }

  private applyMarketCorrection(milestone: number, now: number) {
    const correction = marketCorrectionFor(this.matchSeed, this.marketCorrectionsApplied.length + 1)
    const settled = { ...this.commodityMarket }
    ;(Object.keys(COMMODITY_MARKET_CONFIG) as CommodityId[]).forEach((id) => { settled[id] += this.commodityPending[id] ?? 0 })
    this.commodityPending = {}
    this.commodityMarket = correction.resetCommodities ? initialCommodityMarket() : settled
    ;(Object.entries(correction.commodities) as Array<[CommodityId, number]>).forEach(([id, multiplier]) => {
      this.commodityMarket[id] = Math.max(1, Math.round(this.commodityMarket[id] * multiplier))
    })
    STOCK_IDS.forEach((id) => {
      const multiplier = correction.stocks[id] ?? 1
      if (multiplier === 1) return
      const next = Math.max(Math.round(STOCKS[id].basePrice * .15), Math.min(Math.round(STOCKS[id].basePrice * 12), Math.round(this.stockPrices[id] * multiplier)))
      this.stockPrices[id] = next
      this.stockHistory[id] = [...this.stockHistory[id], next].slice(-5)
    })
    this.marketCorrectionsApplied.push(milestone)
    this.marketCorrectionName = correction.headline
    this.marketCorrectionUntil = now + 10_000
    this.recordMarketPriceHistory()
  }

  private advanceMarket(now = Date.now()) {
    if (!this.matchStarted) return
    const elapsed = Math.max(0, Math.min(this.matchDurationSeconds, Math.floor((now - this.effectiveMatchStartedAt(now)) / 1000)))
    if (elapsed < this.marketElapsedSecond) return
    let changed = false
    const targetCycle = Math.floor(elapsed / MATCH_CONFIG.worldCycleSeconds)
    const events: Array<{ at: number; kind: 'cycle' | 'correction'; value: number }> = []
    for (let cycle = this.commodityCycle + 1; cycle <= targetCycle; cycle += 1) events.push({ at: cycle * MATCH_CONFIG.worldCycleSeconds, kind: 'cycle', value: cycle })
    dueMarketCorrections(this.matchDurationSeconds, elapsed, this.marketCorrectionsApplied).forEach((milestone) => events.push({ at: milestone, kind: 'correction', value: milestone }))
    events.sort((a, b) => a.at - b.at || (a.kind === 'cycle' ? -1 : 1))
    for (const event of events) {
      if (event.kind === 'cycle') {
        const eventWeather = weatherAtElapsed(event.at).weather
        const advanced = advanceMarketCycle(this.commodityMarket, this.commodityPending, this.stockPrices, this.stockHistory, this.stockSupply, this.foodMarket, event.value, eventWeather, this.matchSeed)
        this.commodityMarket = advanced.commodityMarket
        this.commodityPending = {}
        this.stockPrices = advanced.stockPrices
        this.stockHistory = advanced.stockHistory
        this.stockSupply = advanced.stockSupply
        this.foodMarket = advanced.foodMarket
        this.commodityCycle = event.value
        this.recordMarketPriceHistory()
      } else {
        this.applyMarketCorrection(event.value, now)
      }
      changed = true
    }
    const previousWeather = this.marketWeather
    const nextWeather = TEST_START_CLEAR_WEATHER ? { weather: 'clear' as const, seconds: 99_999 } : weatherAtElapsed(elapsed)
    this.marketElapsedSecond = elapsed
    this.marketWeather = nextWeather.weather
    this.marketWeatherSeconds = nextWeather.seconds
    if (nextWeather.weather !== previousWeather) {
      if (nextWeather.weather === 'rain') this.waterFarmsFromRain(now)
      changed = true
    }
    if (changed) {
      this.marketRevision += 1
      this.broadcastMarketSnapshot()
    }
  }

  private marketRequestId(value: unknown) {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value) ? value : ''
  }

  private marketTransactionKey(client: Client, requestId: string) {
    return `${this.profileIdFor(client.sessionId)}:${requestId}`
  }

  private rememberMarketTransaction(client: Client, result: MarketTransactionResult) {
    this.marketTransactions.set(this.marketTransactionKey(client, result.requestId), result)
    while (this.marketTransactions.size > 1_024) this.marketTransactions.delete(this.marketTransactions.keys().next().value!)
  }

  private priorMarketTransaction(client: Client, requestId: string) {
    return this.marketTransactions.get(this.marketTransactionKey(client, requestId))
  }

  private resetDeeds() {
    this.globalDeedsRemaining = this.configuredGlobalExpansionDeeds
    this.deedResults.clear()
    this.accounts.forEach((account) => {
      account.personalDeedOwned = false
      account.deedEntitlement = 0
      delete account.inventory['farm-deed']
      this.bumpAccount(account)
    })
    this.clients.forEach((client) => this.deedSnapshot(client))
    this.broadcast('deed:stock', { globalRemaining: this.globalDeedsRemaining })
  }

  private scheduleFarmReady(farmId: number, cellIndex: number) {
    const key = `${farmId}:${cellIndex}`
    const previous = this.farmTimers.get(key)
    if (previous) clearTimeout(previous)
    this.farmTimers.delete(key)
    if (this.orePauseStartedAt) return
    const cell = this.farms.get(farmId)?.cells.get(cellIndex)
    if (!cell?.readyAt || cell.stage !== 'watered') return
    this.farmTimers.set(key, setTimeout(() => {
      this.farmTimers.delete(key)
      const current = this.farms.get(farmId)?.cells.get(cellIndex)
      if (!current?.readyAt || current.stage !== 'watered') return
      if (this.orePauseStartedAt || current.readyAt > Date.now()) return this.scheduleFarmReady(farmId, cellIndex)
      const ready: SharedFarmCell = { ...current, stage: 'ready' }
      this.farms.get(farmId)!.cells.set(cellIndex, ready)
      this.broadcast('farm:update', { farmId, cellIndex, cell: ready })
    }, Math.max(0, cell.readyAt - Date.now()) + 15))
  }

  private resetFarms() {
    this.farmTimers.forEach((timer) => clearTimeout(timer))
    this.farmTimers.clear()
    this.farms = new Map(FARM_CENTERS.map((_, index) => [index, { ownerId: null, cells: new Map() }]))
    this.farmResults.clear()
    this.accounts.forEach((account) => account.ownedFarms.clear())
    this.clients.forEach((client) => this.farmSnapshot(client))
  }

  private clearOreTimer(id: string) {
    const timer = this.oreTimers.get(id)
    if (timer) clearTimeout(timer)
    this.oreTimers.delete(id)
  }

  private scheduleOreRespawn(id: string) {
    this.clearOreTimer(id)
    if (this.orePauseStartedAt) return
    const node = this.oreNodes.get(id)
    if (!node || node.readyAt <= 0) return
    const delay = Math.max(0, node.readyAt - Date.now())
    this.oreTimers.set(id, setTimeout(() => {
      this.oreTimers.delete(id)
      const current = this.oreNodes.get(id)
      if (!current || current.readyAt <= 0) return
      if (this.orePauseStartedAt || current.readyAt > Date.now()) return this.scheduleOreRespawn(id)
      current.readyAt = 0
      this.broadcast('mine:node', { id, ...current })
    }, delay + 15))
  }

  private resetOreNodes() {
    this.oreTimers.forEach((timer) => clearTimeout(timer))
    this.oreTimers.clear()
    this.orePauseStartedAt = 0
    this.oreNodes = new Map(MINE_NODE_SITES.map(({ id }) => [id, { generation: 0, readyAt: 0 }]))
    if (this.clients.length) this.broadcast('mine:snapshot', this.oreSnapshot())
  }

  private pauseOreRespawns() {
    if (this.orePauseStartedAt) return
    this.orePauseStartedAt = Date.now()
    this.oreTimers.forEach((timer) => clearTimeout(timer))
    this.oreTimers.clear()
    this.farmTimers.forEach((timer) => clearTimeout(timer))
    this.farmTimers.clear()
  }

  private resumeOreRespawns() {
    if (!this.orePauseStartedAt) return
    const pausedAt = this.orePauseStartedAt
    const pausedMs = Date.now() - pausedAt
    this.orePauseStartedAt = 0
    if (this.matchStarted) this.matchStartedAt += pausedMs
    for (const [id, node] of this.oreNodes) {
      if (node.readyAt > 0) {
        node.readyAt += pausedMs
        this.scheduleOreRespawn(id)
      }
    }
    for (const [farmId, farm] of this.farms) for (const [cellIndex, cell] of farm.cells) {
      if (cell.readyAt && cell.stage === 'watered') {
        cell.readyAt += pausedMs
        this.scheduleFarmReady(farmId, cellIndex)
      }
    }
    this.accounts.forEach((account) => {
      account.cookQueue = account.cookQueue.map((job) => job.readyAt > pausedAt ? { ...job, readyAt: job.readyAt + pausedMs } : job)
    })
    this.broadcast('mine:snapshot', this.oreSnapshot())
    this.broadcastMatchSync()
  }

  private other(trade: TradeSession, id: string) { return trade.a === id ? trade.b : trade.a }

  private lobbyStateFor(client: Client) {
    this.clampGlobalExpansionDeeds()
    const eligible = [...this.lobbyEligible]
    const readyCount = eligible.filter((id) => this.lobbyReady.has(id)).length
    const allReady = eligible.length > 0 && readyCount === eligible.length
    return {
      isHost: client.sessionId === this.hostId,
      started: this.matchStarted,
      durationSeconds: this.matchDurationSeconds,
      globalExpansionDeeds: this.configuredGlobalExpansionDeeds,
      maxGlobalExpansionDeeds: this.maxGlobalExpansionDeeds(),
      playerCount: this.clients.length,
      readyCount,
      allReady,
      selfReady: this.lobbyReady.has(client.sessionId),
      readyPlayerIds: eligible.filter((id) => this.lobbyReady.has(id)),
    }
  }

  private broadcastLobby() {
    this.clients.forEach((client) => client.send('lobby:state', this.lobbyStateFor(client)))
  }

  private resetMatchToLobby() {
    this.oreTimers.forEach((timer) => clearTimeout(timer))
    this.oreTimers.clear()
    this.farmTimers.forEach((timer) => clearTimeout(timer))
    this.farmTimers.clear()
    this.minigameTimers.forEach((timer) => clearTimeout(timer))
    this.minigameTimers.clear()
    this.eventReady.forEach((gate) => clearTimeout(gate.timeout))
    this.eventReady.clear()
    this.eventForageReadyAt.clear()
    this.clearEventForageRares()
    this.eventBays.clear()
    this.eventStartedAt.clear()
    this.minigameResults.clear()
    this.minigameRewardLedger.clear()
    this.eventScores.clear()
    this.settledMinigames.clear()
    this.matchStarted = false
    this.matchStartedAt = 0
    this.roomStartedAt = Date.now()
    this.matchSeed = Math.floor(Math.random() * 1_000_000_000)
    this.resetAccounts()
    this.lobbyReady.clear()
    this.resetOreNodes()
    this.resetForageNodes()
    this.resetFarms()
    this.resetDeeds()
    this.resetMerchant()
    this.resetMarket()
    this.broadcast('lobby:reset', {})
    this.broadcastLobby()
  }

  private validMinigameMilestone(value: number) {
    return minigameMilestones(this.matchDurationSeconds).includes(value)
  }

  private minigameMilestoneIsDue(value: number) {
    if (!this.matchStarted || !this.validMinigameMilestone(value)) return false
    return ALLOW_EARLY_TEST_MINIGAME || Date.now() - this.effectiveMatchStartedAt() >= value * 1000
  }

  private assignEventBay(clientId: string, key: string) {
    const players = this.eventBays.get(key) ?? new Map<string, number>()
    const existing = players.get(clientId)
    if (existing !== undefined) return existing
    const used = new Set(players.values())
    const available = Array.from({ length: 8 }, (_, index) => index).find((index) => !used.has(index))
    const bay = available ?? (clientId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 8)
    players.set(clientId, bay)
    this.eventBays.set(key, players)
    return bay
  }

  private releaseEventBay(clientId: string) {
    for (const [key, players] of this.eventBays) {
      players.delete(clientId)
      if (!players.size) this.eventBays.delete(key)
    }
  }

  private eventRareCandidates(kind: EventRareKind) {
    return kind === 'truffle' ? FORAGE_RUSH_TRUFFLE_IDS : FORAGE_RUSH_DISCOVERY_IDS
  }

  private desiredEventRareCount(kind: EventRareKind, participantCount: number) {
    const players = Math.max(1, Math.min(MAX_PLAYERS, Math.floor(participantCount) || 1))
    return Math.min(this.eventRareCandidates(kind).length, kind === 'truffle' ? Math.max(3, players + 1) : Math.max(1, Math.ceil(players / 2)))
  }

  private eventRarePayload(milestone: number, state: EventForageRareState) {
    return { milestone, ids: [...state.active].sort() }
  }

  private broadcastEventRares(milestone: number, state: EventForageRareState) {
    this.broadcast('minigame:forage-rares', this.eventRarePayload(milestone, state))
  }

  private ensureEventForageRares(milestone: number) {
    let state = this.eventForageRares.get(milestone)
    if (!state) {
      state = { active: new Set(), generations: { truffle: milestone * 2, discovery: milestone * 2 + 1 }, pending: { truffle: 0, discovery: 0 }, timers: new Set() }
      this.eventForageRares.set(milestone, state)
    }
    const participantCount = this.activeMinigamePlayers(milestone, 'forage').length
    let changed = false
    for (const kind of ['truffle', 'discovery'] as const) {
      const candidates = this.eventRareCandidates(kind)
      const prefix = kind === 'truffle' ? 'ForageRushTruffle' : 'ForageRushDiscovery'
      const activeOfKind = () => [...state!.active].filter((id) => id.startsWith(prefix)).length
      const target = this.desiredEventRareCount(kind, participantCount)
      let attempts = 0
      while (activeOfKind() + state.pending[kind] < target && attempts < candidates.length * 4) {
        const roll = activeRareForageIds(candidates, true, this.matchSeed, this.matchStartedAt, Date.now(), participantCount, state.generations[kind])
        const next = [...roll].find((id) => !state!.active.has(id)) ?? candidates.find((id) => !state!.active.has(id))
        state.generations[kind] += 1
        attempts += 1
        if (!next) break
        state.active.add(next)
        changed = true
      }
    }
    if (changed) this.broadcastEventRares(milestone, state)
    return state
  }

  private sendEventForageRares(clientId: string, milestone: number) {
    const state = this.ensureEventForageRares(milestone)
    this.sendTo(clientId, 'minigame:forage-rares', this.eventRarePayload(milestone, state))
  }

  private scheduleEventRareReplacement(milestone: number, collectedId: string, kind: EventRareKind) {
    const state = this.eventForageRares.get(milestone)
    if (!state) return
    state.pending[kind] += 1
    const timer = setTimeout(() => {
      state.timers.delete(timer)
      state.pending[kind] = Math.max(0, state.pending[kind] - 1)
      if (this.settledMinigames.has(milestone) || !this.activeMinigamePlayers(milestone, 'forage').length) return
      const candidates = this.eventRareCandidates(kind)
      const participantCount = this.activeMinigamePlayers(milestone, 'forage').length
      let next: string | undefined
      for (let attempts = 0; attempts < candidates.length * 5 && !next; attempts += 1) {
        const roll = activeRareForageIds(candidates, true, this.matchSeed, this.matchStartedAt, Date.now(), participantCount, state.generations[kind])
        state.generations[kind] += 1
        next = [...roll].find((id) => id !== collectedId && !state.active.has(id) && (this.eventForageReadyAt.get(`${milestone}:${id}`) ?? 0) <= Date.now())
      }
      next ??= candidates.find((id) => id !== collectedId && !state.active.has(id) && (this.eventForageReadyAt.get(`${milestone}:${id}`) ?? 0) <= Date.now())
      if (!next && !state.active.has(collectedId)) next = collectedId
      if (next) state.active.add(next)
      this.ensureEventForageRares(milestone)
      this.broadcastEventRares(milestone, state)
    }, FORAGE_RUSH_RARE_RESPAWN_MS)
    state.timers.add(timer)
  }

  private clearEventForageRares(milestone?: number) {
    for (const [eventMilestone, state] of this.eventForageRares) {
      if (milestone !== undefined && eventMilestone !== milestone) continue
      state.timers.forEach((timer) => clearTimeout(timer))
      this.eventForageRares.delete(eventMilestone)
    }
  }

  private readyState(key: string) {
    const gate = this.eventReady.get(key)
    if (!gate) return
    const [milestone, kind] = key.split(':')
    const expected = Math.max(1, this.lobbyEligible.size || this.clients.length)
    this.broadcast('minigame:ready-state', { milestone: Number(milestone), kind, ready: gate.ready.size, total: expected })
  }

  private startMinigame(key: string) {
    const gate = this.eventReady.get(key)
    if (!gate || gate.gameplayAt) return
    clearTimeout(gate.timeout)
    const gameplayAt = Date.now() + 5_000
    gate.gameplayAt = gameplayAt
    this.eventStartedAt.set(key, Date.now())
    const [milestone, kind] = key.split(':')
    if (kind === 'forage') this.ensureEventForageRares(Number(milestone))
    this.broadcast('minigame:start', { milestone: Number(milestone), kind, gameplayAt })
  }

  private joinReadyGate(clientId: string, key: string) {
    let gate = this.eventReady.get(key)
    if (!gate) {
      gate = { participants: new Set(), ready: new Set(), gameplayAt: null, timeout: setTimeout(() => this.startMinigame(key), 15_000) }
      this.eventReady.set(key, gate)
      this.pauseOreRespawns()
    }
    const joined = !gate.participants.has(clientId)
    gate.participants.add(clientId)
    if (joined) this.readyState(key)
    if (joined && gate.gameplayAt) this.sendTo(clientId, 'minigame:start', { milestone: Number(key.split(':')[0]), kind: key.split(':')[1], gameplayAt: gate.gameplayAt })
  }

  private leaveReadyGates(clientId: string) {
    for (const [key, gate] of this.eventReady) {
      gate.participants.delete(clientId)
      gate.ready.delete(clientId)
      if (!gate.participants.size) {
        clearTimeout(gate.timeout)
        this.eventReady.delete(key)
        this.eventStartedAt.delete(key)
      } else this.readyState(key)
    }
  }

  private activeMinigamePlayers(milestone: number, kind: MinigameKind) {
    return [...this.players.values()].filter((player) => player.minigameOpen && player.minigameMilestone === milestone && player.minigameKind === kind)
  }

  private eventScoreKey(profileId: string, milestone: number, kind: MinigameKind) {
    return `${profileId}:${this.matchSeed}:${milestone}:${kind}`
  }

  private ensureEventScore(profileId: string, milestone: number, kind: MinigameKind) {
    const key = this.eventScoreKey(profileId, milestone, kind)
    let state = this.eventScores.get(key)
    if (!state) {
      state = {
        profileId,
        milestone,
        kind,
        score: 0,
        miningNodes: new Map(),
        miningCombo: 0,
        miningLastAt: 0,
        farmCells: new Map(),
        farmInventory: {},
        farmOrders: new Map(),
        farmNextOrder: 0,
        farmCooking: [],
        forageInventory: { apple: 0, orange: 0, truffle: 0, discovery: 0 },
        forageProgress: { apple: 0, orange: 0, truffle: 0, discovery: 0 },
        forageCompletedAt: null,
      }
      this.eventScores.set(key, state)
    }
    return state
  }

  private eventScoreFor(profileId: string, milestone: number, kind: MinigameKind) {
    return Math.max(0, Math.floor(this.eventScores.get(this.eventScoreKey(profileId, milestone, kind))?.score ?? 0))
  }

  private eventIsPlayable(clientId: string, milestone: number, kind: MinigameKind) {
    const presence = this.players.get(clientId)
    if (!presence?.minigameOpen || presence.minigameMilestone !== milestone || presence.minigameKind !== kind) return false
    const gate = this.eventReady.get(`${milestone}:${kind}`)
    return Boolean(gate?.gameplayAt && Date.now() >= gate.gameplayAt)
  }

  private ensureRushOrders(state: RushEventScore, now = Date.now()) {
    for (const [orderIndex, expiresAt] of state.farmOrders) if (expiresAt <= now) state.farmOrders.delete(orderIndex)
    while (state.farmOrders.size < FARM_RUSH_MAX_ORDERS) {
      state.farmOrders.set(state.farmNextOrder, now + FARM_RUSH_ORDER_LIFETIME_MS)
      state.farmNextOrder += 1
    }
  }

  private captureMissingMinigameResults(milestone: number, kind: MinigameKind) {
    const results = this.minigameResults.get(milestone) ?? new Map<string, MinigameResult>()
    for (const presence of this.activeMinigamePlayers(milestone, kind)) {
      const profileId = this.profileIdFor(presence.id)
      if (results.has(profileId)) continue
      results.set(profileId, {
        score: this.eventScoreFor(profileId, milestone, kind),
        progressValue: this.accountProgress(this.accountForProfile(profileId)),
        nickname: presence.nickname,
      })
    }
    this.minigameResults.set(milestone, results)
  }

  private finalizeMinigame(milestone: number) {
    if (this.settledMinigames.has(milestone)) return
    const entries = [...(this.minigameResults.get(milestone)?.entries() ?? [])].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    if (entries.length) {
      const standings = entries.map(([, result], index) => ({ placement: index + 1, nickname: result.nickname, score: result.score }))
      const progress = entries.map(([, result]) => result.progressValue).sort((a, b) => a - b)
      const middle = Math.floor(progress.length / 2)
      const economyReference = progress.length % 2 ? progress[middle] : Math.round((progress[middle - 1] + progress[middle]) / 2)
      const leaderProgress = Math.max(...entries.map(([, result]) => result.progressValue))
      entries.forEach(([profileId, result], index) => {
        const placement = index + 1
        const reward = minigameRewards({ economyReference, placement, playerProgress: result.progressValue, leaderProgress, matchSeed: this.matchSeed, milestone, playerId: profileId })
        const settlement: MinigameSettlement = {
          settlementId: `${profileId}:${this.matchSeed}:${milestone}`,
          profileId,
          matchSeed: this.matchSeed,
          milestone,
          kind: scheduledMinigame(milestone, this.matchSeed, this.matchDurationSeconds),
          score: result.score,
          placement,
          economyReference,
          cashReward: reward.cash,
          itemRolls: reward.itemRolls,
          standings,
        }
        const account = this.accountForProfile(profileId)
        if (!account.appliedRewardKeys.has(settlement.settlementId)) {
          account.cash = Math.min(ACCOUNT_MAX_CASH, account.cash + Math.max(0, Math.floor(reward.cash)))
          reward.itemRolls.forEach((roll) => roll.items.forEach(({ itemId, quantity }) => this.changeInventory(account, itemId as ItemId, Math.max(0, Math.floor(quantity)))))
          account.appliedRewardKeys.add(settlement.settlementId)
          this.bumpAccount(account)
        }
        this.minigameRewardLedger.set(this.settlementKey(profileId, milestone), settlement)
        const sessionId = this.sessionByProfile.get(profileId)
        const session = sessionId ? this.clients.find((client) => client.sessionId === sessionId) : undefined
        if (session) this.sendSettlement(session, settlement)
      })
    }
    this.settledMinigames.add(milestone)
    this.minigameResults.delete(milestone)
    const timer = this.minigameTimers.get(milestone)
    if (timer) clearTimeout(timer)
    this.minigameTimers.delete(milestone)
    for (const key of this.eventForageReadyAt.keys()) if (key.startsWith(`${milestone}:`)) this.eventForageReadyAt.delete(key)
    this.clearEventForageRares(milestone)
    for (const key of this.eventStartedAt.keys()) if (key.startsWith(`${milestone}:`)) this.eventStartedAt.delete(key)
    for (const [key, gate] of this.eventReady) if (key.startsWith(`${milestone}:`)) { clearTimeout(gate.timeout); this.eventReady.delete(key) }
    this.resumeOreRespawns()
  }

  onCreate() {
    this.marketTimer = setInterval(() => this.advanceMarket(), 1_000)
    this.onMessage('lobby:ready', (client) => {
      if (!this.sessionIsActive(client.sessionId)) return
      client.send('lobby:state', this.lobbyStateFor(client))
      if (this.matchStarted) client.send('match:sync', this.matchSyncPayload())
      client.send('presence:snapshot', [...this.players.values()].filter((player) => player.id !== client.sessionId))
      this.sendOreSnapshot(client)
      this.sendForageSnapshot(client)
      this.farmSnapshot(client)
      this.deedSnapshot(client)
      this.sendMerchantSnapshot(client)
      this.sendMarketSnapshot(client)
      this.sendPendingSettlements(client)
    })
    this.onMessage('lobby:onboarding-ready', (client, message: { ready?: boolean }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      if (this.matchStarted || !this.lobbyEligible.has(client.sessionId)) return
      if (message?.ready) this.lobbyReady.add(client.sessionId)
      else this.lobbyReady.delete(client.sessionId)
      this.broadcastLobby()
    })
    this.onMessage('lobby:update', (client, message: { durationSeconds?: number; globalExpansionDeeds?: number }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      if (this.matchStarted || client.sessionId !== this.hostId) return
      const duration = Math.floor(Number(message?.durationSeconds))
      const globalExpansionDeeds = Math.floor(Number(message?.globalExpansionDeeds))
      let changed = false
      if (MATCH_CONFIG.selectableDurationsSeconds.includes(duration as typeof MATCH_CONFIG.selectableDurationsSeconds[number])) {
        this.matchDurationSeconds = duration
        changed = true
      }
      if (globalExpansionDeeds >= 0 && globalExpansionDeeds <= this.maxGlobalExpansionDeeds()) {
        this.configuredGlobalExpansionDeeds = globalExpansionDeeds
        changed = true
      }
      if (changed) this.broadcastLobby()
    })
    this.onMessage('lobby:start', (client) => {
      if (!this.sessionIsActive(client.sessionId)) return
      if (this.matchStarted || client.sessionId !== this.hostId) return
      if ([...this.lobbyEligible].some((id) => !this.lobbyReady.has(id))) return
      this.clampGlobalExpansionDeeds()
      this.matchSeed = Math.floor(Math.random() * 1_000_000_000)
      this.matchStartedAt = Date.now()
      this.lastRainAt = this.matchStartedAt
      this.matchStarted = true
      this.resetAccounts()
      this.resetOreNodes()
      this.resetForageNodes()
      this.resetFarms()
      this.resetDeeds()
      this.resetMerchant()
      this.resetMarket()
      this.settledMinigames.clear()
      this.minigameRewardLedger.clear()
      this.eventScores.clear()
      this.broadcast('match:sync', { seed: this.matchSeed, startedAt: this.matchStartedAt, durationSeconds: this.matchDurationSeconds })
      this.broadcastLobby()
    })
    this.onMessage('lobby:reset', (client) => {
      if (!this.sessionIsActive(client.sessionId)) return
      if (!this.matchStarted || client.sessionId !== this.hostId) return
      const elapsed = Date.now() - this.effectiveMatchStartedAt()
      if (!ALLOW_EARLY_TEST_RESET && elapsed < this.matchDurationSeconds * 1000) return
      this.resetMatchToLobby()
    })
    this.onMessage('move', (client, message: Partial<Presence>) => {
      if (!this.sessionIsActive(client.sessionId)) return
      if (!message || typeof message !== 'object') return
      const zone = message.zone
      const position = message.position
      if (!zone || !zoneBounds[zone] || !Array.isArray(position) || position.length !== 3 || position.some((value) => !Number.isFinite(value))) return
      const minigameKind = message.minigameKind === 'mining' || message.minigameKind === 'farm' || message.minigameKind === 'forage' ? message.minigameKind : undefined
      const minigameMilestone = Number(message.minigameMilestone)
      const minigameOpen = this.matchStarted && Boolean(message.minigameOpen) && Boolean(minigameKind) && this.minigameMilestoneIsDue(minigameMilestone) && minigameKind === scheduledMinigame(minigameMilestone, this.matchSeed, this.matchDurationSeconds)
      const bounds = minigameOpen && minigameKind === 'forage' ? zoneBounds.forage : minigameOpen ? zoneBounds.hub : zoneBounds[zone]
      const eventKey = minigameOpen ? `${minigameMilestone}:${minigameKind}` : null
      const eventBay = eventKey ? this.assignEventBay(client.sessionId, eventKey) : undefined
      if (eventKey) this.joinReadyGate(client.sessionId, eventKey)
      if (!eventKey) { this.releaseEventBay(client.sessionId); this.leaveReadyGates(client.sessionId) }
      const now = Date.now()
      const previous = this.players.get(client.sessionId)
      const requestedPosition: [number, number, number] = [
        Math.max(-bounds.x, Math.min(bounds.x, Number(position[0]))),
        Math.max(-30, Math.min(30, Number(position[1]))),
        Math.max(bounds.zMin, Math.min(bounds.zMax, Number(position[2]))),
      ]
      const movement = this.movementState.get(client.sessionId)
      let safePosition = requestedPosition
      if (movement?.initialized) {
        if (zone !== movement.zone) {
          const spawn = ZONE_SPAWNS[zone]
          if (Math.hypot(requestedPosition[0] - spawn[0], requestedPosition[2] - spawn[2]) > 3.5) safePosition = [...spawn]
        } else {
          const elapsed = Math.max(0.05, Math.min(1.5, (now - movement.movedAt) / 1000))
          const maxDistance = 1.8 + elapsed * 10.5
          if (Math.hypot(requestedPosition[0] - movement.position[0], requestedPosition[2] - movement.position[2]) > maxDistance) safePosition = [...movement.position]
        }
      }
      this.movementState.set(client.sessionId, { zone, position: safePosition, movedAt: now, initialized: true })
      const rawYaw = Number(message.yaw)
      const yaw = Number.isFinite(rawYaw) ? Math.atan2(Math.sin(rawYaw), Math.cos(rawYaw)) : previous?.yaw ?? 0
      const animation = typeof message.animation === 'string' && PLAYER_ANIMATIONS.has(message.animation) ? message.animation : previous?.animation ?? 'Armature|Idle_Loop'
      const requestedHeld = typeof message.heldItem === 'string' && DISPLAYABLE_ITEMS.has(message.heldItem as ItemId) ? message.heldItem as ItemId : null
      const heldItem = requestedHeld && (minigameOpen || this.accountHas(this.accountForSession(client.sessionId), requestedHeld)) ? requestedHeld : null
      const nickname = typeof message.nickname === 'string' ? message.nickname.trim().replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 18) : previous?.nickname
      const account = this.accountForSession(client.sessionId)
      account.lastSeenAt = now
      const minigameScore = minigameOpen ? this.eventScoreFor(account.profileId, minigameMilestone, minigameKind!) : undefined
      const progressValue = this.accountProgress(account)
      const stats = { ...account.stats }
      const presence = { id: client.sessionId, nickname: nickname || `Player ${client.sessionId.slice(0, 4)}`, zone, position: safePosition, yaw, animation, heldItem, cash: account.cash, progressValue, stats, minigameOpen, minigameKind, minigameMilestone: minigameOpen ? minigameMilestone : undefined, minigameScore, eventBay, seenAt: now }
      this.players.set(client.sessionId, presence)
      if (this.orePauseStartedAt && ![...this.players.values()].some((entry) => entry.minigameOpen)) this.resumeOreRespawns()
      if (eventBay !== undefined && previous?.eventBay !== eventBay) this.sendTo(client.sessionId, 'minigame:bay', { bay: eventBay })
      this.broadcast('presence:move', presence, { except: client })
    })
    this.onMessage('mine:request', (client, message: { id?: string; tool?: string; enhancement?: number }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const id = message?.id
      const site = id ? MINE_NODE_BY_ID.get(id) : null
      const player = this.players.get(client.sessionId)
      const deny = (reason: 'invalid' | 'wrong-zone' | 'too-far' | 'paused' | 'tier' | 'not-owned') => client.send('mine:denied', this.withAccount(client, { id, reason }, { type: 'mine', key: id, ok: false, reason }))
      if (!id || !site || !player) return deny('invalid')
      if (player.zone !== 'mine' || player.minigameOpen) return deny('wrong-zone')
      if (this.orePauseStartedAt) return deny('paused')
      if (Math.hypot(player.position[0] - site.x, player.position[2] - site.z) > 5.5) return deny('too-far')
      const node = this.oreNodes.get(id)
      if (!node) return
      if (node.readyAt > Date.now()) {
        client.send('mine:node', { id, ...node })
        return
      }
      if (node.readyAt > 0) node.readyAt = 0
      const ore = oreKindAtDepth(id, site.z, node.generation, this.matchSeed)
      const tool = typeof message.tool === 'string' && HELD_PICKAXES.has(message.tool as PickaxeItem) ? message.tool as PickaxeItem : null
      const account = this.accountForSession(client.sessionId)
      if (!tool || !this.accountHas(account, tool)) return deny('not-owned')
      if (!canMineOre(tool, ore)) {
        deny('tier')
        return
      }
      const quantity = miningYield(tool, Math.random(), 0)
      const nextGeneration = node.generation + 1
      const readyAt = Date.now() + oreRespawnMs(id, nextGeneration, this.matchSeed)
      const next = { generation: nextGeneration, readyAt }
      this.oreNodes.set(id, next)
      this.changeInventory(account, ore, quantity)
      account.stats.mined += quantity
      this.bumpAccount(account)
      this.broadcast('mine:node', { id, ...next })
      client.send('mine:award', this.withAccount(client, { id, ore, quantity, tool, ...next }, { type: 'mine', key: id, ok: true, itemId: ore, quantity }))
      this.scheduleOreRespawn(id)
    })
    this.onMessage('forage:request', (client, message: { id?: string; item?: string; remainingCapacity?: number; position?: unknown }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const id = typeof message?.id === 'string' ? message.id : ''
      const item = typeof message?.item === 'string' ? message.item : ''
      const definition = FORAGE_NODE_BY_ID.get(id)
      const deny = (reason: 'invalid-id' | 'invalid-item' | 'item-mismatch' | 'wrong-zone' | 'too-far' | 'no-capacity' | 'depleted') => client.send('forage:denied', this.withAccount(client, { id, item, reason }, { type: 'forage', key: id, ok: false, reason }))
      if (!definition) return deny('invalid-id')
      if (item !== 'apple' && item !== 'orange' && item !== 'truffle' && item !== 'natural-discovery') return deny('invalid-item')
      if (item !== definition.item) return deny('item-mismatch')
      const player = this.players.get(client.sessionId)
      if (!player || player.zone !== 'forage' || player.minigameOpen) return deny('wrong-zone')
      const serverDistance = Math.hypot(player.position[0] - definition.x, player.position[2] - definition.z)
      const claimed = Array.isArray(message.position) && message.position.length === 3 && message.position.every((value) => Number.isFinite(value))
        ? message.position as [number, number, number]
        : null
      const claimedDistance = claimed ? Math.hypot(claimed[0] - definition.x, claimed[2] - definition.z) : Number.POSITIVE_INFINITY
      const positionDrift = claimed ? Math.hypot(claimed[0] - player.position[0], claimed[2] - player.position[2]) : Number.POSITIVE_INFINITY
      // A harvest can land between the 100 ms presence ticks. Accept the live
      // action position only when it remains close to both the last verified
      // position and the selected tree; this keeps the interaction forgiving
      // without allowing remote collection.
      if (serverDistance > 5.5 && (!claimed || positionDrift > 2.25 || claimedDistance > 4.1)) return deny('too-far')
      const account = this.accountForSession(client.sessionId)
      const basket = account.inventory['master-basket'] ? 'master-basket' : account.inventory['reinforced-basket'] ? 'reinforced-basket' : account.inventory.basket ? 'basket' : 'hand'
      const fruitCapacity = basket === 'hand' ? BASKET_CONFIG.hand.capacity : BASKET_CONFIG[basket].capacity
      const fruitStored = (account.inventory.apple ?? 0) + (account.inventory.orange ?? 0)
      const isFruit = definition.item === 'apple' || definition.item === 'orange'
      const remainingCapacity = isFruit ? fruitCapacity - fruitStored : 1
      if (remainingCapacity <= 0) return deny('no-capacity')
      const node = this.forageNodes.get(id)
      if (!node) return deny('invalid-id')
      const now = Date.now()
      const available = this.forageAvailability(node, now)
      if (available <= 0) {
        client.send('forage:node', this.forageNodePayload(node, now))
        return deny('depleted')
      }
      const quantity = Math.min(available, remainingCapacity)
      if (node.rare) {
        node.rareAvailable = false
        node.fullAt = nextRareForageRollAt(node.item === 'truffle' ? 'truffle' : 'natural-discovery', false, this.matchStartedAt || now, now)
      } else {
        const remaining = available - quantity
        node.fullAt = remaining >= node.capacity ? 0 : now + (node.capacity - remaining) * FORAGE_REGROW_MS
      }
      const payload = this.forageNodePayload(node, now)
      this.broadcast('forage:node', payload)
      this.changeInventory(account, definition.item, quantity)
      account.stats.foraged += quantity
      this.bumpAccount(account)
      client.send('forage:award', this.withAccount(client, { ...payload, quantity }, { type: 'forage', key: id, ok: true, itemId: definition.item, quantity }))
      if (!node.rare) this.scheduleForageRegrowth(id)
    })
    this.onMessage('shop:buy', (client, message: { requestId?: string; itemId?: string; quantity?: number; shopKind?: string }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const requestId = this.marketRequestId(message?.requestId)
      if (!requestId) return
      const profileId = this.profileIdFor(client.sessionId)
      const results = this.shopResults.get(profileId) ?? new Map<string, { requestId: string; ok: boolean; itemId?: ItemId; quantity: number; reason?: string }>()
      const prior = results.get(requestId)
      if (prior) {
        const action: AccountAction = { type: 'shop', requestId, key: prior.itemId, ok: prior.ok, reason: prior.reason, itemId: prior.itemId, quantity: prior.quantity }
        return this.sendAccountRefresh(client, action)
      }
      const itemId = typeof message?.itemId === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, message.itemId) ? message.itemId as ItemId : null
      const quantity = Math.max(0, Math.min(99, Math.floor(Number(message?.quantity) || 0)))
      const fail = (reason: string) => {
        const result = { requestId, ok: false, itemId: itemId ?? undefined, quantity: 0, reason }
        results.set(requestId, result)
        while (results.size > 128) results.delete(results.keys().next().value!)
        this.shopResults.set(profileId, results)
        this.sendAccountRefresh(client, { type: 'shop', requestId, key: itemId ?? undefined, ok: false, reason, itemId: itemId ?? undefined, quantity: 0 })
      }
      if (!itemId || !quantity) return fail('Invalid purchase')
      const shopKind = typeof message?.shopKind === 'string' && message.shopKind in SHOP_ZONE ? message.shopKind as Extract<ShopKind, keyof typeof SHOP_ZONE> : null
      const player = this.players.get(client.sessionId)
      if (!player || !shopKind || SHOP_ZONE[shopKind] !== player.zone || !SHOPS[shopKind].items.includes(itemId)) return fail('Wrong shop')
      if (itemId === 'farm-deed' || itemId === 'shared-farm-deed') return fail('Use the deed counter')
      const definition = ITEMS[itemId]
      if (!definition.buyPrice || definition.sellPrice) return fail('Unavailable')
      const account = this.accountForSession(client.sessionId)
      if (UNIQUE_SHOP_ITEMS.has(itemId) && (account.inventory[itemId] ?? 0) > 0) return fail('Already owned')
      if (itemId === 'furnace' && ![...this.farms.values()].some((farm) => farm.ownerId === client.sessionId)) return fail('Own a farm first')
      const affordable = Math.min(quantity, Math.floor(account.cash / definition.buyPrice))
      if (affordable <= 0) return fail('Not enough coins')
      account.cash -= definition.buyPrice * affordable
      this.changeInventory(account, itemId, affordable)
      this.bumpAccount(account)
      const result = { requestId, ok: true, itemId, quantity: affordable }
      results.set(requestId, result)
      while (results.size > 128) results.delete(results.keys().next().value!)
      this.shopResults.set(profileId, results)
      this.sendAccountRefresh(client, { type: 'shop', requestId, key: itemId, ok: true, itemId, quantity: affordable, total: definition.buyPrice * affordable })
    })
    this.onMessage('merchant:request', (client) => {
      if (!this.sessionIsActive(client.sessionId)) return
      this.sendMerchantSnapshot(client)
    })
    this.onMessage('merchant:buy', (client, message: { requestId?: string; cycleId?: string; itemId?: MerchantItemId }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const requestId = typeof message?.requestId === 'string' ? message.requestId.slice(0, 80) : ''
      if (!requestId) return
      const profileId = this.profileIdFor(client.sessionId)
      const results = this.merchantResults.get(profileId) ?? new Map<string, MerchantPurchaseResult>()
      const prior = results.get(requestId)
      if (prior) return client.send('merchant:result', this.withAccount(client, prior, { type: 'merchant', requestId, key: prior.itemId, ok: prior.ok, reason: prior.reason, itemId: prior.itemId, quantity: prior.ok ? 1 : 0, total: prior.price }))
      const cycle = this.currentMerchant()
      const fail = (reason: string) => {
        const result: MerchantPurchaseResult = { requestId, ok: false, reason, cycle: cycle ?? undefined }
        results.set(requestId, result)
        while (results.size > 64) results.delete(results.keys().next().value!)
        this.merchantResults.set(profileId, results)
        client.send('merchant:result', this.withAccount(client, result, { type: 'merchant', requestId, ok: false, reason, quantity: 0 }))
      }
      if (!cycle || cycle.id !== message.cycleId) return fail('Stock changed')
      const itemId = message.itemId
      if (!itemId) return fail('Unavailable')
      const offer = cycle.inventory.find((entry) => entry.id === itemId)
      if (!offer) return fail('Unavailable')
      const account = this.accountForSession(client.sessionId)
      if (account.cash < offer.price) return fail('Not enough coins')
      const purchase = consumeMerchantStock(cycle, itemId)
      if (!purchase.ok) return fail(purchase.reason === 'sold-out' ? 'Sold out' : 'Unavailable')
      this.merchantCycleState = purchase.cycle
      account.cash -= offer.price
      this.changeInventory(account, itemId as ItemId, 1)
      this.bumpAccount(account)
      const result: MerchantPurchaseResult = { requestId, ok: true, itemId, price: offer.price, cycle: purchase.cycle }
      results.set(requestId, result)
      while (results.size > 64) results.delete(results.keys().next().value!)
      this.merchantResults.set(profileId, results)
      client.send('merchant:result', this.withAccount(client, result, { type: 'merchant', requestId, key: itemId, ok: true, itemId, quantity: 1, total: offer.price }))
      this.broadcast('merchant:snapshot', purchase.cycle)
    })
    this.onMessage('market:commodity-sell', (client, message: { requestId?: string; itemId?: string; quantity?: number }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const requestId = this.marketRequestId(message?.requestId)
      if (!requestId) return
      const prior = this.priorMarketTransaction(client, requestId)
      if (prior) return client.send('market:result', this.withAccount(client, prior, { type: 'market', requestId, key: prior.itemId, ok: prior.ok, ...(prior.reason ? { reason: prior.reason } : {}), itemId: prior.itemId, quantity: prior.quantity, total: prior.total }))
      const itemId = typeof message?.itemId === 'string' && message.itemId in COMMODITY_MARKET_CONFIG ? message.itemId as CommodityId : null
      const quantity = Math.max(0, Math.min(10_000, Math.floor(Number(message?.quantity) || 0)))
      const fail = (reason: string) => {
        const result: MarketTransactionResult = { requestId, ok: false, kind: 'commodity', reason, itemId: itemId ?? undefined, quantity: 0, total: 0, revision: this.marketRevision }
        this.rememberMarketTransaction(client, result)
        client.send('market:result', this.withAccount(client, result, { type: 'market', requestId, key: itemId ?? undefined, ok: false, reason, itemId: itemId ?? undefined, quantity: 0 }))
      }
      const player = this.players.get(client.sessionId)
      if (!this.matchStarted || !player || player.minigameOpen) return fail('closed')
      if (!itemId || !ITEMS[itemId].sellPrice || !quantity) return fail('invalid')
      const account = this.accountForSession(client.sessionId)
      if (!this.accountHas(account, itemId, quantity)) return fail('not-owned')
      this.advanceMarket()
      const sale = settleCommoditySale(itemId, ITEMS[itemId].sellPrice!, this.commodityMarket[itemId], this.commodityPending[itemId] ?? 0, quantity)
      if (sale.shock) this.commodityMarket = { ...this.commodityMarket, [itemId]: sale.quotedStock }
      this.commodityPending = { ...this.commodityPending, [itemId]: sale.pendingSupply }
      this.changeInventory(account, itemId, -quantity)
      account.cash = Math.min(ACCOUNT_MAX_CASH, account.cash + sale.proceeds)
      account.stats.sold += quantity
      this.bumpAccount(account)
      this.marketRevision += 1
      const result: MarketTransactionResult = { requestId, ok: true, kind: 'commodity', itemId, quantity, total: sale.proceeds, revision: this.marketRevision }
      this.rememberMarketTransaction(client, result)
      this.broadcastMarketSnapshot()
      client.send('market:result', this.withAccount(client, result, { type: 'market', requestId, key: itemId, ok: true, itemId, quantity, total: sale.proceeds }))
    })
    this.onMessage('market:food-sell', (client, message: { requestId?: string; recipeId?: string; quantity?: number }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const requestId = this.marketRequestId(message?.requestId)
      if (!requestId) return
      const prior = this.priorMarketTransaction(client, requestId)
      if (prior) return client.send('market:result', this.withAccount(client, prior, { type: 'market', requestId, key: prior.recipeId, ok: prior.ok, ...(prior.reason ? { reason: prior.reason } : {}), quantity: prior.quantity, total: prior.total }))
      const recipeId = typeof message?.recipeId === 'string' && RECIPE_IDS.includes(message.recipeId as RecipeId) ? message.recipeId as RecipeId : null
      const quantity = Math.max(0, Math.min(10_000, Math.floor(Number(message?.quantity) || 0)))
      const fail = (reason: string) => {
        const result: MarketTransactionResult = { requestId, ok: false, kind: 'food', reason, recipeId: recipeId ?? undefined, quantity: 0, total: 0, revision: this.marketRevision }
        this.rememberMarketTransaction(client, result)
        client.send('market:result', this.withAccount(client, result, { type: 'market', requestId, key: recipeId ?? undefined, ok: false, reason, quantity: 0 }))
      }
      const player = this.players.get(client.sessionId)
      if (!this.matchStarted || !player || player.minigameOpen) return fail('closed')
      if (!recipeId || !quantity) return fail('invalid')
      const food = RECIPES[recipeId].food as ItemId
      const account = this.accountForSession(client.sessionId)
      if (!this.accountHas(account, food, quantity)) return fail('not-owned')
      this.advanceMarket()
      let stock = this.foodMarket[recipeId]
      let proceeds = 0
      for (let index = 0; index < quantity; index += 1) {
        proceeds += preparedFoodValue(recipeId, this.commodityMarket, stock)
        stock += 1
      }
      this.foodMarket = { ...this.foodMarket, [recipeId]: stock }
      this.changeInventory(account, food, -quantity)
      account.cash = Math.min(ACCOUNT_MAX_CASH, account.cash + proceeds)
      account.stats.sold += quantity
      this.bumpAccount(account)
      this.marketRevision += 1
      const result: MarketTransactionResult = { requestId, ok: true, kind: 'food', recipeId, quantity, total: proceeds, revision: this.marketRevision }
      this.rememberMarketTransaction(client, result)
      this.broadcastMarketSnapshot()
      client.send('market:result', this.withAccount(client, result, { type: 'market', requestId, key: recipeId, ok: true, quantity, total: proceeds }))
    })
    this.onMessage('market:stock-trade', (client, message: { requestId?: string; stockId?: string; direction?: 'buy' | 'sell'; quantity?: number }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const requestId = this.marketRequestId(message?.requestId)
      if (!requestId) return
      const prior = this.priorMarketTransaction(client, requestId)
      if (prior) return client.send('market:result', this.withAccount(client, prior, { type: 'market', requestId, key: prior.stockId, ok: prior.ok, ...(prior.reason ? { reason: prior.reason } : {}), stockId: prior.stockId, direction: prior.direction, quantity: prior.quantity, total: prior.total }))
      const stockId = typeof message?.stockId === 'string' && STOCK_IDS.includes(message.stockId as StockId) ? message.stockId as StockId : null
      const direction = message?.direction === 'sell' ? 'sell' as const : 'buy' as const
      const requested = Math.max(0, Math.min(10_000, Math.floor(Number(message?.quantity) || 0)))
      const fail = (reason: string) => {
        const result: MarketTransactionResult = { requestId, ok: false, kind: 'stock', reason, stockId: stockId ?? undefined, direction, quantity: 0, total: 0, revision: this.marketRevision }
        this.rememberMarketTransaction(client, result)
        client.send('market:result', this.withAccount(client, result, { type: 'market', requestId, key: stockId ?? undefined, ok: false, reason, stockId: stockId ?? undefined, direction, quantity: 0 }))
      }
      const player = this.players.get(client.sessionId)
      if (!this.matchStarted || !player || player.minigameOpen) return fail('closed')
      if (!stockId || !requested) return fail('invalid')
      this.advanceMarket()
      if (!stockAvailable(STOCKS[stockId], this.marketElapsedSecond)) return fail('closed')
      const quantity = direction === 'buy' ? Math.min(requested, this.stockSupply[stockId]) : requested
      if (!quantity) return fail('sold-out')
      const total = this.stockPrices[stockId] * quantity
      const account = this.accountForSession(client.sessionId)
      if (direction === 'buy' && account.cash < total) return fail('not-enough-cash')
      if (direction === 'sell' && (account.portfolio[stockId] ?? 0) < quantity) return fail('not-owned')
      this.stockSupply = { ...this.stockSupply, [stockId]: this.stockSupply[stockId] + (direction === 'buy' ? -quantity : quantity) }
      if (direction === 'buy') {
        account.cash -= total
        account.portfolio[stockId] = (account.portfolio[stockId] ?? 0) + quantity
      } else {
        account.portfolio[stockId] = Math.max(0, (account.portfolio[stockId] ?? 0) - quantity)
        account.cash = Math.min(ACCOUNT_MAX_CASH, account.cash + total)
      }
      this.bumpAccount(account)
      this.marketRevision += 1
      const result: MarketTransactionResult = { requestId, ok: true, kind: 'stock', stockId, direction, quantity, total, revision: this.marketRevision }
      this.rememberMarketTransaction(client, result)
      this.broadcastMarketSnapshot()
      client.send('market:result', this.withAccount(client, result, { type: 'market', requestId, key: stockId, ok: true, stockId, direction, quantity, total }))
    })
    this.onMessage('deed:purchase', (client, message: { requestId?: string; quantity?: number; kind?: 'personal' | 'global' }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const requestId = this.marketRequestId(message?.requestId)
      if (!requestId) return
      const profileId = this.profileIdFor(client.sessionId)
      const results = this.deedResults.get(profileId) ?? new Map<string, DeedResult>()
      const prior = results.get(requestId)
      if (prior) return client.send('deed:result', this.withAccount(client, prior, { type: 'deed', requestId, key: prior.quantity > 0 ? 'farm-deed' : undefined, ok: prior.ok, reason: prior.reason, quantity: prior.quantity }))
      const requested = Math.max(1, Math.min(Math.max(1, this.configuredGlobalExpansionDeeds), Math.floor(Number(message?.quantity) || 1)))
      const kind = message?.kind === 'global' ? 'global' : 'personal'
      const account = this.accountForSession(client.sessionId)
      const deedPrice = ITEMS['farm-deed'].buyPrice ?? 0
      let personalCount = 0
      let globalCount = 0
      let reason: string | undefined
      if (kind === 'personal') {
        if (account.personalDeedOwned) reason = 'Already owned'
        else if (account.cash < deedPrice) reason = 'Not enough coins'
        else personalCount = 1
      } else if (!account.personalDeedOwned) {
        reason = 'Buy personal deed first'
      } else if (this.globalDeedsRemaining <= 0) {
        reason = 'Sold out'
      } else {
        globalCount = Math.min(requested, this.globalDeedsRemaining, Math.floor(account.cash / (ITEMS['shared-farm-deed'].buyPrice ?? deedPrice)))
        if (!globalCount) reason = 'Not enough coins'
      }
      const quantity = personalCount + globalCount
      if (quantity > 0) {
        const total = quantity * deedPrice
        account.cash -= total
        account.personalDeedOwned ||= personalCount > 0
        account.deedEntitlement += quantity
        this.changeInventory(account, kind === 'personal' ? 'farm-deed' : 'shared-farm-deed', quantity)
        this.globalDeedsRemaining -= globalCount
        this.bumpAccount(account)
      }
      const result: DeedResult = {
        requestId,
        ok: quantity > 0,
        quantity,
        personalCount,
        globalCount,
        personalAvailable: !account.personalDeedOwned,
        globalRemaining: this.globalDeedsRemaining,
        reason: quantity > 0 ? undefined : reason,
      }
      results.set(requestId, result)
      while (results.size > 64) results.delete(results.keys().next().value!)
      this.deedResults.set(profileId, results)
      client.send('deed:result', this.withAccount(client, result, { type: 'deed', requestId, key: quantity > 0 ? kind === 'personal' ? 'farm-deed' : 'shared-farm-deed' : undefined, ok: result.ok, reason: result.reason, quantity }))
      if (globalCount > 0) this.broadcast('deed:stock', { globalRemaining: this.globalDeedsRemaining })
    })
    this.onMessage('farm:action', (client, message: { requestId?: string; op?: 'claim' | 'plant' | 'water' | 'harvest' | 'rain'; farmId?: number; cellIndex?: number; crop?: CropKind; watered?: boolean }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const requestId = this.marketRequestId(message?.requestId)
      const op = message?.op
      const farmId = Math.floor(Number(message?.farmId))
      const cellIndex = Math.floor(Number(message?.cellIndex))
      if (!requestId || !op || !['claim', 'plant', 'water', 'harvest', 'rain'].includes(op) || !Number.isInteger(farmId) || farmId < 0 || farmId >= FARM_CENTERS.length) return
      const profileId = this.profileIdFor(client.sessionId)
      const results = this.farmResults.get(profileId) ?? new Map<string, FarmResult>()
      const prior = results.get(requestId)
      if (prior) return client.send('farm:result', this.withAccount(client, prior, { type: 'farm', requestId, key: `${prior.farmId ?? farmId}:${prior.cellIndex ?? ''}`, ok: prior.ok, reason: prior.reason, itemId: prior.crop, quantity: prior.quantity }))
      const respond = (result: Omit<FarmResult, 'requestId'>) => {
        const payload: FarmResult = { requestId, op, farmId, ...result }
        results.set(requestId, payload)
        while (results.size > 128) results.delete(results.keys().next().value!)
        this.farmResults.set(profileId, results)
        client.send('farm:result', this.withAccount(client, payload, { type: 'farm', requestId, key: `${farmId}:${cellIndex}`, ok: payload.ok, reason: payload.reason, itemId: payload.crop, quantity: payload.quantity }))
      }
      const player = this.players.get(client.sessionId)
      const farm = this.farms.get(farmId)!
      const account = this.accountForSession(client.sessionId)
      if (TEST_FARM_FIXTURES) console.log('test farm state', client.sessionId, player?.zone, player?.position, account.deedEntitlement, account.inventory)
      if (!player || player.zone !== 'farm' || player.minigameOpen) return respond({ ok: false, reason: 'Return to the farm' })
      const [centerX, centerZ] = FARM_CENTERS[farmId]
      if (op === 'claim') {
        if (Math.hypot(player.position[0] - (centerX + 5.85), player.position[2] - (centerZ + 6.25)) > 5) return respond({ ok: false, reason: 'Move closer' })
        if (farm.ownerId && farm.ownerId !== client.sessionId) return respond({ ok: false, reason: 'Farm already claimed' })
        if (farm.ownerId === client.sessionId) return respond({ ok: false, reason: 'Your farm' })
        const ownedFarms = [...account.ownedFarms].length
        if (ownedFarms >= 3) return respond({ ok: false, reason: 'Farm limit reached' })
        const deedItem = account.inventory['farm-deed'] ? 'farm-deed' : account.inventory['shared-farm-deed'] ? 'shared-farm-deed' : null
        if (!deedItem || account.deedEntitlement <= 0) return respond({ ok: false, reason: 'Need a farm deed' })
        this.changeInventory(account, deedItem, -1)
        account.deedEntitlement = Math.max(0, account.deedEntitlement - 1)
        account.ownedFarms.add(farmId)
        farm.ownerId = client.sessionId
        this.bumpAccount(account)
        this.broadcast('farm:update', { farmId, ownerId: client.sessionId })
        return respond({ ok: true })
      }
      if (farm.ownerId !== client.sessionId) return respond({ ok: false, reason: 'Not your farm' })
      if (op === 'rain') {
        if (!this.accountHas(account, 'rain-bottle')) return respond({ ok: false, reason: 'Need a rain bottle' })
        const dryCells = [...farm.cells.entries()].filter(([, cell]) => cell.stage === 'planted' && cell.crop)
        if (!dryCells.length) return respond({ ok: false, reason: 'No dry crops' })
        this.changeInventory(account, 'rain-bottle', -1)
        this.bumpAccount(account)
        for (const [index, current] of dryCells) {
          const cell: SharedFarmCell = { ...current, stage: 'watered', readyAt: Date.now() + farmGrowthMs(current.crop!) }
          farm.cells.set(index, cell)
          this.broadcast('farm:update', { farmId, cellIndex: index, cell })
          this.scheduleFarmReady(farmId, index)
        }
        return respond({ ok: true })
      }
      if (cellIndex < 0 || cellIndex >= 64) return respond({ ok: false, reason: 'Invalid plot' })
      const column = cellIndex % 8
      const row = Math.floor(cellIndex / 8)
      const cellX = centerX + (column - 3.5) * 1.42
      const cellZ = centerZ + (row - 3.5) * 1.42
      if (Math.hypot(player.position[0] - cellX, player.position[2] - cellZ) > 4.6) return respond({ ok: false, reason: 'Move closer' })
      const current = farm.cells.get(cellIndex) ?? { crop: null, stage: 'empty' as const, readyAt: null }
      if (op === 'plant') {
        const crop = message.crop
        if (current.stage !== 'empty' || !crop || !CROP_IDS.has(crop)) return respond({ ok: false, reason: current.stage !== 'empty' ? 'Plot occupied' : 'Select seeds' })
        const seed = `${crop}-seeds` as ItemId
        if (!this.accountHas(account, seed)) return respond({ ok: false, reason: 'Need seeds' })
        const watered = this.marketWeather === 'rain'
        this.changeInventory(account, seed, -1)
        this.bumpAccount(account)
        const cell: SharedFarmCell = { crop, stage: watered ? 'watered' : 'planted', readyAt: watered ? Date.now() + farmGrowthMs(crop) : null }
        farm.cells.set(cellIndex, cell)
        this.broadcast('farm:update', { farmId, cellIndex, cell })
        if (watered) this.scheduleFarmReady(farmId, cellIndex)
        return respond({ ok: true, reason: watered ? 'watered' : undefined, cellIndex, crop })
      }
      if (op === 'water') {
        if (current.stage !== 'planted' || !current.crop) return respond({ ok: false, reason: current.stage === 'ready' ? 'Ready to harvest' : 'Cannot water' })
        if (!this.accountHas(account, 'water-can')) return respond({ ok: false, reason: 'Need a watering can' })
        const cell: SharedFarmCell = { ...current, stage: 'watered', readyAt: Date.now() + farmGrowthMs(current.crop) }
        farm.cells.set(cellIndex, cell)
        this.broadcast('farm:update', { farmId, cellIndex, cell })
        this.scheduleFarmReady(farmId, cellIndex)
        return respond({ ok: true, cellIndex, crop: current.crop })
      }
      const ready = current.stage === 'ready' || current.stage === 'watered' && Boolean(current.readyAt && current.readyAt <= Date.now())
      if (!ready || !current.crop) return respond({ ok: false, reason: current.stage === 'watered' ? `${Math.max(1, Math.ceil(((current.readyAt ?? Date.now()) - Date.now()) / 1000))}s` : 'Nothing to harvest' })
      const crop = current.crop
      farm.cells.delete(cellIndex)
      const timer = this.farmTimers.get(`${farmId}:${cellIndex}`)
      if (timer) clearTimeout(timer)
      this.farmTimers.delete(`${farmId}:${cellIndex}`)
      this.broadcast('farm:update', { farmId, cellIndex, cell: null })
      const quantity = CROP_CONFIG[crop].yield
      this.changeInventory(account, crop as ItemId, quantity)
      account.stats.harvested += quantity
      this.bumpAccount(account)
      return respond({ ok: true, cellIndex, crop, quantity })
    })
    this.onMessage('farm:rain', (client) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const player = this.players.get(client.sessionId)
      if (!player || player.zone !== 'farm' || player.minigameOpen) return
      if (RAIN_CYCLE_COOLDOWN_MS > 0 && (!this.matchStarted || Date.now() - this.lastRainAt < RAIN_CYCLE_COOLDOWN_MS)) return
      const account = this.accountForSession(client.sessionId)
      if (this.marketWeather !== 'rain') {
        if (!this.accountHas(account, 'rain-bottle')) return
        this.changeInventory(account, 'rain-bottle', -1)
        this.bumpAccount(account)
      }
      this.waterFarmsFromRain(Date.now())
    })
    this.onMessage('cook:queue', (client, message: { requestId?: string; recipeId?: string; quantity?: number; furnaceIndex?: number }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const requestId = this.marketRequestId(message?.requestId)
      if (!requestId) return
      const profileId = this.profileIdFor(client.sessionId)
      const results = this.cookResults.get(profileId) ?? new Map<string, CookResult>()
      const prior = results.get(requestId)
      if (prior) return client.send('cook:result', this.withAccount(client, prior, { type: 'cook', requestId, key: prior.recipeId, ok: prior.ok, reason: prior.reason, itemId: prior.itemId, quantity: prior.quantity }))
      const recipeId = typeof message?.recipeId === 'string' && RECIPE_IDS.includes(message.recipeId as RecipeId) ? message.recipeId as RecipeId : null
      const furnaceIndex = Math.floor(Number(message?.furnaceIndex))
      const account = this.accountForSession(client.sessionId)
      const respond = (result: Omit<CookResult, 'requestId' | 'op'>) => {
        const payload: CookResult = { requestId, op: 'queue', ...result }
        results.set(requestId, payload)
        while (results.size > 128) results.delete(results.keys().next().value!)
        this.cookResults.set(profileId, results)
        client.send('cook:result', this.withAccount(client, payload, { type: 'cook', requestId, key: payload.recipeId, ok: payload.ok, reason: payload.reason, itemId: payload.itemId, quantity: payload.quantity }))
      }
      const player = this.players.get(client.sessionId)
      if (!this.matchStarted || !player || player.zone !== 'farm' || player.minigameOpen || this.orePauseStartedAt) return respond({ ok: false, reason: 'Use a farm furnace', recipeId: recipeId ?? undefined, quantity: 0 })
      if (!recipeId || !Number.isInteger(furnaceIndex) || !account.ownedFarms.has(furnaceIndex) || !this.accountHas(account, 'furnace')) return respond({ ok: false, reason: 'Use a farm furnace', recipeId: recipeId ?? undefined, quantity: 0 })
      const pending = account.cookQueue.filter((job) => job.furnaceIndex === furnaceIndex && job.readyAt > Date.now())
      if (pending.length >= 3) return respond({ ok: false, reason: 'Furnace queue full', recipeId, quantity: 0 })
      const recipe = RECIPES[recipeId]
      const ingredients = Object.entries(recipe.ingredients) as Array<[ItemId, number]>
      const ingredientLimit = Math.min(...ingredients.map(([item, amount]) => Math.floor((account.inventory[item] ?? 0) / amount)))
      const batchCapacity = Math.max(10, (account.inventory.furnace ?? 1) * 10)
      const quantity = Math.max(0, Math.min(batchCapacity, Math.floor(Number(message?.quantity) || 0), ingredientLimit))
      if (quantity < 1) return respond({ ok: false, reason: 'Missing ingredients', recipeId, quantity: 0 })
      ingredients.forEach(([item, amount]) => this.changeInventory(account, item, -amount * quantity))
      const lastReady = pending.at(-1)?.readyAt ?? Date.now()
      account.cookQueue.push({ id: `cook-${profileId}-${requestId}`, recipe: recipeId, quantity, furnaceIndex, readyAt: Math.max(Date.now(), lastReady) + (TEST_COOK_DURATION_MS || recipe.cookSeconds * 1000) })
      this.bumpAccount(account)
      respond({ ok: true, recipeId, quantity })
    })
    this.onMessage('cook:collect', (client, message: { requestId?: string; recipeId?: string; furnaceIndex?: number }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const requestId = this.marketRequestId(message?.requestId)
      if (!requestId) return
      const profileId = this.profileIdFor(client.sessionId)
      const results = this.cookResults.get(profileId) ?? new Map<string, CookResult>()
      const prior = results.get(requestId)
      if (prior) return client.send('cook:result', this.withAccount(client, prior, { type: 'cook', requestId, key: prior.recipeId, ok: prior.ok, reason: prior.reason, itemId: prior.itemId, quantity: prior.quantity }))
      const requestedRecipe = typeof message?.recipeId === 'string' && RECIPE_IDS.includes(message.recipeId as RecipeId) ? message.recipeId as RecipeId : null
      const furnaceIndex = Math.floor(Number(message?.furnaceIndex))
      const account = this.accountForSession(client.sessionId)
      const respond = (result: Omit<CookResult, 'requestId' | 'op'>) => {
        const payload: CookResult = { requestId, op: 'collect', ...result }
        results.set(requestId, payload)
        while (results.size > 128) results.delete(results.keys().next().value!)
        this.cookResults.set(profileId, results)
        client.send('cook:result', this.withAccount(client, payload, { type: 'cook', requestId, key: payload.recipeId, ok: payload.ok, reason: payload.reason, itemId: payload.itemId, quantity: payload.quantity }))
      }
      const player = this.players.get(client.sessionId)
      if (!this.matchStarted || !player || player.zone !== 'farm' || player.minigameOpen || !Number.isInteger(furnaceIndex) || !account.ownedFarms.has(furnaceIndex)) return respond({ ok: false, reason: 'Use a farm furnace', recipeId: requestedRecipe ?? undefined, quantity: 0 })
      const now = Date.now()
      const completed = account.cookQueue.filter((job) => job.furnaceIndex === furnaceIndex && job.readyAt <= now && (!requestedRecipe || job.recipe === requestedRecipe))
      if (!completed.length) return respond({ ok: false, reason: 'Nothing ready', recipeId: requestedRecipe ?? undefined, quantity: 0 })
      const completedIds = new Set(completed.map((job) => job.id))
      const totals = new Map<ItemId, number>()
      completed.forEach((job) => {
        const food = RECIPES[job.recipe].food as ItemId
        totals.set(food, (totals.get(food) ?? 0) + job.quantity)
      })
      totals.forEach((quantity, item) => this.changeInventory(account, item, quantity))
      account.cookQueue = account.cookQueue.filter((job) => !completedIds.has(job.id))
      this.bumpAccount(account)
      const quantity = [...totals.values()].reduce((sum, value) => sum + value, 0)
      const itemId = totals.size === 1 ? [...totals.keys()][0] : undefined
      respond({ ok: true, recipeId: requestedRecipe ?? completed[0]?.recipe, quantity, itemId })
    })
    this.onMessage('trade:request', (client, message: { targetId?: string }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const targetId = message?.targetId
      const sender = this.players.get(client.sessionId)
      const target = targetId ? this.players.get(targetId) : null
      if (!targetId || targetId === client.sessionId || !sender || !target || sender.minigameOpen || target.minigameOpen) return
      this.sendTo(targetId, 'trade:request', { fromId: client.sessionId, fromNickname: this.players.get(client.sessionId)?.nickname })
    })
    this.onMessage('trade:accept', (client, message: { fromId?: string }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const fromId = message?.fromId
      const sender = fromId ? this.players.get(fromId) : null
      const receiver = this.players.get(client.sessionId)
      if (!fromId || !sender || !receiver || sender.minigameOpen || receiver.minigameOpen) return
      const id = `trade-${Date.now()}-${client.sessionId.slice(0, 4)}`
      const empty = () => ({ cash: 0, items: {} })
      const trade: TradeSession = { id, a: fromId, b: client.sessionId, offers: { [fromId]: empty(), [client.sessionId]: empty() }, ready: { [fromId]: false, [client.sessionId]: false } }
      this.trades.set(id, trade)
      for (const playerId of [trade.a, trade.b]) this.sendTo(playerId, 'trade:opened', { tradeId: id, partnerId: this.other(trade, playerId), partnerNickname: this.players.get(this.other(trade, playerId))?.nickname })
    })
    this.onMessage('trade:update', (client, message: { tradeId?: string; offer?: TradeOffer; ready?: boolean }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const trade = message?.tradeId ? this.trades.get(message.tradeId) : null
      if (!trade || (trade.a !== client.sessionId && trade.b !== client.sessionId)) return
      if (this.players.get(trade.a)?.minigameOpen || this.players.get(trade.b)?.minigameOpen) {
        for (const playerId of [trade.a, trade.b]) this.sendTo(playerId, 'trade:cancel', { tradeId: trade.id })
        this.trades.delete(trade.id)
        return
      }
      const account = this.accountForSession(client.sessionId)
      const rawItems = message.offer?.items
      const invalid = (reason: string) => {
        this.sendTo(client.sessionId, 'trade:update', { tradeId: trade.id, error: 'invalid-offer', reason, offers: trade.offers, ready: trade.ready })
      }
      const cash = Number(message.offer?.cash)
      if (!Number.isSafeInteger(cash) || cash < 0 || cash > ACCOUNT_MAX_CASH || cash > account.cash) return invalid(cash > account.cash ? 'cash-not-owned' : 'invalid-cash')
      if (!rawItems || typeof rawItems !== 'object' || Array.isArray(rawItems)) return invalid('invalid-items')
      const rawEntries = Object.entries(rawItems)
      if (rawEntries.length > 12) return invalid('too-many-items')
      const items: Record<string, number> = {}
      for (const [id, rawQuantity] of rawEntries) {
        if (!Object.prototype.hasOwnProperty.call(ITEMS, id) || id === 'gold-coins' || NON_TRADABLE_EQUIPMENT.has(id as ItemId)) return invalid('item-not-tradable')
        const quantity = Number(rawQuantity)
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > ACCOUNT_MAX_ITEM_QUANTITY) return invalid('invalid-quantity')
        if ((account.inventory[id as ItemId] ?? 0) < quantity) return invalid('item-not-owned')
        items[id] = quantity
      }
      trade.offers[client.sessionId] = { cash, items }
      trade.ready[client.sessionId] = Boolean(message.ready)
      for (const playerId of [trade.a, trade.b]) this.sendTo(playerId, 'trade:update', { tradeId: trade.id, offers: trade.offers, ready: trade.ready })
      if (trade.ready[trade.a] && trade.ready[trade.b]) {
        const first = this.accountForSession(trade.a)
        const second = this.accountForSession(trade.b)
        const finalOffer = (sessionId: string, owner: PlayerAccount) => {
          const offer = trade.offers[sessionId]
          if (!offer || !Number.isSafeInteger(offer.cash) || offer.cash < 0 || offer.cash > owner.cash) return false
          return Object.entries(offer.items).every(([id, quantity]) => Object.prototype.hasOwnProperty.call(ITEMS, id) && !NON_TRADABLE_EQUIPMENT.has(id as ItemId) && Number.isSafeInteger(quantity) && quantity > 0 && (owner.inventory[id as ItemId] ?? 0) >= quantity)
        }
        const firstOffer = trade.offers[trade.a]
        const secondOffer = trade.offers[trade.b]
        const capacitySafe = (offer: TradeOffer, receiver: PlayerAccount) => Object.entries(offer.items).every(([id, quantity]) => (receiver.inventory[id as ItemId] ?? 0) + quantity <= ACCOUNT_MAX_ITEM_QUANTITY)
        const cashSafe = first.cash - firstOffer.cash + secondOffer.cash <= ACCOUNT_MAX_CASH && second.cash - secondOffer.cash + firstOffer.cash <= ACCOUNT_MAX_CASH
        if (!finalOffer(trade.a, first) || !finalOffer(trade.b, second) || !capacitySafe(firstOffer, second) || !capacitySafe(secondOffer, first) || !cashSafe) {
          for (const playerId of [trade.a, trade.b]) this.sendTo(playerId, 'trade:cancel', { tradeId: trade.id, reason: 'Offer is no longer valid' })
          this.trades.delete(trade.id)
          return
        }
        first.cash = first.cash - firstOffer.cash + secondOffer.cash
        second.cash = second.cash - secondOffer.cash + firstOffer.cash
        for (const [id, quantity] of Object.entries(firstOffer.items)) {
          this.changeInventory(first, id as ItemId, -quantity)
          this.changeInventory(second, id as ItemId, quantity)
        }
        for (const [id, quantity] of Object.entries(secondOffer.items)) {
          this.changeInventory(second, id as ItemId, -quantity)
          this.changeInventory(first, id as ItemId, quantity)
        }
        this.bumpAccount(first)
        this.bumpAccount(second)
        const firstClient = this.clients.find((entry) => entry.sessionId === trade.a)
        const secondClient = this.clients.find((entry) => entry.sessionId === trade.b)
        if (firstClient) firstClient.send('trade:commit', this.withAccount(firstClient, { tradeId: trade.id, give: firstOffer, receive: secondOffer }, { type: 'trade', key: trade.id, ok: true }))
        if (secondClient) secondClient.send('trade:commit', this.withAccount(secondClient, { tradeId: trade.id, give: secondOffer, receive: firstOffer }, { type: 'trade', key: trade.id, ok: true }))
        this.trades.delete(trade.id)
      }
    })
    this.onMessage('trade:cancel', (client, message: { tradeId?: string }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const trade = message?.tradeId ? this.trades.get(message.tradeId) : null
      if (!trade || (trade.a !== client.sessionId && trade.b !== client.sessionId)) return
      this.sendTo(this.other(trade, client.sessionId), 'trade:cancel', { tradeId: trade.id })
      this.trades.delete(trade.id)
    })
    this.onMessage('minigame:result:request', (client, message: { milestone?: number }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const milestone = Number(message?.milestone)
      this.sendPendingSettlements(client, Number.isFinite(milestone) && milestone > 0 ? milestone : undefined)
    })
    this.onMessage('minigame:action', (client, message: { milestone?: number; kind?: MinigameKind; action?: string; id?: string; tool?: string; recipeId?: string; orderIndex?: number }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const milestone = Number(message?.milestone)
      const kind = message?.kind
      if (!this.matchStarted || !this.validMinigameMilestone(milestone) || (kind !== 'mining' && kind !== 'farm' && kind !== 'forage') || !this.eventIsPlayable(client.sessionId, milestone, kind)) return
      const profileId = this.profileIdFor(client.sessionId)
      const state = this.ensureEventScore(profileId, milestone, kind)
      const now = Date.now()
      const deny = (reason: string) => client.send('minigame:action-denied', { milestone, kind, reason })
      if (kind === 'mining') {
        const presence = this.players.get(client.sessionId)
        const id = typeof message.id === 'string' ? message.id : ''
        if (message.action !== 'mine' || presence?.eventBay === undefined || !id.startsWith(`RushOre${presence.eventBay}_`)) return deny('invalid-node')
        const node = state.miningNodes.get(id) ?? { generation: 0, readyAt: 0 }
        if (node.readyAt > now) return deny('cooldown')
        const ore = miningRushOre(milestone, id, node.generation)
        const combo = now - state.miningLastAt <= 1_800 ? state.miningCombo + 1 : 1
        const multiplier = 1 + Math.min(.3, Math.floor(combo / 5) * .05)
        state.score += Math.round(MINING_RUSH_POINTS[ore] * multiplier)
        state.miningCombo = combo
        state.miningLastAt = now
        state.miningNodes.set(id, { generation: node.generation + 1, readyAt: now + MINING_RUSH_RESPAWN_MS })
        return
      }
      if (kind === 'farm') {
        const presence = this.players.get(client.sessionId)
        if (presence?.eventBay === undefined || message.action === 'cell' && (typeof message.id !== 'string' || !message.id.startsWith(`FarmRushCell${presence.eventBay}_`))) return deny('invalid-cell')
        if (message.action === 'cell') {
          const id = message.id!
          const current = state.farmCells.get(id) ?? { crop: null, stage: 'empty' as const, readyAt: 0 }
          if (current.stage === 'watered' && current.readyAt > now) return deny('not-ready')
          if (current.stage === 'watered') {
            if (!current.crop) return deny('invalid-cell')
            state.farmCells.set(id, { crop: null, stage: 'empty', readyAt: 0 })
            state.farmInventory[current.crop] = (state.farmInventory[current.crop] ?? 0) + 1
            return
          }
          if (current.stage === 'empty') {
            const crop = message.tool
            if (!crop || !FARM_RUSH_CROPS.includes(crop as FarmRushCrop)) return deny('invalid-seed')
            state.farmCells.set(id, { crop: crop as FarmRushCrop, stage: 'planted', readyAt: 0 })
            return
          }
          if (message.tool !== 'water' || !current.crop) return deny('needs-water')
          state.farmCells.set(id, { ...current, stage: 'watered', readyAt: now + FARM_RUSH_GROWTH_MS[current.crop] })
          return
        }
        if (message.action === 'cook') {
          if (typeof message.recipeId !== 'string' || !RECIPE_IDS.includes(message.recipeId as RecipeId)) return deny('invalid-recipe')
          this.ensureRushOrders(state, now)
          const orderIndex = Number(message.orderIndex)
          if (!Number.isSafeInteger(orderIndex) || orderIndex < 0) return deny('invalid-order')
          const orders = farmRushOrders(milestone)
          const ticket = state.farmOrders.has(orderIndex) && orders[orderIndex % orders.length].recipe === message.recipeId && !state.farmCooking.some((job) => job.orderIndex === orderIndex)
          if (!ticket) return deny('no-matching-order')
          const order = farmRushRecipe(message.recipeId as RecipeId)
          if (state.farmCooking.filter((job) => job.readyAt > now).length >= 3) return deny('queue-full')
          if (!Object.entries(order.ingredients).every(([item, quantity]) => (state.farmInventory[item as FarmRushIngredient] ?? 0) >= Number(quantity))) return deny('missing-ingredients')
          Object.entries(order.ingredients).forEach(([item, quantity]) => { state.farmInventory[item as FarmRushIngredient] = (state.farmInventory[item as FarmRushIngredient] ?? 0) - Number(quantity) })
          const previousReadyAt = state.farmCooking.at(-1)?.readyAt ?? now
          state.farmCooking.push({ orderIndex, recipe: message.recipeId as RecipeId, readyAt: Math.max(now, previousReadyAt) + order.cookSeconds * 1_000 })
          return
        }
        if (message.action === 'submit') {
          this.ensureRushOrders(state, now)
          const orderIndex = Number(message.orderIndex)
          const expiresAt = state.farmOrders.get(orderIndex)
          if (!Number.isSafeInteger(orderIndex) || orderIndex < 0 || expiresAt === undefined || expiresAt <= now) return deny('order-expired')
          const order = farmRushOrders(milestone)[orderIndex % farmRushOrders(milestone).length]
          const cookingIndex = state.farmCooking.findIndex((job) => job.orderIndex === orderIndex && job.recipe === order.recipe && job.readyAt <= now)
          if (cookingIndex < 0) return deny('dish-not-ready')
          const timeMultiplier = 1 + .5 * Math.max(0, Math.min(1, (expiresAt - now) / FARM_RUSH_ORDER_LIFETIME_MS))
          state.score += Math.round(order.points * timeMultiplier)
          state.farmCooking.splice(cookingIndex, 1)
          state.farmOrders.delete(orderIndex)
          this.ensureRushOrders(state, now)
          return
        }
        return deny('invalid-action')
      }
      if (message.action !== 'deliver' || !['apple', 'orange', 'truffle', 'discovery'].includes(String(message.tool))) return deny('invalid-delivery')
      const forageKind = message.tool as ForageRushKind
      const required = FORAGE_RUSH_REQUIREMENTS[forageKind]
      const current = state.forageProgress[forageKind]
      const deposited = Math.min(state.forageInventory[forageKind], required - current)
      if (deposited <= 0) return deny('nothing-to-deliver')
      state.forageInventory[forageKind] -= deposited
      const progress = current + deposited
      const previousPoints = Math.round(FORAGE_RUSH_DELIVERY_POINTS[forageKind] * current / required)
      const nextPoints = Math.round(FORAGE_RUSH_DELIVERY_POINTS[forageKind] * progress / required)
      state.forageProgress[forageKind] = progress
      state.score += nextPoints - previousPoints
      const complete = (['apple', 'orange', 'truffle', 'discovery'] as ForageRushKind[]).every((entry) => state.forageProgress[entry] >= FORAGE_RUSH_REQUIREMENTS[entry])
      if (complete && state.forageCompletedAt === null) {
        state.forageCompletedAt = now
        const gate = this.eventReady.get(`${milestone}:forage`)
        const remainingSeconds = gate?.gameplayAt ? Math.max(0, Math.floor((gate.gameplayAt + 300_000 - now) / 1_000)) : 0
        state.score += FORAGE_RUSH_COMPLETION_BONUS + remainingSeconds * 10
      }
    })
    this.onMessage('minigame:finish', (client, message: { milestone?: number; score?: number; progressValue?: number }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const milestone = Number(message?.milestone)
      if (!this.matchStarted || !this.validMinigameMilestone(milestone)) return
      const profileId = this.profileIdFor(client.sessionId)
      const existing = this.minigameRewardLedger.get(this.settlementKey(profileId, milestone))
      if (existing) return this.sendSettlement(client, existing)
      const presence = this.players.get(client.sessionId)
      if (!presence?.minigameOpen || presence.minigameMilestone !== milestone || !presence.minigameKind) return
      const gate = this.eventReady.get(`${milestone}:${presence.minigameKind}`)
      if (!gate?.gameplayAt || Date.now() < gate.gameplayAt) return
      const results = this.minigameResults.get(milestone) ?? new Map<string, MinigameResult>()
      if (results.has(profileId)) return
      const authoritativeScore = this.eventScoreFor(profileId, milestone, presence.minigameKind)
      const serverScore = ALLOW_TEST_SCORE_INJECTION && Number.isFinite(message.score)
        ? Math.max(0, Math.min(10_000_000, Math.floor(Number(message.score))))
        : authoritativeScore
      results.set(profileId, {
        score: serverScore,
        progressValue: this.accountProgress(this.accountForProfile(profileId)),
        nickname: presence.nickname,
      })
      this.minigameResults.set(milestone, results)
      const activePlayers = Math.max(1, this.activeMinigamePlayers(milestone, presence.minigameKind).length)
      if (results.size >= activePlayers) this.finalizeMinigame(milestone)
      else if (presence.minigameKind === 'forage' && serverScore >= FORAGE_RUSH_COMPLETION_BONUS && !this.minigameTimers.has(milestone)) {
        const deadline = Date.now() + 1_250
        this.broadcast('minigame:ending', { milestone, kind: 'forage', deadline })
        this.minigameTimers.set(milestone, setTimeout(() => {
          this.captureMissingMinigameResults(milestone, 'forage')
          this.finalizeMinigame(milestone)
        }, 1_300))
      }
      else if (!this.minigameTimers.has(milestone)) {
        const eventKey = `${milestone}:${presence.minigameKind}`
        const durationMs = (presence.minigameKind === 'mining' ? 180 : 300) * 1000
        const deadline = (this.eventStartedAt.get(eventKey) ?? Date.now()) + 5_000 + durationMs + 2_000
        this.minigameTimers.set(milestone, setTimeout(() => this.finalizeMinigame(milestone), Math.max(2_000, deadline - Date.now())))
      }
    })
    this.onMessage('minigame:ready', (client, message: { milestone?: number; kind?: MinigameKind }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const milestone = Number(message?.milestone)
      const presence = this.players.get(client.sessionId)
      if (!presence?.minigameOpen || presence.minigameMilestone !== milestone || presence.minigameKind !== message?.kind) return
      const key = `${milestone}:${presence.minigameKind}`
      this.joinReadyGate(client.sessionId, key)
      const gate = this.eventReady.get(key)
      if (!gate || gate.gameplayAt) return
      gate.ready.add(client.sessionId)
      if (presence.minigameKind === 'forage') this.sendEventForageRares(client.sessionId, milestone)
      this.readyState(key)
      const expected = Math.max(1, this.lobbyEligible.size || this.clients.length)
      if (expected > 0 && gate.ready.size >= expected && gate.participants.size >= expected) this.startMinigame(key)
    })
    this.onMessage('minigame:forage-rares:request', (client, message: { milestone?: number }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const milestone = Number(message?.milestone)
      const presence = this.players.get(client.sessionId)
      if (!presence?.minigameOpen || presence.minigameKind !== 'forage' || presence.minigameMilestone !== milestone) return
      this.sendEventForageRares(client.sessionId, milestone)
    })
    this.onMessage('minigame:forage:request', (client, message: { id?: string; milestone?: number }) => {
      if (!this.sessionIsActive(client.sessionId)) return
      const id = typeof message?.id === 'string' ? message.id : ''
      const milestone = Number(message?.milestone)
      const presence = this.players.get(client.sessionId)
      if (!this.eventIsPlayable(client.sessionId, milestone, 'forage') || !presence || presence.minigameMilestone !== milestone) return
      const fruit = /^ForageRush(Apple|Orange)(\d{3})$/.exec(id)
      const rare = FORAGE_RUSH_TRUFFLE_IDS.includes(id) || FORAGE_RUSH_DISCOVERY_IDS.includes(id)
      const validFruit = Boolean(fruit && Number(fruit[2]) < (fruit[1] === 'Apple' ? FORAGE_APPLE_SITES.length : FORAGE_ORANGE_SITES.length))
      if (!validFruit && !rare) return
      if (rare) {
        const rareState = this.ensureEventForageRares(milestone)
        if (!rareState.active.delete(id)) return
        this.broadcastEventRares(milestone, rareState)
      }
      const key = `${milestone}:${id}`
      const now = Date.now()
      const existing = this.eventForageReadyAt.get(key) ?? 0
      if (existing > now) return client.send('minigame:forage', { id, readyAt: existing })
      const forageKind: ForageRushKind = fruit ? fruit[1].toLowerCase() as 'apple' | 'orange' : id.startsWith('ForageRushTruffle') ? 'truffle' : 'discovery'
      const amount = fruit ? fruitTreeCapacity(id.replace('ForageRush', 'Forage')) : 1
      const scoreState = this.ensureEventScore(this.profileIdFor(client.sessionId), milestone, 'forage')
      scoreState.forageInventory[forageKind] += amount
      const readyAt = now + (fruit ? FORAGE_RUSH_RESPAWN_MS.fruit : FORAGE_RUSH_RARE_RESPAWN_MS)
      this.eventForageReadyAt.set(key, readyAt)
      client.send('minigame:forage-award', { id, readyAt })
      this.broadcast('minigame:forage', { id, readyAt })
      if (rare) this.scheduleEventRareReplacement(milestone, id, id.startsWith('ForageRushTruffle') ? 'truffle' : 'discovery')
    })
  }

  onJoin(client: Client, options: { bypassLobby?: boolean; profileId?: string } = {}) {
    const profileId = normalizeProfileId(options.profileId) ?? `session-${client.sessionId}`
    const account = this.rebindProfile(client, profileId)
    if (!options.bypassLobby) this.lobbyEligible.add(client.sessionId)
    if (!this.hostId && this.lobbyEligible.has(client.sessionId)) this.hostId = client.sessionId
    const presence: Presence = { id: client.sessionId, nickname: `Player ${client.sessionId.slice(0, 4)}`, zone: 'hub', position: [0, 0.86, 14], yaw: 0, animation: 'Armature|Idle_Loop', cash: account.cash, stats: { ...account.stats }, progressValue: this.accountProgress(account), seenAt: Date.now() }
    this.players.set(client.sessionId, presence)
    client.send('lobby:state', this.lobbyStateFor(client))
    if (this.matchStarted) client.send('match:sync', this.matchSyncPayload())
    client.send('presence:snapshot', [...this.players.values()].filter((player) => player.id !== client.sessionId))
    this.sendOreSnapshot(client)
    this.sendForageSnapshot(client)
    this.farmSnapshot(client)
    this.deedSnapshot(client)
    this.sendMerchantSnapshot(client)
    this.sendMarketSnapshot(client)
    this.sendPendingSettlements(client)
    this.broadcast('presence:move', presence, { except: client })
    this.broadcastLobby()
  }

  onLeave(client: Client) {
    for (const trade of this.trades.values()) if (trade.a === client.sessionId || trade.b === client.sessionId) {
      this.sendTo(this.other(trade, client.sessionId), 'trade:cancel', { tradeId: trade.id })
      this.trades.delete(trade.id)
    }
    this.players.delete(client.sessionId)
    this.movementState.delete(client.sessionId)
    const profileId = this.profileBySession.get(client.sessionId)
    const account = profileId ? this.accounts.get(profileId) : undefined
    if (profileId && account?.activeSessionId === client.sessionId) {
      account.activeSessionId = null
      account.lastSeenAt = Date.now()
    }
    this.profileBySession.delete(client.sessionId)
    this.lobbyEligible.delete(client.sessionId)
    this.lobbyReady.delete(client.sessionId)
    this.releaseEventBay(client.sessionId)
    this.leaveReadyGates(client.sessionId)
    this.broadcast('presence:leave', client.sessionId)
    if (this.orePauseStartedAt && ![...this.players.values()].some((player) => player.minigameOpen)) this.resumeOreRespawns()
    if (client.sessionId === this.hostId) this.hostId = [...this.lobbyEligible][0] ?? null
    this.broadcastLobby()
  }

  onDispose() {
    if (this.marketTimer) clearInterval(this.marketTimer)
    this.marketTimer = null
    this.oreTimers.forEach((timer) => clearTimeout(timer))
    this.oreTimers.clear()
    this.forageTimers.forEach((timer) => clearTimeout(timer))
    this.forageTimers.clear()
    this.clearRareForageTimer()
    this.minigameTimers.forEach((timer) => clearTimeout(timer))
    this.minigameTimers.clear()
    this.eventReady.forEach((gate) => clearTimeout(gate.timeout))
    this.eventReady.clear()
    this.clearEventForageRares()
    this.farmTimers.forEach((timer) => clearTimeout(timer))
    this.farmTimers.clear()
  }
}

const port = Number(process.env.PORT ?? 2567)
const serveStatic = process.env.SERVE_STATIC === '1'
const staticRoot = resolve(process.cwd(), 'dist')
const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}
const staticServer = serveStatic ? createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' })
    return response.end()
  }
  let pathname = '/'
  try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname) } catch { /* use root */ }
  if (pathname === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    return response.end(JSON.stringify({ ok: true }))
  }
  const requestedPath = resolve(staticRoot, `.${pathname}`)
  const safePath = requestedPath === staticRoot || requestedPath.startsWith(`${staticRoot}${sep}`)
  let filePath = safePath ? requestedPath : ''
  if (filePath && existsSync(filePath) && statSync(filePath).isDirectory()) filePath = resolve(filePath, 'index.html')
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    if (extname(pathname)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return response.end('Not found')
    }
    filePath = resolve(staticRoot, 'index.html')
  }
  if (!existsSync(filePath)) {
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    return response.end('Build not found. Run npm run build first.')
  }
  const extension = extname(filePath).toLowerCase()
  const fileStats = statSync(filePath)
  const headers: Record<string, string | number> = {
    'Content-Type': mimeTypes[extension] ?? 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600',
    'Accept-Ranges': 'bytes',
  }
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), fileStats.size - 1) : fileStats.size - 1
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= fileStats.size) {
      response.writeHead(416, { 'Content-Range': `bytes */${fileStats.size}` })
      return response.end()
    }
    response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${fileStats.size}`, 'Content-Length': end - start + 1 })
    if (request.method === 'HEAD') return response.end()
    return createReadStream(filePath, { start, end }).pipe(response)
  }
  const acceptsBrotli = /(?:^|,|\s)br(?:,|\s|$)/i.test(request.headers['accept-encoding'] ?? '')
  const brotliPath = `${filePath}.br`
  const servedPath = acceptsBrotli && existsSync(brotliPath) ? brotliPath : filePath
  const servedStats = servedPath === filePath ? fileStats : statSync(servedPath)
  if (servedPath !== filePath) {
    headers['Content-Encoding'] = 'br'
    headers.Vary = 'Accept-Encoding'
  }
  response.writeHead(200, { ...headers, 'Content-Length': servedStats.size })
  if (request.method === 'HEAD') return response.end()
  createReadStream(servedPath).pipe(response)
}) : undefined
const gameServer = new Server({ transport: new WebSocketTransport(staticServer ? { server: staticServer } : {}) })
gameServer.define('woodland', WoodlandRoom)
await gameServer.listen(port, '0.0.0.0')
console.log(`Woodland multiplayer listening on ${port}${serveStatic ? ' (game + multiplayer)' : ''}`)
