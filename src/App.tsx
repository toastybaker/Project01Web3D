import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { GameWorld } from './game/World'
import { ITEMS, SHOPS, STOCKS, itemTooltip, type ItemId, type ShopKind, type StockId } from './game/items'
import { commodityPrice, formatCoins, lotteryJackpot, lotteryPrice, lotteryTwoMatch, sessionSecondsRemaining } from './game/economy'
import { BASKET_CONFIG, COMMODITY_MARKET_CONFIG, CROP_CONFIG, MATCH_CONFIG, PICKAXE_CONFIG, type CommodityId } from './game/config'
import { canMineOre, miningDuration, oreKindAtDepth, requiredPickaxe } from './game/ore'
import { onMultiplayer, sendMultiplayer } from './game/multiplayer'
import { economyProgressValue, inventoryLayout, lotteryDraw, preparedFoodValue, secretStockOffer, useGameStore, type MineNodeState, type SharedDeedResult, type SharedDeedSnapshot, type SharedFarmResult, type SharedFarmSnapshot, type SharedFarmUpdate } from './game/store'
import { RECIPES, RECIPE_IDS, type RecipeId } from './game/recipes'
import { FARM_RUSH_CROPS, FARM_RUSH_ORDER_LIFETIME_MS, FARM_RUSH_RECIPE_IDS, FORAGE_RUSH_REQUIREMENTS, MINIGAME_DURATION, MINING_RUSH_POINTS, farmRushOrders, minigameMilestones, minigameRewardPackage, miningRushOre, scheduledMinigame, type FarmRushCrop, type FarmRushTool, type ForageRushKind, type MiningRushOre } from './game/minigame'
import { playGameSfx, type GameSfx } from './game/sfx'
import { ENHANCEABLE_ITEMS, canStabilize, enhancedBasketCapacity, enhancementChance, enhancementLevel, enhancementName, enhancementRequirements, fortuneFor, isEnhanceableItem, miningSpeedBonus, type EnhanceableItem } from './game/enhancement'

function forageItem(anchorId: string): ItemId | null {
  if (anchorId.startsWith('ForageApple')) return 'apple'
  if (anchorId.startsWith('ForageOrange')) return 'orange'
  if (anchorId.startsWith('ForageBerry')) return 'berries'
  if (anchorId.startsWith('ForageMushroom')) return 'mushroom'
  if (anchorId.startsWith('ForageHerbs')) return 'wild-herbs'
  if (anchorId.startsWith('ForageFlower')) return 'wildflower'
  if (anchorId.startsWith('ForageTruffle')) return 'truffle'
  if (anchorId.startsWith('ForageDiscovery')) return 'natural-discovery'
  if (anchorId.startsWith('ForageFruit')) return Number(anchorId.match(/\d+/)?.[0] ?? 0) % 3 === 0 ? 'orange' : 'apple'
  return null
}

function activatePrompt(id: string) {
  const state = useGameStore.getState()
  if (id.startsWith('FarmRushCell')) return state.farmRushAction(id)
  if (id.startsWith('FarmRushCooker')) return state.setCookbookOpen(true)
  if (id.startsWith('ForageRushDeliver')) return state.forageRushDeliver(id.slice('ForageRushDeliver'.length).toLowerCase() as ForageRushKind)
  if (id.startsWith('ForageRush')) {
    state.forageRushCollect(id)
    const readyAt = useGameStore.getState().forageRushCollected[id]
    if (readyAt) sendMultiplayer('minigame:forage', { id, readyAt })
    return
  }
  const shops: Record<string, ShopKind> = { shop: 'common', 'forage-shop': 'forage', 'forage-sell': 'forage-sell', 'farm-shop': 'farm', 'produce-shop': 'produce', 'mine-shop': 'mine', 'ore-shop': 'ore' }
  if (shops[id]) return state.setShopOpen(true, shops[id])
  if (id === 'stocks') return state.setStockOpen(true)
  if (id === 'enhance') return state.setEnhancementOpen(true)
  if (id === 'secret-npc') return state.setSecretOpen(true)
  if (id.startsWith('furnace:')) return state.setCookbookOpen(true, Number(id.slice(8)))
  if (id.startsWith('farm-cell:')) {
    const [, farmIndex, cellIndex] = id.split(':')
    return state.farmAction(Number(farmIndex), Number(cellIndex))
  }
  if (id.startsWith('farm-claim:')) return state.claimFarm(Number(id.slice(11)))
  if (id.startsWith('forage:')) {
    const anchorId = id.slice(7)
    const item = forageItem(anchorId)
    if (item) return state.collectForage(anchorId, item)
  }
  if (id.startsWith('MineOre')) {
    const point = state.anchors[id]
    if (point) {
      const ore = oreKindAtDepth(id, point[2], state.mineGenerations[id] ?? 0, state.sessionSeed)
      const tool = state.hotbar[state.selectedHotbar]
      const enhancement = isEnhanceableItem(tool) ? enhancementLevel(state.enhancements, tool) : 0
      if (sendMultiplayer('mine:request', { id, tool, enhancement })) return
      return state.mineNode(id, ore)
    }
  }
}

function MineSync() {
  const syncSnapshot = useGameStore((state) => state.syncMineSnapshot)
  const syncNode = useGameStore((state) => state.syncMineNode)
  const awardNode = useGameStore((state) => state.awardMineNode)
  const setToast = useGameStore((state) => state.setToast)
  useEffect(() => {
    const offSnapshot = onMultiplayer('mine:snapshot', (raw) => {
      const message = raw as { seed?: number; nodes?: Record<string, MineNodeState> }
      if (Number.isFinite(message.seed) && message.nodes) syncSnapshot(Number(message.seed), message.nodes)
    })
    const offNode = onMultiplayer('mine:node', (raw) => {
      const message = raw as { id?: string; generation?: number; readyAt?: number }
      if (message.id && Number.isFinite(message.generation) && Number.isFinite(message.readyAt)) syncNode(message.id, { generation: Number(message.generation), readyAt: Number(message.readyAt) })
    })
    const offAward = onMultiplayer('mine:award', (raw) => {
      const message = raw as { id?: string; ore?: ItemId; quantity?: number; generation?: number; readyAt?: number }
      if (message.id && message.ore?.endsWith('-ore') && Number.isFinite(message.generation) && Number.isFinite(message.readyAt)) awardNode(message.id, message.ore as Parameters<typeof awardNode>[1], Number(message.quantity), { generation: Number(message.generation), readyAt: Number(message.readyAt) })
    })
    const offDenied = onMultiplayer('mine:denied', (raw) => {
      if ((raw as { reason?: string })?.reason === 'tier') setToast('Pickaxe tier too low')
    })
    return () => { offSnapshot(); offNode(); offAward(); offDenied() }
  }, [awardNode, setToast, syncNode, syncSnapshot])
  return null
}

function FarmSync() {
  const syncSnapshot = useGameStore((state) => state.syncFarmSnapshot)
  const syncUpdate = useGameStore((state) => state.syncFarmUpdate)
  const applyResult = useGameStore((state) => state.applyFarmResult)
  useEffect(() => {
    const offSnapshot = onMultiplayer('farm:snapshot', (raw) => syncSnapshot(raw as SharedFarmSnapshot))
    const offUpdate = onMultiplayer('farm:update', (raw) => syncUpdate(raw as SharedFarmUpdate))
    const offResult = onMultiplayer('farm:result', (raw) => applyResult(raw as SharedFarmResult))
    return () => { offSnapshot(); offUpdate(); offResult() }
  }, [applyResult, syncSnapshot, syncUpdate])
  return null
}

function DeedSync() {
  const syncSnapshot = useGameStore((state) => state.syncDeedSnapshot)
  const syncStock = useGameStore((state) => state.syncDeedStock)
  const applyResult = useGameStore((state) => state.applyDeedResult)
  useEffect(() => {
    const offSnapshot = onMultiplayer('deed:snapshot', (raw) => syncSnapshot(raw as SharedDeedSnapshot))
    const offStock = onMultiplayer('deed:stock', (raw) => syncStock(Number((raw as { globalRemaining?: number }).globalRemaining)))
    const offResult = onMultiplayer('deed:result', (raw) => applyResult(raw as SharedDeedResult))
    return () => { offSnapshot(); offStock(); offResult() }
  }, [applyResult, syncSnapshot, syncStock])
  return null
}

function AudioBed() {
  const zone = useGameStore((state) => state.zone)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const volumes = useGameStore((state) => state.audioVolumes)
  const musicRef = useRef<HTMLAudioElement | null>(null)
  const ambienceRef = useRef<HTMLAudioElement | null>(null)
  const unlocked = useRef(false)
  const playlistIndex = useRef(0)
  useEffect(() => {
    const music = new Audio('/assets/audio/Faure_Sicilienne_FlutePiano.mp3')
    const ambience = new Audio('/assets/audio/Forest_Ambience_PD.ogg')
    musicRef.current = music
    ambienceRef.current = ambience
    music.loop = true
    ambience.loop = true
    const start = () => {
      unlocked.current = true
      void music.play().catch(() => undefined)
      void ambience.play().catch(() => undefined)
      window.removeEventListener('pointerdown', start)
      window.removeEventListener('keydown', start)
    }
    window.addEventListener('pointerdown', start)
    window.addEventListener('keydown', start)
    return () => {
      music.pause()
      ambience.pause()
      musicRef.current = null
      ambienceRef.current = null
      window.removeEventListener('pointerdown', start)
      window.removeEventListener('keydown', start)
    }
  }, [])
  useEffect(() => {
    if (musicRef.current) musicRef.current.volume = volumes.master * volumes.music * 0.38
    if (ambienceRef.current) ambienceRef.current.volume = volumes.master * volumes.ambience * 0.38
  }, [volumes])
  useEffect(() => {
    const music = musicRef.current
    const ambience = ambienceRef.current
    if (!music || !ambience) return
    const playlists = {
      hub: ['/assets/audio/Faure_Sicilienne_FlutePiano.mp3', '/assets/audio/Faure_Fantasie_FlutePiano.ogg'],
      forage: ['/assets/audio/Faure_Sicilienne_FlutePiano.mp3', '/assets/audio/Faure_Elegie_CelloPiano.ogg'],
      farm: ['/assets/audio/Faure_Fantasie_FlutePiano.ogg', '/assets/audio/Faure_Sicilienne_FlutePiano.mp3'],
      mine: ['/assets/audio/Faure_Sicilienne_FlutePiano.mp3', '/assets/audio/Faure_Fantasie_FlutePiano.ogg'],
    } as const
    const audioZone = minigameOpen ? (minigameKind === 'mining' ? 'mine' : minigameKind) : zone
    const tracks = playlists[audioZone]
    playlistIndex.current = 0
    music.loop = false
    const playTrack = () => {
      music.src = tracks[playlistIndex.current]
      if (audioZone === 'forage' && playlistIndex.current === 0) music.addEventListener('loadedmetadata', () => { music.currentTime = Math.min(96, music.duration * 0.3) }, { once: true })
      if (unlocked.current) void music.play().catch(() => undefined)
    }
    const nextTrack = () => {
      playlistIndex.current = (playlistIndex.current + 1) % tracks.length
      playTrack()
    }
    const ambienceSource = audioZone === 'mine' ? '/assets/audio/Cave_Water_Drips_CC-BY-SA.ogg' : audioZone === 'hub' ? '/assets/audio/Forest_Ambience_PD.ogg' : '/assets/audio/Forest_Ambience_PD.mp3'
    music.addEventListener('ended', nextTrack)
    playTrack()
    if (!ambience.src.endsWith(ambienceSource)) ambience.src = ambienceSource
    if (unlocked.current) {
      void music.play().catch(() => undefined)
      void ambience.play().catch(() => undefined)
    }
    return () => music.removeEventListener('ended', nextTrack)
  }, [minigameKind, minigameOpen, zone])
  return null
}

