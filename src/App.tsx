import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { GameWorld } from './game/World'
import { ITEMS, SHOPS, STOCKS, itemTooltip, type ItemId, type ShopKind, type StockId } from './game/items'
import { commodityPrice, formatCoins, lotteryJackpot, lotteryPrice, lotteryTwoMatch, sessionSecondsRemaining } from './game/economy'
import { BASKET_CONFIG, COMMODITY_MARKET_CONFIG, CROP_CONFIG, MATCH_CONFIG, PICKAXE_CONFIG, type CommodityId } from './game/config'
import { canMineOre, isPickaxe, miningDuration, oreKindAtDepth, requiredPickaxe } from './game/ore'
import { onMultiplayer, sendMultiplayer } from './game/multiplayer'
import { economyProgressValue, inventoryLayout, lotteryDraw, preparedFoodValue, secretStockOffer, useGameStore, type MarketTransactionResult, type MerchantPurchaseResult, type MineNodeState, type MinigameStanding, type SharedDeedResult, type SharedDeedSnapshot, type SharedFarmResult, type SharedFarmSnapshot, type SharedFarmUpdate, type SharedForageAward, type SharedForageNode, type SharedForageSnapshot } from './game/store'
import { RECIPES, RECIPE_IDS, type RecipeId } from './game/recipes'
import { FARM_RUSH_CROPS, FARM_RUSH_ORDER_LIFETIME_MS, FARM_RUSH_PANTRY, FARM_RUSH_RECIPE_IDS, FORAGE_RUSH_COMPLETION_BONUS, FORAGE_RUSH_REQUIREMENTS, MINIGAME_DURATION, MINING_RUSH_POINTS, farmRushOrders, farmRushRecipe, minigameItemRewards, minigameMilestones, minigameRewardPackage, miningRushOre, scheduledMinigame, type FarmRushCrop, type FarmRushIngredient, type FarmRushTool, type ForageRushKind, type MinigameItemRewardRoll, type MinigameRewardItemId, type MiningRushOre } from './game/minigame'
import { collectionSfx, playGameSfx, type GameSfx } from './game/sfx'
import { ambienceVolume, MUSIC_TRACKS, musicTrackFor, musicVolume } from './game/audio'
import { ENHANCEABLE_ITEMS, ENHANCEMENT_VOUCHER, canUseEnhancementVoucher, enhancedBasketCapacity, enhancementChance, enhancementLevel, enhancementName, enhancementRequirements, enhancementWardForTarget, fortuneFor, isEnhanceableItem, miningSpeedBonus, type EnhanceableItem, type EnhancementWardId } from './game/enhancement'
import type { MerchantCycle, MerchantItemId } from './game/merchant'
import { itemName, localizeDom, shopName, toastText, uiText, zoneName } from './game/i18n'
import type { SharedMarketSnapshot } from './game/market'

const NON_TRADABLE_ITEMS = new Set<ItemId>(['home-charm', 'farm-deed', 'shared-farm-deed', 'upgrade-coupon', 'upgrade-guard-4', 'upgrade-guard-5', 'upgrade-guard-6'])

function useLocale() {
  const language = useGameStore((state) => state.language)
  return {
    language,
    t: (value: string) => uiText(language, value),
    item: (id: ItemId) => itemName(language, id, ITEMS[id].name),
  }
}

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
    if (!sendMultiplayer('minigame:forage:request', { id, milestone: state.minigameMilestone })) state.forageRushCollect(id)
    return
  }
  const shops: Record<string, ShopKind> = { shop: 'common', 'forage-shop': 'forage', 'forage-sell': 'forage-sell', 'farm-shop': 'farm', 'produce-shop': 'produce', 'food-shop': 'food', 'mine-shop': 'mine', 'ore-shop': 'ore' }
  if (shops[id]) return state.setShopOpen(true, shops[id])
  if (id === 'stocks') return state.setStockOpen(true)
  if (id === 'enhance') {
    if (!ENHANCEABLE_ITEMS.some((item) => (state.inventory[item] ?? 0) > 0)) return state.setToast('BUY A TOOL FIRST')
    return state.setEnhancementOpen(true)
  }
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
      const enhancement = isEnhanceableItem(tool) ? enhancementLevel(state.enhancements, tool) + ((state.fortuneBoostCharges[tool] ?? 0) > 0 ? 1 : 0) : 0
      if (!state.tutorialActive && sendMultiplayer('mine:request', { id, tool, enhancement })) return
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
      const message = raw as { id?: string; ore?: ItemId; quantity?: number; generation?: number; readyAt?: number; tool?: string }
      if (message.id && message.ore?.endsWith('-ore') && isPickaxe(message.tool as ItemId) && Number.isFinite(message.generation) && Number.isFinite(message.readyAt)) awardNode(message.id, message.ore as Parameters<typeof awardNode>[1], Number(message.quantity), { generation: Number(message.generation), readyAt: Number(message.readyAt) }, message.tool as Parameters<typeof awardNode>[4])
    })
    const offDenied = onMultiplayer('mine:denied', (raw) => {
      const reason = (raw as { reason?: string })?.reason
      if (reason === 'tier') setToast('Pickaxe tier too low')
    })
    return () => { offSnapshot(); offNode(); offAward(); offDenied() }
  }, [awardNode, setToast, syncNode, syncSnapshot])
  return null
}

