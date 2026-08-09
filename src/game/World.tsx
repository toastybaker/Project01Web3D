import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, useAnimations, useGLTF, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { Client as ColyseusClient } from 'colyseus.js'
import { economyProgressValue, secretSiteForRound, secretZoneForRound, useGameStore, type AnchorMap, type WeatherKind, type WorldCollider, type ZoneId } from './store'
import { ORE_COLORS, canMineOre, oreKindAtDepth } from './ore'
import { emitMultiplayer, setMultiplayerSender, stableProfileId } from './multiplayer'
import { activeRareForageIds, forageSiteAvailability, fruitTreeCapacity } from './config'
import { miningRushOre, type MinigameKind } from './minigame'
import { playGameSfx } from './sfx'
import { uiText } from './i18n'
import { ITEMS, type ItemId } from './items'

const SCENES: Record<ZoneId, string> = {
  hub: '/assets/3d/scenes/hub.glb?v=29',
  forage: '/assets/3d/scenes/forage.glb?v=39',
  farm: '/assets/3d/scenes/farm.glb?v=28',
  mine: '/assets/3d/scenes/mine.glb?v=52',
}
const MINING_RUSH_SCENE = '/assets/3d/scenes/mining-rush.glb?v=17'
const FARM_RUSH_SCENE = '/assets/3d/scenes/farm-rush.glb?v=17'
const FORAGE_RUSH_SCENE = '/assets/3d/scenes/forage-rush.glb?v=19'
const MINIGAME_SCENES: Record<MinigameKind, string> = { mining: MINING_RUSH_SCENE, farm: FARM_RUSH_SCENE, forage: FORAGE_RUSH_SCENE }
const EMPTY_RESOURCE_IDS = new Set<string>()
const livePlayerPosition = new THREE.Vector3(0, 0.86, 14)
const HELD_PICKAXES = new Set<ItemId>(['worn-pickaxe', 'iron-pickaxe', 'steel-pickaxe', 'crystal-pickaxe'])
type HeldPickaxeId = 'worn-pickaxe' | 'iron-pickaxe' | 'steel-pickaxe' | 'crystal-pickaxe'
const MINING_STABLE_TRACKS = ['pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r', 'hand_l', 'hand_r']

function characterAnimationClips(standard: THREE.AnimationClip[], tools: THREE.AnimationClip[]) {
  const idle = standard.find((clip) => clip.name === 'Armature|Idle_Loop')
  return [
    ...standard,
    ...tools.map((clip) => {
      if (clip.name !== 'TreeChopping_Loop') return clip
      const mining = clip.clone()
      // Keep the authored shoulder/torso swing, but use the established idle
      // stance and closed hands. An upper-body-only clip leaves unkeyed bones
      // in bind pose, which was why the feet snapped together and the grip
      // appeared to open while mining.
      const swingTracks = mining.tracks.filter((track) => !MINING_STABLE_TRACKS.some((bone) => track.name.includes(bone)))
      const stableTracks = idle?.tracks
        .filter((track) => MINING_STABLE_TRACKS.some((bone) => track.name.includes(bone)))
        .map((track) => track.clone()) ?? []
      mining.tracks = [...swingTracks, ...stableTracks]
      return mining
    }),
  ]
}

function visibleRareForageIds(
  ids: string[],
  rush: boolean,
  authoritativeRushIds: string[] | null,
  sessionSeed: number,
  matchStartedAt: number,
  now: number,
  participantCount: number,
  eventKey: number,
) {
  if (rush && authoritativeRushIds !== null) return new Set(authoritativeRushIds)
  return activeRareForageIds(ids, rush, sessionSeed, matchStartedAt, now, participantCount, eventKey)
}

const visualGateMode = new URLSearchParams(window.location.search).get('gate')
const resourceVisualTarget = new URLSearchParams(window.location.search).get('target')
const miningMotionVisualTest = new URLSearchParams(window.location.search).get('motion') === 'mining'
const heldVisualParam = new URLSearchParams(window.location.search).get('held')
const heldItemVisualTest = heldVisualParam && heldVisualParam in ITEMS ? heldVisualParam as ItemId : null
const frontVisualTest = new URLSearchParams(window.location.search).get('camera') === 'front'
const closeVisualTest = new URLSearchParams(window.location.search).get('camera') === 'close'
const merchantSiteVisualParam = Number(new URLSearchParams(window.location.search).get('site'))
const merchantSiteVisualTest = Number.isInteger(merchantSiteVisualParam) && merchantSiteVisualParam >= 0 && merchantSiteVisualParam <= 2 ? merchantSiteVisualParam : null
const pickaxeTiltVisualParam = Number(new URLSearchParams(window.location.search).get('pickTilt'))
const pickaxeTiltVisualTest = Number.isFinite(pickaxeTiltVisualParam) ? THREE.MathUtils.clamp(pickaxeTiltVisualParam, -1.2, 1.2) : null
const deepVisualGate = visualGateMode === 'deep'
const resourceVisualGate = visualGateMode === 'resource'
const furnaceVisualGate = visualGateMode === 'furnace'
const farmCellVisualGate = visualGateMode === 'cell'
const bypassLobbyClient = new URLSearchParams(window.location.search).has('gate') || new URLSearchParams(window.location.search).has('panel') || new URLSearchParams(window.location.search).has('zone')

const FALLBACK_SPAWNS: Record<ZoneId, [number, number, number]> = {
  hub: [0, 0, 14],
  forage: [0, 0, -69],
  farm: [0, 0, 17],
  mine: [0, 0, 44],
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
  [-10,24],[-18,12],[-40,8],[-57,-1],[-64,-18],[-62,-36],[-48,-51],[-61,-64],[-67,-82],[-61,-96],[-43,-108],[-54,-120],[-53,-139],[-45,-158],[-53,-176],[-43,-191],[-35,-211],[-46,-229],[-31,-246],[-9,-253],
  [10,-253],[31,-246],[46,-229],[35,-211],[43,-191],[53,-176],[45,-158],[53,-139],[54,-120],[42,-108],[59,-98],[67,-83],[63,-63],[49,-50],[62,-36],[64,-17],[57,-1],[40,8],[18,12],[10,24],
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

function cameraObstructionMeshes(environment: THREE.Object3D | undefined) {
  if (!environment) return []
  const meshes: THREE.Object3D[] = []
  environment.updateMatrixWorld(true)
  environment.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return
    let parent: THREE.Object3D | null = object
    while (parent && parent !== environment) {
      if (parent.name.startsWith('Resource_') || parent.name.startsWith('Anchor_')) return
      parent = parent.parent
    }
    if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere()
    const radius = (object.geometry.boundingSphere?.radius ?? 0) * object.getWorldScale(new THREE.Vector3()).length() / Math.sqrt(3)
    if (radius >= 0.62) meshes.push(object)
  })
  return meshes
}

function isHierarchyVisible(object: THREE.Object3D, root: THREE.Object3D) {
  let current: THREE.Object3D | null = object
  while (current) {
    if (!current.visible) return false
    if (current === root) break
    current = current.parent
  }
  return true
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
  const westBank = Math.exp(-((x + 86) ** 2) / 260) * 5.5
  const eastBank = Math.exp(-((x - 88) ** 2) / 300) * 5.8
  const farBank = smoothstep(78, 108, -z) * 5.2
  const entryBank = smoothstep(55, 92, z) * 3.8
  let height = raw + westBank + eastBank + farBank + entryBank
  farmParcels.forEach(([cx, cz], index) => {
    const distance = Math.max(Math.abs(x - cx), Math.abs(z - cz))
    const influence = 1 - smoothstep(8.2, 12.5, distance)
    const terrace = Math.sin(cx * 0.045) * 0.48 + Math.cos(cz * 0.052) * 0.38 + Math.sin((cx - cz) * 0.085) * 0.15
      + Math.exp(-((cx + 86) ** 2) / 260) * 5.5 + Math.exp(-((cx - 88) ** 2) / 300) * 5.8
      + smoothstep(78, 108, -cz) * 5.2 + smoothstep(55, 92, cz) * 3.8 + (index > 3 ? -0.08 : 0.08)
    height = THREE.MathUtils.lerp(height, terrace, influence)
  })
  return height
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
                : -22 - smoothstep(0, 1, THREE.MathUtils.clamp((-146 - z) / 56, 0, 1)) * 4.8
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
  if (z < -150) {
    const deep = smoothstep(150, 198, -z)
    const bank = smoothstep(18, 42, Math.abs(x)) * (1.4 + deep * 3.4)
    const terraces = smoothstep(160, 168, -z) * 0.9
      + smoothstep(174, 183, -z) * 1.05
      + smoothstep(188, 198, -z) * 1.2
    level += bank - terraces
  }
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

const MINE_LANTERN_SITES = [
  [-7, 7], [-28, -8], [29, -10],
  [-42, -39], [41, -42], [-42, -70], [43, -73],
  [-34, -103], [35, -103], [-4, -111],
  [-31, -139], [31, -140], [-5, -169], [8, -192],
  [-13, -218], [15, -231],
] as const

function SceneLighting({ reduced = false }: { reduced?: boolean }) {
  const { scene } = useThree()
  const sun = useRef<THREE.DirectionalLight>(null)
  const hemisphere = useRef<THREE.HemisphereLight>(null)
  const mineLights = useRef<THREE.PointLight[]>([])
  const nextMineLightRefresh = useRef(0)
  const shadowTarget = useMemo(() => new THREE.Object3D(), [])
  const zone = useGameStore((state) => state.zone)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const mineExterior = false
  const weather = useGameStore((state) => state.weather)
  const graphicsMode = useGameStore((state) => state.graphicsMode)
  const eventMining = minigameOpen && minigameKind === 'mining'
  const mineLike = zone === 'mine' || (minigameOpen && minigameKind === 'mining')
  const shadowsEnabled = graphicsMode !== 'low' && !reduced
  const high = graphicsMode === 'high'
  const mineLightCount = high && !reduced ? 5 : 4
  const shadowMapSize = 2048
  // High keeps one stable field large enough for the complete authored zones.
  // A small player-following field made tree and building shadows pop in.
  const shadowFrustum = high ? 72 : 42
  useEffect(() => {
    scene.add(shadowTarget)
    return () => { scene.remove(shadowTarget) }
  }, [scene, shadowTarget])
  useFrame((state) => {
    const [x, y, z] = useGameStore.getState().playerPosition
    const overcast = weather === 'rain' || weather === 'mist'
    if (hemisphere.current) {
      const entranceLight = mineLike && !eventMining ? THREE.MathUtils.smoothstep(z, -4, 30) : 0
      const caveFill = high && !reduced ? .24 : .38
      hemisphere.current.intensity = eventMining
        ? high && !reduced ? .4 : .5
        : mineLike
          ? THREE.MathUtils.lerp(caveFill, 1.06, entranceLight)
          : overcast ? high && !reduced ? .42 : .56 : high && !reduced ? .32 : .68
    }
    if (sun.current && shadowsEnabled) {
      const texel = shadowFrustum * 2 / shadowMapSize
      const focusX = Math.round(x / texel) * texel
      const focusZ = Math.round(z / texel) * texel
      shadowTarget.position.set(focusX, y + .4, focusZ)
      // A lower, side-lit key gives foliage, booths and portal stones readable
      // form. The former near-overhead sun flattened the whole clearing even
      // with high-resolution shadows enabled.
      sun.current.position.set(focusX - 19, y + 24, focusZ + 13)
      sun.current.target = shadowTarget
      shadowTarget.updateMatrixWorld()
    }
    if (sun.current) {
      const entranceLight = mineLike && !eventMining ? THREE.MathUtils.smoothstep(z, -4, 30) : 0
      sun.current.intensity = eventMining
        ? high && !reduced ? .76 : .94
        : mineLike
          ? THREE.MathUtils.lerp(high && !reduced ? .24 : .44, 1.16, entranceLight)
          : overcast ? (high ? 1.32 : 1.22) : weather === 'sunny' ? (high ? 2.48 : 2.15) : high ? 2.24 : 1.9
      if (!mineLike || mineExterior && !eventMining) sun.current.color.set(overcast ? '#d2dad4' : '#ffe1ad')
    }
    if (mineLike && state.clock.elapsedTime >= nextMineLightRefresh.current) {
      nextMineLightRefresh.current = state.clock.elapsedTime + .25
      const sites = eventMining
        ? [
            { color: '#efbd79', intensity: 15.5, distance: 50, position: [0, 4.6, 18] },
            { color: '#d99a5c', intensity: 12.5, distance: 46, position: [-16, 3.2, -3] },
            { color: '#9cbcc0', intensity: 11.5, distance: 46, position: [16, 3.2, -5] },
          ]
        : [
            { color: '#efc98e', intensity: 5.8, distance: 11, position: [-8.5, 2.3, 22.5] },
            { color: '#efc98e', intensity: 5.8, distance: 11, position: [8.5, 2.3, 22.5] },
            { color: '#efbd79', intensity: high && !reduced ? 10.5 : 9.5, distance: high && !reduced ? 42 : 40, position: [0, 4.6, 18] },
            ...MINE_LANTERN_SITES.map(([lightX, lightZ], index) => ({
              color: index % 5 === 3 ? '#b6c8c3' : index % 3 === 1 ? '#e3aa69' : '#efbd79',
              intensity: high && !reduced ? 38 : 32,
              distance: high && !reduced ? 30 : 29,
              position: [lightX, mineGroundHeight(lightX, lightZ) + 1.9, lightZ],
            })),
          ]
      const nearest = sites.sort((a, b) => {
        const distanceA = (a.position[0] - x) ** 2 + (a.position[1] - y) ** 2 + (a.position[2] - z) ** 2
        const distanceB = (b.position[0] - x) ** 2 + (b.position[1] - y) ** 2 + (b.position[2] - z) ** 2
        return distanceA - distanceB
      }).slice(0, mineLightCount)
      mineLights.current.slice(0, mineLightCount).forEach((light, index) => {
        const site = nearest[index]
        if (!light || !site) return
        light.color.set(site.color)
        light.intensity = site.intensity
        light.distance = site.distance
        light.position.set(site.position[0], site.position[1], site.position[2])
      })
    }
  })
  useEffect(() => {
    const overcast = weather === 'rain' || weather === 'mist'
    const colors = eventMining
      ? ['#252728', '#343536']
      : mineLike && !mineExterior
        ? ['#17191a', '#292b2b']
        : overcast
          ? zone === 'forage' ? ['#486a76', '#627a76'] : ['#536f79', '#687d78']
          : weather === 'sunny'
            ? zone === 'forage' ? ['#5f91a5', '#9eb698'] : ['#6b9aae', '#acbd9f']
            : zone === 'farm' ? ['#648fa2', '#91a995'] : zone === 'hub' ? ['#638fa2', '#8ea493'] : ['#5f8898', '#849d8b']
    scene.background = new THREE.Color(colors[0])
    const outdoor = zone !== 'mine' || mineExterior
    const mist = weather === 'mist' && outdoor
    const rain = weather === 'rain' && outdoor
    scene.fog = new THREE.Fog(
      mineExterior ? '#353a37' : colors[1],
      mist ? (zone === 'forage' ? 48 : 42) : rain ? (zone === 'forage' ? 72 : 78) : zone === 'hub' ? 70 : zone === 'forage' ? 108 : zone === 'farm' || mineExterior ? 92 : 42,
      mist ? (zone === 'forage' ? 148 : 132) : rain ? (zone === 'forage' ? 212 : 196) : zone === 'hub' ? 152 : zone === 'forage' ? 252 : zone === 'farm' || mineExterior ? 208 : 174,
    )
  }, [eventMining, mineExterior, mineLike, scene, weather, zone])
  return (
    <>
      <ambientLight color={mineLike ? '#879092' : '#b9c6bb'} intensity={eventMining ? .018 : mineLike ? .015 : weather === 'rain' || weather === 'mist' ? .05 : high ? .018 : .03} />
      <hemisphereLight ref={hemisphere} color={mineLike ? '#9daaad' : '#bcd2d5'} groundColor={mineLike ? '#241f1b' : '#46573e'} intensity={eventMining ? high && !reduced ? .34 : .44 : mineLike ? high && !reduced ? .24 : .38 : .62} />
      <directionalLight
        ref={sun}
        castShadow={shadowsEnabled}
        color={mineLike ? '#aebec1' : '#ffe1ad'}
        intensity={eventMining ? high && !reduced ? .68 : .88 : mineLike ? .4 : 1.9}
        position={[-19, 24, 13]}
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
        shadow-camera-left={-shadowFrustum}
        shadow-camera-right={shadowFrustum}
        shadow-camera-top={shadowFrustum}
        shadow-camera-bottom={-shadowFrustum}
        shadow-camera-near={.5}
        shadow-camera-far={high ? 118 : 96}
        shadow-bias={-0.00008}
        shadow-normalBias={0.025}
        shadow-radius={high ? 2.25 : 1.25}
      />
      {zone === 'hub' && <pointLight color="#efb25d" intensity={3.2} distance={10} decay={2} position={[2.6, 2.5, 1.8]} />}
      {mineLike && Array.from({ length: mineLightCount }, (_, index) => <pointLight key={index} ref={(light) => { if (light) mineLights.current[index] = light }} color="#efbd79" intensity={0} distance={34} decay={2} />)}
    </>
  )
}

function StorybookSkyBackground({ weather, zone, high }: { weather: WeatherKind; zone: ZoneId; high: boolean }) {
  const scene = useThree((state) => state.scene)
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = high ? 1024 : 512
    canvas.height = high ? 512 : 256
    const context = canvas.getContext('2d')!
    const forest = zone === 'forage'
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
    if (weather === 'rain') {
      gradient.addColorStop(0, forest ? '#365664' : '#405f6b')
      gradient.addColorStop(.58, forest ? '#60777b' : '#687e80')
      gradient.addColorStop(1, forest ? '#7f9084' : '#899688')
    } else if (weather === 'mist') {
      gradient.addColorStop(0, forest ? '#607a81' : '#687f85')
      gradient.addColorStop(.6, forest ? '#7f928d' : '#879993')
      gradient.addColorStop(1, forest ? '#9da9a0' : '#a5afa4')
    } else if (weather === 'sunny') {
      gradient.addColorStop(0, forest ? '#315f78' : '#376982')
      gradient.addColorStop(.58, forest ? '#608c98' : '#6a96a2')
      gradient.addColorStop(1, forest ? '#9fab8d' : '#b2ad89')
    } else {
      gradient.addColorStop(0, forest ? '#3b687e' : '#456f84')
      gradient.addColorStop(.6, forest ? '#6e9098' : '#7898a0')
      gradient.addColorStop(1, forest ? '#99a78e' : '#a7aa91')
    }
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
    if (high) {
      const overcast = weather === 'rain' || weather === 'mist'
      const sunX = canvas.width * .72
      const sunY = canvas.height * .21
      const glow = context.createRadialGradient(sunX, sunY, 0, sunX, sunY, canvas.height * .42)
      glow.addColorStop(0, overcast ? 'rgba(230,236,225,.14)' : 'rgba(255,226,165,.32)')
      glow.addColorStop(.28, overcast ? 'rgba(218,229,221,.07)' : 'rgba(255,215,148,.15)')
      glow.addColorStop(1, 'rgba(255,255,255,0)')
      context.fillStyle = glow
      context.fillRect(0, 0, canvas.width, canvas.height)

      const horizon = context.createLinearGradient(0, canvas.height * .6, 0, canvas.height)
      horizon.addColorStop(0, 'rgba(255,235,190,0)')
      horizon.addColorStop(1, overcast ? 'rgba(192,205,190,.1)' : 'rgba(238,204,146,.13)')
      context.fillStyle = horizon
      context.fillRect(0, canvas.height * .58, canvas.width, canvas.height * .42)
    }
    const result = new THREE.CanvasTexture(canvas)
    result.colorSpace = THREE.SRGBColorSpace
    result.minFilter = THREE.LinearFilter
    result.magFilter = THREE.LinearFilter
    result.needsUpdate = true
    return result
  }, [high, weather, zone])
  useEffect(() => {
    scene.background = texture
    return () => {
      if (scene.background === texture) scene.background = null
      texture.dispose()
    }
  }, [scene, texture])
  return null
}

