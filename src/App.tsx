import { useEffect, useRef, useState } from 'react'
import { GameWorld } from './game/World'
import { ITEMS, SHOPS, STOCKS, itemTooltip, type ItemId, type ShopKind, type StockId } from './game/items'
import { commodityPrice, formatCoins, lotteryJackpot, lotteryPrice, lotteryTwoMatch, sessionSecondsRemaining } from './game/economy'
import { BASKET_CONFIG, COMMODITY_MARKET_CONFIG, CROP_CONFIG, MATCH_CONFIG, PICKAXE_CONFIG, type CommodityId } from './game/config'
import { canMineOre, miningDuration, oreKindAtDepth, requiredPickaxe } from './game/ore'
import { onMultiplayer, sendMultiplayer } from './game/multiplayer'
import { lotteryDraw, preparedFoodValue, secretStockOffer, useGameStore } from './game/store'
import { RECIPES, RECIPE_IDS, type RecipeId } from './game/recipes'
import { FARM_RUSH_CROPS, FORAGE_RUSH_REQUIREMENTS, MINIGAME_DURATION, farmRushOrders, miningRushOre, type FarmRushTool, type ForageRushKind } from './game/minigame'

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
  if (id.startsWith('FarmRushCooker')) return state.farmRushCook()
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
    if (point) return state.mineNode(id, oreKindAtDepth(id, point[2], state.minedNodes[id] ?? 0))
  }
}

function AudioBed() {
  const zone = useGameStore((state) => state.zone)
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
    const tracks = playlists[zone]
    playlistIndex.current = 0
    music.loop = false
    const playTrack = () => {
      music.src = tracks[playlistIndex.current]
      if (zone === 'forage' && playlistIndex.current === 0) music.addEventListener('loadedmetadata', () => { music.currentTime = Math.min(96, music.duration * 0.3) }, { once: true })
      if (unlocked.current) void music.play().catch(() => undefined)
    }
    const nextTrack = () => {
      playlistIndex.current = (playlistIndex.current + 1) % tracks.length
      playTrack()
    }
    const ambienceSource = zone === 'mine' ? '/assets/audio/Cave_Water_Drips_CC-BY-SA.ogg' : zone === 'hub' ? '/assets/audio/Forest_Ambience_PD.ogg' : '/assets/audio/Forest_Ambience_PD.mp3'
    music.addEventListener('ended', nextTrack)
    playTrack()
    if (!ambience.src.endsWith(ambienceSource)) ambience.src = ambienceSource
    if (unlocked.current) {
      void music.play().catch(() => undefined)
      void ambience.play().catch(() => undefined)
    }
    return () => music.removeEventListener('ended', nextTrack)
  }, [zone])
  return null
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
  const remaining = sessionSecondsRemaining(roundNumber, round)
  const roundMinutes = Math.floor(remaining / 60).toString().padStart(2, '0')
  const roundSeconds = (remaining % 60).toString().padStart(2, '0')
  const locations = { hub: 'LANTERN HOLLOW', forage: 'MOSSWOOD', farm: 'SUNMEADOW', mine: 'STONEWAKE' }
  return (
    <>
      <div className="location-chip"><span className="location-dot" />{locations[zone]}</div>
      <div className="hud-modules">
        {marketCorrectionName && marketCorrectionSeconds > 0 && <div className="market-news"><span>MARKET NEWS</span><strong>{marketCorrectionName}</strong></div>}
        {weather !== 'clear' && zone !== 'mine' && <div className="hud-chip weather"><span className="rain-mark">◆</span><span>{weather.toUpperCase()}</span><HoverTip lines={weather === 'rain' ? ['Crops water automatically.', `${weatherSeconds}s remaining`] : weather === 'sunny' ? ['Crops and fruit grow 15% faster.', `${weatherSeconds}s remaining`] : weather === 'breeze' ? ['Cooking finishes 10% faster.', `${weatherSeconds}s remaining`] : ['Soft visibility change.', `${weatherSeconds}s remaining`]} /></div>}
        <div className="hud-chip" title="Match time"><Icon name="clock" /><span>{roundMinutes}:{roundSeconds}</span></div>
        <div className="hud-chip restock"><Icon name="refresh" /><span>{minutes}:{seconds}</span></div>
        <div className="hud-chip" title={formatCoins(cash)}><Icon name="coin" /><span>{formatCoins(cash, true)}</span></div>
        <button className="hud-chip icon-button" onClick={() => setPlayerPanelOpen(true)} aria-label="Players"><Icon name="users" /></button>
        <button className="hud-chip icon-button" onClick={() => setMenuOpen(true)} aria-label="Menu"><Icon name="menu" /></button>
      </div>
    </>
  )
}

