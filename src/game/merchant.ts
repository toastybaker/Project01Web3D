export const MERCHANT_CYCLE_MS = 4 * 60 * 1000
export const MERCHANT_MIN_SLOTS = 2
export const MERCHANT_MAX_SLOTS = 4
export const DEFAULT_MATCH_DURATION_MS = 60 * 60 * 1000

export type MerchantItemId =
  | 'mining-boost'
  | 'fortune-boost'
  | 'cook-timer'
  | 'rain-bottle'
  | 'upgrade-coupon'
  | 'cookbook-box'
  | 'upgrade-guard-4'
  | 'upgrade-guard-5'
  | 'upgrade-guard-6'

export type MerchantStage = 'first' | 'middle' | 'final'

export type MerchantItemDefinition = Readonly<{
  id: MerchantItemId
  name: string
  basePrice: number
  balanceValue: number
  appearanceChance: number
  globalStock: number
  eligibleAfter: number
  commonFallback: boolean
}>

const item = (definition: MerchantItemDefinition) => Object.freeze(definition)

export const MERCHANT_ITEMS: Readonly<Record<MerchantItemId, MerchantItemDefinition>> = Object.freeze({
  'mining-boost': item({ id: 'mining-boost', name: 'Mining Tonic', basePrice: 350_000, balanceValue: 500_000, appearanceChance: .35, globalStock: 2, eligibleAfter: 0, commonFallback: true }),
  'fortune-boost': item({ id: 'fortune-boost', name: 'Luck Tonic', basePrice: 450_000, balanceValue: 650_000, appearanceChance: .30, globalStock: 2, eligibleAfter: 0, commonFallback: true }),
  'cook-timer': item({ id: 'cook-timer', name: 'Cook Timer', basePrice: 325_000, balanceValue: 450_000, appearanceChance: .25, globalStock: 2, eligibleAfter: 0, commonFallback: true }),
  'rain-bottle': item({ id: 'rain-bottle', name: 'Rain Bottle', basePrice: 375_000, balanceValue: 500_000, appearanceChance: .20, globalStock: 1, eligibleAfter: 0, commonFallback: false }),
  'upgrade-coupon': item({ id: 'upgrade-coupon', name: '30% Upgrade Discount', basePrice: 450_000, balanceValue: 600_000, appearanceChance: .15, globalStock: 1, eligibleAfter: .25, commonFallback: false }),
  'cookbook-box': item({ id: 'cookbook-box', name: 'Recipe Box', basePrice: 450_000, balanceValue: 600_000, appearanceChance: .25, globalStock: 1, eligibleAfter: 0, commonFallback: true }),
  'upgrade-guard-4': item({ id: 'upgrade-guard-4', name: '+4 Protection', basePrice: 120_000, balanceValue: 150_000, appearanceChance: .22, globalStock: 2, eligibleAfter: .15, commonFallback: false }),
  'upgrade-guard-5': item({ id: 'upgrade-guard-5', name: '+5 Protection', basePrice: 550_000, balanceValue: 650_000, appearanceChance: .14, globalStock: 1, eligibleAfter: .33, commonFallback: false }),
  'upgrade-guard-6': item({ id: 'upgrade-guard-6', name: '+6 Protection', basePrice: 2_000_000, balanceValue: 3_000_000, appearanceChance: .08, globalStock: 1, eligibleAfter: .60, commonFallback: false }),
})

export const MERCHANT_ITEM_IDS = Object.freeze(Object.keys(MERCHANT_ITEMS) as MerchantItemId[])
export const MERCHANT_COMMON_ITEM_IDS = Object.freeze(
  MERCHANT_ITEM_IDS.filter((id) => MERCHANT_ITEMS[id].commonFallback),
)

export type MerchantInventoryItem = Readonly<{
  id: MerchantItemId
  name: string
  price: number
  stock: number
  maxStock: number
}>

export type MerchantCycle = Readonly<{
  id: string
  matchSeed: number
  index: number
  startsAtMs: number
  endsAtMs: number
  stage: MerchantStage
  inventory: readonly MerchantInventoryItem[]
}>

