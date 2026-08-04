import assert from 'node:assert/strict'

const memory = new Map<string, string>()
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
  removeItem: (key: string) => { memory.delete(key) },
  clear: () => { memory.clear() },
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() { return memory.size },
}
Object.assign(globalThis, { localStorage: storage, window: { location: { search: '?gate=final' } } })

const { useGameStore } = await import('../src/game/store')
const { activeRareForageIds } = await import('../src/game/config')
const { FARM_RUSH_MAX_ORDERS, FARM_RUSH_ORDER_LIFETIME_MS, FARM_RUSH_RECIPE_IDS, farmRushOrders, minigameMilestones, minigameRewardPackage, scheduledMinigame } = await import('../src/game/minigame')

assert.deepEqual(minigameMilestones(30 * 60), [10 * 60, 20 * 60])
assert.deepEqual(minigameMilestones(45 * 60), [15 * 60, 30 * 60])
assert.deepEqual(minigameMilestones(60 * 60), [20 * 60, 40 * 60])
assert.deepEqual(minigameMilestones(90 * 60), [30 * 60, 60 * 60])
for (const duration of [30, 45, 60, 90].map((minutes) => minutes * 60)) {
  const [first, second] = minigameMilestones(duration)
  assert.notEqual(scheduledMinigame(first, 9731, duration), scheduledMinigame(second, 9731, duration))
}

const permanentInventory = { 'water-can': 1, 'worn-pickaxe': 1, 'home-charm': 1, apple: 4 } as const
const permanentHotbar = ['water-can', 'worn-pickaxe', null, null, null, null, null, null, 'home-charm'] as const

function enter(kind: 'mining' | 'farm' | 'forage') {
  useGameStore.setState({
    cash: 100_000,
    inventory: { ...permanentInventory },
    hotbar: [...permanentHotbar],
    selectedHotbar: 8,
    inventoryOpen: false,
    zone: 'forage',
    playerPosition: [12, 0.86, -42],
    minigameOpen: true,
    minigameKind: kind,
    minigameMilestone: 20 * 60,
    minigameSnapshot: { zone: 'forage', playerPosition: [12, 0.86, -42], hotbar: [...permanentHotbar], selectedHotbar: 8, inventoryOpen: false, startedAt: Date.now() },
    rushNodes: {}, rushScore: 0, rushCombo: 0, rushLastMineAt: 0,
    farmRushCells: {}, farmRushTool: 'wheat', farmRushInventory: { wheat: 0, tomato: 0, lettuce: 0, pumpkin: 0, watermelon: 0 }, farmRushOrders: [], farmRushIssued: 0, farmRushCooking: [], farmRushScore: 0,
    forageRushCollected: {}, forageRushInventory: { apple: 0, orange: 0, truffle: 0, discovery: 0 }, forageRushDelivered: { apple: false, orange: false, truffle: false, discovery: false }, forageRushScore: 0,
  })
}

enter('mining')
useGameStore.setState({ eventBay: 1 })
useGameStore.getState().mineRushNode('RushOre0_00')
assert.equal(useGameStore.getState().rushScore, 0, 'mining cannot target another player bay by ID')
useGameStore.setState({ eventBay: 0 })
useGameStore.getState().mineRushNode('RushOre0_00')
const firstMine = useGameStore.getState()
assert(firstMine.rushScore > 0, 'mining awards points')
assert.equal(firstMine.inventory['copper-ore'] ?? 0, 0, 'event ore never enters permanent inventory')
const scoreDuringRespawn = firstMine.rushScore
useGameStore.getState().mineRushNode('RushOre0_00')
assert.equal(useGameStore.getState().rushScore, scoreDuringRespawn, 'depleted node cannot be mined during respawn')
useGameStore.setState((state) => ({ rushNodes: { ...state.rushNodes, RushOre0_00: { ...state.rushNodes.RushOre0_00, readyAt: 0 } } }))
useGameStore.getState().mineRushNode('RushOre0_00')
assert.equal(useGameStore.getState().rushCombo, 2, 'continuous mining advances combo')
useGameStore.getState().finishMinigame(useGameStore.getState().rushScore, 3, 10_000_000)
assert.deepEqual(useGameStore.getState().hotbar, permanentHotbar, 'mining restores the exact hotbar')
assert.equal(useGameStore.getState().selectedHotbar, 8, 'mining restores selected slot')
assert.equal(useGameStore.getState().inventory['copper-ore'] ?? 0, 0, 'temporary mining rewards are deleted')
const miningCashAfterReward = useGameStore.getState().cash
useGameStore.getState().finishMinigame(999_999, 1, 10_000_000)
assert.equal(useGameStore.getState().cash, miningCashAfterReward, 'mining reward is idempotent')

