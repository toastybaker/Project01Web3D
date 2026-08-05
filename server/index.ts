import { Room, Server, type Client } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { minigameMilestones, minigameRewards, scheduledMinigame } from '../src/game/minigame'
import { consumeMerchantStock, currentMerchantCycle, type MerchantCycle, type MerchantItemId } from '../src/game/merchant'
import { CROP_CONFIG, MATCH_CONFIG, activeRareForageIds, fruitTreeCapacity, nextRareForageRollAt } from '../src/game/config'
import { canMineOre, miningYield, oreKindAtDepth, oreRespawnMs, type PickaxeItem } from '../src/game/ore'
import { MINE_NODE_BY_ID, MINE_NODE_SITES } from '../shared/mine-nodes.js'

type ZoneId = 'hub' | 'forage' | 'farm' | 'mine'
type MinigameKind = 'mining' | 'farm' | 'forage'
type PublicStats = { foraged: number; mined: number; harvested: number; sold: number }
type Presence = { id: string; nickname: string; zone: ZoneId; position: [number, number, number]; yaw?: number; animation?: string; cash: number; progressValue?: number; stats: PublicStats; seenAt: number; minigameOpen?: boolean; minigameKind?: MinigameKind; minigameMilestone?: number; minigameScore?: number; eventBay?: number }
type TradeOffer = { cash: number; items: Record<string, number> }
type TradeSession = { id: string; a: string; b: string; offers: Record<string, TradeOffer>; ready: Record<string, boolean> }
type MinigameResult = { score: number; progressValue: number }
type EventReadyGate = { participants: Set<string>; ready: Set<string>; gameplayAt: number | null; timeout: ReturnType<typeof setTimeout> }
type SharedOreNode = { generation: number; readyAt: number }
type ForageItem = 'apple' | 'orange' | 'truffle' | 'natural-discovery'
type ForageNodeDefinition = { id: string; item: ForageItem; capacity: number; x: number; z: number; rare?: boolean }
type SharedForageNode = ForageNodeDefinition & { fullAt: number; rareAvailable?: boolean }
type CropKind = keyof typeof CROP_CONFIG
type SharedFarmCell = { crop: CropKind | null; stage: 'empty' | 'planted' | 'watered' | 'ready'; readyAt: number | null }
type SharedFarm = { ownerId: string | null; cells: Map<number, SharedFarmCell> }
type FarmResult = { requestId: string; ok: boolean; reason?: string; op?: 'claim' | 'plant' | 'water' | 'harvest' | 'rain'; farmId?: number; cellIndex?: number; crop?: CropKind; quantity?: number }
type DeedResult = { requestId: string; ok: boolean; quantity: number; personalCount: number; globalCount: number; personalAvailable: boolean; globalRemaining: number; reason?: string }
type MerchantPurchaseResult = { requestId: string; ok: boolean; reason?: string; itemId?: MerchantItemId; price?: number; cycle?: MerchantCycle }
type MinigameSettlement = { settlementId: string; profileId: string; matchSeed: number; milestone: number; kind: MinigameKind; score: number; placement: number; economyReference: number; cashReward: number; itemRolls: ReturnType<typeof minigameRewards>['itemRolls'] }

const normalizeProfileId = (value: unknown) => {
  const candidate = typeof value === 'string' ? value.trim() : ''
  return /^[a-zA-Z0-9_-]{16,80}$/.test(candidate) ? candidate : null
}