export type MerchantScheduleOptions = Readonly<{
  matchSeed: number
  matchStartedAtMs: number
  matchDurationMs: number
}>

export type MerchantStockResult =
  | Readonly<{ ok: true; cycle: MerchantCycle; itemId: MerchantItemId; quantity: number; remainingStock: number }>
  | Readonly<{ ok: false; cycle: MerchantCycle; reason: 'invalid-quantity' | 'not-offered' | 'sold-out' }>

function finiteNumber(value: number, label: string) {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`)
  return value
}

function positiveDuration(value: number) {
  finiteNumber(value, 'matchDurationMs')
  if (value <= 0) throw new RangeError('matchDurationMs must be greater than zero')
  return value
}

function normalizedSeed(seed: number) {
  return Math.trunc(finiteNumber(seed, 'matchSeed'))
}

function hash01(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d)
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b)
  hash ^= hash >>> 16
  return (hash >>> 0) / 4294967296
}

function cycleRandom(matchSeed: number, cycleIndex: number, domain: string) {
  return hash01(`${normalizedSeed(matchSeed)}:${cycleIndex}:${domain}`)
}

export function merchantCycleIdentity(matchSeed: number, matchStartedAtMs: number, cycleIndex: number) {
  const index = Math.trunc(finiteNumber(cycleIndex, 'cycleIndex'))
  if (index < 0) throw new RangeError('cycleIndex must not be negative')
  return `merchant:${normalizedSeed(matchSeed)}:${Math.trunc(finiteNumber(matchStartedAtMs, 'matchStartedAtMs'))}:${index}`
}

export function merchantItemRoll(matchSeed: number, cycleIndex: number, itemId: MerchantItemId) {
  return cycleRandom(matchSeed, cycleIndex, `roll:${itemId}`)
}

export function merchantStage(elapsedMs: number, matchDurationMs: number): MerchantStage {
  const progress = Math.max(0, finiteNumber(elapsedMs, 'elapsedMs')) / positiveDuration(matchDurationMs)
  if (progress < 1 / 3) return 'first'
  if (progress < 2 / 3) return 'middle'
  return 'final'
}

export function merchantStageMultiplier(stage: MerchantStage) {
  // Scarcity is the reason to hunt the merchant. Prices only rise gently with
  // match progress so a found offer remains a bargain rather than an exact EV
  // exchange at the moment it becomes useful.
  if (stage === 'middle') return 1.08
  if (stage === 'final') return 1.16
  return 1
}

export function merchantPrice(itemId: MerchantItemId, stage: MerchantStage) {
  return Math.round((MERCHANT_ITEMS[itemId].basePrice * merchantStageMultiplier(stage)) / 10_000) * 10_000
}

export function isMerchantItemEligible(itemId: MerchantItemId, elapsedMs: number, matchDurationMs: number) {
  const progress = Math.max(0, finiteNumber(elapsedMs, 'elapsedMs')) / positiveDuration(matchDurationMs)
  return progress >= MERCHANT_ITEMS[itemId].eligibleAfter
}

function selectedItemIds(matchSeed: number, cycleIndex: number, elapsedMs: number, matchDurationMs: number) {
  const successful = MERCHANT_ITEM_IDS.filter((id) => (
    isMerchantItemEligible(id, elapsedMs, matchDurationMs)
    && merchantItemRoll(matchSeed, cycleIndex, id) < MERCHANT_ITEMS[id].appearanceChance
  ))

  // Information is sold separately. The item shelf should still look like a
  // useful travelling shop every time it is found, rather than occasionally
  // collapsing to one object after a sparse roll.
  if (successful.length < MERCHANT_MIN_SLOTS) {
    const fallbacks = MERCHANT_COMMON_ITEM_IDS
      .filter((id) => !successful.includes(id) && isMerchantItemEligible(id, elapsedMs, matchDurationMs))
      .sort((left, right) => (
      cycleRandom(matchSeed, cycleIndex, `fallback:${left}`) - cycleRandom(matchSeed, cycleIndex, `fallback:${right}`)
      || left.localeCompare(right)
      ))
    successful.push(...fallbacks.slice(0, MERCHANT_MIN_SLOTS - successful.length))
  }

  if (successful.length <= MERCHANT_MAX_SLOTS) return successful
  return successful
    .sort((left, right) => (
      cycleRandom(matchSeed, cycleIndex, `slot:${left}`) - cycleRandom(matchSeed, cycleIndex, `slot:${right}`)
      || left.localeCompare(right)
    ))
    .slice(0, MERCHANT_MAX_SLOTS)
}

export function merchantCycle(options: MerchantScheduleOptions, cycleIndex: number): MerchantCycle {
  const matchSeed = normalizedSeed(options.matchSeed)
  const matchStartedAtMs = finiteNumber(options.matchStartedAtMs, 'matchStartedAtMs')
  const matchDurationMs = positiveDuration(options.matchDurationMs)
  const index = Math.trunc(finiteNumber(cycleIndex, 'cycleIndex'))
  const cycleCount = Math.ceil(matchDurationMs / MERCHANT_CYCLE_MS)
  if (index < 0 || index >= cycleCount) throw new RangeError(`cycleIndex must be between 0 and ${cycleCount - 1}`)

  const elapsedMs = index * MERCHANT_CYCLE_MS
  const startsAtMs = matchStartedAtMs + elapsedMs
  const endsAtMs = Math.min(matchStartedAtMs + matchDurationMs, startsAtMs + MERCHANT_CYCLE_MS)
  const stage = merchantStage(elapsedMs, matchDurationMs)
  const inventory = selectedItemIds(matchSeed, index, elapsedMs, matchDurationMs).map((id) => {
    const definition = MERCHANT_ITEMS[id]
    return Object.freeze({ id, name: definition.name, price: merchantPrice(id, stage), stock: definition.globalStock, maxStock: definition.globalStock })
  })

  return Object.freeze({
    id: merchantCycleIdentity(matchSeed, matchStartedAtMs, index),
    matchSeed,
    index,
    startsAtMs,
    endsAtMs,
    stage,
    inventory: Object.freeze(inventory),
  })
}

export function merchantSchedule(options: MerchantScheduleOptions) {
  const cycleCount = Math.ceil(positiveDuration(options.matchDurationMs) / MERCHANT_CYCLE_MS)
  return Object.freeze(Array.from({ length: cycleCount }, (_, index) => merchantCycle(options, index)))
}

export function currentMerchantCycle(options: MerchantScheduleOptions, nowMs: number) {
  const now = finiteNumber(nowMs, 'nowMs')
  const elapsedMs = now - finiteNumber(options.matchStartedAtMs, 'matchStartedAtMs')
  const durationMs = positiveDuration(options.matchDurationMs)
  if (elapsedMs < 0 || elapsedMs >= durationMs) return null
  return merchantCycle(options, Math.floor(elapsedMs / MERCHANT_CYCLE_MS))
}

// The authoritative server should apply this reducer to its latest cycle state inside
// its serialized room command. Clients can use the same result shape for snapshots.
export function consumeMerchantStock(cycle: MerchantCycle, itemId: MerchantItemId, quantity = 1): MerchantStockResult {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return { ok: false, cycle, reason: 'invalid-quantity' }
  const itemIndex = cycle.inventory.findIndex((entry) => entry.id === itemId)
  if (itemIndex < 0) return { ok: false, cycle, reason: 'not-offered' }
  const current = cycle.inventory[itemIndex]
  if (current.stock < quantity) return { ok: false, cycle, reason: 'sold-out' }

  const inventory = cycle.inventory.map((entry, index) => (
    index === itemIndex ? Object.freeze({ ...entry, stock: entry.stock - quantity }) : entry
  ))
  const updatedCycle = Object.freeze({ ...cycle, inventory: Object.freeze(inventory) })
  return { ok: true, cycle: updatedCycle, itemId, quantity, remainingStock: current.stock - quantity }
}