enter('farm')
const cell = 'FarmRushCell0_00'
useGameStore.setState({ eventBay: 1 })
useGameStore.getState().farmRushAction(cell)
assert.equal(useGameStore.getState().farmRushCells[cell], undefined, 'farm cannot target another player plot by ID')
useGameStore.setState({ eventBay: 0 })
useGameStore.getState().farmRushAction(cell)
assert.equal(useGameStore.getState().farmRushCells[cell]?.stage, 'planted', 'seed plants through the farm interaction')
useGameStore.getState().setFarmRushTool('water')
useGameStore.getState().farmRushAction(cell)
const firstReadyAt = useGameStore.getState().farmRushCells[cell]?.readyAt ?? 0
assert(firstReadyAt > Date.now(), 'one watering starts the growth timer')
useGameStore.getState().farmRushAction(cell)
assert.equal(useGameStore.getState().farmRushCells[cell]?.readyAt, firstReadyAt, 'watering is not repeatedly required')
useGameStore.getState().tickFarmRush()
assert.equal(useGameStore.getState().farmRushOrders.length, FARM_RUSH_MAX_ORDERS, 'Kitchen Rush starts with three live orders')
assert(useGameStore.getState().farmRushOrders.every((ticket) => ticket.expiresAt - Date.now() <= FARM_RUSH_ORDER_LIFETIME_MS), 'Kitchen Rush orders never exceed forty seconds')
assert.equal(new Set(FARM_RUSH_RECIPE_IDS).size, 7, 'all seven farm-event recipes are available in the event cookbook')
const firstTicket = useGameStore.getState().farmRushOrders[0]
const firstOrder = farmRushOrders(20 * 60)[firstTicket.orderIndex]
useGameStore.setState({ farmRushInventory: { wheat: 20, tomato: 20, lettuce: 20, pumpkin: 20, watermelon: 20 } })
useGameStore.getState().farmRushCook(firstOrder.recipe)
assert.equal(useGameStore.getState().farmRushCooking.length, 1, 'manual cookbook selection queues one matching dish')
assert.equal(useGameStore.getState().farmRushCooking[0].orderIndex, firstTicket.orderIndex, 'manual cookbook selection does not cook another recipe')
useGameStore.setState((state) => ({ farmRushCooking: state.farmRushCooking.map((job) => ({ ...job, readyAt: Date.now() - 1 })) }))
useGameStore.getState().farmRushSubmit(firstTicket.orderIndex)
assert(useGameStore.getState().farmRushScore > 0, 'manual submit awards the dish points')
assert.equal(useGameStore.getState().farmRushOrders.length, FARM_RUSH_MAX_ORDERS, 'submitting immediately replaces the order')
useGameStore.setState((state) => ({ farmRushOrders: state.farmRushOrders.map((ticket) => ({ ...ticket, expiresAt: Date.now() - 1 })) }))
useGameStore.getState().tickFarmRush()
assert.equal(useGameStore.getState().farmRushOrders.length, FARM_RUSH_MAX_ORDERS, 'expired orders are replaced on the next event tick')
useGameStore.getState().finishMinigame(0, 4, 10_000_000)
assert.deepEqual(useGameStore.getState().hotbar, permanentHotbar, 'farm restores the exact hotbar')
assert.deepEqual(useGameStore.getState().farmRushCooking, [], 'temporary cooking jobs are deleted after the event')

enter('forage')
for (let index = 0; index < 4; index += 1) useGameStore.getState().forageRushCollect(`ForageRushApple${index}`)
assert.equal(useGameStore.getState().forageRushInventory.apple, 12, 'four apple sites fill the delivery requirement')
assert.equal(useGameStore.getState().inventory.apple, 4, 'event fruit remains isolated from permanent fruit')
useGameStore.getState().forageRushDeliver('apple')
assert.equal(useGameStore.getState().forageRushScore, 120, 'apple delivery awards points')
assert.equal(useGameStore.getState().forageRushInventory.apple, 0, 'delivery consumes temporary fruit')
useGameStore.getState().forageRushDeliver('apple')
assert.equal(useGameStore.getState().forageRushScore, 120, 'a delivery cannot score twice')
for (let index = 0; index < 4; index += 1) useGameStore.getState().forageRushCollect(`ForageRushOrange${index}`)
for (let index = 0; index < 3; index += 1) useGameStore.getState().forageRushCollect(`ForageRushTruffle${index}`)
useGameStore.getState().forageRushCollect('ForageRushDiscovery0')
useGameStore.getState().forageRushDeliver('orange')
useGameStore.getState().forageRushDeliver('truffle')
useGameStore.getState().forageRushDeliver('discovery')
assert(Object.values(useGameStore.getState().forageRushDelivered).every(Boolean), 'all four deliveries can complete')
assert.equal(useGameStore.getState().forageRushScore, 770, 'delivery score total is stable')
useGameStore.getState().finishMinigame(useGameStore.getState().forageRushScore, 2, 10_000_000)
assert.deepEqual(useGameStore.getState().hotbar, permanentHotbar, 'forage restores the exact hotbar')
assert.equal(useGameStore.getState().inventory['cookbook-box'], 1, 'earned Cookbook Box enters permanent inventory without replacing a hotbar slot')
assert.deepEqual(useGameStore.getState().forageRushInventory, { apple: 0, orange: 0, truffle: 0, discovery: 0 }, 'temporary forage inventory is deleted')
assert.equal(useGameStore.getState().inventory.apple, 4, 'permanent forage inventory is untouched')