function ForageSync() {
  const syncSnapshot = useGameStore((state) => state.syncForageSnapshot)
  const syncNode = useGameStore((state) => state.syncForageNode)
  const awardNode = useGameStore((state) => state.awardForageNode)
  const setToast = useGameStore((state) => state.setToast)
  useEffect(() => {
    const offSnapshot = onMultiplayer('forage:snapshot', (raw) => syncSnapshot(raw as SharedForageSnapshot))
    const offNode = onMultiplayer('forage:node', (raw) => syncNode(raw as SharedForageNode))
    const offAward = onMultiplayer('forage:award', (raw) => awardNode(raw as SharedForageAward))
    const offDenied = onMultiplayer('forage:denied', (raw) => {
      const reason = (raw as { reason?: string })?.reason
      if (reason === 'no-capacity') setToast('Fruit storage full')
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

function MerchantSync() {
  const syncCycle = useGameStore((state) => state.syncMerchantCycle)
  const applyPurchase = useGameStore((state) => state.applyMerchantPurchase)
  const open = useGameStore((state) => state.secretOpen)
  const visualFixture = new URLSearchParams(window.location.search).get('merchantTest') === '1'
  useEffect(() => {
    if (visualFixture) return
    const offSnapshot = onMultiplayer('merchant:snapshot', (raw) => syncCycle(raw as MerchantCycle))
    const offResult = onMultiplayer('merchant:result', (raw) => applyPurchase(raw as MerchantPurchaseResult))
    sendMultiplayer('merchant:request', {})
    return () => { offSnapshot(); offResult() }
  }, [applyPurchase, syncCycle, visualFixture])
  useEffect(() => {
    if (!open || visualFixture) return
    sendMultiplayer('merchant:request', {})
    const timer = window.setInterval(() => sendMultiplayer('merchant:request', {}), 5_000)
    return () => window.clearInterval(timer)
  }, [open, visualFixture])
  return null
}

function MarketSync() {
  const syncSnapshot = useGameStore((state) => state.syncMarketSnapshot)
  const applyTransaction = useGameStore((state) => state.applyMarketTransaction)
  const visualFixture = new URLSearchParams(window.location.search).has('gate') || new URLSearchParams(window.location.search).has('panel') || new URLSearchParams(window.location.search).has('zone')
  useEffect(() => {
    if (visualFixture) return
    const offSnapshot = onMultiplayer('market:snapshot', (raw) => syncSnapshot(raw as SharedMarketSnapshot))
    const offResult = onMultiplayer('market:result', (raw) => applyTransaction(raw as MarketTransactionResult))
    return () => { offSnapshot(); offResult() }
  }, [applyTransaction, syncSnapshot, visualFixture])
  return null
}

function AudioBed() {
  const sessionStarted = useGameStore((state) => state.sessionStarted)
  const tutorialActive = useGameStore((state) => state.tutorialActive)
  const zone = useGameStore((state) => state.zone)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const sessionComplete = useGameStore((state) => state.sessionComplete)
  const volumes = useGameStore((state) => state.audioVolumes)
  const musicRef = useRef<HTMLAudioElement | null>(null)
  const ambienceRef = useRef<HTMLAudioElement | null>(null)
  const trackRef = useRef(MUSIC_TRACKS.hub)
  const unlocked = useRef(false)
  useEffect(() => {
    const music = new Audio(MUSIC_TRACKS.hub.src)
    const ambience = new Audio('/assets/audio/Woodland_Leaves_CC0.ogg')
    musicRef.current = music
    ambienceRef.current = ambience
    music.loop = true
    ambience.loop = true
    music.preload = 'auto'
    ambience.preload = 'auto'
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
    if (musicRef.current) musicRef.current.volume = musicVolume(volumes.master, volumes.music, trackRef.current)
    if (ambienceRef.current) {
      const cave = (sessionStarted || tutorialActive) && (zone === 'mine' || (minigameOpen && minigameKind === 'mining'))
      ambienceRef.current.volume = ambienceVolume(volumes.master, volumes.ambience, cave)
    }
  }, [minigameKind, minigameOpen, sessionStarted, tutorialActive, volumes, zone])
  useEffect(() => {
    const music = musicRef.current
    const ambience = ambienceRef.current
    if (!music || !ambience) return
    // The lobby is always the Plaza. A saved zone, unfinished event, or old
    // results state must never leak a different track into the next lobby.
    const playingWorld = sessionStarted || tutorialActive
    const track = musicTrackFor(zone, minigameOpen, minigameKind, sessionComplete, playingWorld)
    trackRef.current = track
    music.loop = true
    if (!music.src.endsWith(track.src)) music.src = track.src
    music.volume = musicVolume(volumes.master, volumes.music, track)
    const audioZone = !playingWorld ? 'hub' : minigameOpen ? (minigameKind === 'mining' ? 'mine' : minigameKind) : zone
    const ambienceSource = audioZone === 'mine' ? '/assets/audio/Cave_Water_Drips_CC-BY-SA.ogg' : '/assets/audio/Woodland_Leaves_CC0.ogg'
    if (!ambience.src.endsWith(ambienceSource)) ambience.src = ambienceSource
    ambience.volume = ambienceVolume(volumes.master, volumes.ambience, audioZone === 'mine')
    if (unlocked.current) {
      void music.play().catch(() => undefined)
      void ambience.play().catch(() => undefined)
    }
  }, [minigameKind, minigameOpen, sessionComplete, sessionStarted, tutorialActive, volumes.master, volumes.music, zone])
  return null
}

type BurstKind = 'stone' | 'leaf' | 'water' | 'gold' | 'spark'

function feedbackFor(toast: string, zone: ReturnType<typeof useGameStore.getState>['zone'], cashDelta: number, minigameOpen: boolean, minigameKind: ReturnType<typeof useGameStore.getState>['minigameKind']): { sound: GameSfx; burst?: BurstKind } | null {
  if (toast.startsWith('Upgraded') || toast.startsWith('Upgrade failed')) return null
  if (/^(Need|Not enough|Sold out|None owned|Select|Missing|Gone|Own a farm|Not your|Pickaxe tier|Fruit storage|Recipe not|Furnace queue)/.test(toast)) return { sound: 'error' }
  if (toast.startsWith('Unlocked')) return { sound: 'unlock', burst: 'spark' }
  if (toast.startsWith('Planted')) return { sound: 'plant', burst: 'leaf' }
  if (toast === 'Watered') return { sound: 'water', burst: 'water' }
  if (toast === 'Delivered') return { sound: 'coin', burst: 'gold' }
  if (cashDelta > 0) return { sound: 'coin', burst: 'gold' }
  if (cashDelta < 0) return { sound: 'buy', burst: 'gold' }
  if (toast.startsWith('+')) {
    const sound = collectionSfx(zone, minigameOpen, minigameKind)
    return { sound, burst: sound === 'mine-complete' ? 'stone' : 'leaf' }
  }
  if (toast === 'Returned home') return { sound: 'teleport', burst: 'spark' }
  return null
}

function FeedbackBed() {
  const toast = useGameStore((state) => state.toast)
  const cash = useGameStore((state) => state.cash)
  const zone = useGameStore((state) => state.zone)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const volumes = useGameStore((state) => state.audioVolumes)
  const cookQueue = useGameStore((state) => state.cookQueue)
  const previousCash = useRef(cash)
  const [burst, setBurst] = useState<{ id: number; kind: BurstKind } | null>(null)

  useEffect(() => {
    const delta = cash - previousCash.current
    previousCash.current = cash
    if (!toast) return
    const feedback = feedbackFor(toast, zone, delta, minigameOpen, minigameKind)
    if (!feedback) return
    const liveVolumes = useGameStore.getState().audioVolumes
    playGameSfx(feedback.sound, liveVolumes.master * liveVolumes.effects)
    if (!feedback.burst) return
    const next = { id: Date.now(), kind: feedback.burst }
    setBurst(next)
    const timer = window.setTimeout(() => setBurst((current) => current?.id === next.id ? null : current), 720)
    return () => window.clearTimeout(timer)
  }, [cash, minigameKind, minigameOpen, toast, zone])

  useEffect(() => {
    const now = Date.now()
    const timers = cookQueue.filter((job) => job.readyAt > now).map((job) => window.setTimeout(() => playGameSfx('ready', volumes.master * volumes.effects), job.readyAt - now))
    return () => timers.forEach(window.clearTimeout)
  }, [cookQueue, volumes.effects, volumes.master])

  return burst ? <div className={`action-burst ${burst.kind}`} key={burst.id} aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div> : null
}

function Icon({ name }: { name: 'clock' | 'refresh' | 'coin' | 'menu' | 'close' | 'pack' | 'users' | 'sliders' }) {
  const paths = {
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    refresh: <><path d="M18 8a7 7 0 1 0 1 7" /><path d="M18 4v4h-4" /></>,
    coin: <><circle cx="12" cy="12" r="8" /><path d="M15 8.5C14.3 7.5 13.2 7 11.9 7 10.1 7 9 7.9 9 9.3c0 1.5 1.3 2 3.1 2.4 1.8.4 3 1 3 2.6 0 1.5-1.4 2.7-3.3 2.7-1.5 0-2.8-.6-3.6-1.7M12 5v14" /></>,
    menu: <><path d="M6 8h12M6 12h12M6 16h12" /></>,
    close: <><path d="M7 7l10 10M17 7 7 17" /></>,
    pack: <><path d="M7 9h10l1 10H6L7 9Z" /><path d="M9 9V7a3 3 0 0 1 6 0v2" /></>,
    users: <><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.3" /><path d="M4 19c.4-3 2.2-4.5 5-4.5s4.6 1.5 5 4.5M14 15.5c3-.8 5.3.5 6 3.5" /></>,
    sliders: <><path d="M5 7h14M5 12h14M5 17h14" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="11" cy="17" r="2" /></>,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function HUD() {
  const { language, t } = useLocale()
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
  const pendingTradeRequest = useGameStore((state) => state.pendingTradeRequest)
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
  const elapsed = (roundNumber - 1) * MATCH_CONFIG.worldCycleSeconds + (MATCH_CONFIG.worldCycleSeconds - round)
  const nextEventAt = minigameMilestones(sessionDuration).find((milestone) => milestone > elapsed)
  const eventIn = nextEventAt === undefined ? null : nextEventAt - elapsed
  const upcomingEvent = nextEventAt === undefined ? null : scheduledMinigame(nextEventAt, sessionSeed, sessionDuration)
  const eventIcon: ItemId | null = upcomingEvent === 'mining' ? 'crystal-pickaxe' : upcomingEvent === 'farm' ? 'wheat-seeds' : upcomingEvent === 'forage' ? 'apple' : null
  return (
    <>
      <div className="location-chip"><span className="location-dot" />{zoneName(language, zone)}</div>
      <div className="hud-modules">
        {marketCorrectionName && marketCorrectionSeconds > 0 && <div className="market-news"><span>{t('Breaking News')}</span><strong>{t(marketCorrectionName)}</strong></div>}
        {weather !== 'clear' && zone !== 'mine' && <div className="hud-chip weather"><span className={`weather-mark ${weather}`} /><span>{t(weather.toUpperCase())}</span><HoverTip lines={language === 'ko' ? weather === 'rain' ? ['농작물에 자동으로 물을 줍니다.', `${weatherSeconds}초 남음`] : weather === 'sunny' ? ['농작물과 과일이 15% 빨리 자랍니다.', `${weatherSeconds}초 남음`] : weather === 'breeze' ? ['요리가 10% 빨리 끝납니다.', `${weatherSeconds}초 남음`] : ['시야에 옅은 안개가 낍니다.', `${weatherSeconds}초 남음`] : weather === 'rain' ? ['Crops water automatically.', `${weatherSeconds}s remaining`] : weather === 'sunny' ? ['Crops and fruit grow 15% faster.', `${weatherSeconds}s remaining`] : weather === 'breeze' ? ['Cooking finishes 10% faster.', `${weatherSeconds}s remaining`] : ['Soft visibility change.', `${weatherSeconds}s remaining`]} /></div>}
        {eventIn !== null && eventIn <= 60 && eventIcon && <div className="hud-chip upcoming-event" title={t(upcomingEvent === 'mining' ? 'MINING CONTEST' : upcomingEvent === 'farm' ? 'COOKING CONTEST' : 'GATHERING RACE')}><img src={ITEMS[eventIcon].icon} alt="" /><span>0:{String(eventIn).padStart(2, '0')}</span></div>}
        <div className="hud-chip" title={t('Match time')}><Icon name="clock" /><span>{roundMinutes}:{roundSeconds}</span></div>
        <div className="hud-chip restock"><Icon name="refresh" /><span>{minutes}:{seconds}</span></div>
        <div className="hud-chip" title={formatCoins(cash)}><Icon name="coin" /><span>{formatCoins(cash, true)}</span></div>
        <button className={`hud-chip icon-button ${pendingTradeRequest ? 'has-alert' : ''}`} onClick={() => setPlayerPanelOpen(true)} aria-label={t('Players')}><Icon name="users" />{pendingTradeRequest && <i className="notification-dot" />}</button>
        <button className="hud-chip icon-button" onClick={() => setMenuOpen(true)} aria-label={t('Menu')}><Icon name="menu" /></button>
      </div>
    </>
  )
}

function LobbyPanel() {
  const { language, t } = useLocale()
  const started = useGameStore((state) => state.sessionStarted)
  const connected = useGameStore((state) => state.lobbyConnected)
  const isHost = useGameStore((state) => state.isHost)
  const open = useGameStore((state) => state.lobbySettingsOpen)
  const setOpen = useGameStore((state) => state.setLobbySettingsOpen)
  const setMenuOpen = useGameStore((state) => state.setMenuOpen)
  const setPlayerPanelOpen = useGameStore((state) => state.setPlayerPanelOpen)
  const duration = useGameStore((state) => state.sessionDurationSeconds)
  const globalExpansionDeeds = useGameStore((state) => state.lobbyGlobalExpansionDeeds)
  const playerCount = useGameStore((state) => state.lobbyPlayerCount)
  const maxGlobalExpansionDeeds = useGameStore((state) => state.lobbyMaxGlobalExpansionDeeds)
  const readyCount = useGameStore((state) => state.lobbyReadyCount)
  const allReady = useGameStore((state) => state.lobbyAllReady)
  const setGuideOpen = useGameStore((state) => state.setGuideOpen)
  const nickname = useGameStore((state) => state.nickname)
  const setNickname = useGameStore((state) => state.setNickname)
  const [draftName, setDraftName] = useState(nickname)
  if (started) return null
  const chooseDuration = (seconds: number) => {
    if (!isHost) return
    sendMultiplayer('lobby:update', { durationSeconds: seconds })
  }
  const chooseGlobalExpansionDeeds = (quantity: number) => {
    if (!isHost) return
    sendMultiplayer('lobby:update', { globalExpansionDeeds: quantity })
  }
  const start = () => {
    if (!isHost) return
    sendMultiplayer('lobby:start', {})
  }
  return <>
    <div className="hud-modules lobby-tools">
      <button className="hud-chip lobby-player-count" onClick={() => setPlayerPanelOpen(true)} aria-label={t('PLAYERS')}><Icon name="users" /><span>{playerCount}/6</span></button>
      <button className="hud-chip icon-button" onClick={() => setOpen(true)} aria-label={t('GAME SETUP')} title={t('GAME SETUP')}><Icon name="sliders" /></button>
      <button className="hud-chip icon-button" onClick={() => setMenuOpen(true)} aria-label={t('SETTINGS')} title={t('SETTINGS')}><Icon name="menu" /></button>
    </div>
    {open && <div className="modal-scrim lobby-scrim" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}><section className="panel lobby-panel">
      <header><div className="panel-title">{t('GAME SETUP')}</div><b>{readyCount}/{playerCount} {t('READY')}</b><CloseButton onClick={() => setOpen(false)} /></header>
      <label className="lobby-name"><span>{t('NAME')}</span><input aria-label={t('NICKNAME')} value={draftName} maxLength={18} onChange={(event) => setDraftName(event.target.value)} onBlur={() => setNickname(draftName)} onKeyDown={(event) => { if (event.key === 'Enter') { setNickname(draftName); event.currentTarget.blur() } }} /></label>
      <div className="lobby-duration"><span>{t('TIME')}</span><div>{MATCH_CONFIG.selectableDurationsSeconds.map((seconds) => <button className={duration === seconds ? 'active' : ''} disabled={!isHost} key={seconds} onClick={() => chooseDuration(seconds)}>{seconds / 60}{language === 'ko' ? '분' : 'm'}</button>)}</div></div>
      <div className="lobby-duration lobby-extra"><span>{t('EXTRA FARMS')}</span><div>{Array.from({ length: maxGlobalExpansionDeeds + 1 }, (_, quantity) => <button className={globalExpansionDeeds === quantity ? 'active' : ''} disabled={!isHost} key={quantity} onClick={() => chooseGlobalExpansionDeeds(quantity)}>{quantity}</button>)}</div></div>
      <button className="lobby-guide-button" onClick={() => setGuideOpen(true)}><img src="/assets/ui/cooking/cookbook.png" alt="" />{t('HOW TO PLAY')}</button>
      {isHost ? <button className="lobby-start" disabled={!connected || !allReady} onClick={start}>{!connected ? t('CONNECTING') : allReady ? t('START GAME') : `${t('READY')} ${readyCount}/${playerCount}`}</button> : <div className="lobby-wait">{connected ? `${t('READY')} ${readyCount}/${playerCount}` : t('CONNECTING')}</div>}
    </section></div>}
  </>
}

type TutorialBaseline = { foraged: number; mined: number; harvested: number; sold: number }

function OnboardingPanelV2() {
  const { language, t } = useLocale()
  const open = useGameStore((state) => state.guideOpen)
  const complete = useGameStore((state) => state.guideComplete)
  const active = useGameStore((state) => state.tutorialActive)
  const step = useGameStore((state) => state.tutorialStep)
  const inventory = useGameStore((state) => state.inventory)
  const stats = useGameStore((state) => state.stats)
  const enhancements = useGameStore((state) => state.enhancements)
  const shopOpen = useGameStore((state) => state.shopOpen)
  const stockOpen = useGameStore((state) => state.stockOpen)
  const cookbookOpen = useGameStore((state) => state.cookbookOpen)
  const enhancementOpen = useGameStore((state) => state.enhancementOpen)
  const shopKind = useGameStore((state) => state.shopKind)
  const farmCells = useGameStore((state) => state.farmCells)
  const knownRecipes = useGameStore((state) => state.knownRecipes)
  const cookQueue = useGameStore((state) => state.cookQueue)
  const stockPrices = useGameStore((state) => state.stockPrices)
  const commodityMarket = useGameStore((state) => state.commodityMarket)
  const startTutorial = useGameStore((state) => state.startTutorial)
  const setTutorialStep = useGameStore((state) => state.setTutorialStep)
  const completeGuide = useGameStore((state) => state.completeGuide)
  const setGuideOpen = useGameStore((state) => state.setGuideOpen)
  const setLobbySettingsOpen = useGameStore((state) => state.setLobbySettingsOpen)
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const [correctionBefore, setCorrectionBefore] = useState<Partial<Record<CommodityId | 'stock', number>>>({})
  const baseline = useRef<TutorialBaseline>({ foraged: 0, mined: 0, harvested: 0, sold: 0 })
  const correctionStarted = useRef(false)
  const ko = language === 'ko'

  useEffect(() => {
    if (open && !active) setLobbySettingsOpen(true)
  }, [active, open, setLobbySettingsOpen])

  useEffect(() => {
    if (!active) return
    const live = useGameStore.getState()
    baseline.current = { ...live.stats }
    setFlags({})
    correctionStarted.current = false
  }, [active, step])

  useEffect(() => {
    if (!active) return
    const base = baseline.current
    if (step === 2) {
      if ((inventory['cookbook-box'] ?? 0) > 0) setFlags((value) => ({ ...value, bought: true }))
      if (knownRecipes.includes('apple-bread')) setFlags((value) => ({ ...value, recipe: true }))
    }
    if (step === 3) {
      if ((inventory['worn-pickaxe'] ?? 0) > 0) setFlags((value) => ({ ...value, bought: true }))
      if (stats.mined > base.mined) setFlags((value) => ({ ...value, mined: true }))
      if (stats.sold > base.sold) setFlags((value) => ({ ...value, sold: true }))
    }
    if (step === 4) {
      if (stats.foraged > base.foraged) setFlags((value) => ({ ...value, gathered: true }))
      if (stats.sold > base.sold) setFlags((value) => ({ ...value, sold: true }))
    }
    if (step === 5) {
      if (Object.values(farmCells).some((cell) => cell.stage !== 'empty')) setFlags((value) => ({ ...value, planted: true }))
      if (Object.values(farmCells).some((cell) => cell.stage === 'watered' || cell.stage === 'ready')) setFlags((value) => ({ ...value, watered: true }))
      if (stats.harvested > base.harvested) setFlags((value) => ({ ...value, harvested: true }))
    }
    if (step === 6) {
      if (cookQueue.length) setFlags((value) => ({ ...value, queued: true }))
      if ((inventory['food-apple-bread'] ?? 0) > 0) setFlags((value) => ({ ...value, cooked: true }))
      if (stats.sold > base.sold) setFlags((value) => ({ ...value, sold: true }))
    }
    if (step === 9 && (enhancements['worn-pickaxe'] ?? 0) > 0) setFlags((value) => ({ ...value, upgraded: true }))
  }, [active, cookQueue.length, enhancements, farmCells, inventory, knownRecipes, stats, step])

  useEffect(() => {
    if (!active || step !== 7 || !shopOpen || shopKind !== 'food' || flags.marketMoved) return
    const timer = window.setTimeout(() => {
      useGameStore.setState((state) => {
        if (!state.tutorialActive || state.tutorialStep !== 7) return state
        const recipe = 'apple-bread' as const
        const before = preparedFoodValue(recipe, state.commodityMarket, state.foodMarket[recipe])
        const foodMarket = { ...state.foodMarket, [recipe]: state.foodMarket[recipe] + 18 }
        const after = preparedFoodValue(recipe, state.commodityMarket, foodMarket[recipe])
        return { foodMarket, foodPriceHistory: { ...state.foodPriceHistory, [recipe]: [before, after] }, toast: 'Price updated' }
      })
      setFlags((value) => ({ ...value, marketMoved: true }))
    }, 420)
    return () => window.clearTimeout(timer)
  }, [active, flags.marketMoved, shopKind, shopOpen, step])

  useEffect(() => {
    if (!active || step !== 8 || !stockOpen || flags.stockMoved) return
    const timer = window.setTimeout(() => {
      useGameStore.setState((state) => {
        if (!state.tutorialActive || state.tutorialStep !== 8) return state
        const next = Math.round(state.stockPrices.apple * 1.16)
        return { stockPrices: { ...state.stockPrices, apple: next }, stockHistory: { ...state.stockHistory, apple: [...state.stockHistory.apple, next].slice(-5) }, toast: 'AAPL +16%' }
      })
      setFlags((value) => ({ ...value, stockMoved: true }))
    }, 420)
    return () => window.clearTimeout(timer)
  }, [active, flags.stockMoved, stockOpen, step])

  useEffect(() => {
    if (!active || step !== 10 || correctionStarted.current) return
    correctionStarted.current = true
    const before = useGameStore.getState()
    setCorrectionBefore({
      apple: commodityPrice('apple', ITEMS.apple.sellPrice ?? 0, before.commodityMarket.apple),
      tomato: commodityPrice('tomato', ITEMS.tomato.sellPrice ?? 0, before.commodityMarket.tomato),
      'copper-ore': commodityPrice('copper-ore', ITEMS['copper-ore'].sellPrice ?? 0, before.commodityMarket['copper-ore']),
      stock: before.stockPrices.apple,
    })
    const timer = window.setTimeout(() => {
      useGameStore.setState((state) => {
        if (!state.tutorialActive || state.tutorialStep !== 10) return state
        const stock = Math.round(state.stockPrices.apple * .68)
        const nextMarket = { ...state.commodityMarket, apple: Math.round(state.commodityMarket.apple * .66), tomato: Math.round(state.commodityMarket.tomato * 1.5), 'copper-ore': Math.round(state.commodityMarket['copper-ore'] * .72) }
        const histories = { ...state.commodityPriceHistory }
        ;(['apple', 'tomato', 'copper-ore'] as CommodityId[]).forEach((id) => { histories[id] = [...(histories[id] ?? []), commodityPrice(id, ITEMS[id].sellPrice ?? 0, nextMarket[id])].slice(-5) })
        return { commodityMarket: nextMarket, commodityPriceHistory: histories, stockPrices: { ...state.stockPrices, apple: stock }, stockHistory: { ...state.stockHistory, apple: [...state.stockHistory.apple, stock].slice(-5) }, marketCorrectionName: 'Markets shift sharply', marketCorrectionSeconds: 10 }
      })
      setFlags({ corrected: true })
    }, 1100)
    return () => window.clearTimeout(timer)
  }, [active, step])

  if (open && !active) return <aside className="tutorial-card tutorial-lobby-card">
    <header><strong>{t('GAME GUIDE')}</strong>{complete && <button onClick={() => setGuideOpen(false)}>{t('CLOSE')}</button>}</header>
    <div className="tutorial-objective"><b>{ko ? '경기 설정을 확인하세요.' : 'CHECK THE MATCH SETUP'}</b></div>
    <p>{ko ? '최대 6명이 참가하며, 선택한 시간이 끝났을 때 현금이 가장 많은 사람이 이깁니다. 이 안내에서는 임시 아이템만 사용합니다.' : 'Up to 6 players compete for the most cash when the timer ends. This tour uses temporary items only.'}</p>
    <footer><button className="quiet-button" onClick={completeGuide}>{t(complete ? 'CLOSE' : 'SKIP')}</button><button className="guide-next" onClick={startTutorial}>{t('BEGIN TOUR')}</button></footer>
  </aside>
  if (!active) return null

  const completed = step === 1 ? true
    : step === 2 ? Boolean(flags.recipe)
      : step === 3 ? Boolean(flags.bought && flags.mined && flags.sold)
        : step === 4 ? Boolean(flags.gathered && flags.sold)
          : step === 5 ? Boolean(flags.planted && flags.watered && flags.harvested)
            : step === 6 ? Boolean(flags.cooked && flags.sold)
              : step === 7 ? Boolean(flags.marketMoved)
                : step === 8 ? Boolean(flags.stockMoved)
                  : step === 9 ? Boolean(flags.upgraded)
                    : step === 10 ? Boolean(flags.corrected)
                    : true
  const titles = ko
    ? ['기본 조작', '레시피', '채굴', '채집', '농사', '요리', '판매 시세', '주식', '강화', '속보', '떠돌이 상인', '미니게임', '준비 완료']
    : ['CONTROLS', 'RECIPES', 'MINING', 'FORAGING', 'FARMING', 'COOKING', 'MARKET PRICES', 'STOCKS', 'UPGRADE', 'Breaking News', 'WANDERING MERCHANT', 'MINIGAMES', 'READY']
  const objectives = ko
    ? ['움직여 보세요. 안내 중에도 자유롭게 이동할 수 있습니다.', flags.recipe ? '레시피에서 사과빵 재료를 확인하세요.' : flags.bought ? '퀵슬롯의 레시피 상자를 사용하세요.' : '잡화점에서 레시피 상자를 사세요.', flags.sold ? '채굴 완료.' : flags.mined ? '광석 판매점에 광석을 파세요.' : flags.bought ? '곡괭이를 들고 광석을 바라보며 좌클릭을 누르세요.' : '채굴 도구점에서 초보자 곡괭이를 사세요.', flags.sold ? '채집 완료.' : flags.gathered ? '채집품 판매점에 과일을 파세요.' : '과일나무 가까이에서 F를 누르세요.', flags.harvested ? '농사 완료.' : flags.watered ? '다 자란 밀을 수확하세요.' : flags.planted ? '물뿌리개를 선택해 한 번 물을 주세요.' : '밀 씨앗을 선택해 밭에 심으세요.', flags.sold ? '요리 완료.' : flags.cooked ? '완성된 사과빵을 요리 판매점에 파세요.' : flags.queued ? '완성되면 화로를 열어 사과빵을 수령하세요.' : '화로에서 사과빵을 만드세요.', '요리 판매점에서 사과빵 시세를 확인하세요.', '주식을 열어 가격과 최근 변동을 확인하세요.', '초보자 곡괭이를 한 번 강화하세요.', '속보와 함께 시세가 바뀌는 모습을 확인하세요.', '떠돌이 상인이 파는 물건을 확인하세요.', '경기 중 열리는 미니게임을 확인하세요.', '이제 로비로 돌아갈 수 있습니다.']
    : ['Move around. The tour stays in the real world.', flags.recipe ? 'Check Apple Bread’s ingredients in Recipes.' : flags.bought ? 'Use the Recipe Box from your hotbar.' : 'Buy a Recipe Box from the General Shop.', flags.sold ? 'Mining complete.' : flags.mined ? 'Sell the ore at the Ore Market.' : flags.bought ? 'Equip it, face an ore, and hold LMB.' : 'Buy the Starter Pickaxe at the Mining Shop.', flags.sold ? 'Foraging complete.' : flags.gathered ? 'Sell the fruit at the Forage Market.' : 'Press F near a fruit tree.', flags.harvested ? 'Farming complete.' : flags.watered ? 'Harvest the wheat when it is ready.' : flags.planted ? 'Select the watering can and water it once.' : 'Select wheat seeds and plant one cell.', flags.sold ? 'Cooking complete.' : flags.cooked ? 'Sell the finished Apple Bread at the Food Market.' : flags.queued ? 'When it finishes, open the furnace and collect Apple Bread.' : 'Cook Apple Bread at the furnace.', 'Open the Food Market and check Apple Bread’s price.', 'Open Stocks and read the price, direction, and recent changes.', 'Upgrade the Starter Pickaxe once.', 'Watch prices change with the breaking news.', 'See what the Wandering Merchant may carry.', 'Review the match minigames.', 'Return to the lobby when ready.']
  const notes = ko
    ? ['', '레시피를 먼저 보면 어떤 재료를 모으고 키울지 알 수 있습니다.', '깊이에 따라 광석 확률이 달라집니다. 좋은 광석에는 더 좋은 곡괭이가 필요합니다.', '과일은 다시 열리며 바구니가 보관량을 정합니다.', '실제 경기에서는 작물마다 성장 시간이 다릅니다.', '화로 하나는 한 번에 요리 10개를 만들 수 있습니다. 화로가 늘면 10개씩 늘어나며, 최대 세 묶음을 예약할 수 있습니다.', '가격은 주기마다 갱신됩니다. 한꺼번에 많이 팔면 다음 갱신 전에도 가격이 내려갈 수 있습니다.', '주가는 회사마다 다르게 움직입니다. 살 필요 없이 화면만 확인하세요.', '강화는 해당 장비에만 남습니다. 높은 단계는 실패 시 내려갈 수 있습니다.', '속보는 일부 또는 여러 시세를 크게 바꿀 수 있습니다.', '떠돌이 상인은 한정 상품과 다음 속보에 관한 정보를 팝니다. 위치는 때마다 달라집니다.', '미니게임 보상으로 현금, 레시피 상자, 유용한 강화 효과를 받을 수 있습니다.', '정해진 길은 없습니다. 종료 시 보유 현금이 가장 많은 사람이 이깁니다.']
    : ['', 'Recipes show what to gather and grow before you commit.', 'Depth changes ore chances. Better ores require better pickaxes.', 'Fruit regrows; your basket sets capacity.', 'Normal matches use each crop’s full growth time.', 'One furnace cooks 10 dishes per batch. Each extra furnace adds 10, with up to three batches queued.', 'Prices update each cycle. A large sale can push a price down before the next update.', 'Each company moves differently. You do not need to buy anything here.', 'Upgrades stay on that item. High levels can drop on failure.', 'Breaking news can move a few markets—or many—by a large amount.', 'The Wandering Merchant sells limited items and information about upcoming news. Its location changes.', 'Minigames award cash, Recipe Boxes, and useful temporary boosts.', 'There is no required route. Most cash at the end wins.']
  if (step === 9) {
    objectives[8] = ko ? '세 가지 장비를 비교하고 초보자 곡괭이를 한 번 강화하세요.' : 'Compare all three tools, then upgrade the Starter Pickaxe once.'
    notes[8] = ko ? '곡괭이는 채광, 바구니는 채집, 부적은 농사 효율을 높입니다.' : 'Pickaxes improve mining, baskets improve foraging, and charms improve farming.'
  }

  const progress = step === 1 ? '✓'
    : step === 2 ? `${Number(Boolean(flags.bought)) + Number(Boolean(flags.recipe))}/2`
      : step === 3 ? `${Number(Boolean(flags.bought)) + Number(Boolean(flags.mined)) + Number(Boolean(flags.sold))}/3`
        : step === 4 ? `${Number(Boolean(flags.gathered)) + Number(Boolean(flags.sold))}/2`
          : step === 5 ? `${Number(Boolean(flags.planted)) + Number(Boolean(flags.watered)) + Number(Boolean(flags.harvested))}/3`
            : step === 6 ? `${Number(Boolean(flags.queued)) + Number(Boolean(flags.cooked)) + Number(Boolean(flags.sold))}/3`
          : completed ? '✓' : '0/1'

  return <aside className={`tutorial-card tutorial-step-${step} ${shopOpen || stockOpen || cookbookOpen || enhancementOpen ? 'with-modal' : ''}`} data-tutorial-step={step}>
    <header><span>{step}/13</span><strong>{titles[step - 1]}</strong><button onClick={completeGuide}>{t('SKIP')}</button></header>
    <div className="tutorial-objective"><b>{objectives[step - 1]}</b><span>{progress}</span></div>
    {step === 1 && <div className="tutorial-controls">
      {([
        ['WASD', ko ? '이동' : 'MOVE'],
        [ko ? '마우스' : 'MOUSE', ko ? '시점' : 'LOOK'],
        ['SHIFT', ko ? '달리기' : 'SPRINT'],
        ['SPACE', ko ? '점프' : 'JUMP'],
        ['Q', ko ? '시점 고정' : 'CAMERA LOCK'],
        ['E', ko ? '가방' : 'INVENTORY'],
      ] as Array<[string, string]>).map(([key, label]) => <i key={key}><kbd>{key}</kbd><span>{label}</span></i>)}
    </div>}
    {step === 10 && <div className="tutorial-market-values">{(['apple', 'tomato', 'copper-ore'] as CommodityId[]).map((id) => <span key={id}><img src={ITEMS[id].icon} alt="" /><small>{formatCoins(correctionBefore[id] ?? commodityPrice(id, ITEMS[id].sellPrice ?? 0, commodityMarket[id]), true)}</small><i>→</i><b>{formatCoins(commodityPrice(id, ITEMS[id].sellPrice ?? 0, commodityMarket[id]), true)}</b></span>)}<span><img src={STOCKS.apple.logo} alt="" /><small>{formatCoins(correctionBefore.stock ?? stockPrices.apple, true)}</small><i>→</i><b>{formatCoins(stockPrices.apple, true)}</b></span></div>}
    {step === 11 && <div className="tutorial-event-list tutorial-merchant-list"><span><img src={ITEMS['information-note'].icon} alt="" />{ko ? '정보' : 'INFORMATION'}</span><span><img src={ITEMS['mining-boost'].icon} alt="" />{ko ? '채굴 강화' : 'MINING TONIC'}</span><span><img src={ITEMS['upgrade-guard-4'].icon} alt="" />{ko ? '강화 보호' : 'PROTECTION'}</span></div>}
    {step === 12 && <div className="tutorial-event-list"><span><img src={ITEMS['crystal-pickaxe'].icon} alt="" />{t('MINING RUSH')}</span><span><img src={ITEMS['food-apple-bread'].icon} alt="" />{t('KITCHEN RUSH')}</span><span><img src={ITEMS.apple.icon} alt="" />{t('FORAGE RACE')}</span></div>}
    {notes[step - 1] && <p>{notes[step - 1]}</p>}
    <footer>{step > 1 && <button className="quiet-button" onClick={() => setTutorialStep(step - 1)}>{t('BACK')}</button>}<button className="guide-next" disabled={!completed} onClick={() => step === 13 ? completeGuide() : setTutorialStep(step + 1)}>{t(step === 13 ? 'RETURN TO LOBBY' : 'CONTINUE')}</button></footer>
  </aside>
}

function Hotbar() {
  const { item: localizedItem } = useLocale()
  const realHotbar = useGameStore((state) => state.hotbar)
  const realInventory = useGameStore((state) => state.inventory)
  const enhancements = useGameStore((state) => state.enhancements)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const rushInventory = useGameStore((state) => state.rushInventory)
  const farmRushInventory = useGameStore((state) => state.farmRushInventory)
  const farmRushCooking = useGameStore((state) => state.farmRushCooking)
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
  const [eventNow, setEventNow] = useState(Date.now())
  useEffect(() => {
    if (!minigameOpen || minigameKind !== 'farm') return
    const timer = window.setInterval(() => setEventNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [minigameKind, minigameOpen])
  const eventView = minigameOpen ? eventInventoryView(minigameKind, rushInventory, farmRushInventory, forageRushInventory, farmRushCooking, eventNow) : null
  const hotbar = eventView?.hotbar ?? realHotbar
  const inventory = eventView?.inventory ?? realInventory
  const selected = minigameOpen && minigameKind === 'farm' ? FARM_RUSH_TOOLS.indexOf(farmRushTool) : minigameOpen ? 0 : selectedHotbar
  return (
    <div className="hotbar" aria-label="Hotbar">
      {hotbar.map((storedItem, index) => {
        const quantity = storedItem ? inventory[storedItem] ?? 0 : 0
        const miningCounter = minigameOpen && minigameKind === 'mining' && index > 0 && index <= Object.keys(MINING_RUSH_POINTS).length
        const item = storedItem && (quantity > 0 || miningCounter) ? storedItem : null
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
          aria-label={item ? `${index + 1}: ${localizedItem(item)}${itemEnhancement ? ` +${itemEnhancement}` : ''}` : `Slot ${index + 1}`}
        >
          {item && <img src={ITEMS[item].icon} alt={localizedItem(item)} />}
          {item && minigameOpen && minigameKind === 'farm' && index < FARM_RUSH_TOOLS.length - 1 ? <span className="quantity">∞</span> : item && miningCounter ? <span className="quantity">{quantity}</span> : item && quantity > 1 && <span className="quantity">{quantity}</span>}
          {item && <HoverTip lines={itemTooltip(item, itemEnhancement)} />}
        </button>
      })}
    </div>
  )
}

const FARM_RUSH_TOOLS: FarmRushTool[] = [...FARM_RUSH_CROPS, 'water']

function eventInventoryView(kind: 'mining' | 'farm' | 'forage', rushInventory: Record<MiningRushOre, number>, farmInventory: Record<string, number>, forageInventory: Record<string, number>, cooking: Array<{ orderIndex: number; recipe: RecipeId; readyAt: number }>, now: number) {
  const hotbar: Array<ItemId | null> = Array(9).fill(null)
  const inventory: Partial<Record<ItemId, number>> = {}
  if (kind === 'mining') {
    hotbar[0] = 'crystal-pickaxe'
    inventory['crystal-pickaxe'] = 1
    ;(Object.keys(MINING_RUSH_POINTS) as MiningRushOre[]).forEach((id, index) => {
      hotbar[index + 1] = id
      inventory[id] = rushInventory[id] ?? 0
    })
  } else if (kind === 'farm') {
    FARM_RUSH_TOOLS.forEach((tool, index) => {
      hotbar[index] = tool === 'water' ? 'water-can' : `${tool}-seeds` as ItemId
      inventory[hotbar[index]!] = 1
    })
    FARM_RUSH_CROPS.forEach((id) => { inventory[id as ItemId] = farmInventory[id] ?? 0 })
    cooking.filter((job) => job.readyAt <= now).forEach((job) => {
      const food = RECIPES[job.recipe].food
      inventory[food] = (inventory[food] ?? 0) + 1
    })
    ;(Object.entries(farmInventory) as Array<[FarmRushIngredient, number]>).forEach(([id, quantity]) => { inventory[id as ItemId] = quantity })
    const readyFoods = cooking.filter((job) => job.readyAt <= now).map((job) => RECIPES[job.recipe].food)
    const collected = [...new Set([
      ...readyFoods,
      ...FARM_RUSH_CROPS.filter((id) => (farmInventory[id] ?? 0) > 0),
      ...FARM_RUSH_PANTRY.filter((id) => (farmInventory[id] ?? 0) > 0),
    ])]
    collected.slice(0, 3).forEach((id, offset) => { hotbar[6 + offset] = id as ItemId })
  } else {
    const forageItems: Array<[ItemId, string]> = [['apple', 'apple'], ['orange', 'orange'], ['truffle', 'truffle'], ['natural-discovery', 'discovery']]
    forageItems.forEach(([id, key], index) => { hotbar[index] = id; inventory[id] = forageInventory[key] ?? 0 })
  }
  const inventoryOrder = [...hotbar, ...Object.keys(inventory).filter((id) => !hotbar.includes(id as ItemId))] as Array<ItemId | null>
  return { hotbar, inventory, inventoryOrder }
}

function InteractionPrompt() {
  const { language, t, item: localizedItem } = useLocale()
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
  const farmCells = useGameStore((state) => state.sharedFarmOnline && !state.tutorialActive ? state.sharedFarmCells : state.farmCells)
  const enhancements = useGameStore((state) => state.enhancements)
  const miningBoostUntil = useGameStore((state) => state.miningBoostUntil)
  const [promptNow, setPromptNow] = useState(Date.now())
  useEffect(() => {
    if (!prompt?.id.startsWith('farm-cell:') && !prompt?.id.startsWith('FarmRushCell')) return
    setPromptNow(Date.now())
    const timer = window.setInterval(() => setPromptNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [prompt?.id])
  if (!prompt) return null
  if (prompt.id.startsWith('MineOre') || prompt.id.startsWith('RushOre')) {
    const point = anchors[prompt.id]
    if (!point) return null
    const rush = prompt.id.startsWith('RushOre')
    const ore = rush ? miningRushOre(minigameMilestone, prompt.id, rushNodes[prompt.id]?.generation ?? 0) : oreKindAtDepth(prompt.id, point[2], mineGenerations[prompt.id] ?? 0, sessionSeed)
    const tool = hotbar[selectedHotbar]
    const toolEnhancement = !rush && isEnhanceableItem(tool) ? enhancementLevel(enhancements, tool) : 0
    const duration = rush ? 760 : miningDuration(tool, ore, toolEnhancement) * (miningBoostUntil > Date.now() ? .88 : 1)
    const remaining = duration ? Math.max(0, duration * (1 - progress)) : 0
    const required = requiredPickaxe(ore)
    return <div className={`interaction mine-interaction ${duration ? '' : 'locked'}`}>
      <i className="interaction-fill" style={{ width: `${progress * 100}%` }} />
      <kbd>LMB</kbd><span>{localizedItem(ore)}</span>
      <small>{duration ? `${(remaining / 1000).toFixed(1)}s` : language === 'ko' ? `${localizedItem(required)} 장착` : `Equip ${PICKAXE_CONFIG[required].name}`}</small>
    </div>
  }
  if (prompt.id.startsWith('FarmRushCell')) {
    const cell = farmRushCells[prompt.id] ?? { crop: null, stage: 'empty', readyAt: 0 }
    const now = promptNow
    const ready = cell.stage === 'watered' && cell.readyAt <= now
    const label = ready
      ? 'Harvest'
      : cell.stage === 'empty'
        ? farmRushTool === 'water' ? 'Choose a seed' : `Plant ${farmRushTool}`
        : cell.stage === 'planted'
          ? farmRushTool === 'water' ? 'Water' : 'Equip Watering Can'
          : `${Math.max(1, Math.ceil((cell.readyAt - now) / 1000))}s`
    return <div className="interaction farm-status"><span>{t(label)}</span></div>
  }
  if (prompt.id.startsWith('FarmRushCooker')) {
    const pending = farmRushCooking.filter((job) => job.readyAt > Date.now()).length
    const ready = farmRushCooking.length - pending
    return <div className="interaction"><kbd>F</kbd><span>{ready > 0 ? t('READY') : pending > 0 ? `${pending}/3 ${t('Cooking')}` : t('Cook')}</span></div>
  }
  if (prompt.id.startsWith('farm-cell:')) {
    const match = /^farm-cell:(\d+):(\d+)$/.exec(prompt.id)
    const cell = match ? farmCells[`${match[1]}:${match[2]}`] : null
    if (!cell || cell.stage === 'empty') return null
    const label = cell.stage === 'ready'
      ? 'READY'
      : cell.stage === 'planted'
        ? 'WATER'
        : `${Math.max(1, Math.ceil(((cell.readyAt ?? promptNow) - promptNow) / 1000))}s`
    return <div className="interaction farm-status"><span>{t(label)}</span></div>
  }
  if (prompt.id.startsWith('ForageRush')) return <div className="interaction"><kbd>F</kbd><span>{t(prompt.label)}</span></div>
  return <div className="interaction"><kbd>F</kbd><span>{t(prompt.label)}</span></div>
}

function CloseButton({ onClick }: { onClick: () => void }) {
  const { t } = useLocale()
  return <button className="close-button" onClick={onClick} aria-label={t('Close')}><Icon name="close" /></button>
}

function HoverTip({ lines, forceOpen = false }: { lines: string[] | null; forceOpen?: boolean }) {
  const { t } = useLocale()
  const anchor = useRef<HTMLSpanElement>(null)
  const active = useRef(false)
  const [position, setPosition] = useState<{ left: number; top: number; below: boolean } | null>(null)
  // Call sites naturally build tooltip arrays inline. Depending on that array
  // identity rebuilt the listeners on every HUD tick, making a tooltip flash
  // away even while the item remained hovered or focused. Text is the actual
  // dependency, so stable copy keeps hover/focus discoverable across rerenders.
  const linesKey = lines?.join('\u0000') ?? ''
  useEffect(() => {
    const parent = anchor.current?.parentElement
    if (!parent || !lines?.length) return
    const update = () => {
      const rect = parent.getBoundingClientRect()
      const halfWidth = Math.min(115, Math.max(70, (window.innerWidth - 16) / 2))
      setPosition({
        left: Math.max(halfWidth + 8, Math.min(window.innerWidth - halfWidth - 8, rect.left + rect.width / 2)),
        top: rect.top < 118 ? rect.bottom + 8 : rect.top - 8,
        below: rect.top < 118,
      })
    }
    const show = () => { active.current = true; update() }
    const hide = () => { active.current = false; setPosition(null) }
    const reposition = () => { if (active.current) update() }
    parent.addEventListener('mouseenter', show)
    parent.addEventListener('mouseleave', hide)
    parent.addEventListener('focusin', show)
    parent.addEventListener('focusout', hide)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    if (forceOpen) show()
    return () => {
      active.current = false
      parent.removeEventListener('mouseenter', show)
      parent.removeEventListener('mouseleave', hide)
      parent.removeEventListener('focusin', show)
      parent.removeEventListener('focusout', hide)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [forceOpen, linesKey])
  if (!lines?.length) return null
  return <><span ref={anchor} className="hover-tip-anchor" aria-hidden="true" />{position && createPortal(<span className={`hover-tip floating ${position.below ? 'below' : ''}`} style={{ left: position.left, top: position.top }}>{lines.map((line) => <small key={line}>{t(line)}</small>)}</span>, document.body)}</>
}

function InventoryPanel() {
  const { t, item: localizedItem } = useLocale()
  const open = useGameStore((state) => state.inventoryOpen)
  const toggle = useGameStore((state) => state.toggleInventory)
  const realInventory = useGameStore((state) => state.inventory)
  const realInventoryOrder = useGameStore((state) => state.inventoryOrder)
  const realHotbar = useGameStore((state) => state.hotbar)
  const enhancements = useGameStore((state) => state.enhancements)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const rushInventory = useGameStore((state) => state.rushInventory)
  const farmRushInventory = useGameStore((state) => state.farmRushInventory)
  const farmRushCooking = useGameStore((state) => state.farmRushCooking)
  const forageRushInventory = useGameStore((state) => state.forageRushInventory)
  const moveInventorySlot = useGameStore((state) => state.moveInventorySlot)
  const equipItem = useGameStore((state) => state.equipItem)
  const inspectTickets = useGameStore((state) => state.setTicketInspectOpen)
  const inspectNotes = useGameStore((state) => state.setNoteInspectOpen)
  const setTravelOpen = useGameStore((state) => state.setTravelOpen)
  const useCookbookBox = useGameStore((state) => state.useCookbookBox)
  const useMiningBoost = useGameStore((state) => state.useMiningBoost)
  const useCookTimer = useGameStore((state) => state.useCookTimer)
  const setItemUseOpen = useGameStore((state) => state.setItemUseOpen)
  const dragging = useRef<number | null>(null)
  const [eventNow, setEventNow] = useState(Date.now())
  useEffect(() => {
    if (!minigameOpen || minigameKind !== 'farm') return
    const timer = window.setInterval(() => setEventNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [minigameKind, minigameOpen])
  const eventView = minigameOpen ? eventInventoryView(minigameKind, rushInventory, farmRushInventory, forageRushInventory, farmRushCooking, eventNow) : null
  const inventory = eventView?.inventory ?? realInventory
  const inventoryOrder = eventView?.inventoryOrder ?? inventoryLayout({ hotbar: realHotbar, inventoryOrder: realInventoryOrder, inventory: realInventory })
  const hotbar = eventView?.hotbar ?? realHotbar
  const useItem = (id: ItemId) => {
    if (id === 'lottery-ticket') inspectTickets(true)
    else if (id === 'information-note') inspectNotes(true)
    else if (id === 'cookbook-box') useCookbookBox()
    else if (id === 'mining-boost') useMiningBoost()
    else if (id === 'cook-timer') useCookTimer()
    else if (id === 'fortune-boost' || id === 'rain-bottle') setItemUseOpen(id)
    else if (id === 'home-charm') setTravelOpen(true)
    else equipItem(id)
  }
  if (!open) return null
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && toggle()}>
      <section className="panel inventory-panel">
        <header><div className="panel-title"><Icon name="pack" /><span>{t('PACK')}</span></div><CloseButton onClick={toggle} /></header>
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
            >{id && quantity > 0 && <><img draggable={!minigameOpen} src={ITEMS[id].icon} alt={localizedItem(id)} onClick={() => { if (!minigameOpen) useItem(id) }} onContextMenu={(event) => { event.preventDefault(); if (!minigameOpen) useItem(id) }} onDragStart={(event) => { if (!minigameOpen) { dragging.current = index; event.dataTransfer.setData('item-id', id) } }} onDragEnd={() => { dragging.current = null }} /><span>{minigameOpen && minigameKind === 'farm' && index < FARM_RUSH_TOOLS.length - 1 ? '∞' : quantity}</span><HoverTip lines={itemTooltip(id, !minigameOpen && isEnhanceableItem(id) ? enhancementLevel(enhancements, id) : 0)} /></>}</div>
          })}
        </div>
      </section>
    </div>
  )
}

function ItemUsePanel() {
  const { language, t, item: localizedItem } = useLocale()
  const item = useGameStore((state) => state.itemUseOpen)
  const close = useGameStore((state) => state.setItemUseOpen)
  const inventory = useGameStore((state) => state.inventory)
  const charges = useGameStore((state) => state.fortuneBoostCharges)
  const farms = useGameStore((state) => state.claimedFarms)
  const useFortune = useGameStore((state) => state.useFortuneBoost)
  const useRain = useGameStore((state) => state.useRainBottle)
  if (item !== 'fortune-boost' && item !== 'rain-bottle') return null
  const useAndClose = (action: () => void) => { action(); close(null) }
  const gear = ENHANCEABLE_ITEMS.filter((id) => (inventory[id] ?? 0) > 0)
  return <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(null)}><section className="panel item-use-panel">
    <header><div className="panel-title"><img src={ITEMS[item].icon} alt="" /><span>{localizedItem(item)}</span></div><CloseButton onClick={() => close(null)} /></header>
    <div className="item-use-options">{item === 'fortune-boost'
      ? gear.map((id) => <button disabled={(charges[id] ?? 0) > 0} key={id} onClick={() => useAndClose(() => useFortune(id))}><img src={ITEMS[id].icon} alt="" /><span><strong>{localizedItem(id)}</strong><small>{(charges[id] ?? 0) > 0 ? `${charges[id]}${language === 'ko' ? '회 남음' : ' LEFT'}` : `${id.endsWith('pickaxe') ? 20 : id === 'harvest-charm' ? 32 : 30}${language === 'ko' ? '회' : ' USES'}`}</small></span></button>)
      : farms.map((farm) => <button key={farm} onClick={() => useAndClose(() => useRain(farm))}><span className="farm-choice">{farm + 1}</span><span><strong>{t('FARM')} {farm + 1}</strong><small>{language === 'ko' ? '전체 물주기' : 'WATER ALL'}</small></span></button>)}
      {(item === 'fortune-boost' ? gear : farms).length === 0 && <div className="empty-ticket">{language === 'ko' ? '사용할 대상 없음' : 'NONE AVAILABLE'}</div>}
    </div>
  </section></div>
}

function ShopPanel() {
  const { language, t, item: localizedItem } = useLocale()
  const open = useGameStore((state) => state.shopOpen)
  const close = useGameStore((state) => state.setShopOpen)
  const kind = useGameStore((state) => state.shopKind)
  const cash = useGameStore((state) => state.cash)
  const inventory = useGameStore((state) => state.inventory)
  const trade = useGameStore((state) => state.trade)
  const commodityMarket = useGameStore((state) => state.commodityMarket)
  const commodityPriceHistory = useGameStore((state) => state.commodityPriceHistory)
  const foodMarket = useGameStore((state) => state.foodMarket)
  const foodPriceHistory = useGameStore((state) => state.foodPriceHistory)
  const knownRecipes = useGameStore((state) => state.knownRecipes)
  const round = useGameStore((state) => state.roundNumber)
  const shopStock = useGameStore((state) => state.shopStock)
  const enhancements = useGameStore((state) => state.enhancements)
  const tutorialActive = useGameStore((state) => state.tutorialActive)
  const tutorialStep = useGameStore((state) => state.tutorialStep)
  const personalDeedAvailable = useGameStore((state) => state.personalDeedAvailable)
  const globalDeedsRemaining = useGameStore((state) => state.globalDeedsRemaining)
  const openLottery = useGameStore((state) => state.setLotteryOpen)
  if (!open) return null
  const shop = SHOPS[kind]
  const visibleItems = kind === 'food'
    ? shop.items.filter((id) => knownRecipes.some((recipe) => RECIPES[recipe].food === id))
    : shop.items
  const supportsBulkTrade = shop.action === 'sell' || kind === 'farm' || kind === 'common'
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
      <section className={`panel shop-panel ${kind === 'food' ? 'food-market-panel' : ''} ${kind === 'common' ? 'common-shop-panel' : ''}`}>
        <header><div className="panel-title"><span className="shop-mark">{shop.title[0]}</span><span>{shopName(language, kind, shop.title)}</span></div><div className="shop-balance" title={formatCoins(cash)}><Icon name="coin" /><span>{formatCoins(cash, true)}</span></div><CloseButton onClick={() => close(false)} /></header>
        <div className="shop-grid">
          {visibleItems.map((id) => {
            const item = ITEMS[id]
            const commodity = id in COMMODITY_MARKET_CONFIG ? id as CommodityId : null
            const recipe = id.startsWith('food-') ? id.slice(5) as RecipeId : null
            const price = recipe ? preparedFoodValue(recipe, commodityMarket, foodMarket[recipe]) : id === 'lottery-ticket' ? lotteryPrice(round) : shop.action === 'sell' && commodity ? commodityPrice(commodity, item.sellPrice ?? 0, commodityMarket[commodity]) : shop.action === 'sell' ? item.sellPrice : item.buyPrice
            const owned = id === 'shared-farm-deed' ? inventory['farm-deed'] ?? 0 : inventory[id] ?? 0
            const level = isEnhanceableItem(id) ? enhancementLevel(enhancements, id) : 0
            const displayName = `${localizedItem(id)}${level ? ` +${level}` : ''}`
            const deedTile = id === 'farm-deed' || id === 'shared-farm-deed'
            const personalDeed = id === 'farm-deed'
            const deedLocked = deedTile && !personalDeed && personalDeedAvailable
            const available = deedTile ? (personalDeed ? (personalDeedAvailable ? 1 : 0) : globalDeedsRemaining) : item.limited ? shopStock[id] ?? 0 : null
            const stockLabel = isEnhanceableItem(id) && owned > 0 ? t('OWNED') : deedTile ? personalDeed ? (personalDeedAvailable ? t('AVAILABLE') : t('OWNED')) : `${globalDeedsRemaining} ${t('LEFT')}` : available !== null ? `${available} ${t('LEFT')}` : null
            const history = recipe ? foodPriceHistory[recipe] ?? [] : commodity ? commodityPriceHistory[commodity] ?? [] : []
            const tutorialFocus = tutorialActive && (tutorialStep === 2 && kind === 'common' && id === 'cookbook-box' || tutorialStep === 3 && kind === 'mine' && id === 'worn-pickaxe' || tutorialStep === 7 && kind === 'food' && id === 'food-apple-bread')
            return <button
              className={`shop-tile ${history.length ? 'has-history' : ''} ${deedLocked ? 'deed-locked' : ''} ${tutorialFocus ? 'tutorial-focus' : ''}`}
              key={id}
              autoFocus={tutorialFocus}
              onMouseDown={(event) => {
                event.preventDefault()
                if (id === 'lottery-ticket') return openLottery(true)
                const amount = event.shiftKey ? 10 : 1
                if (shop.action === 'buy' && event.button === 0) trade(id, amount)
                else if (shop.action === 'sell' && event.button === 0) trade(id, -amount)
              }}
              onContextMenu={(event) => event.preventDefault()}
            ><img src={item.icon} alt={displayName} /><span className="shop-item-name">{displayName}</span><span className="shop-owned"><b>×{owned}</b>{stockLabel && <em>{stockLabel}</em>}</span><span className="shop-price" title={price ? formatCoins(price) : undefined}><Icon name="coin" />{price ? formatCoins(price, true) : '—'}</span>{history.length > 0 && <span className="commodity-history">{history.slice(-5).map((value, index, recent) => <small className={index === 0 || value >= recent[index - 1] ? 'up' : 'down'} key={`${value}-${index}`}>{formatCoins(value)}</small>)}</span>}<HoverTip forceOpen={tutorialFocus && history.length === 0} lines={deedLocked ? [t('BUY PERSONAL DEED FIRST')] : itemTooltip(id, level)} /></button>
          })}
          {kind === 'food' && visibleItems.length === 0 && <div className="shop-empty">{t('NO DISHES YET')}</div>}
        </div>
        <div className="shop-controls">{shop.action === 'sell' ? t('SELL: LMB') : t('BUY: LMB')}{supportsBulkTrade && <><span />{t('×10: Shift')}</>}</div>
      </section>
    </div>
  )
}

function LotteryPanel() {
  const { t, language } = useLocale()
  const open = useGameStore((state) => state.lotteryOpen)
  const close = useGameStore((state) => state.setLotteryOpen)
  const draft = useGameStore((state) => state.lotteryDraft)
  const toggle = useGameStore((state) => state.toggleLotteryNumber)
  const buy = useGameStore((state) => state.buyLotteryTicket)
  const cash = useGameStore((state) => state.cash)
  const round = useGameStore((state) => state.roundNumber)
  const roundSeconds = useGameStore((state) => state.roundSeconds)
  const [tier, setTier] = useState<1 | 5 | 25>(1)
  const price = lotteryPrice(round) * tier
  const twoMatch = lotteryTwoMatch(round) * tier
  const jackpot = lotteryJackpot(round) * tier
  if (!open) return null
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
      <section className="panel lottery-panel">
        <header><div className="panel-title"><span className="ticket-mark">✦</span><span>{t('LOTTERY')}</span></div><div className="shop-balance" title={formatCoins(cash)}><Icon name="coin" /><span>{formatCoins(cash, true)}</span></div><CloseButton onClick={() => close(false)} /></header>
        <div className="lottery-tiers">{([1,5,25] as const).map((value) => <button className={tier === value ? 'active' : ''} key={value} onClick={() => setTier(value)}>{t(value === 1 ? 'STANDARD' : value === 5 ? 'GOLD' : 'GRAND')}</button>)}</div>
        <div className="number-grid">
          {Array.from({ length: 12 }, (_, index) => index + 1).map((number) => <button key={number} className={draft.includes(number) ? 'selected' : ''} onClick={() => toggle(number)}>{number}</button>)}
        </div>
        <footer className="lottery-footer"><span>{draft.length}/3</span><button disabled={draft.length !== 3 || cash < price} onClick={() => buy(tier)}><Icon name="coin" />{formatCoins(price, true)}</button><small>{t('2 MATCHES')} · {formatCoins(twoMatch, true)} &nbsp; {t('3 MATCHES')} · {formatCoins(jackpot, true)}</small><em>{language === 'ko' ? '추첨' : 'DRAW'} {Math.floor(roundSeconds / 60)}:{String(roundSeconds % 60).padStart(2, '0')}</em></footer>
      </section>
    </div>
  )
}

function TicketInspectPanel() {
  const { t, language } = useLocale()
  const open = useGameStore((state) => state.ticketInspectOpen)
  const close = useGameStore((state) => state.setTicketInspectOpen)
  const tickets = useGameStore((state) => state.lotteryTickets)
  const round = useGameStore((state) => state.roundNumber)
  if (!open) return null
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
      <section className="panel ticket-inspect-panel">
        <header><div className="panel-title"><span className="ticket-mark">✦</span><span>{t('LOTTERY')}</span></div><CloseButton onClick={() => close(false)} /></header>
        <div className="ticket-stack">
          {[...tickets].reverse().map((ticket) => <div className={ticket.draw ? 'ticket-card drawn' : 'ticket-card'} key={ticket.id}>
            <span className="ticket-round">R{ticket.drawRound} · {t(ticket.tier === 25 ? 'GRAND' : ticket.tier === 5 ? 'GOLD' : 'STANDARD')}</span>
            <strong>{ticket.numbers.map((number) => <i key={number}>{number}</i>)}</strong>
            <small>{ticket.draw ? (language === 'ko' ? `${ticket.matches ?? 0}개 일치${ticket.payout ? ` · +${formatCoins(ticket.payout, true)}` : ''}` : `${ticket.matches ?? 0} match${ticket.matches === 1 ? '' : 'es'}${ticket.payout ? ` · +${formatCoins(ticket.payout, true)}` : ''}`) : round === ticket.drawRound ? t('NEXT DRAW') : `${language === 'ko' ? '추첨' : 'DRAW'} ${lotteryDraw(ticket.drawRound).join(' · ')}`}</small>
          </div>)}
          {tickets.length === 0 && <div className="empty-ticket">{t('NO TICKETS')}</div>}
        </div>
      </section>
    </div>
  )
}

function SecretDealPanel() {
  const { t, item: localizedItem } = useLocale()
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
  const merchantCycle = useGameStore((state) => state.merchantCycle)
  const merchantPending = useGameStore((state) => state.merchantPurchasePending)
  const buyItem = useGameStore((state) => state.buyMerchantItem)
  const duration = useGameStore((state) => state.sessionDurationSeconds)
  if (!open || zone === 'hub') return null
  const offers = [0, 1].map((slot) => secretStockOffer(round, prices, sessionSeed, corrections, slot, duration))
  return (
    <div className="modal-scrim secret-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
      <section className="panel secret-panel">
        <header><div className="panel-title"><span className="secret-mark">?</span><span>{t('WANDERING MERCHANT')}</span></div><CloseButton onClick={() => close(false)} /></header>
        <div className="merchant-offers">{merchantCycle?.inventory.map((offer) => {
          const item = ITEMS[offer.id]
          return <article className={offer.stock < 1 ? 'sold' : ''} key={offer.id}><img src={item.icon} alt="" /><span><strong>{localizedItem(offer.id)}</strong><small>{offer.stock}/{offer.maxStock}</small></span><button disabled={merchantPending || offer.stock < 1 || cash < offer.price} onClick={() => buyItem(offer.id)}>{offer.stock < 1 ? t('SOLD OUT') : formatCoins(offer.price, true)}</button></article>
        })}</div>
        <div className="broker-info">{offers.map((offer, slot) => {
          const bought = purchases.includes(`${round}:${slot}`)
          return <article key={slot}><span><strong>{t(`INFO ${slot + 1}`)}</strong></span><button disabled={!offer.available || bought || cash < offer.cost} onClick={() => buy(slot)}>{!offer.available || bought ? t('SOLD OUT') : formatCoins(offer.cost, true)}</button></article>
        })}</div>
      </section>
    </div>
  )
}

function NoteInspectPanel() {
  const { t } = useLocale()
  const open = useGameStore((state) => state.noteInspectOpen)
  const close = useGameStore((state) => state.setNoteInspectOpen)
  const notes = useGameStore((state) => state.brokerNotes)
  if (!open) return null
  return <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}><section className="panel note-panel"><header><div className="panel-title"><img className="cookbook-mark" src="/assets/ui/cooking/cookbook.png" alt="" /><span>{t('INFORMATION')}</span></div><CloseButton onClick={() => close(false)} /></header><div className="note-list">{[...notes].reverse().map((note) => <article key={note.id}><small>R{note.round}</small><strong>{t(note.title)}</strong><p>{t(note.text)}</p></article>)}{notes.length === 0 && <div className="empty-ticket">{t('NO INFORMATION')}</div>}</div></section></div>
}

function StocksPanel() {
  const { t } = useLocale()
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
        <header><div className="panel-title"><span className="shop-mark">↗</span><span>{t('STOCKS')}</span></div><div className="shop-balance" title={formatCoins(cash)}><Icon name="coin" /><span>{formatCoins(cash, true)}</span></div><CloseButton onClick={() => close(false)} /></header>
        <div className="stock-grid">
          {(Object.keys(STOCKS) as StockId[]).map((id) => {
            const stock = STOCKS[id]
            const values = history[id]
            const previousPrice = values.at(-2)
            const direction = previousPrice === undefined || values.at(-1) === previousPrice ? 'flat' : values.at(-1)! > previousPrice ? 'up' : 'down'
            const elapsed = (round - 1) * MATCH_CONFIG.worldCycleSeconds + (MATCH_CONFIG.worldCycleSeconds - roundSeconds)
            const unlocked = true
            return <button key={id} className={`stock-card ${unlocked ? '' : 'locked'}`} onMouseDown={(event) => {
              event.preventDefault()
              if (!unlocked) return
              const amount = event.shiftKey ? 10 : 1
              if (event.button === 0) trade(id, amount)
              if (event.button === 2) trade(id, -amount)
            }} onContextMenu={(event) => event.preventDefault()}>
              <span className="stock-logo" data-no-localize><img src={stock.logo} alt={stock.name} /></span>
              <span className="stock-name" data-no-localize>{stock.name}<small>{stock.ticker}</small></span>
              {unlocked ? <>
                <span className={`stock-direction ${direction}`}>{direction === 'up' ? '↑' : direction === 'down' ? '↓' : '—'}</span>
                <span className="stock-price" title={formatCoins(prices[id])}><Icon name="coin" />{formatCoins(prices[id], true)}</span>
                <span className="stock-count"><b>{portfolio[id] ?? 0}</b> {t('OWN')} <i /> <b>{supply[id]}</b> {t('LEFT')}</span>
                <span className="stock-history">{values.slice(-5).map((value, index, recent) => <small className={index === 0 || value === recent[index - 1] ? 'flat' : value > recent[index - 1] ? 'up' : 'down'} key={`${value}-${index}`}>{formatCoins(value)}</small>)}</span>
              </> : <span className="stock-lock">{stock.releaseMinute}m</span>}
            </button>
          })}
        </div>
        <div className="shop-controls">{t('BUY: LMB')}<span />{t('SELL: RMB')}<span />{t('×10: Shift')}</div>
      </section>
    </div>
  )
}

type PlayerTradeOffer = { cash: number; items: Record<string, number> }

function PlayerTradePanel() {
  const { language, t, item: localizedItem } = useLocale()
  const open = useGameStore((state) => state.playerPanelOpen)
  const sessionStarted = useGameStore((state) => state.sessionStarted)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const lobbyReadyPlayerIds = useGameStore((state) => state.lobbyReadyPlayerIds)
  const setOpen = useGameStore((state) => state.setPlayerPanelOpen)
  const players = useGameStore((state) => state.onlinePlayers)
  const nickname = useGameStore((state) => state.nickname)
  const setNickname = useGameStore((state) => state.setNickname)
  const inventory = useGameStore((state) => state.inventory)
  const cash = useGameStore((state) => state.cash)
  const applyTrade = useGameStore((state) => state.applyPlayerTrade)
  const setToast = useGameStore((state) => state.setToast)
  const incoming = useGameStore((state) => state.pendingTradeRequest)
  const setIncoming = useGameStore((state) => state.setPendingTradeRequest)
  const [draftName, setDraftName] = useState(nickname)
  const [tradeId, setTradeId] = useState<string | null>(null)
  const [partner, setPartner] = useState<{ id: string; nickname: string } | null>(null)
  const [offer, setOffer] = useState<PlayerTradeOffer>({ cash: 0, items: {} })
  const [theirOffer, setTheirOffer] = useState<PlayerTradeOffer>({ cash: 0, items: {} })
  const [ready, setReady] = useState(false)
  const [theirReady, setTheirReady] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const partnerRef = useRef<string | null>(null)
  const tradeRef = useRef<string | null>(null)

  useEffect(() => {
    const offRequest = onMultiplayer('trade:request', (raw) => {
      if (!sessionStarted || minigameOpen) return
      const request = raw as { fromId: string; fromNickname: string }
      setIncoming(request)
    })
    const offOpened = onMultiplayer('trade:opened', (raw) => {
      const data = raw as { tradeId: string; partnerId: string; partnerNickname: string }
      tradeRef.current = data.tradeId; partnerRef.current = data.partnerId
      setTradeId(data.tradeId); setPartner({ id: data.partnerId, nickname: data.partnerNickname || 'Player' })
      setOffer({ cash: 0, items: {} }); setTheirOffer({ cash: 0, items: {} }); setReady(false); setTheirReady(false); setPickerOpen(false); setIncoming(null); setOpen(true)
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
      tradeRef.current = null; partnerRef.current = null; setTradeId(null); setPartner(null); setReady(false); setTheirReady(false); setPickerOpen(false)
    }
    const offCancel = onMultiplayer('trade:cancel', () => { closeTrade(); setToast('Trade cancelled') })
    const offCommit = onMultiplayer('trade:commit', (raw) => {
      const data = raw as { tradeId: string; give: PlayerTradeOffer; receive: PlayerTradeOffer }
      if (data.tradeId !== tradeRef.current) return
      if (!applyTrade(data.give, data.receive)) setToast('Trade could not complete')
      closeTrade()
    })
    return () => { offRequest(); offOpened(); offUpdate(); offCancel(); offCommit() }
  }, [applyTrade, minigameOpen, sessionStarted, setIncoming, setOpen, setToast])

  useEffect(() => { if (minigameOpen) setIncoming(null) }, [minigameOpen, setIncoming])

  useEffect(() => {
    const onTab = (event: KeyboardEvent) => {
      if (event.code !== 'Tab' || event.target instanceof HTMLInputElement) return
      event.preventDefault(); setOpen(!useGameStore.getState().playerPanelOpen)
    }
    window.addEventListener('keydown', onTab)
    return () => window.removeEventListener('keydown', onTab)
  }, [setOpen])

  const publishOffer = (next: PlayerTradeOffer, isReady = false) => {
    const items = Object.fromEntries(Object.entries(next.items).filter(([, quantity]) => quantity > 0))
    const clean = { cash: Math.min(cash, Math.max(0, Math.floor(next.cash))), items }
    setOffer(clean); setReady(isReady); setTheirReady(false)
    if (tradeId) sendMultiplayer('trade:update', { tradeId, offer: clean, ready: isReady })
  }
  const closePanel = () => {
    if (tradeId) sendMultiplayer('trade:cancel', { tradeId })
    tradeRef.current = null; partnerRef.current = null; setTradeId(null); setPartner(null); setOpen(false)
  }
  if (!open) return null
  const tradable = (Object.keys(ITEMS) as ItemId[]).filter((id) => id !== 'gold-coins' && !isEnhanceableItem(id) && !NON_TRADABLE_ITEMS.has(id) && (inventory[id] ?? 0) > 0)
  const offeredItems = Object.entries(offer.items).filter(([, quantity]) => quantity > 0) as Array<[ItemId, number]>
  const changeItem = (id: ItemId, delta: number) => publishOffer({ ...offer, items: { ...offer.items, [id]: Math.max(0, Math.min(inventory[id] ?? 0, (offer.items[id] ?? 0) + delta)) } })
  const changeCash = (delta: number | 'max') => publishOffer({ ...offer, cash: delta === 'max' ? cash : offer.cash + delta })
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && closePanel()}>
      <section className="panel player-panel">
        <header><div className="panel-title"><Icon name="users" /><span>{tradeId ? <>{t('TRADE')} · <i data-no-localize>{partner?.nickname ?? ''}</i></> : t('PLAYERS')}</span></div><CloseButton onClick={closePanel} /></header>
        {!tradeId ? <>
          <div className="nickname-row"><input data-no-localize value={draftName} maxLength={18} aria-label={t('NICKNAME')} onChange={(event) => setDraftName(event.target.value)} onBlur={() => setNickname(draftName)} onKeyDown={(event) => { if (event.key === 'Enter') { setNickname(draftName); event.currentTarget.blur() } }} /><span>{players.length + 1}/6</span></div>
          {sessionStarted && !minigameOpen && incoming && <div className="trade-request"><span data-no-localize>{incoming.fromNickname}</span><button onClick={() => { sendMultiplayer('trade:accept', { fromId: incoming.fromId }); setIncoming(null) }}>{t('ACCEPT')}</button><button className="quiet-button" onClick={() => setIncoming(null)}>{t('NO')}</button></div>}
          <div className="player-list">{players.length ? players.map((player) => <div className="player-row" key={player.id}><span className="player-avatar" data-no-localize>{player.nickname[0]?.toUpperCase()}</span><span><i data-no-localize>{player.nickname}</i><small>{zoneName(language, player.zone)}</small></span>{!sessionStarted && <em className={`lobby-player-ready ${lobbyReadyPlayerIds.includes(player.id) ? 'ready' : ''}`}>{t(lobbyReadyPlayerIds.includes(player.id) ? 'READY' : 'LEARNING')}</em>}{sessionStarted && !minigameOpen && <button onClick={() => { sendMultiplayer('trade:request', { targetId: player.id }); setToast('Trade request sent') }}>{t('TRADE')}</button>}</div>) : <div className="empty-players">{t('NO ONE ELSE ONLINE')}</div>}</div>
        </> : <>
          <div className="trade-columns">
            <div className={`trade-side ${ready ? 'ready' : ''}`}>
              <h3>{t('YOU')} <span>{ready ? t('READY') : ''}</span></h3>
              <div className="trade-cash-editor"><div><Icon name="coin" /><input aria-label={language === 'ko' ? '골드' : 'Gold'} min="0" max={cash} step="10000" type="number" value={offer.cash || ''} placeholder="0" onChange={(event) => publishOffer({ ...offer, cash: Number(event.currentTarget.value) || 0 })} /></div><div>{[10_000, 100_000, 1_000_000].map((value) => <button key={value} onClick={() => changeCash(value)}>+{formatCoins(value, true)}</button>)}<button onClick={() => publishOffer({ ...offer, cash: 0 })}>0</button><button onClick={() => changeCash('max')}>{t('MAX')}</button></div></div>
              <div className="trade-offer-items">{offeredItems.map(([id, quantity]) => <article key={id}><img src={ITEMS[id].icon} alt={localizedItem(id)} /><span><strong>{localizedItem(id)}</strong><small>{quantity}/{inventory[id] ?? 0}</small></span><div><button onClick={() => changeItem(id, -1)}>−</button><button onClick={() => changeItem(id, 1)}>+</button></div></article>)}</div>
              <button className="trade-add-item" disabled={!tradable.length} onClick={() => setPickerOpen((value) => !value)}>{t('ADD ITEM')}</button>
              {pickerOpen && <div className="trade-picker">{tradable.map((id) => <button key={id} onClick={() => { changeItem(id, 1); setPickerOpen(false) }}><img src={ITEMS[id].icon} alt={localizedItem(id)} /><span>{inventory[id] ?? 0}</span><HoverTip lines={[localizedItem(id), ...(itemTooltip(id) ?? [])]} /></button>)}</div>}
            </div>
            <div className={`trade-side ${theirReady ? 'ready' : ''}`}><h3><i data-no-localize>{partner?.nickname ?? 'PLAYER'}</i> <span>{theirReady ? t('READY') : ''}</span></h3><div className="trade-cash"><Icon name="coin" /><strong>{formatCoins(theirOffer.cash, true)}</strong></div><div className="trade-offer-items receive">{Object.entries(theirOffer.items).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ITEMS[id as ItemId] && <article key={id}><img src={ITEMS[id as ItemId].icon} alt={localizedItem(id as ItemId)} /><span><strong>{localizedItem(id as ItemId)}</strong><small>×{quantity}</small></span></article>)}</div></div>
          </div>
          <footer className="trade-actions"><button className="quiet-button" onClick={closePanel}>{t('CANCEL')}</button><button className={ready ? 'ready-button active' : 'ready-button'} onClick={() => publishOffer(offer, !ready)}>{t(ready ? 'UNREADY' : 'READY')}</button></footer>
        </>}
      </section>
    </div>
  )
}

function Crosshair() {
  const locked = useGameStore((state) => state.shiftLocked)
  return locked ? <div className="crosshair" aria-hidden="true"><i /><i /></div> : null
}

type ChatEntry = { id: string; nickname: string; text: string; sentAt: number }

function GameChat() {
  const tutorialActive = useGameStore((state) => state.tutorialActive)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const nickname = useGameStore((state) => state.nickname)
  const language = useGameStore((state) => state.language)
  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [now, setNow] = useState(Date.now())
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const valid = (entry: unknown): entry is ChatEntry => Boolean(entry && typeof entry === 'object'
      && typeof (entry as ChatEntry).id === 'string'
      && typeof (entry as ChatEntry).nickname === 'string'
      && typeof (entry as ChatEntry).text === 'string'
      && Number.isFinite((entry as ChatEntry).sentAt))
    const merge = (entry: ChatEntry) => setMessages((current) => [...current.filter((message) => message.id !== entry.id), entry].sort((a, b) => a.sentAt - b.sentAt).slice(-40))
    const offSnapshot = onMultiplayer('chat:snapshot', (raw) => {
      if (Array.isArray(raw)) setMessages(raw.filter(valid).slice(-40))
    })
    const offMessage = onMultiplayer('chat:message', (raw) => { if (valid(raw)) merge(raw) })
    return () => { offSnapshot(); offMessage() }
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    const key = (event: KeyboardEvent) => {
      if (tutorialActive) return
      if (event.code === 'Enter' && !open && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault()
        setOpen(true)
        window.requestAnimationFrame(() => input.current?.focus())
      } else if (event.code === 'Escape' && open) {
        setOpen(false)
        setDraft('')
      }
    }
    window.addEventListener('keydown', key)
    return () => { window.clearInterval(timer); window.removeEventListener('keydown', key) }
  }, [open, tutorialActive])
  if (tutorialActive) return null
  const visible = open ? messages.slice(-8) : messages.filter((message) => now - message.sentAt < 10_000).slice(-4)
  const submit = () => {
    const text = draft.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140)
    if (!text) return
    if (!sendMultiplayer('chat:send', { text })) {
      setMessages((current) => [...current, { id: `local-${Date.now()}`, nickname, text, sentAt: Date.now() }].slice(-40))
    }
    setDraft('')
  }
  return <section className={`game-chat ${open ? 'open' : ''} ${minigameOpen ? 'event' : ''}`} aria-label={language === 'ko' ? '채팅' : 'Chat'}>
    <div className="chat-history">{visible.map((message) => <div className={!open && now - message.sentAt > 7_000 ? 'fading' : ''} key={message.id}><strong data-no-localize>{message.nickname}</strong><span data-no-localize>{message.text}</span></div>)}</div>
    {open && <input ref={input} maxLength={140} value={draft} placeholder={language === 'ko' ? '메시지 입력…' : 'Message…'} onChange={(event) => setDraft(event.currentTarget.value)} onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); submit() }
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setDraft('') }
    }} />}
  </section>
}

