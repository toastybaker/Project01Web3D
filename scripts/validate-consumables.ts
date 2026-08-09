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

const now = Date.now()
useGameStore.setState({
  minigameOpen: false,
  inventory: { 'worn-pickaxe': 1, basket: 1, 'harvest-charm': 1, 'mining-boost': 2, 'fortune-boost': 3, 'cook-timer': 2, 'rain-bottle': 2 },
  miningBoostUntil: 0,
  fortuneBoostCharges: {},
  claimedFarms: [0, 1],
  farmCells: {
    '0:0': { crop: 'wheat', stage: 'planted', readyAt: null },
    '0:1': { crop: 'tomato', stage: 'watered', readyAt: now + 60_000 },
    '1:0': { crop: 'lettuce', stage: 'planted', readyAt: null },
  },
  cookQueue: [
    { id: 'a', recipe: 'grain-bowl', quantity: 1, furnaceIndex: 0, readyAt: now + 40_000 },
    { id: 'b', recipe: 'grain-bowl', quantity: 1, furnaceIndex: 0, readyAt: now + 100_000 },
    { id: 'done', recipe: 'grain-bowl', quantity: 1, furnaceIndex: 0, readyAt: now - 1 },
  ],
})

useGameStore.getState().useMiningBoost()
assert.equal(useGameStore.getState().inventory['mining-boost'], 1)
assert(useGameStore.getState().miningBoostUntil >= now + 179_000)
useGameStore.getState().useMiningBoost()
assert.equal(useGameStore.getState().inventory['mining-boost'], 1, 'active Mining Tonic stacked or consumed twice')

useGameStore.getState().useFortuneBoost('worn-pickaxe')
assert.equal(useGameStore.getState().fortuneBoostCharges['worn-pickaxe'], 20)
assert.equal(useGameStore.getState().inventory['fortune-boost'], 2)
useGameStore.getState().useFortuneBoost('worn-pickaxe')
assert.equal(useGameStore.getState().inventory['fortune-boost'], 2, 'active Luck Tonic stacked or consumed twice')
useGameStore.getState().useFortuneBoost('basket')
useGameStore.getState().useFortuneBoost('harvest-charm')
assert.equal(useGameStore.getState().fortuneBoostCharges.basket, 30)
assert.equal(useGameStore.getState().fortuneBoostCharges['harvest-charm'], 32)

useGameStore.setState({
  hotbar: ['worn-pickaxe', 'iron-pickaxe', null, null, null, null, null, null, null],
  selectedHotbar: 1,
  mineAwardGenerations: {},
})
useGameStore.getState().awardMineNode('MineOreFortuneTest', 'copper-ore', 1, { generation: 1, readyAt: now + 30_000 }, 'worn-pickaxe')
assert.equal(useGameStore.getState().fortuneBoostCharges['worn-pickaxe'], 19, 'Mining award consumed Fortune from the selected slot instead of the requesting pickaxe')

const beforeJobs = Object.fromEntries(useGameStore.getState().cookQueue.map((job) => [job.id, job.readyAt]))
useGameStore.getState().useCookTimer()
const afterJobs = Object.fromEntries(useGameStore.getState().cookQueue.map((job) => [job.id, job.readyAt]))
assert.equal(beforeJobs.a - afterJobs.a, 30_000)
assert.equal(beforeJobs.b - afterJobs.b, 30_000)
assert.equal(beforeJobs.done, afterJobs.done)
assert.equal(useGameStore.getState().inventory['cook-timer'], 1)

useGameStore.getState().useRainBottle(0)
const watered = useGameStore.getState()
assert.equal(watered.farmCells['0:0'].stage, 'watered')
assert.equal(watered.farmCells['0:1'].readyAt, now + 60_000, 'Rain Bottle restarted an already-watered crop')
assert.equal(watered.farmCells['1:0'].stage, 'planted', 'Rain Bottle watered another farm')
assert.equal(watered.inventory['rain-bottle'], 1)

const boostBeforeEvent = useGameStore.getState().miningBoostUntil
useGameStore.setState({
  minigameOpen: true,
  minigameKind: 'mining',
  minigameMilestone: 1200,
  minigameSnapshot: { zone: 'hub', playerPosition: [0, 0, 14], hotbar: ['worn-pickaxe', null, null, null, null, null, null, null, null], selectedHotbar: 0, inventoryOpen: false, startedAt: now - 5_000 },
})
useGameStore.getState().finishMinigame(0, 0, 1)
assert(useGameStore.getState().miningBoostUntil >= boostBeforeEvent + 4_500, 'Mining Tonic timer did not pause during an event')

console.log(JSON.stringify({ status: 'passed', miningSeconds: 180, fortuneCharges: { pickaxe: 20, basket: 30, charm: 32 }, cookTimerSaved: 60, rainFarmScoped: true, eventPause: true }, null, 2))
