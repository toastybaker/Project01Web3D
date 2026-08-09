import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ITEMS, SHOPS } from '../src/game/items'
import { itemName, localizedItemIds, shopName, uiText, zoneName } from '../src/game/i18n'

assert.equal(zoneName('ko', 'hub'), '로비')
assert.equal(zoneName('ko', 'forage'), '채집')
assert.equal(zoneName('ko', 'farm'), '농장')
assert.equal(zoneName('ko', 'mine'), '광산')
assert.equal(uiText('ko', 'Mining Rush'), '채광 대회')
assert.equal(uiText('ko', 'Kitchen Rush'), '요리 대회')
assert.equal(uiText('ko', 'Forage Race'), '채집 경주')
assert.equal(uiText('ko', 'Recipe unlocked!'), '새 레시피!')
assert.equal(uiText('ko', 'Stock Exchange'), '주식')
assert.equal(uiText('ko', 'General Shop'), '상점')
assert.equal(uiText('ko', 'Hand Gathering'), '맨손 채집')
assert.equal(uiText('en', 'Recipe unlocked!'), 'Recipe unlocked!')
assert.equal(uiText('ko', 'Opens at 12m'), '12분 후 공개')
assert.equal(uiText('ko', 'Plant wheat'), '밀 심기')
assert.equal(uiText('ko', 'Equip Watering Can'), '물뿌리개 선택')
assert.equal(uiText('ko', '+3 Iron Ore'), '+3 철 원석')
assert.equal(uiText('ko', 'Low'), '낮음')
assert.equal(uiText('ko', 'Medium'), '보통')
assert.equal(uiText('ko', 'High'), '높음')
assert.equal(uiText('ko', 'Shift Lock'), uiText('ko', 'Lock'), 'camera-lock terminology must stay consistent')
assert.equal(shopName('ko', 'forage', 'Forage Shop'), '채집 도구')
assert.equal(shopName('ko', 'forage-sell', 'Forage Market'), '채집품 판매')
assert.equal(shopName('ko', 'produce', 'Crop Market'), '농작물 판매')
assert.equal(shopName('ko', 'food', 'Food Market'), '요리 판매')
assert.equal(shopName('ko', 'mine', 'Mining Shop'), '채광 도구')
assert.equal(shopName('ko', 'ore', 'Ore Market'), '광석 판매')
assert.equal(uiText('ko', 'Buy: LMB'), '구매: 좌클릭')
assert.equal(uiText('ko', 'Sell: RMB'), '판매: 우클릭')
assert.equal(uiText('ko', '×10: Shift'), '10개씩: Shift')
assert.equal(uiText('ko', 'Upgraded · Crystal Pickaxe +1'), '수정 곡괭이 +1 강화 성공')
assert.equal(uiText('ko', 'Upgrade failed · kept +3'), '강화 실패 · +3 유지')
assert.equal(uiText('ko', 'Upgrade failed · dropped to +2'), '강화 실패 · +2로 하락')
assert.equal(uiText('ko', 'Player abcd'), '플레이어 abcd')

const interactionAndToastCopy = [
  'Use Plot', 'Harvest Apples', 'Harvest Oranges', 'Gather Truffle', 'Inspect Fossil', 'Claim Farm', 'Mine Ore',
  'Select seeds', 'Need seeds', 'Select watering can', 'Planted', 'Planted · watered', 'Watered',
  'Already owned', 'Purchase pending', 'Shop unavailable', 'Choose 3 numbers', 'Gone for now',
  'Already purchased', 'Information added', 'Merchant unavailable', 'Could not buy', 'Item not owned',
  'Protection unavailable', 'Discount unavailable', 'Use after the event', 'Nothing cooking',
  'Choose your farm', 'No dry crops', 'Farm watered', 'Recipe not learned', 'Fruit storage full',
] as const
for (const copy of interactionAndToastCopy) assert.notEqual(uiText('ko', copy), copy, `UI copy remained English: ${copy}`)

const runtimeCopy = new Set<string>()
for (const file of ['src/game/store.ts', 'src/App.tsx', 'server/index.ts']) {
  const source = readFileSync(file, 'utf8')
  for (const pattern of [/toast:\s*'([^']+)'/g, /setToast\('([^']+)'\)/g, /reason:\s*'([^']+)'/g, /fail\('([^']+)'\)/g]) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source))) runtimeCopy.add(match[1])
  }
}
const untranslatedRuntime = [...runtimeCopy].filter((copy) => uiText('ko', copy) === copy && !/^[A-Z]{1,5} [+-]\d+(?:\.\d+)?%$/.test(copy))
assert.deepEqual(untranslatedRuntime, [], `Runtime popups remained English:\n${untranslatedRuntime.join('\n')}`)

for (const [id, item] of Object.entries(ITEMS)) {
  assert(localizedItemIds[id as keyof typeof localizedItemIds], `missing Korean item name: ${id}`)
  assert.notEqual(itemName('ko', id as keyof typeof ITEMS, item.name), item.name, `item remained English: ${id}`)
}
for (const [kind, shop] of Object.entries(SHOPS)) {
  assert.notEqual(shopName('ko', kind as keyof typeof SHOPS, shop.title), shop.title, `shop remained English: ${kind}`)
}

console.log(JSON.stringify({ status: 'passed', items: Object.keys(ITEMS).length, shops: Object.keys(SHOPS).length, runtimePopups: runtimeCopy.size }, null, 2))
