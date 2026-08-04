import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, useAnimations, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { Client as ColyseusClient } from 'colyseus.js'
import { economyProgressValue, secretSiteForRound, secretZoneForRound, useGameStore, type AnchorMap, type WorldCollider, type ZoneId } from './store'
import { ORE_COLORS, oreKindAtDepth } from './ore'
import { emitMultiplayer, setMultiplayerSender } from './multiplayer'
import { activeRareForageIds, forageSiteAvailability, fruitTreeCapacity } from './config'
import { miningRushOre, type MinigameKind } from './minigame'
import { playGameSfx } from './sfx'

const SCENES: Record<ZoneId, string> = {
  hub: '/assets/3d/scenes/hub.glb?v=14',
  forage: '/assets/3d/scenes/forage.glb?v=23',
  farm: '/assets/3d/scenes/farm.glb?v=15',
  mine: '/assets/3d/scenes/mine.glb?v=24',
}
const MINING_RUSH_SCENE = '/assets/3d/scenes/mining-rush.glb?v=10'
const FARM_RUSH_SCENE = '/assets/3d/scenes/farm-rush.glb?v=10'
const FORAGE_RUSH_SCENE = '/assets/3d/scenes/forage-rush.glb?v=7'
const MINIGAME_SCENES: Record<MinigameKind, string> = { mining: MINING_RUSH_SCENE, farm: FARM_RUSH_SCENE, forage: FORAGE_RUSH_SCENE }

const visualGateMode = new URLSearchParams(window.location.search).get('gate')
const resourceVisualTarget = new URLSearchParams(window.location.search).get('target')
const deepVisualGate = visualGateMode === 'deep'
const resourceVisualGate = visualGateMode === 'resource'
const furnaceVisualGate = visualGateMode === 'furnace'
const farmCellVisualGate = visualGateMode === 'cell'
const bypassLobbyClient = new URLSearchParams(window.location.search).has('gate') || new URLSearchParams(window.location.search).has('panel') || new URLSearchParams(window.location.search).has('zone')

const FALLBACK_SPAWNS: Record<ZoneId, [number, number, number]> = {
  hub: [0, 0, 14],
  forage: [0, 0, -69],
  farm: [0, 0, 17],
  mine: [0, 0, 34],
}
const FARM_RUSH_FALLBACK_SPAWNS: Array<[number, number, number]> = [
  [-36, 0, 25.5], [-12, 0, 25.5], [12, 0, 25.5], [36, 0, 25.5],
  [-36, 0, -6.5], [-12, 0, -6.5], [12, 0, -6.5], [36, 0, -6.5],
]
const MINING_RUSH_FALLBACK_SPAWNS: Array<[number, number, number]> = [
  [-36, 0, 29], [-12, 0, 29], [12, 0, 29], [36, 0, 29],
  [-36, 0, -7], [-12, 0, -7], [12, 0, -7], [36, 0, -7],
]
const MINING_RUSH_BAY_CENTERS: Array<[number, number]> = [
  [-36, 18], [-12, 18], [12, 18], [36, 18],
  [-36, -18], [-12, -18], [12, -18], [36, -18],
]

const mineFootprint: Array<[number, number]> = [
  [-10,24],[-18,12],[-40,8],[-57,-1],[-64,-18],[-62,-36],[-48,-51],[-61,-64],[-67,-82],[-61,-96],[-43,-108],[-54,-120],[-53,-139],[-45,-158],[-53,-176],[-43,-191],[-20,-199],
  [20,-199],[43,-191],[53,-176],[45,-158],[53,-139],[54,-120],[42,-108],[59,-98],[67,-83],[63,-63],[49,-50],[62,-36],[64,-17],[57,-1],[40,8],[18,12],[10,24],
]