function AtmosphericSky() {
  const zone = useGameStore((state) => state.zone)
  const weather = useGameStore((state) => state.weather)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const graphicsMode = useGameStore((state) => state.graphicsMode)
  const mineExterior = false
  if (graphicsMode === 'low' || zone === 'mine' && !mineExterior || (minigameOpen && minigameKind === 'mining')) return null
  return <StorybookSkyBackground weather={weather} zone={zone} high={graphicsMode === 'high'} />
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
      <pointsMaterial color={weather === 'rain' ? '#bdd2d0' : '#cdd8cf'} size={weather === 'rain' ? 1.25 : 2.2} transparent opacity={weather === 'rain' ? 0.56 : 0.11} depthWrite={false} sizeAttenuation={false} />
    </points>
  )
}

function AdaptiveRenderScale({ rendererLow, onReduced }: { rendererLow: boolean; onReduced: (reduced: boolean) => void }) {
  const setDpr = useThree((state) => state.setDpr)
  const graphicsMode = useGameStore((state) => state.graphicsMode)
  const deviceDpr = useMemo(() => window.devicePixelRatio || 1, [])
  const autoDpr = Math.min(deviceDpr, 1.25)
  const presetDpr = graphicsMode === 'low' || (graphicsMode === 'auto' && rendererLow)
    ? Math.min(deviceDpr, .85)
    : graphicsMode === 'medium'
      ? Math.min(deviceDpr, 1)
      : graphicsMode === 'high'
        ? Math.min(deviceDpr, 1.15)
        : autoDpr
  const sample = useRef({ startedAt: performance.now(), frames: 0, currentDpr: presetDpr, recoveryWindows: 0, grace: true, reduced: false })

  useEffect(() => {
    const dpr = presetDpr
    sample.current = { startedAt: performance.now(), frames: 0, currentDpr: dpr, recoveryWindows: 0, grace: true, reduced: false }
    onReduced(false)
    setDpr(dpr)
  }, [graphicsMode, onReduced, presetDpr, rendererLow, setDpr])

  useFrame(() => {
    const now = performance.now()
    const state = sample.current
    state.frames += 1
    const elapsed = now - state.startedAt
    const sampleWindow = graphicsMode === 'auto' ? (state.grace ? 8000 : 4000) : 2500
    if (elapsed < sampleWindow) return

    const fps = state.frames * 1000 / elapsed
    ;(window as unknown as { __P01_PERF?: unknown }).__P01_PERF = { fps, dpr: state.currentDpr, graphicsMode, reduced: state.reduced }
    document.documentElement.dataset.gameFps = fps.toFixed(1)
    document.documentElement.dataset.gameDpr = state.currentDpr.toFixed(2)
    state.startedAt = now
    state.frames = 0
    state.grace = false
    if (graphicsMode !== 'auto') return
    if (fps < 60 && !state.reduced) {
      state.reduced = true
      onReduced(true)
    }
    // Keep the full render scale when the browser is close to the 120 Hz target.
    // The fallback never renders below one physical pixel per CSS pixel.
    if (fps < 90 && state.currentDpr > Math.min(deviceDpr, .85)) {
      state.currentDpr = state.currentDpr > 1 ? Math.min(deviceDpr, 1) : Math.min(deviceDpr, .85)
      state.recoveryWindows = 0
      setDpr(state.currentDpr)
      return
    }
    if (fps > 112) {
      state.recoveryWindows += 1
      if (state.recoveryWindows >= 3) {
        if (state.currentDpr < autoDpr) {
          state.currentDpr = state.currentDpr < 1 ? Math.min(deviceDpr, 1) : autoDpr
          setDpr(state.currentDpr)
        } else if (state.reduced) {
          state.reduced = false
          onReduced(false)
        }
        state.recoveryWindows = 0
      }
    } else state.recoveryWindows = 0
  })
  return null
}

function RendererQuality() {
  const gl = useThree((state) => state.gl)
  const graphicsMode = useGameStore((state) => state.graphicsMode)
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping
    gl.outputColorSpace = THREE.SRGBColorSpace
    gl.toneMappingExposure = graphicsMode === 'high' ? .96 : graphicsMode === 'medium' ? .99 : graphicsMode === 'auto' ? .98 : .97
    // Current Three.js maps the deprecated soft-PCF enum back to PCFShadowMap.
    // Select that supported path directly so high mode keeps the same filtered
    // result without emitting a warning on every scene load.
    gl.shadowMap.type = THREE.PCFShadowMap
    gl.shadowMap.needsUpdate = true
  }, [gl, graphicsMode])
  return null
}

function MaterialEnvironment() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const zone = useGameStore((state) => state.zone)
  const graphicsMode = useGameStore((state) => state.graphicsMode)
  useEffect(() => {
    if (graphicsMode === 'low') {
      scene.environment = null
      return
    }
    const generator = new THREE.PMREMGenerator(gl)
    generator.compileCubemapShader()
    const room = new RoomEnvironment()
    const texture = generator.fromScene(room, .04).texture
    scene.environment = texture
    return () => {
      if (scene.environment === texture) scene.environment = null
      texture.dispose()
      generator.dispose()
    }
  }, [gl, graphicsMode, scene])
  useEffect(() => {
    scene.environmentIntensity = zone === 'mine' ? (graphicsMode === 'high' ? .18 : .16) : graphicsMode === 'high' ? .36 : .28
  }, [graphicsMode, scene, zone])
  return null
}

function HighPostProcessing() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const zone = useGameStore((state) => state.zone)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const mineLike = zone === 'mine' || minigameOpen && minigameKind === 'mining'
  const pipeline = useMemo(() => {
    const composer = new EffectComposer(gl)
    const render = new RenderPass(scene, camera)
    const gtao = new GTAOPass(scene, camera)
    gtao.blendIntensity = .58
    gtao.updateGtaoMaterial({ radius: .48, distanceExponent: 1.45, thickness: 1.05, distanceFallOff: 1.2, scale: .94, samples: 4 })
    gtao.updatePdMaterial({ radius: 4, rings: 2, samples: 4, lumaPhi: 8, depthPhi: 2, normalPhi: 3 })
    const output = new OutputPass()
    composer.addPass(render)
    composer.addPass(gtao)
    // The High canvas already uses hardware MSAA. A second full-screen SMAA
    // pass softened the same edges again while adding a costly extra pass.
    composer.addPass(output)
    return { composer, gtao }
  }, [camera, gl, scene])
  useEffect(() => {
    pipeline.gtao.blendIntensity = mineLike ? .82 : .58
    pipeline.gtao.updateGtaoMaterial({
      radius: mineLike ? .68 : .48,
      distanceExponent: mineLike ? 1.25 : 1.45,
      thickness: mineLike ? 1.22 : 1.05,
      distanceFallOff: mineLike ? 1.05 : 1.2,
      scale: mineLike ? 1.08 : .94,
      samples: 4,
    })
  }, [mineLike, pipeline])
  useEffect(() => {
    const dpr = gl.getPixelRatio()
    pipeline.composer.setSize(size.width, size.height)
    pipeline.gtao.setSize(Math.max(1, Math.floor(size.width * dpr * .35)), Math.max(1, Math.floor(size.height * dpr * .35)))
  }, [gl, pipeline, size.height, size.width])
  useEffect(() => () => pipeline.composer.dispose(), [pipeline])
  useFrame((_, delta) => pipeline.composer.render(delta), 1)
  return null
}

