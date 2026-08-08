import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const port = 34_000 + Math.floor(Math.random() * 1_000)
const profile = path.join(tmpdir(), `project01-tutorial-${randomUUID()}`)
const chrome = spawn(chromePath, [
  '--headless=new', '--mute-audio', '--disable-extensions', '--disable-gpu-vsync',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let target
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
    target = targets.find((entry) => entry.type === 'page')
    if (target) break
  } catch {}
  await sleep(100)
}
if (!target) throw new Error('Chrome did not start')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
let nextId = 0
const pending = new Map()
socket.on('message', (raw) => {
  const message = JSON.parse(String(raw))
  if (!message.id || !pending.has(message.id)) return
  const job = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) job.reject(new Error(message.error.message))
  else job.resolve(message.result)
})
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
const assert = (condition, message) => { if (!condition) throw new Error(message) }

try {
  await command('Page.enable')
  await command('Runtime.enable')
  await command('Page.navigate', { url: 'http://127.0.0.1:4173/?fresh=1&guide=1&qa=1&lang=en&graphics=low' })
  await sleep(4_000)
  const ready = await evaluate(`Boolean(window.__PROJECT01_STORE__)`)
  assert(ready, 'Tutorial QA store was not exposed')
  const result = await evaluate(`(async () => {
    const store = window.__PROJECT01_STORE__;
    const waitForAnchor = async (id, timeout = 12000) => {
      const started = performance.now();
      while (!store.getState().anchors[id] && performance.now() - started < timeout) await new Promise((resolve) => setTimeout(resolve, 120));
      return Boolean(store.getState().anchors[id]);
    };
    const pick = (state) => ({
      zone: state.zone, cash: state.cash, inventory: state.inventory, hotbar: state.hotbar,
      farmCells: state.farmCells, claimedFarms: state.claimedFarms, portfolio: state.portfolio,
      enhancements: state.enhancements, selectedHotbar: state.selectedHotbar,
    });
    const initial = pick(store.getState());
    const initialSave = localStorage.getItem('project01-save-v12');
    const histories = store.getState();
    if (!Object.values(histories.stockHistory).every((history) => history.length === 1)) throw new Error('Fresh stock history is fabricated');
    if (!Object.values(histories.commodityPriceHistory).every((history) => history.length === 1)) throw new Error('Fresh commodity history is fabricated');
    store.getState().startTutorial();
    if (!store.getState().tutorialActive || store.getState().cash !== 3000000) throw new Error('Tutorial did not isolate state');
    await new Promise((resolve) => setTimeout(resolve, 120));
    const controlText = document.querySelector('.tutorial-controls')?.textContent || '';
    if (!['MOVE', 'LOOK', 'SPRINT', 'JUMP', 'CAMERA LOCK', 'INVENTORY'].every((label) => controlText.includes(label))) throw new Error('Control reference does not explain every key');
    if (document.querySelector('.tutorial-card .guide-next')?.disabled) throw new Error('Control reference still blocks progression on input detection');
    if (!await waitForAnchor('NpcShop')) throw new Error('Hub anchors were not ready before advancing the tutorial');

    store.getState().setTutorialStep(2);
    if (!await waitForAnchor('NpcShop')) throw new Error('Same-zone tutorial transition erased the shop NPC anchor');
    if (document.querySelector('.tutorial-world-marker')?.textContent?.trim() !== 'GENERAL SHOP') throw new Error('Shop tutorial marker is not destination-specific');
    store.getState().setShopOpen(true, 'common');
    store.getState().trade('cookbook-box', 1);
    if ((store.getState().inventory['cookbook-box'] || 0) !== 1) throw new Error('Tutorial shop purchase failed');
    if (!store.getState().hotbar.includes('cookbook-box')) throw new Error('Tutorial shop purchase skipped hotbar row');
    store.getState().useCookbookBox();
    if (!store.getState().knownRecipes.includes('apple-bread') || !store.getState().cookbookOpen) throw new Error('Tutorial recipe box did not reveal Apple Bread in the real recipe UI');

    store.getState().setTutorialStep(3);
    store.getState().setShopOpen(true, 'mine');
    store.getState().trade('worn-pickaxe', 1);
    if ((store.getState().inventory['worn-pickaxe'] || 0) !== 1) throw new Error('Tutorial pickaxe purchase failed');
    store.getState().setSelectedHotbar(store.getState().hotbar.indexOf('worn-pickaxe'));
    store.getState().mineNode('MineOreTutorial', 'copper-ore');
    const copper = store.getState().inventory['copper-ore'] || 0;
    if (copper < 1) throw new Error('Tutorial mining failed');
    if (!store.getState().hotbar.includes('copper-ore')) throw new Error('Mined item skipped hotbar row');
    store.getState().setShopOpen(true, 'ore');
    store.getState().trade('copper-ore', -copper);
    if ((store.getState().inventory['copper-ore'] || 0) !== 0) throw new Error('Tutorial ore sale failed');

    store.getState().setTutorialStep(4);
    store.getState().collectForage('ForageAppleTutorial', 'apple');
    const apples = store.getState().inventory.apple || 0;
    if (apples < 1) throw new Error('Tutorial forage failed');
    if (!store.getState().hotbar.includes('apple')) throw new Error('Foraged item skipped hotbar row');
    store.getState().setShopOpen(true, 'forage-sell');
    store.getState().trade('apple', -apples);
    if ((store.getState().inventory.apple || 0) !== 0) throw new Error('Tutorial forage sale failed');

    store.getState().setTutorialStep(5);
    store.getState().farmAction(0, 0);
    if (store.getState().farmCells['0:0']?.stage !== 'planted') throw new Error('Tutorial planting skipped the required watering step');
    store.getState().setSelectedHotbar(1);
    store.getState().farmAction(0, 0);
    const planted = store.getState().farmCells['0:0'];
    if (planted?.stage !== 'watered' || planted.readyAt - Date.now() > 4100) throw new Error('Tutorial crop timer was not accelerated');
    let farmPrompt = '';
    for (let attempt = 0; attempt < 8 && !farmPrompt; attempt += 1) {
      // The live targeter owns this state and may clear a synthetic target between frames.
      // Reassert the real candidate rather than pausing the interaction system for the test.
      store.setState({ prompt: { id: 'farm-cell:0:0', label: 'Use Plot', anchor: 'FarmCell0_00', point: [0,0,0] } });
      await new Promise((resolve) => setTimeout(resolve, 12));
      farmPrompt = document.querySelector('.farm-status')?.textContent || '';
    }
    if (!/\\d+s/.test(farmPrompt) || /USE PLOT|LMB|\\bF\\b/i.test(farmPrompt)) throw new Error('Farm hover did not show a clean grow timer: ' + JSON.stringify({ farmPrompt, prompt: store.getState().prompt, shared: store.getState().sharedFarmOnline, tutorial: store.getState().tutorialActive, cell: store.getState().farmCells['0:0'] }));
    store.setState((state) => ({ farmCells: { ...state.farmCells, '0:0': { ...state.farmCells['0:0'], readyAt: Date.now() - 1 } } }));
    store.getState().tickGame();
    store.getState().farmAction(0, 0);
    if (store.getState().stats.harvested < 1) throw new Error('Tutorial harvest failed');
    if (!store.getState().hotbar.includes('wheat')) throw new Error('Harvested crop skipped hotbar row');

    store.getState().setTutorialStep(6);
    store.getState().setCookbookOpen(true, 0);
    store.getState().cookRecipe('apple-bread', 1);
    if (!store.getState().cookQueue.length || store.getState().cookQueue[0].readyAt - Date.now() > 3100) throw new Error('Tutorial cooking timer was not accelerated');
    store.setState((state) => ({ cookQueue: state.cookQueue.map((job) => ({ ...job, readyAt: Date.now() - 1 })) }));
    store.getState().tickGame();
    if ((store.getState().inventory['food-apple-bread'] || 0) !== 0) throw new Error('Finished dish was collected automatically');
    if (!store.getState().cookQueue.some((job) => job.readyAt <= Date.now())) throw new Error('Finished dish did not remain at the furnace');
    store.getState().collectCooked('apple-bread');
    if ((store.getState().inventory['food-apple-bread'] || 0) < 1) throw new Error('Finished dish did not enter inventory');
    if (!store.getState().hotbar.includes('food-apple-bread')) throw new Error('Finished dish skipped hotbar row');
    if (store.getState().cookQueue.some((job) => job.readyAt <= Date.now())) throw new Error('Collected dish remained at furnace');
    const collectedOnce = store.getState().inventory['food-apple-bread'] || 0;
    store.getState().collectCooked('apple-bread');
    if ((store.getState().inventory['food-apple-bread'] || 0) !== collectedOnce) throw new Error('Finished dish could be collected twice');
    store.getState().sellFood('apple-bread', 1);
    if ((store.getState().inventory['food-apple-bread'] || 0) !== 0) throw new Error('Tutorial food sale failed');

    store.getState().setTutorialStep(7);
    store.getState().setShopOpen(true, 'food');
    await new Promise((resolve) => setTimeout(resolve, 700));
    if ((store.getState().foodPriceHistory['apple-bread'] || []).length !== 2) throw new Error('Tutorial market did not demonstrate an actual price change');

    store.getState().setTutorialStep(8);
    store.getState().setStockOpen(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (store.getState().stockHistory.apple.length !== 2) throw new Error('Tutorial stock screen did not demonstrate an immediate price change');

    store.getState().setTutorialStep(9);
    store.getState().enhanceEquipment('worn-pickaxe');
    if ((store.getState().enhancements['worn-pickaxe'] || 0) !== 1) throw new Error('Guaranteed tutorial upgrade failed');
    const midSave = localStorage.getItem('project01-save-v12');
    if (midSave !== initialSave) throw new Error('Tutorial state leaked into durable save');

    store.getState().completeGuide();
    const restored = pick(store.getState());
    return { initial, restored, active: store.getState().tutorialActive, ready: store.getState().lobbySelfReady };
  })()`)
  assert(!result.active, 'Tutorial remained active after completion')
  assert(result.ready, 'Tutorial completion did not ready the player')
  assert(JSON.stringify(result.initial) === JSON.stringify(result.restored), 'Tutorial did not restore the original state exactly')
  console.log('Tutorial validation passed: movable control reference, real recipe and tool progression, explicit mine/forage/farm/cook actions, required watering, manual furnace collection, immediate market demonstrations, row-one acquisition, guaranteed upgrade, save protection, and exact restoration.')
} finally {
  socket.close()
  chrome.kill()
  await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), sleep(2_000)])
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { await rm(profile, { recursive: true, force: true }); break }
    catch (error) { if (attempt === 3) console.warn(`Temporary browser profile kept: ${error.message}`); else await sleep(300) }
  }
}