function pointInMine(x: number, z: number) {
  if (z >= 22) return Math.abs(x) <= 72 && z <= 77
  let inside = false
  for (let i = 0, j = mineFootprint.length - 1; i < mineFootprint.length; j = i++) {
    const [xi, zi] = mineFootprint[i]
    const [xj, zj] = mineFootprint[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

const forageTrail: Array<[number, number]> = [[0, 22], [1, 12], [-2, 0], [-8, -16], [-3, -34], [9, -52], [4, -72], [-12, -91], [-5, -112], [8, -132], [-2, -154], [10, -177], [2, -203]]
const farmParcels: Array<[number, number]> = [
  [-54, -16], [-18, -14], [19, -17], [55, -13],
  [-53, -50], [-17, -49], [20, -53], [56, -48],
]

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function trailCenterAt(z: number) {
  if (z >= forageTrail[0][1]) return forageTrail[0][0]
  for (let index = 0; index < forageTrail.length - 1; index += 1) {
    const [ax, az] = forageTrail[index]
    const [bx, bz] = forageTrail[index + 1]
    if (z <= az && z >= bz) {
      const t = (az - z) / (az - bz)
      return ax + (bx - ax) * t
    }
  }
  return forageTrail[forageTrail.length - 1][0]
}

function forageGroundHeight(x: number, z: number) {
  const trailDistance = Math.abs(x - trailCenterAt(z))
  const rolling = Math.sin(x * 0.055 + z * 0.018) * 0.7 + Math.cos(z * 0.047 - x * 0.026) * 0.62 + Math.sin((x + z) * 0.12) * 0.18
  const westRise = Math.exp(-((x + 48) ** 2 + (z + 42) ** 2) / 900) * 7.5
  const eastRise = Math.exp(-((x - 55) ** 2 + (z + 75) ** 2) / 1100) * 8.2
  const oldHill = Math.exp(-((x + 22) ** 2 + (z + 103) ** 2) / 620) * 5.8
  const sideMass = smoothstep(62, 138, Math.abs(x)) * (4.5 + Math.sin(z * 0.035) * 1.4)
  const northMass = smoothstep(42, 145, z) * 5.5
  const southMass = smoothstep(118, 160, -z) * 4.2
  const trailChannel = Math.exp(-(trailDistance ** 2) / 32) * 0.7
  return rolling + westRise + eastRise + oldHill + sideMass + northMass + southMass - trailChannel
}

function farmGroundHeight(x: number, z: number) {
  const raw = Math.sin(x * 0.045) * 0.48 + Math.cos(z * 0.052) * 0.38 + Math.sin((x - z) * 0.085) * 0.15
  let height = raw
  farmParcels.forEach(([cx, cz], index) => {
    const distance = Math.max(Math.abs(x - cx), Math.abs(z - cz))
    const influence = 1 - smoothstep(8.2, 12.5, distance)
    const terrace = Math.sin(cx * 0.045) * 0.48 + Math.cos(cz * 0.052) * 0.38 + (index > 3 ? -0.08 : 0.08)
    height = THREE.MathUtils.lerp(height, terrace, influence)
  })
  const westBank = Math.exp(-((x + 86) ** 2) / 260) * 5.5
  const eastBank = Math.exp(-((x - 88) ** 2) / 300) * 5.8
  const farBank = smoothstep(78, 108, -z) * 5.2
  const entryBank = smoothstep(55, 92, z) * 3.8
  return height + westBank + eastBank + farBank + entryBank
}

function hubGroundHeight(x: number, z: number) {
  const rolling = Math.sin(x * 0.055) * 0.34 + Math.cos(z * 0.049) * 0.28 + Math.sin((x + z) * 0.09) * 0.1
  const clearing = 1 - smoothstep(17, 29, Math.hypot(x, z))
  const outerRise = smoothstep(27, 62, Math.hypot(x, z)) * 9.5
  return THREE.MathUtils.lerp(rolling, 0.04, clearing) + outerRise
}

function mineGroundHeight(x: number, z: number) {
  if (z >= 22) {
    const mouthHill = Math.exp(-((z - 28) ** 2) / 520) * smoothstep(5, 24, Math.abs(x)) * 5.8
    return mouthHill + Math.sin(x * 0.09 + z * 0.035) * 0.18
  }
  const ramp = (high: number, low: number, from: number, to: number) => {
    const progress = THREE.MathUtils.clamp((high - z) / (high - low), 0, 1)
    if (progress >= 1) return to
    const steps = 3
    const scaled = progress * steps
    const step = Math.min(steps - 1, Math.floor(scaled))
    const local = scaled - step
    const easedDrop = smoothstep(0.04, 0.46, local)
    return THREE.MathUtils.lerp(from, to, (step + easedDrop) / steps)
  }
  let level = z >= 8 ? ramp(22, 8, 0, -3)
    : z >= -30 ? -3
      : z >= -44 ? ramp(-30, -44, -3, -8)
        : z >= -84 ? -8
          : z >= -98 ? ramp(-84, -98, -8, -15)
            : z >= -132 ? -15
              : z >= -146 ? ramp(-132, -146, -15, -22)
                : -22
  const shelf = (cx: number, cz: number, radiusX: number, radiusZ: number, height: number) => {
    const distance = Math.hypot((x - cx) / radiusX, (z - cz) / radiusZ)
    return (1 - smoothstep(0.48, 1, distance)) * height
  }
  level += Math.sin(x * 0.055 + z * 0.024) * 0.52 + Math.cos(z * 0.061 - x * 0.018) * 0.36 + Math.sin((x - z) * 0.145) * 0.12
  level += shelf(-39, -22, 20, 22, 3.2) + shelf(39, -30, 22, 19, -1.4)
  level += shelf(-43, -73, 22, 25, 3.8) + shelf(43, -79, 23, 23, -1.8)
  level += shelf(-31, -122, 23, 20, -1.6) + shelf(34, -126, 21, 20, 3.1)
  level += shelf(0, -151, 20, 10, -1.1)
  level += Math.exp(-((x + 38) ** 2 + (z + 22) ** 2) / 310) * 1.15
  level -= Math.exp(-((x - 41) ** 2 + (z + 67) ** 2) / 360) * 1.2
  level += Math.exp(-((x - 34) ** 2 + (z + 113) ** 2) / 330) * 0.9
  level -= Math.exp(-((x + 24) ** 2 + (z + 118) ** 2) / 330) * 1.05
  return level
}

function groundHeight(zone: ZoneId, x: number, z: number) {
  if (zone === 'hub') return hubGroundHeight(x, z)
  if (zone === 'forage') return forageGroundHeight(x, z)
  if (zone === 'farm') return farmGroundHeight(x, z)
  if (zone === 'mine') return mineGroundHeight(x, z)
  return 0
}

function rushGroundHeight(x: number, z: number) {
  return Math.sin(x * .045) * .22 + Math.cos(z * .057) * .18 + Math.sin((x - z) * .09) * .08
}

function minigameGroundHeight(kind: MinigameKind, x: number, z: number) {
  if (kind === 'mining') return rushGroundHeight(x, z)
  if (kind === 'farm') return Math.sin(x * .045) * .34 + Math.cos(z * .052) * .28 + Math.sin((x - z) * .085) * .1
  return forageGroundHeight(x, z)
}

function SceneLighting() {
  const { scene } = useThree()
  const zone = useGameStore((state) => state.zone)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const weather = useGameStore((state) => state.weather)
  const eventMining = minigameOpen && minigameKind === 'mining'
  const mineLike = zone === 'mine' || (minigameOpen && minigameKind === 'mining')
  useEffect(() => {
    const colors = eventMining ? ['#343230', '#4a4540'] : mineLike ? ['#211e1b', '#3b342f'] : zone === 'farm' ? ['#b7c39a', '#9ba97c'] : zone === 'hub' ? ['#aebc98', '#96a27f'] : ['#91a47e', '#728565']
    scene.background = new THREE.Color(colors[0])
    const mist = weather === 'mist' && zone !== 'mine'
    scene.fog = new THREE.Fog(colors[1], mist ? 22 : zone === 'hub' ? 38 : zone === 'forage' ? 72 : zone === 'farm' ? 58 : 34, mist ? (zone === 'forage' ? 92 : 76) : zone === 'hub' ? 82 : zone === 'forage' ? 205 : zone === 'farm' ? 148 : 158)
  }, [eventMining, mineLike, scene, weather, zone])
  return (
    <>
      <hemisphereLight color={mineLike ? '#e7dfd2' : '#fff0cc'} groundColor={mineLike ? '#52483e' : '#263b29'} intensity={eventMining ? 1.7 : mineLike ? 1.02 : 1.12} />
      <directionalLight
        castShadow
        color={mineLike ? '#a8babd' : '#ffdca0'}
        intensity={eventMining ? 2.35 : mineLike ? 1.65 : 2.05}
        position={[-12, 19, 10]}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-bias={-0.0004}
      />
      {zone === 'hub' && <pointLight color="#efb25d" intensity={4.2} distance={10} decay={2} position={[2.6, 2.5, 1.8]} />}
      {mineLike && <><pointLight color="#efbd79" intensity={eventMining ? 12 : 7.2} distance={40} decay={2} position={[0, 4.6, 18]} /><pointLight color="#d99a5c" intensity={eventMining ? 9.5 : 6.4} distance={42} decay={2} position={[-14, 3.2, -2]} /><pointLight color="#9cbcc0" intensity={eventMining ? 9.5 : 6.2} distance={42} decay={2} position={[14, 3.2, -4]} /></>}
      {zone === 'mine' && !minigameOpen && <><pointLight color="#d99a62" intensity={6.2} distance={42} decay={2} position={[-41, -5, -75]} /><pointLight color="#94b9c3" intensity={6.6} distance={42} decay={2} position={[42, -6, -78]} /><pointLight color="#d8a66b" intensity={6.4} distance={43} decay={2} position={[-31, -13, -124]} /><pointLight color="#8fb5c1" intensity={6.4} distance={42} decay={2} position={[32, -13, -126]} /></>}
    </>
  )
}

function WeatherEffect() {
  const weather = useGameStore((state) => state.weather)
  const zone = useGameStore((state) => state.zone)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const playerPosition = useGameStore((state) => state.playerPosition)
  const points = useRef<THREE.Points>(null)
  const geometry = useMemo(() => {
    const positions = new Float32Array(240 * 3)
    for (let index = 0; index < 240; index += 1) {
      const angle = index * 2.399963
      const radius = 1.8 + ((index * 37) % 100) / 100 * 12
      positions[index * 3] = Math.cos(angle) * radius
      positions[index * 3 + 1] = ((index * 53) % 140) / 10 - 1
      positions[index * 3 + 2] = Math.sin(angle) * radius
    }
    const result = new THREE.BufferGeometry()
    result.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return result
  }, [])

  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame((_, delta) => {
    if (!points.current || minigameOpen || (weather !== 'rain' && weather !== 'mist') || zone === 'mine') return
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < position.count; index += 1) {
      const nextY = position.getY(index) - delta * (weather === 'rain' ? 16 : 0.45)
      position.setY(index, nextY < -1 ? nextY + 14 : nextY)
    }
    position.needsUpdate = true
    points.current.position.set(playerPosition[0], playerPosition[1], playerPosition[2])
  })

  if (minigameOpen || (weather !== 'rain' && weather !== 'mist') || zone === 'mine') return null
  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <pointsMaterial color={weather === 'rain' ? '#cfdfda' : '#e7eadc'} size={weather === 'rain' ? 0.055 : 0.32} transparent opacity={weather === 'rain' ? 0.62 : 0.16} depthWrite={false} sizeAttenuation />
    </points>
  )
}

function applyOreAppearance(object: THREE.Object3D, id: string, readyAt: number, forcedKind?: keyof typeof ORE_COLORS) {
  if (!id.startsWith('MineOre') && !id.startsWith('RushOre')) return
  const kind = forcedKind ?? oreKindAtDepth(id, object.position.z)
  if (object.userData.oreKind === kind && object.userData.oreAppearanceVersion === 3) return
  object.userData.oreKind = kind
  object.userData.oreAppearanceVersion = 3
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const oreMeshName = child.name.replaceAll('_', ' ')
    if (!oreMeshName.startsWith('Embedded Ore') && !oreMeshName.startsWith('Ore Boulder') && !oreMeshName.startsWith('Ore Fleck') && !oreMeshName.startsWith('Ore Vein') && !oreMeshName.startsWith('Ore Shard')) return
    child.visible = true
    if (!child.userData.oreMaterial) {
      child.material = Array.isArray(child.material) ? child.material.map((material) => material.clone()) : child.material.clone()
      child.userData.oreMaterial = true
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    materials.forEach((material) => {
      if ('color' in material && material.color instanceof THREE.Color) {
        if (oreMeshName.startsWith('Ore Vein') || oreMeshName.startsWith('Ore Fleck') || oreMeshName.startsWith('Ore Shard')) material.color.set(ORE_COLORS[kind])
        else if (oreMeshName.startsWith('Ore Boulder')) material.color.set(id.startsWith('RushOre') ? '#625e57' : '#786f63').lerp(new THREE.Color(ORE_COLORS[kind]), id.startsWith('RushOre') ? .34 : .18)
        else if (oreMeshName.startsWith('Embedded Ore')) material.color.set(id.startsWith('RushOre') ? '#56524c' : '#625e57').lerp(new THREE.Color(ORE_COLORS[kind]), id.startsWith('RushOre') ? .08 : .04)
      }
      if ('emissive' in material && material.emissive instanceof THREE.Color) {
        if (oreMeshName.startsWith('Ore Vein') || oreMeshName.startsWith('Ore Fleck') || oreMeshName.startsWith('Ore Shard')) {
          material.emissive.set(ORE_COLORS[kind])
          material.emissiveIntensity = id.startsWith('RushOre') ? 0.38 : 0.22
        } else if (oreMeshName.startsWith('Ore Boulder')) {
          material.emissive.set(ORE_COLORS[kind])
          material.emissiveIntensity = id.startsWith('RushOre') ? 0.05 : 0.018
        } else if (oreMeshName.startsWith('Embedded Ore')) {
          material.emissive.set(ORE_COLORS[kind])
          material.emissiveIntensity = id.startsWith('RushOre') ? 0.01 : 0.004
        }
      }
      if ('roughness' in material) material.roughness = kind === 'gold-ore' || kind === 'ancient-ore' ? 0.42 : 0.58
    })
  })
}

function applyFruitAppearance(object: THREE.Object3D, id: string, available: number) {
  const mainId = id.replace('ForageRush', 'Forage')
  if (!mainId.startsWith('ForageApple') && !mainId.startsWith('ForageOrange')) return
  const capacity = fruitTreeCapacity(mainId)
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const fruitMeshName = child.name.replaceAll('_', ' ')
    if (!fruitMeshName.includes('Woodland Apples') && !fruitMeshName.includes('Woodland Oranges')) return
    if (!child.userData.fruitGeometry) {
      child.geometry = child.geometry.clone()
      child.userData.fruitGeometry = true
      child.userData.fullDrawCount = child.geometry.index?.count ?? child.geometry.getAttribute('position').count
    }
    const fullDrawCount = Number(child.userData.fullDrawCount)
    const drawCount = Math.floor((fullDrawCount * available / capacity) / 3) * 3
    child.geometry.setDrawRange(0, drawCount)
  })
}