function MenuPanel() {
  const { language, t } = useLocale()
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
  const sprintMode = useGameStore((state) => state.sprintMode)
  const setSprintMode = useGameStore((state) => state.setSprintMode)
  const graphicsMode = useGameStore((state) => state.graphicsMode)
  const setGraphicsMode = useGameStore((state) => state.setGraphicsMode)
  const setLanguage = useGameStore((state) => state.setLanguage)
  const openCookbook = useGameStore((state) => state.setCookbookOpen)
  const openGuide = useGameStore((state) => state.setGuideOpen)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const sessionStarted = useGameStore((state) => state.sessionStarted)
  if (!open) return null
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
      <section className="panel settings-panel">
        <header><div className="panel-title"><Icon name="menu" /><span>{t('SETTINGS')}</span></div><CloseButton onClick={() => close(false)} /></header>
        <div className="language-row"><span>{t('LANGUAGE')}</span><div><button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>English</button><button className={language === 'ko' ? 'active' : ''} onClick={() => setLanguage('ko')}>한국어</button></div></div>
        <div className="language-row graphics-row"><span>{t('GRAPHICS')}</span><div>{(['auto', 'low', 'medium', 'high'] as const).map((mode) => <button className={graphicsMode === mode ? 'active' : ''} key={mode} onClick={() => setGraphicsMode(mode)}>{t(mode.toUpperCase())}</button>)}</div></div>
        {(['master', 'music', 'ambience', 'effects'] as const).map((channel) => (
          <label className="volume-row" key={channel}><span>{t(channel.toUpperCase())}</span><input type="range" min="0" max="1" step="0.01" value={volumes[channel]} onChange={(event) => setVolume(channel, Number(event.target.value))} /><output>{Math.round(volumes[channel] * 100)}%</output></label>
        ))}
        <label className="volume-row"><span>{t('SENSITIVITY')}</span><input aria-label="Camera sensitivity" type="range" min="0.35" max="1.8" step="0.05" value={sensitivity} onChange={(event) => setSensitivity(Number(event.target.value))} /></label>
        <div className="language-row"><span>{t('SPRINT MODE')}</span><div><button className={sprintMode === 'toggle' ? 'active' : ''} onClick={() => setSprintMode('toggle')}>{t('TOGGLE')}</button><button className={sprintMode === 'hold' ? 'active' : ''} onClick={() => setSprintMode('hold')}>{t('HOLD')}</button></div></div>
        <div className="camera-options"><button className={shiftLocked ? 'active' : ''} onClick={() => setShiftLocked(!shiftLocked)}>{t('SHIFT LOCK')}</button><button className={invertY ? 'active' : ''} onClick={() => setInvertY(!invertY)}>{t('INVERT Y')}</button></div>
        {!minigameOpen && <button className="guide-open-button" onClick={() => openGuide(true)}>{t('HOW TO PLAY')}</button>}
        {sessionStarted && (!minigameOpen || minigameKind === 'farm') && <button className="cookbook-open" onClick={() => openCookbook(true)}>{t('RECIPES')}</button>}
        <div className="control-strip"><kbd>Q</kbd><span>{t('LOCK')}</span><kbd>E</kbd><span>{t('PACK')}</span><kbd>TAB</kbd><span>{t('PLAYERS')}</span></div>
      </section>
    </div>
  )
}