function Hotbar() {
  const hotbar = useGameStore((state) => state.hotbar)
  const inventory = useGameStore((state) => state.inventory)
  const selected = useGameStore((state) => state.selectedHotbar)
  const setSelected = useGameStore((state) => state.setSelectedHotbar)
  const setSlot = useGameStore((state) => state.setHotbarSlot)
  const swapSlots = useGameStore((state) => state.swapHotbarSlots)
  const inspectTickets = useGameStore((state) => state.setTicketInspectOpen)
  const inspectNotes = useGameStore((state) => state.setNoteInspectOpen)
  const setTravelOpen = useGameStore((state) => state.setTravelOpen)
  const useCookbookBox = useGameStore((state) => state.useCookbookBox)
  return (
    <div className="hotbar" aria-label="Hotbar">
      {hotbar.map((storedItem, index) => {
        const item = storedItem && (inventory[storedItem] ?? 0) > 0 ? storedItem : null
        return <button
          className={`hotbar-slot ${index === selected ? 'selected' : ''}`}
          key={index}
          onClick={() => setSelected(index)}
          onDoubleClick={() => setSlot(index, null)}
          onContextMenu={(event) => {
            event.preventDefault()
            if (item === 'lottery-ticket') inspectTickets(true)
            if (item === 'information-note') inspectNotes(true)
            if (item === 'home-charm') setTravelOpen(true)
            if (item === 'cookbook-box') useCookbookBox()
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            const sourceSlot = event.dataTransfer.getData('hotbar-slot')
            const droppedItem = event.dataTransfer.getData('item-id') as ItemId
            if (sourceSlot) swapSlots(Number(sourceSlot), index)
            else if (droppedItem) setSlot(index, droppedItem)
          }}
          draggable={Boolean(item)}
          onDragStart={(event) => { event.dataTransfer.setData('hotbar-slot', String(index)) }}
          aria-label={item ? `${index + 1}: ${ITEMS[item].name}` : `Slot ${index + 1}`}
        >
          {item && <img src={ITEMS[item].icon} alt={ITEMS[item].name} />}
          {item && (inventory[item] ?? 0) > 1 && <span className="quantity">{inventory[item]}</span>}
          {item && <HoverTip lines={itemTooltip(item)} />}
        </button>
      })}
    </div>
  )
}

const FARM_RUSH_TOOLS: FarmRushTool[] = [...FARM_RUSH_CROPS, 'water']
function FarmRushHotbar() {
  const tool = useGameStore((state) => state.farmRushTool)
  const setTool = useGameStore((state) => state.setFarmRushTool)
  return <div className="hotbar rush-hotbar" aria-label="Event tools">{FARM_RUSH_TOOLS.map((id) => {
    const itemId = id === 'water' ? 'water-can' : `${id}-seeds` as ItemId
    return <button key={id} className={`hotbar-slot ${tool === id ? 'selected' : ''}`} onClick={() => setTool(id)} aria-label={id === 'water' ? 'Watering Can' : ITEMS[itemId].name}>
      <img src={ITEMS[itemId].icon} alt="" />
      {id !== 'water' && <span className="quantity">∞</span>}
    </button>
  })}</div>
}