type BurstKind = 'stone' | 'leaf' | 'water' | 'gold' | 'spark'

function feedbackFor(toast: string, zone: ReturnType<typeof useGameStore.getState>['zone'], cashDelta: number, minigameKind: ReturnType<typeof useGameStore.getState>['minigameKind']): { sound: GameSfx; burst?: BurstKind } | null {
  if (toast.startsWith('Upgraded') || toast.startsWith('Upgrade failed')) return null
  if (/^(Need|Not enough|Sold out|None owned|Select|Missing|Gone|Own a farm|Not your|Pickaxe tier|Fruit storage|Recipe not|Furnace queue)/.test(toast)) return { sound: 'error' }
  if (toast.startsWith('Unlocked')) return { sound: 'unlock', burst: 'spark' }
  if (toast.startsWith('Planted')) return { sound: 'plant', burst: 'leaf' }
  if (toast === 'Watered') return { sound: 'water', burst: 'water' }
  if (toast === 'Delivered') return { sound: 'coin', burst: 'gold' }
  if (cashDelta > 0) return { sound: 'coin', burst: 'gold' }
  if (cashDelta < 0) return { sound: 'buy', burst: 'gold' }
  if (toast.startsWith('+')) {
    if (zone === 'mine' || minigameKind === 'mining') return { sound: 'mine-complete', burst: 'stone' }
    if (zone === 'forage' || minigameKind === 'forage') return { sound: 'forage', burst: 'leaf' }
    return { sound: 'forage', burst: 'leaf' }
  }
  if (toast === 'Returned home') return { sound: 'teleport', burst: 'spark' }
  return null
}

function FeedbackBed() {
  const toast = useGameStore((state) => state.toast)
  const cash = useGameStore((state) => state.cash)
  const zone = useGameStore((state) => state.zone)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const volumes = useGameStore((state) => state.audioVolumes)
  const cookQueue = useGameStore((state) => state.cookQueue)
  const previousCash = useRef(cash)
  const [burst, setBurst] = useState<{ id: number; kind: BurstKind } | null>(null)

  useEffect(() => {
    const delta = cash - previousCash.current
    previousCash.current = cash
    if (!toast) return
    const feedback = feedbackFor(toast, zone, delta, minigameKind)
    if (!feedback) return
    const liveVolumes = useGameStore.getState().audioVolumes
    playGameSfx(feedback.sound, liveVolumes.master * liveVolumes.effects)
    if (!feedback.burst) return
    const next = { id: Date.now(), kind: feedback.burst }
    setBurst(next)
    const timer = window.setTimeout(() => setBurst((current) => current?.id === next.id ? null : current), 720)
    return () => window.clearTimeout(timer)
  }, [cash, minigameKind, toast, zone])

  useEffect(() => {
    const now = Date.now()
    const timers = cookQueue.filter((job) => job.readyAt > now).map((job) => window.setTimeout(() => playGameSfx('ready', volumes.master * volumes.effects), job.readyAt - now))
    return () => timers.forEach(window.clearTimeout)
  }, [cookQueue, volumes.effects, volumes.master])

  return burst ? <div className={`action-burst ${burst.kind}`} key={burst.id} aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div> : null
}