function NormalCookbookPanel() {
  const { t, item: localizedItem } = useLocale()
  const open = useGameStore((state) => state.cookbookOpen)
  const close = useGameStore((state) => state.setCookbookOpen)
  const known = useGameStore((state) => state.knownRecipes)
  const cards = useGameStore((state) => state.recipeCards)
  const inventory = useGameStore((state) => state.inventory)
  const furnaceCount = inventory.furnace ?? 0
  const queue = useGameStore((state) => state.cookQueue)
  const activeFurnace = useGameStore((state) => state.activeFurnaceIndex)
  const cook = useGameStore((state) => state.cookRecipe)
  const collect = useGameStore((state) => state.collectCooked)
  const tutorialActive = useGameStore((state) => state.tutorialActive)
  const [now, setNow] = useState(Date.now())
  const [batches, setBatches] = useState<Partial<Record<RecipeId, number>>>({})
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [open])
  if (!open) return null
  const furnaceJobs = activeFurnace === null ? [] : queue.filter((job) => job.furnaceIndex === activeFurnace)
  const activeQueue = furnaceJobs.filter((job) => job.readyAt > now)
  const completed = furnaceJobs.filter((job) => job.readyAt <= now)
  const completedGroups = [...completed.reduce((groups, job) => {
    groups.set(job.recipe, (groups.get(job.recipe) ?? 0) + (job.quantity ?? 1))
    return groups
  }, new Map<RecipeId, number>())]
  const batchCapacity = Math.max(10, furnaceCount * 10)
  return <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}><section className="panel cookbook-panel">
    <header><div className="panel-title"><img className="cookbook-mark" src="/assets/ui/cooking/cookbook.png" alt="" /><span>{t('RECIPES')}</span></div><span className="cook-queue">{activeFurnace === null ? '—' : `${activeQueue.length}/3 · ×${batchCapacity}`}<HoverTip lines={[t('3 COOKING SLOTS'), `${batchCapacity} ${t('DISHES PER BATCH')}`]} /></span><CloseButton onClick={() => close(false)} /></header>
    {activeQueue.length > 0 && <div className="furnace-queue">{activeQueue.map((job) => <span key={job.id}><img src="/assets/ui/cooking/furnace-cooking.png" alt="" />{t(RECIPES[job.recipe].name)} ×{job.quantity ?? 1}<b>{t(`${Math.max(0, Math.ceil((job.readyAt - now) / 1000))}s`)}</b></span>)}</div>}
    {completedGroups.length > 0 && <section className="furnace-complete"><header><strong>{t('DONE')}</strong><button onClick={() => collect()}>{t('COLLECT ALL')}</button></header><div>{completedGroups.map(([recipeId, quantity]) => {
      const recipe = RECIPES[recipeId]
      return <button key={recipeId} onClick={() => collect(recipeId)}><img src={ITEMS[recipe.food].icon} alt="" /><span>{t(recipe.name)}</span><b>×{quantity}</b></button>
    })}</div></section>}
    {known.length === 0 && <div className="empty-ticket">{t('NO RECIPES YET')}</div>}
    <div className="recipe-grid">{known.map((id) => {
      const recipe = RECIPES[id]
      const learned = true
      const ingredients = Object.entries(recipe.ingredients) as Array<[ItemId, number]>
      const maxBatch = learned ? Math.max(0, Math.min(batchCapacity, ...ingredients.map(([item, quantity]) => Math.floor((inventory[item] ?? 0) / quantity)))) : 0
      const batch = Math.max(1, Math.min(maxBatch || 1, batches[id] ?? 1))
      const canCook = learned && activeFurnace !== null && maxBatch >= batch && activeQueue.length < 3
      return <article className={`recipe-card ${learned ? '' : 'unknown'}`} key={id}>
        <div><img src={ITEMS[recipe.food].icon} alt="" /><strong>{t(recipe.name)}</strong></div>
        {learned && <><div className="recipe-ingredients">{ingredients.map(([item, quantity]) => <span key={item} className={(inventory[item] ?? 0) >= quantity * batch ? '' : 'missing'}><img src={ITEMS[item].icon} alt={localizedItem(item)} />{quantity * batch}</span>)}</div><div className="cook-actions"><button aria-label={`Decrease ${recipe.name} batch`} onClick={() => setBatches((current) => ({ ...current, [id]: Math.max(1, batch - 1) }))}>−</button><b>×{batch}</b><button aria-label={`Increase ${recipe.name} batch`} onClick={() => setBatches((current) => ({ ...current, [id]: Math.min(batchCapacity, Math.max(1, maxBatch), batch + 1) }))}>+</button><button disabled={!canCook} onClick={() => cook(id as RecipeId, batch)}>{t('COOK')}</button></div><footer className="recipe-time-only"><span>{t(`${tutorialActive ? 3 : recipe.cookSeconds}s`)}</span></footer></>}
        {learned && (cards[id] ?? 0) > 1 && <em>×{cards[id]}</em>}
      </article>
    })}</div>
  </section></div>
}

