import assert from 'node:assert/strict'
import {
  ENHANCEABLE_ITEMS,
  ENHANCEMENT_WARDS,
  canUseEnhancementWard,
  enhancementCoinMultiplier,
  enhancementRequirements,
  enhancementWardForTarget,
  resolveEnhancementAttempt,
  type EnhanceableItem,
  type EnhancementInventory,
} from '../src/game/enhancement'
import type { ItemId } from '../src/game/items'

const SEQUENCE_COUNT = 100_000
const CHECKPOINTS = [3, 4, 5, 6] as const
const STARTING_CASH = 1_000_000_000_000_000
const MATERIAL_RESERVE = 1_000_000_000_000
const MAX_ATTEMPTS_PER_SEQUENCE = 1_000_000
const BASE_SEED = 0x51ed2701

type Checkpoint = typeof CHECKPOINTS[number]
type CheckpointKey = `+${Checkpoint}`
type WardMode = 'off' | 'on'

type Distribution = {
  mean: number
  median: number
  p10: number
  p90: number
}

type CheckpointReport = {
  coinCost: Distribution
  materialConsumption: Distribution
  wardsConsumed: Distribution
}

type ScenarioReport = {
  item: EnhanceableItem
  costMultiplier: number
  ward: WardMode
  checkpoints: Record<CheckpointKey, CheckpointReport>
}

type SampleBuckets = {
  coinCost: number[]
  materialConsumption: number[]
  wardsConsumed: number[]
}

type SequenceCheckpoint = {
  coinCost: number
  materialConsumption: number
  wardsConsumed: number
}

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0
    return value / 4_294_967_296
  }
}

function checkpointKey(checkpoint: Checkpoint): CheckpointKey {
  return `+${checkpoint}` as CheckpointKey
}

function materialIdsFor(item: EnhanceableItem) {
  const ids = new Set<ItemId>()
  for (let target = 1; target <= 6; target += 1) {
    for (const id of Object.keys(enhancementRequirements(item, target).materials)) ids.add(id as ItemId)
  }
  return [...ids]
}

function initialInventory(item: EnhanceableItem, wardEnabled: boolean): EnhancementInventory {
  const inventory: EnhancementInventory = { [item]: 1 }
  for (const id of materialIdsFor(item)) inventory[id] = MATERIAL_RESERVE
  if (wardEnabled) {
    for (const ward of Object.values(ENHANCEMENT_WARDS)) inventory[ward] = MATERIAL_RESERVE
  }
  return inventory
}

function runFullSequence(item: EnhanceableItem, wardEnabled: boolean, random: () => number) {
  let current = 0
  let cash = STARTING_CASH
  let inventory = initialInventory(item, wardEnabled)
  let coinCost = 0
  let materialConsumption = 0
  let wardsConsumed = 0
  let attempts = 0
  const checkpoints = new Map<Checkpoint, SequenceCheckpoint>()

  while (current < 6) {
    attempts += 1
    if (attempts > MAX_ATTEMPTS_PER_SEQUENCE) {
      throw new Error(`${item} ${wardEnabled ? 'ward-on' : 'ward-off'} did not reach +6 within ${MAX_ATTEMPTS_PER_SEQUENCE} attempts`)
    }

    const target = current + 1
    const matchingWard = enhancementWardForTarget(target)
    const ward = wardEnabled && matchingWard && (inventory[matchingWard] ?? 0) > 0
      ? matchingWard
      : undefined
    if (ward) assert.ok(canUseEnhancementWard(ward, target), `non-matching ward selected for +${target}`)
    const options = ward ? { ward } : {}
    const requirements = enhancementRequirements(item, target)
    const cashBefore = cash
    const result = resolveEnhancementAttempt(item, current, cash, inventory, options, random())
    if (!result.ok) throw new Error(`${item} ${wardEnabled ? 'ward-on' : 'ward-off'} rejected a funded attempt at +${target}: ${result.reason}`)

    const attemptCoinCost = cashBefore - result.cash
    assert.ok(Number.isFinite(attemptCoinCost) && attemptCoinCost >= 0, `${item} produced invalid attempt coin cost`)
    coinCost += attemptCoinCost
    materialConsumption += Object.values(requirements.materials).reduce((sum, quantity) => sum + Number(quantity), 0)
    if (result.wardUsed) wardsConsumed += 1

    current = result.level
    cash = result.cash
    inventory = result.inventory
    for (const checkpoint of CHECKPOINTS) {
      if (current >= checkpoint && !checkpoints.has(checkpoint)) {
        checkpoints.set(checkpoint, { coinCost, materialConsumption, wardsConsumed })
      }
    }
  }

  for (const checkpoint of CHECKPOINTS) {
    assert.ok(checkpoints.has(checkpoint), `${item} did not record +${checkpoint}`)
  }
  return checkpoints as Map<Checkpoint, SequenceCheckpoint>
}

