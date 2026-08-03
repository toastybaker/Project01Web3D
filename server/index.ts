import { Room, Server, type Client } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'

type ZoneId = 'hub' | 'forage' | 'farm' | 'mine'
type PublicStats = { foraged: number; mined: number; harvested: number; sold: number }
type Presence = { id: string; nickname: string; zone: ZoneId; position: [number, number, number]; cash: number; stats: PublicStats; seenAt: number }
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
  private readonly matchSeed = Math.floor(Math.random() * 1_000_000_000)
  private readonly matchStartedAt = Date.now()
  private players = new Map<string, Presence>()
  private trades = new Map<string, TradeSession>()
  private minigameResults = new Map<number, Map<string, MinigameResult>>()
  private minigameTimers = new Map<number, ReturnType<typeof setTimeout>>()

  private sendTo(id: string, type: string, payload: unknown) {
    this.clients.find((client) => client.sessionId === id)?.send(type, payload)
  }

  private other(trade: TradeSession, id: string) { return trade.a === id ? trade.b : trade.a }

  private finalizeMinigame(milestone: number) {
    const entries = [...(this.minigameResults.get(milestone)?.entries() ?? [])].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    if (!entries.length) return
    const progress = entries.map(([, result]) => result.progressValue).sort((a, b) => a - b)
    const middle = Math.floor(progress.length / 2)
    const economyReference = progress.length % 2 ? progress[middle] : Math.round((progress[middle - 1] + progress[middle]) / 2)
    entries.forEach(([id, result], index) => this.sendTo(id, 'minigame:result', { milestone, score: result.score, placement: index + 1, economyReference }))
    this.minigameResults.delete(milestone)
    const timer = this.minigameTimers.get(milestone)
    if (timer) clearTimeout(timer)
    this.minigameTimers.delete(milestone)
  }

  onCreate() {
    this.onMessage('move', (client, message: Partial<Presence>) => {
      const zone = message.zone
      const position = message.position
      if (!zone || !zoneBounds[zone] || !Array.isArray(position) || position.length !== 3 || position.some((value) => !Number.isFinite(value))) return
      const bounds = zoneBounds[zone]
      const safePosition: [number, number, number] = [
        Math.max(-bounds.x, Math.min(bounds.x, Number(position[0]))),
        Math.max(-30, Math.min(30, Number(position[1]))),
        Math.max(bounds.zMin, Math.min(bounds.zMax, Number(position[2]))),
      ]
      const previous = this.players.get(client.sessionId)
      const nickname = typeof message.nickname === 'string' ? message.nickname.trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 18) : previous?.nickname
      const cash = Math.max(0, Math.min(5_000_000_000, Math.floor(Number(message.cash) || previous?.cash || 0)))
      const rawStats = message.stats ?? previous?.stats
      const safeStat = (value: unknown) => Math.max(0, Math.min(1_000_000, Math.floor(Number(value) || 0)))
      const stats = { foraged: safeStat(rawStats?.foraged), mined: safeStat(rawStats?.mined), harvested: safeStat(rawStats?.harvested), sold: safeStat(rawStats?.sold) }
      const presence = { id: client.sessionId, nickname: nickname || `Player ${client.sessionId.slice(0, 4)}`, zone, position: safePosition, cash, stats, seenAt: Date.now() }
      this.players.set(client.sessionId, presence)
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
      if (milestone !== 20 * 60 && milestone !== 40 * 60) return
      const results = this.minigameResults.get(milestone) ?? new Map<string, MinigameResult>()
      results.set(client.sessionId, {
        score: Math.max(0, Math.min(1_000_000, Math.floor(Number(message?.score) || 0))),
        progressValue: Math.max(1, Math.min(5_000_000_000, Math.floor(Number(message?.progressValue) || this.players.get(client.sessionId)?.cash || 1))),
      })
      this.minigameResults.set(milestone, results)
      const activePlayers = Math.max(1, this.players.size)
      if (results.size >= activePlayers) this.finalizeMinigame(milestone)
      else if (!this.minigameTimers.has(milestone)) this.minigameTimers.set(milestone, setTimeout(() => this.finalizeMinigame(milestone), 5000))
    })
    this.onMessage('minigame:forage', (client, message: { id?: string; readyAt?: number }) => {
      if (!message.id?.startsWith('ForageRush') || !Number.isFinite(message.readyAt)) return
      const readyAt = Math.min(Date.now() + 15_000, Math.max(Date.now(), Number(message.readyAt)))
      this.broadcast('minigame:forage', { id: message.id, readyAt }, { except: client })
    })
  }

  onJoin(client: Client) {
    client.send('match:sync', { seed: this.matchSeed, startedAt: this.matchStartedAt })
    client.send('presence:snapshot', [...this.players.values()])
    const presence: Presence = { id: client.sessionId, nickname: `Player ${client.sessionId.slice(0, 4)}`, zone: 'hub', position: [0, 0.86, 14], cash: 100_000, stats: { foraged: 0, mined: 0, harvested: 0, sold: 0 }, seenAt: Date.now() }
    this.players.set(client.sessionId, presence)
    this.broadcast('presence:move', presence, { except: client })
  }

  onLeave(client: Client) {
    for (const trade of this.trades.values()) if (trade.a === client.sessionId || trade.b === client.sessionId) {
      this.sendTo(this.other(trade, client.sessionId), 'trade:cancel', { tradeId: trade.id })
      this.trades.delete(trade.id)
    }
    this.players.delete(client.sessionId)
    this.broadcast('presence:leave', client.sessionId)
  }
}

const port = Number(process.env.PORT ?? 2567)
const gameServer = new Server({ transport: new WebSocketTransport() })
gameServer.define('woodland', WoodlandRoom)
await gameServer.listen(port, '0.0.0.0')
console.log(`Woodland multiplayer listening on ${port}`)