function applyOreAppearance(object: THREE.Object3D, id: string, readyAt: number, forcedKind?: keyof typeof ORE_COLORS) {
  if (!id.startsWith('MineOre') && !id.startsWith('RushOre')) return
  const kind = forcedKind ?? oreKindAtDepth(id, object.position.z)
  if (object.userData.oreBatched) {
    object.userData.oreKind = kind
    return
  }
  if (object.userData.oreKind === kind && object.userData.oreAppearanceVersion === 4) return
  object.userData.oreKind = kind
  object.userData.oreAppearanceVersion = 4
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
        else if (oreMeshName.startsWith('Ore Boulder')) material.color.set(id.startsWith('RushOre') ? '#625e57' : '#69645d').lerp(new THREE.Color(ORE_COLORS[kind]), id.startsWith('RushOre') ? .34 : .30)
        else if (oreMeshName.startsWith('Embedded Ore')) material.color.set(id.startsWith('RushOre') ? '#56524c' : '#5d5953').lerp(new THREE.Color(ORE_COLORS[kind]), id.startsWith('RushOre') ? .08 : .07)
      }
      if ('emissive' in material && material.emissive instanceof THREE.Color) {
        if (oreMeshName.startsWith('Ore Vein') || oreMeshName.startsWith('Ore Fleck') || oreMeshName.startsWith('Ore Shard')) {
          material.emissive.set(ORE_COLORS[kind])
          material.emissiveIntensity = id.startsWith('RushOre') ? 0.38 : 0.32
        } else if (oreMeshName.startsWith('Ore Boulder')) {
          material.emissive.set(ORE_COLORS[kind])
          material.emissiveIntensity = id.startsWith('RushOre') ? 0.05 : 0.04
        } else if (oreMeshName.startsWith('Embedded Ore')) {
          material.emissive.set(ORE_COLORS[kind])
          material.emissiveIntensity = id.startsWith('RushOre') ? 0.01 : 0.008
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
  object.userData.fruitAvailable = available
  object.userData.fruitCapacity = capacity
  if (object.userData.fruitBatched) return
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

type FruitBatch = {
  levels: THREE.InstancedMesh[]
  entries: Array<{ resource: THREE.Object3D; matrix: THREE.Matrix4; capacity: number }>
}

type OreVisualRole = 'bed' | 'boulder' | 'vein'
type OreKind = keyof typeof ORE_COLORS
type OreBatchEntry = { resource: THREE.Object3D; mesh: THREE.Mesh; instanceId: number; role: OreVisualRole; rush: boolean }
type OreBatch = { mesh: THREE.BatchedMesh; entries: OreBatchEntry[] }

function oreVisualRole(name: string): OreVisualRole | null {
  const readable = name.replaceAll('_', ' ')
  if (readable.startsWith('Embedded Ore')) return 'bed'
  if (readable.startsWith('Ore Boulder')) return 'boulder'
  if (readable.startsWith('Ore Vein') || readable.startsWith('Ore Fleck') || readable.startsWith('Ore Shard')) return 'vein'
  return null
}

function oreVisualColor(role: OreVisualRole, kind: OreKind, rush: boolean) {
  const color = new THREE.Color(ORE_COLORS[kind])
  if (role === 'boulder') return new THREE.Color(rush ? '#625e57' : '#69645d').lerp(color, rush ? .34 : .30)
  if (role === 'bed') return new THREE.Color(rush ? '#56524c' : '#5d5953').lerp(color, rush ? .08 : .07)
  return color
}

function oreBatchMaterial(source: THREE.MeshStandardMaterial, role: OreVisualRole, rush: boolean) {
  const material = source.clone()
  material.name = `Batched ${rush ? 'Rush ' : ''}Ore ${role}`
  material.color.set(0xffffff)
  material.roughness = role === 'vein' ? .52 : .58
  const glow = role === 'vein' ? (rush ? .38 : .32) : role === 'boulder' ? (rush ? .05 : .04) : (rush ? .01 : .008)
  material.emissive.set(0xffffff)
  material.emissiveIntensity = 1
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\ntotalEmissiveRadiance = diffuseColor.rgb * ${glow.toFixed(3)};`,
    )
  }
  material.customProgramCacheKey = () => `ore-batch-${role}-${rush ? 'rush' : 'main'}-v1`
  return material
}

function buildOreBatches(scene: THREE.Object3D, resources: THREE.Object3D[]) {
  scene.updateMatrixWorld(true)
  const batches: OreBatch[] = []
  for (const role of ['bed', 'boulder', 'vein'] as const) {
    const candidates: Array<{ resource: THREE.Object3D; mesh: THREE.Mesh; rush: boolean }> = []
    for (const resource of resources) {
      const id = resource.name.slice(9)
      if (!id.startsWith('MineOre') && !id.startsWith('RushOre')) continue
      resource.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || child instanceof THREE.InstancedMesh || Array.isArray(child.material)) return
        if (oreVisualRole(child.name) !== role || !(child.material instanceof THREE.MeshStandardMaterial)) return
        candidates.push({ resource, mesh: child, rush: id.startsWith('RushOre') })
      })
    }
    if (!candidates.length) continue
    const layout = geometryLayoutKey(candidates[0].mesh.geometry)
    const compatible = candidates.filter(({ mesh }) => geometryLayoutKey(mesh.geometry) === layout)
    const uniqueGeometries = new Map<string, THREE.BufferGeometry>()
    compatible.forEach(({ mesh }) => uniqueGeometries.set(mesh.geometry.uuid, mesh.geometry))
    const geometries = [...uniqueGeometries.values()]
    const vertices = geometries.reduce((sum, geometry) => sum + geometry.getAttribute('position').count, 0)
    const indices = geometries.reduce((sum, geometry) => sum + (geometry.index?.count ?? geometry.getAttribute('position').count), 0)
    const rush = compatible[0].rush
    const batchMesh = new THREE.BatchedMesh(compatible.length, vertices, indices, oreBatchMaterial(compatible[0].mesh.material as THREE.MeshStandardMaterial, role, rush))
    batchMesh.name = `Batched ${rush ? 'Rush ' : ''}Ore ${role}`
    batchMesh.castShadow = true
    batchMesh.receiveShadow = true
    batchMesh.sortObjects = false
    const geometryIds = new Map<string, number>()
    geometries.forEach((geometry) => geometryIds.set(geometry.uuid, batchMesh.addGeometry(geometry)))
    const entries = compatible.map(({ resource, mesh, rush: entryRush }) => {
      const instanceId = batchMesh.addInstance(geometryIds.get(mesh.geometry.uuid)!)
      batchMesh.setMatrixAt(instanceId, mesh.matrixWorld)
      batchMesh.setVisibleAt(instanceId, false)
      mesh.visible = false
      resource.userData.oreBatched = true
      return { resource, mesh, instanceId, role, rush: entryRush }
    })
    batchMesh.computeBoundingBox()
    batchMesh.computeBoundingSphere()
    scene.add(batchMesh)
    batches.push({ mesh: batchMesh, entries })
  }
  return batches
}

function geometryLayoutKey(geometry: THREE.BufferGeometry) {
  return `${geometry.index ? geometry.index.array.constructor.name : 'none'}|${Object.entries(geometry.attributes).map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}:${attribute.array.constructor.name}`).sort().join('|')}`
}

function syncOreBatches(batches: OreBatch[], resources?: Iterable<THREE.Object3D>) {
  const filter = resources ? new Set(resources) : null
  for (const batch of batches) for (const entry of batch.entries) {
    if (filter && !filter.has(entry.resource)) continue
    const visible = entry.resource.visible
    batch.mesh.setVisibleAt(entry.instanceId, visible)
    if (!visible) continue
    const kind = entry.resource.userData.oreKind as OreKind | undefined
    if (kind) batch.mesh.setColorAt(entry.instanceId, oreVisualColor(entry.role, kind, entry.rush))
    entry.mesh.updateWorldMatrix(true, false)
    batch.mesh.setMatrixAt(entry.instanceId, entry.mesh.matrixWorld)
  }
}

function buildFruitBatches(scene: THREE.Object3D, resources: THREE.Object3D[]) {
  scene.updateMatrixWorld(true)
  const batches: FruitBatch[] = []
  for (const kind of ['Apple', 'Orange'] as const) {
    const entries: FruitBatch['entries'] = []
    let source: THREE.Mesh | null = null
    for (const resource of resources) {
      const id = resource.name.slice(9)
      if (!id.includes(kind)) continue
      const fruitMeshes: THREE.Mesh[] = []
      resource.traverse((child) => {
        if (child instanceof THREE.Mesh && child.name.replaceAll('_', ' ').includes(`Woodland ${kind === 'Apple' ? 'Apples' : 'Oranges'}`)) fruitMeshes.push(child)
      })
      const fruitMesh = fruitMeshes[0]
      if (!fruitMesh) continue
      source ??= fruitMesh
      fruitMesh.visible = false
      resource.userData.fruitBatched = true
      const capacity = fruitTreeCapacity(id.replace('ForageRush', 'Forage'))
      resource.userData.fruitAvailable = capacity
      resource.userData.fruitCapacity = capacity
      entries.push({ resource, matrix: fruitMesh.matrixWorld.clone(), capacity })
    }
    const sourceMesh = source as THREE.Mesh | null
    if (!sourceMesh || !entries.length) continue
    const fullDrawCount = sourceMesh.geometry.index?.count ?? sourceMesh.geometry.getAttribute('position').count
    const levels = Array.from({ length: 5 }, (_, index) => {
      const geometry = sourceMesh.geometry.clone()
      geometry.setDrawRange(0, Math.floor((fullDrawCount * (index + 1) / 5) / 3) * 3)
      const instance = new THREE.InstancedMesh(geometry, sourceMesh.material, entries.length)
      instance.name = `Batched Woodland ${kind} ${index + 1}`
      instance.count = 0
      instance.castShadow = true
      instance.receiveShadow = false
      instance.frustumCulled = false
      scene.add(instance)
      return instance
    })
    batches.push({ levels, entries })
  }
  return batches
}

function syncFruitBatches(batches: FruitBatch[]) {
  for (const batch of batches) {
    batch.levels.forEach((level) => { level.count = 0 })
    for (const entry of batch.entries) {
      if (!entry.resource.visible) continue
      const available = Math.max(0, Math.min(entry.capacity, Number(entry.resource.userData.fruitAvailable) || 0))
      if (!available) continue
      const levelIndex = Math.max(0, Math.min(4, Math.ceil(available / entry.capacity * 5) - 1))
      const level = batch.levels[levelIndex]
      level.setMatrixAt(level.count, entry.matrix)
      level.count += 1
    }
    batch.levels.forEach((level) => {
      level.instanceMatrix.needsUpdate = true
    })
  }
}

function EnvironmentScene({ reduced = false }: { reduced?: boolean }) {
  const zone = useGameStore((state) => state.zone)
  const teleportNonce = useGameStore((state) => state.teleportNonce)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const minigameMilestone = useGameStore((state) => state.minigameMilestone)
  const lobbyPlayerCount = useGameStore((state) => state.lobbyPlayerCount)
  const sessionSeed = useGameStore((state) => state.sessionSeed)
  const roundNumber = useGameStore((state) => state.roundNumber)
  const matchStartedAt = useGameStore((state) => state.matchStartedAt)
  const forageRushRareSnapshot = useGameStore((state) => state.forageRushRareSnapshot)
  const eventBay = useGameStore((state) => state.eventBay)
  const rushNodes = useGameStore((state) => state.rushNodes)
  const forageRushCollected = useGameStore((state) => state.forageRushCollected)
  const minedNodes = useGameStore((state) => state.minedNodes)
  const mineGenerations = useGameStore((state) => state.mineGenerations)
  const collectedForage = useGameStore((state) => state.collectedForage)
  const sharedForageOnline = useGameStore((state) => state.sharedForageOnline)
  const sharedForageAvailability = useGameStore((state) => state.sharedForageAvailability)
  const setAnchors = useGameStore((state) => state.setAnchors)
  const setColliders = useGameStore((state) => state.setColliders)
  const setSceneReady = useGameStore((state) => state.setSceneReady)
  const furnaceCount = useGameStore((state) => state.inventory.furnace ?? 0)
  const claimedFarms = useGameStore((state) => state.claimedFarms)
  const sharedFarmOnline = useGameStore((state) => state.sharedFarmOnline)
  const tutorialActive = useGameStore((state) => state.tutorialActive)
  const sharedFarmSelfId = useGameStore((state) => state.sharedFarmSelfId)
  const farmOwners = useGameStore((state) => state.farmOwners)
  const localFarmCells = useGameStore((state) => state.farmCells)
  const sharedFarmCells = useGameStore((state) => state.sharedFarmCells)
  const useSharedFarm = sharedFarmOnline && !tutorialActive
  const farmCells = farmCellVisualGate ? localFarmCells : useSharedFarm ? sharedFarmCells : localFarmCells
  const farmRushCells = useGameStore((state) => state.farmRushCells)
  const weather = useGameStore((state) => state.weather)
  const graphicsMode = useGameStore((state) => state.graphicsMode)
  const gl = useThree((state) => state.gl)
  const ownedFarms = useMemo(() => useSharedFarm ? Object.keys(farmOwners).map(Number).filter((farm) => farmOwners[farm] === sharedFarmSelfId) : claimedFarms, [claimedFarms, farmOwners, sharedFarmSelfId, useSharedFarm])
  const cookQueue = useGameStore((state) => state.cookQueue)
  const farmRushCooking = useGameStore((state) => state.farmRushCooking)
  const furnaceReadyUntil = useGameStore((state) => state.furnaceReadyUntil)
  const [woodlandNormal, caveNormal] = useTexture(['/assets/textures/woodland-ground-normal-v1.webp', '/assets/textures/storybook-cave-stone-normal-v1.webp'])
  const source = useGLTF(minigameOpen ? MINIGAME_SCENES[minigameKind] : SCENES[zone]).scene
  const scene = useMemo(() => {
    const object = skeletonClone(source)
    const copies = new Map<THREE.Material, THREE.Material>()
    const copy = (material: THREE.Material) => {
      let cloned = copies.get(material)
      if (!cloned) { cloned = material.clone(); copies.set(material, cloned) }
      return cloned
    }
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.material = Array.isArray(child.material) ? child.material.map(copy) : copy(child.material)
    })
    return object
  }, [source])
  const sceneMeshes = useMemo(() => {
    const meshes: THREE.Mesh[] = []
    scene.traverse((child) => { if (child instanceof THREE.Mesh) meshes.push(child) })
    return meshes
  }, [scene])
  useEffect(() => () => {
    const materials = new Set<THREE.Material>()
    sceneMeshes.forEach((child) => {
      ;(Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => materials.add(material))
    })
    materials.forEach((material) => material.dispose())
  }, [sceneMeshes])
  useEffect(() => {
    ;[woodlandNormal, caveNormal].forEach((texture) => {
      texture.colorSpace = THREE.NoColorSpace
      texture.flipY = false
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping
      texture.anisotropy = graphicsMode === 'high' ? Math.min(8, gl.capabilities.getMaxAnisotropy()) : Math.min(4, gl.capabilities.getMaxAnisotropy())
      texture.needsUpdate = true
    })
    const detail = reduced || graphicsMode === 'low' ? 0 : graphicsMode === 'high' ? 1 : .62
    sceneMeshes.forEach((child) => {
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return
        const caveSurface = ['Mine Ground', 'Mine Wall', 'Mine Strata', 'Cavern Roof Stone', 'Cavern Perimeter Stone'].includes(material.name)
        const soilSurface = ['Soil', 'Watered Soil', 'Tilled Soil Furrow'].includes(material.name)
        const woodlandSurface = material.name === 'Ground' || material.name === 'Path'
        material.envMapIntensity = graphicsMode === 'high' ? (caveSurface ? .42 : soilSurface ? .28 : .58) : graphicsMode === 'low' ? .12 : .28
        if (caveSurface || soilSurface || woodlandSurface) {
          material.normalMap = detail ? (caveSurface || soilSurface ? caveNormal : woodlandNormal) : null
          material.normalScale.setScalar(detail * (caveSurface ? .33 : soilSurface ? .12 : material.name === 'Path' ? .11 : .22))
          material.roughness = caveSurface ? .92 : soilSurface ? .97 : material.name === 'Path' ? .94 : .88
        }
        material.needsUpdate = true
      })
    })
  }, [caveNormal, gl, graphicsMode, reduced, sceneMeshes, woodlandNormal])
  useEffect(() => {
    setSceneReady(true)
    return () => setSceneReady(false)
  }, [scene, setSceneReady])
  scene.userData.environment = true
  const animatedStock = useMemo(() => scene.getObjectByName('Animated_StockRing'), [scene])
  const stockBaseY = useMemo(() => animatedStock?.position.y ?? 0, [animatedStock])
  const resourceObjects = useMemo(() => {
    const resources: THREE.Object3D[] = []
    scene.traverse((object) => { if (object.name.startsWith('Resource_')) resources.push(object) })
    return resources
  }, [scene])
  const resourcesById = useMemo(() => new Map(resourceObjects.map((object) => [object.name.slice(9), object])), [resourceObjects])
  const oreBatches = useMemo(() => buildOreBatches(scene, resourceObjects), [resourceObjects, scene])
  const fruitBatches = useMemo(() => buildFruitBatches(scene, resourceObjects), [resourceObjects, scene])
  const renderMeshes = useMemo(() => [
    ...sceneMeshes,
    ...oreBatches.map(({ mesh }) => mesh),
    ...fruitBatches.flatMap(({ levels }) => levels),
  ], [fruitBatches, oreBatches, sceneMeshes])
  const sceneLayout = useMemo(() => {
    scene.updateMatrixWorld(true)
    const anchors: AnchorMap = {}
    const colliderObjects: THREE.Object3D[] = []
    scene.traverse((object) => {
      if (object.name.startsWith('Anchor_')) {
        const point = new THREE.Vector3()
        object.getWorldPosition(point)
        anchors[object.name.slice(7)] = [point.x, point.y, point.z]
      }
      if (typeof object.userData.colliderRadius === 'number') colliderObjects.push(object)
    })
    return { anchors, colliderObjects }
  }, [scene])
  useEffect(() => () => {
    fruitBatches.forEach((batch) => batch.levels.forEach((level) => {
      scene.remove(level)
      level.geometry.dispose()
    }))
  }, [fruitBatches, scene])
  useEffect(() => () => {
    oreBatches.forEach(({ mesh }) => {
      scene.remove(mesh)
      mesh.dispose()
      mesh.material.dispose()
    })
  }, [oreBatches, scene])
  const rareResourceIds = useMemo(() => resourceObjects.map((object) => object.name.slice(9)).filter((id) => id.startsWith('ForageTruffle') || id.startsWith('ForageDiscovery') || id.startsWith('ForageRushTruffle') || id.startsWith('ForageRushDiscovery')), [resourceObjects])
  const nextResourceRefresh = useRef(0)
  const resourceBatchesInitialized = useRef(false)
  const scaledOre = useRef<THREE.Object3D | null>(null)
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
  const wateredSoilTiles = useMemo(() => {
    const tiles: THREE.Object3D[] = []
    scene.traverse((object) => { if (object.name.startsWith('WateredSoil_') || object.name.startsWith('WateredRushSoil_')) tiles.push(object) })
    return tiles
  }, [scene])
  useEffect(() => {
    wateredSoilTiles.forEach((tile) => {
      const rush = /^WateredRushSoil_(\d+)_(\d+)$/.exec(tile.name)
      const main = /^WateredSoil_(\d+)_(\d+)$/.exec(tile.name)
      const cell = rush
        ? farmRushCells[`FarmRushCell${rush[1]}_${rush[2]}`]
        : main
          ? farmCells[`${Number(main[1])}:${Number(main[2])}`]
          : null
      const representativeMainCell = farmCellVisualGate && main?.[1] === '0' && main?.[2] === '27'
      const rainWateredMainCell = Boolean(main && weather === 'rain' && cell?.stage === 'planted')
      tile.visible = representativeMainCell || rainWateredMainCell || cell?.stage === 'watered' || cell?.stage === 'ready'
    })
  }, [farmCells, farmRushCells, wateredSoilTiles, weather])
  rushPlotMarkers.forEach((marker) => { marker.visible = minigameOpen && minigameKind === 'farm' && Number(marker.userData.rushPlot) === eventBay })
  const assignedPlotBeacon = useMemo(() => rushPlotMarkers.find((marker) => Number(marker.userData.rushPlot) === eventBay)?.getObjectByName('Assigned Plot Beacon'), [eventBay, rushPlotMarkers])
  const assignedPlotBeaconY = useMemo(() => assignedPlotBeacon?.position.y ?? 0, [assignedPlotBeacon])

  useFrame((state, delta) => {
    const now = Date.now()
    const live = useGameStore.getState()
    if (animatedStock) {
      animatedStock.rotation.z += delta * 0.34
      animatedStock.position.y = stockBaseY + Math.sin(state.clock.elapsedTime * 1.4) * 0.08
    }
    if (assignedPlotBeacon) {
      assignedPlotBeacon.rotation.y += delta * 0.65
      assignedPlotBeacon.position.y = assignedPlotBeaconY + Math.sin(state.clock.elapsedTime * 1.8) * 0.12
    }
    if (state.clock.elapsedTime >= nextResourceRefresh.current) {
      nextResourceRefresh.current = state.clock.elapsedTime + .2
      let fruitBatchChanged = false
      const changedOres: THREE.Object3D[] = []
      const rushForage = minigameOpen && minigameKind === 'forage'
      const activeRares = rareResourceIds.length
        ? !rushForage && sharedForageOnline
          ? new Set(rareResourceIds.filter((id) => (sharedForageAvailability[id] ?? 0) > 0))
          : visibleRareForageIds(rareResourceIds, rushForage, forageRushRareSnapshot, sessionSeed, matchStartedAt, now, lobbyPlayerCount, minigameMilestone)
        : EMPTY_RESOURCE_IDS
      for (const object of resourceObjects) {
        const id = object.name.slice(9)
        const previousVisible = object.visible
        const previousFruitAvailable = Number(object.userData.fruitAvailable) || 0
        const previousOreKind = object.userData.oreKind
        if (id.startsWith('ForageRush')) {
          const ready = (forageRushCollected[id] ?? 0) <= now
          if (id.startsWith('ForageRushApple') || id.startsWith('ForageRushOrange')) {
            object.visible = true
            applyFruitAppearance(object, id, ready ? fruitTreeCapacity(id.replace('ForageRush', 'Forage')) : 0)
          } else object.visible = ready && activeRares.has(id)
          if (object.visible !== previousVisible || (Number(object.userData.fruitAvailable) || 0) !== previousFruitAvailable) fruitBatchChanged = true
          continue
        }
        const rushNode = rushNodes[id] ?? { generation: 0, readyAt: 0 }
        const readyAt = id.startsWith('RushOre') ? rushNode.readyAt : minedNodes[id] ?? 0
        const forageAvailable = id.startsWith('Forage')
          ? !id.startsWith('ForageRush') && sharedForageOnline
            ? sharedForageAvailability[id] ?? 0
            : forageSiteAvailability(id, collectedForage[id] ?? 0, now)
          : 0
        const rareActive = !id.startsWith('ForageTruffle') && !id.startsWith('ForageDiscovery') || activeRares.has(id)
        object.visible = id.startsWith('Forage') ? forageAvailable > 0 && rareActive : readyAt <= now
        if (object.visible) {
          if (id.startsWith('Forage')) applyFruitAppearance(object, id, forageAvailable)
          const oreKind = id.startsWith('RushOre')
            ? miningRushOre(minigameMilestone, id, rushNode.generation)
            : id.startsWith('MineOre')
              ? oreKindAtDepth(id, object.position.z, mineGenerations[id] ?? 0, sessionSeed)
              : undefined
          applyOreAppearance(object, id, readyAt, oreKind)
        }
        if (id.startsWith('Forage') && (object.visible !== previousVisible || (Number(object.userData.fruitAvailable) || 0) !== previousFruitAvailable)) fruitBatchChanged = true
        if ((id.startsWith('MineOre') || id.startsWith('RushOre')) && (object.visible !== previousVisible || object.userData.oreKind !== previousOreKind)) changedOres.push(object)
      }
      if (!resourceBatchesInitialized.current || fruitBatchChanged) syncFruitBatches(fruitBatches)
      if (!resourceBatchesInitialized.current) syncOreBatches(oreBatches)
      else if (changedOres.length) syncOreBatches(oreBatches, changedOres)
      resourceBatchesInitialized.current = true
    }
    const promptId = live.prompt?.id
    const focusedOre = promptId?.startsWith('MineOre') || promptId?.startsWith('RushOre') ? resourcesById.get(promptId) ?? null : null
    if (scaledOre.current && scaledOre.current !== focusedOre && scaledOre.current.userData.restScale) {
      scaledOre.current.scale.copy(scaledOre.current.userData.restScale)
      syncOreBatches(oreBatches, [scaledOre.current])
    }
    scaledOre.current = focusedOre
    if (focusedOre?.visible) {
      if (!focusedOre.userData.restScale) focusedOre.userData.restScale = focusedOre.scale.clone()
      focusedOre.scale.copy(focusedOre.userData.restScale).multiplyScalar(1 - live.interactionProgress * .24)
      syncOreBatches(oreBatches, [focusedOre])
    }
    const activeFurnaces = (furnaceVisualGate || resourceVisualGate) && zone === 'farm' ? [0] : furnaceCount > 0 ? ownedFarms.slice(0, 1) : []
    furnaceBodies.forEach((body) => {
      const furnaceIndex = Number(body.userData.furnaceIndex)
      const eventCooker = Number(body.userData.rushCooker) === eventBay && minigameOpen && minigameKind === 'farm'
      const active = eventCooker || activeFurnaces.includes(furnaceIndex)
      const cooking = eventCooker ? farmRushCooking.some((job) => job.readyAt > Date.now()) : cookQueue.some((job) => job.furnaceIndex === furnaceIndex && job.readyAt > Date.now()) || ((furnaceVisualGate || resourceVisualGate) && zone === 'farm' && furnaceIndex === 0)
      const ready = eventCooker ? farmRushCooking.some((job) => job.readyAt <= Date.now()) : cookQueue.some((job) => job.furnaceIndex === furnaceIndex && job.readyAt <= Date.now()) || (furnaceReadyUntil[furnaceIndex] ?? 0) > Date.now()
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
    setAnchors(sceneLayout.anchors)
  }, [sceneLayout, setAnchors, teleportNonce])

  useEffect(() => {
    const colliders: WorldCollider[] = []
    const activeFurnaces = (furnaceVisualGate || resourceVisualGate) && zone === 'farm' ? [0] : furnaceCount > 0 ? ownedFarms.slice(0, 1) : []
    furnaceBodies.forEach((body) => { body.visible = (minigameOpen && minigameKind === 'farm' && Number(body.userData.rushCooker) === eventBay) || activeFurnaces.includes(Number(body.userData.furnaceIndex)) })
    scene.updateMatrixWorld(true)
    sceneLayout.colliderObjects.forEach((object) => {
      if (isHierarchyVisible(object, scene)) {
        const point = new THREE.Vector3()
        const scale = new THREE.Vector3()
        object.getWorldPosition(point)
        object.getWorldScale(scale)
        colliders.push({ x: point.x, z: point.z, radius: object.userData.colliderRadius * Math.max(scale.x, scale.z) })
      }
    })
    setColliders(colliders)
  }, [eventBay, furnaceBodies, furnaceCount, minigameKind, minigameOpen, ownedFarms, scene, sceneLayout, setColliders, teleportNonce, zone])

  useEffect(() => {
    renderMeshes.forEach((object) => {
      // The cavern is already authored with baked form and receives dynamic
      // character shadows. Excluding its million-plus static triangles from
      // the shadow pass keeps High smooth without making actors float.
      const materialNames = (Array.isArray(object.material) ? object.material : [object.material]).map((material) => material.name)
      const insignificantCaster = materialNames.some((name) => name === 'Grass' || name === 'Flowers' || name === 'Ground' || name === 'Path' || name === 'Soil' || name === 'Watered Soil' || name === 'Tilled Soil Furrow')
      object.castShadow = !reduced && !insignificantCaster && zone !== 'mine' && !(minigameOpen && minigameKind === 'mining')
      object.receiveShadow = true
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        if (material.transparent) material.depthWrite = false
        const textured = material as THREE.Material & { map?: THREE.Texture | null }
        if (textured.map) {
          textured.map.anisotropy = graphicsMode === 'high' ? Math.min(8, gl.capabilities.getMaxAnisotropy()) : graphicsMode === 'low' ? 1 : Math.min(4, gl.capabilities.getMaxAnisotropy())
          textured.map.needsUpdate = true
        }
      })
    })
  }, [gl, graphicsMode, minigameKind, minigameOpen, reduced, renderMeshes, zone])

  return <primitive object={scene} />
}