function EnvironmentScene() {
  const zone = useGameStore((state) => state.zone)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const minigameMilestone = useGameStore((state) => state.minigameMilestone)
  const sessionSeed = useGameStore((state) => state.sessionSeed)
  const matchStartedAt = useGameStore((state) => state.matchStartedAt)
  const eventBay = useGameStore((state) => state.eventBay)
  const rushNodes = useGameStore((state) => state.rushNodes)
  const forageRushCollected = useGameStore((state) => state.forageRushCollected)
  const minedNodes = useGameStore((state) => state.minedNodes)
  const mineGenerations = useGameStore((state) => state.mineGenerations)
  const collectedForage = useGameStore((state) => state.collectedForage)
  const setAnchors = useGameStore((state) => state.setAnchors)
  const setColliders = useGameStore((state) => state.setColliders)
  const furnaceCount = useGameStore((state) => state.inventory.furnace ?? 0)
  const claimedFarms = useGameStore((state) => state.claimedFarms)
  const cookQueue = useGameStore((state) => state.cookQueue)
  const farmRushCooking = useGameStore((state) => state.farmRushCooking)
  const furnaceReadyUntil = useGameStore((state) => state.furnaceReadyUntil)
  const source = useGLTF(minigameOpen ? MINIGAME_SCENES[minigameKind] : SCENES[zone]).scene
  const scene = useMemo(() => skeletonClone(source), [source])
  scene.userData.environment = true
  const animatedStock = useMemo(() => scene.getObjectByName('Animated_StockRing'), [scene])
  const stockBaseY = useMemo(() => animatedStock?.position.y ?? 0, [animatedStock])
  const resourceObjects = useMemo(() => {
    const resources: THREE.Object3D[] = []
    scene.traverse((object) => { if (object.name.startsWith('Resource_')) resources.push(object) })
    return resources
  }, [scene])
  const rareResourceIds = useMemo(() => resourceObjects.map((object) => object.name.slice(9)).filter((id) => id.startsWith('ForageTruffle') || id.startsWith('ForageDiscovery') || id.startsWith('ForageRushTruffle') || id.startsWith('ForageRushDiscovery')), [resourceObjects])
  const furnaceBodies = useMemo(() => {
    const bodies: THREE.Object3D[] = []
    scene.traverse((object) => { if (typeof object.userData.furnaceIndex === 'number' || typeof object.userData.rushCooker === 'number') bodies.push(object) })
    return bodies
  }, [scene])
  const rushPlotMarkers = useMemo(() => {
    const markers: THREE.Object3D[] = []
    scene.traverse((object) => { if (typeof object.userData.rushPlot === 'number') markers.push(object) })
    return markers
  }, [scene])
  rushPlotMarkers.forEach((marker) => { marker.visible = minigameOpen && minigameKind === 'farm' && Number(marker.userData.rushPlot) === eventBay })
  const assignedPlotBeacon = useMemo(() => rushPlotMarkers.find((marker) => Number(marker.userData.rushPlot) === eventBay)?.getObjectByName('Assigned Plot Beacon'), [eventBay, rushPlotMarkers])
  const assignedPlotBeaconY = useMemo(() => assignedPlotBeacon?.position.y ?? 0, [assignedPlotBeacon])

  useFrame((state, delta) => {
    const activeRares = activeRareForageIds(rareResourceIds, minigameOpen && minigameKind === 'forage', sessionSeed, matchStartedAt)
    if (animatedStock) {
      animatedStock.rotation.z += delta * 0.34
      animatedStock.position.y = stockBaseY + Math.sin(state.clock.elapsedTime * 1.4) * 0.08
    }
    if (assignedPlotBeacon) {
      assignedPlotBeacon.rotation.y += delta * 0.65
      assignedPlotBeacon.position.y = assignedPlotBeaconY + Math.sin(state.clock.elapsedTime * 1.8) * 0.12
    }
    for (const object of resourceObjects) {
      const id = object.name.slice(9)
      if (id.startsWith('ForageRush')) {
        const ready = (forageRushCollected[id] ?? 0) <= Date.now()
        if (id.startsWith('ForageRushApple') || id.startsWith('ForageRushOrange')) {
          object.visible = true
          applyFruitAppearance(object, id, ready ? fruitTreeCapacity(id.replace('ForageRush', 'Forage')) : 0)
        } else object.visible = ready && activeRares.has(id)
        continue
      }
      const rushNode = rushNodes[id] ?? { generation: 0, readyAt: 0 }
      const readyAt = id.startsWith('RushOre') ? rushNode.readyAt : minedNodes[id] ?? 0
      const forageAvailable = id.startsWith('Forage') ? forageSiteAvailability(id, collectedForage[id] ?? 0) : 0
      const rareActive = !id.startsWith('ForageTruffle') && !id.startsWith('ForageDiscovery') || activeRares.has(id)
      object.visible = id.startsWith('Forage') ? forageAvailable > 0 && rareActive : readyAt <= Date.now()
      if (object.visible) {
        if (id.startsWith('Forage')) applyFruitAppearance(object, id, forageAvailable)
        const oreKind = id.startsWith('RushOre')
          ? miningRushOre(minigameMilestone, id, rushNode.generation)
          : id.startsWith('MineOre')
            ? oreKindAtDepth(id, object.position.z, mineGenerations[id] ?? 0, sessionSeed)
            : undefined
        applyOreAppearance(object, id, readyAt, oreKind)
        if (id.startsWith('MineOre') || id.startsWith('RushOre')) {
          if (!object.userData.restScale) object.userData.restScale = object.scale.clone()
          const live = useGameStore.getState()
          const damage = live.prompt?.id === id ? live.interactionProgress : 0
          object.scale.copy(object.userData.restScale).multiplyScalar(1 - damage * 0.24)
        }
      }
    }
    const activeFurnaces = (furnaceVisualGate || resourceVisualGate) && zone === 'farm' ? [0] : furnaceCount > 0 ? claimedFarms.slice(0, 1) : []
    furnaceBodies.forEach((body) => {
      const furnaceIndex = Number(body.userData.furnaceIndex)
      const eventCooker = Number(body.userData.rushCooker) === eventBay && minigameOpen && minigameKind === 'farm'
      const active = eventCooker || activeFurnaces.includes(furnaceIndex)
      const cooking = eventCooker ? Boolean(farmRushCooking) : cookQueue.some((job) => job.furnaceIndex === furnaceIndex) || ((furnaceVisualGate || resourceVisualGate) && zone === 'farm' && furnaceIndex === 0)
      const ready = !cooking && (furnaceReadyUntil[furnaceIndex] ?? 0) > Date.now()
      body.visible = active
      body.traverse((child) => {
        const name = child.name.replaceAll('_', ' ')
        if (name.startsWith('Animated FurnaceFire')) {
          child.visible = active && cooking
          child.scale.y = 0.72 + Math.sin(state.clock.elapsedTime * 7) * 0.13
        } else if (name.startsWith('Animated FurnaceSteam')) {
          child.visible = active && (cooking || ready)
          child.position.y = 2.86 + (state.clock.elapsedTime * 0.34) % 0.28
          child.rotation.y += delta * 0.32
        } else if (name.startsWith('Animated FurnaceReady')) {
          child.visible = active && ready
          child.rotation.z += delta * 0.8
          child.scale.setScalar(0.94 + Math.sin(state.clock.elapsedTime * 3.2) * 0.06)
        }
      })
    })
  })

  useEffect(() => {
    const anchors: AnchorMap = {}
    const colliders: WorldCollider[] = []
    const activeFurnaces = (furnaceVisualGate || resourceVisualGate) && zone === 'farm' ? [0] : furnaceCount > 0 ? claimedFarms.slice(0, 1) : []
    const activeRares = activeRareForageIds(rareResourceIds, minigameOpen && minigameKind === 'forage', sessionSeed, matchStartedAt)
    furnaceBodies.forEach((body) => { body.visible = (minigameOpen && minigameKind === 'farm' && Number(body.userData.rushCooker) === eventBay) || activeFurnaces.includes(Number(body.userData.furnaceIndex)) })
    scene.updateMatrixWorld(true)
    scene.traverse((object) => {
      if (object.name.startsWith('Resource_')) {
        const id = object.name.slice(9)
        if (id.startsWith('ForageRush')) {
          const ready = (forageRushCollected[id] ?? 0) <= Date.now()
          if (id.startsWith('ForageRushApple') || id.startsWith('ForageRushOrange')) {
            object.visible = true
            applyFruitAppearance(object, id, ready ? fruitTreeCapacity(id.replace('ForageRush', 'Forage')) : 0)
          } else object.visible = ready && activeRares.has(id)
        } else {
        const rushNode = rushNodes[id] ?? { generation: 0, readyAt: 0 }
        const readyAt = id.startsWith('RushOre') ? rushNode.readyAt : minedNodes[id] ?? 0
        const forageAvailable = id.startsWith('Forage') ? forageSiteAvailability(id, collectedForage[id] ?? 0) : 0
        const rareActive = !id.startsWith('ForageTruffle') && !id.startsWith('ForageDiscovery') || activeRares.has(id)
        object.visible = id.startsWith('Forage') ? forageAvailable > 0 && rareActive : readyAt <= Date.now()
        if (object.visible) {
          if (id.startsWith('Forage')) applyFruitAppearance(object, id, forageAvailable)
          const oreKind = id.startsWith('RushOre')
            ? miningRushOre(minigameMilestone, id, rushNode.generation)
            : id.startsWith('MineOre')
              ? oreKindAtDepth(id, object.position.z, mineGenerations[id] ?? 0, sessionSeed)
              : undefined
          applyOreAppearance(object, id, readyAt, oreKind)
        }
        }
      }
      if (object.name.startsWith('Anchor_')) {
        const point = new THREE.Vector3()
        object.getWorldPosition(point)
        anchors[object.name.slice(7)] = [point.x, point.y, point.z]
      }
      if (typeof object.userData.colliderRadius === 'number' && object.visible) {
        const point = new THREE.Vector3()
        const scale = new THREE.Vector3()
        object.getWorldPosition(point)
        object.getWorldScale(scale)
        colliders.push({ x: point.x, z: point.z, radius: object.userData.colliderRadius * Math.max(scale.x, scale.z) })
      }
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => {
          if (material.transparent) material.depthWrite = false
        })
      }
    })
    setAnchors(anchors)
    setColliders(colliders)
  }, [claimedFarms, collectedForage, eventBay, farmRushCooking, forageRushCollected, furnaceBodies, furnaceCount, matchStartedAt, minedNodes, mineGenerations, minigameKind, minigameMilestone, minigameOpen, rareResourceIds, rushNodes, scene, sessionSeed, setAnchors, setColliders])

  return <primitive object={scene} />
}

type NormalizedModelProps = {
  src: string
  height: number
  position?: [number, number, number]
  rotation?: [number, number, number]
}

function NormalizedModel({ src, height, position = [0, 0, 0], rotation = [0, 0, 0] }: NormalizedModelProps) {
  const source = useGLTF(src).scene
  const normalized = useMemo(() => {
    const object = skeletonClone(source)
    object.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(object)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const scale = height / Math.max(size.y, 0.001)
    object.scale.setScalar(scale)
    object.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    return object
  }, [source, height])
  return (
    <group position={position} rotation={rotation}>
      <primitive object={normalized} />
    </group>
  )
}

