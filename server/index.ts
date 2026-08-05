import { Room, Server, type Client } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { minigameMilestones, minigameRewards, scheduledMinigame } from '../src/game/minigame'
import { consumeMerchantStock, currentMerchantCycle, type MerchantCycle, type MerchantItemId } from '../src/game/merchant'
import { CROP_CONFIG, MATCH_CONFIG } from '../src/game/config'
import { canMineOre, miningYield, oreKindAtDepth, oreRespawnMs, type PickaxeItem } from '../src/game/ore'
import { MINE_NODE_BY_ID, MINE_NODE_SITES } from '../shared/mine-nodes.js'

type ZoneId = 'hub' | 'forage' | 'farm' | 'mine'
type MinigameKind = 'mining' | 'farm' | 'forage'
type PublicStats = { foraged: number; mined: number; harvested: number; sold: number }
type Presence = { id: string; nickname: string; zone: ZoneId; position: [number, number, number]; cash: number; progressValue?: number; stats: PublicStats; seenAt: number; minigameOpen?: boolean; minigameKind?: MinigameKind; minigameMilestone?: number; minigameScore?: number; eventBay?: number }
type TradeOffer = { cash: number; items: Record<string, number> }
type TradeSession = { id: string; a: string; b: string; offers: Record<string, TradeOffer>; ready: Record<string, boolean> }
type MinigameResult = { score: number; progressValue: number }
type SharedOreNode = { generation: number; readyAt: number }
type CropKind = keyof typeof CROP_CONFIG
type SharedFarmCell = { crop: CropKind | null; stage: 'empty' | 'planted' | 'watered' | 'ready'; readyAt: number | null }
type SharedFarm = { ownerId: string | null; cells: Map<number, SharedFarmCell> }
type FarmResult = { requestId: string; ok: boolean; reason?: string; op?: 'claim' | 'plant' | 'water' | 'harvest' | 'rain'; farmId?: number; cellIndex?: number; crop?: CropKind; quantity?: number }
type DeedResult = { requestId: string; ok: boolean; quantity: number; personalCount: number; globalCount: number; personalAvailable: boolean; globalRemaining: number; reason?: string }
type MerchantPurchaseResult = { requestId: string; ok: boolean; reason?: string; itemId?: MerchantItemId; price?: number; cycle?: MerchantCycle }

const MAX_PLAYERS = 6
const GLOBAL_EXPANSION_DEEDS = 2
const RAIN_CYCLE_COOLDOWN_MS = Number(process.env.TEST_RAIN_COOLDOWN_MS) >= 0 ? Number(process.env.TEST_RAIN_COOLDOWN_MS) : 340_000
const FARM_CENTERS = [[-54, -16], [-18, -14], [19, -17], [55, -13], [-53, -50], [-17, -49], [20, -53], [56, -48]] as const
const CROP_IDS = new Set<CropKind>(Object.keys(CROP_CONFIG) as CropKind[])
const NON_TRADABLE_EQUIPMENT = new Set(['worn-pickaxe', 'iron-pickaxe', 'steel-pickaxe', 'crystal-pickaxe', 'basket', 'reinforced-basket', 'master-basket', 'harvest-charm', 'upgrade-coupon', 'upgrade-guard-4', 'upgrade-guard-5', 'upgrade-guard-6'])
const farmGrowthMs = (crop: CropKind) => Number(process.env.TEST_FARM_GROWTH_MS) > 0 ? Number(process.env.TEST_FARM_GROWTH_MS) : CROP_CONFIG[crop].growthSeconds * 1000