function Icon({ name }: { name: 'clock' | 'refresh' | 'coin' | 'menu' | 'close' | 'pack' | 'users' }) {
  const paths = {
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    refresh: <><path d="M18 8a7 7 0 1 0 1 7" /><path d="M18 4v4h-4" /></>,
    coin: <><circle cx="12" cy="12" r="8" /><path d="M15 8.5C14.3 7.5 13.2 7 11.9 7 10.1 7 9 7.9 9 9.3c0 1.5 1.3 2 3.1 2.4 1.8.4 3 1 3 2.6 0 1.5-1.4 2.7-3.3 2.7-1.5 0-2.8-.6-3.6-1.7M12 5v14" /></>,
    menu: <><path d="M6 8h12M6 12h12M6 16h12" /></>,
    close: <><path d="M7 7l10 10M17 7 7 17" /></>,
    pack: <><path d="M7 9h10l1 10H6L7 9Z" /><path d="M9 9V7a3 3 0 0 1 6 0v2" /></>,
    users: <><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.3" /><path d="M4 19c.4-3 2.2-4.5 5-4.5s4.6 1.5 5 4.5M14 15.5c3-.8 5.3.5 6 3.5" /></>,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function HUD() {
  const zone = useGameStore((state) => state.zone)
  const cash = useGameStore((state) => state.cash)
  const restock = useGameStore((state) => state.restockSeconds)
  const round = useGameStore((state) => state.roundSeconds)
  const roundNumber = useGameStore((state) => state.roundNumber)
  const sessionDuration = useGameStore((state) => state.sessionDurationSeconds)
  const sessionSeed = useGameStore((state) => state.sessionSeed)
  const weather = useGameStore((state) => state.weather)
  const weatherSeconds = useGameStore((state) => state.weatherSeconds)
  const marketCorrectionName = useGameStore((state) => state.marketCorrectionName)
  const marketCorrectionSeconds = useGameStore((state) => state.marketCorrectionSeconds)
  const setMenuOpen = useGameStore((state) => state.setMenuOpen)
  const setPlayerPanelOpen = useGameStore((state) => state.setPlayerPanelOpen)
  const tickGame = useGameStore((state) => state.tickGame)
  useEffect(() => {
    const timer = window.setInterval(tickGame, 1000)
    return () => window.clearInterval(timer)
  }, [tickGame])
  const minutes = Math.floor(restock / 60).toString().padStart(2, '0')
  const seconds = (restock % 60).toString().padStart(2, '0')
  const remaining = sessionSecondsRemaining(roundNumber, round, sessionDuration)
  const roundMinutes = Math.floor(remaining / 60).toString().padStart(2, '0')
  const roundSeconds = (remaining % 60).toString().padStart(2, '0')
  const locations = { hub: 'LANTERN HOLLOW', forage: 'MOSSWOOD', farm: 'SUNMEADOW', mine: 'STONEWAKE' }
  const elapsed = (roundNumber - 1) * MATCH_CONFIG.worldCycleSeconds + (MATCH_CONFIG.worldCycleSeconds - round)
  const nextEventAt = minigameMilestones(sessionDuration).find((milestone) => milestone > elapsed)
  const eventIn = nextEventAt === undefined ? null : nextEventAt - elapsed
  const upcomingEvent = nextEventAt === undefined ? null : scheduledMinigame(nextEventAt, sessionSeed, sessionDuration)
  const eventIcon: ItemId | null = upcomingEvent === 'mining' ? 'crystal-pickaxe' : upcomingEvent === 'farm' ? 'wheat-seeds' : upcomingEvent === 'forage' ? 'apple' : null
  return (
    <>
      <div className="location-chip"><span className="location-dot" />{locations[zone]}</div>
      <div className="hud-modules">
        {marketCorrectionName && marketCorrectionSeconds > 0 && <div className="market-news"><span>MARKET NEWS</span><strong>{marketCorrectionName}</strong></div>}
        {weather !== 'clear' && zone !== 'mine' && <div className="hud-chip weather"><span className={`weather-mark ${weather}`} /><span>{weather.toUpperCase()}</span><HoverTip lines={weather === 'rain' ? ['Crops water automatically.', `${weatherSeconds}s remaining`] : weather === 'sunny' ? ['Crops and fruit grow 15% faster.', `${weatherSeconds}s remaining`] : weather === 'breeze' ? ['Cooking finishes 10% faster.', `${weatherSeconds}s remaining`] : ['Soft visibility change.', `${weatherSeconds}s remaining`]} /></div>}
        {eventIn !== null && eventIn <= 60 && eventIcon && <div className="hud-chip upcoming-event" title={`${upcomingEvent} event`}><img src={ITEMS[eventIcon].icon} alt="" /><span>0:{String(eventIn).padStart(2, '0')}</span></div>}
        <div className="hud-chip" title="Match time"><Icon name="clock" /><span>{roundMinutes}:{roundSeconds}</span></div>
        <div className="hud-chip restock"><Icon name="refresh" /><span>{minutes}:{seconds}</span></div>
        <div className="hud-chip" title={formatCoins(cash)}><Icon name="coin" /><span>{formatCoins(cash, true)}</span></div>
        <button className="hud-chip icon-button" onClick={() => setPlayerPanelOpen(true)} aria-label="Players"><Icon name="users" /></button>
        <button className="hud-chip icon-button" onClick={() => setMenuOpen(true)} aria-label="Menu"><Icon name="menu" /></button>
      </div>
    </>
  )
}

function LobbyPanel() {
  const started = useGameStore((state) => state.sessionStarted)
  const connected = useGameStore((state) => state.lobbyConnected)
  const isHost = useGameStore((state) => state.isHost)
  const duration = useGameStore((state) => state.sessionDurationSeconds)
  const nickname = useGameStore((state) => state.nickname)
  const players = useGameStore((state) => state.onlinePlayers)
  const setNickname = useGameStore((state) => state.setNickname)
  const [draftName, setDraftName] = useState(nickname)
  if (started) return null
  const chooseDuration = (seconds: number) => {
    if (!isHost) return
    sendMultiplayer('lobby:update', { durationSeconds: seconds })
  }
  const start = () => {
    if (!isHost) return
    sendMultiplayer('lobby:start', {})
  }
  return <div className="modal-scrim lobby-scrim"><section className="panel lobby-panel">
    <header><div className="panel-title"><span className="lobby-mark">P1</span><span>WOODLAND RUN</span></div><b>{players.length + 1}/6</b></header>
    <label className="lobby-name"><span>NAME</span><input aria-label="Nickname" value={draftName} maxLength={18} onChange={(event) => setDraftName(event.target.value)} onBlur={() => setNickname(draftName)} onKeyDown={(event) => { if (event.key === 'Enter') { setNickname(draftName); event.currentTarget.blur() } }} /></label>
    <div className="lobby-duration"><span>TIME</span><div>{MATCH_CONFIG.selectableDurationsSeconds.map((seconds) => <button className={duration === seconds ? 'active' : ''} disabled={!isHost} key={seconds} onClick={() => chooseDuration(seconds)}>{seconds / 60}</button>)}</div></div>
    {isHost ? <button className="lobby-start" disabled={!connected} onClick={start}>{connected ? 'START GAME' : 'CONNECTING'}</button> : <div className="lobby-wait">{connected ? 'WAITING FOR HOST' : 'CONNECTING'}</div>}
  </section></div>
}

function Hotbar() {
  const realHotbar = useGameStore((state) => state.hotbar)
  const realInventory = useGameStore((state) => state.inventory)
  const enhancements = useGameStore((state) => state.enhancements)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const farmRushInventory = useGameStore((state) => state.farmRushInventory)
  const farmRushCooking = useGameStore((state) => state.farmRushCooking)
  const minigameMilestone = useGameStore((state) => state.minigameMilestone)
  const forageRushInventory = useGameStore((state) => state.forageRushInventory)
  const selectedHotbar = useGameStore((state) => state.selectedHotbar)
  const farmRushTool = useGameStore((state) => state.farmRushTool)
  const setSelected = useGameStore((state) => state.setSelectedHotbar)
  const setFarmRushTool = useGameStore((state) => state.setFarmRushTool)
  const setSlot = useGameStore((state) => state.setHotbarSlot)
  const swapSlots = useGameStore((state) => state.swapHotbarSlots)
  const inspectTickets = useGameStore((state) => state.setTicketInspectOpen)
  const inspectNotes = useGameStore((state) => state.setNoteInspectOpen)
  const setTravelOpen = useGameStore((state) => state.setTravelOpen)
  const useCookbookBox = useGameStore((state) => state.useCookbookBox)
  const eventView = minigameOpen ? eventInventoryView(minigameKind, farmRushInventory, forageRushInventory, farmRushCooking, minigameMilestone) : null
  const hotbar = eventView?.hotbar ?? realHotbar
  const inventory = eventView?.inventory ?? realInventory
  const selected = minigameOpen && minigameKind === 'farm' ? FARM_RUSH_TOOLS.indexOf(farmRushTool) : minigameOpen ? 0 : selectedHotbar
  return (
    <div className="hotbar" aria-label="Hotbar">
      {hotbar.map((storedItem, index) => {
        const item = storedItem && (inventory[storedItem] ?? 0) > 0 ? storedItem : null
        const itemEnhancement = !minigameOpen && isEnhanceableItem(item) ? enhancementLevel(enhancements, item) : 0
        return <button
          className={`hotbar-slot ${index === selected ? 'selected' : ''}`}
          key={index}
          onClick={() => {
            if (minigameOpen && minigameKind === 'farm' && FARM_RUSH_TOOLS[index]) setFarmRushTool(FARM_RUSH_TOOLS[index])
            else if (!minigameOpen) setSelected(index)
          }}
          onDoubleClick={() => { if (!minigameOpen) setSlot(index, null) }}
          onContextMenu={(event) => {
            event.preventDefault()
            if (minigameOpen) return
            if (item === 'lottery-ticket') inspectTickets(true)
            if (item === 'information-note') inspectNotes(true)
            if (item === 'home-charm') setTravelOpen(true)
            if (item === 'cookbook-box') useCookbookBox()
          }}
          onDragOver={(event) => { if (!minigameOpen) event.preventDefault() }}
          onDrop={(event) => {
            if (minigameOpen) return
            event.preventDefault()
            const sourceSlot = event.dataTransfer.getData('hotbar-slot')
            const droppedItem = event.dataTransfer.getData('item-id') as ItemId
            if (sourceSlot) swapSlots(Number(sourceSlot), index)
            else if (droppedItem) setSlot(index, droppedItem)
          }}
          draggable={!minigameOpen && Boolean(item)}
          onDragStart={(event) => { if (!minigameOpen) event.dataTransfer.setData('hotbar-slot', String(index)) }}
          aria-label={item ? `${index + 1}: ${isEnhanceableItem(item) ? enhancementName(item, itemEnhancement) : ITEMS[item].name}` : `Slot ${index + 1}`}
        >
          {item && <img src={ITEMS[item].icon} alt={ITEMS[item].name} />}
          {item && minigameOpen && minigameKind === 'farm' && index < FARM_RUSH_TOOLS.length - 1 ? <span className="quantity">∞</span> : item && (inventory[item] ?? 0) > 1 && <span className="quantity">{inventory[item]}</span>}
          {item && <HoverTip lines={itemTooltip(item, itemEnhancement)} />}
        </button>
      })}
    </div>
  )
}

const FARM_RUSH_TOOLS: FarmRushTool[] = [...FARM_RUSH_CROPS, 'water']

function eventInventoryView(kind: 'mining' | 'farm' | 'forage', farmInventory: Record<string, number>, forageInventory: Record<string, number>, cooking: Array<{ orderIndex: number; readyAt: number }>, milestone: number) {
  const hotbar: Array<ItemId | null> = Array(9).fill(null)
  const inventory: Partial<Record<ItemId, number>> = {}
  if (kind === 'mining') {
    hotbar[0] = 'crystal-pickaxe'
    inventory['crystal-pickaxe'] = 1
  } else if (kind === 'farm') {
    FARM_RUSH_TOOLS.forEach((tool, index) => {
      hotbar[index] = tool === 'water' ? 'water-can' : `${tool}-seeds` as ItemId
      inventory[hotbar[index]!] = 1
    })
    FARM_RUSH_CROPS.forEach((id) => { inventory[id as ItemId] = farmInventory[id] ?? 0 })
    const orders = farmRushOrders(milestone)
    cooking.filter((job) => job.readyAt <= Date.now()).forEach((job) => {
      const food = orders[job.orderIndex % orders.length].food
      inventory[food] = (inventory[food] ?? 0) + 1
    })
    const collected = FARM_RUSH_CROPS.filter((id) => (farmInventory[id] ?? 0) > 0)
    collected.slice(0, 3).forEach((id, offset) => { hotbar[6 + offset] = id as ItemId })
  } else {
    const forageItems: Array<[ItemId, string]> = [['apple', 'apple'], ['orange', 'orange'], ['truffle', 'truffle'], ['natural-discovery', 'discovery']]
    forageItems.forEach(([id, key], index) => { hotbar[index] = id; inventory[id] = forageInventory[key] ?? 0 })
  }
  const inventoryOrder = [...hotbar, ...Object.keys(inventory).filter((id) => !hotbar.includes(id as ItemId))] as Array<ItemId | null>
  return { hotbar, inventory, inventoryOrder }
}

function InteractionPrompt() {
  const prompt = useGameStore((state) => state.prompt)
  const progress = useGameStore((state) => state.interactionProgress)
  const anchors = useGameStore((state) => state.anchors)
  const mineGenerations = useGameStore((state) => state.mineGenerations)
  const sessionSeed = useGameStore((state) => state.sessionSeed)
  const rushNodes = useGameStore((state) => state.rushNodes)
  const minigameMilestone = useGameStore((state) => state.minigameMilestone)
  const hotbar = useGameStore((state) => state.hotbar)
  const selectedHotbar = useGameStore((state) => state.selectedHotbar)
  const farmRushCells = useGameStore((state) => state.farmRushCells)
  const farmRushTool = useGameStore((state) => state.farmRushTool)
  const farmRushCooking = useGameStore((state) => state.farmRushCooking)
  const enhancements = useGameStore((state) => state.enhancements)
  if (!prompt) return null
  if (prompt.id.startsWith('MineOre') || prompt.id.startsWith('RushOre')) {
    const point = anchors[prompt.id]
    if (!point) return null
    const rush = prompt.id.startsWith('RushOre')
    const ore = rush ? miningRushOre(minigameMilestone, prompt.id, rushNodes[prompt.id]?.generation ?? 0) : oreKindAtDepth(prompt.id, point[2], mineGenerations[prompt.id] ?? 0, sessionSeed)
    const tool = hotbar[selectedHotbar]
    const toolEnhancement = !rush && isEnhanceableItem(tool) ? enhancementLevel(enhancements, tool) : 0
    const duration = rush ? 760 : miningDuration(tool, ore, toolEnhancement)
    const remaining = duration ? Math.max(0, duration * (1 - progress)) : 0
    const required = requiredPickaxe(ore)
    return <div className={`interaction mine-interaction ${duration ? '' : 'locked'}`}>
      <i className="interaction-fill" style={{ width: `${progress * 100}%` }} />
      <kbd>LMB</kbd><span>{ITEMS[ore].name}</span>
      <small>{duration ? `${(remaining / 1000).toFixed(1)}s` : `Equip ${PICKAXE_CONFIG[required].name}`}</small>
    </div>
  }
  if (prompt.id.startsWith('FarmRushCell')) {
    const cell = farmRushCells[prompt.id] ?? { crop: null, stage: 'empty', readyAt: 0 }
    const ready = cell.stage === 'watered' && cell.readyAt <= Date.now()
    const label = ready ? 'Harvest' : cell.stage === 'empty' ? `Plant ${farmRushTool === 'water' ? '' : farmRushTool}` : cell.stage === 'planted' ? 'Water' : `${Math.max(1, Math.ceil((cell.readyAt - Date.now()) / 1000))}s`
    return <div className="interaction"><kbd>LMB</kbd><span>{label}</span></div>
  }
  if (prompt.id.startsWith('FarmRushCooker')) return <div className="interaction"><kbd>F</kbd><span>{farmRushCooking.length ? `${farmRushCooking.length}/3 cooking` : 'Cook'}</span></div>
  if (prompt.id.startsWith('ForageRush')) return <div className="interaction"><kbd>F</kbd><span>{prompt.label}</span></div>
  return <div className="interaction"><kbd>F</kbd><span>{prompt.label}</span></div>
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return <button className="close-button" onClick={onClick} aria-label="Close"><Icon name="close" /></button>
}

function HoverTip({ lines }: { lines: string[] | null }) {
  if (!lines?.length) return null
  return <span className="hover-tip">{lines.map((line) => <small key={line}>{line}</small>)}</span>
}

function InventoryPanel() {
  const open = useGameStore((state) => state.inventoryOpen)
  const toggle = useGameStore((state) => state.toggleInventory)
  const realInventory = useGameStore((state) => state.inventory)
  const realInventoryOrder = useGameStore((state) => state.inventoryOrder)
  const realHotbar = useGameStore((state) => state.hotbar)
  const enhancements = useGameStore((state) => state.enhancements)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const farmRushInventory = useGameStore((state) => state.farmRushInventory)
  const farmRushCooking = useGameStore((state) => state.farmRushCooking)
  const minigameMilestone = useGameStore((state) => state.minigameMilestone)
  const forageRushInventory = useGameStore((state) => state.forageRushInventory)
  const moveInventorySlot = useGameStore((state) => state.moveInventorySlot)
  const equipItem = useGameStore((state) => state.equipItem)
  const inspectTickets = useGameStore((state) => state.setTicketInspectOpen)
  const inspectNotes = useGameStore((state) => state.setNoteInspectOpen)
  const setTravelOpen = useGameStore((state) => state.setTravelOpen)
  const useCookbookBox = useGameStore((state) => state.useCookbookBox)
  const dragging = useRef<number | null>(null)
  const eventView = minigameOpen ? eventInventoryView(minigameKind, farmRushInventory, forageRushInventory, farmRushCooking, minigameMilestone) : null
  const inventory = eventView?.inventory ?? realInventory
  const inventoryOrder = eventView?.inventoryOrder ?? inventoryLayout({ hotbar: realHotbar, inventoryOrder: realInventoryOrder, inventory: realInventory })
  const hotbar = eventView?.hotbar ?? realHotbar
  if (!open) return null
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && toggle()}>
      <section className="panel inventory-panel">
        <header><div className="panel-title"><Icon name="pack" /><span>PACK</span></div><CloseButton onClick={toggle} /></header>
        <div className="inventory-grid">
          {Array.from({ length: 36 }, (_, index) => {
            const ordered = inventoryOrder[index]
            const id = index < 9 ? hotbar[index] : ordered && !hotbar.includes(ordered) ? ordered : null
            const quantity = id ? inventory[id] ?? 0 : 0
            return <div
              className="inventory-slot"
              key={index}
              onDragOver={(event) => { if (!minigameOpen) event.preventDefault() }}
              onDrop={() => { if (!minigameOpen && dragging.current !== null) moveInventorySlot(dragging.current, index); dragging.current = null }}
            >{id && quantity > 0 && <><img draggable={!minigameOpen} src={ITEMS[id].icon} alt={isEnhanceableItem(id) && !minigameOpen ? enhancementName(id, enhancementLevel(enhancements, id)) : ITEMS[id].name} onClick={() => { if (minigameOpen) return; if (id === 'lottery-ticket') inspectTickets(true); else if (id === 'information-note') inspectNotes(true); else if (id === 'cookbook-box') useCookbookBox(); else equipItem(id) }} onContextMenu={(event) => { event.preventDefault(); if (minigameOpen) return; if (id === 'lottery-ticket') inspectTickets(true); if (id === 'information-note') inspectNotes(true); if (id === 'home-charm') setTravelOpen(true); if (id === 'cookbook-box') useCookbookBox() }} onDragStart={(event) => { if (!minigameOpen) { dragging.current = index; event.dataTransfer.setData('item-id', id) } }} onDragEnd={() => { dragging.current = null }} /><span>{minigameOpen && minigameKind === 'farm' && index < FARM_RUSH_TOOLS.length - 1 ? '∞' : quantity}</span><HoverTip lines={itemTooltip(id, !minigameOpen && isEnhanceableItem(id) ? enhancementLevel(enhancements, id) : 0)} /></>}</div>
          })}
        </div>
      </section>
    </div>
  )
}