type NormalizedModelProps = {
  src: string
  height: number
  position?: [number, number, number]
  rotation?: [number, number, number]
}

function heldItemForState(state: ReturnType<typeof useGameStore.getState>): ItemId | null {
  if (state.minigameOpen && state.minigameKind === 'mining') return 'crystal-pickaxe'
  if (state.minigameOpen && state.minigameKind === 'farm') return state.farmRushTool === 'water' ? 'water-can' : `${state.farmRushTool}-seeds` as ItemId
  if (state.minigameOpen && state.minigameKind === 'forage') {
    const firstGathered = (['apple', 'orange', 'truffle', 'natural-discovery'] as ItemId[]).find((item) => {
      const key = item === 'natural-discovery' ? 'discovery' : item
      return (state.forageRushInventory[key as keyof typeof state.forageRushInventory] ?? 0) > 0
    })
    return firstGathered ?? null
  }
  const selected = state.hotbar[state.selectedHotbar]
  return selected && (state.inventory[selected] ?? 0) > 0 ? selected : null
}

function HeldPickaxeAttachment({ character, item }: { character: THREE.Object3D; item: HeldPickaxeId | null }) {
  const source = useGLTF('/assets/3d/tools/pickaxe.glb?v=5').scene
  const equipped = useRef<THREE.Object3D | null>(null)
  // The handle runs through the closed fist and leans forward from the torso.
  // Keep this socket fixed: the animated hand supplies the entire swing, so
  // the pickaxe cannot lag behind or appear to move independently.
  const gripRotation = useMemo(() => {
    // The model's grip is below its head on local Y. Keep that authored axis
    // intact, then lean the handle forward across the palm; reversing it put
    // the head against the torso and made the handle appear to be held upside down.
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(-.5, .4, pickaxeTiltVisualTest ?? -1.16, 'YXZ'))
  }, [])
  const gripOffset = useMemo(() => new THREE.Vector3(-.008, -.34, 0), [])
  const toolScale = .58
  useEffect(() => {
    if (!item) return
    const hand = character.getObjectByName('hand_r')
    if (!hand) return
    const model = source.clone(true)
    const tool = new THREE.Group()
    const handScale = new THREE.Vector3()
    hand.getWorldScale(handScale)
    const headColors: Record<HeldPickaxeId, string> = {
      'worn-pickaxe': '#7c5750',
      'iron-pickaxe': '#738792',
      'steel-pickaxe': '#b8c4c7',
      'crystal-pickaxe': '#68b9c4',
    }
    tool.name = 'Equipped Pickaxe Socket'
    // Keep the tool outside the FBX hand-bone hierarchy. The imported skeleton
    // carries a 100x conversion scale; parenting there distorted both grip and
    // orientation. We follow the animated palm in character space instead.
    model.name = 'Equipped Pickaxe'
    model.scale.set(toolScale / Math.max(.001, handScale.x), toolScale / Math.max(.001, handScale.y), toolScale / Math.max(.001, handScale.z))
    model.position.set(-gripOffset.x * model.scale.x, -gripOffset.y * model.scale.y, -gripOffset.z * model.scale.z)
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.material = Array.isArray(child.material) ? child.material.map((material) => material.clone()) : child.material.clone()
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return
        if (material.name === 'Pickaxe Head') {
          material.color.set(headColors[item])
          material.metalness = item === 'worn-pickaxe' ? .28 : item === 'crystal-pickaxe' ? .18 : .48
          material.roughness = item === 'worn-pickaxe' ? .72 : item === 'crystal-pickaxe' ? .42 : .5
          material.emissive.set(headColors[item])
          material.emissiveIntensity = item === 'crystal-pickaxe' ? .2 : .055
        } else if (material.name === 'Pickaxe Grip') {
          material.color.set('#35251b')
          material.metalness = 0
          material.roughness = .94
        } else {
          material.color.set('#704a2b')
          material.metalness = 0
          material.roughness = .82
        }
      })
      child.castShadow = true
      child.receiveShadow = true
    })
    tool.add(model)
    tool.quaternion.copy(gripRotation)
    hand.add(tool)
    equipped.current = tool
    return () => {
      if (equipped.current === tool) equipped.current = null
      hand.remove(tool)
      model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        ;(Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => material.dispose())
      })
    }
  }, [character, gripOffset, gripRotation, item, source, toolScale])
  return null
}

function HeldSpriteAttachment({ character, item }: { character: THREE.Object3D; item: Exclude<ItemId, HeldPickaxeId> | null }) {
  const equipped = useRef<THREE.Group | null>(null)
  const displayRotation = useMemo(() => {
    // Flat inventory art is held like a card/tool in the palm: angled upward
    // and forward, rather than hanging face-down along the forearm.
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(-.62, .46, .72, 'YXZ'))
  }, [])
  useFrame(() => {
    equipped.current?.quaternion.copy(displayRotation)
  })
  useEffect(() => {
    if (!item) return
    const hand = character.getObjectByName('hand_r')
    if (!hand) return
    const handScale = new THREE.Vector3()
    hand.getWorldScale(handScale)
    const geometry = new THREE.PlaneGeometry(.34, .34)
    const texture = new THREE.TextureLoader().load(ITEMS[item].icon)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .08, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    const display = new THREE.Mesh(geometry, material)
    display.scale.set(1 / Math.max(.001, handScale.x), 1 / Math.max(.001, handScale.y), 1 / Math.max(.001, handScale.z))
    display.position.set(.02 * display.scale.x, .19 * display.scale.y, -.04 * display.scale.z)
    const socket = new THREE.Group()
    socket.name = `Equipped ${ITEMS[item].name}`
    socket.quaternion.copy(displayRotation)
    socket.renderOrder = 2
    socket.add(display)
    hand.add(socket)
    equipped.current = socket
    return () => {
      if (equipped.current === socket) equipped.current = null
      hand.remove(socket)
      geometry.dispose()
      material.dispose()
      texture.dispose()
    }
  }, [character, displayRotation, item])
  return null
}

function HeldItemAttachment({ character, item }: { character: THREE.Object3D; item: ItemId | null }) {
  const pickaxe = item && HELD_PICKAXES.has(item) ? item as HeldPickaxeId : null
  const sprite = item && !HELD_PICKAXES.has(item) ? item as Exclude<ItemId, HeldPickaxeId> : null
  return <><HeldPickaxeAttachment character={character} item={pickaxe} /><HeldSpriteAttachment character={character} item={sprite} /></>
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

function AnimatedCharacter({ src, height, position, rotation, animation, castShadow = true, heldItem = null }: NormalizedModelProps & { animation: string; castShadow?: boolean; heldItem?: ItemId | null }) {
  const group = useRef<THREE.Group>(null)
  const source = useGLTF(src).scene
  const animationSource = useGLTF('/assets/3d/animations/standard.glb')
  const toolAnimationSource = useGLTF('/assets/3d/animations/tool-actions.glb?v=3')
  const animationClips = useMemo(() => characterAnimationClips(animationSource.animations, toolAnimationSource.animations), [animationSource.animations, toolAnimationSource.animations])
  const { actions } = useAnimations(animationClips, group)
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
        child.castShadow = castShadow
        child.receiveShadow = true
      }
    })
    return object
  }, [castShadow, height, source])
  useEffect(() => {
    const action = actions[animation]
    action?.reset().fadeIn(0.2).play()
    return () => { action?.fadeOut(0.15) }
  }, [actions, animation])
  return <group ref={group} position={position} rotation={rotation}><primitive object={normalized} /><HeldItemAttachment character={normalized} item={heldItem} /></group>
}

type PeerPresence = { id: string; nickname: string; zone: ZoneId; position: [number, number, number]; yaw?: number; animation?: string; heldItem?: ItemId | null; cash: number; progressValue?: number; stats: { foraged: number; mined: number; harvested: number; sold: number }; seenAt: number; tutorialActive?: boolean; minigameOpen?: boolean; minigameKind?: MinigameKind; minigameMilestone?: number; minigameScore?: number; eventBay?: number }

const PEER_IDLE = 'Armature|Idle_Loop'
const PEER_ANIMATIONS = new Set([
  PEER_IDLE,
  'Armature|Walk_Loop',
  'Armature|Sprint_Loop',
  'Armature|Jump_Loop',
  'Armature|Interact',
  'Armature|PickUp_Table',
  'Armature|Sword_Attack',
  'TreeChopping_Loop',
])

type PeerSnapshot = {
  position: THREE.Vector3
  yaw: number
  animation: string
  receivedAt: number
}

