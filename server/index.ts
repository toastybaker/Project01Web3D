import { Room, Server, type Client } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { minigameMilestones, minigameRewardPackage, scheduledMinigame } from '../src/game/minigame'
import { MATCH_CONFIG } from '../src/game/config'

type ZoneId = 'hub' | 'forage' | 'farm' | 'mine'
type MinigameKind = 'mining' | 'farm' | 'forage'
type PublicStats = { foraged: number; mined: number; harvested: number; sold: number }
type Presence = { id: string; nickname: string; zone: ZoneId; position: [number, number, number]; cash: number; progressValue?: number; stats: PublicStats; seenAt: number; minigameOpen?: boolean; minigameKind?: MinigameKind; minigameMilestone?: number; minigameScore?: number; eventBay?: number }
type TradeOffer = { cash: number; items: Record<string, number> }
type TradeSession = { id: string; a: string; b: string; offers: Record<string, TradeOffer>; ready: Record<string, boolean> }
type MinigameResult = { score: number; progressValue: number }

const zoneBounds: Record<ZoneId, { x: number; zMin: number; zMax: number }> = {
  hub: { x: 68, zMin: -68, zMax: 68 },
  forage: { x: 218, zMin: -222, zMax: 48 },
  farm: { x: 100, zMin: -112, zMax: 38 },
  mine: { x: 68, zMin: -200, zMax: 77 },
}

class WoodlandRoom extends Room {
  maxClients = 32
  private matchSeed = Math.floor(Math.random() * 1_000_000_000)
  private matchStartedAt = 0
  private matchDurationSeconds = MATCH_CONFIG.defaultDurationSeconds
  private matchStarted = false
  private hostId: string | null = null
  private lobbyEligible = new Set<string>()
  private players = new Map<string, Presence>()
  private trades = new Map<string, TradeSession>()
  private minigameResults = new Map<number, Map<string, MinigameResult>>()
  private minigameTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private eventBays = new Map<string, Map<string, number>>()
  private eventStartedAt = new Map<string, number>()

  private sendTo(id: string, type: string, payload: unknown) {
    this.clients.find((client) => client.sessionId === id)?.send(type, payload)
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
    const entries = [...(this.minigameResults.get(milestone)?.entries() ?? [])].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    if (!entries.length) return
    const progress = entries.map(([, result]) => result.progressValue).sort((a, b) => a - b)
    const middle = Math.floor(progress.length / 2)
    const economyReference = progress.length % 2 ? progress[middle] : Math.round((progress[middle - 1] + progress[middle]) / 2)
    const leaderCash = Math.max(...entries.map(([id]) => this.players.get(id)?.cash ?? 0))
    entries.forEach(([id, result], index) => {
      const placement = index + 1
      const playerCash = this.players.get(id)?.cash ?? 0
      const reward = minigameRewardPackage(economyReference, placement, playerCash, leaderCash)
      this.sendTo(id, 'minigame:result', { milestone, score: result.score, placement, economyReference, cashReward: reward.cash, cookbookBoxes: reward.boxes })
    })
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
      this.matchStarted = true
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
      if (eventKey && !this.eventStartedAt.has(eventKey)) this.eventStartedAt.set(eventKey, Date.now())
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
      if (eventBay !== undefined && previous?.eventBay !== eventBay) this.sendTo(client.sessionId, 'minigame:bay', { bay: eventBay })
      this.broadcast('presence:move', presence, { except: client })
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
      const items = Object.fromEntries(Object.entries(rawItems).slice(0, 12).map(([id, quantity]) => [id, Math.max(0, Math.min(999, Math.floor(Number(quantity) || 0)))]).filter(([, quantity]) => quantity > 0))
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
    this.lobbyEligible.delete(client.sessionId)
    this.releaseEventBay(client.sessionId)
    this.broadcast('presence:leave', client.sessionId)
    if (!this.matchStarted && client.sessionId === this.hostId) this.hostId = [...this.lobbyEligible][0] ?? null
    this.broadcastLobby()
  }
}

const port = Number(process.env.PORT ?? 2567)
const gameServer = new Server({ transport: new WebSocketTransport() })
gameServer.define('woodland', WoodlandRoom)
await gameServer.listen(port, '0.0.0.0')
console.log(`Woodland multiplayer listening on ${port}`)