function ShopPanel() {
  const open = useGameStore((state) => state.shopOpen)
  const close = useGameStore((state) => state.setShopOpen)
  const kind = useGameStore((state) => state.shopKind)
  const cash = useGameStore((state) => state.cash)
  const inventory = useGameStore((state) => state.inventory)
  const trade = useGameStore((state) => state.trade)
  const commodityMarket = useGameStore((state) => state.commodityMarket)
  const round = useGameStore((state) => state.roundNumber)
  const shopStock = useGameStore((state) => state.shopStock)
  const enhancements = useGameStore((state) => state.enhancements)
  const sharedDeedOnline = useGameStore((state) => state.sharedDeedOnline)
  const personalDeedAvailable = useGameStore((state) => state.personalDeedAvailable)
  const globalDeedsRemaining = useGameStore((state) => state.globalDeedsRemaining)
  const openLottery = useGameStore((state) => state.setLotteryOpen)
  if (!open) return null
  const shop = SHOPS[kind]
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
      <section className="panel shop-panel">
        <header><div className="panel-title"><span className="shop-mark">{shop.title[0]}</span><span>{shop.title}</span></div><div className="shop-balance" title={formatCoins(cash)}><Icon name="coin" /><span>{formatCoins(cash, true)}</span></div><CloseButton onClick={() => close(false)} /></header>
        <div className="shop-grid">
          {shop.items.map((id) => {
            const item = ITEMS[id]
            const commodity = id in COMMODITY_MARKET_CONFIG ? id as CommodityId : null
            const price = id === 'lottery-ticket' ? lotteryPrice(round) : shop.action === 'sell' && commodity ? commodityPrice(commodity, item.sellPrice ?? 0, commodityMarket[commodity]) : shop.action === 'sell' ? item.sellPrice : item.buyPrice
            const owned = inventory[id] ?? 0
            const level = isEnhanceableItem(id) ? enhancementLevel(enhancements, id) : 0
            const displayName = isEnhanceableItem(id) ? enhancementName(id, level) : item.name
            const sharedDeed = id === 'farm-deed' && sharedDeedOnline
            const available = sharedDeed ? (personalDeedAvailable ? 1 : 0) + globalDeedsRemaining : item.limited ? shopStock[id] ?? 0 : null
            const stockLabel = isEnhanceableItem(id) && owned > 0 ? 'OWNED' : sharedDeed ? (personalDeedAvailable ? 'PERSONAL' : `${globalDeedsRemaining} SHARED`) : available !== null ? `${available} LEFT` : null
            return <button
              className="shop-tile"
              key={id}
              onMouseDown={(event) => {
                event.preventDefault()
                if (id === 'lottery-ticket') return openLottery(true)
                const amount = event.shiftKey ? 10 : 1
                if (event.button === 0 && shop.action !== 'sell') trade(id, amount)
                if (event.button === 2 && shop.action !== 'buy') trade(id, -amount)
              }}
              onContextMenu={(event) => event.preventDefault()}
            ><img src={item.icon} alt={displayName} /><span className="shop-item-name">{displayName}</span><span className="shop-owned"><b>×{owned}</b>{stockLabel && <em>{stockLabel}</em>}</span><span className="shop-price" title={price ? formatCoins(price) : undefined}><Icon name="coin" />{price ? formatCoins(price, true) : '—'}</span><HoverTip lines={itemTooltip(id, level)} /></button>
          })}
        </div>
      </section>
    </div>
  )
}

function LotteryPanel() {
  const open = useGameStore((state) => state.lotteryOpen)
  const close = useGameStore((state) => state.setLotteryOpen)
  const draft = useGameStore((state) => state.lotteryDraft)
  const toggle = useGameStore((state) => state.toggleLotteryNumber)
  const buy = useGameStore((state) => state.buyLotteryTicket)
  const cash = useGameStore((state) => state.cash)
  const round = useGameStore((state) => state.roundNumber)
  const [tier, setTier] = useState<1 | 5 | 25>(1)
  const price = lotteryPrice(round) * tier
  const twoMatch = lotteryTwoMatch(round) * tier
  const jackpot = lotteryJackpot(round) * tier
  if (!open) return null
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
      <section className="panel lottery-panel">
        <header><div className="panel-title"><span className="ticket-mark">✦</span><span>LOTTERY</span></div><div className="shop-balance" title={formatCoins(cash)}><Icon name="coin" /><span>{formatCoins(cash, true)}</span></div><CloseButton onClick={() => close(false)} /></header>
        <div className="lottery-tiers">{([1,5,25] as const).map((value) => <button className={tier === value ? 'active' : ''} key={value} onClick={() => setTier(value)}>{value === 1 ? 'STANDARD' : value === 5 ? 'GOLD' : 'GRAND'}</button>)}</div>
        <div className="number-grid">
          {Array.from({ length: 12 }, (_, index) => index + 1).map((number) => <button key={number} className={draft.includes(number) ? 'selected' : ''} onClick={() => toggle(number)}>{number}</button>)}
        </div>
        <footer className="lottery-footer"><span>{draft.length}/3</span><button disabled={draft.length !== 3 || cash < price} onClick={() => buy(tier)}><Icon name="coin" />{formatCoins(price, true)}</button><small>2 · {formatCoins(twoMatch, true)} &nbsp; 3 · {formatCoins(jackpot, true)}</small><em>DRAW R{round}</em></footer>
      </section>
    </div>
  )
}

function TicketInspectPanel() {
  const open = useGameStore((state) => state.ticketInspectOpen)
  const close = useGameStore((state) => state.setTicketInspectOpen)
  const tickets = useGameStore((state) => state.lotteryTickets)
  const round = useGameStore((state) => state.roundNumber)
  if (!open) return null
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
      <section className="panel ticket-inspect-panel">
        <header><div className="panel-title"><span className="ticket-mark">✦</span><span>LOTTERY</span></div><CloseButton onClick={() => close(false)} /></header>
        <div className="ticket-stack">
          {[...tickets].reverse().map((ticket) => <div className={ticket.draw ? 'ticket-card drawn' : 'ticket-card'} key={ticket.id}>
            <span className="ticket-round">R{ticket.drawRound} · {ticket.tier === 25 ? 'GRAND' : ticket.tier === 5 ? 'GOLD' : 'STANDARD'}</span>
            <strong>{ticket.numbers.map((number) => <i key={number}>{number}</i>)}</strong>
            <small>{ticket.draw ? `${ticket.matches ?? 0} match${ticket.matches === 1 ? '' : 'es'}${ticket.payout ? ` · +${formatCoins(ticket.payout, true)}` : ''}` : round === ticket.drawRound ? 'NEXT DRAW' : `DRAW ${lotteryDraw(ticket.drawRound).join(' · ')}`}</small>
          </div>)}
          {tickets.length === 0 && <div className="empty-ticket">NO TICKETS</div>}
        </div>
      </section>
    </div>
  )
}

function SecretDealPanel() {
  const open = useGameStore((state) => state.secretOpen)
  const close = useGameStore((state) => state.setSecretOpen)
  const buy = useGameStore((state) => state.buySecretInfo)
  const zone = useGameStore((state) => state.zone)
  const round = useGameStore((state) => state.roundNumber)
  const prices = useGameStore((state) => state.stockPrices)
  const sessionSeed = useGameStore((state) => state.sessionSeed)
  const corrections = useGameStore((state) => state.marketCorrectionsApplied.length)
  const cash = useGameStore((state) => state.cash)
  const purchases = useGameStore((state) => state.brokerPurchases)
  if (!open || zone === 'hub') return null
  const duration = useGameStore((state) => state.sessionDurationSeconds)
  const offers = [0, 1].map((slot) => secretStockOffer(round, prices, sessionSeed, corrections, slot, duration))
  return (
    <div className="modal-scrim secret-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
      <section className="panel secret-panel">
        <header><div className="panel-title"><span className="secret-mark">?</span><span>WANDERING BROKER</span></div><CloseButton onClick={() => close(false)} /></header>
        <div className="broker-offers">{offers.map((offer, slot) => {
          const bought = purchases.includes(`${round}:${slot}`)
          return <article key={slot}><img src="/assets/ui/cooking/cookbook.png" alt="" /><span><strong>{`INFO ${slot + 1}`}</strong><small>SEALED INFORMATION</small></span><button disabled={bought || cash < offer.cost} onClick={() => buy(slot)}>{bought ? 'SOLD' : formatCoins(offer.cost, true)}</button></article>
        })}</div>
      </section>
    </div>
  )
}

function NoteInspectPanel() {
  const open = useGameStore((state) => state.noteInspectOpen)
  const close = useGameStore((state) => state.setNoteInspectOpen)
  const notes = useGameStore((state) => state.brokerNotes)
  if (!open) return null
  return <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}><section className="panel note-panel"><header><div className="panel-title"><img className="cookbook-mark" src="/assets/ui/cooking/cookbook.png" alt="" /><span>INFORMATION</span></div><CloseButton onClick={() => close(false)} /></header><div className="note-list">{[...notes].reverse().map((note) => <article key={note.id}><small>R{note.round}</small><strong>{note.title}</strong><p>{note.text}</p></article>)}{notes.length === 0 && <div className="empty-ticket">NO INFORMATION</div>}</div></section></div>
}

function StocksPanel() {
  const open = useGameStore((state) => state.stockOpen)
  const close = useGameStore((state) => state.setStockOpen)
  const prices = useGameStore((state) => state.stockPrices)
  const portfolio = useGameStore((state) => state.portfolio)
  const history = useGameStore((state) => state.stockHistory)
  const supply = useGameStore((state) => state.stockSupply)
  const round = useGameStore((state) => state.roundNumber)
  const roundSeconds = useGameStore((state) => state.roundSeconds)
  const cash = useGameStore((state) => state.cash)
  const trade = useGameStore((state) => state.tradeStock)
  if (!open) return null
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
      <section className="panel stocks-panel">
        <header><div className="panel-title"><span className="shop-mark">↗</span><span>STOCK EXCHANGE</span></div><div className="shop-balance" title={formatCoins(cash)}><Icon name="coin" /><span>{formatCoins(cash, true)}</span></div><CloseButton onClick={() => close(false)} /></header>
        <div className="stock-grid">
          {(Object.keys(STOCKS) as StockId[]).map((id) => {
            const stock = STOCKS[id]
            const values = history[id]
            const rising = values.at(-1)! >= values.at(-2)!
            const elapsed = (round - 1) * MATCH_CONFIG.worldCycleSeconds + (MATCH_CONFIG.worldCycleSeconds - roundSeconds)
            const unlocked = true
            return <button key={id} className={`stock-card ${unlocked ? '' : 'locked'}`} onMouseDown={(event) => {
              event.preventDefault()
              if (!unlocked) return
              const amount = event.shiftKey ? 10 : 1
              if (event.button === 0) trade(id, amount)
              if (event.button === 2) trade(id, -amount)
            }} onContextMenu={(event) => event.preventDefault()}>
              <span className="stock-logo"><img src={stock.logo} alt={stock.name} /></span>
              <span className="stock-name">{stock.name}<small>{stock.ticker}</small></span>
              {unlocked ? <>
                <span className={`stock-direction ${rising ? 'up' : 'down'}`}>{rising ? '↑' : '↓'}</span>
                <span className="stock-price" title={formatCoins(prices[id])}><Icon name="coin" />{formatCoins(prices[id], true)}</span>
                <span className="stock-count"><b>{portfolio[id] ?? 0}</b> OWN <i /> <b>{supply[id]}</b> LEFT</span>
                <span className="stock-history">{values.slice(-5).map((value, index, recent) => <small className={index === 0 || value >= recent[index - 1] ? 'up' : 'down'} key={`${value}-${index}`}>{formatCoins(value)}</small>)}</span>
              </> : <span className="stock-lock">{stock.releaseMinute}m</span>}
            </button>
          })}
        </div>
      </section>
    </div>
  )
}