function EventCookbookPanel() {
  const { t, item: localizedItem } = useLocale()
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
  const orders = farmRushOrders(milestone)
  const pendingCount = queue.filter((job) => job.readyAt > now).length
  return <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}><section className="panel cookbook-panel event-cookbook-panel">
    <header><div className="panel-title"><img className="cookbook-mark" src="/assets/ui/cooking/cookbook.png" alt="" /><span>{t('RECIPES')}</span></div><span className="cook-queue">{pendingCount}/3</span><CloseButton onClick={() => close(false)} /></header>
    {queue.length > 0 && <div className="furnace-queue">{queue.map((job) => {
      const order = farmRushRecipe(job.recipe)
      return <span key={`${job.orderIndex}-${job.readyAt}`}><img src="/assets/ui/cooking/furnace-cooking.png" alt="" />{t(order.name)}<b>{job.readyAt <= now ? t('READY') : t(`${Math.ceil((job.readyAt - now) / 1000)}s`)}</b></span>
    })}</div>}
    <div className="recipe-grid">{FARM_RUSH_RECIPE_IDS.map((id) => {
      const order = farmRushRecipe(id)
      const ingredients = Object.entries(order.ingredients) as Array<[FarmRushIngredient, number]>
      const matchingTicket = tickets.find((ticket) => ticket.expiresAt > now && orders[ticket.orderIndex % orders.length].recipe === id && !queue.some((job) => job.orderIndex === ticket.orderIndex))
      const hasIngredients = ingredients.every(([item, quantity]) => inventory[item] >= quantity)
      return <article className="recipe-card" key={id}>
        <div><img src={ITEMS[order.food].icon} alt="" /><strong>{t(order.name)}</strong><small>{t(`${order.points} PTS`)}</small></div>
        <div className="recipe-ingredients">{ingredients.map(([item, quantity]) => <span key={item} className={inventory[item] >= quantity ? '' : 'missing'}><img src={ITEMS[item].icon} alt={localizedItem(item as ItemId)} />{quantity}</span>)}</div>
        <div className="cook-actions"><button disabled={!matchingTicket || !hasIngredients || pendingCount >= 3} onClick={() => cook(id)}>{t('COOK')}</button></div>
        <footer><span>{t(`${order.cookSeconds}s`)}</span></footer>
      </article>
    })}</div>
  </section></div>
}