function MinigameHotbar() {
  const kind = useGameStore((state) => state.minigameKind)
  const forageInventory = useGameStore((state) => state.forageRushInventory)
  if (kind === 'farm') return <FarmRushHotbar />
  const slots: { id: ItemId; quantity?: number; label: string }[] = kind === 'mining'
    ? [{ id: 'crystal-pickaxe', label: 'Event pickaxe' }]
    : [
        { id: 'apple', quantity: forageInventory.apple, label: 'Apples' },
        { id: 'orange', quantity: forageInventory.orange, label: 'Oranges' },
        { id: 'truffle', quantity: forageInventory.truffle, label: 'Truffles' },
        { id: 'natural-discovery', quantity: forageInventory.discovery, label: 'Discoveries' },
      ]
  return <div className={`hotbar rush-hotbar rush-hotbar-${kind}`} aria-label="Event bag">
    {slots.map(({ id, quantity, label }, index) => <div className={`hotbar-slot ${index === 0 ? 'selected' : ''}`} key={id} aria-label={label}>
      <img src={ITEMS[id].icon} alt="" />
      {quantity !== undefined && quantity > 0 && <span className="quantity">{quantity}</span>}
      <HoverTip lines={[ITEMS[id].name]} />
    </div>)}
  </div>
}

function InteractionPrompt() {
  const prompt = useGameStore((state) => state.prompt)
  const progress = useGameStore((state) => state.interactionProgress)
  const anchors = useGameStore((state) => state.anchors)
  const minedNodes = useGameStore((state) => state.minedNodes)
  const rushNodes = useGameStore((state) => state.rushNodes)
  const minigameMilestone = useGameStore((state) => state.minigameMilestone)
  const hotbar = useGameStore((state) => state.hotbar)
  const selectedHotbar = useGameStore((state) => state.selectedHotbar)
  const farmRushCells = useGameStore((state) => state.farmRushCells)
  const farmRushTool = useGameStore((state) => state.farmRushTool)
  const farmRushCooking = useGameStore((state) => state.farmRushCooking)
  if (!prompt) return null
  if (prompt.id.startsWith('MineOre') || prompt.id.startsWith('RushOre')) {
    const point = anchors[prompt.id]
    if (!point) return null
    const rush = prompt.id.startsWith('RushOre')
    const ore = rush ? miningRushOre(minigameMilestone, prompt.id, rushNodes[prompt.id]?.generation ?? 0) : oreKindAtDepth(prompt.id, point[2], minedNodes[prompt.id] ?? 0)
    const tool = hotbar[selectedHotbar]
    const duration = rush ? 760 : miningDuration(tool, ore)
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
  if (prompt.id.startsWith('FarmRushCooker')) return <div className="interaction"><kbd>F</kbd><span>{farmRushCooking ? farmRushCooking.readyAt <= Date.now() ? 'Serve' : `${Math.ceil((farmRushCooking.readyAt - Date.now()) / 1000)}s` : 'Cook'}</span></div>
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
  const inventory = useGameStore((state) => state.inventory)
  const inventoryOrder = useGameStore((state) => state.inventoryOrder)
  const hotbar = useGameStore((state) => state.hotbar)
  const moveInventorySlot = useGameStore((state) => state.moveInventorySlot)
  const equipItem = useGameStore((state) => state.equipItem)
  const inspectTickets = useGameStore((state) => state.setTicketInspectOpen)
  const inspectNotes = useGameStore((state) => state.setNoteInspectOpen)
  const setTravelOpen = useGameStore((state) => state.setTravelOpen)
  const useCookbookBox = useGameStore((state) => state.useCookbookBox)
  const dragging = useRef<number | null>(null)
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
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => { if (dragging.current !== null) moveInventorySlot(dragging.current, index); dragging.current = null }}
            >{id && quantity > 0 && <><img draggable src={ITEMS[id].icon} alt={ITEMS[id].name} onClick={() => id === 'lottery-ticket' ? inspectTickets(true) : id === 'information-note' ? inspectNotes(true) : id === 'cookbook-box' ? useCookbookBox() : equipItem(id)} onContextMenu={(event) => { event.preventDefault(); if (id === 'lottery-ticket') inspectTickets(true); if (id === 'information-note') inspectNotes(true); if (id === 'home-charm') setTravelOpen(true); if (id === 'cookbook-box') useCookbookBox() }} onDragStart={(event) => { dragging.current = index; event.dataTransfer.setData('item-id', id) }} onDragEnd={() => { dragging.current = null }} /><span>{quantity}</span><HoverTip lines={itemTooltip(id)} /></>}</div>
          })}
        </div>
      </section>
    </div>
  )
}

