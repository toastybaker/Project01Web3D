import { ITEMS, type ItemId } from '../src/game/items'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const permanentEquipment: ItemId[] = [
  'iron-pickaxe',
  'steel-pickaxe',
  'crystal-pickaxe',
  'basket',
  'reinforced-basket',
  'master-basket',
  'harvest-charm',
]

assert(ITEMS['farm-deed'].limited === true, 'Farm deeds must remain stock-limited')
assert(ITEMS['shared-farm-deed'].limited === true, 'Extra farm deeds must remain stock-limited')
assert(permanentEquipment.every((id) => !ITEMS[id].limited), 'Permanent equipment must be ownership-gated, not stock-gated')

console.log(JSON.stringify({ status: 'pass', stockLimited: ['farm-deed', 'shared-farm-deed'], ownershipGated: permanentEquipment }, null, 2))
