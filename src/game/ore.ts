import { MATCH_CONFIG, ORE_CONFIG, PICKAXE_CONFIG } from './config'
import type { ItemId } from './items'
import { enhancedMiningSpeed, enhancedYield } from './enhancement'

export type OreItem = keyof typeof ORE_CONFIG
export type PickaxeItem = keyof typeof PICKAXE_CONFIG

export const ORE_COLORS: Record<OreItem, string> = {
  'copper-ore': '#a94f2f',
  'iron-ore': '#526b75',
  'silver-ore': '#aabfcd',
  'gold-ore': '#c58a1d',
  'crystal-ore': '#1688c4',
  'ancient-ore': '#773dac',
}

function clamp(value: number, min = 0, max = 1) { return Math.min(max, Math.max(min, value)) }
function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}
function hash01(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return (hash >>> 0) / 4294967296
}

export function mineDepth(z: number) { return clamp((-z - 8) / 145) }

export function oreWeightsAtDepth(z: number): Record<OreItem, number> {
  const depth = mineDepth(z)
  return {
    'copper-ore': 9 - 4.1 * depth ** 1.15,
    'iron-ore': 1 + 2.15 * depth ** 0.78,
    'silver-ore': 2.2 * smoothstep(0.12, 0.95, depth) ** 1.35,
    'gold-ore': 1.15 * smoothstep(0.34, 1, depth) ** 1.7,
    'crystal-ore': 0.46 * smoothstep(0.58, 1, depth) ** 2.1,
    'ancient-ore': 0.08 * smoothstep(0.8, 1, depth) ** 3.2,
  }
}

export function oreKindAtDepth(nodeId: string, z: number, generation = 0, matchSeed = 0): OreItem {
  const weights = oreWeightsAtDepth(z)
  const ordered = Object.entries(weights) as Array<[OreItem, number]>
  const total = ordered.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = hash01(`${Math.floor(matchSeed)}:${nodeId}:${Math.floor(generation)}`) * total
  for (const [item, weight] of ordered) { roll -= weight; if (roll <= 0) return item }
  return 'copper-ore'
}

export function isPickaxe(item: ItemId | null): item is PickaxeItem { return Boolean(item && item in PICKAXE_CONFIG) }
export function canMineOre(tool: ItemId | null, ore: OreItem) {
  return isPickaxe(tool) && (PICKAXE_CONFIG[tool].unlocks as readonly string[]).includes(ore)
}
export function miningDuration(tool: ItemId | null, ore: OreItem, enhancement = 0) {
  if (!canMineOre(tool, ore) || !isPickaxe(tool)) return 0
  return Math.max(MATCH_CONFIG.minimumMiningMs, Math.round(1_150 * ORE_CONFIG[ore].hardness / enhancedMiningSpeed(tool, enhancement)))
}
export function miningHits(tool: ItemId | null, ore: OreItem) {
  if (!canMineOre(tool, ore) || !isPickaxe(tool)) return 0
  return Math.max(2, Math.min(9, Math.ceil((ORE_CONFIG[ore].hardness * 2) / PICKAXE_CONFIG[tool].speed)))
}
export function requiredPickaxe(ore: OreItem): PickaxeItem {
  const entry = (Object.entries(PICKAXE_CONFIG) as Array<[PickaxeItem, (typeof PICKAXE_CONFIG)[PickaxeItem]]>)
    .find(([, config]) => (config.unlocks as readonly string[]).includes(ore))
  return entry?.[0] ?? 'crystal-pickaxe'
}
export function miningYield(tool: ItemId | null, random = Math.random(), enhancement = 0) {
  return isPickaxe(tool) ? enhancedYield(tool, enhancement, random) : 0
}
export function oreRespawnMs(nodeId = '', generation = 0, matchSeed = 0) {
  const [minimum, maximum] = MATCH_CONFIG.oreRespawnSeconds
  return Math.round((minimum + hash01(`${Math.floor(matchSeed)}:${nodeId}:${Math.floor(generation)}:respawn`) * (maximum - minimum)) * 1000)
}