function MinigameBag() {
  const open = useGameStore((state) => state.inventoryOpen)
  const toggle = useGameStore((state) => state.toggleInventory)
  const kind = useGameStore((state) => state.minigameKind)
  const inventory = useGameStore((state) => state.inventory)
  const inventoryOrder = useGameStore((state) => state.inventoryOrder)
  const hotbar = useGameStore((state) => state.hotbar)
  const forageInventory = useGameStore((state) => state.forageRushInventory)
  const eventItems: { id: ItemId; quantity?: number; unlimited?: boolean }[] = kind === 'mining'
    ? [{ id: 'crystal-pickaxe' }]
    : kind === 'farm'
      ? [...FARM_RUSH_CROPS.map((crop) => ({ id: `${crop}-seeds` as ItemId, unlimited: true })), { id: 'water-can' }]
      : [
          { id: 'apple', quantity: forageInventory.apple },
          { id: 'orange', quantity: forageInventory.orange },
          { id: 'truffle', quantity: forageInventory.truffle },
          { id: 'natural-discovery', quantity: forageInventory.discovery },
        ]
  if (!open) return null
  return <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && toggle()}>
    <section className="panel minigame-bag">
      <header><div className="panel-title"><Icon name="pack" /><span>BAG</span></div><CloseButton onClick={toggle} /></header>
      <div className="minigame-bag-layout">
        <section className="minigame-bag-section event-bag-section">
          <small>EVENT</small>
          <div className="event-bag-grid">
            {eventItems.map(({ id, quantity, unlimited }) => <div className="inventory-slot" key={id}>
              <img src={ITEMS[id].icon} alt={ITEMS[id].name} />
              {unlimited ? <span>∞</span> : quantity !== undefined && quantity > 0 ? <span>{quantity}</span> : null}
              <HoverTip lines={[ITEMS[id].name]} />
            </div>)}
          </div>
        </section>
        <section className="minigame-bag-section saved-bag-section">
          <small>SAVED</small>
          <div className="inventory-grid minigame-saved-grid" aria-label="Saved inventory">
            {Array.from({ length: 36 }, (_, index) => {
              const ordered = inventoryOrder[index]
              const id = index < 9 ? hotbar[index] : ordered && !hotbar.includes(ordered) ? ordered : null
              const quantity = id ? inventory[id] ?? 0 : 0
              return <div className="inventory-slot" key={index}>
                {id && quantity > 0 && <><img src={ITEMS[id].icon} alt={ITEMS[id].name} /><span>{quantity}</span><HoverTip lines={itemTooltip(id)} /></>}
              </div>
            })}
          </div>
        </section>
      </div>
    </section>
  </div>
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
            const available = item.limited ? shopStock[id] ?? 0 : null
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
            ><img src={item.icon} alt={item.name} /><span className="shop-item-name">{item.name}</span><span className="shop-owned"><b>×{owned}</b>{available !== null && <em>{available} LEFT</em>}</span><span className="shop-price" title={price ? formatCoins(price) : undefined}><Icon name="coin" />{price ? formatCoins(price, true) : '—'}</span><HoverTip lines={itemTooltip(id)} /></button>
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
  const offers = [0, 1].map((slot) => secretStockOffer(round, prices, sessionSeed, corrections, slot))
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
  const tradable = (Object.keys(ITEMS) as ItemId[]).filter((id) => id !== 'gold-coins' && (inventory[id] ?? 0) > 0)
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
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  return locked || minigameOpen ? <div className="crosshair" aria-hidden="true"><i /><i /></div> : null
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
        {(['master', 'music', 'ambience'] as const).map((channel) => (
          <label className="volume-row" key={channel}><span>{channel.toUpperCase()}</span><input type="range" min="0" max="1" step="0.01" value={volumes[channel]} onChange={(event) => setVolume(channel, Number(event.target.value))} /></label>
        ))}
        <label className="volume-row"><span>SENSITIVITY</span><input aria-label="Camera sensitivity" type="range" min="0.35" max="1.8" step="0.05" value={sensitivity} onChange={(event) => setSensitivity(Number(event.target.value))} /></label>
        <div className="camera-options"><button className={shiftLocked ? 'active' : ''} onClick={() => setShiftLocked(!shiftLocked)}>SHIFT LOCK</button><button className={invertY ? 'active' : ''} onClick={() => setInvertY(!invertY)}>INVERT Y</button></div>
        <button className="cookbook-open" onClick={() => openCookbook(true)}>COOKBOOK</button>
        <div className="control-strip"><kbd>Q</kbd><span>LOCK</span><kbd>E</kbd><span>PACK</span><kbd>TAB</kbd><span>PLAYERS</span></div>
      </section>
    </div>
  )
}