function roundForReport(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function percentile(sorted: number[], fraction: number) {
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

function distribution(values: number[]): Distribution {
  assert.equal(values.length, SEQUENCE_COUNT)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  assert.ok(Number.isFinite(mean) && mean >= 0, 'distribution mean must be finite and nonnegative')
  values.sort((a, b) => a - b)
  const report = {
    mean: roundForReport(mean),
    median: roundForReport(percentile(values, .50)),
    p10: roundForReport(percentile(values, .10)),
    p90: roundForReport(percentile(values, .90)),
  }
  for (const value of Object.values(report)) assert.ok(Number.isFinite(value) && value >= 0, 'distribution value must be finite and nonnegative')
  assert.ok(report.p10 <= report.median && report.median <= report.p90, 'percentiles must be ordered')
  return report
}

function scenarioSeed(itemIndex: number) {
  return (BASE_SEED + Math.imul(itemIndex + 1, 0x9e3779b9)) >>> 0
}

function runScenario(item: EnhanceableItem, itemIndex: number, wardMode: WardMode): ScenarioReport {
  const wardEnabled = wardMode === 'on'
  const buckets = new Map<Checkpoint, SampleBuckets>()
  for (const checkpoint of CHECKPOINTS) {
    buckets.set(checkpoint, { coinCost: [], materialConsumption: [], wardsConsumed: [] })
  }

  const random = seededRandom(scenarioSeed(itemIndex))
  for (let sequence = 0; sequence < SEQUENCE_COUNT; sequence += 1) {
    const result = runFullSequence(item, wardEnabled, random)
    for (const checkpoint of CHECKPOINTS) {
      const sample = result.get(checkpoint)!
      const bucket = buckets.get(checkpoint)!
      bucket.coinCost.push(sample.coinCost)
      bucket.materialConsumption.push(sample.materialConsumption)
      bucket.wardsConsumed.push(sample.wardsConsumed)
    }
  }

  const checkpoints = {} as Record<CheckpointKey, CheckpointReport>
  for (const checkpoint of CHECKPOINTS) {
    const bucket = buckets.get(checkpoint)!
    checkpoints[checkpointKey(checkpoint)] = {
      coinCost: distribution(bucket.coinCost),
      materialConsumption: distribution(bucket.materialConsumption),
      wardsConsumed: distribution(bucket.wardsConsumed),
    }
  }
  return { item, costMultiplier: enhancementCoinMultiplier(item), ward: wardMode, checkpoints }
}

function assertWardBehavior() {
  const item: EnhanceableItem = 'iron-pickaxe'
  for (const target of [4, 5, 6] as const) {
    const current = target - 1
    const ward = enhancementWardForTarget(target)
    if (!ward) throw new Error(`missing matching ward for +${target}`)
    const requirements = enhancementRequirements(item, target)
    const baseInventory: EnhancementInventory = { [item]: 1, [ward]: 1 }
    for (const id of Object.keys(requirements.materials)) baseInventory[id as ItemId] = MATERIAL_RESERVE

    const off = resolveEnhancementAttempt(item, current, STARTING_CASH, { ...baseInventory, [ward]: 0 }, {}, 1)
    const on = resolveEnhancementAttempt(item, current, STARTING_CASH, baseInventory, { ward }, 1)
    assert.equal(off.ok, true, `ward-off +${target} check was rejected`)
    assert.equal(on.ok, true, `ward-on +${target} check was rejected`)
    assert.equal(off.success, false, `ward-off +${target} check unexpectedly succeeded`)
    assert.equal(on.success, false, `ward-on +${target} check unexpectedly succeeded`)
    assert.equal(off.level, Math.max(0, current - 1), `ward-off +${target} did not downgrade`)
    assert.equal(on.level, current, `matching ward did not protect +${target}`)
    assert.equal(on.wardUsed, ward, `matching ward was not consumed at +${target}`)
    assert.equal(on.inventory[ward], 0, `matching ward inventory was not decremented at +${target}`)
  }
}

function assertReport(report: { scenarios: ScenarioReport[] }) {
  const multipliers = [...new Set(report.scenarios.map((scenario) => scenario.costMultiplier))].sort((a, b) => a - b)
  assert.deepEqual(multipliers, [.75, 1, 1.5, 2.25], 'meaningful equipment multipliers drifted')
  assert.equal(report.scenarios.length, ENHANCEABLE_ITEMS.length * 2, 'missing ward-on/off scenario')

  for (const scenario of report.scenarios) {
    assert.ok(Number.isFinite(scenario.costMultiplier) && scenario.costMultiplier > 0, `${scenario.item} has invalid multiplier`)
    for (const checkpoint of CHECKPOINTS) {
      const metrics = scenario.checkpoints[checkpointKey(checkpoint)]
      for (const distributionName of ['coinCost', 'materialConsumption', 'wardsConsumed'] as const) {
        const values = metrics[distributionName]
        for (const value of Object.values(values)) assert.ok(Number.isFinite(value) && value >= 0, `${scenario.item} ${scenario.ward} +${checkpoint} ${distributionName} is invalid`)
        assert.ok(values.p10 <= values.median && values.median <= values.p90, `${scenario.item} ${scenario.ward} +${checkpoint} percentiles are unordered`)
      }
      if (scenario.ward === 'off' || checkpoint === 3) assert.equal(metrics.wardsConsumed.mean, 0, `${scenario.item} ${scenario.ward} consumed an unexpected ward through +${checkpoint}`)
      else assert.ok(metrics.wardsConsumed.mean > 0, `${scenario.item} ward-on consumed no matching wards through +${checkpoint}`)
    }
  }

  for (const item of ENHANCEABLE_ITEMS) {
    const off = report.scenarios.find((scenario) => scenario.item === item && scenario.ward === 'off')!
    const on = report.scenarios.find((scenario) => scenario.item === item && scenario.ward === 'on')!
    for (const checkpoint of CHECKPOINTS) {
      assert.ok(on.checkpoints[checkpointKey(checkpoint)].coinCost.mean <= off.checkpoints[checkpointKey(checkpoint)].coinCost.mean * 1.01, `${item} matching wards increased expected coin cost through +${checkpoint}`)
    }
  }
}

assertWardBehavior()
const report = {
  sequencesPerScenario: SEQUENCE_COUNT,
  checkpoints: CHECKPOINTS.map(checkpointKey),
  materialMetric: 'raw recipe quantity across all material IDs; wards are reported separately',
  scenarios: ENHANCEABLE_ITEMS.flatMap((item, itemIndex) => [
    runScenario(item, itemIndex, 'off'),
    runScenario(item, itemIndex, 'on'),
  ]),
}
assertReport(report)

const repeat = {
  sequencesPerScenario: SEQUENCE_COUNT,
  checkpoints: CHECKPOINTS.map(checkpointKey),
  materialMetric: 'raw recipe quantity across all material IDs; wards are reported separately',
  scenarios: ENHANCEABLE_ITEMS.flatMap((item, itemIndex) => [
    runScenario(item, itemIndex, 'off'),
    runScenario(item, itemIndex, 'on'),
  ]),
}
assert.deepEqual(repeat, report, 'same seeded simulations produced different output')

console.log(JSON.stringify({ ...report, status: 'passed' }, null, 2))