function shortestAngle(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

function RemotePlayer({ peer }: { peer: PeerPresence }) {
  const graphicsMode = useGameStore((state) => state.graphicsMode)
  const root = useRef<THREE.Group>(null)
  const rendered = useRef(new THREE.Vector3(peer.position[0], peer.position[1], peer.position[2]))
  const renderedYaw = useRef(Number.isFinite(peer.yaw) ? Number(peer.yaw) : 0)
  const snapshots = useRef<PeerSnapshot[]>([{
    position: rendered.current.clone(),
    yaw: renderedYaw.current,
    animation: PEER_ANIMATIONS.has(peer.animation ?? '') ? peer.animation! : PEER_IDLE,
    receivedAt: performance.now(),
  }])
  const animationRef = useRef(snapshots.current[0].animation)
  const [animation, setAnimation] = useState(animationRef.current)
  const scratch = useRef(new THREE.Vector3())

  useEffect(() => {
    const now = performance.now()
    const next = new THREE.Vector3(peer.position[0], peer.position[1], peer.position[2])
    const last = snapshots.current.at(-1)
    const nextYaw = Number.isFinite(peer.yaw) ? Number(peer.yaw) : last?.yaw ?? renderedYaw.current
    const nextAnimation = PEER_ANIMATIONS.has(peer.animation ?? '') ? peer.animation! : PEER_IDLE
    if (last && last.position.distanceToSquared(next) > 144) {
      rendered.current.copy(next)
      renderedYaw.current = nextYaw
      root.current?.position.copy(next)
      if (root.current) root.current.rotation.y = nextYaw
      snapshots.current = [{ position: next, yaw: nextYaw, animation: nextAnimation, receivedAt: now }]
      return
    }
    snapshots.current = [...snapshots.current, { position: next, yaw: nextYaw, animation: nextAnimation, receivedAt: now }].slice(-5)
  }, [peer.animation, peer.position, peer.yaw])

  useFrame(() => {
    const renderAt = performance.now() - 120
    const buffer = snapshots.current
    let from = buffer[0]
    let to = buffer[0]
    for (let index = 1; index < buffer.length; index += 1) {
      to = buffer[index]
      if (to.receivedAt >= renderAt) break
      from = to
    }
    const span = Math.max(1, to.receivedAt - from.receivedAt)
    const alpha = from === to ? 1 : THREE.MathUtils.clamp((renderAt - from.receivedAt) / span, 0, 1)
    rendered.current.copy(from.position).lerp(to.position, alpha)
    renderedYaw.current = from.yaw + shortestAngle(from.yaw, to.yaw) * alpha
    const latest = buffer.at(-1)
    const nextAnimation = latest && performance.now() - latest.receivedAt > 450 ? PEER_IDLE : alpha < .5 ? from.animation : to.animation
    if (nextAnimation !== animationRef.current) {
      animationRef.current = nextAnimation
      setAnimation(nextAnimation)
    }
    if (root.current) {
      root.current.position.copy(rendered.current)
      root.current.rotation.y = renderedYaw.current
    }
  })

  return <group ref={root}>
    <AnimatedCharacter src="/assets/3d/characters/ranger.glb" height={1.75} position={[0, -.86, 0]} rotation={[0, Math.PI, 0]} animation={animation} castShadow={graphicsMode !== 'low'} heldItem={peer.heldItem && peer.heldItem in ITEMS ? peer.heldItem : null} />
    <Html position={[0, 1.18, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
      <span className="world-label" data-no-localize>{peer.nickname || 'PLAYER'}</span>
    </Html>
  </group>
}

function liveMinigameScore(state: ReturnType<typeof useGameStore.getState>) {
  if (!state.minigameOpen) return 0
  return state.minigameKind === 'mining' ? state.rushScore : state.minigameKind === 'farm' ? state.farmRushScore : state.forageRushScore
}

function MultiplayerPresence() {
  const zone = useGameStore((state) => state.zone)
  const tutorialActive = useGameStore((state) => state.tutorialActive)
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
      setLobbyState(false, false, false, 60 * 60, 2, 1, 7, 1, true, true)
      const channel = new BroadcastChannel('project01-presence-v1')
      channel.onmessage = (event: MessageEvent<PeerPresence & { leave?: boolean }>) => event.data.leave ? removePeer(event.data.id) : mergePeer(event.data)
      const publish = () => {
        const state = useGameStore.getState()
        channel.postMessage({ id: peerId.current, nickname: state.nickname, zone: state.zone, position: state.playerPosition, yaw: state.playerYaw, animation: state.playerAnimation, heldItem: heldItemForState(state), cash: state.cash, progressValue: economyProgressValue(state), stats: state.stats, tutorialActive: state.tutorialActive, minigameOpen: state.minigameOpen, minigameKind: state.minigameKind, minigameMilestone: state.minigameMilestone, minigameScore: liveMinigameScore(state), eventBay: state.eventBay, seenAt: Date.now() })
      }
      publish()
      const timer = window.setInterval(publish, 100)
      return () => { window.clearInterval(timer); channel.postMessage({ id: peerId.current, leave: true }); channel.close() }
    }
    const connect = async () => {
      try {
        const configured = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_MULTIPLAYER_URL
        const endpoint = configured || ((import.meta as ImportMeta & { env?: Record<string, string | boolean> }).env?.DEV
          ? `${window.location.protocol}//${window.location.hostname}:2567`
          : window.location.origin)
        const room = await new ColyseusClient(endpoint).joinOrCreate('woodland', { bypassLobby: bypassLobbyClient, profileId: stableProfileId() })
        if (disposed) { void room.leave(); return }
        peerId.current = room.sessionId
        room.onMessage('presence:snapshot', (snapshot: PeerPresence[]) => setPeers(Object.fromEntries(snapshot.filter((peer) => peer.id !== room.sessionId).map((peer) => [peer.id, peer]))))
        room.onMessage('lobby:state', (message: { isHost?: boolean; started?: boolean; durationSeconds?: number; globalExpansionDeeds?: number; playerCount?: number; maxGlobalExpansionDeeds?: number; readyCount?: number; allReady?: boolean; selfReady?: boolean; readyPlayerIds?: string[] }) => setLobbyState(true, Boolean(message.isHost), Boolean(message.started), Number(message.durationSeconds), Number(message.globalExpansionDeeds), Number(message.playerCount), Number(message.maxGlobalExpansionDeeds), Number(message.readyCount), Boolean(message.allReady), Boolean(message.selfReady), message.readyPlayerIds))
        room.onMessage('lobby:reset', () => {
          const nickname = useGameStore.getState().nickname
          localStorage.removeItem('project01-save-v12')
          localStorage.removeItem('project01-save-v11')
          localStorage.setItem('project01-save-v12', JSON.stringify({ nickname }))
          window.location.assign('/')
        })
        room.onMessage('match:sync', (message: { seed?: number; startedAt?: number; durationSeconds?: number }) => syncMatch(Number(message.seed), Number(message.startedAt), Number(message.durationSeconds)))
        room.onMessage('minigame:bay', (message: { bay?: number }) => { if (Number.isFinite(message.bay)) setEventBay(Number(message.bay)) })
        room.onMessage('presence:move', (message: PeerPresence) => mergePeer(message))
        room.onMessage('presence:leave', (id: string) => removePeer(id))
        for (const type of ['chat:snapshot', 'chat:message', 'trade:request', 'trade:opened', 'trade:update', 'trade:cancel', 'trade:commit', 'minigame:ready-state', 'minigame:start', 'minigame:ending', 'minigame:result', 'minigame:forage', 'minigame:forage-award', 'mine:snapshot', 'mine:node', 'mine:award', 'mine:denied', 'forage:snapshot', 'forage:node', 'forage:award', 'forage:denied', 'farm:snapshot', 'farm:update', 'farm:result', 'cook:result', 'deed:snapshot', 'deed:stock', 'deed:result', 'merchant:snapshot', 'merchant:result', 'market:snapshot', 'market:result']) room.onMessage(type, (payload: unknown) => emitMultiplayer(type, payload))
        setMultiplayerSender((type, payload) => room.send(type, payload))
        room.send('lobby:ready', {})
        room.send('lobby:onboarding-ready', { ready: useGameStore.getState().guideComplete })
        room.send('minigame:result:request', {})
        const publish = () => {
          const state = useGameStore.getState()
          room.send('move', { zone: state.zone, position: state.playerPosition, yaw: state.playerYaw, animation: state.playerAnimation, heldItem: heldItemForState(state), nickname: state.nickname, cash: state.cash, progressValue: economyProgressValue(state), stats: state.stats, tutorialActive: state.tutorialActive, minigameOpen: state.minigameOpen, minigameKind: state.minigameKind, minigameMilestone: state.minigameMilestone, minigameScore: liveMinigameScore(state), eventBay: state.eventBay })
        }
        publish()
        const timer = window.setInterval(publish, 100)
        stopPresence = () => { window.clearInterval(timer); setMultiplayerSender(null); void room.leave() }
      } catch {
        stopPresence = startLocalFallback()
      }
    }
    void connect()
    const prune = window.setInterval(() => setPeers((current) => Object.fromEntries(Object.entries(current).filter(([, peer]) => Date.now() - peer.seenAt < 6000))), 1000)
    return () => { disposed = true; window.clearInterval(prune); stopPresence?.(); setOnlinePlayers([]) }
  }, [setEventBay, setLobbyState, setOnlinePlayers, syncMatch])

  const visiblePeers = tutorialActive ? [] : Object.values(peers).filter((peer) => !peer.tutorialActive && (minigameOpen
    ? peer.minigameOpen && peer.minigameKind === minigameKind && peer.minigameMilestone === minigameMilestone
    : !peer.minigameOpen && peer.zone === zone))
  return <>{visiblePeers.map((peer) => <RemotePlayer key={peer.id} peer={peer} />)}</>
}