function AnimatedCharacter({ src, height, position, rotation, animation }: NormalizedModelProps & { animation: string }) {
  const group = useRef<THREE.Group>(null)
  const source = useGLTF(src).scene
  const animationSource = useGLTF('/assets/3d/animations/standard.glb')
  const { actions } = useAnimations(animationSource.animations, group)
  const normalized = useMemo(() => {
    const object = skeletonClone(source)
    object.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(object)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const scale = height / Math.max(size.y, 0.001)
    object.scale.setScalar(scale)
    object.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    return object
  }, [height, source])
  useEffect(() => {
    const action = actions[animation]
    action?.reset().fadeIn(0.2).play()
    return () => { action?.fadeOut(0.15) }
  }, [actions, animation])
  return <group ref={group} position={position} rotation={rotation}><primitive object={normalized} /></group>
}

type PeerPresence = { id: string; nickname: string; zone: ZoneId; position: [number, number, number]; cash: number; progressValue?: number; stats: { foraged: number; mined: number; harvested: number; sold: number }; seenAt: number; minigameOpen?: boolean; minigameKind?: MinigameKind; minigameMilestone?: number; minigameScore?: number; eventBay?: number }

function liveMinigameScore(state: ReturnType<typeof useGameStore.getState>) {
  if (!state.minigameOpen) return 0
  return state.minigameKind === 'mining' ? state.rushScore : state.minigameKind === 'farm' ? state.farmRushScore : state.forageRushScore
}