type PlayerTradeOffer = { cash: number; items: Record<string, number> }

function PlayerTradePanel() {
  const open = useGameStore((state) => state.playerPanelOpen)
  const setOpen = useGameStore((state) => state.setPlayerPanelOpen)
  const players = useGameStore((state) => state.onlinePlayers)
  const nickname = useGameStore((state) => state.nickname)
  const setNickname = useGameStore((state) => state.setNickname)
  const inventory = useGameStore((state) => state.inventory)
  const cash = useGameStore((state) => state.cash)
  const applyTrade = useGameStore((state) => state.applyPlayerTrade)
  const setToast = useGameStore((state) => state.setToast)
  const [draftName, setDraftName] = useState(nickname)
  const [incoming, setIncoming] = useState<{ fromId: string; fromNickname: string } | null>(null)
  const [tradeId, setTradeId] = useState<string | null>(null)
  const [partner, setPartner] = useState<{ id: string; nickname: string } | null>(null)
  const [offer, setOffer] = useState<PlayerTradeOffer>({ cash: 0, items: {} })
  const [theirOffer, setTheirOffer] = useState<PlayerTradeOffer>({ cash: 0, items: {} })
  const [ready, setReady] = useState(false)
  const [theirReady, setTheirReady] = useState(false)
  const partnerRef = useRef<string | null>(null)
  const tradeRef = useRef<string | null>(null)

  useEffect(() => {
    const offRequest = onMultiplayer('trade:request', (raw) => {
      const request = raw as { fromId: string; fromNickname: string }
      setIncoming(request); setOpen(true)
    })
    const offOpened = onMultiplayer('trade:opened', (raw) => {
      const data = raw as { tradeId: string; partnerId: string; partnerNickname: string }
      tradeRef.current = data.tradeId; partnerRef.current = data.partnerId
      setTradeId(data.tradeId); setPartner({ id: data.partnerId, nickname: data.partnerNickname || 'Player' })
      setOffer({ cash: 0, items: {} }); setTheirOffer({ cash: 0, items: {} }); setReady(false); setTheirReady(false); setIncoming(null); setOpen(true)
    })
    const offUpdate = onMultiplayer('trade:update', (raw) => {
      const data = raw as { tradeId: string; offers: Record<string, PlayerTradeOffer>; ready: Record<string, boolean> }
      if (data.tradeId !== tradeRef.current || !partnerRef.current) return
      setTheirOffer(data.offers[partnerRef.current] ?? { cash: 0, items: {} })
      setTheirReady(Boolean(data.ready[partnerRef.current]))
      const ownId = Object.keys(data.offers).find((id) => id !== partnerRef.current)
      if (ownId) setReady(Boolean(data.ready[ownId]))
    })
    const closeTrade = () => {
      tradeRef.current = null; partnerRef.current = null; setTradeId(null); setPartner(null); setReady(false); setTheirReady(false)
    }
    const offCancel = onMultiplayer('trade:cancel', () => { closeTrade(); setToast('Trade cancelled') })
    const offCommit = onMultiplayer('trade:commit', (raw) => {
      const data = raw as { tradeId: string; give: PlayerTradeOffer; receive: PlayerTradeOffer }
      if (data.tradeId !== tradeRef.current) return
      if (!applyTrade(data.give, data.receive)) setToast('Trade could not complete')
      closeTrade()
    })
    return () => { offRequest(); offOpened(); offUpdate(); offCancel(); offCommit() }
  }, [applyTrade, setOpen, setToast])

  useEffect(() => {
    const onTab = (event: KeyboardEvent) => {
      if (event.code !== 'Tab' || event.target instanceof HTMLInputElement) return
      event.preventDefault(); setOpen(!useGameStore.getState().playerPanelOpen)
    }
    window.addEventListener('keydown', onTab)
    return () => window.removeEventListener('keydown', onTab)
  }, [setOpen])

  const publishOffer = (next: PlayerTradeOffer, isReady = false) => {
    setOffer(next); setReady(isReady); setTheirReady(false)
    if (tradeId) sendMultiplayer('trade:update', { tradeId, offer: next, ready: isReady })
  }
  const closePanel = () => {
    if (tradeId) sendMultiplayer('trade:cancel', { tradeId })
    tradeRef.current = null; partnerRef.current = null; setTradeId(null); setPartner(null); setOpen(false)
  }
  if (!open) return null
  const tradable = (Object.keys(ITEMS) as ItemId[]).filter((id) => id !== 'gold-coins' && !isEnhanceableItem(id) && (inventory[id] ?? 0) > 0)
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && closePanel()}>
      <section className="panel player-panel">
        <header><div className="panel-title"><Icon name="users" /><span>{tradeId ? `TRADE · ${partner?.nickname ?? ''}` : 'PLAYERS'}</span></div><CloseButton onClick={closePanel} /></header>
        {!tradeId ? <>
          <div className="nickname-row"><input value={draftName} maxLength={18} aria-label="Nickname" onChange={(event) => setDraftName(event.target.value)} onBlur={() => setNickname(draftName)} onKeyDown={(event) => { if (event.key === 'Enter') { setNickname(draftName); event.currentTarget.blur() } }} /><span>{players.length + 1}</span></div>
          {incoming && <div className="trade-request"><span>{incoming.fromNickname}</span><button onClick={() => sendMultiplayer('trade:accept', { fromId: incoming.fromId })}>ACCEPT</button><button className="quiet-button" onClick={() => setIncoming(null)}>NO</button></div>}
          <div className="player-list">{players.length ? players.map((player) => <div className="player-row" key={player.id}><span className="player-avatar">{player.nickname[0]?.toUpperCase()}</span><span>{player.nickname}<small>{player.zone.toUpperCase()}</small></span><button onClick={() => { sendMultiplayer('trade:request', { targetId: player.id }); setToast('Trade request sent') }}>TRADE</button></div>) : <div className="empty-players">NO ONE ELSE ONLINE</div>}</div>
        </> : <>
          <div className="trade-columns">
            <div className={`trade-side ${ready ? 'ready' : ''}`}><h3>YOU <span>{ready ? 'READY' : ''}</span></h3><label className="trade-cash"><Icon name="coin" /><input type="number" min="0" max={cash} value={offer.cash} onChange={(event) => publishOffer({ ...offer, cash: Math.min(cash, Math.max(0, Number(event.target.value) || 0)) })} /></label><div className="trade-items">{tradable.map((id) => <button key={id} onContextMenu={(event) => event.preventDefault()} onMouseDown={(event) => { event.preventDefault(); const delta = event.button === 2 ? -1 : 1; const quantity = Math.max(0, Math.min(inventory[id] ?? 0, (offer.items[id] ?? 0) + delta)); publishOffer({ ...offer, items: { ...offer.items, [id]: quantity } }) }}><img src={ITEMS[id].icon} alt={ITEMS[id].name} /><span>{offer.items[id] ?? 0}</span></button>)}</div></div>
            <div className={`trade-side ${theirReady ? 'ready' : ''}`}><h3>{partner?.nickname ?? 'PLAYER'} <span>{theirReady ? 'READY' : ''}</span></h3><div className="trade-cash"><Icon name="coin" /><strong>{formatCoins(theirOffer.cash, true)}</strong></div><div className="trade-items receive">{Object.entries(theirOffer.items).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ITEMS[id as ItemId] && <div key={id}><img src={ITEMS[id as ItemId].icon} alt={ITEMS[id as ItemId].name} /><span>{quantity}</span></div>)}</div></div>
          </div>
          <footer className="trade-actions"><button className="quiet-button" onClick={closePanel}>CANCEL</button><button className={ready ? 'ready-button active' : 'ready-button'} onClick={() => publishOffer(offer, !ready)}>{ready ? 'UNREADY' : 'READY'}</button></footer>
        </>}
      </section>
    </div>
  )
}

function Crosshair() {
  const locked = useGameStore((state) => state.shiftLocked)
  return locked ? <div className="crosshair" aria-hidden="true"><i /><i /></div> : null
}

function MenuPanel() {
  const open = useGameStore((state) => state.menuOpen)
  const close = useGameStore((state) => state.setMenuOpen)
  const volumes = useGameStore((state) => state.audioVolumes)
  const setVolume = useGameStore((state) => state.setVolume)
  const sensitivity = useGameStore((state) => state.cameraSensitivity)
  const setSensitivity = useGameStore((state) => state.setCameraSensitivity)
  const invertY = useGameStore((state) => state.cameraInvertY)
  const setInvertY = useGameStore((state) => state.setCameraInvertY)
  const shiftLocked = useGameStore((state) => state.shiftLocked)
  const setShiftLocked = useGameStore((state) => state.setShiftLocked)
  const openCookbook = useGameStore((state) => state.setCookbookOpen)
  if (!open) return null
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
      <section className="panel settings-panel">
        <header><div className="panel-title"><Icon name="menu" /><span>SETTINGS</span></div><CloseButton onClick={() => close(false)} /></header>
        {(['master', 'music', 'ambience', 'effects'] as const).map((channel) => (
          <label className="volume-row" key={channel}><span>{channel.toUpperCase()}</span><input type="range" min="0" max="1" step="0.01" value={volumes[channel]} onChange={(event) => setVolume(channel, Number(event.target.value))} /><output>{Math.round(volumes[channel] * 100)}%</output></label>
        ))}
        <label className="volume-row"><span>SENSITIVITY</span><input aria-label="Camera sensitivity" type="range" min="0.35" max="1.8" step="0.05" value={sensitivity} onChange={(event) => setSensitivity(Number(event.target.value))} /></label>
        <div className="camera-options"><button className={shiftLocked ? 'active' : ''} onClick={() => setShiftLocked(!shiftLocked)}>SHIFT LOCK</button><button className={invertY ? 'active' : ''} onClick={() => setInvertY(!invertY)}>INVERT Y</button></div>
        <button className="cookbook-open" onClick={() => openCookbook(true)}>COOKBOOK</button>
        <div className="control-strip"><kbd>Q</kbd><span>LOCK</span><kbd>E</kbd><span>PACK</span><kbd>TAB</kbd><span>PLAYERS</span></div>
      </section>
    </div>
  )
}