function CookbookPanel() {
  const eventMode = useGameStore((state) => state.minigameOpen && state.minigameKind === 'farm')
  return eventMode ? <EventCookbookPanel /> : <NormalCookbookPanel />
}

function Toast() {
  const { language } = useLocale()
  const toast = useGameStore((state) => state.toast)
  const setToast = useGameStore((state) => state.setToast)
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 1400)
    return () => window.clearTimeout(timer)
  }, [setToast, toast])
  return toast ? <div className="toast">{toastText(language, toast)}</div> : null
}

function MinigameResultCard() {
  const { t, item: localizedItem } = useLocale()
  const result = useGameStore((state) => state.lastMinigameResult)
  const clear = useGameStore((state) => state.clearMinigameResult)
  if (!result) return null
  const placement = result.placement === 1 ? '1ST' : result.placement === 2 ? '2ND' : result.placement === 3 ? '3RD' : `${result.placement}TH`
  const items = Object.entries(result.items).filter(([, quantity]) => Number(quantity) > 0) as Array<[MinigameRewardItemId, number]>
  return <section className="minigame-result-card" aria-label={t('RESULTS')}>
    <header><span>{t(placement)}</span><strong>{t(`${result.score} PTS`)}</strong><CloseButton onClick={clear} /></header>
    <div className="minigame-result-standings">{result.standings.map((standing) => <span className={standing.placement === result.placement && standing.score === result.score ? 'self' : ''} key={`${standing.placement}-${standing.nickname}`}><b>{standing.placement}</b><i data-no-localize>{standing.nickname}</i><strong>{standing.score}</strong></span>)}</div>
    <div>{result.cash > 0 && <b><Icon name="coin" />{formatCoins(result.cash, true)}</b>}{items.map(([id, quantity]) => <b className="result-item" key={id}><img src={ITEMS[id].icon} alt={localizedItem(id)} />×{quantity}<HoverTip lines={[localizedItem(id), ...(itemTooltip(id) ?? [])]} /></b>)}</div>
  </section>
}