function MultiplayerPresence() {
  const zone = useGameStore((state) => state.zone)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const minigameMilestone = useGameStore((state) => state.minigameMilestone)
  const setEventBay = useGameStore((state) => state.setEventBay)
  const setOnlinePlayers = useGameStore((state) => state.setOnlinePlayers)
  const syncMatch = useGameStore((state) => state.syncMatch)
  const setLobbyState = useGameStore((state) => state.setLobbyState)
  const [peers, setPeers] = useState<Record<string, PeerPresence>>({})
  const peerId = useRef<string>(crypto.randomUUID())

  useEffect(() => {
    setOnlinePlayers(Object.values(peers).map(({ id, nickname, zone: peerZone, cash, progressValue, stats, minigameOpen: peerInEvent, minigameKind: peerEventKind, minigameMilestone: peerMilestone, minigameScore }) => ({ id, nickname: nickname || `Player ${id.slice(0, 4)}`, zone: peerZone, cash: cash ?? 0, progressValue, stats: stats ?? { foraged: 0, mined: 0, harvested: 0, sold: 0 }, minigameOpen: peerInEvent, minigameKind: peerEventKind, minigameMilestone: peerMilestone, minigameScore })))
  }, [peers, setOnlinePlayers])

  useEffect(() => {
    let disposed = false
    let stopPresence: (() => void) | null = null
    const mergePeer = (message: PeerPresence) => {
      if (!message?.id || message.id === peerId.current) return
      setPeers((current) => ({ ...current, [message.id]: { ...message, seenAt: Date.now() } }))
    }
    const removePeer = (id: string) => setPeers((current) => {
      const next = { ...current }; delete next[id]; return next
    })
    const startLocalFallback = () => {
      if (!('BroadcastChannel' in window) || disposed) return () => undefined
      setLobbyState(false, false, false, 60 * 60)
      const channel = new BroadcastChannel('project01-presence-v1')
      channel.onmessage = (event: MessageEvent<PeerPresence & { leave?: boolean }>) => event.data.leave ? removePeer(event.data.id) : mergePeer(event.data)
      const publish = () => {
        const state = useGameStore.getState()
        channel.postMessage({ id: peerId.current, nickname: state.nickname, zone: state.zone, position: state.playerPosition, cash: state.cash, progressValue: economyProgressValue(state), stats: state.stats, minigameOpen: state.minigameOpen, minigameKind: state.minigameKind, minigameMilestone: state.minigameMilestone, minigameScore: liveMinigameScore(state), eventBay: state.eventBay, seenAt: Date.now() })
      }
      publish()
      const timer = window.setInterval(publish, 250)
      return () => { window.clearInterval(timer); channel.postMessage({ id: peerId.current, leave: true }); channel.close() }
    }
    const connect = async () => {
      try {
        const configured = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_MULTIPLAYER_URL
        const endpoint = configured || `${window.location.protocol}//${window.location.hostname}:2567`
        const room = await new ColyseusClient(endpoint).joinOrCreate('woodland', { bypassLobby: bypassLobbyClient })
        if (disposed) { void room.leave(); return }
        peerId.current = room.sessionId
        room.onMessage('presence:snapshot', (snapshot: PeerPresence[]) => setPeers(Object.fromEntries(snapshot.filter((peer) => peer.id !== room.sessionId).map((peer) => [peer.id, peer]))))
        room.onMessage('lobby:state', (message: { isHost?: boolean; started?: boolean; durationSeconds?: number }) => setLobbyState(true, Boolean(message.isHost), Boolean(message.started), Number(message.durationSeconds)))
        room.onMessage('match:sync', (message: { seed?: number; startedAt?: number; durationSeconds?: number }) => syncMatch(Number(message.seed), Number(message.startedAt), Number(message.durationSeconds)))
        room.onMessage('minigame:bay', (message: { bay?: number }) => { if (Number.isFinite(message.bay)) setEventBay(Number(message.bay)) })
        room.onMessage('presence:move', (message: PeerPresence) => mergePeer(message))
        room.onMessage('presence:leave', (id: string) => removePeer(id))
        for (const type of ['trade:request', 'trade:opened', 'trade:update', 'trade:cancel', 'trade:commit', 'minigame:result', 'minigame:forage', 'mine:snapshot', 'mine:node', 'mine:award', 'mine:denied']) room.onMessage(type, (payload: unknown) => emitMultiplayer(type, payload))
        setMultiplayerSender((type, payload) => room.send(type, payload))
        room.send('lobby:ready', {})
        const publish = () => {
          const state = useGameStore.getState()
          room.send('move', { zone: state.zone, position: state.playerPosition, nickname: state.nickname, cash: state.cash, progressValue: economyProgressValue(state), stats: state.stats, minigameOpen: state.minigameOpen, minigameKind: state.minigameKind, minigameMilestone: state.minigameMilestone, minigameScore: liveMinigameScore(state), eventBay: state.eventBay })
        }
        publish()
        const timer = window.setInterval(publish, 125)
        stopPresence = () => { window.clearInterval(timer); setMultiplayerSender(null); void room.leave() }
      } catch {
        stopPresence = startLocalFallback()
      }
    }
    void connect()
    const prune = window.setInterval(() => setPeers((current) => Object.fromEntries(Object.entries(current).filter(([, peer]) => Date.now() - peer.seenAt < 2500))), 750)
    return () => { disposed = true; window.clearInterval(prune); stopPresence?.(); setOnlinePlayers([]) }
  }, [setEventBay, setLobbyState, setOnlinePlayers, syncMatch])

  const visiblePeers = Object.values(peers).filter((peer) => minigameOpen
    ? peer.minigameOpen && peer.minigameKind === minigameKind && peer.minigameMilestone === minigameMilestone
    : !peer.minigameOpen && peer.zone === zone)
  return <>{visiblePeers.map((peer) => (
    <group key={peer.id}>
      <AnimatedCharacter
        src="/assets/3d/characters/ranger.glb"
        height={1.75}
        position={[peer.position[0], peer.position[1] - 0.86, peer.position[2]]}
        rotation={[0, Math.PI, 0]}
        animation="Armature|Idle_Loop"
      />
      <Html position={[peer.position[0], peer.position[1] + 1.18, peer.position[2]]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
        <span className="world-label">{peer.nickname || 'PLAYER'}</span>
      </Html>
    </group>
  ))}</>
}

function Player() {
  const playerRoot = useRef<THREE.Group>(null)
  const visual = useRef<THREE.Group>(null)
  const position = useRef(new THREE.Vector3(0, 0.86, 14))
  const verticalVelocity = useRef(0)
  const keys = useRef<Record<string, boolean>>({})
  const yaw = useRef(0)
  const pitch = useRef(0.08)
  const shiftLock = useRef(false)
  const distance = useRef(6.2)
  const cameraPosition = useRef(new THREE.Vector3(0, 4.2, 20.2))
  const cameraTarget = useRef(new THREE.Vector3(0, 1.68, 14))
  const cameraRaycaster = useRef(new THREE.Raycaster())
  const lastStoreUpdate = useRef(0)
  const portalReadyAt = useRef(0)
  const nextFootstepAt = useRef(0)
  const spawnedZone = useRef<string | null>(null)
  const zone = useGameStore((state) => state.zone)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const sessionSeed = useGameStore((state) => state.sessionSeed)
  const matchStartedAt = useGameStore((state) => state.matchStartedAt)
  const eventBay = useGameStore((state) => state.eventBay)
  const teleportNonce = useGameStore((state) => state.teleportNonce)
  const anchors = useGameStore((state) => state.anchors)
  const colliders = useGameStore((state) => state.colliders)
  const setPlayerPosition = useGameStore((state) => state.setPlayerPosition)
  const setShiftLocked = useGameStore((state) => state.setShiftLocked)
  const setSelectedHotbar = useGameStore((state) => state.setSelectedHotbar)
  const setZone = useGameStore((state) => state.setZone)
  const cameraSensitivity = useGameStore((state) => state.cameraSensitivity)
  const cameraInvertY = useGameStore((state) => state.cameraInvertY)
  const storedShiftLocked = useGameStore((state) => state.shiftLocked)
  const interactionProgress = useGameStore((state) => state.interactionProgress)
  const prompt = useGameStore((state) => state.prompt)
  const sensitivity = useRef(cameraSensitivity)
  const invertY = useRef(cameraInvertY)
  const { camera, gl, scene: worldScene } = useThree()
  const source = useGLTF('/assets/3d/characters/ranger.glb').scene
  const animationSource = useGLTF('/assets/3d/animations/standard.glb')
  const { actions } = useAnimations(animationSource.animations, visual)
  const activeAnimation = useRef('')
  const eventSpawn = minigameOpen ? anchors[`Spawn${eventBay}`] : null
  const eventFarmCell = minigameOpen && minigameKind === 'farm' ? anchors[`FarmRushCell${eventBay}_22`] : null
  const activeEventRares = activeRareForageIds(Object.keys(anchors), true, sessionSeed, matchStartedAt)
  const eventForageResource = resourceVisualTarget === 'truffle'
    ? [...activeEventRares].find((id) => id.startsWith('ForageRushTruffle'))
    : resourceVisualTarget === 'discovery'
      ? [...activeEventRares].find((id) => id.startsWith('ForageRushDiscovery'))
      : 'ForageRushApple100'
  const eventResource = minigameOpen && resourceVisualGate
    ? minigameKind === 'mining'
      ? anchors[`RushOre${eventBay}_22`]
      : minigameKind === 'forage'
        ? eventForageResource ? anchors[eventForageResource] : null
        : eventFarmCell
    : null
  const eventFallback = minigameKind === 'farm' ? FARM_RUSH_FALLBACK_SPAWNS[eventBay] : minigameKind === 'mining' ? MINING_RUSH_FALLBACK_SPAWNS[eventBay] : ([0, 0, -69] as [number, number, number])
  const ranger = useMemo(() => {
    const object = skeletonClone(source)
    object.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(object)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const scale = 1.75 / Math.max(size.y, 0.001)
    object.scale.setScalar(scale)
    object.position.set(-center.x * scale, -bounds.min.y * scale - 0.86, -center.z * scale)
    object.rotation.y = Math.PI
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    return object
  }, [source])

  useEffect(() => { sensitivity.current = cameraSensitivity }, [cameraSensitivity])
  useEffect(() => { invertY.current = cameraInvertY }, [cameraInvertY])
  useEffect(() => {
    shiftLock.current = storedShiftLocked
    gl.domElement.style.cursor = storedShiftLocked ? 'none' : ''
  }, [gl, storedShiftLocked])

  useEffect(() => {
    const spawnKey = minigameOpen ? `${zone}:${teleportNonce}:${minigameKind}:${eventBay}` : `${zone}:${teleportNonce}`
    if (spawnedZone.current === spawnKey) return
    if (minigameOpen && farmCellVisualGate && !eventFarmCell) return
    if (deepVisualGate && !anchors.GateDeep) return
    const resource = minigameOpen ? (resourceVisualGate ? eventResource : farmCellVisualGate && eventFarmCell ? eventFarmCell : eventSpawn ?? eventFallback) : zone === 'forage' ? anchors.ForageApple000 : zone === 'mine' ? anchors.MineOre000 : zone === 'farm' ? ((furnaceVisualGate || resourceVisualGate) ? anchors.FurnacePad0 : anchors.FarmClaim0) : null
    const farmCell = zone === 'farm' ? anchors.FarmCell0_00 : null
    if ((resourceVisualGate || furnaceVisualGate) && !resource) return
    if (farmCellVisualGate && !minigameOpen && !farmCell) return
    const resourceSpawn = resource
      ? minigameOpen
        ? (farmCellVisualGate || resourceVisualGate) ? [resource[0], resource[1], resource[2] + 2.45] as [number, number, number] : resource
        : zone === 'mine'
        ? [resource[0], resource[1], resource[2] + 2.35] as [number, number, number]
        : [resource[0], resource[1], resource[2] + 2.45] as [number, number, number]
      : null
    const farmCellSpawn = farmCell ? [farmCell[0], farmCell[1], farmCell[2] + 2.45] as [number, number, number] : null
    const spawn = (minigameOpen ? resourceSpawn : null) ?? (farmCellVisualGate ? farmCellSpawn : null) ?? ((resourceVisualGate || furnaceVisualGate) ? resourceSpawn : null) ?? (deepVisualGate ? anchors.GateDeep : null) ?? anchors.Spawn ?? FALLBACK_SPAWNS[zone]
    spawnedZone.current = spawnKey
    yaw.current = 0
    pitch.current = deepVisualGate ? 0.28 : 0.08
    distance.current = deepVisualGate ? 8.4 : 6.2
    if (deepVisualGate) {
      pitch.current = 0.28
    }
    position.current.set(spawn[0], (minigameOpen ? minigameGroundHeight(minigameKind, spawn[0], spawn[2]) : groundHeight(zone, spawn[0], spawn[2])) + 0.86, spawn[2])
    verticalVelocity.current = 0
    const target = new THREE.Vector3(position.current.x, position.current.y + 0.82, position.current.z)
    const horizontalDistance = Math.cos(pitch.current) * distance.current
    const desired = target.clone().add(new THREE.Vector3(
      Math.sin(yaw.current) * horizontalDistance,
      1.15 + Math.sin(pitch.current) * distance.current,
      Math.cos(yaw.current) * horizontalDistance,
    ))
    const environment = worldScene.children.find((child) => child.userData.environment)
    if (environment) {
      const cameraDirection = desired.clone().sub(target)
      const desiredDistance = cameraDirection.length()
      cameraDirection.normalize()
      cameraRaycaster.current.set(target, cameraDirection)
      cameraRaycaster.current.far = desiredDistance
      const obstruction = cameraRaycaster.current.intersectObject(environment, true).find((hit) => hit.distance > 0.42)
      if (obstruction) desired.copy(target).addScaledVector(cameraDirection, Math.max(0.72, obstruction.distance - 0.28))
    }
    cameraTarget.current.copy(target)
    cameraPosition.current.copy(desired)
    camera.position.copy(desired)
    camera.lookAt(target)
    portalReadyAt.current = performance.now() + 1500
  }, [anchors.FarmCell0_00, anchors.FarmClaim0, anchors.ForageApple000, anchors.ForageRushApple100, anchors.FurnacePad0, anchors.GateDeep, anchors.MineOre000, camera, eventBay, eventFallback, eventFarmCell, eventResource, eventSpawn, minigameKind, minigameOpen, teleportNonce, zone])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      keys.current[event.code] = true
      if (event.code === 'KeyQ' && !event.repeat) {
        shiftLock.current = !shiftLock.current
        setShiftLocked(shiftLock.current)
        gl.domElement.style.cursor = shiftLock.current ? 'none' : ''
        if (shiftLock.current) {
          try {
            const request = gl.domElement.requestPointerLock?.()
            if (request instanceof Promise) void request.catch(() => undefined)
          } catch {
            // Embedded browsers may reject pointer lock; shift-lock camera input still works without it.
          }
        }
        else if (document.pointerLockElement === gl.domElement) document.exitPointerLock()
      }
      const live = useGameStore.getState()
      const floor = (live.minigameOpen ? minigameGroundHeight(live.minigameKind, position.current.x, position.current.z) : groundHeight(live.zone, position.current.x, position.current.z)) + 0.86
      if (event.code === 'Space' && position.current.y <= floor + 0.03) {
        verticalVelocity.current = 5.2
      }
    }
    const up = (event: KeyboardEvent) => { keys.current[event.code] = false }
    const clearInput = () => { keys.current = {} }
    const move = (event: PointerEvent) => {
      if (shiftLock.current || event.buttons === 2) {
        yaw.current -= event.movementX * 0.004 * sensitivity.current
        const vertical = event.movementY * (invertY.current ? -1 : 1)
        pitch.current = THREE.MathUtils.clamp(pitch.current + vertical * 0.0032 * sensitivity.current, -1.45, 1.45)
      }
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const live = useGameStore.getState()
      if (live.minigameOpen && live.minigameKind === 'farm') {
        const tools = ['wheat', 'tomato', 'lettuce', 'pumpkin', 'watermelon', 'water'] as const
        const current = Math.max(0, tools.indexOf(live.farmRushTool))
        live.setFarmRushTool(tools[(current + (event.deltaY > 0 ? 1 : -1) + tools.length) % tools.length])
      } else if (!live.minigameOpen) setSelectedHotbar((live.selectedHotbar + (event.deltaY > 0 ? 1 : -1) + 9) % 9)
    }
    const context = (event: MouseEvent) => event.preventDefault()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clearInput)
    document.addEventListener('visibilitychange', clearInput)
    gl.domElement.addEventListener('pointermove', move)
    gl.domElement.addEventListener('wheel', wheel, { passive: false })
    gl.domElement.addEventListener('contextmenu', context)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clearInput)
      document.removeEventListener('visibilitychange', clearInput)
      gl.domElement.removeEventListener('pointermove', move)
      gl.domElement.removeEventListener('wheel', wheel)
      gl.domElement.removeEventListener('contextmenu', context)
      if (document.pointerLockElement === gl.domElement) document.exitPointerLock()
      gl.domElement.style.cursor = ''
    }
  }, [gl, setSelectedHotbar, setShiftLocked])

  useEffect(() => {
    const idle = actions['Armature|Idle_Loop']
    if (idle) {
      idle.reset().fadeIn(0.2).play()
      activeAnimation.current = 'Armature|Idle_Loop'
    }
    return () => { idle?.fadeOut(0.15) }
  }, [actions])

  useFrame((state, delta) => {
    const liveUi = useGameStore.getState()
    const movementLocked = !liveUi.sessionStarted || liveUi.shopOpen || liveUi.stockOpen || liveUi.inventoryOpen || liveUi.menuOpen || liveUi.playerPanelOpen || liveUi.lotteryOpen || liveUi.ticketInspectOpen || liveUi.noteInspectOpen || liveUi.travelOpen || liveUi.secretOpen || liveUi.cookbookOpen || liveUi.sessionComplete
    if (movementLocked) keys.current = {}
    const inputX = movementLocked ? 0 : Number(Boolean(keys.current.KeyD)) - Number(Boolean(keys.current.KeyA))
    const inputZ = movementLocked ? 0 : Number(Boolean(keys.current.KeyW)) - Number(Boolean(keys.current.KeyS))
    const cameraForward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current))
    const right = new THREE.Vector3(Math.cos(yaw.current), 0, -Math.sin(yaw.current))
    const direction = cameraForward.clone().multiplyScalar(inputZ).add(right.multiplyScalar(inputX))
    const moving = direction.lengthSq() > 0
    if (moving) direction.normalize()
    const sprinting = moving && Boolean(keys.current.ShiftLeft || keys.current.ShiftRight)
    const speed = sprinting ? 8.4 : 3.9
    if (moving && state.clock.elapsedTime >= nextFootstepAt.current) {
      const stoneFloor = zone === 'mine' || (liveUi.minigameOpen && liveUi.minigameKind === 'mining')
      playGameSfx(stoneFloor ? 'footstep-stone' : 'footstep-grass', liveUi.audioVolumes.master * liveUi.audioVolumes.effects)
      nextFootstepAt.current = state.clock.elapsedTime + (sprinting ? 0.31 : 0.48)
    } else if (!moving) {
      nextFootstepAt.current = state.clock.elapsedTime
    }
    const next = position.current.clone().addScaledVector(direction, speed * delta)
    if (liveUi.minigameOpen) {
      const eventLimit = liveUi.minigameKind === 'forage' ? 216 : liveUi.minigameKind === 'farm' ? 49 : 57
      next.x = THREE.MathUtils.clamp(next.x, -eventLimit, eventLimit)
      next.z = THREE.MathUtils.clamp(next.z, liveUi.minigameKind === 'forage' ? -219 : liveUi.minigameKind === 'farm' ? -34 : -40, liveUi.minigameKind === 'forage' ? 46 : liveUi.minigameKind === 'farm' ? 40 : 42)
      if (liveUi.minigameKind === 'mining') {
        const [bayX, bayZ] = MINING_RUSH_BAY_CENTERS[liveUi.eventBay] ?? MINING_RUSH_BAY_CENTERS[0]
        next.x = THREE.MathUtils.clamp(next.x, bayX - 10.55, bayX + 10.55)
        next.z = THREE.MathUtils.clamp(next.z, bayZ - 10.55, bayZ + 10.55)
      }
    } else if (zone === 'forage') {
      next.x = THREE.MathUtils.clamp(next.x, -216, 216)
      next.z = THREE.MathUtils.clamp(next.z, -219, 46)
    } else if (zone === 'mine') {
      next.x = THREE.MathUtils.clamp(next.x, -68, 68)
      next.z = THREE.MathUtils.clamp(next.z, -199, 77)
      if (!pointInMine(next.x, next.z)) next.copy(position.current)
    } else {
      const limit = zone === 'hub' ? 66 : 98
      const radialDistance = Math.hypot(next.x, next.z)
      if (radialDistance > limit) {
        next.x = (next.x / radialDistance) * limit
        next.z = (next.z / radialDistance) * limit
      }
    }
    for (const collider of colliders) {
      const dx = next.x - collider.x
      const dz = next.z - collider.z
      const minimum = collider.radius + 0.42
      const separation = Math.hypot(dx, dz)
      if (separation < minimum && separation > 0.0001) {
        next.x = collider.x + (dx / separation) * minimum
        next.z = collider.z + (dz / separation) * minimum
      }
    }
    position.current.x = next.x
    position.current.z = next.z
    verticalVelocity.current -= 14 * delta
    position.current.y += verticalVelocity.current * delta
    const terrainY = liveUi.minigameOpen ? minigameGroundHeight(liveUi.minigameKind, position.current.x, position.current.z) : groundHeight(zone, position.current.x, position.current.z)
    const standingY = terrainY + 0.86
    if (position.current.y < standingY) {
      position.current.y = standingY
      verticalVelocity.current = 0
    }
    const requestedAnimation = interactionProgress > 0 && prompt ? 'Armature|Interact' : sprinting ? 'Armature|Sprint_Loop' : moving ? 'Armature|Walk_Loop' : 'Armature|Idle_Loop'
    if (requestedAnimation !== activeAnimation.current || !actions[requestedAnimation]?.isRunning()) {
      actions[activeAnimation.current]?.fadeOut(0.18)
      actions[requestedAnimation]?.reset().fadeIn(0.18).play()
      activeAnimation.current = requestedAnimation
    }
    if (shiftLock.current) {
      const angle = Math.atan2(cameraForward.x, cameraForward.z)
      if (playerRoot.current) playerRoot.current.rotation.y = angle
    } else if (moving) {
      const angle = Math.atan2(direction.x, direction.z)
      if (playerRoot.current) playerRoot.current.rotation.y = angle
    }
    if (visual.current) {
      visual.current.position.y = moving ? Math.sin(state.clock.elapsedTime * (sprinting ? 13 : 8)) * 0.025 : 0
      visual.current.rotation.z = THREE.MathUtils.lerp(visual.current.rotation.z, moving ? -inputX * 0.035 : 0, 0.12)
    }
    const current = position.current
    if (playerRoot.current) playerRoot.current.position.copy(current)
    const portals: Array<{ point?: [number, number, number]; destination: ZoneId }> = zone === 'hub'
      ? [
          { point: anchors.PortalForage, destination: 'forage' },
          { point: anchors.PortalFarm, destination: 'farm' },
          { point: anchors.PortalMine, destination: 'mine' },
        ]
      : [{ point: anchors.Home, destination: 'hub' }]
    const entered = portals.find(({ point }) => point && Math.hypot(current.x - point[0], current.z - point[2]) <= 2.1)
    if (entered && performance.now() >= portalReadyAt.current) {
      portalReadyAt.current = performance.now() + 2000
      setZone(entered.destination)
      return
    }
    const target = new THREE.Vector3(current.x, current.y + 0.82, current.z)
    const horizontalDistance = Math.cos(pitch.current) * distance.current
    const desired = target.clone().add(new THREE.Vector3(
      Math.sin(yaw.current) * horizontalDistance,
      1.15 + Math.sin(pitch.current) * distance.current,
      Math.cos(yaw.current) * horizontalDistance,
    ))
    const liveEnvironment = worldScene.children.find((child) => child.userData.environment)
    if (liveEnvironment) {
      const cameraDirection = desired.clone().sub(target)
      const desiredDistance = cameraDirection.length()
      cameraDirection.normalize()
      cameraRaycaster.current.set(target, cameraDirection)
      cameraRaycaster.current.far = desiredDistance
      const obstruction = cameraRaycaster.current.intersectObject(liveEnvironment, true).find((hit) => hit.distance > 0.42)
      if (obstruction) desired.copy(target).addScaledVector(cameraDirection, Math.max(0.72, obstruction.distance - 0.28))
    }
    const cameraBlend = 1 - Math.exp(-20 * delta)
    cameraPosition.current.lerp(desired, cameraBlend)
    cameraTarget.current.lerp(target, cameraBlend)
    camera.position.copy(cameraPosition.current)
    camera.lookAt(cameraTarget.current)
    ;(window as unknown as { __P01_DEBUG?: unknown }).__P01_DEBUG = {
      player: [current.x, current.y, current.z],
      camera: camera.position.toArray(),
      animation: activeAnimation.current,
      shiftLock: shiftLock.current,
      pitch: pitch.current,
    }
    if (state.clock.elapsedTime - lastStoreUpdate.current > 0.08) {
      setPlayerPosition([current.x, current.y, current.z])
      lastStoreUpdate.current = state.clock.elapsedTime
    }
  })

  return (
    <group ref={playerRoot} position={[0, 0.9, 14]} rotation={[0, Math.PI, 0]}>
      <group ref={visual}>
        <primitive object={ranger} />
      </group>
    </group>
  )
}