function NormalCookbookPanel() {
  const open = useGameStore((state) => state.cookbookOpen)
  const close = useGameStore((state) => state.setCookbookOpen)
  const known = useGameStore((state) => state.knownRecipes)
  const cards = useGameStore((state) => state.recipeCards)
  const inventory = useGameStore((state) => state.inventory)
  const furnaceCount = inventory.furnace ?? 0
  const queue = useGameStore((state) => state.cookQueue)
  const activeFurnace = useGameStore((state) => state.activeFurnaceIndex)
  const market = useGameStore((state) => state.commodityMarket)
  const foodMarket = useGameStore((state) => state.foodMarket)
  const cook = useGameStore((state) => state.cookRecipe)
  const sell = useGameStore((state) => state.sellFood)
  const [now, setNow] = useState(Date.now())
  const [batches, setBatches] = useState<Partial<Record<RecipeId, number>>>({})
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [open])
  if (!open) return null
  const activeQueue = activeFurnace === null ? [] : queue.filter((job) => job.furnaceIndex === activeFurnace)
  return <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}><section className="panel cookbook-panel">
    <header><div className="panel-title"><img className="cookbook-mark" src="/assets/ui/cooking/cookbook.png" alt="" /><span>COOKBOOK</span></div><span className="cook-queue">{activeFurnace === null ? '—' : `${activeQueue.length}/3`}</span><CloseButton onClick={() => close(false)} /></header>
    {activeQueue.length > 0 && <div className="furnace-queue">{activeQueue.map((job) => <span key={job.id}><img src="/assets/ui/cooking/furnace-cooking.png" alt="" />{RECIPES[job.recipe].name} ×{job.quantity ?? 1}<b>{Math.max(0, Math.ceil((job.readyAt - now) / 1000))}s</b></span>)}</div>}
    {known.length === 0 && <div className="empty-ticket">NO RECIPES YET</div>}
    <div className="recipe-grid">{known.map((id) => {
      const recipe = RECIPES[id]
      const learned = true
      const owned = inventory[recipe.food] ?? 0
      const value = preparedFoodValue(id, market, foodMarket[id])
      const ingredients = Object.entries(recipe.ingredients) as Array<[ItemId, number]>
      const batchCapacity = Math.max(10, furnaceCount * 10)
      const maxBatch = learned ? Math.max(0, Math.min(batchCapacity, ...ingredients.map(([item, quantity]) => Math.floor((inventory[item] ?? 0) / quantity)))) : 0
      const batch = Math.max(1, Math.min(maxBatch || 1, batches[id] ?? 1))
      const canCook = learned && activeFurnace !== null && maxBatch >= batch && activeQueue.length < 3
      return <article className={`recipe-card ${learned ? '' : 'unknown'}`} key={id}>
        <div><img src={ITEMS[recipe.food].icon} alt="" /><strong>{learned ? recipe.name : '???'}</strong><small>{learned ? recipe.group.toUpperCase() : `${recipe.group.toUpperCase()} CARD`}</small></div>
        {learned && <><div className="recipe-ingredients">{ingredients.map(([item, quantity]) => <span key={item} className={(inventory[item] ?? 0) >= quantity * batch ? '' : 'missing'}><img src={ITEMS[item].icon} alt={ITEMS[item].name} />{quantity * batch}</span>)}</div><div className="cook-actions"><button aria-label={`Decrease ${recipe.name} batch`} onClick={() => setBatches((current) => ({ ...current, [id]: Math.max(1, batch - 1) }))}>−</button><b>×{batch}</b><button aria-label={`Increase ${recipe.name} batch`} onClick={() => setBatches((current) => ({ ...current, [id]: Math.min(batchCapacity, Math.max(1, maxBatch), batch + 1) }))}>+</button><button disabled={!canCook} onClick={() => cook(id as RecipeId, batch)}>COOK</button></div><footer><span>{recipe.cookSeconds}s</span><button disabled={!owned} onClick={() => sell(id as RecipeId, 1)}>{formatCoins(value, true)}{owned ? ` ×${owned}` : ''}</button></footer></>}
        {learned && (cards[id] ?? 0) > 1 && <em>{cards[id]} CARDS</em>}
      </article>
    })}</div>
  </section></div>
}

function EventCookbookPanel() {
  const open = useGameStore((state) => state.cookbookOpen)
  const close = useGameStore((state) => state.setCookbookOpen)
  const milestone = useGameStore((state) => state.minigameMilestone)
  const inventory = useGameStore((state) => state.farmRushInventory)
  const tickets = useGameStore((state) => state.farmRushOrders)
  const queue = useGameStore((state) => state.farmRushCooking)
  const cook = useGameStore((state) => state.farmRushCook)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [open])
  if (!open) return null
  const orders = farmRushOrders(milestone, 100)
  return <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}><section className="panel cookbook-panel event-cookbook-panel">
    <header><div className="panel-title"><img className="cookbook-mark" src="/assets/ui/cooking/cookbook.png" alt="" /><span>COOKBOOK</span></div><span className="cook-queue">{queue.length}/3</span><CloseButton onClick={() => close(false)} /></header>
    {queue.length > 0 && <div className="furnace-queue">{queue.map((job) => {
      const order = orders[job.orderIndex % orders.length]
      return <span key={job.orderIndex}><img src="/assets/ui/cooking/furnace-cooking.png" alt="" />{order.name}<b>{Math.max(0, Math.ceil((job.readyAt - now) / 1000))}s</b></span>
    })}</div>}
    <div className="recipe-grid">{FARM_RUSH_RECIPE_IDS.map((id) => {
      const order = orders.find((candidate) => candidate.recipe === id)!
      const ingredients = Object.entries(order.ingredients) as Array<[FarmRushCrop, number]>
      const matchingTicket = tickets.find((ticket) => ticket.expiresAt > now && orders[ticket.orderIndex % orders.length].recipe === id && !queue.some((job) => job.orderIndex === ticket.orderIndex))
      const hasIngredients = ingredients.every(([item, quantity]) => inventory[item] >= quantity)
      return <article className="recipe-card" key={id}>
        <div><img src={ITEMS[order.food].icon} alt="" /><strong>{order.name}</strong><small>{order.points} PTS</small></div>
        <div className="recipe-ingredients">{ingredients.map(([item, quantity]) => <span key={item} className={inventory[item] >= quantity ? '' : 'missing'}><img src={ITEMS[item].icon} alt={ITEMS[item].name} />{quantity}</span>)}</div>
        <div className="cook-actions"><button disabled={!matchingTicket || !hasIngredients || queue.length >= 3} onClick={() => cook(id)}>COOK</button></div>
        <footer><span>{order.cookSeconds}s</span></footer>
      </article>
    })}</div>
  </section></div>
}

function CookbookPanel() {
  const eventMode = useGameStore((state) => state.minigameOpen && state.minigameKind === 'farm')
  return eventMode ? <EventCookbookPanel /> : <NormalCookbookPanel />
}

function Toast() {
  const toast = useGameStore((state) => state.toast)
  const setToast = useGameStore((state) => state.setToast)
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 1400)
    return () => window.clearTimeout(timer)
  }, [setToast, toast])
  return toast ? <div className="toast">{toast}</div> : null
}

function MinigameResultCard() {
  const result = useGameStore((state) => state.lastMinigameResult)
  const clear = useGameStore((state) => state.clearMinigameResult)
  if (!result) return null
  const placement = result.placement === 1 ? '1ST' : result.placement === 2 ? '2ND' : result.placement === 3 ? '3RD' : `${result.placement}TH`
  return <button className="minigame-result-card" onClick={clear} aria-label="Dismiss minigame reward">
    <span>{placement}</span><strong>{result.score} PTS</strong>
    <div>{result.cash > 0 && <b><Icon name="coin" />{formatCoins(result.cash, true)}</b>}{result.boxes > 0 && <b><img src={ITEMS['cookbook-box'].icon} alt="" />×{result.boxes}</b>}</div>
  </button>
}

function ResultsPanel() {
  const complete = useGameStore((state) => state.sessionComplete)
  const cash = useGameStore((state) => state.cash)
  const stats = useGameStore((state) => state.stats)
  const nickname = useGameStore((state) => state.nickname)
  const players = useGameStore((state) => state.onlinePlayers)
  const duration = useGameStore((state) => state.sessionDurationSeconds)
  const [selected, setSelected] = useState(0)
  if (!complete) return null
  const leaderboard = [{ id: 'self', nickname, cash, stats }, ...players].sort((a, b) => b.cash - a.cash)
  const focused = leaderboard[Math.min(selected, leaderboard.length - 1)]
  const restart = () => {
    localStorage.removeItem('project01-save-v12')
    localStorage.removeItem('project01-save-v11')
    window.location.assign('/?gate=final')
  }
  return <div className="modal-scrim results-scrim"><section className="panel results-panel"><header><div className="panel-title"><span className="results-mark">{duration / 60}</span><span>FINAL LEDGER</span></div></header><div className="leaderboard-list">{leaderboard.map((player, index) => <button className={selected === index ? 'active' : ''} key={player.id} onClick={() => setSelected(index)}><b>{index + 1}</b><span>{player.nickname}</span><strong>{formatCoins(player.cash, true)}</strong></button>)}</div><strong className="final-cash"><Icon name="coin" />{formatCoins(focused.cash)}</strong><div className="result-stats"><span>FORAGED<strong>{focused.stats.foraged}</strong></span><span>MINED<strong>{focused.stats.mined}</strong></span><span>HARVESTED<strong>{focused.stats.harvested}</strong></span><span>SOLD<strong>{focused.stats.sold}</strong></span></div><button onClick={restart}>NEW RUN</button></section></div>
}