const zoneBounds: Record<ZoneId, { x: number; zMin: number; zMax: number }> = {
  hub: { x: 68, zMin: -68, zMax: 68 },
  forage: { x: 218, zMin: -222, zMax: 48 },
  farm: { x: 100, zMin: -112, zMax: 38 },
  mine: { x: 68, zMin: -200, zMax: 77 },
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
  private trades = new Map<string, TradeSession>()
  private minigameResults = new Map<number, Map<string, MinigameResult>>()
  private minigameTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private eventBays = new Map<string, Map<string, number>>()
  private eventStartedAt = new Map<string, number>()
  private oreNodes = new Map<string, SharedOreNode>(MINE_NODE_SITES.map(({ id }) => [id, { generation: 0, readyAt: 0 }]))
  private oreTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private orePauseStartedAt = 0
  private farms = new Map<number, SharedFarm>(FARM_CENTERS.map((_, index) => [index, { ownerId: null, cells: new Map() }]))
  private farmTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private farmResults = new Map<string, Map<string, FarmResult>>()
  private personalDeedsPurchased = new Set<string>()
  private globalDeedsRemaining = GLOBAL_EXPANSION_DEEDS
  private deedResults = new Map<string, Map<string, DeedResult>>()
  private lastRainAt = 0
  private merchantCycleState: MerchantCycle | null = null
  private merchantResults = new Map<string, Map<string, MerchantPurchaseResult>>()
  private settledMinigames = new Set<number>()

  private sendTo(id: string, type: string, payload: unknown) {
    this.clients.find((client) => client.sessionId === id)?.send(type, payload)
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

  private currentMerchant() {
    const matchStartedAtMs = this.matchStarted ? this.matchStartedAt : this.roomStartedAt
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
    this.globalDeedsRemaining = GLOBAL_EXPANSION_DEEDS
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
  }

  private other(trade: TradeSession, id: string) { return trade.a === id ? trade.b : trade.a }

  private lobbyStateFor(client: Client) {
    return {
      isHost: client.sessionId === this.hostId,
      started: this.matchStarted,
      durationSeconds: this.matchDurationSeconds,
      playerCount: this.clients.length,
    }
  }

  private broadcastLobby() {
    this.clients.forEach((client) => client.send('lobby:state', this.lobbyStateFor(client)))
  }

  private validMinigameMilestone(value: number) {
    return minigameMilestones(this.matchDurationSeconds).includes(value)
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

  private finalizeMinigame(milestone: number) {
    if (this.settledMinigames.has(milestone)) return
    this.resumeOreRespawns()
    const entries = [...(this.minigameResults.get(milestone)?.entries() ?? [])].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    if (!entries.length) return
    const progress = entries.map(([, result]) => result.progressValue).sort((a, b) => a - b)
    const middle = Math.floor(progress.length / 2)
    const economyReference = progress.length % 2 ? progress[middle] : Math.round((progress[middle - 1] + progress[middle]) / 2)
    const leaderProgress = Math.max(...entries.map(([, result]) => result.progressValue))
    entries.forEach(([id, result], index) => {
      const placement = index + 1
      const reward = minigameRewards({ economyReference, placement, playerProgress: result.progressValue, leaderProgress, matchSeed: this.matchSeed, milestone, playerId: id })
      this.sendTo(id, 'minigame:result', { milestone, score: result.score, placement, economyReference, cashReward: reward.cash, itemRolls: reward.itemRolls })
    })
    this.settledMinigames.add(milestone)
    this.minigameResults.delete(milestone)
    const timer = this.minigameTimers.get(milestone)
    if (timer) clearTimeout(timer)
    this.minigameTimers.delete(milestone)
    for (const key of this.eventStartedAt.keys()) if (key.startsWith(`${milestone}:`)) this.eventStartedAt.delete(key)
  }

  onCreate() {
    this.onMessage('lobby:ready', (client) => {
      client.send('lobby:state', this.lobbyStateFor(client))
      if (this.matchStarted) client.send('match:sync', { seed: this.matchSeed, startedAt: this.matchStartedAt, durationSeconds: this.matchDurationSeconds })
      client.send('presence:snapshot', [...this.players.values()].filter((player) => player.id !== client.sessionId))
      this.sendOreSnapshot(client)
      this.farmSnapshot(client)
      this.deedSnapshot(client)
      this.sendMerchantSnapshot(client)
    })
    this.onMessage('lobby:update', (client, message: { durationSeconds?: number }) => {
      if (this.matchStarted || client.sessionId !== this.hostId) return
      const duration = Math.floor(Number(message?.durationSeconds))
      if (!MATCH_CONFIG.selectableDurationsSeconds.includes(duration as typeof MATCH_CONFIG.selectableDurationsSeconds[number])) return
      this.matchDurationSeconds = duration
      this.broadcastLobby()
    })
    this.onMessage('lobby:start', (client) => {
      if (this.matchStarted || client.sessionId !== this.hostId) return
      this.matchSeed = Math.floor(Math.random() * 1_000_000_000)
      this.matchStartedAt = Date.now()
      this.lastRainAt = this.matchStartedAt
      this.matchStarted = true
      this.resetOreNodes()
      this.resetFarms()
      this.resetDeeds()
      this.resetMerchant()
      this.settledMinigames.clear()
      this.broadcast('match:sync', { seed: this.matchSeed, startedAt: this.matchStartedAt, durationSeconds: this.matchDurationSeconds })
      this.broadcastLobby()
    })
    this.onMessage('move', (client, message: Partial<Presence>) => {
      const zone = message.zone
      const position = message.position
      if (!zone || !zoneBounds[zone] || !Array.isArray(position) || position.length !== 3 || position.some((value) => !Number.isFinite(value))) return
      const minigameKind = message.minigameKind === 'mining' || message.minigameKind === 'farm' || message.minigameKind === 'forage' ? message.minigameKind : undefined
      const minigameMilestone = Number(message.minigameMilestone)
      const minigameOpen = this.matchStarted && Boolean(message.minigameOpen) && Boolean(minigameKind) && this.validMinigameMilestone(minigameMilestone) && minigameKind === scheduledMinigame(minigameMilestone, this.matchSeed, this.matchDurationSeconds)
      const bounds = minigameOpen && minigameKind === 'forage' ? zoneBounds.forage : minigameOpen ? zoneBounds.hub : zoneBounds[zone]
      const eventKey = minigameOpen ? `${minigameMilestone}:${minigameKind}` : null
      const eventBay = eventKey ? this.assignEventBay(client.sessionId, eventKey) : undefined
      if (eventKey && !this.eventStartedAt.has(eventKey)) {
        this.eventStartedAt.set(eventKey, Date.now())
        this.pauseOreRespawns()
      }
      if (!eventKey) this.releaseEventBay(client.sessionId)
      const safePosition: [number, number, number] = [
        Math.max(-bounds.x, Math.min(bounds.x, Number(position[0]))),
        Math.max(-30, Math.min(30, Number(position[1]))),
        Math.max(bounds.zMin, Math.min(bounds.zMax, Number(position[2]))),
      ]
      const previous = this.players.get(client.sessionId)
      const nickname = typeof message.nickname === 'string' ? message.nickname.trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 18) : previous?.nickname
      const cash = Math.max(0, Math.min(5_000_000_000, Math.floor(Number(message.cash) || previous?.cash || 0)))
      const progressValue = Math.max(cash, Math.min(5_000_000_000, Math.floor(Number(message.progressValue) || previous?.progressValue || cash)))
      const rawStats = message.stats ?? previous?.stats
      const safeStat = (value: unknown) => Math.max(0, Math.min(1_000_000, Math.floor(Number(value) || 0)))
      const stats = { foraged: safeStat(rawStats?.foraged), mined: safeStat(rawStats?.mined), harvested: safeStat(rawStats?.harvested), sold: safeStat(rawStats?.sold) }
      const minigameScore = minigameOpen ? safeStat(message.minigameScore) : undefined
      const presence = { id: client.sessionId, nickname: nickname || `Player ${client.sessionId.slice(0, 4)}`, zone, position: safePosition, cash, progressValue, stats, minigameOpen, minigameKind, minigameMilestone: minigameOpen ? minigameMilestone : undefined, minigameScore, eventBay, seenAt: Date.now() }
      this.players.set(client.sessionId, presence)
      if (this.orePauseStartedAt && ![...this.players.values()].some((entry) => entry.minigameOpen)) this.resumeOreRespawns()
      if (eventBay !== undefined && previous?.eventBay !== eventBay) this.sendTo(client.sessionId, 'minigame:bay', { bay: eventBay })
      this.broadcast('presence:move', presence, { except: client })
    })
    this.onMessage('mine:request', (client, message: { id?: string; tool?: string; enhancement?: number }) => {
      const id = message?.id
      const site = id ? MINE_NODE_BY_ID.get(id) : null
      const player = this.players.get(client.sessionId)
      if (!id || !site || !player || player.zone !== 'mine' || player.minigameOpen || this.orePauseStartedAt) return
      if (Math.hypot(player.position[0] - site.x, player.position[2] - site.z) > 5.5) return
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
        client.send('mine:denied', { id, reason: 'tier' })
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
    this.onMessage('deed:purchase', (client, message: { requestId?: string; quantity?: number }) => {
      const requestId = typeof message?.requestId === 'string' ? message.requestId.slice(0, 80) : ''
      if (!requestId) return
      const prior = this.deedResults.get(client.sessionId)?.get(requestId)
      if (prior) return client.send('deed:result', prior)
      const requested = Math.max(1, Math.min(1 + GLOBAL_EXPANSION_DEEDS, Math.floor(Number(message?.quantity) || 1)))
      let personalCount = 0
      if (!this.personalDeedsPurchased.has(client.sessionId)) {
        this.personalDeedsPurchased.add(client.sessionId)
        personalCount = 1
      }
      const globalCount = personalCount > 0 ? 0 : Math.min(requested, this.globalDeedsRemaining)
      this.globalDeedsRemaining -= globalCount
      const quantity = personalCount + globalCount
      const result: DeedResult = {
        requestId,
        ok: quantity > 0,
        quantity,
        personalCount,
        globalCount,
        personalAvailable: !this.personalDeedsPurchased.has(client.sessionId),
        globalRemaining: this.globalDeedsRemaining,
        reason: quantity > 0 ? undefined : 'Sold out',
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
      if (!targetId || targetId === client.sessionId || !this.players.has(targetId)) return
      this.sendTo(targetId, 'trade:request', { fromId: client.sessionId, fromNickname: this.players.get(client.sessionId)?.nickname })
    })
    this.onMessage('trade:accept', (client, message: { fromId?: string }) => {
      const fromId = message?.fromId
      if (!fromId || !this.players.has(fromId)) return
      const id = `trade-${Date.now()}-${client.sessionId.slice(0, 4)}`
      const empty = () => ({ cash: 0, items: {} })
      const trade: TradeSession = { id, a: fromId, b: client.sessionId, offers: { [fromId]: empty(), [client.sessionId]: empty() }, ready: { [fromId]: false, [client.sessionId]: false } }
      this.trades.set(id, trade)
      for (const playerId of [trade.a, trade.b]) this.sendTo(playerId, 'trade:opened', { tradeId: id, partnerId: this.other(trade, playerId), partnerNickname: this.players.get(this.other(trade, playerId))?.nickname })
    })
    this.onMessage('trade:update', (client, message: { tradeId?: string; offer?: TradeOffer; ready?: boolean }) => {
      const trade = message?.tradeId ? this.trades.get(message.tradeId) : null
      if (!trade || (trade.a !== client.sessionId && trade.b !== client.sessionId)) return
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
    this.onMessage('minigame:finish', (client, message: { milestone?: number; score?: number; progressValue?: number }) => {
      const milestone = Number(message?.milestone)
      if (!this.matchStarted || !this.validMinigameMilestone(milestone)) return
      const presence = this.players.get(client.sessionId)
      if (!presence?.minigameOpen || presence.minigameMilestone !== milestone || !presence.minigameKind) return
      const results = this.minigameResults.get(milestone) ?? new Map<string, MinigameResult>()
      if (results.has(client.sessionId)) return
      const scoreCap = presence.minigameKind === 'mining' ? 50_000 : presence.minigameKind === 'farm' ? 20_000 : 30_000
      results.set(client.sessionId, {
        score: Math.max(0, Math.min(scoreCap, Math.floor(Number(message?.score) || 0))),
        progressValue: Math.max(1, Math.min(5_000_000_000, presence.progressValue ?? presence.cash ?? 1)),
      })
      this.minigameResults.set(milestone, results)
      const activePlayers = Math.max(1, [...this.players.values()].filter((player) => player.minigameOpen && player.minigameMilestone === milestone && player.minigameKind === presence.minigameKind).length)
      if (results.size >= activePlayers) this.finalizeMinigame(milestone)
      else if (!this.minigameTimers.has(milestone)) {
        const eventKey = `${milestone}:${presence.minigameKind}`
        const durationMs = (presence.minigameKind === 'mining' ? 180 : 300) * 1000
        const deadline = (this.eventStartedAt.get(eventKey) ?? Date.now()) + 9_000 + durationMs + 2_000
        this.minigameTimers.set(milestone, setTimeout(() => this.finalizeMinigame(milestone), Math.max(2_000, deadline - Date.now())))
      }
    })
    this.onMessage('minigame:forage', (client, message: { id?: string; readyAt?: number }) => {
      if (!message.id?.startsWith('ForageRush') || !Number.isFinite(message.readyAt)) return
      const readyAt = Math.min(Date.now() + 15_000, Math.max(Date.now(), Number(message.readyAt)))
      this.broadcast('minigame:forage', { id: message.id, readyAt }, { except: client })
    })
  }

  onJoin(client: Client, options: { bypassLobby?: boolean } = {}) {
    if (!options.bypassLobby) this.lobbyEligible.add(client.sessionId)
    if (!this.hostId && this.lobbyEligible.has(client.sessionId)) this.hostId = client.sessionId
    client.send('lobby:state', this.lobbyStateFor(client))
    if (this.matchStarted) client.send('match:sync', { seed: this.matchSeed, startedAt: this.matchStartedAt, durationSeconds: this.matchDurationSeconds })
    client.send('presence:snapshot', [...this.players.values()])
    this.sendOreSnapshot(client)
    this.farmSnapshot(client)
    this.deedSnapshot(client)
    this.sendMerchantSnapshot(client)
    const presence: Presence = { id: client.sessionId, nickname: `Player ${client.sessionId.slice(0, 4)}`, zone: 'hub', position: [0, 0.86, 14], cash: 100_000, stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, seenAt: Date.now() }
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
    this.minigameResults.forEach((results) => results.delete(client.sessionId))
    this.farmResults.delete(client.sessionId)
    this.deedResults.delete(client.sessionId)
    this.merchantResults.delete(client.sessionId)
    this.lobbyEligible.delete(client.sessionId)
    this.releaseEventBay(client.sessionId)
    this.broadcast('presence:leave', client.sessionId)
    if (this.orePauseStartedAt && ![...this.players.values()].some((player) => player.minigameOpen)) this.resumeOreRespawns()
    if (!this.matchStarted && client.sessionId === this.hostId) this.hostId = [...this.lobbyEligible][0] ?? null
    this.broadcastLobby()
  }

  onDispose() {
    this.oreTimers.forEach((timer) => clearTimeout(timer))
    this.oreTimers.clear()
    this.minigameTimers.forEach((timer) => clearTimeout(timer))
    this.minigameTimers.clear()
    this.farmTimers.forEach((timer) => clearTimeout(timer))
    this.farmTimers.clear()
  }
}

const port = Number(process.env.PORT ?? 2567)
const gameServer = new Server({ transport: new WebSocketTransport() })
gameServer.define('woodland', WoodlandRoom)
await gameServer.listen(port, '0.0.0.0')
console.log(`Woodland multiplayer listening on ${port}`)