function InteractiveWorldObjects() {
  const zone = useGameStore((state) => state.zone)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const anchors = useGameStore((state) => state.anchors)
  const farmCells = useGameStore((state) => state.farmCells)
  const farmRushCells = useGameStore((state) => state.farmRushCells)
  const forageRushDelivered = useGameStore((state) => state.forageRushDelivered)
  const roundNumber = useGameStore((state) => state.roundNumber)
  const sessionSeed = useGameStore((state) => state.sessionSeed)
  const secretPoint = zone === 'hub' ? null : anchors[`SecretSite${secretSiteForRound(zone, roundNumber, sessionSeed)}`]
  const secretActive = zone !== 'hub' && secretZoneForRound(roundNumber) === zone && secretPoint
  return (
    <>
      {zone === 'hub' && anchors.NpcShop && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcShop[0], anchors.NpcShop[1] + 0.02, anchors.NpcShop[2]]} rotation={[0, -2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'hub' && anchors.NpcStocks && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcStocks[0], anchors.NpcStocks[1] + 0.02, anchors.NpcStocks[2]]} rotation={[0, 2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'forage' && anchors.NpcForageShop && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcForageShop[0], anchors.NpcForageShop[1] + 0.02, anchors.NpcForageShop[2]]} rotation={[0, -2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'forage' && anchors.NpcForageBuyer && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcForageBuyer[0], anchors.NpcForageBuyer[1] + 0.02, anchors.NpcForageBuyer[2]]} rotation={[0, 2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'farm' && anchors.NpcFarmShop && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcFarmShop[0], anchors.NpcFarmShop[1] + 0.02, anchors.NpcFarmShop[2]]} rotation={[0, -2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'farm' && anchors.NpcProduceBuyer && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcProduceBuyer[0], anchors.NpcProduceBuyer[1] + 0.02, anchors.NpcProduceBuyer[2]]} rotation={[0, 2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'mine' && anchors.NpcMineShop && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcMineShop[0], anchors.NpcMineShop[1] + 0.02, anchors.NpcMineShop[2]]} rotation={[0, -2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'mine' && anchors.NpcOreBuyer && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcOreBuyer[0], anchors.NpcOreBuyer[1] + 0.02, anchors.NpcOreBuyer[2]]} rotation={[0, 2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {secretActive && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.82} position={[secretPoint[0], secretPoint[1] + 0.02, secretPoint[2]]} rotation={[0, Math.PI * 0.72, 0]} animation="Armature|Idle_Talking_Loop" />}
      {minigameOpen && minigameKind === 'forage' && (['Apple', 'Orange', 'Truffle', 'Discovery'] as const).map((label) => {
        const point = anchors[`NpcForageRush${label}`]
        if (!point) return null
        const kind = label.toLowerCase() as keyof typeof forageRushDelivered
        return <group key={label}><AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[point[0], point[1] + .02, point[2]]} rotation={[0, Math.PI, 0]} animation="Armature|Idle_Talking_Loop" /><Html position={[point[0], point[1] + 2.25, point[2]]} center style={{ pointerEvents: 'none' }}><span className={`world-label ${forageRushDelivered[kind] ? 'complete' : ''}`}>{forageRushDelivered[kind] ? 'DONE' : label.toUpperCase()}</span></Html></group>
      })}
      {zone === 'farm' && Object.entries(farmCells).map(([key, cell]) => {
        if (cell.stage === 'empty') return null
        const [farmIndex, cellIndex] = key.split(':').map(Number)
        const point = anchors[`FarmCell${farmIndex}_${String(cellIndex).padStart(2, '0')}`]
        if (!point) return null
        const cropHeight = cell.stage === 'planted' ? 0.17 : cell.stage === 'watered' ? 0.34 : 0.52
        const cropSources = cell.crop === 'pumpkin'
          ? ['/assets/3d/crops/pumpkin_1.glb', '/assets/3d/crops/pumpkin_3.glb', '/assets/3d/crops/pumpkin_crop.glb']
          : cell.crop === 'watermelon'
            ? ['/assets/3d/crops/watermelon_1.glb', '/assets/3d/crops/watermelon_3.glb', '/assets/3d/crops/watermelon_crop.glb']
            : cell.crop === 'wheat'
              ? ['/assets/3d/crops/wheat_crop.glb', '/assets/3d/crops/wheat_crop.glb', '/assets/3d/crops/wheat_crop.glb']
              : cell.crop === 'lettuce'
                ? ['/assets/3d/crops/lettuce_crop.glb', '/assets/3d/crops/lettuce_crop.glb', '/assets/3d/crops/lettuce_crop.glb']
                : ['/assets/3d/crops/tomato_1.glb', '/assets/3d/crops/tomato_3.glb', '/assets/3d/crops/tomato_crop.glb']
        const cropSource = cropSources[cell.stage === 'planted' ? 0 : cell.stage === 'watered' ? 1 : 2]
        return <NormalizedModel key={key} src={cropSource} height={cropHeight} position={[point[0], point[1], point[2]]} rotation={[0, cellIndex * 0.73, 0]} />
      })}
      {minigameOpen && minigameKind === 'farm' && Object.entries(farmRushCells).map(([key, cell]) => {
        if (cell.stage === 'empty' || !cell.crop) return null
        const point = anchors[key]
        if (!point) return null
        const stage = cell.stage === 'watered' && cell.readyAt <= Date.now() ? 'ready' : cell.stage
        const cropHeight = stage === 'planted' ? .17 : stage === 'watered' ? .34 : .52
        const cropSources = cell.crop === 'pumpkin'
          ? ['/assets/3d/crops/pumpkin_1.glb', '/assets/3d/crops/pumpkin_3.glb', '/assets/3d/crops/pumpkin_crop.glb']
          : cell.crop === 'watermelon'
            ? ['/assets/3d/crops/watermelon_1.glb', '/assets/3d/crops/watermelon_3.glb', '/assets/3d/crops/watermelon_crop.glb']
            : cell.crop === 'wheat'
              ? ['/assets/3d/crops/wheat_crop.glb', '/assets/3d/crops/wheat_crop.glb', '/assets/3d/crops/wheat_crop.glb']
              : cell.crop === 'lettuce'
                ? ['/assets/3d/crops/lettuce_crop.glb', '/assets/3d/crops/lettuce_crop.glb', '/assets/3d/crops/lettuce_crop.glb']
              : ['/assets/3d/crops/tomato_1.glb', '/assets/3d/crops/tomato_3.glb', '/assets/3d/crops/tomato_crop.glb']
        return <NormalizedModel key={key} src={cropSources[stage === 'planted' ? 0 : stage === 'watered' ? 1 : 2]} height={cropHeight} position={point} rotation={[0, Number(key.slice(-2)) * .73, 0]} />
      })}
    </>
  )
}