function EnhancementPanel() {
  const open = useGameStore((state) => state.enhancementOpen)
  const close = useGameStore((state) => state.setEnhancementOpen)
  const inventory = useGameStore((state) => state.inventory)
  const enhancements = useGameStore((state) => state.enhancements)
  const cash = useGameStore((state) => state.cash)
  const enhance = useGameStore((state) => state.enhanceEquipment)
  const volumes = useGameStore((state) => state.audioVolumes)
  const owned = ENHANCEABLE_ITEMS.filter((item) => (inventory[item] ?? 0) > 0)
  const [selected, setSelected] = useState<EnhanceableItem>('worn-pickaxe')
  const [stabilized, setStabilized] = useState(false)
  const [resultFx, setResultFx] = useState<{ id: number; success: boolean } | null>(null)
  useEffect(() => {
    if (open && !owned.includes(selected) && owned[0]) setSelected(owned[0])
  }, [open, owned, selected])
  if (!open || !owned.length) return null
  const current = enhancementLevel(enhancements, selected)
  const atMax = current >= 10
  const target = Math.min(10, current + 1)
  const stabilizationAvailable = !atMax && canStabilize(target)
  const useStabilization = stabilizationAvailable && stabilized
  const requirements = enhancementRequirements(selected, target, useStabilization)
  const materialRows = (atMax ? [] : Object.entries(requirements.materials)) as Array<[ItemId, number]>
  const missingMaterials = materialRows.some(([id, quantity]) => (inventory[id] ?? 0) < quantity)
  const affordable = cash >= requirements.coins && !missingMaterials && current < 10
  const downgradeRisk = target >= 4 && !useStabilization
  const isPickaxeItem = selected.endsWith('pickaxe')
  const isBasketItem = selected === 'basket' || selected === 'reinforced-basket' || selected === 'master-basket'
  const attempt = () => {
    if (!affordable) return
    const before = enhancementLevel(useGameStore.getState().enhancements, selected)
    enhance(selected, useStabilization)
    const after = enhancementLevel(useGameStore.getState().enhancements, selected)
    const success = after > before
    playGameSfx(success ? 'upgrade-success' : 'upgrade-fail', volumes.master * volumes.effects)
    const effect = { id: Date.now(), success }
    setResultFx(effect)
    window.setTimeout(() => setResultFx((active) => active?.id === effect.id ? null : active), 900)
  }
  const secondaryCurrent = isPickaxeItem
    ? `+${Math.round(miningSpeedBonus(current) * 1000) / 10}%`
    : isBasketItem
      ? String(enhancedBasketCapacity(selected, current))
      : null
  const secondaryTarget = isPickaxeItem
    ? `+${Math.round(miningSpeedBonus(target) * 1000) / 10}%`
    : isBasketItem
      ? String(enhancedBasketCapacity(selected, target))
      : null
  const chanceLabel = isPickaxeItem ? 'ORE CHANCES' : 'HARVEST CHANCES'
  const currentOutcomes = fortuneFor(selected, current)
  const targetOutcomes = fortuneFor(selected, target)
  const actionLabel = atMax
    ? 'MAX LEVEL'
    : missingMaterials
      ? 'NEED MATERIALS'
      : cash < requirements.coins
      ? 'NEED COINS'
        : 'UPGRADE'
  const failureLabel = atMax || enhancementChance(target) >= 1
    ? null
    : useStabilization || target <= 3
      ? `Failure keeps +${current}`
      : `Failure drops to +${Math.max(0, current - 1)}`
  return <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
    <section className="panel enhancement-panel">
      <header><div className="panel-title"><span className="enhancement-mark">+</span><span>UPGRADE</span></div><div className="shop-balance"><Icon name="coin" /><span>{formatCoins(cash, true)}</span></div><CloseButton onClick={() => close(false)} /></header>
      <div className="enhancement-layout">
        <aside className="enhancement-items" aria-label="Gear">
          {owned.map((item) => {
            const itemLevel = enhancementLevel(enhancements, item)
            return <button className={item === selected ? 'active' : ''} key={item} onClick={() => { setSelected(item); setStabilized(false) }}>
              <img src={ITEMS[item].icon} alt="" />
              <span><strong>{ITEMS[item].name}</strong><small>+{itemLevel}</small></span>
            </button>
          })}
        </aside>
        <section className={`enhancement-attempt ${resultFx ? resultFx.success ? 'upgrade-success' : 'upgrade-fail' : ''}`}>
          {resultFx && <span className={`enhancement-result-fx ${resultFx.success ? 'success' : 'fail'}`} aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</span>}
          <div className="enhancement-current">
            <span className="enhancement-current-icon"><img src={ITEMS[selected].icon} alt="" /></span>
            <span className="enhancement-current-name">{atMax && <small>MAX LEVEL</small>}<strong>{ITEMS[selected].name}</strong></span>
            {!atMax && <span className={`enhancement-chance ${resultFx ? `result ${resultFx.success ? 'success' : 'fail'}` : ''}`}><small>{resultFx ? 'RESULT' : 'SUCCESS'}</small><b>{resultFx ? resultFx.success ? 'UPGRADED' : 'FAILED' : `${Math.round(enhancementChance(target) * 100)}%`}</b></span>}
          </div>
          <small className="enhancement-compare-title">{chanceLabel}</small>
          <div className={`enhancement-comparison ${atMax ? 'maxed' : ''}`}>
            <div className="enhancement-column current">
              <header><span>CURRENT</span><b>+{current}</b></header>
              <div className="enhancement-chances">{currentOutcomes.map((outcome, index) => <div key={index}><span>{index + 1}×</span><i style={{ '--chance': `${outcome.chance * 100}%` } as CSSProperties} /><b>{Math.round(outcome.chance * 100)}%</b></div>)}</div>
              {secondaryCurrent && <footer><span>{isPickaxeItem ? 'MINING SPEED' : 'STORAGE'}</span><b>{secondaryCurrent}</b></footer>}
            </div>
            {!atMax && <><span className="enhancement-compare-arrow">→</span><div className="enhancement-column target">
              <header><span>UPGRADED</span><b>+{target}</b></header>
              <div className="enhancement-chances">{targetOutcomes.map((outcome, index) => <div key={index}><span>{index + 1}×</span><i style={{ '--chance': `${outcome.chance * 100}%` } as CSSProperties} /><b>{Math.round(outcome.chance * 100)}%</b></div>)}</div>
              {secondaryTarget && <footer><span>{isPickaxeItem ? 'MINING SPEED' : 'STORAGE'}</span><b>{secondaryTarget}</b></footer>}
            </div></>}
          </div>
          {!atMax && <div className="enhancement-payment">
            <div className="enhancement-materials">{materialRows.map(([id, quantity]) => {
              const held = inventory[id] ?? 0
              return <span className={held < quantity ? 'missing' : ''} key={id}><img src={ITEMS[id].icon} alt="" /><span><strong>{ITEMS[id].name}</strong><small>{held} OF {quantity}</small></span></span>
            })}</div>
            <div className={`enhancement-cost ${cash < requirements.coins ? 'missing' : ''}`}><Icon name="coin" /><span><small>COST</small><strong>{formatCoins(requirements.coins, true)}</strong></span></div>
          </div>}
          {stabilizationAvailable && <button className={`stabilize-toggle ${useStabilization ? 'active' : ''}`} onClick={() => setStabilized((value) => !value)}>{useStabilization ? `PROTECTED +${current}` : `PROTECT +${current}`}</button>}
          {failureLabel && <small className={`enhancement-fail ${downgradeRisk && !useStabilization ? 'danger' : ''}`}>{failureLabel}</small>}
          <button className="enhance-button" disabled={!affordable} onClick={attempt}>{actionLabel}</button>
        </section>
      </div>
    </section>
  </div>
}

function TravelPanel() {
  const open = useGameStore((state) => state.travelOpen)
  const close = useGameStore((state) => state.setTravelOpen)
  const setZone = useGameStore((state) => state.setZone)
  if (!open) return null
  const destinations = [
    ['hub', 'COMMON'],
    ['forage', 'FORAGE'],
    ['farm', 'FARM'],
    ['mine', 'MINE'],
  ] as const
  return <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}><section className="panel travel-panel"><header><div className="panel-title"><span className="travel-mark">↟</span><span>TRAVEL</span></div><CloseButton onClick={() => close(false)} /></header><div className="travel-grid">{destinations.map(([id, label]) => <button key={id} onClick={() => setZone(id)}>{label}</button>)}</div></section></div>
}

function ForageCapacity() {
  const zone = useGameStore((state) => state.zone)
  const inventory = useGameStore((state) => state.inventory)
  const enhancements = useGameStore((state) => state.enhancements)
  if (zone !== 'forage') return null
  const carrier = (inventory['master-basket'] ?? 0) > 0 ? 'master-basket' : (inventory['reinforced-basket'] ?? 0) > 0 ? 'reinforced-basket' : (inventory.basket ?? 0) > 0 ? 'basket' : 'hand'
  const capacity = carrier === 'hand' ? BASKET_CONFIG.hand.capacity : enhancedBasketCapacity(carrier, enhancementLevel(enhancements, carrier))
  const stored = (inventory.apple ?? 0) + (inventory.orange ?? 0)
  return <div className="forage-capacity" title={BASKET_CONFIG[carrier].name}><span>FRUIT</span><i><b style={{ width: `${Math.min(100, stored / capacity * 100)}%` }} /></i><strong>{stored}/{capacity}</strong></div>
}