function Player() {
  const playerRoot = useRef<THREE.Group>(null)
  const visual = useRef<THREE.Group>(null)
  const position = useRef(new THREE.Vector3(0, 0.86, 14))
  const horizontalVelocity = useRef(new THREE.Vector3())
  const verticalVelocity = useRef(0)
  const keys = useRef<Record<string, boolean>>({})
  const sprintToggled = useRef(false)
  const yaw = useRef(frontVisualTest || closeVisualTest ? Math.PI : 0)
  const pitch = useRef(0.08)
  const shiftLock = useRef(false)
  const rightDragging = useRef(false)
  const distance = useRef(closeVisualTest ? 3.25 : 6.2)
  const cameraPosition = useRef(new THREE.Vector3(0, 4.2, 20.2))
  const cameraTarget = useRef(new THREE.Vector3(0, 1.68, 14))
  const cameraRaycaster = useRef(new THREE.Raycaster())
  const obstructionRoot = useRef<THREE.Object3D | null>(null)
  const obstructionTargets = useRef<THREE.Object3D[]>([])
  const lastObstructionCheck = useRef(-1)
  const obstructionDistance = useRef<number | null>(null)
  const lastStoreUpdate = useRef(0)
  const portalReadyAt = useRef(0)
  const footstepPhase = useRef(0)
  const footstepAnimation = useRef('')
  const grounded = useRef(true)
  const spawnedZone = useRef<string | null>(null)
  const zone = useGameStore((state) => state.zone)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const minigameMilestone = useGameStore((state) => state.minigameMilestone)
  const lobbyPlayerCount = useGameStore((state) => state.lobbyPlayerCount)
  const sessionSeed = useGameStore((state) => state.sessionSeed)
  const roundNumber = useGameStore((state) => state.roundNumber)
  const matchStartedAt = useGameStore((state) => state.matchStartedAt)
  const forageRushRareSnapshot = useGameStore((state) => state.forageRushRareSnapshot)
  const eventBay = useGameStore((state) => state.eventBay)
  const teleportNonce = useGameStore((state) => state.teleportNonce)
  const tutorialActive = useGameStore((state) => state.tutorialActive)
  const tutorialStep = useGameStore((state) => state.tutorialStep)
  const anchors = useGameStore((state) => state.anchors)
  const colliders = useGameStore((state) => state.colliders)
  const setPlayerPosition = useGameStore((state) => state.setPlayerPosition)
  const setShiftLocked = useGameStore((state) => state.setShiftLocked)
  const setSelectedHotbar = useGameStore((state) => state.setSelectedHotbar)
  const setZone = useGameStore((state) => state.setZone)
  const cameraSensitivity = useGameStore((state) => state.cameraSensitivity)
  const cameraInvertY = useGameStore((state) => state.cameraInvertY)
  const storedShiftLocked = useGameStore((state) => state.shiftLocked)
  const pointerUiOpen = useGameStore((state) => ((state.sessionStarted || state.tutorialActive) && (state.guideOpen || state.lobbySettingsOpen)) || state.shopOpen || state.stockOpen || state.inventoryOpen || state.menuOpen || state.playerPanelOpen || state.lotteryOpen || state.ticketInspectOpen || state.noteInspectOpen || state.travelOpen || state.secretOpen || state.cookbookOpen || state.enhancementOpen || Boolean(state.itemUseOpen) || state.sessionComplete)
  const graphicsMode = useGameStore((state) => state.graphicsMode)
  const interactionProgress = useGameStore((state) => state.interactionProgress)
  const prompt = useGameStore((state) => state.prompt)
  const selectedHotbar = useGameStore((state) => state.selectedHotbar)
  const hotbar = useGameStore((state) => state.hotbar)
  const sensitivity = useRef(cameraSensitivity)
  const invertY = useRef(cameraInvertY)
  const { camera, gl, scene: worldScene } = useThree()
  const source = useGLTF('/assets/3d/characters/ranger.glb').scene
  const animationSource = useGLTF('/assets/3d/animations/standard.glb')
  const toolAnimationSource = useGLTF('/assets/3d/animations/tool-actions.glb?v=3')
  const animationClips = useMemo(() => characterAnimationClips(animationSource.animations, toolAnimationSource.animations), [animationSource.animations, toolAnimationSource.animations])
  const { actions } = useAnimations(animationClips, visual)
  const activeAnimation = useRef('')
  const selectedHeldItem = useGameStore(heldItemForState)
  const heldItem = heldItemVisualTest ?? (miningMotionVisualTest ? selectedHeldItem ?? 'worn-pickaxe' : selectedHeldItem)
  const visuallyMining = miningMotionVisualTest || interactionProgress > 0 && Boolean(prompt && (prompt.id.startsWith('MineOre') || prompt.id.startsWith('RushOre')))
  const eventSpawn = minigameOpen ? anchors[`Spawn${eventBay}`] : null
  const eventFarmCell = minigameOpen && minigameKind === 'farm' ? anchors[`FarmRushCell${eventBay}_22`] : null
  const activeEventRares = visibleRareForageIds(Object.keys(anchors), true, forageRushRareSnapshot, sessionSeed, matchStartedAt, Date.now(), lobbyPlayerCount, minigameMilestone)
  const eventForageResource = resourceVisualTarget === 'truffle'
    ? [...activeEventRares].find((id) => id.startsWith('ForageRushTruffle'))
    : resourceVisualTarget === 'discovery'
      ? [...activeEventRares].find((id) => id.startsWith('ForageRushDiscovery'))
      : Object.keys(anchors).find((id) => id.startsWith('ForageRushApple'))
  const eventResource = minigameOpen && (resourceVisualGate || furnaceVisualGate)
    ? furnaceVisualGate && minigameKind === 'farm'
      ? anchors[`FarmRushCooker${eventBay}`]
      : minigameKind === 'mining'
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
    if (pointerUiOpen) {
      if (document.pointerLockElement === gl.domElement) document.exitPointerLock()
      gl.domElement.style.cursor = ''
      return
    }
    gl.domElement.style.cursor = storedShiftLocked ? 'none' : ''
  }, [gl, pointerUiOpen, storedShiftLocked])

  useEffect(() => {
    const spawnKey = minigameOpen
      ? `${zone}:${teleportNonce}:${minigameKind}:${eventBay}`
      : tutorialActive ? `${zone}:${teleportNonce}:tutorial` : `${zone}:${teleportNonce}`
    if (spawnedZone.current === spawnKey) return
    if (minigameOpen && farmCellVisualGate && !eventFarmCell) return
    if (deepVisualGate && !anchors.GateDeep) return
    // Normal entries must wait for the authored scene anchor. Falling back
    // during GLB loading permanently placed the player at an obsolete outdoor
    // mine coordinate before the real cavern spawn became available.
    if (!minigameOpen && !resourceVisualGate && !furnaceVisualGate && !farmCellVisualGate && !deepVisualGate && !anchors.Spawn) return
    const resource = minigameOpen ? ((resourceVisualGate || furnaceVisualGate) ? eventResource : farmCellVisualGate && eventFarmCell ? eventFarmCell : eventSpawn ?? eventFallback) : zone === 'forage' ? (resourceVisualTarget === 'merchant' ? anchors[`SecretSite${merchantSiteVisualTest ?? secretSiteForRound('forage', roundNumber, sessionSeed)}`] : anchors.ForageApple000) : zone === 'mine' ? (resourceVisualTarget === 'merchant' ? anchors[`SecretSite${merchantSiteVisualTest ?? secretSiteForRound('mine', roundNumber, sessionSeed)}`] : anchors.MineOre000) : zone === 'farm' ? (resourceVisualTarget === 'merchant' ? anchors[`SecretSite${merchantSiteVisualTest ?? secretSiteForRound('farm', roundNumber, sessionSeed)}`] : (furnaceVisualGate || resourceVisualGate) ? anchors.FurnacePad0 : anchors.FarmClaim0) : null
    const farmCell = zone === 'farm' ? anchors.FarmCell0_27 : null
    if ((resourceVisualGate || furnaceVisualGate) && !resource) return
    if (farmCellVisualGate && !minigameOpen && !farmCell) return
    const resourceSpawn = resource
      ? minigameOpen
        ? (farmCellVisualGate || resourceVisualGate) ? [resource[0], resource[1], resource[2] + 2.45] as [number, number, number] : resource
        : resourceVisualTarget === 'merchant'
          ? [resource[0] + (resource[0] < 0 ? 4.2 : -4.2), resource[1], resource[2]] as [number, number, number]
          : zone === 'mine'
            ? [resource[0], resource[1], resource[2] + 3.4] as [number, number, number]
            : [resource[0], resource[1], resource[2] + 2.45] as [number, number, number]
      : null
    const farmCellSpawn = farmCell ? [farmCell[0] + 2.15, farmCell[1], farmCell[2] + 3.15] as [number, number, number] : null
    const tutorialTarget = tutorialActive
      ? tutorialStep === 2 ? (anchors.NpcShop ?? anchors.Shop)
      : tutorialStep === 3 ? (anchors.NpcMineShop ?? anchors.MineShop)
      : tutorialStep === 4 ? (anchors.NpcForageShop ?? anchors.ForageShop ?? anchors.Spawn)
      : tutorialStep === 5 ? anchors.Spawn
      : tutorialStep === 7 ? anchors.FurnacePad0
      : tutorialStep === 8 ? (anchors.NpcFoodBuyer ?? anchors.FoodBuyer)
      : tutorialStep === 9 ? (anchors.NpcStocks ?? anchors.Stocks)
      : tutorialStep === 10 ? (anchors.LabelEnhance ?? anchors.Enhance)
      : null
      : null
    const tutorialSpawn = tutorialTarget
      ? [tutorialTarget[0], tutorialTarget[1], tutorialTarget[2] + (tutorialStep === 4 ? 7.5 : 5)] as [number, number, number]
      : null
    const normalSpawn = anchors.Spawn
    const spawn = (minigameOpen ? resourceSpawn : null) ?? tutorialSpawn ?? (farmCellVisualGate ? farmCellSpawn : null) ?? ((resourceVisualGate || furnaceVisualGate) ? resourceSpawn : null) ?? (deepVisualGate ? anchors.GateDeep : null) ?? normalSpawn ?? FALLBACK_SPAWNS[zone]
    spawnedZone.current = spawnKey
    yaw.current = resourceVisualTarget === 'merchant' && resource
      ? resource[0] < 0 ? Math.PI / 2 : -Math.PI / 2
      : frontVisualTest || closeVisualTest ? Math.PI
      : farmCellVisualGate ? -0.42 : 0
    pitch.current = resourceVisualGate && zone === 'mine' ? 0.08 : deepVisualGate ? 0.12 : 0.08
    distance.current = closeVisualTest ? 3.25 : deepVisualGate ? 6.8 : 6.2
    position.current.set(spawn[0], (minigameOpen ? minigameGroundHeight(minigameKind, spawn[0], spawn[2]) : groundHeight(zone, spawn[0], spawn[2])) + 0.86, spawn[2])
    livePlayerPosition.copy(position.current)
    horizontalVelocity.current.set(0, 0, 0)
    verticalVelocity.current = 0
    grounded.current = true
    const target = new THREE.Vector3(position.current.x, position.current.y + 0.82, position.current.z)
    const horizontalDistance = Math.cos(pitch.current) * distance.current
    const desired = target.clone().add(new THREE.Vector3(
      Math.sin(yaw.current) * horizontalDistance,
      1.15 + Math.sin(pitch.current) * distance.current,
      Math.cos(yaw.current) * horizontalDistance,
    ))
    const environment = worldScene.children.find((child) => child.userData.environment)
    if (environment) {
      obstructionRoot.current = environment
      obstructionTargets.current = cameraObstructionMeshes(environment)
      const cameraDirection = desired.clone().sub(target)
      const desiredDistance = cameraDirection.length()
      cameraDirection.normalize()
      cameraRaycaster.current.set(target, cameraDirection)
      cameraRaycaster.current.far = desiredDistance
      const obstruction = cameraRaycaster.current.intersectObjects(obstructionTargets.current, false).find((hit) => hit.distance > 0.42)
      if (obstruction) desired.copy(target).addScaledVector(cameraDirection, Math.max(0.72, obstruction.distance - 0.28))
    }
    cameraTarget.current.copy(target)
    cameraPosition.current.copy(desired)
    camera.position.copy(desired)
    camera.lookAt(target)
    portalReadyAt.current = performance.now() + 1500
  }, [anchors.Enhance, anchors.FarmCell0_27, anchors.FarmClaim0, anchors.FoodBuyer, anchors.ForageApple000, anchors.FurnacePad0, anchors.GateDeep, anchors.LabelEnhance, anchors.MineOre000, anchors.MineShop, anchors.NpcFoodBuyer, anchors.NpcMineShop, anchors.NpcShop, anchors.NpcStocks, anchors.Shop, anchors.Stocks, camera, eventBay, eventFallback, eventFarmCell, eventResource, eventSpawn, minigameKind, minigameOpen, teleportNonce, tutorialActive, tutorialStep, zone])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return
      const live = useGameStore.getState()
      keys.current[event.code] = true
      if ((event.code === 'ShiftLeft' || event.code === 'ShiftRight') && live.sprintMode === 'toggle' && !event.repeat) sprintToggled.current = !sprintToggled.current
      const pregameRoam = !live.sessionStarted && !live.tutorialActive
      const cameraToggleLocked = (!pregameRoam && (live.guideOpen || live.lobbySettingsOpen)) || live.shopOpen || live.stockOpen || live.inventoryOpen || live.menuOpen || live.playerPanelOpen || live.lotteryOpen || live.ticketInspectOpen || live.noteInspectOpen || live.travelOpen || live.secretOpen || live.cookbookOpen || live.enhancementOpen || Boolean(live.itemUseOpen) || live.sessionComplete
      if (event.code === 'KeyQ' && !event.repeat && (!cameraToggleLocked || shiftLock.current)) {
        shiftLock.current = !shiftLock.current
        setShiftLocked(shiftLock.current)
        gl.domElement.style.cursor = shiftLock.current ? 'none' : ''
        if (shiftLock.current) {
          if (document.pointerLockElement !== gl.domElement) {
            try {
              const request = gl.domElement.requestPointerLock?.()
              if (request instanceof Promise) void request.catch(() => undefined)
            } catch {
              // Embedded browsers may reject pointer lock; shift-lock camera input still works without it.
            }
          }
        }
        else if (document.pointerLockElement === gl.domElement) document.exitPointerLock()
      }
      const floor = (live.minigameOpen ? minigameGroundHeight(live.minigameKind, position.current.x, position.current.z) : groundHeight(live.zone, position.current.x, position.current.z)) + 0.86
      const jumpLocked = (!pregameRoam && (live.guideOpen || live.lobbySettingsOpen)) || (live.minigameOpen && !live.minigameActive) || live.shopOpen || live.stockOpen || live.inventoryOpen || live.menuOpen || live.playerPanelOpen || live.lotteryOpen || live.ticketInspectOpen || live.noteInspectOpen || live.travelOpen || live.secretOpen || live.cookbookOpen || live.enhancementOpen || Boolean(live.itemUseOpen) || live.sessionComplete
      if (event.code === 'Space' && !event.repeat && !jumpLocked && position.current.y <= floor + 0.03) {
        verticalVelocity.current = 5.2
        grounded.current = false
        playGameSfx('jump', live.audioVolumes.master * live.audioVolumes.effects)
      }
    }
    const up = (event: KeyboardEvent) => { keys.current[event.code] = false }
    const clearInput = () => { keys.current = {}; sprintToggled.current = false }
    const move = (event: PointerEvent) => {
      if (shiftLock.current || rightDragging.current || event.buttons === 2) {
        // Pointer-lock transitions can report a single extreme delta. Clamp
        // that one event and keep yaw normalized so repeated full rotations
        // remain continuous instead of appearing to snap back.
        const horizontal = THREE.MathUtils.clamp(event.movementX, -160, 160)
        const nextYaw = yaw.current - horizontal * 0.004 * sensitivity.current
        yaw.current = Math.atan2(Math.sin(nextYaw), Math.cos(nextYaw))
        const vertical = THREE.MathUtils.clamp(event.movementY, -140, 140) * (invertY.current ? -1 : 1)
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
    const captureRightPointer = (event: PointerEvent) => {
      if (event.button !== 2) return
      event.preventDefault()
      const live = useGameStore.getState()
      const pregameRoam = !live.sessionStarted && !live.tutorialActive
      const blocked = (!pregameRoam && (live.guideOpen || live.lobbySettingsOpen)) || live.shopOpen || live.stockOpen || live.inventoryOpen || live.menuOpen || live.playerPanelOpen || live.lotteryOpen || live.ticketInspectOpen || live.noteInspectOpen || live.travelOpen || live.secretOpen || live.cookbookOpen || live.enhancementOpen || Boolean(live.itemUseOpen) || live.sessionComplete
      if (blocked) return
      // Right-drag uses pointer capture so Chrome does not show its Pointer
      // Lock security banner on every camera drag. Q remains the deliberate
      // unlimited-rotation mode.
      rightDragging.current = true
      gl.domElement.style.cursor = 'none'
      try { gl.domElement.setPointerCapture(event.pointerId) } catch { /* Pointer capture is unavailable in some embedded browsers. */ }
    }
    const releaseRightPointer = (event: PointerEvent) => {
      if (event.button !== 2) return
      rightDragging.current = false
      if (gl.domElement.hasPointerCapture(event.pointerId)) gl.domElement.releasePointerCapture(event.pointerId)
      if (!shiftLock.current && document.pointerLockElement === gl.domElement) document.exitPointerLock()
      if (!shiftLock.current) gl.domElement.style.cursor = ''
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clearInput)
    document.addEventListener('visibilitychange', clearInput)
    gl.domElement.addEventListener('pointermove', move)
    gl.domElement.addEventListener('pointerdown', captureRightPointer)
    window.addEventListener('pointerup', releaseRightPointer)
    gl.domElement.addEventListener('wheel', wheel, { passive: false })
    gl.domElement.addEventListener('contextmenu', context)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clearInput)
      document.removeEventListener('visibilitychange', clearInput)
      gl.domElement.removeEventListener('pointermove', move)
      gl.domElement.removeEventListener('pointerdown', captureRightPointer)
      window.removeEventListener('pointerup', releaseRightPointer)
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
    const pregameRoam = !liveUi.sessionStarted && !liveUi.tutorialActive
    const movementLocked = (!pregameRoam && (liveUi.guideOpen || liveUi.lobbySettingsOpen)) || (liveUi.minigameOpen && !liveUi.minigameActive) || liveUi.shopOpen || liveUi.stockOpen || liveUi.inventoryOpen || liveUi.menuOpen || liveUi.playerPanelOpen || liveUi.lotteryOpen || liveUi.ticketInspectOpen || liveUi.noteInspectOpen || liveUi.travelOpen || liveUi.secretOpen || liveUi.cookbookOpen || liveUi.enhancementOpen || Boolean(liveUi.itemUseOpen) || liveUi.sessionComplete
    if (movementLocked) {
      keys.current = {}
      sprintToggled.current = false
      horizontalVelocity.current.set(0, 0, 0)
    }
    const inputX = movementLocked ? 0 : Number(Boolean(keys.current.KeyD)) - Number(Boolean(keys.current.KeyA))
    const inputZ = movementLocked ? 0 : Number(Boolean(keys.current.KeyW)) - Number(Boolean(keys.current.KeyS))
    const cameraForward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current))
    const right = new THREE.Vector3(Math.cos(yaw.current), 0, -Math.sin(yaw.current))
    const direction = cameraForward.clone().multiplyScalar(inputZ).add(right.multiplyScalar(inputX))
    const hasMovementInput = direction.lengthSq() > 0
    if (hasMovementInput) direction.normalize()
    const sprinting = hasMovementInput && (liveUi.sprintMode === 'toggle' ? sprintToggled.current : Boolean(keys.current.ShiftLeft || keys.current.ShiftRight))
    const speed = sprinting ? 8.4 : 3.9
    const targetVelocity = direction.clone().multiplyScalar(speed)
    const movementResponse = hasMovementInput
      ? grounded.current ? (sprinting ? 9 : 11) : 4.5
      : grounded.current ? 16 : 2.5
    horizontalVelocity.current.lerp(targetVelocity, 1 - Math.exp(-movementResponse * delta))
    if (!hasMovementInput && horizontalVelocity.current.lengthSq() < 0.0025) horizontalVelocity.current.set(0, 0, 0)
    const locomotionSpeed = horizontalVelocity.current.length()
    const moving = locomotionSpeed > 0.15
    const next = position.current.clone().addScaledVector(horizontalVelocity.current, delta)
    if (liveUi.minigameOpen) {
      const eventLimit = liveUi.minigameKind === 'forage' ? 216 : liveUi.minigameKind === 'farm' ? 49 : 57
      const eventNextX = next.x
      const eventNextZ = next.z
      next.x = THREE.MathUtils.clamp(next.x, -eventLimit, eventLimit)
      next.z = THREE.MathUtils.clamp(next.z, liveUi.minigameKind === 'forage' ? -219 : liveUi.minigameKind === 'farm' ? -34 : -40, liveUi.minigameKind === 'forage' ? 46 : liveUi.minigameKind === 'farm' ? 40 : 42)
      if (next.x !== eventNextX) horizontalVelocity.current.x = 0
      if (next.z !== eventNextZ) horizontalVelocity.current.z = 0
      if (liveUi.minigameKind === 'mining') {
        const [bayX, bayZ] = MINING_RUSH_BAY_CENTERS[liveUi.eventBay] ?? MINING_RUSH_BAY_CENTERS[0]
        const bayNextX = next.x
        const bayNextZ = next.z
        next.x = THREE.MathUtils.clamp(next.x, bayX - 10.55, bayX + 10.55)
        next.z = THREE.MathUtils.clamp(next.z, bayZ - 10.55, bayZ + 10.55)
        if (next.x !== bayNextX) horizontalVelocity.current.x = 0
        if (next.z !== bayNextZ) horizontalVelocity.current.z = 0
      }
    } else if (zone === 'forage') {
      const forageNextX = next.x
      const forageNextZ = next.z
      next.x = THREE.MathUtils.clamp(next.x, -216, 216)
      next.z = THREE.MathUtils.clamp(next.z, -219, 46)
      if (next.x !== forageNextX) horizontalVelocity.current.x = 0
      if (next.z !== forageNextZ) horizontalVelocity.current.z = 0
    } else if (zone === 'mine') {
      next.x = THREE.MathUtils.clamp(next.x, -68, 68)
      next.z = THREE.MathUtils.clamp(next.z, -253, 77)
      if (!pointInMine(next.x, next.z)) {
        next.copy(position.current)
        horizontalVelocity.current.set(0, 0, 0)
      }
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
        const normalX = dx / separation
        const normalZ = dz / separation
        next.x = collider.x + normalX * minimum
        next.z = collider.z + normalZ * minimum
        const inwardSpeed = horizontalVelocity.current.x * normalX + horizontalVelocity.current.z * normalZ
        if (inwardSpeed < 0) {
          horizontalVelocity.current.x -= inwardSpeed * normalX
          horizontalVelocity.current.z -= inwardSpeed * normalZ
        }
      }
    }
    position.current.x = next.x
    position.current.z = next.z
    verticalVelocity.current -= 14 * delta
    position.current.y += verticalVelocity.current * delta
    const terrainY = liveUi.minigameOpen ? minigameGroundHeight(liveUi.minigameKind, position.current.x, position.current.z) : groundHeight(zone, position.current.x, position.current.z)
    const standingY = terrainY + 0.86
    const wasGrounded = grounded.current
    if (position.current.y < standingY) {
      position.current.y = standingY
      verticalVelocity.current = 0
      grounded.current = true
    } else {
      grounded.current = false
    }
    const miningInteraction = visuallyMining
    const requestedAnimation = miningInteraction
      ? 'TreeChopping_Loop'
      : interactionProgress > 0 && prompt
      ? 'Armature|Interact'
      : !grounded.current && moving
        ? sprinting ? 'Armature|Sprint_Loop' : 'Armature|Walk_Loop'
        : !grounded.current
          ? 'Armature|Walk_Loop'
          : sprinting && locomotionSpeed > 4.6
            ? 'Armature|Sprint_Loop'
            : moving ? 'Armature|Walk_Loop' : 'Armature|Idle_Loop'
    if (requestedAnimation !== activeAnimation.current || !actions[requestedAnimation]?.isRunning()) {
      const airborneTransition = !grounded.current || !wasGrounded
      actions[activeAnimation.current]?.fadeOut(airborneTransition ? 0.1 : 0.18)
      const nextAction = actions[requestedAnimation]
      if (nextAction) {
        nextAction.timeScale = miningInteraction ? 1.05 : !grounded.current && !moving ? 0.72 : 1
        nextAction.reset().fadeIn(airborneTransition ? 0.1 : 0.18).play()
      }
      activeAnimation.current = requestedAnimation
    }
    const locomotion = grounded.current && moving && (requestedAnimation === 'Armature|Walk_Loop' || requestedAnimation === 'Armature|Sprint_Loop') ? requestedAnimation : ''
    if (locomotion !== footstepAnimation.current) {
      footstepAnimation.current = locomotion
      const action = locomotion ? actions[locomotion] : null
      footstepPhase.current = action ? (action.time / Math.max(.001, action.getClip().duration)) % 1 : 0
    } else if (locomotion) {
      const action = actions[locomotion]
      if (action) {
        const phase = (action.time / Math.max(.001, action.getClip().duration)) % 1
        const previous = footstepPhase.current
        const crossed = (mark: number) => previous <= phase ? previous < mark && phase >= mark : previous < mark || phase >= mark
        if (crossed(.14) || crossed(.64)) {
          const stoneFloor = zone === 'mine' || (liveUi.minigameOpen && liveUi.minigameKind === 'mining')
          playGameSfx(stoneFloor ? 'footstep-stone' : 'footstep-grass', liveUi.audioVolumes.master * liveUi.audioVolumes.effects)
        }
        footstepPhase.current = phase
      }
    }
    if (shiftLock.current) {
      const angle = Math.atan2(cameraForward.x, cameraForward.z)
      if (playerRoot.current) playerRoot.current.rotation.y = angle
    } else if (moving) {
      const angle = Math.atan2(horizontalVelocity.current.x, horizontalVelocity.current.z)
      if (playerRoot.current) playerRoot.current.rotation.y = angle
    }
    if (visual.current) {
      visual.current.position.y = moving && grounded.current ? Math.sin(state.clock.elapsedTime * (sprinting ? 13 : 8)) * 0.025 : 0
      visual.current.rotation.x = THREE.MathUtils.lerp(visual.current.rotation.x, !grounded.current ? (moving ? -0.055 : -0.025) : 0, 0.14)
      visual.current.rotation.z = THREE.MathUtils.lerp(visual.current.rotation.z, moving ? -inputX * 0.035 : 0, 0.12)
    }
    const current = position.current
    livePlayerPosition.copy(current)
    if (playerRoot.current) playerRoot.current.position.copy(current)
    const portals: Array<{ point?: [number, number, number]; destination: ZoneId }> = zone === 'hub'
      ? [
          { point: anchors.PortalForage, destination: 'forage' },
          { point: anchors.PortalFarm, destination: 'farm' },
          { point: anchors.PortalMine, destination: 'mine' },
        ]
      : [{ point: anchors.Home, destination: 'hub' }]
    const entered = liveUi.sessionStarted ? portals.find(({ point }) => point && Math.hypot(current.x - point[0], current.z - point[2]) <= 2.1) : undefined
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
      if (obstructionRoot.current !== liveEnvironment) {
        obstructionRoot.current = liveEnvironment
        obstructionTargets.current = cameraObstructionMeshes(liveEnvironment)
        lastObstructionCheck.current = -1
        obstructionDistance.current = null
      }
      const cameraDirection = desired.clone().sub(target)
      const desiredDistance = cameraDirection.length()
      cameraDirection.normalize()
      if (state.clock.elapsedTime - lastObstructionCheck.current >= 1 / 30) {
        cameraRaycaster.current.set(target, cameraDirection)
        cameraRaycaster.current.far = desiredDistance
        const obstruction = cameraRaycaster.current.intersectObjects(obstructionTargets.current, false).find((hit) => hit.distance > 0.42)
        obstructionDistance.current = obstruction ? Math.max(0.72, obstruction.distance - 0.28) : null
        lastObstructionCheck.current = state.clock.elapsedTime
      }
      if (obstructionDistance.current !== null && obstructionDistance.current < desiredDistance) desired.copy(target).addScaledVector(cameraDirection, obstructionDistance.current)
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
      setPlayerPosition([current.x, current.y, current.z], playerRoot.current?.rotation.y ?? yaw.current, requestedAnimation)
      lastStoreUpdate.current = state.clock.elapsedTime
    }
  })

  return (
    <group ref={playerRoot} position={[0, 0.9, 14]} rotation={[0, Math.PI, 0]}>
      {(zone === 'mine' || minigameOpen && minigameKind === 'mining') && graphicsMode === 'high' && <pointLight color="#a9bec1" intensity={2.3} distance={7.5} decay={2} position={[0, 1.55, -1.15]} />}
      <group ref={visual}>
        <primitive object={ranger} />
        <HeldItemAttachment character={ranger} item={heldItem} />
      </group>
    </group>
  )
}