function ResultsPanel() {
  const { t } = useLocale()
  const complete = useGameStore((state) => state.sessionComplete)
  const cash = useGameStore((state) => state.cash)
  const stats = useGameStore((state) => state.stats)
  const nickname = useGameStore((state) => state.nickname)
  const players = useGameStore((state) => state.onlinePlayers)
  const duration = useGameStore((state) => state.sessionDurationSeconds)
  const isHost = useGameStore((state) => state.isHost)
  const [selected, setSelected] = useState(0)
  if (!complete) return null
  const leaderboard = [{ id: 'self', nickname, cash, stats }, ...players].sort((a, b) => b.cash - a.cash)
  const focused = leaderboard[Math.min(selected, leaderboard.length - 1)]
  const restart = () => {
    if (isHost) sendMultiplayer('lobby:reset', {})
  }
  return <div className="modal-scrim results-scrim"><section className="panel results-panel"><header><div className="panel-title"><span className="results-mark">{duration / 60}</span><span>{t('FINAL LEDGER')}</span></div></header><div className="leaderboard-list">{leaderboard.map((player, index) => <button className={selected === index ? 'active' : ''} key={player.id} onClick={() => setSelected(index)}><b>{index + 1}</b><span data-no-localize>{player.nickname}</span><strong>{formatCoins(player.cash, true)}</strong></button>)}</div><strong className="final-cash"><Icon name="coin" />{formatCoins(focused.cash)}</strong><div className="result-stats"><span>{t('FORAGED')}<strong>{focused.stats.foraged}</strong></span><span>{t('MINED')}<strong>{focused.stats.mined}</strong></span><span>{t('HARVESTED')}<strong>{focused.stats.harvested}</strong></span><span>{t('SOLD')}<strong>{focused.stats.sold}</strong></span></div><button disabled={!isHost} onClick={restart}>{t(isHost ? 'NEW RUN' : 'WAITING FOR HOST')}</button></section></div>
}

function EnhancementPanel() {
  const { t, item: localizedItem } = useLocale()
  const open = useGameStore((state) => state.enhancementOpen)
  const close = useGameStore((state) => state.setEnhancementOpen)
  const inventory = useGameStore((state) => state.inventory)
  const enhancements = useGameStore((state) => state.enhancements)
  const cash = useGameStore((state) => state.cash)
  const enhance = useGameStore((state) => state.enhanceEquipment)
  const volumes = useGameStore((state) => state.audioVolumes)
  const owned = ENHANCEABLE_ITEMS.filter((item) => (inventory[item] ?? 0) > 0)
  const [selected, setSelected] = useState<EnhanceableItem>('worn-pickaxe')
  const [guardEnabled, setGuardEnabled] = useState(false)
  const [voucherEnabled, setVoucherEnabled] = useState(false)
  const [resultFx, setResultFx] = useState<{ id: number; success: boolean } | null>(null)
  useEffect(() => {
    if (open && !owned.includes(selected) && owned[0]) setSelected(owned[0])
  }, [open, owned, selected])
  if (!open || !owned.length) return null
  const current = enhancementLevel(enhancements, selected)
  const atMax = current >= 10
  const target = Math.min(10, current + 1)
  const ward = enhancementWardForTarget(target)
  const guardAvailable = Boolean(ward && (inventory[ward] ?? 0) > 0)
  const useGuard = guardAvailable && guardEnabled
  const voucherAvailable = !atMax && canUseEnhancementVoucher(target) && (inventory[ENHANCEMENT_VOUCHER] ?? 0) > 0
  const useVoucher = voucherAvailable && voucherEnabled
  const requirements = enhancementRequirements(selected, target, { voucher: useVoucher })
  const materialRows = (atMax ? [] : Object.entries(requirements.materials)) as Array<[ItemId, number]>
  const missingMaterials = materialRows.some(([id, quantity]) => (inventory[id] ?? 0) < quantity)
  const affordable = cash >= requirements.coins && !missingMaterials && current < 10
  const downgradeRisk = target >= 4 && !useGuard
  const isPickaxeItem = selected.endsWith('pickaxe')
  const isBasketItem = selected === 'basket' || selected === 'reinforced-basket' || selected === 'master-basket'
  const attempt = () => {
    if (!affordable) return
    const before = enhancementLevel(useGameStore.getState().enhancements, selected)
    enhance(selected, { ward: useGuard ? ward : undefined, voucher: useVoucher })
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
    : missingMaterials && cash < requirements.coins
      ? 'NEED ITEMS + COINS'
    : missingMaterials
      ? 'NEED MATERIALS'
      : cash < requirements.coins
      ? 'NEED COINS'
        : 'UPGRADE'
  const failureLabel = atMax || enhancementChance(target) >= 1
    ? null
    : useGuard || target <= 3
      ? `Failure keeps +${current}`
      : `Failure drops to +${Math.max(0, current - 1)}`
  return <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
    <section className="panel enhancement-panel">
      <header><div className="panel-title"><span className="enhancement-mark">+</span><span>UPGRADE</span></div><div className="shop-balance"><Icon name="coin" /><span>{formatCoins(cash, true)}</span></div><CloseButton onClick={() => close(false)} /></header>
      <div className="enhancement-layout">
        <aside className="enhancement-items" aria-label={t('Gear')}>
          {owned.map((item) => {
            const itemLevel = enhancementLevel(enhancements, item)
            return <button className={item === selected ? 'active' : ''} key={item} onClick={() => { setSelected(item); setGuardEnabled(false); setVoucherEnabled(false) }}>
              <img src={ITEMS[item].icon} alt="" />
              <span><strong>{localizedItem(item)}</strong><small>+{itemLevel}</small></span>
            </button>
          })}
        </aside>
        <section className={`enhancement-attempt ${resultFx ? resultFx.success ? 'upgrade-success' : 'upgrade-fail' : ''}`}>
          {resultFx && <span className={`enhancement-result-fx ${resultFx.success ? 'success' : 'fail'}`} aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</span>}
          <div className="enhancement-current">
            <span className="enhancement-current-icon"><img src={ITEMS[selected].icon} alt="" /></span>
            <span className="enhancement-current-name">{atMax && <small>{t('MAX LEVEL')}</small>}<strong>{localizedItem(selected)}</strong></span>
            {!atMax && <span className={`enhancement-chance ${resultFx ? `result ${resultFx.success ? 'success' : 'fail'}` : ''}`}><small>{t(resultFx ? 'RESULT' : 'SUCCESS RATE')}</small><b>{resultFx ? t(resultFx.success ? 'UPGRADED' : 'FAILED') : `${Math.round(enhancementChance(target) * 100)}%`}</b></span>}
          </div>
          <small className="enhancement-compare-title">{chanceLabel}</small>
          <div className={`enhancement-comparison ${atMax ? 'maxed' : ''}`}>
            <div className="enhancement-column current">
              <header><span>CURRENT</span><b>+{current}</b></header>
              <div className="enhancement-chances">{currentOutcomes.map((outcome, index) => <div key={index}><span>{index + 1}×</span><i style={{ '--chance': `${outcome.chance * 100}%` } as CSSProperties} /><b>{Math.round(outcome.chance * 100)}%</b></div>)}</div>
              {secondaryCurrent && <footer><span>{isPickaxeItem ? 'MINING SPEED' : 'STORAGE'}</span><b>{secondaryCurrent}</b></footer>}
            </div>
            {!atMax && <><span className="enhancement-compare-arrow">→</span><div className="enhancement-column target">
              <header><span>{t('AFTER UPGRADE')}</span><b>+{target}</b></header>
              <div className="enhancement-chances">{targetOutcomes.map((outcome, index) => <div key={index}><span>{index + 1}×</span><i style={{ '--chance': `${outcome.chance * 100}%` } as CSSProperties} /><b>{Math.round(outcome.chance * 100)}%</b></div>)}</div>
              {secondaryTarget && <footer><span>{isPickaxeItem ? 'MINING SPEED' : 'STORAGE'}</span><b>{secondaryTarget}</b></footer>}
            </div></>}
          </div>
          {!atMax && <div className="enhancement-payment">
            <div className="enhancement-materials">{materialRows.map(([id, quantity]) => {
              const held = inventory[id] ?? 0
              return <span className={held < quantity ? 'missing' : ''} key={id}><img src={ITEMS[id].icon} alt="" /><span><strong>{localizedItem(id)}</strong><small>{held}/{quantity}</small></span></span>
            })}</div>
            <div className={`enhancement-cost ${cash < requirements.coins ? 'missing' : ''}`}><Icon name="coin" /><span><small>COST</small><strong>{formatCoins(requirements.coins, true)}</strong></span></div>
          </div>}
          {!atMax && <div className="enhancement-consumables">
            {ward && <button disabled={!guardAvailable} className={useGuard ? 'active' : ''} onClick={() => setGuardEnabled((value) => !value)}><img src={ITEMS[ward].icon} alt="" /><span><strong>{t(`PROTECT +${target}`)}</strong><small>{useGuard ? `${t('ON')} · ${inventory[ward] ?? 0}` : t(`${inventory[ward] ?? 0} OWNED`)}</small></span></button>}
            {canUseEnhancementVoucher(target) && <button disabled={!voucherAvailable} className={useVoucher ? 'active' : ''} onClick={() => setVoucherEnabled((value) => !value)}><img src={ITEMS[ENHANCEMENT_VOUCHER].icon} alt="" /><span><strong>{t('30% OFF')}</strong><small>{useVoucher ? `${t('ON')} · ${inventory[ENHANCEMENT_VOUCHER] ?? 0}` : t(`${inventory[ENHANCEMENT_VOUCHER] ?? 0} OWNED`)}</small></span></button>}
          </div>}
          {failureLabel && <small className={`enhancement-fail ${downgradeRisk ? 'danger' : ''}`}>{failureLabel}</small>}
          <button className="enhance-button" disabled={!affordable} onClick={attempt}>{t(actionLabel)}</button>
        </section>
      </div>
    </section>
  </div>
}

function TravelPanel() {
  const { t, language } = useLocale()
  const open = useGameStore((state) => state.travelOpen)
  const close = useGameStore((state) => state.setTravelOpen)
  const setZone = useGameStore((state) => state.setZone)
  if (!open) return null
  const destinations = ['hub', 'forage', 'farm', 'mine'] as const
  return <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close(false)}><section className="panel travel-panel"><header><div className="panel-title"><span className="travel-mark">↟</span><span>{t('TRAVEL')}</span></div><CloseButton onClick={() => close(false)} /></header><div className="travel-grid">{destinations.map((id) => <button key={id} onClick={() => setZone(id)}>{zoneName(language, id)}</button>)}</div></section></div>
}

function ForageCapacity() {
  const { t, language } = useLocale()
  const zone = useGameStore((state) => state.zone)
  const inventory = useGameStore((state) => state.inventory)
  const enhancements = useGameStore((state) => state.enhancements)
  if (zone !== 'forage') return null
  const carrier = (inventory['master-basket'] ?? 0) > 0 ? 'master-basket' : (inventory['reinforced-basket'] ?? 0) > 0 ? 'reinforced-basket' : (inventory.basket ?? 0) > 0 ? 'basket' : 'hand'
  const capacity = carrier === 'hand' ? BASKET_CONFIG.hand.capacity : enhancedBasketCapacity(carrier, enhancementLevel(enhancements, carrier))
  const stored = (inventory.apple ?? 0) + (inventory.orange ?? 0)
  const carrierName = carrier === 'hand' ? t('Hand Gathering') : itemName(language, carrier, ITEMS[carrier].name)
  return <div className="forage-capacity" title={carrierName}><span>{t('FRUIT')}</span><i><b style={{ width: `${Math.min(100, stored / capacity * 100)}%` }} /></i><strong>{stored}/{capacity}</strong></div>
}