type InteractionCandidate = { id: string; label: string; anchor: string; reach: number; lift?: number }

function eventBayForAnchor(anchor: string) {
  const match = /^(?:RushOre|FarmRushCell|FarmRushCooker)(\d+)(?:_|$)/.exec(anchor)
  return match ? Number(match[1]) : null
}

function candidateForAnchor(anchor: string, claimedFarms: number[], furnaceCount: number): InteractionCandidate | null {
  if (anchor.startsWith('FarmRushCell')) return { id: anchor, label: 'Use Plot', anchor, reach: 3.25, lift: .08 }
  if (anchor.startsWith('FarmRushCooker')) return { id: anchor, label: 'Cook', anchor, reach: 3.4, lift: 1 }
  if (anchor.startsWith('ForageRushDeliver')) return { id: anchor, label: 'Deliver', anchor, reach: 3.4, lift: 1 }
  if (anchor.startsWith('ForageRushApple')) return { id: anchor, label: 'Apples', anchor, reach: 3.25, lift: .5 }
  if (anchor.startsWith('ForageRushOrange')) return { id: anchor, label: 'Oranges', anchor, reach: 3.25, lift: .5 }
  if (anchor.startsWith('ForageRushTruffle')) return { id: anchor, label: 'Truffle', anchor, reach: 3.1, lift: .18 }
  if (anchor.startsWith('ForageRushDiscovery')) return { id: anchor, label: 'Discovery', anchor, reach: 3.1, lift: .25 }
  if (anchor.startsWith('SecretSite')) return { id: 'secret-npc', label: 'Trade', anchor, reach: 3.1 }
  if (anchor === 'Shop') return { id: 'shop', label: 'Common Shop', anchor, reach: 3 }
  if (anchor === 'Stocks') return { id: 'stocks', label: 'Stock Exchange', anchor, reach: 3 }
  if (anchor === 'FarmShop') return { id: 'farm-shop', label: 'Farm Shop', anchor, reach: 3 }
  if (anchor === 'ProduceBuyer') return { id: 'produce-shop', label: 'Produce Stand', anchor, reach: 3 }
  if (anchor === 'MineShop') return { id: 'mine-shop', label: 'Mining Shop', anchor, reach: 3 }
  if (anchor === 'OreBuyer') return { id: 'ore-shop', label: 'Ore Stand', anchor, reach: 3 }
  if (anchor === 'ForageShop') return { id: 'forage-shop', label: 'Foraging Shop', anchor, reach: 3 }
  if (anchor === 'ForageBuyer') return { id: 'forage-sell', label: 'Forage Market', anchor, reach: 3 }
  const furnace = /^FurnacePad(\d+)$/.exec(anchor)
  if (furnace && furnaceCount > 0 && claimedFarms.slice(0, 1).includes(Number(furnace[1]))) return { id: `furnace:${furnace[1]}`, label: 'Cook', anchor, reach: 3.2, lift: 1 }
  if (anchor.startsWith('Forage')) {
    const label = anchor.startsWith('ForageApple') ? 'Harvest Apples'
      : anchor.startsWith('ForageOrange') ? 'Harvest Oranges'
        : anchor.startsWith('ForageTruffle') ? 'Gather Truffle'
          : anchor.startsWith('ForageDiscovery') ? 'Inspect Fossil' : 'Forage'
    return { id: `forage:${anchor}`, label, anchor, reach: 3.2, lift: anchor.startsWith('ForageApple') || anchor.startsWith('ForageOrange') ? 0.5 : 0.18 }
  }
  const cell = /^FarmCell(\d+)_(\d+)$/.exec(anchor)
  if (cell && claimedFarms.includes(Number(cell[1]))) return { id: `farm-cell:${cell[1]}:${Number(cell[2])}`, label: 'Use Plot', anchor, reach: 3.25, lift: 0.08 }
  const claim = /^FarmClaim(\d+)$/.exec(anchor)
  if (claim) return { id: `farm-claim:${claim[1]}`, label: claimedFarms.includes(Number(claim[1])) ? 'Your Farm' : 'Claim Farm', anchor, reach: 3.2, lift: 1 }
  if (anchor.startsWith('Mine')) return { id: anchor, label: 'Mine Ore', anchor, reach: 3.25, lift: 0.55 }
  if (anchor.startsWith('RushOre')) return { id: anchor, label: 'Mine Ore', anchor, reach: 3.4, lift: 0.55 }
  return null
}