const MAX_PLAYERS = 6
const MAX_FARMS = 8
const DEFAULT_GLOBAL_EXPANSION_DEEDS = 2
const ALLOW_EARLY_TEST_RESET = process.env.TEST_ALLOW_EARLY_RESET === '1'
const ALLOW_EARLY_TEST_MINIGAME = process.env.TEST_ALLOW_EARLY_MINIGAME === '1'
const FORCE_TEST_RARES = process.env.TEST_RARE_FORAGE_ALWAYS === '1'
const FORAGE_REGROW_MS = Number(process.env.TEST_FORAGE_REGROW_MS) > 0 ? Number(process.env.TEST_FORAGE_REGROW_MS) : 30_000
const RAIN_CYCLE_COOLDOWN_MS = Number(process.env.TEST_RAIN_COOLDOWN_MS) >= 0 ? Number(process.env.TEST_RAIN_COOLDOWN_MS) : 340_000
const FARM_CENTERS = [[-54, -16], [-18, -14], [19, -17], [55, -13], [-53, -50], [-17, -49], [20, -53], [56, -48]] as const
const CROP_IDS = new Set<CropKind>(Object.keys(CROP_CONFIG) as CropKind[])
const PLAYER_ANIMATIONS = new Set(['Armature|Idle_Loop', 'Armature|Walk_Loop', 'Armature|Sprint_Loop', 'Armature|Jump_Loop', 'Armature|Interact'])
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
  [3, -82], [-13, -87], [-18, -97], [20, -102],
  ...orchardSites(-49, -44, 8, 6101), ...orchardSites(54, -117, 12, 6127),
  ...orchardSites(-64, -181, 12, 6151), ...distributedFruitSites(34, 6173),
] as ReadonlyArray<readonly [number, number]>
const FORAGE_ORANGE_SITES = [
  [8, -89], [-15, -105], [23, -112],
  ...orchardSites(54, -69, 9, 6203), ...orchardSites(-52, -124, 12, 6229),
  ...distributedFruitSites(36, 6257),
] as ReadonlyArray<readonly [number, number]>
const FORAGE_TRUFFLE_SITES = [[-112, -66], [97, -104], [-78, -204], [126, -167], [34, -151]] as const
const FORAGE_DISCOVERY_SITES = [[-178, -185], [164, -201], [-139, -16]] as const
const FORAGE_NODE_DEFINITIONS: ForageNodeDefinition[] = [
  ...FORAGE_APPLE_SITES.map(([x, z], index) => ({ id: `ForageApple${String(index).padStart(3, '0')}`, item: 'apple' as const, capacity: fruitTreeCapacity(`ForageApple${String(index).padStart(3, '0')}`), x, z })),
  ...FORAGE_ORANGE_SITES.map(([x, z], index) => ({ id: `ForageOrange${String(index).padStart(3, '0')}`, item: 'orange' as const, capacity: fruitTreeCapacity(`ForageOrange${String(index).padStart(3, '0')}`), x, z })),
  ...FORAGE_TRUFFLE_SITES.map(([x, z], index) => ({ id: `ForageTruffle${String(index).padStart(3, '0')}`, item: 'truffle' as const, capacity: 1, x, z, rare: true })),
  ...FORAGE_DISCOVERY_SITES.map(([x, z], index) => ({ id: `ForageDiscovery${String(index).padStart(2, '0')}`, item: 'natural-discovery' as const, capacity: 1, x, z, rare: true })),
]
const FORAGE_NODE_BY_ID = new Map(FORAGE_NODE_DEFINITIONS.map((node) => [node.id, node]))
const NON_TRADABLE_EQUIPMENT = new Set(['worn-pickaxe', 'iron-pickaxe', 'steel-pickaxe', 'crystal-pickaxe', 'basket', 'reinforced-basket', 'master-basket', 'harvest-charm', 'upgrade-coupon', 'upgrade-guard-4', 'upgrade-guard-5', 'upgrade-guard-6'])
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
  private players = new Map<string, Presence>()
  private profileBySession = new Map<string, string>()
  private sessionByProfile = new Map<string, string>()
  private trades = new Map<string, TradeSession>()
  private minigameResults = new Map<number, Map<string, MinigameResult>>()
  private minigameRewardLedger = new Map<string, MinigameSettlement>()
  private minigameTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private eventBays = new Map<string, Map<string, number>>()
  private eventStartedAt = new Map<string, number>()
  private eventReady = new Map<string, EventReadyGate>()
  private oreNodes = new Map<string, SharedOreNode>(MINE_NODE_SITES.map(({ id }) => [id, { generation: 0, readyAt: 0 }]))
  private oreTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private forageNodes = new Map<string, SharedForageNode>(FORAGE_NODE_DEFINITIONS.map((node) => [node.id, { ...node, fullAt: 0 }]))
  private forageTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private forageRareTimer: ReturnType<typeof setTimeout> | null = null
  private orePauseStartedAt = 0
  private farms = new Map<number, SharedFarm>(FARM_CENTERS.map((_, index) => [index, { ownerId: null, cells: new Map() }]))
  private farmTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private farmResults = new Map<string, Map<string, FarmResult>>()
  private personalDeedsPurchased = new Set<string>()
  private deedEntitlements = new Map<string, number>()
  private configuredGlobalExpansionDeeds = DEFAULT_GLOBAL_EXPANSION_DEEDS
  private globalDeedsRemaining = this.configuredGlobalExpansionDeeds
  private deedResults = new Map<string, Map<string, DeedResult>>()
  private lastRainAt = 0
  private merchantCycleState: MerchantCycle | null = null
  private merchantResults = new Map<string, Map<string, MerchantPurchaseResult>>()
  private settledMinigames = new Set<number>()

  private sendTo(id: string, type: string, payload: unknown) {
    this.clients.find((client) => client.sessionId === id)?.send(type, payload)
  }

  private profileIdFor(sessionId: string) {
    return this.profileBySession.get(sessionId) ?? `session-${sessionId}`
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
    }
  }

  private sendSettlement(client: Client, settlement: MinigameSettlement) {
    client.send('minigame:result', this.settlementPayload(settlement))
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
    client.send('mine:snapshot', this.oreSnapshot())
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
    client.send('forage:snapshot', this.forageSnapshot())
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
    client.send('farm:snapshot', { selfId: client.sessionId, owners, cells })
  }

  private deedSnapshot(client: Client) {
    client.send('deed:snapshot', {
      personalAvailable: !this.personalDeedsPurchased.has(client.sessionId),
      globalRemaining: this.globalDeedsRemaining,
    })
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
    if (cycle) client.send('merchant:snapshot', cycle)
  }

  private resetMerchant() {
    this.merchantCycleState = null
    this.merchantResults.clear()
    this.clients.forEach((client) => this.sendMerchantSnapshot(client))
  }

  private resetDeeds() {
    this.personalDeedsPurchased.clear()
    this.deedEntitlements.clear()
    this.globalDeedsRemaining = this.configuredGlobalExpansionDeeds
    this.deedResults.clear()
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
    const pausedMs = Date.now() - this.orePauseStartedAt
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
    this.broadcast('mine:snapshot', this.oreSnapshot())
    this.broadcastMatchSync()
  }

  private other(trade: TradeSession, id: string) { return trade.a === id ? trade.b : trade.a }

  private lobbyStateFor(client: Client) {
    this.clampGlobalExpansionDeeds()
    return {
      isHost: client.sessionId === this.hostId,
      started: this.matchStarted,
      durationSeconds: this.matchDurationSeconds,
      globalExpansionDeeds: this.configuredGlobalExpansionDeeds,
      maxGlobalExpansionDeeds: this.maxGlobalExpansionDeeds(),
      playerCount: this.clients.length,
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
    this.eventBays.clear()
    this.eventStartedAt.clear()
    this.minigameResults.clear()
    this.minigameRewardLedger.clear()
    this.settledMinigames.clear()
    this.matchStarted = false
    this.matchStartedAt = 0
    this.roomStartedAt = Date.now()
    this.matchSeed = Math.floor(Math.random() * 1_000_000_000)
    this.resetOreNodes()
    this.resetForageNodes()
    this.resetFarms()
    this.resetDeeds()
    this.resetMerchant()
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

  private finalizeMinigame(milestone: number) {
    if (this.settledMinigames.has(milestone)) return
    const entries = [...(this.minigameResults.get(milestone)?.entries() ?? [])].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    if (entries.length) {
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
        }
        this.minigameRewardLedger.set(this.settlementKey(profileId, milestone), settlement)
        const sessionId = this.sessionByProfile.get(profileId)
        if (sessionId) this.sendTo(sessionId, 'minigame:result', this.settlementPayload(settlement))
      })
    }
    this.settledMinigames.add(milestone)
    this.minigameResults.delete(milestone)
    const timer = this.minigameTimers.get(milestone)
    if (timer) clearTimeout(timer)
    this.minigameTimers.delete(milestone)
    for (const key of this.eventStartedAt.keys()) if (key.startsWith(`${milestone}:`)) this.eventStartedAt.delete(key)
    for (const [key, gate] of this.eventReady) if (key.startsWith(`${milestone}:`)) { clearTimeout(gate.timeout); this.eventReady.delete(key) }
    this.resumeOreRespawns()
  }

  onCreate() {
    this.onMessage('lobby:ready', (client) => {
      client.send('lobby:state', this.lobbyStateFor(client))
      if (this.matchStarted) client.send('match:sync', this.matchSyncPayload())
      client.send('presence:snapshot', [...this.players.values()].filter((player) => player.id !== client.sessionId))
      this.sendOreSnapshot(client)
      this.sendForageSnapshot(client)
      this.farmSnapshot(client)
      this.deedSnapshot(client)
      this.sendMerchantSnapshot(client)
      this.sendPendingSettlements(client)
    })
    this.onMessage('lobby:update', (client, message: { durationSeconds?: number; globalExpansionDeeds?: number }) => {
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
      if (this.matchStarted || client.sessionId !== this.hostId) return
      this.clampGlobalExpansionDeeds()
      this.matchSeed = Math.floor(Math.random() * 1_000_000_000)
      this.matchStartedAt = Date.now()
      this.lastRainAt = this.matchStartedAt
      this.matchStarted = true
      this.resetOreNodes()
      this.resetForageNodes()
      this.resetFarms()
      this.resetDeeds()
      this.resetMerchant()
      this.settledMinigames.clear()
      this.minigameRewardLedger.clear()
      this.broadcast('match:sync', { seed: this.matchSeed, startedAt: this.matchStartedAt, durationSeconds: this.matchDurationSeconds })
      this.broadcastLobby()
    })
    this.onMessage('lobby:reset', (client) => {
      if (!this.matchStarted || client.sessionId !== this.hostId) return
      const elapsed = Date.now() - this.effectiveMatchStartedAt()
      if (!ALLOW_EARLY_TEST_RESET && elapsed < this.matchDurationSeconds * 1000) return
      this.resetMatchToLobby()
    })
    this.onMessage('move', (client, message: Partial<Presence>) => {
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
      const safePosition: [number, number, number] = [
        Math.max(-bounds.x, Math.min(bounds.x, Number(position[0]))),
        Math.max(-30, Math.min(30, Number(position[1]))),
        Math.max(bounds.zMin, Math.min(bounds.zMax, Number(position[2]))),
      ]
      const previous = this.players.get(client.sessionId)
      const rawYaw = Number(message.yaw)
      const yaw = Number.isFinite(rawYaw) ? Math.atan2(Math.sin(rawYaw), Math.cos(rawYaw)) : previous?.yaw ?? 0
      const animation = typeof message.animation === 'string' && PLAYER_ANIMATIONS.has(message.animation) ? message.animation : previous?.animation ?? 'Armature|Idle_Loop'
      const nickname = typeof message.nickname === 'string' ? message.nickname.trim().replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 18) : previous?.nickname
      const cash = Math.max(0, Math.min(5_000_000_000, Math.floor(Number(message.cash) || previous?.cash || 0)))
      const progressValue = Math.max(cash, Math.min(5_000_000_000, Math.floor(Number(message.progressValue) || previous?.progressValue || cash)))
      const rawStats = message.stats ?? previous?.stats
      const safeStat = (value: unknown) => Math.max(0, Math.min(1_000_000, Math.floor(Number(value) || 0)))
      const stats = { foraged: safeStat(rawStats?.foraged), mined: safeStat(rawStats?.mined), harvested: safeStat(rawStats?.harvested), sold: safeStat(rawStats?.sold) }
      const minigameScore = minigameOpen ? safeStat(message.minigameScore) : undefined
      const presence = { id: client.sessionId, nickname: nickname || `Player ${client.sessionId.slice(0, 4)}`, zone, position: safePosition, yaw, animation, cash, progressValue, stats, minigameOpen, minigameKind, minigameMilestone: minigameOpen ? minigameMilestone : undefined, minigameScore, eventBay, seenAt: Date.now() }
      this.players.set(client.sessionId, presence)
      if (this.orePauseStartedAt && ![...this.players.values()].some((entry) => entry.minigameOpen)) this.resumeOreRespawns()
      if (eventBay !== undefined && previous?.eventBay !== eventBay) this.sendTo(client.sessionId, 'minigame:bay', { bay: eventBay })
      this.broadcast('presence:move', presence, { except: client })
    })
    this.onMessage('mine:request', (client, message: { id?: string; tool?: string; enhancement?: number }) => {
      const id = message?.id
      const site = id ? MINE_NODE_BY_ID.get(id) : null
      const player = this.players.get(client.sessionId)
      const deny = (reason: 'invalid' | 'wrong-zone' | 'too-far' | 'paused' | 'tier') => client.send('mine:denied', { id, reason })
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
      const tool = message.tool as PickaxeItem
      if (!canMineOre(tool, ore)) {
        deny('tier')
        return
      }
      const enhancement = Math.max(0, Math.min(10, Math.floor(Number(message.enhancement) || 0)))
      const quantity = miningYield(tool, Math.random(), enhancement)
      const nextGeneration = node.generation + 1
      const readyAt = Date.now() + oreRespawnMs(id, nextGeneration, this.matchSeed)
      const next = { generation: nextGeneration, readyAt }
      this.oreNodes.set(id, next)
      this.broadcast('mine:node', { id, ...next })
      client.send('mine:award', { id, ore, quantity, ...next })
      this.scheduleOreRespawn(id)
    })
    this.onMessage('forage:request', (client, message: { id?: string; item?: string; remainingCapacity?: number }) => {
      const id = typeof message?.id === 'string' ? message.id : ''
      const item = typeof message?.item === 'string' ? message.item : ''
      const definition = FORAGE_NODE_BY_ID.get(id)
      const deny = (reason: 'invalid-id' | 'invalid-item' | 'item-mismatch' | 'wrong-zone' | 'too-far' | 'no-capacity' | 'depleted') => client.send('forage:denied', { id, item, reason })
      if (!definition) return deny('invalid-id')
      if (item !== 'apple' && item !== 'orange' && item !== 'truffle' && item !== 'natural-discovery') return deny('invalid-item')
      if (item !== definition.item) return deny('item-mismatch')
      const player = this.players.get(client.sessionId)
      if (!player || player.zone !== 'forage' || player.minigameOpen) return deny('wrong-zone')
      if (Math.hypot(player.position[0] - definition.x, player.position[2] - definition.z) > 5.5) return deny('too-far')
      const remainingCapacity = Math.max(0, Math.min(10_000, Math.floor(Number(message?.remainingCapacity))))
      if (!Number.isFinite(remainingCapacity) || remainingCapacity <= 0) return deny('no-capacity')
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
      client.send('forage:award', { ...payload, quantity })
      if (!node.rare) this.scheduleForageRegrowth(id)
    })
    this.onMessage('merchant:request', (client) => this.sendMerchantSnapshot(client))
    this.onMessage('merchant:buy', (client, message: { requestId?: string; cycleId?: string; itemId?: MerchantItemId }) => {
      const requestId = typeof message?.requestId === 'string' ? message.requestId.slice(0, 80) : ''
      if (!requestId) return
      const results = this.merchantResults.get(client.sessionId) ?? new Map<string, MerchantPurchaseResult>()
      const prior = results.get(requestId)
      if (prior) return client.send('merchant:result', prior)
      const cycle = this.currentMerchant()
      const fail = (reason: string) => {
        const result: MerchantPurchaseResult = { requestId, ok: false, reason, cycle: cycle ?? undefined }
        results.set(requestId, result)
        while (results.size > 64) results.delete(results.keys().next().value!)
        this.merchantResults.set(client.sessionId, results)
        client.send('merchant:result', result)
      }
      if (!cycle || cycle.id !== message.cycleId) return fail('Stock changed')
      const itemId = message.itemId
      if (!itemId) return fail('Unavailable')
      const offer = cycle.inventory.find((entry) => entry.id === itemId)
      if (!offer) return fail('Unavailable')
      const playerCash = this.players.get(client.sessionId)?.cash ?? 0
      if (playerCash < offer.price) return fail('Not enough coins')
      const purchase = consumeMerchantStock(cycle, itemId)
      if (!purchase.ok) return fail(purchase.reason === 'sold-out' ? 'Sold out' : 'Unavailable')
      this.merchantCycleState = purchase.cycle
      const result: MerchantPurchaseResult = { requestId, ok: true, itemId, price: offer.price, cycle: purchase.cycle }
      results.set(requestId, result)
      while (results.size > 64) results.delete(results.keys().next().value!)
      this.merchantResults.set(client.sessionId, results)
      client.send('merchant:result', result)
      this.broadcast('merchant:snapshot', purchase.cycle)
    })
    this.onMessage('deed:purchase', (client, message: { requestId?: string; quantity?: number; kind?: 'personal' | 'global' }) => {
      const requestId = typeof message?.requestId === 'string' ? message.requestId.slice(0, 80) : ''
      if (!requestId) return
      const prior = this.deedResults.get(client.sessionId)?.get(requestId)
      if (prior) return client.send('deed:result', prior)
      const requested = Math.max(1, Math.min(Math.max(1, this.configuredGlobalExpansionDeeds), Math.floor(Number(message?.quantity) || 1)))
      const kind = message?.kind === 'global' ? 'global' : 'personal'
      let personalCount = 0
      let reason: string | undefined
      if (kind === 'personal' && !this.personalDeedsPurchased.has(client.sessionId)) {
        this.personalDeedsPurchased.add(client.sessionId)
        personalCount = 1
      } else if (kind === 'personal') {
        reason = 'Already owned'
      } else if (!this.personalDeedsPurchased.has(client.sessionId)) {
        reason = 'Buy personal deed first'
      }
      const globalCount = kind === 'global' && !reason ? Math.min(requested, this.globalDeedsRemaining) : 0
      this.globalDeedsRemaining -= globalCount
      const quantity = personalCount + globalCount
      if (!quantity && !reason) reason = 'Sold out'
      if (quantity > 0) this.deedEntitlements.set(client.sessionId, (this.deedEntitlements.get(client.sessionId) ?? 0) + quantity)
      const result: DeedResult = {
        requestId,
        ok: quantity > 0,
        quantity,
        personalCount,
        globalCount,
        personalAvailable: !this.personalDeedsPurchased.has(client.sessionId),
        globalRemaining: this.globalDeedsRemaining,
        reason: quantity > 0 ? undefined : reason,
      }
      const results = this.deedResults.get(client.sessionId) ?? new Map<string, DeedResult>()
      results.set(requestId, result)
      while (results.size > 64) results.delete(results.keys().next().value!)
      this.deedResults.set(client.sessionId, results)
      client.send('deed:result', result)
      if (globalCount > 0) this.broadcast('deed:stock', { globalRemaining: this.globalDeedsRemaining })
    })
    this.onMessage('farm:action', (client, message: { requestId?: string; op?: 'claim' | 'plant' | 'water' | 'harvest' | 'rain'; farmId?: number; cellIndex?: number; crop?: CropKind; watered?: boolean }) => {
      const requestId = typeof message?.requestId === 'string' ? message.requestId.slice(0, 80) : ''
      const op = message?.op
      const farmId = Math.floor(Number(message?.farmId))
      const cellIndex = Math.floor(Number(message?.cellIndex))
      if (!requestId || !op || farmId < 0 || farmId >= FARM_CENTERS.length) return
      const prior = this.farmResults.get(client.sessionId)?.get(requestId)
      if (prior) return client.send('farm:result', prior)
      const respond = (result: Omit<FarmResult, 'requestId'>) => {
        const payload: FarmResult = { requestId, op, farmId, ...result }
        const results = this.farmResults.get(client.sessionId) ?? new Map<string, FarmResult>()
        results.set(requestId, payload)
        while (results.size > 128) results.delete(results.keys().next().value!)
        this.farmResults.set(client.sessionId, results)
        client.send('farm:result', payload)
      }
      const player = this.players.get(client.sessionId)
      const farm = this.farms.get(farmId)!
      if (!player || player.zone !== 'farm' || player.minigameOpen) return respond({ ok: false, reason: 'Return to the farm' })
      const [centerX, centerZ] = FARM_CENTERS[farmId]
      if (op === 'claim') {
        if (Math.hypot(player.position[0] - (centerX + 5.85), player.position[2] - (centerZ + 6.25)) > 5) return respond({ ok: false, reason: 'Move closer' })
        if (farm.ownerId && farm.ownerId !== client.sessionId) return respond({ ok: false, reason: 'Farm already claimed' })
        if (farm.ownerId === client.sessionId) return respond({ ok: false, reason: 'Your farm' })
        const ownedFarms = [...this.farms.values()].filter((entry) => entry.ownerId === client.sessionId).length
        if (ownedFarms >= 3) return respond({ ok: false, reason: 'Farm limit reached' })
        const entitlements = this.deedEntitlements.get(client.sessionId) ?? 0
        if (entitlements <= 0) return respond({ ok: false, reason: 'Need a farm deed' })
        if (entitlements === 1) this.deedEntitlements.delete(client.sessionId)
        else this.deedEntitlements.set(client.sessionId, entitlements - 1)
        farm.ownerId = client.sessionId
        this.broadcast('farm:update', { farmId, ownerId: client.sessionId })
        return respond({ ok: true })
      }
      if (farm.ownerId !== client.sessionId) return respond({ ok: false, reason: 'Not your farm' })
      if (op === 'rain') {
        const dryCells = [...farm.cells.entries()].filter(([, cell]) => cell.stage === 'planted' && cell.crop)
        if (!dryCells.length) return respond({ ok: false, reason: 'No dry crops' })
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
        const watered = Boolean(message.watered)
        const cell: SharedFarmCell = { crop, stage: watered ? 'watered' : 'planted', readyAt: watered ? Date.now() + farmGrowthMs(crop) : null }
        farm.cells.set(cellIndex, cell)
        this.broadcast('farm:update', { farmId, cellIndex, cell })
        if (watered) this.scheduleFarmReady(farmId, cellIndex)
        return respond({ ok: true, reason: watered ? 'watered' : undefined, cellIndex, crop })
      }
      if (op === 'water') {
        if (current.stage !== 'planted' || !current.crop) return respond({ ok: false, reason: current.stage === 'ready' ? 'Ready to harvest' : 'Cannot water' })
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
      return respond({ ok: true, cellIndex, crop, quantity: CROP_CONFIG[crop].yield })
    })
    this.onMessage('farm:rain', (client) => {
      const player = this.players.get(client.sessionId)
      if (!player || player.zone !== 'farm' || player.minigameOpen) return
      if (RAIN_CYCLE_COOLDOWN_MS > 0 && (!this.matchStarted || Date.now() - this.lastRainAt < RAIN_CYCLE_COOLDOWN_MS)) return
      this.lastRainAt = Date.now()
      for (const [farmId, farm] of this.farms) for (const [cellIndex, current] of farm.cells) {
        if (current.stage !== 'planted' || !current.crop) continue
        const cell: SharedFarmCell = { ...current, stage: 'watered', readyAt: Date.now() + farmGrowthMs(current.crop) }
        farm.cells.set(cellIndex, cell)
        this.broadcast('farm:update', { farmId, cellIndex, cell })
        this.scheduleFarmReady(farmId, cellIndex)
      }
    })
    this.onMessage('trade:request', (client, message: { targetId?: string }) => {
      const targetId = message?.targetId
      const sender = this.players.get(client.sessionId)
      const target = targetId ? this.players.get(targetId) : null
      if (!targetId || targetId === client.sessionId || !sender || !target || sender.minigameOpen || target.minigameOpen) return
      this.sendTo(targetId, 'trade:request', { fromId: client.sessionId, fromNickname: this.players.get(client.sessionId)?.nickname })
    })
    this.onMessage('trade:accept', (client, message: { fromId?: string }) => {
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
      const trade = message?.tradeId ? this.trades.get(message.tradeId) : null
      if (!trade || (trade.a !== client.sessionId && trade.b !== client.sessionId)) return
      if (this.players.get(trade.a)?.minigameOpen || this.players.get(trade.b)?.minigameOpen) {
        for (const playerId of [trade.a, trade.b]) this.sendTo(playerId, 'trade:cancel', { tradeId: trade.id })
        this.trades.delete(trade.id)
        return
      }
      const rawItems = message.offer?.items ?? {}
      const items: Record<string, number> = {}
      for (const [id, rawQuantity] of Object.entries(rawItems).slice(0, 12)) {
        if (NON_TRADABLE_EQUIPMENT.has(id)) continue
        const quantity = Math.max(0, Math.min(999, Math.floor(Number(rawQuantity) || 0)))
        if (quantity > 0) items[id] = quantity
      }
      trade.offers[client.sessionId] = { cash: Math.max(0, Math.min(1_000_000_000, Math.floor(Number(message.offer?.cash) || 0))), items }
      trade.ready[client.sessionId] = Boolean(message.ready)
      for (const playerId of [trade.a, trade.b]) this.sendTo(playerId, 'trade:update', { tradeId: trade.id, offers: trade.offers, ready: trade.ready })
      if (trade.ready[trade.a] && trade.ready[trade.b]) {
        for (const playerId of [trade.a, trade.b]) this.sendTo(playerId, 'trade:commit', { tradeId: trade.id, give: trade.offers[playerId], receive: trade.offers[this.other(trade, playerId)] })
        this.trades.delete(trade.id)
      }
    })
    this.onMessage('trade:cancel', (client, message: { tradeId?: string }) => {
      const trade = message?.tradeId ? this.trades.get(message.tradeId) : null
      if (!trade || (trade.a !== client.sessionId && trade.b !== client.sessionId)) return
      this.sendTo(this.other(trade, client.sessionId), 'trade:cancel', { tradeId: trade.id })
      this.trades.delete(trade.id)
    })
    this.onMessage('minigame:result:request', (client, message: { milestone?: number }) => {
      const milestone = Number(message?.milestone)
      this.sendPendingSettlements(client, Number.isFinite(milestone) && milestone > 0 ? milestone : undefined)
    })
    this.onMessage('minigame:finish', (client, message: { milestone?: number; score?: number; progressValue?: number }) => {
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
      const scoreCap = presence.minigameKind === 'mining' ? 50_000 : presence.minigameKind === 'farm' ? 20_000 : 30_000
      results.set(profileId, {
        score: Math.max(0, Math.min(scoreCap, Math.floor(Number(message?.score) || 0))),
        progressValue: Math.max(1, Math.min(5_000_000_000, presence.progressValue ?? presence.cash ?? 1)),
      })
      this.minigameResults.set(milestone, results)
      const activePlayers = Math.max(1, [...this.players.values()].filter((player) => player.minigameOpen && player.minigameMilestone === milestone && player.minigameKind === presence.minigameKind).length)
      if (results.size >= activePlayers) this.finalizeMinigame(milestone)
      else if (!this.minigameTimers.has(milestone)) {
        const eventKey = `${milestone}:${presence.minigameKind}`
        const durationMs = (presence.minigameKind === 'mining' ? 180 : 300) * 1000
        const deadline = (this.eventStartedAt.get(eventKey) ?? Date.now()) + 5_000 + durationMs + 2_000
        this.minigameTimers.set(milestone, setTimeout(() => this.finalizeMinigame(milestone), Math.max(2_000, deadline - Date.now())))
      }
    })
    this.onMessage('minigame:ready', (client, message: { milestone?: number; kind?: MinigameKind }) => {
      const milestone = Number(message?.milestone)
      const presence = this.players.get(client.sessionId)
      if (!presence?.minigameOpen || presence.minigameMilestone !== milestone || presence.minigameKind !== message?.kind) return
      const key = `${milestone}:${presence.minigameKind}`
      this.joinReadyGate(client.sessionId, key)
      const gate = this.eventReady.get(key)
      if (!gate || gate.gameplayAt) return
      gate.ready.add(client.sessionId)
      this.readyState(key)
      const expected = Math.max(1, this.lobbyEligible.size || this.clients.length)
      if (expected > 0 && gate.ready.size >= expected && gate.participants.size >= expected) this.startMinigame(key)
    })
    this.onMessage('minigame:forage', (client, message: { id?: string; readyAt?: number }) => {
      if (!message.id?.startsWith('ForageRush') || !Number.isFinite(message.readyAt)) return
      const readyAt = Math.min(Date.now() + 15_000, Math.max(Date.now(), Number(message.readyAt)))
      this.broadcast('minigame:forage', { id: message.id, readyAt }, { except: client })
    })
  }

  onJoin(client: Client, options: { bypassLobby?: boolean; profileId?: string } = {}) {
    const profileId = normalizeProfileId(options.profileId) ?? `session-${client.sessionId}`
    this.profileBySession.set(client.sessionId, profileId)
    this.sessionByProfile.set(profileId, client.sessionId)
    if (!options.bypassLobby) this.lobbyEligible.add(client.sessionId)
    if (!this.hostId && this.lobbyEligible.has(client.sessionId)) this.hostId = client.sessionId
    client.send('lobby:state', this.lobbyStateFor(client))
    if (this.matchStarted) client.send('match:sync', this.matchSyncPayload())
    client.send('presence:snapshot', [...this.players.values()])
    this.sendOreSnapshot(client)
    this.sendForageSnapshot(client)
    this.farmSnapshot(client)
    this.deedSnapshot(client)
    this.sendMerchantSnapshot(client)
    this.sendPendingSettlements(client)
    const presence: Presence = { id: client.sessionId, nickname: `Player ${client.sessionId.slice(0, 4)}`, zone: 'hub', position: [0, 0.86, 14], yaw: 0, animation: 'Armature|Idle_Loop', cash: 100_000, stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, seenAt: Date.now() }
    this.players.set(client.sessionId, presence)
    this.broadcast('presence:move', presence, { except: client })
    this.broadcastLobby()
  }

  onLeave(client: Client) {
    for (const trade of this.trades.values()) if (trade.a === client.sessionId || trade.b === client.sessionId) {
      this.sendTo(this.other(trade, client.sessionId), 'trade:cancel', { tradeId: trade.id })
      this.trades.delete(trade.id)
    }
    this.players.delete(client.sessionId)
    const profileId = this.profileBySession.get(client.sessionId)
    if (profileId && this.sessionByProfile.get(profileId) === client.sessionId) this.sessionByProfile.delete(profileId)
    this.profileBySession.delete(client.sessionId)
    this.farmResults.delete(client.sessionId)
    this.deedResults.delete(client.sessionId)
    this.merchantResults.delete(client.sessionId)
    this.lobbyEligible.delete(client.sessionId)
    this.releaseEventBay(client.sessionId)
    this.leaveReadyGates(client.sessionId)
    this.broadcast('presence:leave', client.sessionId)
    if (this.orePauseStartedAt && ![...this.players.values()].some((player) => player.minigameOpen)) this.resumeOreRespawns()
    if (client.sessionId === this.hostId) this.hostId = [...this.lobbyEligible][0] ?? null
    this.broadcastLobby()
  }

  onDispose() {
    this.oreTimers.forEach((timer) => clearTimeout(timer))
    this.oreTimers.clear()
    this.forageTimers.forEach((timer) => clearTimeout(timer))
    this.forageTimers.clear()
    this.clearRareForageTimer()
    this.minigameTimers.forEach((timer) => clearTimeout(timer))
    this.minigameTimers.clear()
    this.eventReady.forEach((gate) => clearTimeout(gate.timeout))
    this.eventReady.clear()
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