function ActiveEffects() {
  const miningUntil = useGameStore((state) => state.miningBoostUntil)
  const charges = useGameStore((state) => state.fortuneBoostCharges)
  const [, refresh] = useState(0)
  useEffect(() => {
    if (miningUntil <= Date.now()) return
    const timer = window.setInterval(() => refresh((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [miningUntil])
  const fortune = (Object.entries(charges) as Array<[EnhanceableItem, number]>).filter(([, count]) => count > 0)
  if (miningUntil <= Date.now() && !fortune.length) return null
  return <div className="active-effects">
    {miningUntil > Date.now() && <span><img src={ITEMS['mining-boost'].icon} alt="" /><b>{Math.ceil((miningUntil - Date.now()) / 1000)}s</b></span>}
    {fortune.map(([item, count]) => <span key={item}><img src={ITEMS['fortune-boost'].icon} alt="" /><b>{count}</b></span>)}
  </div>
}

function MinigameSettlementSync() {
  const connected = useGameStore((state) => state.lobbyConnected)
  const finish = useGameStore((state) => state.finishMinigame)
  useEffect(() => onMultiplayer('minigame:result', (raw) => {
    const result = raw as { milestone?: number; kind?: 'mining' | 'farm' | 'forage'; score?: number; placement?: number; economyReference?: number; cashReward?: number; settlementId?: string; itemRolls?: MinigameItemRewardRoll[]; standings?: MinigameStanding[] }
    if (!result.settlementId || !Number.isFinite(result.milestone) || !Number.isFinite(result.cashReward)) return
    finish(Number(result.score) || 0, Math.max(1, Number(result.placement) || 1), Number(result.economyReference) || undefined, { cash: Number(result.cashReward), itemRolls: result.itemRolls ?? [], settlementId: result.settlementId, milestone: Number(result.milestone), kind: result.kind, standings: result.standings })
  }), [finish])
  useEffect(() => {
    if (connected) sendMultiplayer('minigame:result:request', {})
  }, [connected])
  return null
}

function MinigameWorldHud() {
  const { t, item: localizedItem } = useLocale()
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
  const forageProgress = useGameStore((state) => state.forageRushProgress)
  const forageDelivered = useGameStore((state) => state.forageRushDelivered)
  const tickFarmRush = useGameStore((state) => state.tickFarmRush)
  const syncForageRush = useGameStore((state) => state.syncForageRush)
  const syncForageRushRares = useGameStore((state) => state.syncForageRushRares)
  const awardForageRush = useGameStore((state) => state.awardForageRush)
  const finish = useGameStore((state) => state.finishMinigame)
  const active = useGameStore((state) => state.minigameActive)
  const sceneReady = useGameStore((state) => state.sceneReady)
  const setActive = useGameStore((state) => state.setMinigameActive)
  const nickname = useGameStore((state) => state.nickname)
  const selfId = useGameStore((state) => state.sharedFarmSelfId)
  const players = useGameStore((state) => state.onlinePlayers)
  const lobbyPlayerCount = useGameStore((state) => state.lobbyPlayerCount)
  const [warning, setWarning] = useState(5)
  const [started, setStarted] = useState(false)
  const [ready, setReady] = useState(false)
  const [readyCount, setReadyCount] = useState(0)
  const [readyTotal, setReadyTotal] = useState(1)
  const [seconds, setSeconds] = useState(MINIGAME_DURATION.mining)
  const [, refresh] = useState(0)
  const [waiting, setWaiting] = useState(false)
  const submitted = useRef(false)
  const score = kind === 'mining' ? miningScore : kind === 'farm' ? farmScore : forageScore
  const title = t(kind === 'mining' ? 'MINING RUSH' : kind === 'farm' ? 'KITCHEN RUSH' : 'FORAGE RACE')
  const forageComplete = Object.values(forageDelivered).every(Boolean)
  const standings = [
    { id: 'self', nickname, score },
    ...players.filter((player) => player.minigameOpen && player.minigameKind === kind && player.minigameMilestone === milestone).map((player) => ({ id: player.id, nickname: player.nickname, score: player.minigameScore ?? 0 })),
  ].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname)).slice(0, 5)
  useEffect(() => {
    if (!open) return
    setActive(false); setStarted(false); setReady(false); setReadyCount(0); setReadyTotal(1)
    setWarning(5); setSeconds(MINIGAME_DURATION[kind]); setWaiting(false); submitted.current = false
  }, [kind, milestone, open, setActive])
  useEffect(() => {
    if (!open) return
    const begin = (raw: unknown) => {
      const message = raw as { milestone?: number; kind?: string; gameplayAt?: number }
      if (Number(message.milestone) !== milestone || message.kind !== kind || !Number.isFinite(message.gameplayAt)) return
      setStarted(true)
      setWarning(Math.max(0, Math.ceil((Number(message.gameplayAt) - Date.now()) / 1000)))
    }
    const offState = onMultiplayer('minigame:ready-state', (raw) => {
      const message = raw as { milestone?: number; kind?: string; ready?: number; total?: number }
      if (Number(message.milestone) !== milestone || message.kind !== kind) return
      setReadyCount(Math.max(0, Number(message.ready) || 0)); setReadyTotal(Math.max(1, Number(message.total) || 1))
    })
    const offStart = onMultiplayer('minigame:start', begin)
    return () => { offState(); offStart() }
  }, [kind, milestone, open])
  useEffect(() => {
    if (!open || !started || warning <= 0) return
    const warningTimer = window.setInterval(() => setWarning((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(warningTimer)
  }, [open, started, warning])
  useEffect(() => { if (open && started && warning === 0) setActive(true) }, [open, setActive, started, warning])
  useEffect(() => {
    if (!open || !active || warning > 0 || waiting) return
    const timer = window.setInterval(() => { setSeconds((value) => Math.max(0, value - 1)); refresh((value) => value + 1); if (kind === 'farm') tickFarmRush() }, 1000)
    return () => window.clearInterval(timer)
  }, [active, kind, open, tickFarmRush, waiting, warning])
  useEffect(() => {
    if (!open || kind !== 'forage') return
    const offState = onMultiplayer('minigame:forage', (raw) => {
      const message = raw as { id?: string; readyAt?: number }
      if (message.id?.startsWith('ForageRush') && Number.isFinite(message.readyAt)) syncForageRush(message.id, Number(message.readyAt))
    })
    const offAward = onMultiplayer('minigame:forage-award', (raw) => {
      const message = raw as { id?: string; readyAt?: number }
      if (message.id?.startsWith('ForageRush') && Number.isFinite(message.readyAt)) awardForageRush(message.id, Number(message.readyAt))
    })
    const offRares = onMultiplayer('minigame:forage-rares', (raw) => {
      const message = raw as { milestone?: number; ids?: string[] }
      if (Number(message.milestone) === milestone && Array.isArray(message.ids)) syncForageRushRares(message.ids)
    })
    const offEnding = onMultiplayer('minigame:ending', (raw) => {
      const message = raw as { milestone?: number; kind?: string }
      if (Number(message.milestone) === milestone && message.kind === 'forage') setSeconds(0)
    })
    sendMultiplayer('minigame:forage-rares:request', { milestone })
    return () => { offState(); offAward(); offRares(); offEnding() }
  }, [awardForageRush, kind, milestone, open, syncForageRush, syncForageRushRares])
  useEffect(() => {
    if (!open || !active || (seconds > 0 && !(kind === 'forage' && forageComplete)) || submitted.current) return
    submitted.current = true; setWaiting(true)
    const state = useGameStore.getState()
    const progressValue = economyProgressValue(state)
    const eventScore = kind === 'mining' ? state.rushScore : kind === 'farm' ? state.farmRushScore : state.forageRushScore + (forageComplete ? FORAGE_RUSH_COMPLETION_BONUS + seconds * 10 : 0)
    const submittedOnline = sendMultiplayer('minigame:finish', { milestone, score: eventScore, progressValue })
    if (!submittedOnline) { finish(eventScore, 1, progressValue); return }
  }, [active, finish, forageComplete, kind, milestone, open, seconds])
  if (!open) return null
  const orderDefinitions = farmRushOrders(milestone)
  const currentState = useGameStore.getState()
  const selfProgress = economyProgressValue(currentState)
  const lobbyProgress = [selfProgress, ...players.filter((player) => player.minigameOpen && player.minigameMilestone === milestone).map((player) => player.progressValue ?? player.cash)].sort((a, b) => a - b)
  const progressMiddle = Math.floor(lobbyProgress.length / 2)
  const estimatedReference = lobbyProgress.length % 2 ? lobbyProgress[progressMiddle] : Math.round((lobbyProgress[progressMiddle - 1] + lobbyProgress[progressMiddle]) / 2)
  const leaderProgress = Math.max(selfProgress, ...players.map((player) => player.progressValue ?? player.cash))
  const participantCount = Math.max(1, Math.min(6, lobbyPlayerCount))
  const prizeRows = Array.from({ length: participantCount }, (_, index) => `${index + 1}${index === 0 ? 'ST' : index === 1 ? 'ND' : index === 2 ? 'RD' : 'TH'}`).map((place, index) => {
    const placement = index + 1
    const itemRolls = minigameItemRewards({ economyReference: estimatedReference, placement, matchSeed: currentState.sessionSeed, milestone, playerId: selfId ?? nickname })
    const itemCounts = new Map<MinigameRewardItemId, number>()
    itemRolls.forEach((roll) => roll.items.forEach(({ itemId, quantity }) => itemCounts.set(itemId, (itemCounts.get(itemId) ?? 0) + quantity)))
    return { place: t(place), ...minigameRewardPackage(estimatedReference, placement, selfProgress, leaderProgress), items: [...itemCounts] }
  })
  const markReady = () => {
    if (ready || !sceneReady) return
    setReady(true)
    const sent = sendMultiplayer('minigame:ready', { milestone, kind })
    const visualGate = new URLSearchParams(window.location.search).has('gate')
    if (!sent || visualGate) {
      setReadyCount(1); setReadyTotal(1); setStarted(true); setWarning(5)
    }
  }
  return <>
    {!started && <div className="event-ready"><strong>{title}</strong><div className="event-ready-prizes"><small>{t('PRIZES')}</small>{prizeRows.map((prize) => <span key={prize.place}><b>{prize.place}</b><span className="event-ready-prize-value"><em><Icon name="coin" />{formatCoins(prize.cash, true)}</em><i>{prize.items.map(([id, quantity]) => <span className="event-ready-prize-item" key={id} tabIndex={0}><img src={ITEMS[id].icon} alt={localizedItem(id)} />{quantity > 1 && <small>×{quantity}</small>}<HoverTip lines={[localizedItem(id), ...(itemTooltip(id) ?? [])]} /></span>)}</i></span></span>)}</div><button className={ready ? 'ready' : ''} disabled={!sceneReady || ready} onClick={markReady}>{t(!sceneReady ? 'LOADING' : ready ? 'WAITING' : 'READY')}</button><span>{readyCount}/{readyTotal}</span></div>}
    {started && warning > 0 && warning <= 5 && <div className="rush-countdown"><strong>{warning}</strong><span>{title}</span></div>}
    {active && <div className="event-standings"><span>{t('LEADERBOARD')}</span>{standings.map((player, index) => <div className={player.id === 'self' ? 'self' : ''} key={player.id}><b>{index + 1}</b><span data-no-localize>{player.nickname}</span><strong>{player.score}</strong></div>)}</div>}
    {kind === 'mining' && active && <div className="mining-points">{(Object.keys(MINING_RUSH_POINTS) as MiningRushOre[]).map((ore) => <span key={ore}><img src={ITEMS[ore].icon} alt="" /><b>{MINING_RUSH_POINTS[ore]}</b></span>)}</div>}
    {kind === 'farm' && active && <div className="event-orders">{activeOrders.map((ticket) => {
      const order = orderDefinitions[ticket.orderIndex % orderDefinitions.length]
      const remaining = Math.max(0, ticket.expiresAt - Date.now())
      const ingredients = Object.entries(order.ingredients) as Array<[FarmRushIngredient, number]>
      const cookingJob = cooking.find((job) => job.orderIndex === ticket.orderIndex && job.readyAt > Date.now())
      const ready = cooking.some((job) => job.recipe === order.recipe && job.readyAt <= Date.now())
      const timeBonus = 1 + .5 * Math.min(1, remaining / FARM_RUSH_ORDER_LIFETIME_MS)
      const state = ready ? 'ready' : cookingJob ? 'cooking' : ''
      return <div className={state} key={ticket.orderIndex}><header><div className="event-order-food"><img src={ITEMS[order.food].icon} alt={localizedItem(order.food)} /><strong>{localizedItem(order.food)}</strong></div><b>{Math.ceil(remaining / 1000)}</b></header><div className="event-order-ingredients">{ingredients.map(([crop, quantity]) => <span className={farmInventory[crop] >= quantity ? 'owned' : ''} key={crop}><img src={ITEMS[crop as ItemId].icon} alt={localizedItem(crop as ItemId)} /><b>{quantity}</b></span>)}</div><i><b style={{ width: `${remaining / FARM_RUSH_ORDER_LIFETIME_MS * 100}%` }} /></i><footer><small>{t(`${Math.round(order.points * timeBonus)} PTS`)}</small>{ready && <button onClick={() => submitOrder(ticket.orderIndex)}>{t('SUBMIT')}</button>}{cookingJob && !ready && <small>{t(`${Math.max(1, Math.ceil((cookingJob.readyAt - Date.now()) / 1000))}s`)}</small>}</footer></div>
    })}</div>}
    {kind === 'forage' && active && <div className="event-deliveries">{(['apple', 'orange', 'truffle', 'discovery'] as ForageRushKind[]).map((id) => <div className={forageDelivered[id] ? 'complete' : ''} key={id}><img src={id === 'discovery' ? ITEMS['natural-discovery'].icon : ITEMS[id].icon} alt="" /><strong>{forageDelivered[id] ? '✓' : `${forageProgress[id]}/${FORAGE_RUSH_REQUIREMENTS[id]}`}</strong></div>)}</div>}
    {started && <div className="rush-world-hud"><span>{title}{kind === 'farm' ? ` · ${t('PLOT')} ${eventBay + 1}` : ''}</span><strong>{score}</strong><small>{t('SCORE')}</small><b>{waiting ? t('RESULTS') : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</b>{kind === 'mining' && <img src={ITEMS['crystal-pickaxe'].icon} alt={localizedItem('crystal-pickaxe')} />}{kind === 'mining' && combo > 1 && <em>×{combo}</em>}</div>}
  </>
}

function EventUtilityDock() {
  const cash = useGameStore((state) => state.cash)
  const setMenuOpen = useGameStore((state) => state.setMenuOpen)
  const setPlayerPanelOpen = useGameStore((state) => state.setPlayerPanelOpen)
  const pendingTradeRequest = useGameStore((state) => state.pendingTradeRequest)
  const { t } = useLocale()
  return <div className="event-utility-dock"><div className="hud-chip event-cash" title={formatCoins(cash)}><Icon name="coin" /><span>{formatCoins(cash, true)}</span></div><button className={`hud-chip icon-button ${pendingTradeRequest ? 'has-alert' : ''}`} onClick={() => setPlayerPanelOpen(true)} aria-label={t('Players')}><Icon name="users" />{pendingTradeRequest && <i className="notification-dot" />}</button><button className="hud-chip icon-button" onClick={() => setMenuOpen(true)} aria-label={t('Menu')}><Icon name="menu" /></button></div>
}

function Interface() {
  const sessionStarted = useGameStore((state) => state.sessionStarted)
  const tutorialActive = useGameStore((state) => state.tutorialActive)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameActive = useGameStore((state) => state.minigameActive)
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
  const setGuideOpen = useGameStore((state) => state.setGuideOpen)
  const setSelected = useGameStore((state) => state.setSelectedHotbar)
  const setZone = useGameStore((state) => state.setZone)
  const setToast = useGameStore((state) => state.setToast)
  const setProgress = useGameStore((state) => state.setInteractionProgress)
  const miningTarget = useRef<string | null>(null)
  const miningStartedAt = useRef(0)
  const miningFrame = useRef<number | null>(null)
  const miningStrike = useRef(0)
  useEffect(() => {
    const resetMining = () => {
      if (miningFrame.current !== null) cancelAnimationFrame(miningFrame.current)
      miningFrame.current = null
      miningTarget.current = null
      miningStrike.current = 0
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
      const duration = rush ? 760 : miningDuration(held, ore, heldEnhancement) * (state.miningBoostUntil > Date.now() ? .88 : 1)
      miningTarget.current = id
      miningStartedAt.current = performance.now()
      miningStrike.current = 0
      const tick = (now: number) => {
        const live = useGameStore.getState()
        if (live.prompt?.id !== id || (!rush && live.hotbar[live.selectedHotbar] !== held)) return resetMining()
        const nextProgress = Math.min(1, (now - miningStartedAt.current) / duration)
        const nextStrike = Math.floor(nextProgress * 3)
        if (nextStrike > miningStrike.current && nextProgress < .97) {
          miningStrike.current = nextStrike
          playGameSfx('mine-start', live.audioVolumes.master * live.audioVolumes.effects * .7)
        }
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
      const ui = useGameStore.getState()
      if (ui.guideOpen) {
        if (event.code === 'Escape' && ui.guideComplete) setGuideOpen(false)
        return
      }
      if (!ui.sessionStarted && !ui.tutorialActive && event.code !== 'Escape') return
      if (event.code === 'KeyE' && !event.repeat) toggleInventory()
      if (/^Digit[1-9]$/.test(event.code) && !event.repeat) {
        const index = Number(event.code.slice(-1)) - 1
        const live = useGameStore.getState()
        if (live.minigameOpen) {
          if (live.minigameKind === 'farm' && FARM_RUSH_TOOLS[index]) live.setFarmRushTool(FARM_RUSH_TOOLS[index])
        } else setSelected(index)
      }
      if (event.code === 'KeyF' && !event.repeat) {
        const live = useGameStore.getState()
        if (live.minigameOpen && !live.minigameActive) return
        const prompt = live.prompt
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
        if (useGameStore.getState().guideComplete) setGuideOpen(false)
        if (useGameStore.getState().inventoryOpen) toggleInventory()
      }
    }
    const useItem = (event: PointerEvent) => {
      const canvasFocused = event.target instanceof HTMLCanvasElement || document.pointerLockElement instanceof HTMLCanvasElement
      if (!canvasFocused) return
      const state = useGameStore.getState()
      if (state.minigameOpen) {
        if (!state.minigameActive) return
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
  }, [setCookbookOpen, setEnhancementOpen, setGuideOpen, setLotteryOpen, setMenuOpen, setPlayerPanelOpen, setProgress, setSecretOpen, setSelected, setShopOpen, setStockOpen, setTicketInspectOpen, setToast, setTravelOpen, setZone, toggleInventory])
  if (!sessionStarted && !tutorialActive) return <div className="interface"><LobbyPanel /><GameChat /><PlayerTradePanel /><MenuPanel /><OnboardingPanelV2 /><Toast /></div>
  if (minigameOpen) return <div className="interface">{minigameActive && <><Crosshair /><InteractionPrompt /></>}<MinigameWorldHud /><EventUtilityDock /><Hotbar /><InventoryPanel /><GameChat /><PlayerTradePanel /><MenuPanel /><CookbookPanel /><Toast /></div>
  return <div className="interface"><HUD /><Crosshair /><InteractionPrompt /><ForageCapacity /><ActiveEffects /><Hotbar /><InventoryPanel /><ItemUsePanel /><ShopPanel /><LotteryPanel /><TicketInspectPanel /><NoteInspectPanel /><TravelPanel /><SecretDealPanel /><StocksPanel /><GameChat /><PlayerTradePanel /><MenuPanel /><CookbookPanel /><EnhancementPanel /><ResultsPanel /><MinigameResultCard /><OnboardingPanelV2 /><Toast /></div>
}

export function App() {
  const language = useGameStore((state) => state.language)
  useEffect(() => {
    document.documentElement.lang = language
    const root = document.querySelector('.game-shell')
    if (!root) return
    localizeDom(root, language)
    if (language !== 'ko') return
    const observer = new MutationObserver((records) => {
      const targets = new Set<ParentNode>()
      records.forEach((record) => {
        if (record.type === 'characterData') {
          if (record.target.parentElement) targets.add(record.target.parentElement)
          return
        }
        if (record.target instanceof Element) targets.add(record.target)
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) targets.add(node)
          else if (node.parentElement) targets.add(node.parentElement)
        })
      })
      targets.forEach((target) => localizeDom(target, language))
    })
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'alt'] })
    return () => observer.disconnect()
  }, [language])
  return <main className="game-shell" onContextMenu={(event) => event.preventDefault()}><GameWorld /><Interface /><AudioBed /><FeedbackBed /><MinigameSettlementSync /><MineSync /><ForageSync /><FarmSync /><DeedSync /><MerchantSync /><MarketSync /></main>
}