function CookbookPanel() {
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

function ResultsPanel() {
  const complete = useGameStore((state) => state.sessionComplete)
  const cash = useGameStore((state) => state.cash)
  const stats = useGameStore((state) => state.stats)
  const nickname = useGameStore((state) => state.nickname)
  const players = useGameStore((state) => state.onlinePlayers)
  const [selected, setSelected] = useState(0)
  if (!complete) return null
  const leaderboard = [{ id: 'self', nickname, cash, stats }, ...players].sort((a, b) => b.cash - a.cash)
  const focused = leaderboard[Math.min(selected, leaderboard.length - 1)]
  const restart = () => {
    localStorage.removeItem('project01-save-v11')
    window.location.assign('/?gate=final')
  }
  return <div className="modal-scrim results-scrim"><section className="panel results-panel"><header><div className="panel-title"><span className="results-mark">60</span><span>FINAL LEDGER</span></div></header><div className="leaderboard-list">{leaderboard.map((player, index) => <button className={selected === index ? 'active' : ''} key={player.id} onClick={() => setSelected(index)}><b>{index + 1}</b><span>{player.nickname}</span><strong>{formatCoins(player.cash, true)}</strong></button>)}</div><strong className="final-cash"><Icon name="coin" />{formatCoins(focused.cash)}</strong><div className="result-stats"><span>FORAGED<strong>{focused.stats.foraged}</strong></span><span>MINED<strong>{focused.stats.mined}</strong></span><span>HARVESTED<strong>{focused.stats.harvested}</strong></span><span>SOLD<strong>{focused.stats.sold}</strong></span></div><button onClick={restart}>NEW RUN</button></section></div>
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
  if (zone !== 'forage') return null
  const carrier = (inventory['master-basket'] ?? 0) > 0 ? 'master-basket' : (inventory['reinforced-basket'] ?? 0) > 0 ? 'reinforced-basket' : (inventory.basket ?? 0) > 0 ? 'basket' : 'hand'
  const capacity = BASKET_CONFIG[carrier].capacity
  const stored = (inventory.apple ?? 0) + (inventory.orange ?? 0)
  return <div className="forage-capacity" title={BASKET_CONFIG[carrier].name}><span>FRUIT</span><i><b style={{ width: `${Math.min(100, stored / capacity * 100)}%` }} /></i><strong>{stored}/{capacity}</strong></div>
}

function MinigamePanel() {
  const open = useGameStore((state) => state.minigameOpen)
  const milestone = useGameStore((state) => state.minigameMilestone)
  const finish = useGameStore((state) => state.finishMinigame)
  const [phase, setPhase] = useState<'warning' | 'playing' | 'waiting'>('warning')
  const [warning, setWarning] = useState(5)
  const [seconds, setSeconds] = useState(165)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [progress, setProgress] = useState(0)
  const [sockets, setSockets] = useState(() => Array.from({ length: 25 }, (_, index) => ({ kind: legacyMiningRushOre(20 * 60, index, 0), generation: 0, readyAt: 0 })))
  const mining = useRef<{ index: number; startedAt: number } | null>(null)
  const miningFrame = useRef<number | null>(null)
  const lastMineAt = useRef(0)
  const submitted = useRef(false)

  useEffect(() => {
    if (!open) return
    setPhase('warning')
    setWarning(5)
    setSeconds(165)
    setScore(0)
    setCombo(0)
    setProgress(0)
    submitted.current = false
    setSockets(Array.from({ length: 25 }, (_, index) => ({ kind: legacyMiningRushOre(milestone, index, 0), generation: 0, readyAt: 0 })))
  }, [milestone, open])

  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => {
      if (phase === 'warning') setWarning((value) => { if (value <= 1) { setPhase('playing'); return 0 }; return value - 1 })
      if (phase === 'playing') setSeconds((value) => Math.max(0, value - 1))
      if (phase === 'playing' && lastMineAt.current && Date.now() - lastMineAt.current > 1800) setCombo(0)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [open, phase])

  useEffect(() => {
    if (!open) return
    const off = onMultiplayer('minigame:result', (raw) => {
      const result = raw as { milestone: number; score: number; placement: number; economyReference: number }
      if (result.milestone === milestone) finish(result.score, result.placement, result.economyReference)
    })
    return off
  }, [finish, milestone, open])

  useEffect(() => {
    if (!open || seconds > 0 || submitted.current) return
    submitted.current = true
    setPhase('waiting')
    const state = useGameStore.getState()
    const ownedValue = (Object.keys(state.inventory) as ItemId[]).reduce((sum, id) => sum + (ITEMS[id].buyPrice ?? 0) * (state.inventory[id] ?? 0), 0)
    const stockBasis = (Object.keys(STOCKS) as StockId[]).reduce((sum, id) => sum + STOCKS[id].basePrice * (state.portfolio[id] ?? 0), 0)
    const plantedValue = Object.values(state.farmCells).reduce((sum, cell) => sum + (cell.crop ? CROP_CONFIG[cell.crop].seedPrice : 0), 0)
    const progressValue = state.cash + ownedValue + stockBasis + plantedValue
    sendMultiplayer('minigame:finish', { milestone, score, progressValue })
    const fallback = window.setTimeout(() => {
      if (useGameStore.getState().minigameOpen) finish(score, 1, progressValue)
    }, 6500)
    return () => window.clearTimeout(fallback)
  }, [finish, milestone, open, score, seconds])

  useEffect(() => () => { if (miningFrame.current !== null) cancelAnimationFrame(miningFrame.current) }, [])
  if (!open) return null

  const stopMining = (miss = false) => {
    mining.current = null
    setProgress(0)
    if (miningFrame.current !== null) cancelAnimationFrame(miningFrame.current)
    miningFrame.current = null
    if (miss) setCombo(0)
  }
  const startMining = (index: number) => {
    if (phase !== 'playing') return
    const socket = sockets[index]
    if (socket.readyAt > Date.now()) return stopMining(true)
    mining.current = { index, startedAt: performance.now() }
    const duration = { copper: 520, iron: 640, silver: 760, gold: 900, crystal: 1080 }[socket.kind]
    const frame = (now: number) => {
      if (!mining.current || mining.current.index !== index) return
      const value = Math.min(1, (now - mining.current.startedAt) / duration)
      setProgress(value)
      if (value < 1) { miningFrame.current = requestAnimationFrame(frame); return }
      const nextCombo = combo + 1
      const base = { copper: 1, iron: 2, silver: 4, gold: 7, crystal: 12 }[socket.kind]
      const bonus = 1 + Math.min(0.3, Math.floor(nextCombo / 5) * 0.05)
      setScore((current) => current + Math.round(base * bonus))
      setCombo(nextCombo)
      lastMineAt.current = Date.now()
      setSockets((current) => current.map((entry, socketIndex) => socketIndex === index ? { ...entry, generation: entry.generation + 1, readyAt: Date.now() + 420, kind: legacyMiningRushOre(milestone, index, entry.generation + 1) } : entry))
      stopMining()
    }
    miningFrame.current = requestAnimationFrame(frame)
  }
  return <div className="modal-scrim minigame-scrim"><section className="panel minigame-panel mining-rush"><header><div className="panel-title"><span className="minigame-mark">⛏</span><span>MINING RUSH</span></div><strong>{phase === 'warning' ? warning : phase === 'waiting' ? 'RESULTS' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</strong></header>{phase === 'warning' ? <div className="rush-warning"><b>{warning}</b><span>HOLD LMB</span></div> : <><div className="rush-score"><span>SCORE <b>{score}</b></span><span>COMBO <b>×{combo}</b></span></div><div className="ore-bay">{sockets.map((socket, index) => {
    const depleted = socket.readyAt > Date.now()
    const active = mining.current?.index === index
    return <button key={index} className={`${socket.kind} ${depleted ? 'depleted' : ''} ${active ? 'active' : ''}`} onPointerDown={(event) => { if (event.button === 0) startMining(index) }} onPointerUp={() => stopMining()} onPointerLeave={() => stopMining()} onContextMenu={(event) => event.preventDefault()} aria-label={`${socket.kind} ore`}><i /><small>{socket.kind.toUpperCase()}</small>{active && <em style={{ width: `${progress * 100}%` }} />}</button>
  })}</div><footer>{phase === 'waiting' ? 'CALCULATING PLACEMENT' : 'Equal tools · event points only'}</footer></>}</section></div>
}

type MiningRushOre = 'copper' | 'iron' | 'silver' | 'gold' | 'crystal'
function legacyMiningRushOre(milestone: number, socket: number, generation: number): MiningRushOre {
  let value = Math.imul(milestone + generation * 104729 + socket * 7919, 48271) >>> 0
  value ^= value >>> 16
  const roll = (value >>> 0) / 4294967296
  return roll < .46 ? 'copper' : roll < .72 ? 'iron' : roll < .88 ? 'silver' : roll < .97 ? 'gold' : 'crystal'
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
  const forageInventory = useGameStore((state) => state.forageRushInventory)
  const forageDelivered = useGameStore((state) => state.forageRushDelivered)
  const tickFarmRush = useGameStore((state) => state.tickFarmRush)
  const syncForageRush = useGameStore((state) => state.syncForageRush)
  const finish = useGameStore((state) => state.finishMinigame)
  const [warning, setWarning] = useState(5)
  const [seconds, setSeconds] = useState(MINIGAME_DURATION.mining)
  const [, refresh] = useState(0)
  const [waiting, setWaiting] = useState(false)
  const submitted = useRef(false)
  const score = kind === 'mining' ? miningScore : kind === 'farm' ? farmScore : forageScore
  const title = kind === 'mining' ? 'MINING RUSH' : kind === 'farm' ? 'KITCHEN RUSH' : 'FORAGE RACE'
  const forageComplete = Object.values(forageDelivered).every(Boolean)
  useEffect(() => {
    if (!open) return
    setWarning(5); setSeconds(MINIGAME_DURATION[kind]); setWaiting(false); submitted.current = false
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
      const result = raw as { milestone: number; score: number; placement: number; economyReference: number }
      if (result.milestone === milestone) finish(result.score, result.placement, result.economyReference)
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
    const ownedValue = (Object.keys(state.inventory) as ItemId[]).reduce((sum, id) => sum + (ITEMS[id].buyPrice ?? 0) * (state.inventory[id] ?? 0), 0)
    const stockBasis = (Object.keys(STOCKS) as StockId[]).reduce((sum, id) => sum + STOCKS[id].basePrice * (state.portfolio[id] ?? 0), 0)
    const plantedValue = Object.values(state.farmCells).reduce((sum, cell) => sum + (cell.crop ? CROP_CONFIG[cell.crop].seedPrice : 0), 0)
    const progressValue = state.cash + ownedValue + stockBasis + plantedValue
    const eventScore = kind === 'mining' ? state.rushScore : kind === 'farm' ? state.farmRushScore : state.forageRushScore + (forageComplete ? 10_000 + seconds * 10 : Object.values(state.forageRushInventory).reduce((sum, value) => sum + value, 0))
    sendMultiplayer('minigame:finish', { milestone, score: eventScore, progressValue })
    const fallback = window.setTimeout(() => { if (useGameStore.getState().minigameOpen) finish(eventScore, 1, progressValue) }, 6500)
    return () => window.clearTimeout(fallback)
  }, [finish, forageComplete, kind, milestone, open, seconds])
  if (!open) return null
  const orderDefinitions = farmRushOrders(milestone)
  return <>
    {warning > 0 && <div className="rush-countdown"><strong>{warning}</strong><span>{title}</span></div>}
    {kind === 'farm' && <div className="event-orders">{activeOrders.map((ticket) => {
      const order = orderDefinitions[ticket.orderIndex % orderDefinitions.length]
      const remaining = Math.max(0, ticket.expiresAt - Date.now())
      return <div className={cooking?.orderIndex === ticket.orderIndex ? 'cooking' : ''} key={ticket.orderIndex}><header><strong>{order.name}</strong><b>{Math.ceil(remaining / 1000)}</b></header><span>{Object.entries(order.ingredients).map(([crop, quantity]) => `${quantity} ${crop}`).join(' · ')}</span><i><b style={{ width: `${remaining / 420}%` }} /></i><small>{order.points} PTS</small></div>
    })}</div>}
    {kind === 'forage' && <div className="event-deliveries">{(['apple', 'orange', 'truffle', 'discovery'] as ForageRushKind[]).map((id) => <div className={forageDelivered[id] ? 'complete' : ''} key={id}><img src={id === 'discovery' ? ITEMS['natural-discovery'].icon : ITEMS[id].icon} alt="" /><strong>{forageDelivered[id] ? '✓' : `${forageInventory[id]}/${FORAGE_RUSH_REQUIREMENTS[id]}`}</strong></div>)}</div>}
    <div className="rush-world-hud"><span>{title}</span><strong>{score}</strong><small>SCORE</small><b>{waiting ? 'RESULTS' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</b>{kind === 'mining' && <img src={ITEMS['crystal-pickaxe'].icon} alt="Crystal Pickaxe" />}{kind === 'mining' && combo > 1 && <em>×{combo}</em>}</div>
  </>
}

function Interface() {
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
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
      const ore = rush ? miningRushOre(state.minigameMilestone, id, state.rushNodes[id]?.generation ?? 0) : oreKindAtDepth(id, point[2], state.minedNodes[id] ?? 0)
      if (!rush && !canMineOre(held, ore)) {
        const required = requiredPickaxe(ore)
        setToast(`Need ${PICKAXE_CONFIG[required].name}`)
        resetMining()
        return
      }
      if (miningFrame.current !== null) return
      const duration = rush ? 760 : miningDuration(held, ore)
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
        if (live.minigameOpen && live.minigameKind === 'farm' && FARM_RUSH_TOOLS[index]) live.setFarmRushTool(FARM_RUSH_TOOLS[index])
        else setSelected(index)
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
        if (useGameStore.getState().inventoryOpen) toggleInventory()
      }
    }
    const useItem = (event: PointerEvent) => {
      const canvasFocused = event.target instanceof HTMLCanvasElement || document.pointerLockElement instanceof HTMLCanvasElement
      if (!canvasFocused) return
      const state = useGameStore.getState()
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
  }, [setCookbookOpen, setLotteryOpen, setMenuOpen, setPlayerPanelOpen, setProgress, setSecretOpen, setSelected, setShopOpen, setStockOpen, setTicketInspectOpen, setToast, setTravelOpen, setZone, toggleInventory])
  if (minigameOpen) return <div className="interface"><Crosshair /><InteractionPrompt /><MinigameWorldHud /><MinigameHotbar /><MinigameBag /><Toast /></div>
  return <div className="interface"><HUD /><Crosshair /><InteractionPrompt /><ForageCapacity /><Hotbar /><InventoryPanel /><ShopPanel /><LotteryPanel /><TicketInspectPanel /><NoteInspectPanel /><TravelPanel /><SecretDealPanel /><StocksPanel /><PlayerTradePanel /><MenuPanel /><CookbookPanel /><ResultsPanel /><Toast /></div>
}

export function App() {
  return <main className="game-shell"><GameWorld /><Interface /><AudioBed /></main>
}