function InteractionTargeter() {
  const anchors = useGameStore((state) => state.anchors)
  const player = useGameStore((state) => state.playerPosition)
  const claimedFarms = useGameStore((state) => state.claimedFarms)
  const furnaceCount = useGameStore((state) => state.inventory.furnace ?? 0)
  const collectedForage = useGameStore((state) => state.collectedForage)
  const minedNodes = useGameStore((state) => state.minedNodes)
  const rushNodes = useGameStore((state) => state.rushNodes)
  const forageRushCollected = useGameStore((state) => state.forageRushCollected)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const eventBay = useGameStore((state) => state.eventBay)
  const sessionSeed = useGameStore((state) => state.sessionSeed)
  const matchStartedAt = useGameStore((state) => state.matchStartedAt)
  const shiftLocked = useGameStore((state) => state.shiftLocked)
  const zone = useGameStore((state) => state.zone)
  const roundNumber = useGameStore((state) => state.roundNumber)
  const setPrompt = useGameStore((state) => state.setPrompt)
  const { camera, scene } = useThree()
  const lastCheck = useRef(0)
  const previous = useRef<string | null>(null)
  const lineOfSight = useRef(new THREE.Raycaster())

  useFrame((state) => {
    if (state.clock.elapsedTime - lastCheck.current < 0.055) return
    lastCheck.current = state.clock.elapsedTime
    let best: { candidate: InteractionCandidate; score: number } | null = null
    const anchorIds = Object.keys(anchors)
    const activeRares = activeRareForageIds(anchorIds, minigameOpen && minigameKind === 'forage', sessionSeed, matchStartedAt)
    for (const anchor of anchorIds) {
      if (minigameOpen && !anchor.startsWith('RushOre') && !anchor.startsWith('FarmRush') && !anchor.startsWith('ForageRush')) continue
      if (minigameOpen && eventBayForAnchor(anchor) !== null && eventBayForAnchor(anchor) !== eventBay) continue
      if (anchor.startsWith('SecretSite') && (zone === 'hub' || secretZoneForRound(roundNumber) !== zone || anchor !== `SecretSite${secretSiteForRound(zone, roundNumber, sessionSeed)}`)) continue
      const candidate = candidateForAnchor(anchor, claimedFarms, furnaceCount)
      if (!candidate) continue
      if ((anchor.startsWith('ForageTruffle') || anchor.startsWith('ForageDiscovery') || anchor.startsWith('ForageRushTruffle') || anchor.startsWith('ForageRushDiscovery')) && !activeRares.has(anchor)) continue
      if (candidate.id.startsWith('forage:') && forageSiteAvailability(anchor, collectedForage[anchor] ?? 0) <= 0) continue
      if (candidate.id.startsWith('Mine') && (minedNodes[candidate.id] ?? 0) > Date.now()) continue
      if (candidate.id.startsWith('RushOre') && (rushNodes[candidate.id]?.readyAt ?? 0) > Date.now()) continue
      if (candidate.id.startsWith('ForageRush') && !candidate.id.startsWith('ForageRushDeliver') && (forageRushCollected[candidate.id] ?? 0) > Date.now()) continue
      const point = anchors[anchor]
      const distance = Math.hypot(player[0] - point[0], player[2] - point[2])
      if (distance > candidate.reach) continue
      let score = distance
      const eventTarget = candidate.id.startsWith('FarmRush') || candidate.id.startsWith('ForageRush')
      if (shiftLocked || eventTarget || candidate.id.startsWith('Mine') || candidate.id.startsWith('RushOre')) {
        const projected = new THREE.Vector3(point[0], point[1] + (candidate.lift ?? 0.45), point[2]).project(camera)
        if (projected.z < -1 || projected.z > 1) continue
        const centerDistance = Math.hypot(projected.x, projected.y)
      if (centerDistance > (candidate.id.startsWith('Mine') || candidate.id.startsWith('RushOre') ? 0.2 : candidate.id.startsWith('FarmRushCell') ? .4 : candidate.id.startsWith('ForageRush') ? .85 : eventTarget ? .38 : 0.34)) continue
        if (candidate.id.startsWith('Mine') || candidate.id.startsWith('RushOre')) {
          const target = new THREE.Vector3(point[0], point[1] + (candidate.lift ?? 0.45), point[2])
          const direction = target.clone().sub(camera.position)
          const targetDistance = direction.length()
          const environment = scene.children.find((child) => child.userData.environment)
          if (environment && targetDistance > 0.001) {
            lineOfSight.current.set(camera.position, direction.normalize())
            lineOfSight.current.far = targetDistance + 0.65
            const hit = lineOfSight.current.intersectObject(environment, true).find((entry) => entry.object.visible)
            let owner: THREE.Object3D | null = hit?.object ?? null
            while (owner && !owner.name.startsWith('Resource_')) owner = owner.parent
            if (hit && owner?.name !== `Resource_${candidate.id}` && hit.distance < targetDistance - 0.6) continue
          }
        }
        score = centerDistance * 18 + distance * 0.08
      }
      if (candidate.id === previous.current) score -= 0.06
      if (!best || score < best.score) best = { candidate, score }
    }
    const next = best?.candidate ?? null
    const currentPrompt = useGameStore.getState().prompt
    if (next?.id !== previous.current || next?.label !== currentPrompt?.label) {
      previous.current = next?.id ?? null
      setPrompt(next ? { id: next.id, label: next.label } : null)
    }
  })
  return null
}

function InteractionFocus() {
  const prompt = useGameStore((state) => state.prompt)
  const anchors = useGameStore((state) => state.anchors)
  const roundNumber = useGameStore((state) => state.roundNumber)
  const sessionSeed = useGameStore((state) => state.sessionSeed)
  const zone = useGameStore((state) => state.zone)
  if (!prompt) return null
  const cell = /^farm-cell:(\d+):(\d+)$/.exec(prompt.id)
  const rushCell = /^FarmRushCell\d+_\d+$/.test(prompt.id)
  const claim = /^farm-claim:(\d+)$/.exec(prompt.id)
  const anchorId = prompt.id.startsWith('forage:')
    ? prompt.id.slice(7)
    : cell
      ? `FarmCell${cell[1]}_${String(Number(cell[2])).padStart(2, '0')}`
      : claim
        ? `FarmClaim${claim[1]}`
        : ({ shop: 'NpcShop', stocks: 'NpcStocks', 'forage-shop': 'NpcForageShop', 'forage-sell': 'NpcForageBuyer', 'farm-shop': 'NpcFarmShop', 'produce-shop': 'NpcProduceBuyer', 'mine-shop': 'NpcMineShop', 'ore-shop': 'NpcOreBuyer', 'secret-npc': zone === 'hub' ? '' : `SecretSite${secretSiteForRound(zone, roundNumber, sessionSeed)}` } as Record<string, string>)[prompt.id] ?? prompt.id
  const furnace = /^furnace:(\d+)$/.exec(prompt.id)
  const point = anchors[furnace ? `FurnacePad${furnace[1]}` : anchorId]
  if (!point) return null
  if (cell || rushCell) return (
    <mesh position={[point[0], point[1] + 0.035, point[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[rushCell ? 2.3 : 1.22, rushCell ? 2.3 : 1.22]} />
      <meshBasicMaterial color="#efc66b" transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
  return (
    <mesh position={[point[0], point[1] + 0.045, point[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.48, 0.045, 8, 32]} />
      <meshBasicMaterial color="#efc66b" transparent opacity={0.86} depthWrite={false} />
    </mesh>
  )
}

function WorldLabels() {
  const zone = useGameStore((state) => state.zone)
  const anchors = useGameStore((state) => state.anchors)
  const claimedFarms = useGameStore((state) => state.claimedFarms)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const eventBay = useGameStore((state) => state.eventBay)
  const labels = minigameOpen && minigameKind === 'farm' ? [
        { key: 'assigned-plot', text: 'YOUR PLOT', point: anchors[`FarmRushCell${eventBay}_02`], lift: 1.85 },
      ] : minigameOpen && minigameKind === 'mining' ? [
        { key: 'assigned-bay', text: 'YOUR BAY', point: anchors[`RushOre${eventBay}_02`], lift: 2.25 },
      ] : minigameOpen && minigameKind === 'forage' ? [
      ] : zone === 'hub' ? [
        { key: 'forage', text: 'FORAGE', point: anchors.PortalForage, lift: 5.75 },
        { key: 'farm', text: 'FARM', point: anchors.PortalFarm, lift: 5.75 },
        { key: 'mine', text: 'MINE', point: anchors.PortalMine, lift: 5.75 },
        { key: 'shop', text: 'COMMON SHOP', point: anchors.Shop, lift: 3.2 },
        { key: 'stocks', text: 'STOCK EXCHANGE', point: anchors.Stocks, lift: 3.2 },
      ] : zone === 'farm' ? [
        { key: 'home', text: 'HOME', point: anchors.Home, lift: 5.75 },
        ...claimedFarms.map((farm) => ({ key: `owned-farm-${farm}`, text: 'YOUR FARM', point: anchors[`FarmPlot${farm}`] ?? anchors.FarmPlot, lift: 2.2 })),
        { key: 'farm-shop', text: 'FARM SHOP', point: anchors.FarmShop, lift: 3.2 },
        { key: 'produce', text: 'PRODUCE STAND', point: anchors.ProduceBuyer, lift: 3.2 },
      ] : zone === 'mine' ? [
        { key: 'home', text: 'HOME', point: anchors.Home, lift: 5.75 },
        { key: 'mine-shop', text: 'MINING SHOP', point: anchors.MineShop, lift: 3.2 },
        { key: 'ore', text: 'ORE STAND', point: anchors.OreBuyer, lift: 3.2 },
      ] : [
        { key: 'home', text: 'HOME', point: anchors.Home, lift: 5.75 },
        { key: 'forage-shop', text: 'FORAGING SHOP', point: anchors.ForageShop, lift: 3.2 },
        { key: 'forage-market', text: 'FORAGE MARKET', point: anchors.ForageBuyer, lift: 3.2 },
      ]
  return <>{labels.map(({ key, text, point, lift }) => point && (
    <Html key={key} position={[point[0], point[1] + lift, point[2]]} center zIndexRange={key === 'assigned-plot' || key === 'assigned-bay' ? [24, 24] : [1, 0]} style={{ pointerEvents: 'none' }}>
      <span className={`world-label ${key}`}>{text}</span>
    </Html>
  ))}</>
}

function LoadingMark() {
  return (
    <mesh rotation={[0, 0, Math.PI / 4]}>
      <octahedronGeometry args={[0.35, 0]} />
      <meshStandardMaterial color="#e6bd69" roughness={0.7} />
    </mesh>
  )
}

export function GameWorld() {
  return (
    <Canvas shadows="basic" dpr={[1, 1.5]} camera={{ fov: 48, near: 0.1, far: 300, position: [0, 4.2, 20.2] }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <SceneLighting />
      <WeatherEffect />
      <Suspense fallback={<LoadingMark />}>
        <EnvironmentScene />
        <Player />
        <MultiplayerPresence />
        <InteractiveWorldObjects />
        <InteractionTargeter />
        <InteractionFocus />
        <WorldLabels />
      </Suspense>
    </Canvas>
  )
}

useGLTF.preload('/assets/3d/characters/ranger.glb')
useGLTF.preload('/assets/3d/characters/shopkeeper.glb')
useGLTF.preload('/assets/3d/animations/standard.glb')
useGLTF.preload('/assets/3d/crops/mushroom_crop.glb')
useGLTF.preload('/assets/3d/crops/lettuce_crop.glb')
useGLTF.preload('/assets/3d/crops/wheat_crop.glb')
useGLTF.preload('/assets/3d/crops/tomato_1.glb')
useGLTF.preload('/assets/3d/crops/tomato_3.glb')
useGLTF.preload('/assets/3d/crops/tomato_crop.glb')
useGLTF.preload('/assets/3d/crops/pumpkin_1.glb')
useGLTF.preload('/assets/3d/crops/pumpkin_3.glb')
useGLTF.preload('/assets/3d/crops/pumpkin_crop.glb')
useGLTF.preload('/assets/3d/crops/watermelon_1.glb')
useGLTF.preload('/assets/3d/crops/watermelon_3.glb')
useGLTF.preload('/assets/3d/crops/watermelon_crop.glb')