function InteractiveWorldObjects() {
  const zone = useGameStore((state) => state.zone)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const anchors = useGameStore((state) => state.anchors)
  const localFarmCells = useGameStore((state) => state.farmCells)
  const sharedFarmCells = useGameStore((state) => state.sharedFarmCells)
  const sharedFarmOnline = useGameStore((state) => state.sharedFarmOnline)
  const tutorialActive = useGameStore((state) => state.tutorialActive)
  const farmCells = farmCellVisualGate ? localFarmCells : sharedFarmOnline && !tutorialActive ? sharedFarmCells : localFarmCells
  const farmRushCells = useGameStore((state) => state.farmRushCells)
  const forageRushDelivered = useGameStore((state) => state.forageRushDelivered)
  const language = useGameStore((state) => state.language)
  const roundNumber = useGameStore((state) => state.roundNumber)
  const sessionSeed = useGameStore((state) => state.sessionSeed)
  const secretPoint = zone === 'hub' ? null : anchors[`SecretSite${merchantSiteVisualTest ?? secretSiteForRound(zone, roundNumber, sessionSeed)}`]
  const secretActive = zone !== 'hub' && (resourceVisualTarget === 'merchant' || secretZoneForRound(roundNumber) === zone) && secretPoint
  const secretFacing = secretPoint ? Math.atan2(-secretPoint[0], -72 - secretPoint[2]) : 0
  return (
    <>
      {zone === 'hub' && anchors.NpcShop && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcShop[0], anchors.NpcShop[1] + 0.02, anchors.NpcShop[2]]} rotation={[0, -2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'hub' && anchors.NpcStocks && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcStocks[0], anchors.NpcStocks[1] + 0.02, anchors.NpcStocks[2]]} rotation={[0, 2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'forage' && anchors.NpcForageShop && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcForageShop[0], anchors.NpcForageShop[1] + 0.02, anchors.NpcForageShop[2]]} rotation={[0, -2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'forage' && anchors.NpcForageBuyer && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcForageBuyer[0], anchors.NpcForageBuyer[1] + 0.02, anchors.NpcForageBuyer[2]]} rotation={[0, 2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'farm' && anchors.NpcFarmShop && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcFarmShop[0], anchors.NpcFarmShop[1] + 0.02, anchors.NpcFarmShop[2]]} rotation={[0, -2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'farm' && anchors.NpcProduceBuyer && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcProduceBuyer[0], anchors.NpcProduceBuyer[1] + 0.02, anchors.NpcProduceBuyer[2]]} rotation={[0, 2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'farm' && anchors.NpcFoodBuyer && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcFoodBuyer[0], anchors.NpcFoodBuyer[1] + 0.02, anchors.NpcFoodBuyer[2]]} rotation={[0, 2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'mine' && anchors.NpcMineShop && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcMineShop[0], anchors.NpcMineShop[1] + 0.02, anchors.NpcMineShop[2]]} rotation={[0, -2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {zone === 'mine' && anchors.NpcOreBuyer && <AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[anchors.NpcOreBuyer[0], anchors.NpcOreBuyer[1] + 0.02, anchors.NpcOreBuyer[2]]} rotation={[0, 2.85, 0]} animation="Armature|Idle_Talking_Loop" />}
      {secretActive && <AnimatedCharacter src="/assets/3d/characters/merchant.glb" height={1.76} position={[secretPoint[0], secretPoint[1] + 0.02, secretPoint[2]]} rotation={[0, secretFacing, 0]} animation="Armature|Sitting_Talking_Loop" />}
      {minigameOpen && minigameKind === 'forage' && (['Apple', 'Orange', 'Truffle', 'Discovery'] as const).map((label) => {
        const point = anchors[`NpcForageRush${label}`]
        if (!point) return null
        const kind = label.toLowerCase() as keyof typeof forageRushDelivered
        return <group key={label}><AnimatedCharacter src="/assets/3d/characters/shopkeeper.glb" height={1.68} position={[point[0], point[1] + .02, point[2]]} rotation={[0, Math.PI, 0]} animation="Armature|Idle_Talking_Loop" /><Html position={[point[0], point[1] + 2.25, point[2]]} center style={{ pointerEvents: 'none' }}><span className={`world-label ${forageRushDelivered[kind] ? 'complete' : ''}`}>{uiText(language, forageRushDelivered[kind] ? 'DONE' : label.toUpperCase())}</span></Html></group>
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
                : ['/assets/3d/crops/tomato_1.glb?v=2', '/assets/3d/crops/tomato_3.glb?v=2', '/assets/3d/crops/tomato_crop.glb?v=2']
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
              : ['/assets/3d/crops/tomato_1.glb?v=2', '/assets/3d/crops/tomato_3.glb?v=2', '/assets/3d/crops/tomato_crop.glb?v=2']
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

function candidateForAnchor(anchor: string, claimedFarms: number[], furnaceCount: number, farmOwners: Record<number, string | null> = {}): InteractionCandidate | null {
  if (anchor.startsWith('FarmRushCell')) return { id: anchor, label: 'Use Plot', anchor, reach: 3.25, lift: .08 }
  if (anchor.startsWith('FarmRushCooker')) return { id: anchor, label: 'Cook', anchor, reach: 3.4, lift: 1 }
  if (anchor.startsWith('ForageRushDeliver')) return { id: anchor, label: 'Deliver', anchor, reach: 3.4, lift: 1 }
  if (anchor.startsWith('ForageRushApple')) return { id: anchor, label: 'Apples', anchor, reach: 3.25, lift: .5 }
  if (anchor.startsWith('ForageRushOrange')) return { id: anchor, label: 'Oranges', anchor, reach: 3.25, lift: .5 }
  if (anchor.startsWith('ForageRushTruffle')) return { id: anchor, label: 'Truffle', anchor, reach: 3.1, lift: .18 }
  if (anchor.startsWith('ForageRushDiscovery')) return { id: anchor, label: 'Discovery', anchor, reach: 3.1, lift: .25 }
  if (anchor.startsWith('SecretSite')) return { id: 'secret-npc', label: 'Trade', anchor, reach: 3.1 }
  if (anchor === 'Shop') return { id: 'shop', label: 'General Shop', anchor, reach: 3 }
  if (anchor === 'Stocks') return { id: 'stocks', label: 'Stocks', anchor, reach: 3 }
  if (anchor === 'Enhance') return { id: 'enhance', label: 'Enhance', anchor, reach: 3 }
  if (anchor === 'FarmShop') return { id: 'farm-shop', label: 'Farm Shop', anchor, reach: 3 }
  if (anchor === 'ProduceBuyer') return { id: 'produce-shop', label: 'Crop Market', anchor, reach: 3 }
  if (anchor === 'FoodBuyer') return { id: 'food-shop', label: 'Food Market', anchor, reach: 3 }
  if (anchor === 'MineShop') return { id: 'mine-shop', label: 'Mining Shop', anchor, reach: 3 }
  if (anchor === 'OreBuyer') return { id: 'ore-shop', label: 'Ore Market', anchor, reach: 3 }
  if (anchor === 'ForageShop') return { id: 'forage-shop', label: 'Forage Shop', anchor, reach: 3 }
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
  if (claim) {
    const farm = Number(claim[1])
    return { id: `farm-claim:${claim[1]}`, label: claimedFarms.includes(farm) ? 'Your Farm' : farmOwners[farm] ? 'Claimed' : 'Claim Farm', anchor, reach: 3.2, lift: 1 }
  }
  if (anchor.startsWith('Mine')) return { id: anchor, label: 'Mine Ore', anchor, reach: 3.6, lift: 0.55 }
  if (anchor.startsWith('RushOre')) return { id: anchor, label: 'Mine Ore', anchor, reach: 3.65, lift: 0.55 }
  return null
}

function InteractionTargeter() {
  const anchors = useGameStore((state) => state.anchors)
  const claimedFarms = useGameStore((state) => state.claimedFarms)
  const sharedFarmOnline = useGameStore((state) => state.sharedFarmOnline)
  const tutorialActive = useGameStore((state) => state.tutorialActive)
  const sharedFarmSelfId = useGameStore((state) => state.sharedFarmSelfId)
  const farmOwners = useGameStore((state) => state.farmOwners)
  const useSharedFarm = sharedFarmOnline && !tutorialActive
  const activeClaimedFarms = useSharedFarm ? Object.keys(farmOwners).map(Number).filter((farm) => farmOwners[farm] === sharedFarmSelfId) : claimedFarms
  const furnaceCount = useGameStore((state) => state.inventory.furnace ?? 0)
  const collectedForage = useGameStore((state) => state.collectedForage)
  const sharedForageOnline = useGameStore((state) => state.sharedForageOnline)
  const sharedForageAvailability = useGameStore((state) => state.sharedForageAvailability)
  const minedNodes = useGameStore((state) => state.minedNodes)
  const rushNodes = useGameStore((state) => state.rushNodes)
  const forageRushCollected = useGameStore((state) => state.forageRushCollected)
  const forageRushRareSnapshot = useGameStore((state) => state.forageRushRareSnapshot)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const minigameMilestone = useGameStore((state) => state.minigameMilestone)
  const lobbyPlayerCount = useGameStore((state) => state.lobbyPlayerCount)
  const eventBay = useGameStore((state) => state.eventBay)
  const sessionSeed = useGameStore((state) => state.sessionSeed)
  const matchStartedAt = useGameStore((state) => state.matchStartedAt)
  const shiftLocked = useGameStore((state) => state.shiftLocked)
  const zone = useGameStore((state) => state.zone)
  const roundNumber = useGameStore((state) => state.roundNumber)
  const interactionProgress = useGameStore((state) => state.interactionProgress)
  const setPrompt = useGameStore((state) => state.setPrompt)
  const { camera, scene } = useThree()
  const lastCheck = useRef(0)
  const previous = useRef<string | null>(null)
  const lineOfSight = useRef(new THREE.Raycaster())

  useFrame((state) => {
    if (state.clock.elapsedTime - lastCheck.current < 0.025) return
    lastCheck.current = state.clock.elapsedTime
    let best: { candidate: InteractionCandidate; score: number } | null = null
    const anchorIds = Object.keys(anchors)
    const rushForage = minigameOpen && minigameKind === 'forage'
    const activeRares = !rushForage && sharedForageOnline
      ? new Set(anchorIds.filter((id) => (id.startsWith('ForageTruffle') || id.startsWith('ForageDiscovery')) && (sharedForageAvailability[id] ?? 0) > 0))
      : visibleRareForageIds(anchorIds, rushForage, forageRushRareSnapshot, sessionSeed, matchStartedAt, Date.now(), lobbyPlayerCount, minigameMilestone)
    const heldMiningTarget = interactionProgress > 0 && (previous.current?.startsWith('MineOre') || previous.current?.startsWith('RushOre'))
    for (const anchor of anchorIds) {
      if (minigameOpen && !anchor.startsWith('RushOre') && !anchor.startsWith('FarmRush') && !anchor.startsWith('ForageRush')) continue
      if (minigameOpen && eventBayForAnchor(anchor) !== null && eventBayForAnchor(anchor) !== eventBay) continue
      if (anchor.startsWith('SecretSite') && (zone === 'hub' || secretZoneForRound(roundNumber) !== zone || anchor !== `SecretSite${secretSiteForRound(zone, roundNumber, sessionSeed)}`)) continue
      const candidate = candidateForAnchor(anchor, activeClaimedFarms, furnaceCount, useSharedFarm ? farmOwners : {})
      if (!candidate) continue
      if (heldMiningTarget && candidate.id !== previous.current) continue
      if ((anchor.startsWith('ForageTruffle') || anchor.startsWith('ForageDiscovery') || anchor.startsWith('ForageRushTruffle') || anchor.startsWith('ForageRushDiscovery')) && !activeRares.has(anchor)) continue
      if (candidate.id.startsWith('forage:') && (sharedForageOnline ? sharedForageAvailability[anchor] ?? 0 : forageSiteAvailability(anchor, collectedForage[anchor] ?? 0)) <= 0) continue
      if (candidate.id.startsWith('forage:') && /^(Forage|ForageRush)(Apple|Orange)/.test(anchor)) {
        const resource = scene.getObjectByName(`Resource_${anchor}`)
        if (!resource?.visible || (Number(resource.userData.fruitAvailable) || 0) <= 0) continue
      }
      if (candidate.id.startsWith('Mine') && (minedNodes[candidate.id] ?? 0) > Date.now()) continue
      if (candidate.id.startsWith('RushOre') && (rushNodes[candidate.id]?.readyAt ?? 0) > Date.now()) continue
      if (candidate.id.startsWith('ForageRush') && !candidate.id.startsWith('ForageRushDeliver') && (forageRushCollected[candidate.id] ?? 0) > Date.now()) continue
      const point = anchors[anchor]
      const distance = Math.hypot(livePlayerPosition.x - point[0], livePlayerPosition.z - point[2])
      const miningTarget = candidate.id.startsWith('Mine') || candidate.id.startsWith('RushOre')
      const quickForageTarget = candidate.id.startsWith('forage:')
      const retainingHeldTarget = Boolean(heldMiningTarget && candidate.id === previous.current)
      const allowedReach = retainingHeldTarget ? candidate.reach + .8 : candidate.reach
      if (distance > allowedReach) continue
      let score = distance
      const eventTarget = candidate.id.startsWith('FarmRush') || candidate.id.startsWith('ForageRush')
      if (shiftLocked && !quickForageTarget || eventTarget || miningTarget) {
        const projected = new THREE.Vector3(point[0], point[1] + (candidate.lift ?? 0.45), point[2]).project(camera)
        const intersectingOre = miningTarget && distance <= 1.05
        if (!intersectingOre && (projected.z < -1 || projected.z > 1)) continue
        const centerDistance = Math.hypot(projected.x, projected.y)
        const centerLimit = miningTarget
          ? retainingHeldTarget ? .58 : intersectingOre ? .62 : .4
          : candidate.id.startsWith('FarmRushCell') ? .4
            : candidate.id.startsWith('ForageRush') ? .85
              : eventTarget ? .38 : .34
        if (!intersectingOre && centerDistance > centerLimit) continue
        if (miningTarget && !retainingHeldTarget && !intersectingOre) {
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
        score = (intersectingOre ? distance * .16 : centerDistance * 18 + distance * .08)
      }
      if (candidate.id === previous.current) score -= retainingHeldTarget ? 100 : .12
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
        : ({ shop: 'NpcShop', stocks: 'NpcStocks', enhance: 'LabelEnhance', 'forage-shop': 'NpcForageShop', 'forage-sell': 'NpcForageBuyer', 'farm-shop': 'NpcFarmShop', 'produce-shop': 'NpcProduceBuyer', 'food-shop': 'NpcFoodBuyer', 'mine-shop': 'NpcMineShop', 'ore-shop': 'NpcOreBuyer', 'secret-npc': zone === 'hub' ? '' : `SecretSite${secretSiteForRound(zone, roundNumber, sessionSeed)}` } as Record<string, string>)[prompt.id] ?? prompt.id
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

function MiningFeedback() {
  const prompt = useGameStore((state) => state.prompt)
  const progress = useGameStore((state) => state.interactionProgress)
  const anchors = useGameStore((state) => state.anchors)
  const sessionSeed = useGameStore((state) => state.sessionSeed)
  const mineGenerations = useGameStore((state) => state.mineGenerations)
  const rushNodes = useGameStore((state) => state.rushNodes)
  const milestone = useGameStore((state) => state.minigameMilestone)
  const id = prompt?.id ?? ''
  const point = anchors[id]
  if (!point || progress <= 0 || (!id.startsWith('MineOre') && !id.startsWith('RushOre'))) return null
  const kind = id.startsWith('RushOre')
    ? miningRushOre(milestone, id, rushNodes[id]?.generation ?? 0)
    : oreKindAtDepth(id, point[2], mineGenerations[id] ?? 0, sessionSeed)
  return <group position={[point[0], point[1] + .52, point[2]]}>
    {Array.from({ length: 7 }, (_, index) => {
      const cycle = (progress * 3.2 + index * .143) % 1
      const angle = index * 2.399963 + progress * 2.2
      const radius = .12 + cycle * .62
      return <mesh key={index} position={[Math.cos(angle) * radius, .08 + cycle * .56, Math.sin(angle) * radius]} rotation={[cycle * 4, angle, cycle * 2]} scale={.035 + (1 - cycle) * .05}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={ORE_COLORS[kind]} roughness={.62} transparent opacity={(1 - cycle) * .86} depthWrite={false} />
      </mesh>
    })}
  </group>
}

function clampedLabelPosition(element: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }) {
  const projected = new THREE.Vector3()
  element.getWorldPosition(projected)
  projected.project(camera)
  if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > .96 || Math.abs(projected.y) > .9) return [-10000, -10000] as [number, number]
  const x = (projected.x * .5 + .5) * size.width
  const y = (projected.y * -.5 + .5) * size.height
  return [THREE.MathUtils.clamp(x, 84, size.width - 84), THREE.MathUtils.clamp(y, 24, size.height - 24)] as [number, number]
}

function TutorialWorldMarker() {
  const active = useGameStore((state) => state.tutorialActive)
  const step = useGameStore((state) => state.tutorialStep)
  const anchors = useGameStore((state) => state.anchors)
  const inventory = useGameStore((state) => state.inventory)
  const claimedFarms = useGameStore((state) => state.claimedFarms)
  const language = useGameStore((state) => state.language)
  const playerPosition = useGameStore((state) => state.playerPosition)
  const sessionSeed = useGameStore((state) => state.sessionSeed)
  const mineGenerations = useGameStore((state) => state.mineGenerations)
  if (!active || step < 2 || step > 10) return null
  let key: string | undefined
  if (step === 2) key = anchors.NpcShop ? 'NpcShop' : 'Shop'
  const nearest = (ids: string[]) => ids.filter((id) => anchors[id]).sort((a, b) => Math.hypot(anchors[a][0] - playerPosition[0], anchors[a][2] - playerPosition[2]) - Math.hypot(anchors[b][0] - playerPosition[0], anchors[b][2] - playerPosition[2]))[0]
  if (step === 3) key = (inventory['worn-pickaxe'] ?? 0) <= 0
    ? (anchors.NpcMineShop ? 'NpcMineShop' : 'MineShop')
    : Object.keys(inventory).some((id) => id.endsWith('-ore') && (inventory[id as ItemId] ?? 0) > 0)
      ? (anchors.NpcOreBuyer ? 'NpcOreBuyer' : 'OreBuyer')
      : nearest(Object.keys(anchors).filter((id) => id.startsWith('MineOre') && canMineOre('worn-pickaxe', oreKindAtDepth(id, anchors[id][2], mineGenerations[id] ?? 0, sessionSeed))))
  if (step === 4) key = (inventory.basket ?? 0) <= 0
    ? (anchors.NpcForageShop ? 'NpcForageShop' : 'ForageShop')
    : (inventory.apple ?? 0) + (inventory.orange ?? 0) > 0
      ? (anchors.NpcForageBuyer ? 'NpcForageBuyer' : 'ForageBuyer')
      : nearest(Object.keys(anchors).filter((id) => id.startsWith('ForageApple') || id.startsWith('ForageOrange')))
  const ownedFarm = claimedFarms[0]
  const setupReady = (inventory['wheat-seeds'] ?? 0) > 0 && (inventory['water-can'] ?? 0) > 0 && (inventory.furnace ?? 0) > 0
  if (step === 5) key = ownedFarm === undefined
    ? nearest(Object.keys(anchors).filter((id) => id.startsWith('FarmClaim')))
    : !setupReady
      ? (anchors.NpcFarmShop ? 'NpcFarmShop' : 'FarmShop')
      : anchors[`FarmPlot${ownedFarm}`] ? `FarmPlot${ownedFarm}` : `FarmClaim${ownedFarm}`
  if (step === 6 && ownedFarm !== undefined) key = anchors[`FarmCell${ownedFarm}_27`] ? `FarmCell${ownedFarm}_27` : Object.keys(anchors).find((id) => id.startsWith(`FarmCell${ownedFarm}_`))
  if (step === 7 && ownedFarm !== undefined) key = `FurnacePad${ownedFarm}`
  if (step === 8) key = anchors.NpcFoodBuyer ? 'NpcFoodBuyer' : 'FoodBuyer'
  if (step === 9) key = anchors.NpcStocks ? 'NpcStocks' : 'Stocks'
  if (step === 10) key = anchors.LabelEnhance ? 'LabelEnhance' : 'Enhance'
  const point = key ? anchors[key] : null
  if (!point) return null
  const hasForage = (inventory.apple ?? 0) + (inventory.orange ?? 0) > 0
  const hasOre = Object.keys(inventory).some((id) => id.endsWith('-ore') && (inventory[id as ItemId] ?? 0) > 0)
  const label = language === 'ko'
    ? step === 2 ? '잡화점'
      : step === 3 ? ((inventory['worn-pickaxe'] ?? 0) <= 0 ? '채굴 도구' : hasOre ? '광석 판매' : '광석')
        : step === 4 ? ((inventory.basket ?? 0) <= 0 ? '채집 도구' : hasForage ? '채집품 판매' : '과일나무')
          : step === 5 ? (ownedFarm === undefined ? '빈 농장' : !setupReady ? '농장 상점' : '내 농장')
            : step === 6 ? '내 농장'
              : step === 7 ? '화로'
                : step === 8 ? '요리 판매'
                  : step === 9 ? '주식'
                    : '강화'
    : step === 2 ? 'GENERAL SHOP'
      : step === 3 ? ((inventory['worn-pickaxe'] ?? 0) <= 0 ? 'MINING SHOP' : hasOre ? 'ORE MARKET' : 'ORE')
        : step === 4 ? ((inventory.basket ?? 0) <= 0 ? 'FORAGE SHOP' : hasForage ? 'FORAGE MARKET' : 'FRUIT TREE')
          : step === 5 ? (ownedFarm === undefined ? 'OPEN FARM' : !setupReady ? 'FARM SHOP' : 'YOUR FARM')
            : step === 6 ? 'YOUR FARM'
              : step === 7 ? 'FURNACE'
                : step === 8 ? 'FOOD MARKET'
                  : step === 9 ? 'STOCKS'
                    : 'UPGRADE'
  return <group position={[point[0], point[1] + .04, point[2]]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[.58, .76, 40]} />
      <meshBasicMaterial color="#efc66b" transparent opacity={.78} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
    <Html position={[0, 2.35, 0]} center calculatePosition={clampedTutorialPosition} zIndexRange={[47, 46]} style={{ pointerEvents: 'none' }}>
      <span className="tutorial-world-marker">{label}</span>
    </Html>
  </group>
}

function clampedTutorialPosition(element: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }) {
  const projected = new THREE.Vector3()
  element.getWorldPosition(projected)
  projected.project(camera)
  if (projected.z > 1) { projected.x *= -1; projected.y *= -1 }
  const x = (projected.x * .5 + .5) * size.width
  const y = (projected.y * -.5 + .5) * size.height
  return [THREE.MathUtils.clamp(x, 70, size.width - 70), THREE.MathUtils.clamp(y, 46, size.height - 84)] as [number, number]
}

function WorldLabels() {
  const zone = useGameStore((state) => state.zone)
  const language = useGameStore((state) => state.language)
  const anchors = useGameStore((state) => state.anchors)
  const claimedFarms = useGameStore((state) => state.claimedFarms)
  const sharedFarmOnline = useGameStore((state) => state.sharedFarmOnline)
  const tutorialActive = useGameStore((state) => state.tutorialActive)
  const sharedFarmSelfId = useGameStore((state) => state.sharedFarmSelfId)
  const farmOwners = useGameStore((state) => state.farmOwners)
  const ownedFarms = sharedFarmOnline && !tutorialActive ? Object.keys(farmOwners).map(Number).filter((farm) => farmOwners[farm] === sharedFarmSelfId) : claimedFarms
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
        { key: 'shop', text: 'GENERAL SHOP', point: anchors.LabelShop ?? anchors.Shop, lift: 3.25 },
        { key: 'stocks', text: 'STOCKS', point: anchors.LabelStocks ?? anchors.Stocks, lift: 3.25 },
        { key: 'enhance', text: 'UPGRADE', point: anchors.LabelEnhance, lift: 2.45 },
      ] : zone === 'farm' ? [
        { key: 'home', text: 'HOME', point: anchors.Home, lift: 5.75 },
        ...ownedFarms.map((farm) => ({ key: `owned-farm-${farm}`, text: 'YOUR FARM', point: anchors[`FarmPlot${farm}`] ?? anchors.FarmPlot, lift: 2.2 })),
        { key: 'farm-shop', text: 'FARM SHOP', point: anchors.LabelFarmShop ?? anchors.FarmShop, lift: 3.25 },
        { key: 'produce', text: 'CROP MARKET', point: anchors.LabelProduceBuyer ?? anchors.ProduceBuyer, lift: 3.25 },
        { key: 'food', text: 'FOOD MARKET', point: anchors.LabelFoodBuyer ?? anchors.FoodBuyer, lift: 3.25 },
      ] : zone === 'mine' ? [
        { key: 'home', text: 'HOME', point: anchors.Home, lift: 5.75 },
        { key: 'mine-shop', text: 'MINING SHOP', point: anchors.LabelMineShop ?? anchors.MineShop, lift: 3.25 },
        { key: 'ore', text: 'ORE MARKET', point: anchors.LabelOreBuyer ?? anchors.OreBuyer, lift: 3.25 },
      ] : [
        { key: 'home', text: 'HOME', point: anchors.Home, lift: 5.75 },
        { key: 'forage-shop', text: 'FORAGE SHOP', point: anchors.LabelForageShop ?? anchors.ForageShop, lift: 3.25 },
        { key: 'forage-market', text: 'FORAGE MARKET', point: anchors.LabelForageBuyer ?? anchors.ForageBuyer, lift: 3.25 },
      ]
  return <>{labels.map(({ key, text, point, lift }) => point && (
    <Html key={key} position={[point[0], point[1] + lift, point[2]]} center calculatePosition={clampedLabelPosition} zIndexRange={key === 'assigned-plot' || key === 'assigned-bay' ? [48, 48] : [45, 44]} style={{ pointerEvents: 'none' }}>
      <span className={`world-label ${key}`}>{uiText(language, text)}</span>
    </Html>
  ))}</>
}

function LoadingMark() {
  const setSceneReady = useGameStore((state) => state.setSceneReady)
  const language = useGameStore((state) => state.language)
  const guideOpen = useGameStore((state) => state.guideOpen)
  useEffect(() => { setSceneReady(false) }, [setSceneReady])
  if (guideOpen) return null
  return (
    <group position={[0, .35, 0]}>
      <mesh rotation={[0, 0, Math.PI / 4]}>
        <octahedronGeometry args={[0.62, 0]} />
        <meshStandardMaterial color="#e6bd69" roughness={0.62} emissive="#6f4e22" emissiveIntensity={.4} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.05, .045, 8, 48]} />
        <meshBasicMaterial color="#ead18d" transparent opacity={.72} />
      </mesh>
      <pointLight color="#efbd79" intensity={4} distance={8} />
      <Html center position={[0, -1.28, 0]} style={{ pointerEvents: 'none' }}><span className="loading-label">{uiText(language, 'LOADING')}</span></Html>
    </group>
  )
}

function SceneAssetWarmup() {
  const zone = useGameStore((state) => state.zone)
  const sessionStarted = useGameStore((state) => state.sessionStarted)
  useEffect(() => {
    // Stage travel scenes only while everyone is waiting in the lobby. GPU
    // uploads during an active run caused the periodic forward skips players
    // reported even when the current scene itself was rendering smoothly.
    const remaining = zone === 'hub' && !sessionStarted
      ? (['forage', 'farm', 'mine'] as const).map((id) => SCENES[id])
      : []
    let cancelled = false
    let idleId = 0
    let timer = 0
    const idleApi = window as unknown as {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (id: number) => void
    }
    const schedule = () => {
      if (cancelled || !remaining.length) return
      const loadNext = () => {
        if (cancelled) return
        const url = remaining.shift()
        if (url) useGLTF.preload(url)
        timer = window.setTimeout(schedule, 8_000)
      }
      if (idleApi.requestIdleCallback) idleId = idleApi.requestIdleCallback(loadNext, { timeout: 12_000 })
      else timer = window.setTimeout(loadNext, 8_000)
    }
    timer = window.setTimeout(schedule, zone === 'hub' ? 6_000 : 3_000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (idleId) idleApi.cancelIdleCallback?.(idleId)
    }
  }, [sessionStarted, zone])
  return null
}

export function GameWorld() {
  const graphicsMode = useGameStore((state) => state.graphicsMode)
  const zone = useGameStore((state) => state.zone)
  const minigameOpen = useGameStore((state) => state.minigameOpen)
  const minigameKind = useGameStore((state) => state.minigameKind)
  const [autoReduced, setAutoReduced] = useState(false)
  // Auto quality changes render scale in-place through AdaptiveRenderScale.
  // Do not replace the WebGL canvas when an FPS sample crosses a threshold:
  // destroying and recreating the context caused a visible green/loading flash
  // and could oscillate on browsers whose RAF cadence sits near the boundary.
  const low = graphicsMode === 'low'
  return (
    <Canvas key={low ? 'low-renderer' : 'full-renderer'} shadows={low ? false : 'basic'} dpr={[.85, 1.15]} camera={{ fov: 48, near: 0.1, far: 320, position: [0, 4.2, 20.2] }} gl={{ antialias: !low, alpha: false, stencil: false, powerPreference: 'high-performance' }}>
      <AdaptiveRenderScale rendererLow={low} onReduced={setAutoReduced} />
      <RendererQuality />
      <SceneAssetWarmup />
      <MaterialEnvironment />
      <SceneLighting reduced={autoReduced} />
      <WeatherEffect />
      {graphicsMode === 'high' && (zone === 'mine' || minigameOpen && minigameKind === 'mining') && <HighPostProcessing />}
      <Suspense fallback={<LoadingMark />}>
        <EnvironmentScene reduced={autoReduced} />
        <Player />
        <MultiplayerPresence />
        <InteractiveWorldObjects />
        <InteractionTargeter />
        <InteractionFocus />
        <MiningFeedback />
        <TutorialWorldMarker />
        <WorldLabels />
      </Suspense>
    </Canvas>
  )
}

useGLTF.preload('/assets/3d/characters/ranger.glb')
useGLTF.preload('/assets/3d/characters/shopkeeper.glb')
useGLTF.preload('/assets/3d/characters/merchant.glb')
useGLTF.preload('/assets/3d/animations/standard.glb')
useGLTF.preload('/assets/3d/animations/tool-actions.glb?v=3')
useGLTF.preload('/assets/3d/tools/pickaxe.glb?v=5')
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