function MinigameWorldHud() {
  const open = useGameStore((state) => state.minigameOpen)
  const milestone = useGameStore((state) => state.minigameMilestone)
  const kind = useGameStore((state) => state.minigameKind)
  const miningScore = useGameStore((state) => state.rushScore)
  const farmScore = useGameStore((state) => state.farmRushScore)
  const forageScore = useGameStore((state) => state.forageRushScore)
  const combo = useGameStore((state) => state.rushCombo)
  const activeOrders = useGameStore((state) => state.farmRushOrders)
  const cooking = useGameStore((state) => state.farmRushCooking)
  const farmInventory = useGameStore((state) => state.farmRushInventory)
  const eventBay = useGameStore((state) => state.eventBay)
  const submitOrder = useGameStore((state) => state.farmRushSubmit)
  const forageInventory = useGameStore((state) => state.forageRushInventory)
  const forageDelivered = useGameStore((state) => state.forageRushDelivered)
  const tickFarmRush = useGameStore((state) => state.tickFarmRush)
  const syncForageRush = useGameStore((state) => state.syncForageRush)
  const finish = useGameStore((state) => state.finishMinigame)
  const nickname = useGameStore((state) => state.nickname)
  const players = useGameStore((state) => state.onlinePlayers)
  const [warning, setWarning] = useState(9)
  const [seconds, setSeconds] = useState(MINIGAME_DURATION.mining)
  const [, refresh] = useState(0)
  const [waiting, setWaiting] = useState(false)
  const submitted = useRef(false)
  const score = kind === 'mining' ? miningScore : kind === 'farm' ? farmScore : forageScore
  const title = kind === 'mining' ? 'MINING RUSH' : kind === 'farm' ? 'KITCHEN RUSH' : 'FORAGE RACE'
  const forageComplete = Object.values(forageDelivered).every(Boolean)
  const standings = [
    { id: 'self', nickname, score },
    ...players.filter((player) => player.minigameOpen && player.minigameKind === kind && player.minigameMilestone === milestone).map((player) => ({ id: player.id, nickname: player.nickname, score: player.minigameScore ?? 0 })),
  ].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname)).slice(0, 5)
  useEffect(() => {
    if (!open) return
    setWarning(9); setSeconds(MINIGAME_DURATION[kind]); setWaiting(false); submitted.current = false
    const warningTimer = window.setInterval(() => setWarning((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(warningTimer)
  }, [kind, open, milestone])
  useEffect(() => {
    if (!open || warning > 0 || waiting) return
    const timer = window.setInterval(() => { setSeconds((value) => Math.max(0, value - 1)); refresh((value) => value + 1); if (kind === 'farm') tickFarmRush() }, 1000)
    return () => window.clearInterval(timer)
  }, [kind, open, tickFarmRush, waiting, warning])
  useEffect(() => {
    if (!open) return
    return onMultiplayer('minigame:result', (raw) => {
      const result = raw as { milestone: number; score: number; placement: number; economyReference: number; cashReward: number; cookbookBoxes: number }
      if (result.milestone === milestone) finish(result.score, result.placement, result.economyReference, { cash: result.cashReward, boxes: result.cookbookBoxes })
    })
  }, [finish, milestone, open])
  useEffect(() => {
    if (!open || kind !== 'forage') return
    return onMultiplayer('minigame:forage', (raw) => {
      const message = raw as { id?: string; readyAt?: number }
      if (message.id?.startsWith('ForageRush') && Number.isFinite(message.readyAt)) syncForageRush(message.id, Number(message.readyAt))
    })
  }, [kind, open, syncForageRush])
  useEffect(() => {
    if (!open || (seconds > 0 && !(kind === 'forage' && forageComplete)) || submitted.current) return
    submitted.current = true; setWaiting(true)
    const state = useGameStore.getState()
    const progressValue = economyProgressValue(state)
    const eventScore = kind === 'mining' ? state.rushScore : kind === 'farm' ? state.farmRushScore : state.forageRushScore + (forageComplete ? 10_000 + seconds * 10 : Object.values(state.forageRushInventory).reduce((sum, value) => sum + value, 0))
    const submittedOnline = sendMultiplayer('minigame:finish', { milestone, score: eventScore, progressValue })
    if (!submittedOnline) { finish(eventScore, 1, progressValue); return }
    const fallback = window.setTimeout(() => { if (useGameStore.getState().minigameOpen) finish(eventScore, 1, progressValue) }, (seconds + 15) * 1000)
    return () => window.clearTimeout(fallback)
  }, [finish, forageComplete, kind, milestone, open, seconds])
  if (!open) return null
  const orderDefinitions = farmRushOrders(milestone)
  const currentState = useGameStore.getState()
  const selfProgress = economyProgressValue(currentState)
  const lobbyProgress = [selfProgress, ...players.filter((player) => player.minigameOpen && player.minigameMilestone === milestone).map((player) => player.progressValue ?? player.cash)].sort((a, b) => a - b)
  const progressMiddle = Math.floor(lobbyProgress.length / 2)
  const estimatedReference = lobbyProgress.length % 2 ? lobbyProgress[progressMiddle] : Math.round((lobbyProgress[progressMiddle - 1] + lobbyProgress[progressMiddle]) / 2)
  const leaderCash = Math.max(currentState.cash, ...players.map((player) => player.cash))
  const prizeRows = ['1ST', '2ND', '3RD', 'FINISH'].map((place, index) => ({ place, ...minigameRewardPackage(estimatedReference, index + 1, currentState.cash, leaderCash) }))
  return <>
    {warning > 5 && <div className="rush-prize-reveal"><strong>PRIZES</strong><div>{prizeRows.map((prize) => <article key={prize.place}><b>{prize.place}</b>{prize.cash > 0 && <span><Icon name="coin" />{formatCoins(prize.cash, true)}</span>}{prize.boxes > 0 && <span><img src={ITEMS['cookbook-box'].icon} alt="Cookbook Box" />COOKBOOK ×{prize.boxes}</span>}</article>)}</div></div>}
    {warning > 0 && warning <= 5 && <div className="rush-countdown"><strong>{warning}</strong><span>{title}</span></div>}
    {warning === 0 && <div className="event-standings"><span>LEADERBOARD</span>{standings.map((player, index) => <div className={player.id === 'self' ? 'self' : ''} key={player.id}><b>{index + 1}</b><span>{player.nickname}</span><strong>{player.score}</strong></div>)}</div>}
    {kind === 'mining' && warning === 0 && <div className="mining-points">{(Object.keys(MINING_RUSH_POINTS) as MiningRushOre[]).map((ore) => <span key={ore}><img src={ITEMS[ore].icon} alt="" /><b>{MINING_RUSH_POINTS[ore]}</b></span>)}</div>}
    {kind === 'farm' && <div className="event-orders">{activeOrders.map((ticket) => {
      const order = orderDefinitions[ticket.orderIndex % orderDefinitions.length]
      const remaining = Math.max(0, ticket.expiresAt - Date.now())
      const ingredients = Object.entries(order.ingredients) as Array<[FarmRushCrop, number]>
      const cookingJob = cooking.find((job) => job.orderIndex === ticket.orderIndex)
      const ready = Boolean(cookingJob && cookingJob.readyAt <= Date.now())
      const state = ready ? 'ready' : cookingJob ? 'cooking' : ''
      return <div className={state} key={ticket.orderIndex}><header><div className="event-order-food"><img src={ITEMS[order.food].icon} alt={order.name} /><strong>{order.name}</strong></div><b>{Math.ceil(remaining / 1000)}</b></header><div className="event-order-ingredients">{ingredients.map(([crop, quantity]) => <span className={farmInventory[crop] >= quantity ? 'owned' : ''} key={crop}><img src={ITEMS[crop as ItemId].icon} alt={ITEMS[crop as ItemId].name} /><b>{quantity}</b></span>)}</div><i><b style={{ width: `${remaining / FARM_RUSH_ORDER_LIFETIME_MS * 100}%` }} /></i><footer><small>{order.points} PTS</small>{ready && <button onClick={() => submitOrder(ticket.orderIndex)}>SUBMIT</button>}{cookingJob && !ready && <small>{Math.max(1, Math.ceil((cookingJob.readyAt - Date.now()) / 1000))}s</small>}</footer></div>
    })}</div>}
    {kind === 'forage' && <div className="event-deliveries">{(['apple', 'orange', 'truffle', 'discovery'] as ForageRushKind[]).map((id) => <div className={forageDelivered[id] ? 'complete' : ''} key={id}><img src={id === 'discovery' ? ITEMS['natural-discovery'].icon : ITEMS[id].icon} alt="" /><strong>{forageDelivered[id] ? '✓' : `${forageInventory[id]}/${FORAGE_RUSH_REQUIREMENTS[id]}`}</strong></div>)}</div>}
    <div className="rush-world-hud"><span>{title}{kind === 'farm' ? ` · PLOT ${eventBay + 1}` : ''}</span><strong>{score}</strong><small>SCORE</small><b>{waiting ? 'RESULTS' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</b>{kind === 'mining' && <img src={ITEMS['crystal-pickaxe'].icon} alt="Crystal Pickaxe" />}{kind === 'mining' && combo > 1 && <em>×{combo}</em>}</div>
  </>
}

function Interface() {
  const sessionStarted = useGameStore((state) => state.sessionStarted)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const toggleInventory = useGameStore((state) => state.toggleInventory)
  const setShopOpen = useGameStore((state) => state.setShopOpen)
  const setStockOpen = useGameStore((state) => state.setStockOpen)
  const setMenuOpen = useGameStore((state) => state.setMenuOpen)
  const setPlayerPanelOpen = useGameStore((state) => state.setPlayerPanelOpen)
  const setLotteryOpen = useGameStore((state) => state.setLotteryOpen)
  const setTicketInspectOpen = useGameStore((state) => state.setTicketInspectOpen)
  const setTravelOpen = useGameStore((state) => state.setTravelOpen)
  const setSecretOpen = useGameStore((state) => state.setSecretOpen)
  const setCookbookOpen = useGameStore((state) => state.setCookbookOpen)
  const setEnhancementOpen = useGameStore((state) => state.setEnhancementOpen)
  const setSelected = useGameStore((state) => state.setSelectedHotbar)
  const setZone = useGameStore((state) => state.setZone)
  const setToast = useGameStore((state) => state.setToast)
  const setProgress = useGameStore((state) => state.setInteractionProgress)
  const miningTarget = useRef<string | null>(null)
  const miningStartedAt = useRef(0)
  const miningFrame = useRef<number | null>(null)
  useEffect(() => {
    const resetMining = () => {
      if (miningFrame.current !== null) cancelAnimationFrame(miningFrame.current)
      miningFrame.current = null
      miningTarget.current = null
      setProgress(0)
    }
    const startMining = (id: string) => {
      const state = useGameStore.getState()
      const held = state.hotbar[state.selectedHotbar]
      const point = state.anchors[id]
      if (!point) return
      const rush = id.startsWith('RushOre')
      const ore = rush ? miningRushOre(state.minigameMilestone, id, state.rushNodes[id]?.generation ?? 0) : oreKindAtDepth(id, point[2], state.mineGenerations[id] ?? 0, state.sessionSeed)
      if (!rush && !canMineOre(held, ore)) {
        const required = requiredPickaxe(ore)
        setToast(`Need ${PICKAXE_CONFIG[required].name}`)
        resetMining()
        return
      }
      if (miningFrame.current !== null) return
      playGameSfx('mine-start', state.audioVolumes.master * state.audioVolumes.effects)
      const heldEnhancement = !rush && isEnhanceableItem(held) ? enhancementLevel(state.enhancements, held) : 0
      const duration = rush ? 760 : miningDuration(held, ore, heldEnhancement)
      miningTarget.current = id
      miningStartedAt.current = performance.now()
      const tick = (now: number) => {
        const live = useGameStore.getState()
        if (live.prompt?.id !== id || (!rush && live.hotbar[live.selectedHotbar] !== held)) return resetMining()
        const nextProgress = Math.min(1, (now - miningStartedAt.current) / duration)
        setProgress(nextProgress)
        if (nextProgress >= 1) {
          miningFrame.current = null
          if (rush) live.mineRushNode(id)
          else activatePrompt(id)
          resetMining()
          return
        }
        miningFrame.current = requestAnimationFrame(tick)
      }
      miningFrame.current = requestAnimationFrame(tick)
    }
    const keys = (event: KeyboardEvent) => {
      if (event.code === 'KeyE' && !event.repeat) toggleInventory()
      if (/^Digit[1-9]$/.test(event.code) && !event.repeat) {
        const index = Number(event.code.slice(-1)) - 1
        const live = useGameStore.getState()
        if (live.minigameOpen) {
          if (live.minigameKind === 'farm' && FARM_RUSH_TOOLS[index]) live.setFarmRushTool(FARM_RUSH_TOOLS[index])
        } else setSelected(index)
      }
      if (event.code === 'KeyF' && !event.repeat) {
        const prompt = useGameStore.getState().prompt
        if (prompt && !prompt.id.startsWith('Mine') && !prompt.id.startsWith('RushOre')) activatePrompt(prompt.id)
      }
      if (event.code === 'Escape') {
        resetMining()
        setShopOpen(false)
        setStockOpen(false)
        setMenuOpen(false)
        setPlayerPanelOpen(false)
        setLotteryOpen(false)
        setTicketInspectOpen(false)
        setTravelOpen(false)
        setSecretOpen(false)
        setCookbookOpen(false)
        setEnhancementOpen(false)
        if (useGameStore.getState().inventoryOpen) toggleInventory()
      }
    }
    const useItem = (event: PointerEvent) => {
      const canvasFocused = event.target instanceof HTMLCanvasElement || document.pointerLockElement instanceof HTMLCanvasElement
      if (!canvasFocused) return
      const state = useGameStore.getState()
      if (state.minigameOpen) {
        if (event.button !== 0 || !state.prompt) return
        if (state.prompt.id.startsWith('Mine') || state.prompt.id.startsWith('RushOre')) startMining(state.prompt.id)
        else activatePrompt(state.prompt.id)
        return
      }
      const held = state.hotbar[state.selectedHotbar]
      if (event.button === 2 && held === 'home-charm') {
        event.preventDefault()
        setTravelOpen(true)
        return
      }
      if (event.button === 2 && held === 'lottery-ticket') {
        event.preventDefault()
        setTicketInspectOpen(true)
        return
      }
      if (event.button !== 0) return
      if (held === 'cookbook-box') {
        state.useCookbookBox()
        return
      }
      if (held === 'home-charm' && state.zone !== 'hub') {
        setToast('Returned home')
        setZone('hub')
        return
      }
      if (!state.prompt) return
      if (state.prompt.id.startsWith('Mine') || state.prompt.id.startsWith('RushOre')) startMining(state.prompt.id)
      else activatePrompt(state.prompt.id)
    }
    const releaseItem = (event: PointerEvent) => { if (event.button === 0) resetMining() }
    window.addEventListener('keydown', keys)
    window.addEventListener('pointerdown', useItem, true)
    window.addEventListener('pointerup', releaseItem, true)
    window.addEventListener('pointercancel', resetMining)
    window.addEventListener('blur', resetMining)
    return () => {
      resetMining()
      window.removeEventListener('keydown', keys)
      window.removeEventListener('pointerdown', useItem, true)
      window.removeEventListener('pointerup', releaseItem, true)
      window.removeEventListener('pointercancel', resetMining)
      window.removeEventListener('blur', resetMining)
    }
  }, [setCookbookOpen, setEnhancementOpen, setLotteryOpen, setMenuOpen, setPlayerPanelOpen, setProgress, setSecretOpen, setSelected, setShopOpen, setStockOpen, setTicketInspectOpen, setToast, setTravelOpen, setZone, toggleInventory])
  if (!sessionStarted) return <div className="interface"><LobbyPanel /><Toast /></div>
  if (minigameOpen) return <div className="interface"><Crosshair /><InteractionPrompt /><MinigameWorldHud /><Hotbar /><InventoryPanel /><CookbookPanel /><Toast /></div>
  return <div className="interface"><HUD /><Crosshair /><InteractionPrompt /><ForageCapacity /><Hotbar /><InventoryPanel /><ShopPanel /><LotteryPanel /><TicketInspectPanel /><NoteInspectPanel /><TravelPanel /><SecretDealPanel /><StocksPanel /><PlayerTradePanel /><MenuPanel /><CookbookPanel /><EnhancementPanel /><ResultsPanel /><MinigameResultCard /><Toast /></div>
}

export function App() {
  return <main className="game-shell"><GameWorld /><Interface /><AudioBed /><FeedbackBed /><MineSync /><FarmSync /><DeedSync /></main>
}