const rareSites = ['ForageRushTruffle000', 'ForageRushTruffle001', 'ForageRushTruffle020', 'ForageRushTruffle021', 'ForageRushDiscovery00', 'ForageRushDiscovery01', 'ForageRushDiscovery10']
const firstRareRoll = activeRareForageIds(rareSites, true, 77, 0, 1_000)
const secondRareRoll = activeRareForageIds(rareSites, true, 77, 0, 35_000)
assert.equal([...firstRareRoll].filter((id) => id.startsWith('ForageRushTruffle')).length, 2, 'race keeps two rotating truffle opportunities active')
assert.equal([...firstRareRoll].filter((id) => id.startsWith('ForageRushDiscovery')).length, 1, 'race keeps one rotating fossil opportunity active')
assert.notDeepEqual([...firstRareRoll].sort(), [...secondRareRoll].sort(), 'rare event locations rotate between timed rolls')

const rareCollectedAt = Date.now()
useGameStore.setState({ minigameOpen: false, matchStartedAt: rareCollectedAt - 1_000, inventory: { ...permanentInventory }, collectedForage: {} })
useGameStore.getState().collectForage('ForageTruffle000', 'truffle')
assert((useGameStore.getState().collectedForage.ForageTruffle000 ?? 0) > rareCollectedAt, 'collected truffle is hidden until a later location roll')

for (const seed of [7, 77, 777, 7777]) {
  assert.notEqual(scheduledMinigame(20 * 60, seed), scheduledMinigame(40 * 60, seed), 'a session must schedule two different minigames')
}
assert.deepEqual(minigameRewardPackage(10_000_000, 0), { budget: 0, boxes: 0, cash: 0 }, 'leaving an event awards nothing')
assert.equal(minigameRewardPackage(10_000_000, 1).cash, 0, 'first-place Cookbook Boxes consume the full 1.2M early reward budget')

useGameStore.setState({ inventory: { 'cookbook-box': 1 }, hotbar: Array(9).fill(null), knownRecipes: [] })
useGameStore.getState().useCookbookBox()
const unlockedRecipe = useGameStore.getState().knownRecipes[0]
const { RECIPES } = await import('../src/game/recipes')
assert.equal(RECIPES[unlockedRecipe].group, 'early', 'the first Cookbook Box cannot unlock a late recipe')

useGameStore.setState({ cash: 100_000_000, lotteryTickets: [], lotteryDraft: [] })
for (let ticket = 0; ticket < 10; ticket += 1) {
  useGameStore.setState({ lotteryDraft: [1, 2, 3] })
  useGameStore.getState().buyLotteryTicket()
}
assert.equal(useGameStore.getState().lotteryTickets.length, 10, 'active lottery tickets are never discarded by the UI history cap')

useGameStore.setState({
  sessionSeed: 445566,
  matchStartedAt: 123456,
  stockPrices: { apple: 111, samsung: 222, nvidia: 333, google: 444, amd: 555 },
  marketCorrectionsApplied: [1, 2],
})
const persisted = JSON.parse(memory.get('project01-save-v12') ?? '{}')
assert.equal(persisted.sessionSeed, 445566, 'session seed persists across reloads')
assert.equal(persisted.stockPrices.google, 444, 'stock state persists across reloads')
assert.deepEqual(persisted.marketCorrectionsApplied, [1, 2], 'market corrections persist across reloads')

console.log('Minigames: mining hold result/respawn/combo, one-water farm growth, forage rotation/collection/delivery, isolation, restoration, and idempotent rewards passed.')
