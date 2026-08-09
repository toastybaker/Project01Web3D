import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { NodeIO } from '@gltf-transform/core'
import { EXTMeshGPUInstancing, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions'
import { dedup, instance, join, meshopt, textureCompress } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import { createCanvas, ImageData as CanvasImageData } from '@napi-rs/canvas'
import sharp from 'sharp'
import { MINE_NODE_SITES } from '../shared/mine-nodes.js'

class NodeFileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = value
      this.onloadend?.({ target: this })
    })
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`
      this.onloadend?.({ target: this })
    })
  }
}

globalThis.FileReader = NodeFileReader
globalThis.ImageData = CanvasImageData
globalThis.OffscreenCanvas = class NodeOffscreenCanvas {
  constructor(width, height) {
    this.canvas = createCanvas(width, height)
  }

  get width() { return this.canvas.width }
  set width(value) { this.canvas.width = value }
  get height() { return this.canvas.height }
  set height(value) { this.canvas.height = value }
  getContext(type, options) { return this.canvas.getContext(type, options) }
  async convertToBlob({ type = 'image/png' } = {}) {
    return new Blob([this.canvas.toBuffer(type)], { type })
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'public', 'assets', '3d', 'scenes')
await mkdir(out, { recursive: true })

const palette = {
  moss: 0x789a55,
  fern: 0x3f5a32,
  darkFern: 0x2f482c,
  bark: 0x604430,
  barkLight: 0x76563c,
  soil: 0x765138,
  path: 0x876c4b,
  stone: 0x94826a,
  stoneDark: 0x6e665d,
  parchment: 0xf3e4bd,
  forage: 0x92b85b,
  farm: 0xd89b4a,
  mine: 0x6e91a7,
  fruit: 0xd6533f,
  fruitGold: 0xefa532,
}

function material(name, color, options = {}) {
  const value = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.9,
    metalness: options.metalness ?? 0,
    flatShading: options.flatShading ?? true,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
    vertexColors: options.vertexColors ?? false,
    depthWrite: options.depthWrite ?? true,
  })
  value.name = name
  return value
}

const mats = {
  ground: material('Ground', palette.moss, { flatShading: false, vertexColors: true }),
  path: material('Path', palette.path),
  bark: material('Bark', palette.bark),
  barkLight: material('Bark Light', palette.barkLight),
  leaf: material('Leaf', palette.fern),
  leafDark: material('Leaf Dark', palette.darkFern),
  leafFresh: material('Fresh Green Leaf', 0x5f8243),
  leafSage: material('Sage Green Leaf', 0x769552),
  leafDeep: material('Deep Green Leaf', 0x3f673b),
  soil: material('Soil', palette.soil),
  soilFurrow: material('Tilled Soil Furrow', 0x533a2c),
  wetSoil: material('Watered Soil', 0x5e4232, { roughness: 0.96, flatShading: false }),
  stone: material('Warm Stone', palette.stone),
  stoneDark: material('Dark Stone', palette.stoneDark),
  mineGround: material('Mine Ground', 0x77736b, { flatShading: false }),
  minePath: material('Mine Path', 0x887865, { flatShading: false }),
  mineWall: material('Mine Wall', 0x6f6b64, { flatShading: false }),
  mineStrata: material('Mine Strata', 0x57534e, { flatShading: false }),
  stoneOre: material('Stone Ore Vein', 0xb6aa8d, { roughness: 0.72 }),
  crystal: material('Blue Crystal', 0x5f91a4, { roughness: 0.55 }),
  richOre: material('Rich Ore', 0xb78246, { roughness: 0.62, metalness: 0.1 }),
  caveWater: material('Cave Water', 0x527b82, { transparent: true, opacity: 0.76, roughness: 0.28, side: THREE.DoubleSide, flatShading: false }),
  parchment: material('Parchment', palette.parchment),
  glassForage: material('Forage Portal', palette.forage, { transparent: true, opacity: 0.34, depthWrite: false, roughness: 0.38, side: THREE.DoubleSide, flatShading: false }),
  glassFarm: material('Farm Portal', palette.farm, { transparent: true, opacity: 0.32, depthWrite: false, roughness: 0.38, side: THREE.DoubleSide, flatShading: false }),
  glassMine: material('Mine Portal', palette.mine, { transparent: true, opacity: 0.33, depthWrite: false, roughness: 0.38, side: THREE.DoubleSide, flatShading: false }),
  glassHome: material('Home Portal', palette.parchment, { transparent: true, opacity: 0.31, depthWrite: false, roughness: 0.38, side: THREE.DoubleSide, flatShading: false }),
  fruit: material('Orchard Fruit', palette.fruit),
  fruitGold: material('Golden Orchard Fruit', palette.fruitGold),
  furnaceFire: material('Furnace Fire', 0xe28a32, { roughness: 0.42 }),
  furnaceSteam: material('Furnace Steam', 0xd9d3c5, { transparent: true, opacity: 0.34, roughness: 1 }),
}
mats.furnaceFire.emissive = new THREE.Color(0xd26721)
mats.furnaceFire.emissiveIntensity = 1.4

const natureRoot = path.join(root, 'source-assets', '3d', 'nature-glb')
const fantasyPropsRoot = path.join(root, 'source-assets', '3d', 'quaternius-fantasy-props')
const simpleNatureRoot = path.join(root, 'source-assets', '3d', 'quaternius-simple-nature')
const farmBuildingsRoot = path.join(root, 'source-assets', '3d', 'quaternius-farm-buildings')
const natureIO = new NodeIO()
const textureCache = new Map()

async function dataTexture(texture, colorSpace = THREE.SRGBColorSpace) {
  if (!texture) return null
  const cacheKey = `${texture.getName() || String(texture.getImage()?.byteLength ?? 0)}:${colorSpace}`
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey)
  const image = texture.getImage()
  if (!image) return null
  let decoded
  try {
    decoded = await sharp(image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
  } catch (error) {
    // A few legacy nature GLBs advertise compressed normal payloads as PNG.
    // Their base color remains valid; omit only the malformed auxiliary map.
    if (colorSpace === THREE.SRGBColorSpace) throw error
    return null
  }
  const value = new THREE.DataTexture(new Uint8Array(decoded.data), decoded.info.width, decoded.info.height, THREE.RGBAFormat)
  value.name = cacheKey
  value.flipY = false
  value.colorSpace = colorSpace
  value.wrapS = THREE.RepeatWrapping
  value.wrapT = THREE.RepeatWrapping
  value.needsUpdate = true
  textureCache.set(cacheKey, value)
  return value
}

async function loadOfflineAsset(name, sourcePath = path.join(natureRoot, `${name}.glb`)) {
  const document = await natureIO.read(sourcePath)
  const materialMap = new Map()
  for (const sourceMaterial of document.getRoot().listMaterials()) {
    const sourceTexture = await dataTexture(sourceMaterial.getBaseColorTexture())
    const sourceFactor = sourceMaterial.getBaseColorFactor()
    const value = new THREE.MeshStandardMaterial({
      name: sourceMaterial.getName(),
      color: new THREE.Color(sourceFactor[0], sourceFactor[1], sourceFactor[2]),
      opacity: sourceFactor[3],
      map: sourceTexture,
      roughness: sourceMaterial.getRoughnessFactor(),
      metalness: sourceMaterial.getMetallicFactor(),
      transparent: sourceMaterial.getAlphaMode() === 'BLEND',
      alphaTest: sourceMaterial.getAlphaMode() === 'MASK' ? sourceMaterial.getAlphaCutoff() : 0,
      side: /Leaves|Grass|Flowers|Bush/.test(sourceMaterial.getName()) ? THREE.DoubleSide : THREE.FrontSide,
    })
    materialMap.set(sourceMaterial, value)
  }

  const buildNode = (sourceNode) => {
    const group = new THREE.Group()
    group.name = sourceNode.getName() || name
    group.position.fromArray(sourceNode.getTranslation())
    group.quaternion.fromArray(sourceNode.getRotation())
    group.scale.fromArray(sourceNode.getScale())
    const sourceMesh = sourceNode.getMesh()
    if (sourceMesh) {
      sourceMesh.listPrimitives().forEach((primitive, primitiveIndex) => {
        const geometry = new THREE.BufferGeometry()
        const semantics = [
          ['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2], ['COLOR_0', 'color', 4],
        ]
        semantics.forEach(([semantic, attributeName, itemSize]) => {
          const accessor = primitive.getAttribute(semantic)
          if (accessor) geometry.setAttribute(attributeName, new THREE.BufferAttribute(accessor.getArray(), itemSize, accessor.getNormalized()))
        })
        const indices = primitive.getIndices()
        if (indices) geometry.setIndex(new THREE.BufferAttribute(indices.getArray(), 1))
        if (!geometry.attributes.normal) geometry.computeVertexNormals()
        geometry.computeBoundingBox()
        geometry.computeBoundingSphere()
        const child = mesh(geometry, materialMap.get(primitive.getMaterial()) ?? mats.leaf, `${name} ${primitiveIndex + 1}`)
        group.add(child)
      })
    }
    sourceNode.listChildren().forEach((child) => group.add(buildNode(child)))
    return group
  }

  const scene = new THREE.Group()
  scene.name = name
  const sourceScene = document.getRoot().listScenes()[0]
  sourceScene.listChildren().forEach((child) => scene.add(buildNode(child)))
  scene.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(scene)
  const center = bounds.getCenter(new THREE.Vector3())
  scene.position.set(-center.x, -bounds.min.y, -center.z)
  return scene
}

async function loadOfflineObjAsset(name, sourcePath) {
  const value = new OBJLoader().parse(await readFile(sourcePath, 'utf8'))
  value.name = name
  value.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(value)
  const center = bounds.getCenter(new THREE.Vector3())
  value.position.set(-center.x, -bounds.min.y, -center.z)
  value.traverse((object) => {
    if (!object.isMesh) return
    if (!object.geometry.attributes.normal) object.geometry.computeVertexNormals()
    // OBJ faces repeat the same vertex data per triangle. Welding identical
    // attributes keeps the exact silhouette, normals, and UV seams while
    // cutting the cost of every instanced tree and rock in the browser.
    object.geometry = mergeVertices(object.geometry, 1e-4)
    object.material = (Array.isArray(object.material) ? object.material : [object.material]).map((sourceMaterial) => (
      /lea(?:f|ves)/i.test(sourceMaterial.name) ? mats.leafFresh : mats.bark
    ))
  })
  return value
}

async function loadOfflineObjWithMtl(name, sourcePath, materialPath) {
  const materialCreator = new MTLLoader().parse(await readFile(materialPath, 'utf8'), `${path.dirname(materialPath)}${path.sep}`)
  materialCreator.preload()
  const value = new OBJLoader().setMaterials(materialCreator).parse(await readFile(sourcePath, 'utf8'))
  value.name = name
  value.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(value)
  const center = bounds.getCenter(new THREE.Vector3())
  value.position.set(-center.x, -bounds.min.y, -center.z)
  value.traverse((object) => {
    if (!object.isMesh) return
    if (!object.geometry.attributes.normal) object.geometry.computeVertexNormals()
    object.geometry = mergeVertices(object.geometry, 1e-4)
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material]
    const converted = sourceMaterials.map((sourceMaterial) => {
      const convertedMaterial = material(sourceMaterial.name || name, sourceMaterial.color?.getHex?.() ?? 0x777777, { flatShading: true })
      convertedMaterial.color.copy(sourceMaterial.color)
      return convertedMaterial
    })
    object.material = Array.isArray(object.material) ? converted : converted[0]
  })
  return value
}

const natureModels = {}
for (const name of [
  'BirchTree_1', 'BirchTree_2', 'BirchTree_3', 'BirchTree_4', 'BirchTree_5',
  'MapleTree_1', 'MapleTree_2', 'MapleTree_3', 'MapleTree_4', 'MapleTree_5',
  'Bush', 'Bush_Large', 'Bush_Small', 'Grass_Large_Extruded', 'Flower_3_Clump',
]) natureModels[name] = await loadOfflineAsset(name)
natureModels.NormalTree_5 = await loadOfflineObjAsset(
  'NormalTree_5',
  path.join(root, 'source-assets', '3d', 'quaternius-nature', 'OBJ', 'NormalTree_5.obj'),
)

const propModels = {}
for (const name of [
  'Stall_Empty', 'Stall_Cart_Empty',
  'Barrel', 'Barrel_Apples',
  'FarmCrate_Apple', 'FarmCrate_Carrot', 'FarmCrate_Empty',
]) propModels[name] = await loadOfflineAsset(name, path.join(fantasyPropsRoot, `${name}.gltf`))

const rockModels = {}
for (const name of ['Rock1', 'Rock2', 'Rock3']) {
  const rock = await loadOfflineObjAsset(name, path.join(simpleNatureRoot, `${name}.obj`))
  rock.traverse((object) => {
    if (object.isMesh) object.material = mats.mineWall
  })
  rockModels[name] = rock
}

const farmBuildingModels = {}
for (const name of ['Barn', 'Windmill']) {
  farmBuildingModels[name] = await loadOfflineObjWithMtl(
    name,
    path.join(farmBuildingsRoot, `${name}.obj`),
    path.join(farmBuildingsRoot, `${name}.mtl`),
  )
}

function authoredRock(name, position, scale = [1, 1, 1], rotation = [0, 0, 0], rockMaterial = mats.mineWall) {
  const group = rockModels[name].clone(true)
  group.name = `${name} Authored Rock`
  group.position.set(...position)
  group.scale.set(...scale)
  group.rotation.set(...rotation)
  group.traverse((object) => {
    if (!object.isMesh) return
    object.material = rockMaterial
    object.castShadow = true
    object.receiveShadow = true
  })
  return group
}

function farmBuildingAsset(name, position, scale = 1, rotation = 0) {
  const group = farmBuildingModels[name].clone(true)
  group.name = `${name} Farm Landmark`
  group.position.set(...position)
  group.scale.setScalar(scale)
  group.rotation.y = rotation
  group.traverse((object) => {
    if (!object.isMesh) return
    object.castShadow = true
    object.receiveShadow = true
  })
  return group
}

function propAsset(name, position = [0, 0, 0], scale = 1, rotation = 0, clothTint = null) {
  const group = propModels[name].clone(true)
  group.name = name
  group.position.set(...position)
  group.scale.setScalar(scale)
  group.rotation.y = rotation
  const materialCopies = new Map()
  group.traverse((object) => {
    if (!object.isMesh) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    const copies = materials.map((sourceMaterial) => {
      if (materialCopies.has(sourceMaterial)) return materialCopies.get(sourceMaterial)
      const copy = sourceMaterial.clone()
      if (clothTint && /Banner|Cloth/i.test(copy.name)) copy.color.multiply(clothTint)
      materialCopies.set(sourceMaterial, copy)
      return copy
    })
    object.material = Array.isArray(object.material) ? copies : copies[0]
    object.castShadow = true
    object.receiveShadow = true
  })
  return group
}

function natureAsset(name, position, scale = 1, rotation = 0, colliderRadius = 0) {
  const group = natureModels[name].clone(true)
  group.name = name
  group.position.set(...position)
  group.scale.setScalar(scale)
  group.rotation.y = rotation
  if (colliderRadius > 0) group.userData.colliderRadius = colliderRadius
  group.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true
      object.receiveShadow = true
    }
  })
  return group
}

function natureTree(x, z, scale, rotation, heightAt, variant = 0) {
  const names = ['BirchTree_1', 'MapleTree_2', 'BirchTree_3', 'MapleTree_4', 'BirchTree_5', 'MapleTree_1', 'MapleTree_3', 'BirchTree_2', 'MapleTree_5', 'BirchTree_4']
  const value = natureAsset(names[variant % names.length], [x, heightAt(x, z), z], scale, rotation, 0.32)
  if (variant % 10 < 6) {
    const green = [mats.leafFresh, mats.leafSage, mats.leafDeep][variant % 3]
    value.traverse((object) => {
      if (object.isMesh && /lea(?:f|ves)/i.test(object.material?.name ?? '')) object.material = green
    })
  }
  value.name = names[variant % names.length].startsWith('Maple') ? 'Woodland Maple' : 'Woodland Birch'
  return value
}

function broadleafTree(x, z, scale, rotation, heightAt, variant = 0) {
  const value = natureAsset('NormalTree_5', [x, heightAt(x, z), z], scale, rotation, 0.34)
  const green = [mats.leafFresh, mats.leafSage, mats.leafDeep][variant % 3]
  value.traverse((object) => {
    if (!object.isMesh) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    object.material = materials.map((sourceMaterial) => /lea(?:f|ves)/i.test(sourceMaterial.name) ? green : mats.bark)
  })
  value.name = 'Woodland Broadleaf'
  return value
}

function natureBush(x, z, scale, rotation, heightAt, variant = 0) {
  // The source-kit bushes read as bright cubes beside the softer tree crowns.
  // Reuse the established three-lobed shrub silhouette instead.
  const value = shrub(x, z, scale * .72, variant % 5 === 4, heightAt(x, z))
  value.rotation.y = rotation
  value.name = 'Woodland Understory'
  return value
}

function natureGrass(x, z, scale, rotation, heightAt) {
  const value = natureAsset('Grass_Large_Extruded', [x, heightAt(x, z) + 0.015, z], scale, rotation)
  value.name = 'Ground Grass Clump'
  return value
}

function natureFlowers(x, z, scale, rotation, heightAt) {
  const value = natureAsset('Flower_3_Clump', [x, heightAt(x, z) + 0.02, z], scale, rotation)
  value.name = 'Woodland Flower Clump'
  return value
}

// These small authored details repeat hundreds of times. Reusing the source
// geometry keeps the exported GLBs responsive without changing their layout.
const appleFruitGeometries = [new THREE.IcosahedronGeometry(0.16, 1), new THREE.IcosahedronGeometry(0.175, 1)]
const berryGeometries = [new THREE.IcosahedronGeometry(0.09, 1), new THREE.IcosahedronGeometry(0.105, 1)]
const oreRockGeometry = new THREE.DodecahedronGeometry(0.72, 1)
const oreVeinGeometry = new THREE.OctahedronGeometry(0.15, 0)
const quarryStoneGeometry = new THREE.DodecahedronGeometry(1, 1)
const farmWetSoilGeometry = new RoundedBoxGeometry(1.18, 0.025, 1.18, 3, 0.08)
const rushWetSoilGeometry = new RoundedBoxGeometry(1.96, 0.025, 1.96, 3, 0.1)
const berryClusterGeometry = mergeGeometries(Array.from({ length: 9 }, (_, index) => {
  const angle = (index / 9) * Math.PI * 2
  return berryGeometries[index % 2].clone().translate(
    Math.cos(angle) * (0.36 + (index % 3) * 0.12),
    0.42 + (index % 3) * 0.16,
    Math.sin(angle) * (0.34 + ((index + 1) % 3) * 0.1),
  )
}))
const oreClusterGeometry = mergeGeometries([
  oreRockGeometry.clone().scale(1.25, 0.88, 1.05).rotateX(0.08).translate(0, 0.56, 0),
  oreVeinGeometry.clone().translate(-0.34, 0.68, 0.58),
  oreVeinGeometry.clone().scale(1.18, 1.18, 1.18).rotateX(0.31).rotateY(0.67).translate(0.22, 0.88, 0.58),
], true)

function fruitBirch(id, x, z, scale, rotation, heightAt, golden = false, variant = 0) {
  const group = natureTree(x, z, scale, rotation, heightAt, variant)
  group.name = golden ? 'Orange Grove Tree' : 'Apple Orchard Tree'
  const green = [mats.leafFresh, mats.leafSage, mats.leafDeep][(variant + (golden ? 1 : 0)) % 3]
  group.traverse((object) => {
    if (object.isMesh && /lea(?:f|ves)/i.test(object.material?.name ?? '')) object.material = green
  })
  const fruitMaterial = golden ? mats.fruitGold : mats.fruit
  group.updateMatrixWorld(true)
  const height = Math.max(4.2, new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).y / scale)
  const crownCenter = height * 0.69
  const crownTop = height * 0.9
  const spread = Math.min(1.55, height * 0.19)
  const fruitOffsets = [
    [-0.88 * spread, crownCenter - 0.96, 0.76 * spread],
    [0.64 * spread, crownCenter - 0.78, 0.82 * spread],
    [0.92 * spread, crownCenter - 0.46, -0.34 * spread],
    [-0.18 * spread, crownTop - 0.12, -0.72 * spread],
    [-0.92 * spread, crownCenter + 0.2, -0.36 * spread],
  ]
  const fruitGeometry = mergeGeometries(fruitOffsets.map(([fx, fy, fz], index) => appleFruitGeometries[index % 2].clone().translate(fx, fy, fz)))
  const resourceGroup = new THREE.Group()
  resourceGroup.name = `Resource_${id}`
  resourceGroup.add(mesh(fruitGeometry, fruitMaterial, golden ? 'Woodland Oranges' : 'Woodland Apples'))
  group.add(resourceGroup)
  return group
}

function trufflePatch(id, x, z, rotation, heightAt) {
  const group = new THREE.Group()
  group.name = `Resource_${id}`
  group.position.set(x, heightAt(x, z), z)
  group.rotation.y = rotation
  const soil = mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.08, 9), mats.soil, 'Disturbed Forest Soil')
  soil.position.y = 0.03
  const truffle = mesh(new THREE.DodecahedronGeometry(0.28, 1), mats.bark, 'Rare Truffle')
  truffle.position.set(0.03, 0.19, 0)
  truffle.scale.set(1.18, 0.78, 1)
  group.add(soil, truffle)
  return group
}

function discoveryRelic(id, x, z, rotation, heightAt) {
  const group = new THREE.Group()
  group.name = `Resource_${id}`
  group.position.set(x, heightAt(x, z), z)
  group.rotation.y = rotation
  const stone = mesh(new THREE.DodecahedronGeometry(0.42, 1), mats.richOre, 'Fossil Stone')
  stone.position.y = 0.28
  stone.scale.set(1.2, 0.78, 0.52)
  stone.rotation.x = -0.2
  const fossil = mesh(new THREE.TorusGeometry(0.16, 0.045, 7, 16, Math.PI * 1.72), mats.parchment, 'Spiral Fossil')
  fossil.position.set(0, 0.31, 0.24)
  fossil.rotation.z = -0.4
  group.add(stone, fossil)
  return group
}

function berryBush(id, x, z, scale, rotation, heightAt, variant = 0) {
  const group = natureBush(x, z, scale, rotation, heightAt, variant)
  group.name = 'Wild Berry Bush'
  const berries = new THREE.Group()
  berries.name = `Resource_${id}`
  berries.add(mesh(berryClusterGeometry, mats.fruit, 'Ripe Berry Cluster'))
  group.add(berries)
  return group
}

function scatterCluster(scene, cx, cz, count, radius, heightAt, salt = 0, treeScale = 1) {
  for (let index = 0; index < count; index += 1) {
    const angle = seeded(index, salt + 1) * Math.PI * 2
    const distance = Math.sqrt(seeded(index, salt + 2)) * radius
    const x = cx + Math.cos(angle) * distance
    const z = cz + Math.sin(angle) * distance
    scene.add(natureTree(x, z, treeScale * (0.82 + seeded(index, salt + 3) * 0.5), seeded(index, salt + 4) * Math.PI * 2, heightAt, index + salt))
    if (index % 2 === 0) scene.add(natureGrass(x + 1.2, z - 0.7, 0.65 + seeded(index, salt + 5) * 0.55, angle, heightAt))
    if (index % 3 === 0) scene.add(natureFlowers(x - 1.1, z + 0.65, 0.38 + seeded(index, salt + 7) * 0.24, angle, heightAt))
  }
}

function mesh(geometry, mat, name) {
  const value = new THREE.Mesh(geometry, mat)
  value.name = name
  value.castShadow = true
  value.receiveShadow = true
  return value
}

function wateredSoilTile(name, x, y, z, rush) {
  const tile = mesh(rush ? rushWetSoilGeometry : farmWetSoilGeometry, mats.wetSoil, name)
  tile.position.set(x, y, z)
  tile.visible = false
  tile.castShadow = false
  return tile
}

const forageTrail = [[0, 22], [1, 12], [-2, 0], [-8, -16], [-3, -34], [5, -50], [2, -60], [0, -70], [-1, -84], [-7, -98], [-5, -112], [8, -132], [-2, -154], [10, -177], [2, -203]]
const farmParcels = [
  [-54, -16], [-18, -14], [19, -17], [55, -13],
  [-53, -50], [-17, -49], [20, -53], [56, -48],
]

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function trailCenterAt(z) {
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

function distanceToPolyline(x, z, points) {
  let closest = Infinity
  for (let index = 0; index < points.length - 1; index += 1) {
    const [ax, az] = points[index]
    const [bx, bz] = points[index + 1]
    const dx = bx - ax
    const dz = bz - az
    const lengthSquared = dx * dx + dz * dz
    const t = lengthSquared ? THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / lengthSquared, 0, 1) : 0
    closest = Math.min(closest, Math.hypot(x - (ax + dx * t), z - (az + dz * t)))
  }
  return closest
}

function forageGroundHeight(x, z) {
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

function terrain(radius = 34, heightAt = null, groundMaterial = mats.ground) {
  const terrainSegments = Math.max(120, Math.min(260, Math.ceil(radius * 1.1)))
  const geometry = heightAt ? new THREE.PlaneGeometry(radius * 2, radius * 2, terrainSegments, terrainSegments) : new THREE.CircleGeometry(radius, 80)
  geometry.rotateX(-Math.PI / 2)
  const positions = geometry.attributes.position
  const uvs = geometry.attributes.uv
  const colors = groundMaterial === mats.ground ? new Float32Array(positions.count * 3) : null
  const tint = new THREE.Color()
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i)
    const z = positions.getZ(i)
    const y = heightAt ? heightAt(x, z) : Math.min(1, Math.hypot(x, z) / (radius * 0.75)) * (Math.sin(x * 0.38) + Math.cos(z * 0.31)) * 0.12
    positions.setY(i, y)
    uvs.setXY(i, uvs.getX(i) * (heightAt ? radius / 6 : 7), uvs.getY(i) * (heightAt ? radius / 6 : 7))
    if (colors) {
      // Broad, low-frequency colour variation makes the rolling ground read at
      // play distance. It is deliberately stronger than the tiny texture grain,
      // which otherwise made every outdoor area look like one flat green sheet.
      const broad = Math.sin(x * .021 + z * .014) * .07 + Math.cos(z * .018 - x * .011) * .05
      const mottled = Math.sin((x + z) * .073) * .02
      const shade = 0.94 + broad + mottled
      tint.setRGB(shade * .95, shade * 1.035, shade * .92)
      colors[i * 3] = tint.r
      colors[i * 3 + 1] = tint.g
      colors[i * 3 + 2] = tint.b
    }
  }
  if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return mesh(geometry, groundMaterial, groundMaterial === mats.mineGround ? 'Mine Ground' : 'Woodland Ground')
}

function pathRibbon(points, width, name, heightAt = null, pathMaterial = mats.path) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, (heightAt?.(x, z) ?? 0) + 0.055, z)), false, 'catmullrom', 0.4)
  const samples = curve.getPoints(Math.max(24, Math.min(220, Math.ceil(curve.getLength() / 1.15))))
  const positions = []
  const uvs = []
  const indices = []
  for (let i = 0; i < samples.length; i += 1) {
    const current = samples[i]
    const previous = samples[Math.max(0, i - 1)]
    const next = samples[Math.min(samples.length - 1, i + 1)]
    const tangent = next.clone().sub(previous).normalize()
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(width * (0.48 + Math.sin(i * 1.7) * 0.035))
    for (const point of [current.clone().add(side), current.clone().sub(side)]) {
      if (heightAt) point.y = heightAt(point.x, point.z) + 0.065
      positions.push(point.x, point.y, point.z)
    }
    uvs.push(0, i / 4, 1, i / 4)
    if (i < samples.length - 1) {
      const n = i * 2
      indices.push(n, n + 2, n + 1, n + 2, n + 3, n + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return mesh(geometry, pathMaterial, name)
}

function beamBetween(a, b, radius = 0.13, mat = mats.bark) {
  const start = new THREE.Vector3(...a)
  const end = new THREE.Vector3(...b)
  const direction = end.clone().sub(start)
  const value = mesh(new THREE.CylinderGeometry(radius * 0.82, radius, direction.length(), 7), mat, 'Hewn Wood')
  value.position.copy(start.clone().add(end).multiplyScalar(0.5))
  value.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  return value
}

function tree(x, z, scale = 1, rotation = 0, dark = false, y = 0) {
  const group = new THREE.Group()
  group.name = 'Storybook Tree'
  group.position.set(x, y, z)
  group.rotation.y = rotation
  group.scale.setScalar(scale)
  group.userData.colliderRadius = 0.34
  const trunk = mesh(new THREE.CylinderGeometry(0.34, 0.6, 4.5, 7), mats.bark, 'Tree Trunk')
  trunk.position.y = 2.1
  trunk.rotation.z = 0.06
  group.add(trunk)
  group.add(beamBetween([0, 3.1, 0], [1.1, 4.3, 0.15], 0.2))
  group.add(beamBetween([0, 3.45, 0], [-0.9, 4.25, -0.1], 0.18))
  const canopyMaterial = dark ? mats.leafDark : mats.leaf
  const crowns = [
    [0, 5.15, 0, 1.75],
    [1.15, 4.95, 0.1, 1.25],
    [-1.1, 4.8, -0.15, 1.35],
    [0.15, 5.95, -0.15, 1.15],
  ]
  crowns.forEach(([cx, cy, cz, size], index) => {
    const crown = mesh(new THREE.DodecahedronGeometry(size, 1), canopyMaterial, `Canopy ${index + 1}`)
    crown.position.set(cx, cy, cz)
    crown.scale.y = 0.78
    crown.rotation.set(index * 0.3, index * 0.7, 0)
    group.add(crown)
  })
  return group
}

function shrub(x, z, scale = 1, dark = false, y = 0) {
  const group = new THREE.Group()
  group.name = 'Shrub Cluster'
  group.position.set(x, y, z)
  group.scale.setScalar(scale)
  const mat = dark ? mats.leafDark : mats.leaf
  ;[
    [-0.45, 0.5, 0, 0.65],
    [0.35, 0.55, 0.08, 0.72],
    [0, 0.72, -0.25, 0.66],
  ].forEach(([px, py, pz, size]) => {
    const part = mesh(new THREE.DodecahedronGeometry(size, 1), mat, 'Shrub')
    part.position.set(px, py, pz)
    part.scale.y = 0.68
    group.add(part)
  })
  return group
}

function fernPatch(x, z, scale = 1, rotation = 0) {
  const group = new THREE.Group()
  group.name = 'Fern Understory Patch'
  group.position.set(x, forageGroundHeight(x, z), z)
  group.rotation.y = rotation
  for (let index = 0; index < 7; index += 1) {
    const angle = (index / 7) * Math.PI * 2 + (index % 2) * 0.18
    const leaf = mesh(new THREE.SphereGeometry(0.5, 7, 5), mats.leaf, 'Broad Fern Frond')
    leaf.scale.set(0.38 * scale, 0.16 * scale, (0.72 + (index % 2) * 0.1) * scale)
    leaf.position.set(Math.sin(angle) * 0.34 * scale, 0.34 * scale, Math.cos(angle) * 0.34 * scale)
    leaf.rotation.set(-0.62, angle, 0)
    group.add(leaf)
  }
  return group
}

function fallenLog(x, z, length = 5.4, rotation = 0, heightAt = forageGroundHeight) {
  const group = new THREE.Group()
  group.name = 'Mossy Fallen Log Landmark'
  group.position.set(x, heightAt(x, z), z)
  group.rotation.y = rotation
  group.userData.colliderRadius = length * 0.42
  const trunk = mesh(new THREE.CylinderGeometry(0.42, 0.55, length, 9), mats.bark, 'Fallen Tree Trunk')
  trunk.position.y = 0.48
  trunk.rotation.z = Math.PI / 2
  trunk.rotation.y = 0.08
  const brokenEnd = mesh(new THREE.CylinderGeometry(0.26, 0.45, 0.7, 7), mats.barkLight, 'Broken Log End')
  brokenEnd.position.set(length * 0.52, 0.62, 0)
  brokenEnd.rotation.z = Math.PI / 2
  const moss = mesh(new THREE.SphereGeometry(0.55, 8, 5), mats.leaf, 'Moss on Log')
  moss.position.set(-0.6, 0.82, -0.08)
  moss.scale.set(2.4, 0.24, 0.68)
  group.add(trunk, brokenEnd, moss)
  return group
}

function rock(x, z, scale = 1, dark = false, y = 0) {
  const value = mesh(new THREE.DodecahedronGeometry(0.75, 1), dark ? mats.stoneDark : mats.stone, 'Ground Rock')
  value.position.set(x, y + 0.42 * scale, z)
  value.userData.colliderRadius = 0.62 * scale
  value.scale.set(1.2 * scale, 0.72 * scale, 0.9 * scale)
  value.rotation.set(0.12, x * 0.31 + z, 0.08)
  return value
}

function seeded(index, salt = 0) {
  const value = Math.sin((index + 1) * 91.733 + salt * 37.17) * 43758.5453
  return value - Math.floor(value)
}

function fruitTree(x, z, scale = 1, golden = false) {
  const group = tree(x, z, scale, seeded(Math.round(x * 9 + z * 13), 8) * Math.PI, false, forageGroundHeight(x, z))
  group.name = golden ? 'Golden Pear Tree' : 'Wild Apple Tree'
  const fruitMaterial = golden ? mats.fruitGold : mats.fruit
  ;[
    [-1.15, 4.55, 1.05], [0.85, 5.05, 1.15], [1.35, 4.35, -0.5], [-0.25, 5.75, -1.05], [-1.45, 4.82, -0.45], [0.3, 4.15, 1.35], [1.1, 5.42, 0.35], [-0.7, 4.22, -1.2],
  ].forEach(([fx, fy, fz], index) => {
    const fruit = mesh(new THREE.IcosahedronGeometry(0.23 + (index % 2) * 0.025, 1), fruitMaterial, golden ? 'Pear' : 'Apple')
    fruit.position.set(fx, fy, fz)
    group.add(fruit)
  })
  return group
}

function boulderFormation(x, z, scale = 1, rotation = 0, heightAt = forageGroundHeight) {
  const group = new THREE.Group()
  group.name = 'Natural Cliff Boulder'
  group.position.set(x, heightAt(x, z), z)
  group.rotation.y = rotation
  group.scale.setScalar(scale)
  group.userData.colliderRadius = 1.35 * scale
  ;[
    [-0.65, 0.65, 0, 1.15], [0.55, 0.82, 0.1, 1.35], [0, 1.55, -0.15, 1.05],
  ].forEach(([bx, by, bz, size], index) => {
    const stone = mesh(new THREE.DodecahedronGeometry(size, 1), index % 2 ? mats.stoneDark : mats.stone, 'Cliff Stone')
    stone.position.set(bx, by, bz)
    stone.scale.set(1.2, 0.82 + index * 0.1, 0.95)
    stone.rotation.set(index * 0.13, index * 0.61, index * 0.08)
    group.add(stone)
  })
  return group
}

function portalIcon(kind, colorMaterial) {
  const group = new THREE.Group()
  group.name = `${kind} Emblem`
  if (kind === 'Forage') {
    const cap = mesh(new THREE.SphereGeometry(0.52, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), colorMaterial, 'Mushroom Cap')
    cap.scale.y = 0.68
    const stem = mesh(new THREE.CylinderGeometry(0.18, 0.25, 0.65, 8), mats.parchment, 'Mushroom Stem')
    stem.position.y = -0.35
    group.add(cap, stem)
  } else if (kind === 'Farm') {
    const leafA = mesh(new THREE.SphereGeometry(0.46, 10, 8), colorMaterial, 'Leaf')
    leafA.scale.set(0.52, 1, 0.22)
    leafA.rotation.z = -0.72
    leafA.position.x = -0.22
    const leafB = leafA.clone()
    leafB.position.x = 0.22
    leafB.rotation.z = 0.72
    group.add(leafA, leafB, beamBetween([0, -0.7, 0], [0, 0.45, 0], 0.07, mats.bark))
  } else if (kind === 'Mine') {
    group.add(beamBetween([-0.45, -0.55, 0], [0.4, 0.5, 0], 0.09, mats.barkLight))
    group.add(beamBetween([-0.55, 0.28, 0], [0.12, 0.72, 0], 0.08, colorMaterial))
  } else {
    const roof = mesh(new THREE.ConeGeometry(0.7, 0.55, 4), colorMaterial, 'Home Roof')
    roof.rotation.y = Math.PI / 4
    roof.position.y = 0.28
    const cottage = mesh(new RoundedBoxGeometry(0.82, 0.7, 0.18, 3, 0.12), mats.parchment, 'Home Cottage')
    cottage.position.y = -0.28
    group.add(roof, cottage)
  }
  return group
}

function portal(kind, glass, position, rotation = 0) {
  const group = new THREE.Group()
  group.name = `${kind} Portal Landmark`
  group.position.set(...position)
  group.rotation.y = rotation
  for (const side of [-1, 1]) {
    const collider = new THREE.Object3D()
    collider.name = `${kind} Portal Side Collider`
    collider.position.set(side * 2.03, 0, 0)
    collider.userData.colliderRadius = 0.8
    group.add(collider)
  }
  if (kind === 'Forage') {
    // The forest destination is a living arch: two trunks, crossing limbs and
    // a compact crown. It is readable by silhouette before its label appears.
    for (const side of [-1, 1]) {
      const trunk = mesh(new THREE.CylinderGeometry(.26, .43, 3.55, 7), mats.bark, 'Living Portal Trunk')
      trunk.position.set(side * 1.86, 1.72, 0)
      trunk.rotation.z = side * -.09
      group.add(trunk)
    }
    group.add(
      beamBetween([-1.92, 3.08, 0], [-.08, 4.18, 0], .23, mats.bark),
      beamBetween([1.92, 3.08, 0], [.08, 4.18, 0], .23, mats.barkLight),
    )
    ;[[-1.55,3.72,.9],[0,4.28,1.05],[1.5,3.74,.86],[-.66,4.02,.72],[.7,4.02,.76]].forEach(([x,y,scale], index) => {
      const crown = mesh(new THREE.DodecahedronGeometry(scale, 1), index % 2 ? mats.leafFresh : mats.leafDeep, 'Living Portal Crown')
      crown.position.set(x, y, -.04)
      crown.scale.set(1.15, .7, .7)
      group.add(crown)
    })
    const leftUnderstory = shrub(-2.36, .18, .78, true, 0)
    const rightUnderstory = shrub(2.42, -.08, .7, false, 0)
    group.add(leftUnderstory, rightUnderstory)
  } else if (kind === 'Farm') {
    // A hewn timber gate ties the farm entrance to its fences and stalls while
    // keeping a broad, snag-free opening.
    for (const side of [-1, 1]) {
      const post = mesh(new RoundedBoxGeometry(.48, 3.42, .56, 4, .12), mats.bark, 'Farm Gate Post')
      post.position.set(side * 1.86, 1.7, 0)
      group.add(post)
    }
    group.add(
      beamBetween([-2.08, 3.35, 0], [2.08, 3.35, 0], .19, mats.barkLight),
      beamBetween([-2.02, 3.43, 0], [0, 4.18, 0], .16, mats.bark),
      beamBetween([2.02, 3.43, 0], [0, 4.18, 0], .16, mats.bark),
    )
    for (const side of [-1, 1]) {
      const marker = mesh(new THREE.CylinderGeometry(.09, .12, 1.05, 7), mats.bark, 'Farm Gate Marker')
      marker.position.set(side * 2.55, .52, .18)
      const rail = beamBetween([side * 2.5, .72, .18], [side * 3.32, .72, .18], .075, mats.barkLight)
      group.add(marker, rail)
    }
  } else {
    // Mine and Home keep a carved-stone threshold. The single sculpted shell
    // avoids the rejected necklace of identical pebble meshes.
    const archShape = new THREE.Shape()
    archShape.moveTo(-2.35, 0)
    archShape.lineTo(-2.35, 3.02)
    archShape.bezierCurveTo(-2.35, 4.47, -1.28, 5.16, 0, 5.18)
    archShape.bezierCurveTo(1.28, 5.16, 2.35, 4.47, 2.35, 3.02)
    archShape.lineTo(2.35, 0)
    archShape.closePath()
    const opening = new THREE.Path()
    opening.moveTo(-1.5, 0.035)
    opening.lineTo(1.5, 0.035)
    opening.lineTo(1.5, 1.86)
    opening.bezierCurveTo(1.5, 2.78, 0.78, 3.27, 0, 3.3)
    opening.bezierCurveTo(-0.78, 3.27, -1.5, 2.78, -1.5, 1.86)
    opening.closePath()
    archShape.holes.push(opening)
    const archGeometry = new THREE.ExtrudeGeometry(archShape, {
      depth: 0.78,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.12,
      bevelThickness: 0.12,
      curveSegments: 14,
      steps: 1,
    })
    archGeometry.translate(0, 0, -0.39)
    group.add(mesh(archGeometry, kind === 'Mine' ? mats.stoneDark : mats.stone, 'Carved Portal Arch'))
    const moss = mesh(new THREE.SphereGeometry(0.68, 10, 6), mats.leafDeep, 'Portal Moss')
    moss.position.set(-1.12, 4.61, .42)
    moss.scale.set(1.15, .18, .5)
    moss.rotation.z = -.22
    group.add(moss)
    if (kind === 'Mine') {
      ;[[-2.46,.54,.1,.84],[2.5,.5,-.08,.9],[-2.72,.24,.42,.58],[2.77,.25,.38,.62]].forEach(([x,y,z,scale], index) => {
        const boulder = mesh(new THREE.DodecahedronGeometry(scale, 1), index % 2 ? mats.stone : mats.stoneDark, 'Mine Portal Boulder')
        boulder.position.set(x, y, z)
        boulder.scale.set(1.18, .76, .92)
        boulder.rotation.set(index * .11, index * .77, index * -.04)
        group.add(boulder)
      })
    }
  }

  // Uneven foot stones visually seat every threshold in the terrain.
  const footStoneGeometry = new THREE.DodecahedronGeometry(0.72, 1)
  ;[[-2.12, 0.29, 0.18, .9], [2.15, 0.27, -0.08, .82]].forEach(([x, y, z, scale], index) => {
    const stone = mesh(footStoneGeometry, index % 2 ? mats.stoneDark : mats.stone, 'Portal Foot Stone')
    stone.position.set(x, y, z)
    stone.scale.set(scale * 1.15, scale * .7, scale * .86)
    stone.rotation.set(index * .08, index * .73, index % 2 ? -.06 : .08)
    group.add(stone)
  })
  const veilShape = new THREE.Shape()
  veilShape.moveTo(-1.5, 0)
  veilShape.lineTo(1.5, 0)
  veilShape.lineTo(1.5, 1.78)
  veilShape.bezierCurveTo(1.5, 2.7, 0.78, 3.24, 0, 3.28)
  veilShape.bezierCurveTo(-0.78, 3.24, -1.5, 2.7, -1.5, 1.78)
  veilShape.closePath()
  const veil = mesh(new THREE.ShapeGeometry(veilShape, 18), glass, 'Portal Veil')
  veil.position.set(0, 0.08, 0.1)
  group.add(veil)
  const emblemMaterial = glass.clone()
  emblemMaterial.name = `${kind} Emblem Color`
  emblemMaterial.transparent = false
  emblemMaterial.opacity = 1
  emblemMaterial.depthWrite = true
  emblemMaterial.roughness = .68
  const icon = portalIcon(kind, emblemMaterial)
  icon.position.set(0, kind === 'Forage' ? 4.02 : kind === 'Farm' ? 3.88 : 4.22, 0.48)
  icon.scale.setScalar(kind === 'Forage' ? .66 : kind === 'Farm' ? .72 : .78)
  group.add(icon)
  return group
}

function fenceRect(group, centerX, centerZ, width, depth) {
  const left = centerX - width / 2
  const right = centerX + width / 2
  const near = centerZ + depth / 2
  const far = centerZ - depth / 2
  const gateHalf = 1.25
  const posts = [
    [left, far], [left, near], [right, far], [right, near],
    [centerX - gateHalf, far], [centerX + gateHalf, far],
    [centerX - gateHalf, near], [centerX + gateHalf, near],
    [left, centerZ - gateHalf], [left, centerZ + gateHalf],
    [right, centerZ - gateHalf], [right, centerZ + gateHalf],
  ]
  posts.forEach(([x, z]) => {
    const post = mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.1, 7), mats.bark, 'Fence Post')
    post.position.set(x, 0.55, z)
    group.add(post)
  })
  for (const y of [0.42, 0.83]) {
    group.add(beamBetween([left, y, far], [centerX - gateHalf, y, far], 0.09))
    group.add(beamBetween([centerX + gateHalf, y, far], [right, y, far], 0.09))
    group.add(beamBetween([left, y, near], [centerX - gateHalf, y, near], 0.09))
    group.add(beamBetween([centerX + gateHalf, y, near], [right, y, near], 0.09))
    group.add(beamBetween([left, y, far], [left, y, centerZ - gateHalf], 0.09))
    group.add(beamBetween([left, y, centerZ + gateHalf], [left, y, near], 0.09))
    group.add(beamBetween([right, y, far], [right, y, centerZ - gateHalf], 0.09))
    group.add(beamBetween([right, y, centerZ + gateHalf], [right, y, near], 0.09))
  }
  const addCollider = (x, z) => {
    const collider = new THREE.Object3D()
    collider.name = 'Fence Collider'
    collider.position.set(x, 0, z)
    collider.userData.colliderRadius = 0.34
    group.add(collider)
  }
  for (let x = left; x <= right + 0.01; x += 0.9) {
    if (Math.abs(x - centerX) > gateHalf + 0.15) { addCollider(x, far); addCollider(x, near) }
  }
  for (let z = far; z <= near + 0.01; z += 0.9) {
    if (Math.abs(z - centerZ) > gateHalf + 0.15) { addCollider(left, z); addCollider(right, z) }
  }
}

function farmPlot() {
  const group = new THREE.Group()
  group.name = 'Finished Farm Plot'
  fenceRect(group, -9.5, 8.5, 10, 7)
  const patch = mesh(new RoundedBoxGeometry(7.5, 0.18, 4.8, 5, 0.4), mats.soil, 'Tilled Soil')
  patch.position.set(-10.1, 0.13, 8.5)
  group.add(patch)
  for (let row = -1; row <= 1; row += 1) {
    const furrow = mesh(new RoundedBoxGeometry(6.7, 0.15, 0.72, 4, 0.3), mats.barkLight, 'Planting Row')
    furrow.position.set(-10.1, 0.28, 8.5 + row * 1.28)
    group.add(furrow)
  }
  const signPost = mesh(new THREE.CylinderGeometry(0.11, 0.14, 1.45, 7), mats.bark, 'Farm Sign Post')
  signPost.position.set(-4.9, 0.72, 6.1)
  const sign = mesh(new RoundedBoxGeometry(1.25, 0.62, 0.1, 4, 0.12), mats.parchment, 'Farm Emblem Sign')
  sign.position.set(-4.9, 1.3, 6.1)
  const icon = portalIcon('Farm', mats.glassFarm)
  icon.position.set(-4.9, 1.3, 6.02)
  icon.scale.setScalar(0.32)
  group.add(signPost, sign, icon)
  return group
}

function shop(name = 'Common Shop', position = [8.1, 0, 6.4], rotation = -0.62, roofMaterial = mats.leafDark) {
  const group = new THREE.Group()
  group.name = name
  group.position.set(...position)
  group.rotation.y = rotation
  const cartStyle = /Market|Stand/.test(name)
  const stall = propAsset(cartStyle ? 'Stall_Cart_Empty' : 'Stall_Empty', [0, 0, 0], cartStyle ? .98 : 1.12)
  stall.name = `${name} Authored Stall`
  group.add(stall)

  // One restrained prop makes the stand's purpose readable at a glance. The
  // labels remain authoritative, while the stall itself stays inside the same
  // Quaternius visual family as the woodland assets.
  const displayName = /Farm Shop/.test(name) ? 'FarmCrate_Carrot'
    : /Produce|Forage Market/.test(name) ? 'Barrel_Apples'
      : /Food Market/.test(name) ? 'FarmCrate_Apple'
        : /Ore/.test(name) ? 'FarmCrate_Empty'
          : /Common/.test(name) ? 'Barrel' : null
  if (displayName) {
    const display = propAsset(displayName, [-.5, .72, -.51], .46, -.08)
    display.name = `${name} Display`
    group.add(display)
  }
  return group
}

function shopOffset(position, rotation, localZ) {
  return [position[0] + Math.sin(rotation) * localZ, position[2] + Math.cos(rotation) * localZ]
}

function stockExchange(position = [-8, 0, 8], rotation = 0.18) {
  const group = new THREE.Group()
  group.name = 'Stock Exchange Pavilion'
  group.position.set(...position)
  group.rotation.y = rotation
  const stall = propAsset('Stall_Empty', [0, 0, 0], 1.12)
  stall.name = 'Stock Exchange Authored Stall'
  group.add(stall)
  const ring = mesh(new THREE.TorusGeometry(0.25, 0.055, 8, 20), mats.richOre, 'Animated_StockRing')
  ring.position.set(0, 2.2, -0.58)
  const center = mesh(new THREE.OctahedronGeometry(0.12, 0), mats.parchment, 'Exchange Token')
  center.position.set(0, 2.2, -0.58)
  group.add(ring, center)
  return group
}

function farmGroundHeight(x, z) {
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

function hubGroundHeight(x, z) {
  const rolling = Math.sin(x * 0.055) * 0.34 + Math.cos(z * 0.049) * 0.28 + Math.sin((x + z) * 0.09) * 0.1
  const clearing = 1 - smoothstep(17, 29, Math.hypot(x, z))
  const outerRise = smoothstep(27, 62, Math.hypot(x, z)) * 9.5
  return THREE.MathUtils.lerp(rolling, 0.04, clearing) + outerRise
}

function farmParcel(x, z, index) {
  const group = new THREE.Group()
  group.name = `Farm ${index + 1}`
  group.position.set(x, farmGroundHeight(x, z), z)
  fenceRect(group, 0, 0, 14.5, 14.5)
  const bed = mesh(new RoundedBoxGeometry(11.65, 0.11, 11.65, 5, 0.22), mats.soil, `Farm ${index + 1} Soil Bed`)
  bed.position.y = 0.075
  group.add(bed)
  const gatePaths = [
    [8.55, 0, 2.6, 2.15], [-8.55, 0, 2.6, 2.15],
    [0, 8.55, 2.15, 2.6], [0, -8.55, 2.15, 2.6],
  ]
  gatePaths.forEach(([px, pz, pw, pd]) => {
    const gatePath = mesh(new RoundedBoxGeometry(pw, 0.07, pd, 4, 0.2), mats.path, 'Farm Gate Path')
    gatePath.position.set(px, 0.06, pz)
    group.add(gatePath)
  })
  const signPost = mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.35, 7), mats.bark, 'Plot Sign Post')
  signPost.position.set(5.85, 0.68, 6.25)
  const sign = mesh(new RoundedBoxGeometry(1.2, 0.58, 0.1, 4, 0.12), mats.parchment, 'Claim Sign')
  sign.position.set(5.85, 1.18, 6.25)
  const icon = portalIcon('Farm', mats.glassFarm)
  icon.position.set(5.85, 1.18, 6.18)
  icon.scale.setScalar(0.27)
  group.add(signPost, sign, icon)
  return group
}

function farmFurnacePad(x, z, index) {
  const group = new THREE.Group()
  group.name = `Farm Furnace Pad ${index + 1}`
  group.position.set(x, farmGroundHeight(x, z), z)
  group.rotation.y = -Math.PI / 2
  const pad = mesh(new THREE.CylinderGeometry(1.08, 1.18, 0.12, 12), mats.stoneDark, 'Furnace Stone Pad')
  pad.position.y = 0.06
  pad.scale.z = 0.86
  group.add(pad)

  const body = new THREE.Group()
  body.name = `FurnaceBody${index}`
  body.userData.furnaceIndex = index
  body.userData.colliderRadius = 0.62
  body.scale.setScalar(0.68)
  const base = mesh(new RoundedBoxGeometry(1.75, 1.35, 1.5, 5, 0.18), mats.stone, 'Furnace Masonry')
  base.position.y = 0.78
  const shoulder = mesh(new THREE.CylinderGeometry(0.56, 0.9, 0.62, 8), mats.stone, 'Furnace Shoulder')
  shoulder.position.y = 1.7
  const chimney = mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.9, 8), mats.stoneDark, 'Furnace Chimney')
  chimney.position.y = 2.38
  const copperBand = mesh(new THREE.TorusGeometry(0.72, 0.09, 7, 8), mats.richOre, 'Copper Furnace Band')
  copperBand.position.y = 1.42
  copperBand.rotation.x = Math.PI / 2
  const door = mesh(new RoundedBoxGeometry(0.82, 0.72, 0.12, 5, 0.15), mats.stoneDark, 'Furnace Door')
  door.position.set(0, 0.88, 0.78)
  const doorFrame = mesh(new THREE.TorusGeometry(0.43, 0.075, 7, 18, Math.PI), mats.richOre, 'Copper Firebox Arch')
  doorFrame.position.set(0, 1.03, 0.86)
  doorFrame.rotation.z = Math.PI
  const fire = mesh(new THREE.ConeGeometry(0.2, 0.42, 7), mats.furnaceFire, `Animated_FurnaceFire${index}`)
  fire.position.set(0, 0.88, 0.87)
  fire.scale.set(0.9, 0.82, 0.42)
  fire.visible = false
  const ready = mesh(new THREE.TorusGeometry(0.58, 0.075, 8, 20), mats.furnaceFire, `Animated_FurnaceReady${index}`)
  ready.position.set(0, 0.88, 0.9)
  ready.visible = false
  const steam = new THREE.Group()
  steam.name = `Animated_FurnaceSteam${index}`
  steam.position.set(0, 2.86, 0)
  steam.visible = false
  for (let puff = 0; puff < 3; puff += 1) {
    const cloud = mesh(new THREE.IcosahedronGeometry(0.11 + puff * 0.018, 1), mats.furnaceSteam, 'Steam Puff')
    cloud.position.set((puff % 2 ? 0.07 : -0.05), puff * 0.2, 0)
    cloud.scale.set(0.9, 1.35, 0.9)
    steam.add(cloud)
  }
  body.add(base, shoulder, chimney, copperBand, door, doorFrame, fire, ready, steam)
  group.add(body)
  return group
}

function mineGroundHeight(x, z) {
  if (z >= 22) {
    const mouthHill = Math.exp(-((z - 28) ** 2) / 520) * smoothstep(5, 24, Math.abs(x)) * 5.8
    return mouthHill + Math.sin(x * 0.09 + z * 0.035) * 0.18
  }
  const ramp = (high, low, from, to) => {
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
  const shelf = (cx, cz, radiusX, radiusZ, height) => {
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
    // A readable overlook descends through three broad shelves. The side banks
    // establish the cavern silhouette while the center remains fully walkable
    // and open to the chamber beyond.
    const deep = smoothstep(150, 198, -z)
    const bank = smoothstep(18, 42, Math.abs(x)) * (1.4 + deep * 3.4)
    const terraces = smoothstep(160, 168, -z) * 0.9
      + smoothstep(174, 183, -z) * 1.05
      + smoothstep(188, 198, -z) * 1.2
    level += bank - terraces
  }
  return level
}

function mineBoulder(x, z, scale = 1, rotation = 0) {
  const group = new THREE.Group()
  group.name = 'Quarry Wall'
  group.position.set(x, mineGroundHeight(x, z), z)
  group.rotation.y = rotation
  // Keep the blocker inside the visible footprint. The former broad circle
  // caught players on empty space between the three visible stones.
  group.userData.colliderRadius = 0.72 * scale
  ;[[-0.6, 0.7, 0, 1.15], [0.5, 0.9, 0.1, 1.35], [0, 1.75, -0.1, 1.2]].forEach(([bx, by, bz, size], index) => {
    const stone = mesh(quarryStoneGeometry, index % 2 ? mats.mineWall : mats.stoneDark, 'Quarry Stone')
    stone.position.set(bx * scale, by * scale, bz * scale)
    stone.scale.set(size * scale * 1.2, size * scale * 0.88, size * scale * 0.92)
    stone.rotation.set(index * 0.14, index * 0.63, index * 0.09)
    group.add(stone)
  })
  return group
}

function caveCeiling(x, z, width, depth, seed = 0, height = 4.55) {
  const columns = Math.max(2, Math.ceil(width / 3))
  const rows = Math.max(2, Math.ceil(depth / 3))
  const positions = []
  const indices = []
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const px = x - width / 2 + (column / columns) * width
      const pz = z - depth / 2 + (row / rows) * depth
      const edge = Math.min(column, columns - column, row, rows - row)
      const ripple = (seeded(row * 31 + column, 3100 + seed) - 0.5) * 0.72 + Math.sin(px * 0.42 + pz * 0.17) * 0.16
      positions.push(px, height + ripple - (edge === 0 ? 0.22 : 0), pz)
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column
      const b = a + 1
      const c = a + columns + 1
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const ceilingMaterial = mats.mineWall.clone()
  ceilingMaterial.name = 'Cave Ceiling Stone'
  ceilingMaterial.color.multiply(new THREE.Color(0.82, 0.76, 0.68))
  ceilingMaterial.emissive = new THREE.Color(0x21150f)
  ceilingMaterial.emissiveIntensity = 0.22
  ceilingMaterial.roughness = 1
  ceilingMaterial.side = THREE.DoubleSide
  const value = mesh(geometry, ceilingMaterial, 'Irregular Cave Ceiling')
  return value
}

function oreNode(id, x, z) {
  const group = new THREE.Group()
  group.name = `Resource_${id}`
  group.position.set(x, mineGroundHeight(x, z), z)
  group.position.y -= 0.04
  // Ore beds are ankle-height interaction targets, not navigation blockers.
  const seed = Number(id.match(/\d+$/)?.[0] ?? 0)
  const bed = mesh(new THREE.DodecahedronGeometry(0.78, 1), mats.mineWall, 'Embedded Ore Bed')
  bed.scale.set(1.15, 0.22, 0.9)
  bed.position.y = 0.13
  bed.rotation.y = seeded(seed, 6110) * Math.PI
  group.add(bed)
  const boulderPositions = [[-0.34, 0.39, 0.04], [0.08, 0.52, -0.06], [0.39, 0.35, 0.12]]
  const boulderGeometries = []
  const veinGeometries = []
  for (let index = 0; index < boulderPositions.length; index += 1) {
    const radius = 0.3 + seeded(index, seed + 6130) * 0.09
    const [bx, by, bz] = boulderPositions[index]
    const boulderPosition = new THREE.Vector3(bx, by, bz)
    const boulderScale = new THREE.Vector3(1.06 + seeded(index, seed + 6140) * 0.24, 1.02 + seeded(index, seed + 6150) * 0.18, 0.96 + seeded(index, seed + 6160) * 0.22)
    const boulderRotation = new THREE.Euler(seeded(index, seed + 6170) * 0.28, seeded(index, seed + 6180) * Math.PI, seeded(index, seed + 6190) * 0.24)
    const boulderMatrix = new THREE.Matrix4().compose(boulderPosition, new THREE.Quaternion().setFromEuler(boulderRotation), boulderScale)
    boulderGeometries.push(new THREE.DodecahedronGeometry(radius, 1).applyMatrix4(boulderMatrix))
    const veinPosition = new THREE.Vector3(bx + (seeded(index, seed + 6201) - .5) * radius * .45, by + radius * .72, bz + radius * .42)
    const veinRotation = new THREE.Euler(.18 + seeded(index, seed + 6211) * .4, seeded(index, seed + 6221) * Math.PI, .1)
    const veinMatrix = new THREE.Matrix4().compose(veinPosition, new THREE.Quaternion().setFromEuler(veinRotation), new THREE.Vector3(1.28, .62, .9))
    veinGeometries.push(new THREE.DodecahedronGeometry(radius * .43, 0).applyMatrix4(veinMatrix))
  }
  group.add(mesh(mergeGeometries(boulderGeometries), mats.stoneOre, 'Ore Boulder'))
  group.add(mesh(mergeGeometries(veinGeometries), mats.richOre, 'Ore Vein'))
  group.scale.setScalar(id.startsWith('RushOre') ? 1.16 : 1.34)
  return group
}

function hayStack(x, z, rotation = 0) {
  const group = new THREE.Group()
  group.name = 'Hay Bale Cluster'
  group.position.set(x, farmGroundHeight(x, z), z)
  group.rotation.y = rotation
  const hay = material('Sun-dried Hay', 0xb78a42)
  ;[[-0.65, 0.48, 0], [0.65, 0.48, 0], [0, 1.23, 0]].forEach(([px, py, pz], index) => {
    const bale = mesh(new THREE.CylinderGeometry(0.58, 0.58, 1.15, 10), hay, 'Round Hay Bale')
    bale.position.set(px, py, pz)
    bale.rotation.z = Math.PI / 2
    bale.rotation.y = index * 0.14
    group.add(bale)
  })
  return group
}

function mineEntrance(x, z) {
  const group = new THREE.Group()
  group.position.set(x, mineGroundHeight(x, z), z)
  group.name = 'Old Quarry Entrance'
  group.add(beamBetween([-2.45, 0, 0], [-2.45, 4.45, 0], 0.24, mats.barkLight))
  group.add(beamBetween([2.45, 0, 0], [2.45, 4.45, 0], 0.24, mats.barkLight))
  group.add(beamBetween([-2.65, 4.35, 0], [2.65, 4.35, 0], 0.26, mats.barkLight))
  for (const xOffset of [-3.6, 3.6]) {
    const lamp = mesh(new THREE.OctahedronGeometry(0.24, 0), material('Quarry Lantern', 0xd7a153, { roughness: 0.55 }), 'Quarry Lantern')
    lamp.position.set(xOffset, 2.25, -0.1)
    group.add(lamp, beamBetween([xOffset, 0, 0], [xOffset, 2.1, 0], 0.09, mats.bark))
  }
  // Authored rock outcrops rise from the terrain on either side. Keeping the
  // opening clear overhead makes this read as a quarry cut leading into a
  // larger cavern, rather than a freestanding ring of floating boulders.
  ;[
    ['Rock1', [-7.2, -.12, -.65], [2.7, 2.35, 2.45], [.02, .42, -.08], mats.mineWall],
    ['Rock3', [-5.55, -.08, -1.05], [2.35, 2.48, 2.15], [.01, -.36, -.04], mats.mineStrata],
    ['Rock2', [-4.05, -.04, -1.55], [1.72, 1.85, 1.68], [.04, .68, -.03], mats.mineWall],
    ['Rock2', [-8.55, -.08, 1.05], [2.05, 1.55, 2.35], [-.02, -.2, .02], mats.mineStrata],
    ['Rock1', [7.35, -.12, -.78], [2.62, 2.28, 2.42], [-.03, -.54, .07], mats.mineWall],
    ['Rock3', [5.7, -.08, -1.18], [2.3, 2.42, 2.08], [-.02, .45, .04], mats.mineStrata],
    ['Rock2', [4.1, -.04, -1.62], [1.76, 1.9, 1.7], [-.04, -.72, .03], mats.mineWall],
    ['Rock1', [8.75, -.08, .92], [1.98, 1.48, 2.28], [.01, .28, -.03], mats.mineStrata],
  ].forEach(([name, position, scale, rotation, rockMaterial]) => {
    group.add(authoredRock(name, position, scale, rotation, rockMaterial))
  })
  return group
}

function mineTrack(x, z, length = 12, rotation = 0) {
  const group = new THREE.Group()
  group.name = 'Abandoned Mine Track'
  group.position.set(x, mineGroundHeight(x, z) + 0.055, z)
  group.rotation.y = rotation
  for (const railX of [-0.52, 0.52]) {
    const rail = mesh(new RoundedBoxGeometry(0.08, 0.08, length, 3, 0.025), mats.richOre, 'Worn Rail')
    rail.position.x = railX
    group.add(rail)
  }
  for (let offset = -length / 2 + 0.45; offset < length / 2; offset += 0.9) {
    const sleeper = mesh(new RoundedBoxGeometry(1.55, 0.09, 0.18, 3, 0.025), mats.bark, 'Track Sleeper')
    sleeper.position.z = offset
    sleeper.rotation.y = (seeded(Math.round(offset * 10), 904) - 0.5) * 0.05
    group.add(sleeper)
  }
  return group
}

function caveLantern(x, z, side = 1) {
  const group = new THREE.Group()
  group.name = 'Cave Lantern Landmark'
  group.position.set(x, mineGroundHeight(x, z), z)
  const post = mesh(new THREE.CylinderGeometry(0.085, 0.11, 2.25, 7), mats.barkLight, 'Lantern Post')
  post.position.y = 1.12
  const arm = beamBetween([0, 2.1, 0], [0.62 * side, 2.1, 0], 0.07, mats.barkLight)
  const lanternMaterial = material('Cave Lantern Amber', 0xe0a653, { roughness: 0.58 })
  lanternMaterial.emissive = new THREE.Color(0x8e4c1f)
  lanternMaterial.emissiveIntensity = 0.72
  const lamp = mesh(new THREE.OctahedronGeometry(0.23, 0), lanternMaterial, 'Cave Lantern')
  lamp.position.set(0.64 * side, 1.84, 0)
  group.add(post, arm, lamp)
  return group
}

function decorativeOreSeam(x, z, rotation = 0, color = mats.crystal) {
  const group = new THREE.Group()
  group.name = 'Decorative Ore Seam'
  group.position.set(x, mineGroundHeight(x, z) + 1.15, z)
  group.rotation.y = rotation
  for (let index = 0; index < 7; index += 1) {
    const shard = mesh(new THREE.OctahedronGeometry(0.12 + (index % 3) * 0.055, 0), color, 'Wall Ore Glint')
    shard.position.set((index - 3) * 0.27, 0.2 + (index % 2) * 0.28, (index % 3) * 0.05)
    shard.rotation.set(index * 0.37, index * 0.73, index * 0.16)
    group.add(shard)
  }
  return group
}

const mineFootprint = [
  [-10, 24], [-18, 12], [-40, 8], [-57, -1], [-64, -18], [-62, -36], [-48, -51], [-61, -64],
  [-67, -82], [-61, -96], [-43, -108], [-54, -120], [-53, -139], [-45, -158], [-53, -176], [-43, -191], [-35, -211],
  [-46, -229], [-31, -246], [-9, -253], [10, -253], [31, -246], [46, -229], [35, -211], [43, -191], [53, -176],
  [45, -158], [53, -139], [54, -120], [42, -108], [59, -98], [67, -83], [63, -63],
  [49, -50], [62, -36], [64, -17], [57, -1], [40, 8], [18, 12], [10, 24],
]

function pointInPolygon(x, z, polygon) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, zi] = polygon[index]
    const [xj, zj] = polygon[previous]
    const intersects = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function maskedTerrain(name, bounds, step, heightAt, groundMaterial, includeCell) {
  const [minX, maxX, minZ, maxZ] = bounds
  const columns = Math.ceil((maxX - minX) / step)
  const rows = Math.ceil((maxZ - minZ) / step)
  const positions = []
  const uvs = []
  const colors = groundMaterial === mats.ground ? [] : null
  const indices = []
  for (let row = 0; row <= rows; row += 1) {
    const z = THREE.MathUtils.lerp(minZ, maxZ, row / rows)
    for (let column = 0; column <= columns; column += 1) {
      const x = THREE.MathUtils.lerp(minX, maxX, column / columns)
      positions.push(x, heightAt(x, z), z)
      uvs.push((x - minX) / 7, (z - minZ) / 7)
      if (colors) {
        const broad = Math.sin(x * .021 + z * .014) * .045 + Math.cos(z * .018 - x * .011) * .035
        const shade = .94 + broad + Math.sin((x + z) * .073) * .014
        colors.push(shade * .97, shade * 1.025, shade * .95)
      }
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = THREE.MathUtils.lerp(minX, maxX, (column + 0.5) / columns)
      const z = THREE.MathUtils.lerp(minZ, maxZ, (row + 0.5) / rows)
      if (!includeCell(x, z)) continue
      const a = row * (columns + 1) + column
      const b = a + 1
      const c = a + columns + 1
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return mesh(geometry, groundMaterial, name)
}

function mineExteriorTerrain() {
  return maskedTerrain(
    'Grassy Sinkhole Rim', [-78, 78, 18, 78], 1.5,
    mineGroundHeight, mats.ground,
    (x, z) => {
      const throat = 6.5 + Math.max(0, 34 - z) * 0.34
      return z >= 22 || Math.abs(x) >= throat
    },
  )
}

function caveHeight(x, z) {
  const depth = Math.min(1, Math.max(0, (-z + 8) / 165))
  const chamber = Math.exp(-((x + 37) ** 2 + (z + 23) ** 2) / 760) * 5.8
    + Math.exp(-((x - 39) ** 2 + (z + 24) ** 2) / 760) * 5.4
    + Math.exp(-((x + 38) ** 2 + (z + 73) ** 2) / 920) * 7.2
    + Math.exp(-((x - 40) ** 2 + (z + 76) ** 2) / 920) * 7.5
    + Math.exp(-((x + 28) ** 2 + (z + 124) ** 2) / 720) * 6.4
    + Math.exp(-((x - 31) ** 2 + (z + 121) ** 2) / 720) * 6.8
    + Math.exp(-(x ** 2) / 1300 - ((z + 226) ** 2) / 1050) * 9.5
  return mineGroundHeight(x, z) + 8.5 + depth * 3.4 + chamber + Math.sin(x * 0.13 + z * 0.065) * 0.62
}

function authoredCavern() {
  const group = new THREE.Group()
  group.name = 'Authored Stonewake Cavern'
  group.add(maskedTerrain(
    'Continuous Cavern Floor', [-68, 68, -255, 25], 1.35,
    (x, z) => mineGroundHeight(x, z) + 0.09 + Math.sin(x * 0.21 + z * 0.11) * 0.025,
    mats.mineGround,
    (x, z) => pointInPolygon(x, z, mineFootprint),
  ))

  const roofMaterial = mats.mineWall.clone()
  roofMaterial.name = 'Cavern Roof Stone'
  roofMaterial.side = THREE.DoubleSide
  roofMaterial.emissive = new THREE.Color(0x26231f)
  roofMaterial.emissiveIntensity = 0.18
  group.add(maskedTerrain(
    'Sealed Irregular Cavern Roof', [-68, 68, -255, 18], 1.75,
    (x, z) => caveHeight(x, z) + Math.sin(x * .47 - z * .29) * .42 + Math.cos(x * .19 + z * .37) * .24,
    roofMaterial,
    (x, z) => pointInPolygon(x, z, mineFootprint),
  ))

  // A continuous low-poly shell sits behind the sculpted wall. The visible
  // wall keeps its irregular silhouette, while tiny segment and roof joins no
  // longer reveal the black scene void.
  const shellPositions = []
  const shellUvs = []
  const shellIndices = []
  for (let edge = 0; edge < mineFootprint.length; edge += 1) {
    const [ax, az] = mineFootprint[edge]
    const [bx, bz] = mineFootprint[(edge + 1) % mineFootprint.length]
    const base = shellPositions.length / 3
    const floorA = mineGroundHeight(ax, az) - .75
    const floorB = mineGroundHeight(bx, bz) - .75
    const roofA = caveHeight(ax, az) + 1.8
    const roofB = caveHeight(bx, bz) + 1.8
    shellPositions.push(ax, floorA, az, bx, floorB, bz, ax, roofA, az, bx, roofB, bz)
    shellUvs.push(0, 0, 1, 0, 0, 2.4, 1, 2.4)
    shellIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
  }
  const shellGeometry = new THREE.BufferGeometry()
  shellGeometry.setAttribute('position', new THREE.Float32BufferAttribute(shellPositions, 3))
  shellGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(shellUvs, 2))
  shellGeometry.setIndex(shellIndices)
  shellGeometry.computeVertexNormals()
  const shellMaterial = mats.mineWall.clone()
  shellMaterial.name = 'Mine Wall Backing'
  shellMaterial.side = THREE.DoubleSide
  group.add(mesh(shellGeometry, shellMaterial, 'Continuous Cavern Backing'))

  const wallPositions = []
  const wallUvs = []
  const wallIndices = []
  let cursor = 0
  for (let edge = 0; edge < mineFootprint.length; edge += 1) {
    const [ax, az] = mineFootprint[edge]
    const [bx, bz] = mineFootprint[(edge + 1) % mineFootprint.length]
    const length = Math.hypot(bx - ax, bz - az)
    const segments = Math.max(1, Math.ceil(length / 2.1))
    for (let part = 0; part < segments; part += 1) {
      const t0 = part / segments
      const t1 = (part + 1) / segments
      const x0 = THREE.MathUtils.lerp(ax, bx, t0)
      const z0 = THREE.MathUtils.lerp(az, bz, t0)
      const x1 = THREE.MathUtils.lerp(ax, bx, t1)
      const z1 = THREE.MathUtils.lerp(az, bz, t1)
      const h0 = caveHeight(x0, z0)
      const h1 = caveHeight(x1, z1)
      const f0 = mineGroundHeight(x0, z0)
      const f1 = mineGroundHeight(x1, z1)
      const center = new THREE.Vector2(0, -72)
      const inward0 = center.clone().sub(new THREE.Vector2(x0, z0)).normalize()
      const inward1 = center.clone().sub(new THREE.Vector2(x1, z1)).normalize()
      const offsets0 = [0, 0.5, 1.2, 0.8, 1.35, 0.05]
      const offsets1 = [0, 0.65, 1.05, 1.3, 0.7, 0.05]
      for (let level = 0; level < 6; level += 1) {
        const ratio = level / 5
        wallPositions.push(
          x0 + inward0.x * (offsets0[level] + seeded(cursor + level, 7710) * 0.4), THREE.MathUtils.lerp(f0 - 0.2, h0, ratio) + ratio * 1.05 + (seeded(cursor + level, 7750) - 0.5) * 0.7, z0 + inward0.y * offsets0[level],
          x1 + inward1.x * (offsets1[level] + seeded(cursor + level, 7730) * 0.4), THREE.MathUtils.lerp(f1 - 0.2, h1, ratio) + ratio * 1.05 + (seeded(cursor + level, 7760) - 0.5) * 0.7, z1 + inward1.y * offsets1[level],
        )
        wallUvs.push(t0 * length / 3, ratio * 2.2, t1 * length / 3, ratio * 2.2)
      }
      for (let level = 0; level < 5; level += 1) {
        const base = cursor + level * 2
        wallIndices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3)
      }
      cursor += 12
    }
  }
  const wallGeometry = new THREE.BufferGeometry()
  wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3))
  wallGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(wallUvs, 2))
  wallGeometry.setIndex(wallIndices)
  wallGeometry.computeVertexNormals()
  const wallMaterial = mats.mineWall.clone()
  wallMaterial.name = 'Cavern Perimeter Stone'
  wallMaterial.side = THREE.DoubleSide
  wallMaterial.emissive = new THREE.Color(0x27231f)
  wallMaterial.emissiveIntensity = 0.24
  group.add(mesh(wallGeometry, wallMaterial, 'Sealed Cavern Walls'))

  return group
}

function cavePool(x, z, radiusX, radiusZ) {
  const pool = mesh(new THREE.CircleGeometry(1, 40), mats.caveWater, 'Still Cavern Pool')
  pool.rotation.x = -Math.PI / 2
  pool.scale.set(radiusX, radiusZ, 1)
  pool.position.set(x, mineGroundHeight(x, z) + 0.18, z)
  return pool
}

function caveWaterfall(x, z, width = 1.3) {
  const floor = mineGroundHeight(x, z)
  const top = caveHeight(x, z) - 1.1
  const fall = mesh(new THREE.PlaneGeometry(width, top - floor), mats.caveWater, 'Cavern Waterfall')
  fall.position.set(x, floor + (top - floor) / 2, z)
  fall.rotation.y = Math.PI / 2
  return fall
}

function caveColumn(x, z, scale = 1, seed = 0) {
  const group = new THREE.Group()
  group.name = 'Natural Cave Column'
  const floor = mineGroundHeight(x, z)
  group.position.set(x, floor, z)
  group.userData.colliderRadius = 0.72 * scale
  const height = caveHeight(x, z) - floor
  const trunk = mesh(new THREE.CylinderGeometry(0.75 * scale, 1.15 * scale, height, 9, 4), mats.mineWall, 'Weathered Stone Column')
  trunk.position.y = height / 2
  trunk.rotation.y = seeded(seed, 4400) * Math.PI
  group.add(trunk)
  for (let index = 0; index < 4; index += 1) {
    const shelf = mesh(new THREE.DodecahedronGeometry((0.55 + index * 0.11) * scale, 1), index % 2 ? mats.stoneDark : mats.mineWall, 'Column Shelf')
    shelf.position.set((seeded(index, seed + 4500) - 0.5) * 0.6, 1.2 + index * (height - 2) / 4, (seeded(index, seed + 4600) - 0.5) * 0.6)
    shelf.scale.set(1.45, 0.52, 1.15)
    shelf.rotation.y = index * 1.37
    group.add(shelf)
  }
  return group
}

function cavernSpur(x, z, radiusX, radiusZ, height, seed = 0) {
  const group = new THREE.Group()
  group.name = 'Sculpted Cavern Spur'
  group.position.set(x, mineGroundHeight(x, z) - 0.12, z)
  group.userData.colliderRadius = Math.min(radiusX, radiusZ) * 0.52
  const sides = 13
  const rings = [
    { y: 0, scale: 1 },
    { y: height * 0.42, scale: 0.78 },
    { y: height * 0.76, scale: 0.54 },
    { y: height, scale: 0.28 },
  ]
  const positions = []
  const uvs = []
  const indices = []
  rings.forEach((ring, ringIndex) => {
    for (let side = 0; side < sides; side += 1) {
      const angle = side / sides * Math.PI * 2
      const wobble = 0.84 + seeded(side + ringIndex * sides, seed + 6600) * 0.24
      positions.push(Math.cos(angle) * radiusX * ring.scale * wobble, ring.y + (seeded(side, seed + ringIndex * 70) - 0.5) * 0.28, Math.sin(angle) * radiusZ * ring.scale * wobble)
      uvs.push(side / sides * 3, ringIndex / (rings.length - 1) * 2)
    }
  })
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides
      const a = ring * sides + side
      const b = ring * sides + next
      const c = (ring + 1) * sides + side
      const d = (ring + 1) * sides + next
      indices.push(a, c, b, b, c, d)
    }
  }
  const topCenter = positions.length / 3
  positions.push(0, height + 0.08, 0)
  uvs.push(1.5, 2.3)
  const lastRing = (rings.length - 1) * sides
  for (let side = 0; side < sides; side += 1) indices.push(lastRing + side, topCenter, lastRing + (side + 1) % sides)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  group.add(mesh(geometry, mats.mineStrata, 'Continuous Rock Spur'))
  return group
}

function stalactite(x, z, length = 1.5, scale = 1) {
  const spike = mesh(new THREE.ConeGeometry(0.46 * scale, length, 7), mats.mineWall, 'Natural Stalactite')
  spike.position.set(x, caveHeight(x, z) - length / 2 + 0.1, z)
  spike.rotation.z = (seeded(Math.round(x * 13 + z * 7), 4750) - 0.5) * 0.16
  return spike
}

function stalagmiteCluster(x, z, scale = 1, seed = 0) {
  const group = new THREE.Group()
  group.name = 'Natural Stalagmite Cluster'
  group.position.set(x, mineGroundHeight(x, z), z)
  group.userData.colliderRadius = 0.48 * scale
  for (let index = 0; index < 5; index += 1) {
    const height = (0.85 + seeded(index, seed + 4810) * 1.65) * scale
    const spike = mesh(new THREE.ConeGeometry((0.22 + height * 0.12), height, 7), index % 3 ? mats.mineWall : mats.stoneDark, 'Floor Stalagmite')
    const angle = seeded(index, seed + 4820) * Math.PI * 2
    const radius = 0.22 + seeded(index, seed + 4830) * 0.58 * scale
    spike.position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius)
    spike.rotation.z = (seeded(index, seed + 4840) - 0.5) * 0.14
    group.add(spike)
  }
  return group
}

function caveRubble(x, z, scale = 1, seed = 0) {
  const group = new THREE.Group()
  group.name = 'Settled Cave Rubble'
  group.position.set(x, mineGroundHeight(x, z) + 0.03, z)
  for (let index = 0; index < 7; index += 1) {
    const angle = seeded(index, seed + 7200) * Math.PI * 2
    const distance = 0.35 + seeded(index, seed + 7210) * 1.25 * scale
    const size = (0.22 + seeded(index, seed + 7220) * 0.34) * scale
    const stone = mesh(new THREE.DodecahedronGeometry(size, 0), index % 3 ? mats.mineWall : mats.stoneDark, 'Loose Cavern Stone')
    stone.position.set(Math.cos(angle) * distance, size * 0.34, Math.sin(angle) * distance)
    stone.scale.set(1.15 + seeded(index, seed + 7230) * 0.6, 0.38 + seeded(index, seed + 7240) * 0.25, 0.9 + seeded(index, seed + 7250) * 0.5)
    stone.rotation.set(seeded(index, seed + 7260) * 0.35, seeded(index, seed + 7270) * Math.PI, seeded(index, seed + 7280) * 0.28)
    group.add(stone)
  }
  return group
}

function lanternLandmark() {
  const group = new THREE.Group()
  group.name = 'Lantern Hearth'
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2
    const stone = rock(Math.cos(angle) * 1.25, Math.sin(angle) * 1.25, 0.42, i % 2 === 0)
    group.add(stone)
  }
  const stump = mesh(new THREE.CylinderGeometry(0.58, 0.68, 0.72, 9), mats.barkLight, 'Meeting Stump')
  stump.position.y = 0.36
  const post = mesh(new THREE.CylinderGeometry(0.11, 0.16, 2.45, 7), mats.bark, 'Lantern Post')
  post.position.set(0, 1.62, 0)
  const crossbar = beamBetween([0, 2.64, 0], [.74, 2.64, 0], .09, mats.barkLight)
  const hanger = beamBetween([.68, 2.66, 0], [.68, 2.25, 0], .035, mats.stoneDark)
  const lanternAmber = material('Lantern Amber', 0xe19b43, { roughness: .48 })
  lanternAmber.emissive = new THREE.Color(0xc6651e)
  lanternAmber.emissiveIntensity = 1.15
  const lamp = mesh(new THREE.CylinderGeometry(.25, .29, .55, 6), lanternAmber, 'Warm Woodland Lantern')
  lamp.position.set(.68, 2.02, 0)
  const lampCap = mesh(new THREE.ConeGeometry(.34, .22, 6), mats.stoneDark, 'Lantern Cap')
  lampCap.position.set(.68, 2.4, 0)
  const lampBase = mesh(new THREE.CylinderGeometry(.29, .24, .12, 6), mats.stoneDark, 'Lantern Base')
  lampBase.position.set(.68, 1.7, 0)
  group.add(stump, post, crossbar, hanger, lamp, lampCap, lampBase)
  group.position.set(2.6, 0, 1.8)
  return group
}

function merchantRest(x, z, heightAt, stone = false, rotation = 0) {
  const group = new THREE.Group()
  group.name = stone ? 'Wandering Merchant Stone Seat' : 'Wandering Merchant Stump'
  group.position.set(x, heightAt(x, z), z)
  group.rotation.y = rotation
  const seat = stone
    ? mesh(new THREE.DodecahedronGeometry(.64, 1), mats.mineWall, 'Weathered Merchant Seat')
    : mesh(new THREE.CylinderGeometry(.48, .58, .62, 9), mats.barkLight, 'Merchant Resting Stump')
  seat.position.y = stone ? .31 : .3
  if (stone) seat.scale.set(1.08, .52, .88)
  const satchel = mesh(new RoundedBoxGeometry(.5, .42, .25, 4, .09), mats.bark, 'Merchant Travel Satchel')
  satchel.position.set(.67, .25, .2)
  satchel.rotation.y = -.2
  group.add(seat, satchel)
  if (stone) {
    // A shallow authored nook blocks long sightlines while preserving a broad,
    // snag-free opening toward the cavern. The merchant remains discoverable
    // from nearby paths without reading as a shop placed in an open arena.
    group.add(
      authoredRock('Rock3', [-1.2, .2, 1.35], [1.0, .95, .78], [.04, .42, -.03], mats.mineStrata),
      authoredRock('Rock2', [1.15, .12, 1.42], [.92, .82, .8], [-.03, -.5, .02], mats.mineWall),
      authoredRock('Rock1', [0, .08, 1.75], [1.05, .72, .72], [.02, .18, 0], mats.mineWall),
    )
  }
  return group
}

function enhancementForge() {
  const group = new THREE.Group()
  group.name = 'Enhancement Forge'
  const pad = mesh(new THREE.CylinderGeometry(1.62, 1.75, 0.12, 12), mats.stoneDark, 'Forge Stone Pad')
  pad.position.y = 0.06
  const stump = mesh(new THREE.CylinderGeometry(0.62, 0.74, 0.76, 9), mats.barkLight, 'Forge Work Stump')
  stump.position.set(-0.35, 0.45, 0)
  const anvilBase = mesh(new RoundedBoxGeometry(0.7, 0.35, 0.58, 4, 0.1), mats.stoneDark, 'Woodland Anvil Base')
  anvilBase.position.set(-0.35, 0.87, 0)
  const anvilTop = mesh(new RoundedBoxGeometry(1.18, 0.24, 0.52, 4, 0.09), mats.richOre, 'Copper Anvil Top')
  anvilTop.position.set(-0.2, 1.12, 0)
  const horn = mesh(new THREE.ConeGeometry(0.24, 0.72, 7), mats.richOre, 'Anvil Horn')
  horn.rotation.z = -Math.PI / 2
  horn.position.set(0.63, 1.14, 0)
  const emberBowl = mesh(new THREE.CylinderGeometry(0.46, 0.34, 0.18, 10), mats.stone, 'Ember Bowl')
  emberBowl.position.set(0.82, 0.31, 0.12)
  const ember = mesh(new THREE.IcosahedronGeometry(0.29, 1), mats.furnaceFire, 'Animated_ForgeEmber')
  ember.scale.set(1.1, 0.48, 0.84)
  ember.position.set(0.82, 0.48, 0.12)
  const rackLeft = beamBetween([-1.18, 0.12, 0.72], [-1.18, 1.75, 0.72], 0.08, mats.bark)
  const rackRight = beamBetween([1.18, 0.12, 0.72], [1.18, 1.75, 0.72], 0.08, mats.bark)
  const rackTop = beamBetween([-1.28, 1.66, 0.72], [1.28, 1.66, 0.72], 0.08, mats.barkLight)
  const displayedTool = beamBetween([0.15, 0.78, 0.69], [0.15, 1.58, 0.69], 0.045, mats.richOre)
  const toolHead = mesh(new RoundedBoxGeometry(0.68, 0.14, 0.12, 3, 0.04), mats.stoneOre, 'Forge Tool Display')
  toolHead.position.set(0.15, 1.57, 0.69)
  group.add(pad, stump, anvilBase, anvilTop, horn, emberBowl, ember, rackLeft, rackRight, rackTop, displayedTool, toolHead)
  return group
}

function anchor(name, position) {
  const value = new THREE.Object3D()
  value.name = `Anchor_${name}`
  value.position.set(...position)
  return value
}

function addForestFrame(scene, treeData) {
  treeData.forEach(([x, z, scale, rotation, dark]) => scene.add(tree(x, z, scale, rotation, dark)))
  const shrubs = [
    [-17, -15, 1.2], [-12, -20, 1], [-6, -25, 1.2], [7, -25, 1.1], [13, -20, 1.2], [18, -14, 1],
    [-24, -6, 1.1], [24, -7, 1.2], [-25, 7, 1], [25, 8, 1.1], [-18, 18, 1.1], [17, 19, 1.2],
  ]
  shrubs.forEach(([x, z, s], i) => scene.add(shrub(x, z, s, i % 3 === 0)))
}

function hubScene() {
  const scene = new THREE.Scene()
  scene.name = 'Lantern Hollow Hub'
  scene.add(terrain(72, hubGroundHeight))
  scene.add(pathRibbon([[0, 19], [0, 10], [0, 1], [0, -12], [0, -28]], 2.2, 'Forage Path', hubGroundHeight))
  scene.add(pathRibbon([[0, 1], [-6, -7], [-11, -15], [-15, -22]], 1.95, 'Farm Path', hubGroundHeight))
  scene.add(pathRibbon([[0, 1], [6, -7], [11, -15], [15, -22]], 1.95, 'Mine Path', hubGroundHeight))
  scene.add(pathRibbon([[-1, 11], [-5, 7], [-11, 3]], 1.35, 'Exchange Path', hubGroundHeight))
  scene.add(pathRibbon([[1, 11], [5, 7], [11, 3]], 1.35, 'Market Path', hubGroundHeight))
  scene.add(portal('Forage', mats.glassForage, [0, hubGroundHeight(0, -28), -28], 0))
  scene.add(portal('Farm', mats.glassFarm, [-15, hubGroundHeight(-15, -22), -22], Math.PI / 5.2))
  scene.add(portal('Mine', mats.glassMine, [15, hubGroundHeight(15, -22), -22], -Math.PI / 5.2))
  const commonShop = [11, hubGroundHeight(11, 3), 3]
  const exchange = [-11, hubGroundHeight(-11, 3), 3]
  const commonRotation = Math.PI - 0.18
  const exchangeRotation = Math.PI + 0.18
  const commonFront = shopOffset(commonShop, commonRotation, -1.78)
  const commonNpc = shopOffset(commonShop, commonRotation, 0.3)
  const exchangeFront = shopOffset(exchange, exchangeRotation, -1.78)
  const exchangeNpc = shopOffset(exchange, exchangeRotation, 0.3)
  scene.add(shop('Common Shop', commonShop, commonRotation, mats.leafDark))
  scene.add(stockExchange(exchange, exchangeRotation))
  const hearth = lanternLandmark(); hearth.position.set(0, hubGroundHeight(0, 0), 0); hearth.scale.setScalar(1.12); scene.add(hearth)
  const forgePosition = [6.8, hubGroundHeight(6.8, -1), -1]
  const forge = enhancementForge(); forge.position.set(...forgePosition); forge.rotation.y = -Math.PI / 2; scene.add(forge)
  const hubClusters = [[-28,-14,9,8],[29,-15,9,8],[-23,20,9,9],[23,21,9,9],[0,-55,16,14],[-39,-37,13,12],[39,-38,13,12],[-53,-17,14,15],[53,-18,14,15],[-54,22,15,16],[54,24,15,16],[-32,45,15,16],[33,46,15,16],[0,55,13,15],[-63,1,12,13],[63,0,12,13]]
  hubClusters.forEach(([x,z,count,radius], index) => scatterCluster(scene, x, z, count, radius, hubGroundHeight, 1800 + index * 29, 1.42 + (index % 3) * 0.16))
  const closeGrove = [
    [-17,16,2.35],[-22,10,2.1],[-19,1,2.55],[-23,-8,2.2],[-29,-15,2.45],
    [18,15,2.2],[23,9,2.5],[20,0,2.25],[24,-9,2.55],[30,-16,2.25],
    [-15,-34,2.35],[-10,-43,2.65],[-4,-50,2.25],[4,-51,2.55],[11,-44,2.3],[16,-35,2.65],
    [-15,30,2.5],[-7,36,2.25],[5,38,2.65],[15,31,2.35],
  ]
  closeGrove.forEach(([x,z,scale], index) => {
    scene.add(natureTree(x, z, scale, index * 0.79, hubGroundHeight, 2200 + index))
    scene.add(natureBush(x + (index % 2 ? 1.5 : -1.3), z - 0.8, 1.15 + (index % 3) * 0.16, index, hubGroundHeight, index))
  })
  // A staggered canopy behind the portals closes the horizon while preserving
  // the three clean portal sightlines. Large silhouettes add depth without
  // adding the hundreds of extra small trees that hurt browser performance.
  ;[
    [-39,-43,3.28,1],[-30,-55,3.02,3],[-21,-63,3.36,5],[-9,-59,3.08,8],
    [8,-62,3.34,6],[21,-64,3.08,5],[31,-54,3.42,3],[40,-43,3.16,1],
  ].forEach(([x,z,scale,variant], index) => {
    scene.add(natureTree(x, z, scale, index * 0.83 + 0.24, hubGroundHeight, variant))
    if (index % 2 === 0) scene.add(natureBush(x + 1.8, z + 1.2, 1.3, index * .61, hubGroundHeight, 2700 + index))
  })
  // Large side silhouettes frame the playable clearing from the spawn camera.
  // They sit outside all interaction routes and use fuller maple crowns, so
  // they add composition rather than another evenly spaced row of trunks.
  ;[
    [-33,17,3.25,5],[-38,-3,3.48,3],[-34,-22,3.16,8],
    [34,18,3.34,6],[39,-2,3.5,1],[35,-23,3.22,5],
  ].forEach(([x,z,scale,variant], index) => {
    scene.add(natureTree(x, z, scale, index * 1.07 + .3, hubGroundHeight, variant))
    scene.add(natureBush(x + (index < 3 ? 2.2 : -2.2), z - 1.1, 1.45 + (index % 2) * .2, index * .73, hubGroundHeight, 2800 + index))
  })
  for (let index = 0; index < 260; index += 1) {
    const x = -62 + seeded(index, 1881) * 124
    const z = -56 + seeded(index, 1889) * 116
    if (Math.hypot(x, z) < 17 || Math.abs(x) < 3.2 || Math.abs(z) < 3.2) continue
    scene.add(natureGrass(x, z, 0.7 + seeded(index, 1897) * 0.8, seeded(index, 1901) * Math.PI * 2, hubGroundHeight))
  }
  ;[[-9,-9],[-6,-13],[8,-10],[11,-6],[-15,7],[15,6],[-7,18],[7,19]].forEach(([x,z], index) => {
    scene.add(natureGrass(x, z, 0.82 + (index % 3) * 0.12, index * 0.67, hubGroundHeight))
    scene.add(natureFlowers(x + 0.8, z - 0.45, 0.46, index * 0.41, hubGroundHeight))
  })
  scene.add(
    boulderFormation(-20, -31, 1.4, 0.28, hubGroundHeight), boulderFormation(20, -31, 1.45, -0.32, hubGroundHeight),
    boulderFormation(-32, 2, 1.25, 0.14, hubGroundHeight), boulderFormation(33, 1, 1.3, -0.18, hubGroundHeight),
    fallenLog(-18, 30, 5.4, 0.3, hubGroundHeight), fallenLog(21, 34, 5.8, -0.36, hubGroundHeight),
  )
  scene.add(
    // Start close enough that the lantern fork and all three destination
    // silhouettes read immediately, without a long empty approach.
    anchor('Spawn', [0, hubGroundHeight(0, 14), 14]),
    anchor('PortalForage', [0, hubGroundHeight(0, -28), -28]),
    anchor('PortalFarm', [-15, hubGroundHeight(-15, -22), -22]),
    anchor('PortalMine', [15, hubGroundHeight(15, -22), -22]),
    anchor('Shop', [commonFront[0], hubGroundHeight(...commonFront), commonFront[1]]),
    anchor('Stocks', [exchangeFront[0], hubGroundHeight(...exchangeFront), exchangeFront[1]]),
    anchor('LabelShop', commonShop),
    anchor('LabelStocks', exchange),
    anchor('Enhance', [5.05, hubGroundHeight(5.05, -1), -1]),
    anchor('LabelEnhance', [6.8, hubGroundHeight(6.8, -1), -1]),
    anchor('NpcShop', [commonNpc[0], hubGroundHeight(...commonNpc), commonNpc[1]]),
    anchor('NpcStocks', [exchangeNpc[0], hubGroundHeight(...exchangeNpc), exchangeNpc[1]]),
  )
  return scene
}

function forageScene() {
  const scene = new THREE.Scene()
  scene.name = 'Mosswood Forage Grove'
  scene.add(terrain(235, forageGroundHeight))
  scene.add(pathRibbon(forageTrail, 2.25, 'Old Forest Trail', forageGroundHeight))
  scene.add(pathRibbon([[-5, -14], [-17, -22], [-27, -37], [-43, -51]], 1.55, 'West Orchard Trail', forageGroundHeight))
  scene.add(pathRibbon([[7, -48], [22, -54], [36, -67], [49, -78]], 1.45, 'Sunlit Thicket Trail', forageGroundHeight))
  scene.add(pathRibbon([[-8, -91], [-27, -98], [-40, -112]], 1.4, 'Old Stone Trail', forageGroundHeight))
  scene.add(pathRibbon([[0, -145], [25, -155], [48, -169], [68, -188]], 1.85, 'Deep Orchard Trail', forageGroundHeight))
  scene.add(pathRibbon([[-1, -158], [-24, -169], [-47, -184], [-69, -202]], 1.4, 'Fern Hollow Trail', forageGroundHeight))
  const homePosition = [-16, forageGroundHeight(-16, -64), -64]
  const home = portal('Home', mats.glassHome, homePosition, Math.PI / 2)
  home.name = 'Home Portal Landmark'
  scene.add(home)
  const forageShopY = forageGroundHeight(5.9, -76)
  const forageBuyerY = forageGroundHeight(-5.9, -76)
  const forageShopPosition = [5.9, forageShopY, -76]
  const forageBuyerPosition = [-5.9, forageBuyerY, -76]
  const forageShopRotation = Math.PI - 0.32
  const forageBuyerRotation = Math.PI + 0.32
  const forageShopFront = shopOffset(forageShopPosition, forageShopRotation, -1.78)
  const forageShopNpc = shopOffset(forageShopPosition, forageShopRotation, 0.3)
  const forageBuyerFront = shopOffset(forageBuyerPosition, forageBuyerRotation, -1.78)
  const forageBuyerNpc = shopOffset(forageBuyerPosition, forageBuyerRotation, 0.3)
  scene.add(pathRibbon([[0,-70],[2.2,-72.5],[4.4,-74.5],[5.9,-76]], .82, 'Foraging Shop Path', forageGroundHeight))
  scene.add(pathRibbon([[0,-70],[-2.2,-72.5],[-4.4,-74.5],[-5.9,-76]], .82, 'Forage Market Path', forageGroundHeight))
  scene.add(shop('Foraging Shop', forageShopPosition, forageShopRotation, mats.leafDark))
  scene.add(shop('Forage Market', forageBuyerPosition, forageBuyerRotation, mats.fruitGold))

  // Frame the arrival clearing as woodland without crowding its readable fork.
  // Uneven pairs avoid the old evenly spaced perimeter while preserving clear
  // sightlines to both specialists and the first distant fruit silhouettes.
  ;[
    [-25,-57,1.28,731], [22,-55,1.13,739], [-32,-71,1.18,743], [30,-75,1.34,751],
    [-29,-91,1.38,757], [34,-92,1.16,761], [-18,-108,1.22,769], [24,-111,1.31,773],
  ].forEach(([x,z,scale,variant], index) => {
    scene.add(natureTree(x, z, scale * 1.16, seeded(index, 7771) * Math.PI * 2, forageGroundHeight, variant))
    scene.add(natureBush(x + (index % 2 ? -1.8 : 1.7), z + (index % 3 - 1) * 1.1, .78 + (index % 3) * .12, index * .53, forageGroundHeight, variant + 19))
  })

  // Irregular woodland distribution, authored at build time. A grid remained
  // visible even after scale and model changes, so accepted sites now use
  // minimum spacing with real trail clearances. This creates continuous canopy
  // rhythm with a few natural pockets instead of rows or isolated tree patches.
  const sideTrails = [
    [[-5, -14], [-17, -22], [-27, -37], [-43, -51]],
    [[7, -48], [22, -54], [36, -67], [49, -78]],
    [[-8, -91], [-27, -98], [-40, -112]],
    [[0, -145], [25, -155], [48, -169], [68, -188]],
    [[-1, -158], [-24, -169], [-47, -184], [-69, -202]],
  ]
  const forestSites = []
  for (let candidate = 0; candidate < 5600 && forestSites.length < 660; candidate += 1) {
    const x = -208 + seeded(candidate, 3021) * 416
    const z = 40 - seeded(candidate, 3037) * 262
    const nearRoute = distanceToPolyline(x, z, forageTrail) < 7.3 || sideTrails.some((trail) => distanceToPolyline(x, z, trail) < 5.6)
    const nearHome = Math.hypot(x, z + 64) < 14
    const nearSpecialists = Math.hypot(x, z + 76) < 19
    const spacing = 7.1 + seeded(candidate, 3043) * 1.5
    if (nearRoute || nearHome || nearSpecialists || forestSites.some(([px, pz]) => Math.hypot(x - px, z - pz) < spacing)) continue
    const forestIndex = forestSites.length
    forestSites.push([x, z])
    const rotation = seeded(candidate, 3049) * Math.PI * 2
    const broadleaf = seeded(candidate, 3053) < .57
    scene.add(broadleaf
      ? broadleafTree(x, z, 2.42 + seeded(candidate, 3059) * 1.02, rotation, forageGroundHeight, 3100 + candidate)
      : natureTree(x, z, 1.52 + seeded(candidate, 3061) * .96, rotation, forageGroundHeight, 3100 + candidate))
    if (forestIndex % 3 === 0) {
      const underAngle = seeded(candidate, 3067) * Math.PI * 2
      scene.add(natureBush(
        x + Math.cos(underAngle) * 1.4,
        z + Math.sin(underAngle) * 1.4,
        .7 + seeded(candidate, 3079) * .45,
        rotation + .7,
        forageGroundHeight,
        candidate,
      ))
    }
  }

  for (let index = 0; index < 170; index += 1) {
    const x = -102 + seeded(index, 751) * 204
    const z = 20 - seeded(index, 757) * 232
    const center = trailCenterAt(z)
    if (Math.abs(x - center) < 3.7 || Math.hypot(x, z - 24) < 8) continue
    scene.add(fernPatch(x, z, 0.72 + seeded(index, 761) * 0.72, seeded(index, 769) * Math.PI * 2))
  }
  ;[[-7,9], [7,5], [-9,-2], [10,-10], [-13,-19], [14,-28], [-17,-41], [18,-52], [-12,-118], [13,-129], [-14,-143], [15,-153], [-9,-166], [17,-181], [-11,-196]].forEach(([x, z], index) => {
    scene.add(fernPatch(x, z, 0.86 + (index % 3) * 0.12, index * 0.73))
  })

  for (let index = 0; index < 360; index += 1) {
    const x = -205 + seeded(index, 701) * 410
    const z = 48 - seeded(index, 709) * 266
    const center = trailCenterAt(z)
    if (Math.abs(x - center) < 4.2 || Math.hypot(x, z - 24) < 8) continue
    const scale = 0.9 + seeded(index, 719) * 1.05
    scene.add(natureGrass(x, z, scale, seeded(index, 727) * Math.PI * 2, forageGroundHeight, index))
    if (index % 5 === 0) scene.add(natureFlowers(x + 0.7, z - 0.5, 0.5 + seeded(index, 733) * 0.55, seeded(index, 739) * Math.PI * 2, forageGroundHeight))
  }

  scene.add(
    boulderFormation(-41, -55, 2.2, 0.4), boulderFormation(48, -76, 2.4, -0.35),
    boulderFormation(-38, -113, 2.5, 0.18), fallenLog(-24, -45, 6.4, 0.25),
    fallenLog(27, -102, 7.2, -0.28), boulderFormation(16, -149, 1.15, -0.22),
    fallenLog(-17, -160, 5.6, 0.31),
  )

  const fruitSites = Array.from({ length: 130 }, (_, index) => {
    const columns = 13
    const rows = 10
    const column = index % columns
    const row = Math.floor(index / columns)
    let x = -174 + (348 * (column + 0.5)) / columns + (seeded(index, 6173) - 0.5) * 9
    const z = -22 - (178 * (row + 0.5)) / rows + (seeded(index, 6174) - 0.5) * 7
    const trail = trailCenterAt(z)
    if (Math.abs(x - trail) < 9) x += x <= trail ? -13 : 13
    return [THREE.MathUtils.clamp(x, -188, 188), z]
  })
  const apples = fruitSites.filter((_, index) => index % 2 === 0 || index >= 120)
  const oranges = fruitSites.filter((_, index) => index % 2 === 1 && index < 120)
  const regularOrchardTrees = []
  const truffles = [[-112,-66],[97,-104],[-78,-204],[126,-167],[34,-151]]
  const discoveries = [[-178,-185],[164,-201],[-139,-16]]

  apples.forEach(([x, z], index) => scene.add(fruitBirch(`ForageApple${String(index).padStart(3, '0')}`, x, z, index < 2 ? 1.14 : 1 + (index % 3) * 0.08, index * 0.71, forageGroundHeight, false, index)))
  oranges.forEach(([x, z], index) => scene.add(fruitBirch(`ForageOrange${String(index).padStart(3, '0')}`, x, z, index === 0 ? 1.1 : 0.96 + (index % 4) * 0.07, index * 0.83, forageGroundHeight, true, index + 80)))
  regularOrchardTrees.forEach(([x, z], index) => scene.add(natureTree(x, z, 0.96 + (index % 5) * 0.07, index * 0.77, forageGroundHeight, 7400 + index)))
  truffles.forEach(([x, z], index) => scene.add(trufflePatch(`ForageTruffle${String(index).padStart(3, '0')}`, x, z, index * 0.69, forageGroundHeight)))
  discoveries.forEach(([x, z], index) => scene.add(discoveryRelic(`ForageDiscovery${String(index).padStart(2, '0')}`, x, z, index * 0.83, forageGroundHeight)))
  scene.add(
    merchantRest(-43, -51, forageGroundHeight),
    merchantRest(49, -78, forageGroundHeight),
    merchantRest(-40, -112, forageGroundHeight),
  )
  scene.add(
    anchor('Spawn', [0, forageGroundHeight(0, -69), -69]),
    anchor('GateDeep', [4, forageGroundHeight(4, -174), -174]),
    anchor('Home', homePosition),
    anchor('ForageShop', [forageShopFront[0], forageGroundHeight(...forageShopFront), forageShopFront[1]]),
    anchor('ForageBuyer', [forageBuyerFront[0], forageGroundHeight(...forageBuyerFront), forageBuyerFront[1]]),
    anchor('LabelForageShop', forageShopPosition),
    anchor('LabelForageBuyer', forageBuyerPosition),
    anchor('NpcForageShop', [forageShopNpc[0], forageGroundHeight(...forageShopNpc), forageShopNpc[1]]),
    anchor('NpcForageBuyer', [forageBuyerNpc[0], forageGroundHeight(...forageBuyerNpc), forageBuyerNpc[1]]),
    anchor('SecretSite0', [-43, forageGroundHeight(-43, -51), -51]),
    anchor('SecretSite1', [49, forageGroundHeight(49, -78), -78]),
    anchor('SecretSite2', [-40, forageGroundHeight(-40, -112), -112]),
  )
  apples.forEach(([x, z], index) => scene.add(anchor(`ForageApple${String(index).padStart(3, '0')}`, [x, forageGroundHeight(x, z) + 2.45, z])))
  oranges.forEach(([x, z], index) => scene.add(anchor(`ForageOrange${String(index).padStart(3, '0')}`, [x, forageGroundHeight(x, z) + 2.45, z])))
  truffles.forEach(([x, z], index) => scene.add(anchor(`ForageTruffle${String(index).padStart(3, '0')}`, [x, forageGroundHeight(x, z), z])))
  discoveries.forEach(([x, z], index) => scene.add(anchor(`ForageDiscovery${String(index).padStart(2, '0')}`, [x, forageGroundHeight(x, z), z])))
  return scene
}

function farmScene() {
  const scene = new THREE.Scene()
  scene.name = 'Sunmeadow Farmstead'
  scene.add(terrain(118, farmGroundHeight))
  scene.add(pathRibbon([[0, 24], [0, 13], [0, 2], [0, -18], [0, -43], [0, -75]], 2.35, 'Farmstead Lane', farmGroundHeight))
  scene.add(pathRibbon([[-79, 1], [-55, 0], [-18, -1], [19, -1], [56, 0], [79, 2]], 2.35, 'North Farm Lane', farmGroundHeight))
  scene.add(pathRibbon([[-79, -32], [-54, -32], [-18, -32], [20, -32], [57, -32], [80, -31]], 2.35, 'South Farm Lane', farmGroundHeight))
  scene.add(pathRibbon([[-1, 13], [-4, 11], [-7, 9]], 1.4, 'Seed Shop Path', farmGroundHeight))
  scene.add(pathRibbon([[1, 13], [4, 11], [7, 9]], 1.4, 'Produce Stand Path', farmGroundHeight))
  scene.add(pathRibbon([[2, 13], [9, 12], [16, 10]], 1.35, 'Food Market Path', farmGroundHeight))
  const homeY = farmGroundHeight(0, 27)
  scene.add(portal('Home', mats.glassHome, [0, homeY, 27], Math.PI))
  farmParcels.forEach(([x, z], index) => scene.add(farmParcel(x, z, index)))
  farmParcels.forEach(([x, z], index) => {
    const laneZ = index < 4 ? -1 : -32
    scene.add(pathRibbon([[x + 9.1, laneZ], [x + 9.1, z]], 2.05, `Farm ${index + 1} Entry Path`, farmGroundHeight))
  })
  farmParcels.forEach(([x, z], index) => scene.add(farmFurnacePad(x - 8.8, z + 4.8, index)))
  const farmShopY = farmGroundHeight(-5.8, 9)
  const buyerY = farmGroundHeight(5.8, 9)
  const foodBuyerY = farmGroundHeight(15.5, 9)
  const farmShopPosition = [-5.8, farmShopY, 9]
  const buyerPosition = [5.8, buyerY, 9]
  const foodBuyerPosition = [15.5, foodBuyerY, 9]
  const farmShopRotation = Math.PI + 0.16
  const buyerRotation = Math.PI - 0.16
  const foodBuyerRotation = Math.PI - 0.16
  const farmShopFront = shopOffset(farmShopPosition, farmShopRotation, -1.78)
  const farmShopNpc = shopOffset(farmShopPosition, farmShopRotation, 0.3)
  const buyerFront = shopOffset(buyerPosition, buyerRotation, -1.78)
  const buyerNpc = shopOffset(buyerPosition, buyerRotation, 0.3)
  const foodBuyerFront = shopOffset(foodBuyerPosition, foodBuyerRotation, -1.78)
  const foodBuyerNpc = shopOffset(foodBuyerPosition, foodBuyerRotation, 0.3)
  scene.add(
    shop('Farm Shop', farmShopPosition, farmShopRotation, mats.glassFarm),
    shop('Produce Stand', buyerPosition, buyerRotation, mats.leaf),
    shop('Food Market', foodBuyerPosition, foodBuyerRotation, mats.richOre),
    farmBuildingAsset('Barn', [0, farmGroundHeight(0, -88), -88], 1.34, Math.PI),
    farmBuildingAsset('Windmill', [74, farmGroundHeight(74, -82), -82], 1.12, -.18),
    hayStack(-78, -30, 0.35), hayStack(77, -69, -0.4), hayStack(10, -86, 0.12),
  )

  const farmClusters = [[-24, 9, 5, 4], [25, 7, 5, 4], [-42, 15, 7, 7], [42, 11, 7, 7], [-78, -7, 7, 9], [78, -36, 7, 9], [-78, -79, 7, 9], [78, -87, 7, 9], [-92, 31, 11, 18], [91, 27, 10, 17], [-102, -16, 11, 19], [101, -25, 11, 19], [-100, -70, 12, 20], [98, -77, 12, 20], [-66, -101, 11, 18], [65, -105, 11, 18], [-14, -106, 8, 15], [24, -90, 7, 11], [17, 38, 8, 14]]
  farmClusters.forEach(([x, z, count, radius], index) => {
    const boundaryWindbreak = Math.abs(x) > 70 || z < -82 || z > 24
    scatterCluster(scene, x, z, count, radius, farmGroundHeight, 903 + index * 23, boundaryWindbreak ? 1.58 : 1.18)
  })
  for (let index = 0; index < 150; index += 1) {
    const x = -103 + seeded(index, 1001) * 206
    const z = 32 - seeded(index, 1009) * 137
    const nearParcel = farmParcels.some(([cx, cz]) => Math.abs(x - cx) < 9.5 && Math.abs(z - cz) < 9.5)
    const nearLane = Math.abs(x) < 3.5 || Math.abs(z + 1) < 3 || Math.abs(z + 32) < 3
    if (nearParcel || nearLane || Math.hypot(x + 22, z - 16) < 7 || Math.hypot(x - 22, z - 16) < 7) continue
    scene.add(natureGrass(x, z, 0.8 + seeded(index, 1013) * 0.82, seeded(index, 1019) * Math.PI * 2, farmGroundHeight, index))
    if (index % 6 === 0) scene.add(natureFlowers(x + 0.5, z - 0.4, 0.48, index, farmGroundHeight))
  }

  scene.add(
    merchantRest(-78, -30, farmGroundHeight),
    merchantRest(77, -69, farmGroundHeight),
    merchantRest(10, -86, farmGroundHeight),
  )

  scene.add(
    anchor('Spawn', [0, farmGroundHeight(0, 17), 17]),
    anchor('GateDeep', [20, farmGroundHeight(20, -53), -53]),
    anchor('Home', [0, homeY, 27]),
    anchor('FarmShop', [farmShopFront[0], farmGroundHeight(...farmShopFront), farmShopFront[1]]),
    anchor('ProduceBuyer', [buyerFront[0], farmGroundHeight(...buyerFront), buyerFront[1]]),
    anchor('FoodBuyer', [foodBuyerFront[0], farmGroundHeight(...foodBuyerFront), foodBuyerFront[1]]),
    anchor('LabelFarmShop', farmShopPosition),
    anchor('LabelProduceBuyer', buyerPosition),
    anchor('LabelFoodBuyer', foodBuyerPosition),
    anchor('NpcFarmShop', [farmShopNpc[0], farmGroundHeight(...farmShopNpc), farmShopNpc[1]]),
    anchor('NpcProduceBuyer', [buyerNpc[0], farmGroundHeight(...buyerNpc), buyerNpc[1]]),
    anchor('NpcFoodBuyer', [foodBuyerNpc[0], farmGroundHeight(...foodBuyerNpc), foodBuyerNpc[1]]),
    anchor('SecretSite0', [-78, farmGroundHeight(-78, -30), -30]),
    anchor('SecretSite1', [77, farmGroundHeight(77, -69), -69]),
    anchor('SecretSite2', [10, farmGroundHeight(10, -86), -86]),
  )
  farmParcels.forEach(([farmX, farmZ], farmIndex) => {
    const level = farmGroundHeight(farmX, farmZ)
    scene.add(anchor(`FarmPlot${farmIndex}`, [farmX, level, farmZ]))
    scene.add(anchor(`FarmClaim${farmIndex}`, [farmX + 5.85, level + 0.18, farmZ + 6.25]))
    scene.add(anchor(`FurnacePad${farmIndex}`, [farmX - 8.8, farmGroundHeight(farmX - 8.8, farmZ + 4.8) + 0.12, farmZ + 4.8]))
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        const cellIndex = row * 8 + column
        const x = farmX + (column - 3.5) * 1.42
        const z = farmZ + (row - 3.5) * 1.42
        scene.add(wateredSoilTile(`WateredSoil_${farmIndex}_${String(cellIndex).padStart(2, '0')}`, x, level + 0.145, z, false))
        scene.add(anchor(`FarmCell${farmIndex}_${String(cellIndex).padStart(2, '0')}`, [x, level + 0.14, z]))
      }
    }
  })
  return scene
}

function mineScene() {
  const scene = new THREE.Scene()
  scene.name = 'Stonewake Authored Cavern'
  scene.add(authoredCavern())
  const homePosition = [-17, mineGroundHeight(-17, 9), 9]
  scene.add(portal('Home', mats.glassHome, homePosition, Math.PI / 2))
  const mineShopPosition = [-4.8, mineGroundHeight(-4.8, 2.5), 2.5]
  const oreBuyerPosition = [4.8, mineGroundHeight(4.8, 2.5), 2.5]
  const shopRotation = Math.PI
  const mineShopFront = shopOffset(mineShopPosition, shopRotation, -1.78)
  const mineShopNpc = shopOffset(mineShopPosition, shopRotation, 0.3)
  const oreBuyerFront = shopOffset(oreBuyerPosition, shopRotation, -1.78)
  const oreBuyerNpc = shopOffset(oreBuyerPosition, shopRotation, 0.3)
  scene.add(
    shop('Mining Shop', mineShopPosition, shopRotation, mats.glassMine),
    shop('Ore Stand', oreBuyerPosition, shopRotation, mats.richOre),
  )
  for (const [x, z, scale, rotation] of [
    [-48, 1, 1.8, 0.2], [49, 0, 1.65, -0.5], [-58, -26, 2.1, 0.7], [57, -31, 1.85, -0.3],
    [-49, -47, 1.55, 1.1], [50, -48, 1.75, -0.8], [-59, -72, 2.05, 0.4], [59, -68, 1.75, -0.2],
    [-55, -96, 1.7, 0.8], [55, -94, 1.9, -0.6], [-46, -109, 1.45, 0.2], [47, -108, 1.6, -0.4],
    [-49, -133, 1.85, 0.9], [49, -136, 1.7, -0.7], [-34, -151, 1.45, 0.4], [35, -151, 1.55, -0.3],
    [-15, -34, 1.2, 0.5], [17, -35, 1.15, -0.4], [-18, -89, 1.25, 0.7], [19, -92, 1.2, -0.6],
    [-15, -160, 1.02, 0.35], [16, -176, 1.08, -0.48], [-17, -194, .94, .62], [17, -211, 1.0, -.38], [-14, -230, .9, .26],
  ]) scene.add(mineBoulder(x, z, scale, rotation))

  for (const [x, z, width] of [[0,-28,4.8],[0,-78,4.2]]) {
    const floor = mineGroundHeight(x, z)
    const rib = new THREE.Group(); rib.name = 'Mine Timber Rib'; rib.position.set(x, floor, z)
    const height = Math.min(5.2, caveHeight(x, z) - floor - 0.45)
    rib.add(
      beamBetween([-width,0,0],[-width,height,0],0.2,mats.barkLight),
      beamBetween([width,0,0],[width,height,0],0.2,mats.barkLight),
      beamBetween([-width-0.2,height,0],[width+0.2,height,0],0.22,mats.barkLight),
      beamBetween([-width,height-1.2,0],[-width+1.25,height,0],0.13,mats.bark),
      beamBetween([width,height-1.2,0],[width-1.25,height,0],0.13,mats.bark),
    )
    scene.add(rib)
  }
  scene.add(
    mineTrack(0, -3, 38), mineTrack(-27, -19, 16), mineTrack(28, -21, 13), mineTrack(0, -45, 18, Math.PI / 2),
    mineTrack(-34, -73, 15), mineTrack(35, -76, 16), mineTrack(0, -104, 17, Math.PI / 2),
    mineTrack(-27, -128, 14), mineTrack(29, -127, 13), mineTrack(-10, -174, 18, -0.34), mineTrack(11, -179, 18, 0.32),
    mineTrack(-17, -218, 20, -0.22), mineTrack(18, -222, 18, 0.25),
    caveLantern(-7, 7, 1), caveLantern(-28, -8, 1), caveLantern(29, -10, -1),
    caveLantern(-42, -39, 1), caveLantern(41, -42, -1), caveLantern(-42, -70, 1),
    caveLantern(43, -73, -1), caveLantern(-34, -103, 1), caveLantern(35, -103, -1),
    caveLantern(-31, -139, 1), caveLantern(31, -140, -1),
    decorativeOreSeam(-55, -32, Math.PI / 2), decorativeOreSeam(56, -36, -Math.PI / 2, mats.richOre),
    decorativeOreSeam(-47, -112, Math.PI / 2, mats.richOre), decorativeOreSeam(48, -116, -Math.PI / 2),
    decorativeOreSeam(-20, -178, Math.PI / 2, mats.crystal), decorativeOreSeam(22, -184, -Math.PI / 2, mats.richOre),
    caveColumn(-17, -17, 1.05, 21), caveColumn(19, -21, 1.0, 22),
    caveColumn(-24, -42, 1.35, 1), caveColumn(27, -43, 1.25, 2), caveColumn(-31, -96, 1.45, 3),
    caveColumn(32, -99, 1.3, 4), caveColumn(17, -146, 1.18, 5), caveColumn(-24, -177, 1.32, 6), caveColumn(26, -184, 1.22, 7),
    cavernSpur(-43, -24, 12.5, 10.5, 7.4, 31), cavernSpur(44, -31, 11.2, 9.6, 6.9, 32),
    cavernSpur(-47, -76, 13.6, 11.8, 8.2, 33), cavernSpur(47, -84, 12.4, 10.8, 7.7, 34),
    cavernSpur(-40, -127, 11.6, 10.2, 7.6, 35), cavernSpur(41, -134, 12.8, 10.7, 8.1, 36),
    cavernSpur(-37, -178, 13.2, 11.4, 8.0, 37), cavernSpur(36, -181, 12.6, 11.0, 7.8, 38),
    // Pull the final chamber walls inward in two irregular tiers. These frame
    // the descent and split the deep floor into readable routes without
    // blocking the central ore line.
    cavernSpur(-27, -165, 8.8, 7.3, 4.9, 43), cavernSpur(28, -168, 9.2, 7.7, 5.3, 44),
    cavernSpur(-25, -191, 6.8, 5.7, 3.7, 45), cavernSpur(27, -193, 7.1, 5.9, 4.0, 46),
    cavernSpur(-20, -207, 7.4, 6.3, 6.1, 51), cavernSpur(21, -209, 7.7, 6.5, 6.4, 52),
    cavePool(44, -75, 7.2, 4.6), caveWaterfall(60.4, -78, 1.8),
    cavePool(-39, -123, 6.4, 3.8), cavePool(0, -119, 8.2, 3.9),
    cavePool(10, -196, 5.4, 3.2), cavePool(-17, -232, 7.2, 4.7), caveWaterfall(-43, -232, 1.8),
    caveColumn(-11, -124, 1.08, 41), caveColumn(13, -130, 1.18, 42), caveColumn(-26, -224, 1.38, 49), caveColumn(27, -235, 1.24, 50),
    caveLantern(-4, -111, 1), caveLantern(-5, -169, 1), caveLantern(8, -192, -1), caveLantern(-13, -218, 1), caveLantern(15, -231, -1),
    stalagmiteCluster(-51, -8, 1.05, 11), stalagmiteCluster(51, -10, 1.0, 12),
    stalagmiteCluster(-53, -19, 1.35, 13), stalagmiteCluster(52, -25, 1.3, 14),
    stalagmiteCluster(-55, -82, 1.5, 15), stalagmiteCluster(55, -90, 1.4, 16),
    stalagmiteCluster(-18, -102, 1.15, 17), stalagmiteCluster(19, -105, 1.25, 18),
    stalagmiteCluster(-43, -144, 1.2, 19), stalagmiteCluster(43, -141, 1.25, 20),
    stalagmiteCluster(-38, -215, 1.35, 21), stalagmiteCluster(39, -221, 1.28, 22), stalagmiteCluster(2, -245, 1.5, 23),
  )
  for (const [x, z, scale, seed] of [
    [-24,-2,1.1,81],[25,-4,1.0,82],[-42,-18,1.25,83],[43,-21,1.15,84],[-29,-39,1.2,85],[31,-41,1.15,86],
    [-20,-54,1.05,87],[22,-56,1.1,88],[-48,-67,1.25,89],[49,-70,1.2,90],[-28,-88,1.15,91],[29,-91,1.15,92],
    [-46,-104,1.25,93],[47,-106,1.1,94],[-19,-113,1.1,95],[20,-115,1.15,96],[-43,-132,1.2,97],[44,-134,1.25,98],
    [-23,-149,1.1,99],[24,-149,1.0,100],[-34,-169,1.15,101],[35,-172,1.1,102],[-18,-190,1.05,103],[20,-191,1.1,104],
    [-34,-210,1.2,105],[36,-216,1.15,106],[-8,-236,1.0,107],[12,-244,1.1,108],
    [-10,-163,.92,109],[11,-181,.88,110],[-9,-201,.9,111],[10,-220,.86,112],[0,-239,.82,113],
  ]) scene.add(caveRubble(x, z, scale, seed))
  MINE_NODE_SITES.forEach(({ id, x, z }) => scene.add(oreNode(id, x, z)))
  scene.add(
    merchantRest(-51, -43, mineGroundHeight, true, Math.atan2(51, -29) + Math.PI),
    merchantRest(56, -98, mineGroundHeight, true, Math.atan2(-56, 26) + Math.PI),
    merchantRest(-34, -230, mineGroundHeight, true, Math.atan2(34, 158) + Math.PI),
  )
  scene.add(
    anchor('Spawn', [0, mineGroundHeight(0, 13.4), 13.4]), anchor('GateDeep', [0, mineGroundHeight(0, -154), -154]), anchor('Home', homePosition),
    anchor('MineShop', [mineShopFront[0], mineGroundHeight(...mineShopFront), mineShopFront[1]]), anchor('OreBuyer', [oreBuyerFront[0], mineGroundHeight(...oreBuyerFront), oreBuyerFront[1]]),
    anchor('LabelMineShop', mineShopPosition), anchor('LabelOreBuyer', oreBuyerPosition),
    anchor('NpcMineShop', [mineShopNpc[0], mineGroundHeight(...mineShopNpc), mineShopNpc[1]]), anchor('NpcOreBuyer', [oreBuyerNpc[0], mineGroundHeight(...oreBuyerNpc), oreBuyerNpc[1]]),
    anchor('SecretSite0', [-51, mineGroundHeight(-51, -43), -43]), anchor('SecretSite1', [56, mineGroundHeight(56, -98), -98]), anchor('SecretSite2', [-34, mineGroundHeight(-34, -230), -230]),
    ...MINE_NODE_SITES.map(({ id, x, z }) => anchor(id, [x, mineGroundHeight(x, z), z])),
  )
  return scene
}

function miningRushScene() {
  const scene = new THREE.Scene()
  scene.name = 'Stonewake Mining Rush Cavern'
  const floorHeight = (x, z) => Math.sin(x * .045) * .22 + Math.cos(z * .057) * .18 + Math.sin((x - z) * .09) * .08
  scene.add(maskedTerrain('Stonewake Rush Cavern Floor', [-60, 60, -42, 44], 1.08, floorHeight, mats.mineGround, () => true))

  for (let index = 0; index < 94; index += 1) {
    const side = index % 4
    const along = -56 + (Math.floor(index / 4) / 23) * 112
    const x = side === 0 ? -57 : side === 1 ? 57 : along
    const z = side === 2 ? -40 : side === 3 ? 42 : along * .68
    const wallRock = mineBoulder(x, z, 3.4 + seeded(index, 9101) * 2.1, seeded(index, 9113) * Math.PI)
    wallRock.position.y = 1.5 + seeded(index, 9127) * 1.4
    wallRock.scale.y *= 2.35 + seeded(index, 9133) * .8
    scene.add(wallRock)
  }
  const roof = new THREE.PlaneGeometry(120, 86, 24, 18)
  const roofPosition = roof.getAttribute('position')
  for (let index = 0; index < roofPosition.count; index += 1) roofPosition.setZ(index, Math.sin(index * .71) * .7 + Math.cos(index * .33) * .5)
  roof.computeVertexNormals()
  const roofMesh = mesh(roof, mats.mineWall, 'Stonewake Rush Irregular Roof')
  roofMesh.rotation.x = Math.PI / 2
  roofMesh.position.set(0, 10.6, 1)
  scene.add(roofMesh)

  const bayCenters = [[-36, 18], [-12, 18], [12, 18], [36, 18], [-36, -18], [-12, -18], [12, -18], [36, -18]]
  const baySites = []
  bayCenters.forEach(([bx, bz], bayIndex) => {
    scene.add(caveLantern(bx - 9.2, bz + 8.6, 1), caveLantern(bx + 9.2, bz - 8.6, -1))
    scene.add(
      caveRubble(bx - 10.6, bz - 10.3, .82, 9800 + bayIndex),
      caveRubble(bx + 10.4, bz + 10.2, .86, 9850 + bayIndex),
      caveRubble(bx - 9.8, bz + 1.2, .68, 9860 + bayIndex),
      caveRubble(bx + 9.7, bz - 2.4, .72, 9870 + bayIndex),
      caveRubble(bx + (bayIndex % 2 ? 4.8 : -4.8), bz - 10.1, .76, 9880 + bayIndex),
    )
    const sites = []
    for (let row = 0; row < 5; row += 1) for (let column = 0; column < 5; column += 1) {
      const socket = row * 5 + column + bayIndex * 25
      const x = bx + (column - 2) * 3.7 + (seeded(socket, 9911) - .5) * 1.65 + Math.sin(row * 1.71 + column * .43) * .38
      const z = bz + 6.75 - row * 3.4 + (seeded(socket, 9921) - .5) * 1.45 + (column % 2 ? .32 : -.32)
      sites.push([x, z])
      const node = oreNode(`RushOre${bayIndex}_${String(row * 5 + column).padStart(2, '0')}`, x, z)
      node.position.set(x, floorHeight(x, z) + .04, z)
      node.traverse((child) => {
        if (!child.isMesh) return
        if (child.name === 'Embedded Ore Bed') { child.scale.set(.94, .18, .82); child.position.y = .11 }
        if (child.name === 'Ore Boulder') { child.scale.multiply(new THREE.Vector3(1.08, 1.08, 1.08)); child.position.y += .05 }
        if (child.name === 'Ore Vein') { child.scale.multiply(new THREE.Vector3(1.2, 1.08, 1.16)); child.position.y += .09 }
      })
      scene.add(node)
    }
    baySites.push(sites)
  })
  scene.add(caveColumn(-2, 0, 1.12, 205), caveColumn(2, -33, 1.08, 206), caveColumn(-53, 0, 1.15, 207), caveColumn(53, 0, 1.15, 208))
  scene.add(
    ...bayCenters.map(([x, z], index) => anchor(`Spawn${index}`, [x, floorHeight(x, z + 13.75), z + 13.75])),
    ...baySites.flatMap((sites, bay) => sites.map(([x, z], index) => anchor(`RushOre${bay}_${String(index).padStart(2, '0')}`, [x, floorHeight(x, z), z]))),
  )
  return scene
}

function farmRushScene() {
  const scene = new THREE.Scene()
  scene.name = 'Sunmeadow Kitchen Rush Fields'
  const plots = [[-36, 16], [-12, 16], [12, 16], [36, 16], [-36, -16], [-12, -16], [12, -16], [36, -16]]
  const rollingHeight = (x, z) => Math.sin(x * .045) * .34 + Math.cos(z * .052) * .28 + Math.sin((x - z) * .085) * .1
  const floorHeight = (x, z) => {
    let height = rollingHeight(x, z)
    for (const [plotX, plotZ] of plots) {
      const distance = Math.max(Math.abs(x - plotX), Math.abs(z - plotZ))
      const influence = 1 - smoothstep(6.15, 9.25, distance)
      height = THREE.MathUtils.lerp(height, rollingHeight(plotX, plotZ), influence)
    }
    return height
  }
  const plotMarkerMaterial = material('Assigned Plot Copper', 0xc8974f, { roughness: 0.68, metalness: 0.08 })
  scene.add(maskedTerrain('Sunmeadow Rush Terrain', [-52, 52, -36, 42], 1.1, floorHeight, mats.ground, (x, z) => !plots.some(([plotX, plotZ]) => Math.max(Math.abs(x - plotX), Math.abs(z - plotZ)) < 5.45)))
  scene.add(pathRibbon([[-48, 0], [-24, 0], [0, 0], [24, 0], [48, 0]], 2.1, 'Sunmeadow Rush Lane', floorHeight, mats.path))
  scene.add(pathRibbon([[-36, 34], [-36, 0], [-36, -28]], 1.5, 'Sunmeadow West Work Lane', floorHeight, mats.path))
  scene.add(pathRibbon([[-12, 34], [-12, 0], [-12, -28]], 1.5, 'Sunmeadow Inner Work Lane', floorHeight, mats.path))
  scene.add(pathRibbon([[12, 34], [12, 0], [12, -28]], 1.5, 'Sunmeadow East Work Lane', floorHeight, mats.path))
  scene.add(pathRibbon([[36, 34], [36, 0], [36, -28]], 1.5, 'Sunmeadow Far Work Lane', floorHeight, mats.path))
  const cellsByBay = []
  plots.forEach(([x, z], index) => {
    const parcel = farmParcel(x, z, index)
    parcel.position.set(x, floorHeight(x, z), z)
    parcel.traverse((object) => {
      if (object.name.includes('Soil Bed')) object.position.y = 0.045
      if (object.name === 'Farm Gate Path') object.position.y = 0.035
    })
    scene.add(parcel)
    const furnace = farmFurnacePad(x - 8.8, z + 4.8, 80 + index)
    furnace.name = `Rush Farm Furnace ${index + 1}`
    furnace.position.set(x - 8.8, floorHeight(x - 8.8, z + 4.8), z + 4.8)
    furnace.traverse((object) => {
      if (typeof object.userData.furnaceIndex === 'number') object.userData.rushCooker = index
      else delete object.userData.furnaceIndex
    })
    scene.add(furnace)
    const marker = new THREE.Group()
    marker.name = `RushPlotMarker${index}`
    marker.userData.rushPlot = index
    marker.position.set(x, floorHeight(x, z), z)
    const north = mesh(new RoundedBoxGeometry(12.15, 0.1, 0.16, 4, 0.06), plotMarkerMaterial, 'Assigned Plot Border')
    north.position.set(0, 0.12, -6.15)
    const south = north.clone()
    south.position.z = 6.15
    const west = mesh(new RoundedBoxGeometry(0.16, 0.1, 12.15, 4, 0.06), plotMarkerMaterial, 'Assigned Plot Border')
    west.position.set(-6.15, 0.12, 0)
    const east = west.clone()
    east.position.x = 6.15
    marker.add(north, south, west, east)
    for (const [cornerX, cornerZ] of [[-6.15, -6.15], [6.15, -6.15], [-6.15, 6.15], [6.15, 6.15]]) {
      const stake = mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.58, 7), mats.bark, 'Assigned Plot Stake')
      stake.position.set(cornerX, 0.29, cornerZ)
      const cap = mesh(new THREE.OctahedronGeometry(0.14, 0), plotMarkerMaterial, 'Assigned Plot Marker')
      cap.position.set(cornerX, 0.67, cornerZ)
      marker.add(stake, cap)
    }
    const gateLeft = mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.9, 7), mats.bark, 'Assigned Plot Gate Post')
    gateLeft.position.set(-1.3, 0.95, 7.05)
    const gateRight = gateLeft.clone()
    gateRight.position.x = 1.3
    const gateTop = mesh(new RoundedBoxGeometry(2.8, 0.18, 0.18, 4, 0.07), plotMarkerMaterial, 'Assigned Plot Gate Marker')
    gateTop.position.set(0, 1.84, 7.05)
    const gateBadge = mesh(new THREE.OctahedronGeometry(0.25, 0), plotMarkerMaterial, 'Assigned Plot Badge')
    gateBadge.position.set(0, 2.18, 7.05)
    const beacon = new THREE.Group()
    beacon.name = 'Assigned Plot Beacon'
    beacon.position.set(0, 2.85, 0)
    const beaconRing = mesh(new THREE.TorusGeometry(0.72, 0.09, 8, 22), mats.furnaceFire, 'Assigned Plot Hover Ring')
    beaconRing.rotation.x = Math.PI / 2
    const beaconGem = mesh(new THREE.OctahedronGeometry(0.36, 0), mats.furnaceFire, 'Assigned Plot Hover Gem')
    beaconGem.position.y = -0.08
    const pointer = mesh(new THREE.ConeGeometry(0.24, 0.52, 7), mats.furnaceFire, 'Assigned Plot Pointer')
    pointer.position.y = -0.88
    pointer.rotation.z = Math.PI
    beacon.add(beaconRing, beaconGem, pointer)
    marker.add(gateLeft, gateRight, gateTop, gateBadge, beacon)
    marker.traverse((child) => {
      if (!child.isMesh) return
      child.geometry = child.geometry.clone()
      const positions = child.geometry.getAttribute('position')
      positions.setX(0, positions.getX(0) + (index + 1) * 1e-7)
      positions.needsUpdate = true
    })
    scene.add(marker)
    const cells = []
    for (let row = 0; row < 5; row += 1) for (let column = 0; column < 5; column += 1) {
      const cellIndex = row * 5 + column
      const cellX = x + (column - 2) * 2.12
      const cellZ = z + (row - 2) * 2.12
      cells.push([cellX, cellZ])
      scene.add(wateredSoilTile(`WateredRushSoil_${index}_${String(cellIndex).padStart(2, '0')}`, cellX, floorHeight(cellX, cellZ) + .145, cellZ, true))
    }
    cellsByBay.push(cells)
  })
  for (let index = 0; index < 54; index += 1) {
    const side = index % 4
    const along = -48 + Math.floor(index / 4) * 7.2
    const x = side === 0 ? -49 : side === 1 ? 49 : along
    const z = side === 2 ? -34 : side === 3 ? 40 : along * .7
    scene.add(natureTree(x, z, 1 + seeded(index, 9210) * .44, seeded(index, 9220) * Math.PI * 2, floorHeight, index + 220))
    if (index % 2 === 0) scene.add(natureBush(x + (index % 3 - 1) * 1.35, z - .9, .75 + seeded(index, 9230) * .35, index, floorHeight, index + 230))
  }
  scene.add(
    ...plots.map(([x, z], bay) => anchor(`Spawn${bay}`, [x, floorHeight(x, z + 9.5), z + 9.5])),
    ...plots.map(([x, z], bay) => anchor(`FarmRushCooker${bay}`, [x - 8.8, floorHeight(x - 8.8, z + 4.8), z + 4.8])),
    ...cellsByBay.flatMap((cells, bay) => cells.map(([x, z], index) => anchor(`FarmRushCell${bay}_${String(index).padStart(2, '0')}`, [x, floorHeight(x, z) + .15, z]))),
  )
  return scene
}

function forageRushScene() {
  const scene = forageScene()
  scene.name = 'Mosswood Forage Race'
  const nearSpawnResources = []
  const mainWorldOnly = []
  scene.updateMatrixWorld(true)
  scene.traverse((object) => {
    if (
      object.name === 'Home Portal Landmark'
      || object.name === 'Foraging Shop'
      || object.name === 'Forage Market'
      || object.name === 'Foraging Shop Path'
      || object.name === 'Forage Market Path'
      || object.name === 'Anchor_Home'
      || object.name === 'Anchor_ForageShop'
      || object.name === 'Anchor_ForageBuyer'
      || object.name === 'Anchor_NpcForageShop'
      || object.name === 'Anchor_NpcForageBuyer'
    ) mainWorldOnly.push(object)
    if (object.name.startsWith('Resource_ForageApple')) object.name = object.name.replace('Resource_ForageApple', 'Resource_ForageRushApple')
    else if (object.name.startsWith('Resource_ForageOrange')) object.name = object.name.replace('Resource_ForageOrange', 'Resource_ForageRushOrange')
    else if (object.name.startsWith('Resource_ForageTruffle')) object.name = object.name.replace('Resource_ForageTruffle', 'Resource_ForageRushTruffle')
    else if (object.name.startsWith('Resource_ForageDiscovery')) object.name = object.name.replace('Resource_ForageDiscovery', 'Resource_ForageRushDiscovery')
    else if (object.name.startsWith('Anchor_ForageApple')) object.name = object.name.replace('Anchor_ForageApple', 'Anchor_ForageRushApple')
    else if (object.name.startsWith('Anchor_ForageOrange')) object.name = object.name.replace('Anchor_ForageOrange', 'Anchor_ForageRushOrange')
    else if (object.name.startsWith('Anchor_ForageTruffle')) object.name = object.name.replace('Anchor_ForageTruffle', 'Anchor_ForageRushTruffle')
    else if (object.name.startsWith('Anchor_ForageDiscovery')) object.name = object.name.replace('Anchor_ForageDiscovery', 'Anchor_ForageRushDiscovery')
    if ((object.name.startsWith('Resource_ForageRush') || object.name.startsWith('Anchor_ForageRush')) && object.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(0, 0, -69)) < 24) nearSpawnResources.push(object)
  })
  mainWorldOnly.forEach((object) => object.parent?.remove(object))
  nearSpawnResources.forEach((object) => {
    if (object.name.startsWith('Resource_ForageRush') && object.parent && object.parent.name.includes('Fruit Tree')) object.parent.parent?.remove(object.parent)
    else object.parent?.remove(object)
  })
  // Event sites reuse the real orchard trees, but bring enough of them onto the
  // established forest route that collecting—not hiking—decides the race.
  const eventApples = [[-23,-84],[-17,-101],[-6,-111],[9,-105],[21,-91],[27,-76],[31,-56],[-31,-58]]
  const eventOranges = [[22,-84],[15,-101],[4,-112],[-11,-104],[-24,-89],[-28,-73],[-32,-56],[31,-61]]
  const eventTruffles = [[-18,-94],[16,-96],[-4,-116],[25,-64],[-27,-65],[3,-72]]
  const eventDiscoveries = [[-2,-122],[29,-106],[-31,-106]]
  eventApples.forEach(([x,z], index) => {
    const id = `ForageRushApple${String(index + 100).padStart(3, '0')}`
    scene.add(fruitBirch(id, x, z, 1.02 + (index % 3) * .06, index * .73, forageGroundHeight, false, index + 810))
    scene.add(anchor(id, [x, forageGroundHeight(x, z), z]))
  })
  eventOranges.forEach(([x,z], index) => {
    const id = `ForageRushOrange${String(index + 100).padStart(3, '0')}`
    scene.add(fruitBirch(id, x, z, .98 + (index % 3) * .06, index * .81, forageGroundHeight, true, index + 830))
    scene.add(anchor(id, [x, forageGroundHeight(x, z), z]))
  })
  eventTruffles.forEach(([x,z], index) => {
    const id = `ForageRushTruffle${String(index + 20).padStart(3, '0')}`
    scene.add(trufflePatch(id, x, z, index * .61, forageGroundHeight), anchor(id, [x, forageGroundHeight(x, z), z]))
  })
  eventDiscoveries.forEach(([x,z], index) => {
    const id = `ForageRushDiscovery${String(index + 10).padStart(2, '0')}`
    scene.add(discoveryRelic(id, x, z, index * .71, forageGroundHeight), anchor(id, [x, forageGroundHeight(x, z), z]))
  })
  // Keep the delivery court compact and framed by woodland. The player should
  // read four destinations at a glance without the forest opening into a plaza.
  const deliveries = { Apple: [-5.4, -82], Orange: [-1.8, -84], Truffle: [1.8, -84], Discovery: [5.4, -82] }
  Object.entries(deliveries).forEach(([kind,[x,z]]) => {
    const stand = shop(`${kind} Delivery Stand`, [x, forageGroundHeight(x, z), z], Math.PI, kind === 'Apple' ? mats.fruit : kind === 'Orange' ? mats.fruitGold : kind === 'Truffle' ? mats.barkLight : mats.crystal)
    stand.scale.setScalar(.5)
    scene.add(stand, anchor(`ForageRushDeliver${kind}`, [x, forageGroundHeight(x,z), z + .8]), anchor(`NpcForageRush${kind}`, [x, forageGroundHeight(x,z), z - .45]))
  })
  const groveFrame = [
    [-18,-72,0],[-25,-82,1],[-21,-97,2],[-15,-108,3],
    [18,-72,4],[25,-82,5],[21,-97,0],[15,-108,1],
    [-11,-93,2],[11,-93,3],[-28,-113,4],[28,-113,5],
  ]
  groveFrame.forEach(([x,z,variant], index) => {
    scene.add(natureTree(x, z, 1.02 + (index % 3) * .09, index * .71, forageGroundHeight, variant))
    scene.add(natureBush(x + (index % 2 ? -1.4 : 1.4), z + .8, .82 + (index % 3) * .08, index * .47, forageGroundHeight, index))
  })
  return scene
}

async function exportScene(scene, filename) {
  let dynamicResourceIndex = 0
  scene.traverse((object) => {
    if (!object.name.startsWith('Resource_ForageApple') && !object.name.startsWith('Resource_ForageOrange') && !object.name.startsWith('Resource_ForageTruffle') && !object.name.startsWith('Resource_ForageDiscovery') && !object.name.startsWith('Resource_ForageRush') && !object.name.startsWith('Resource_RushOre')) return
    const marker = ++dynamicResourceIndex
    object.traverse((child) => {
      if (!child.isMesh || (!child.name.includes('Woodland Apples') && !child.name.includes('Woodland Oranges') && !object.name.startsWith('Resource_ForageTruffle') && !object.name.startsWith('Resource_ForageDiscovery') && !object.name.startsWith('Resource_RushOre') && !object.name.startsWith('Resource_ForageRush'))) return
      child.geometry = child.geometry.clone()
      const position = child.geometry.getAttribute('position')
      position.setX(0, position.getX(0) + marker * 1e-7)
      position.needsUpdate = true
    })
  })
  scene.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true
      object.receiveShadow = true
    }
  })
  const exporter = new GLTFExporter()
  const binary = await exporter.parseAsync(scene, { binary: true, onlyVisible: false, trs: true })
  const outputPath = path.join(out, filename)
  const rawPath = `${outputPath}.raw.glb`
  const nextPath = `${outputPath}.next.glb`
  await writeFile(rawPath, Buffer.from(binary))

  await MeshoptEncoder.ready
  const io = new NodeIO()
    .registerExtensions([EXTMeshGPUInstancing, EXTMeshoptCompression, EXTTextureWebP])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
  const document = await io.read(rawPath)
  const deferredWetTiles = filename === 'farm.glb'
    ? document.getRoot().listNodes().filter((node) => node.getName().startsWith('WateredSoil_')).map((node) => ({ name: node.getName(), translation: [...node.getTranslation()] }))
    : []
  const deferredWetMesh = filename === 'farm.glb'
    ? document.getRoot().listNodes().find((node) => node.getName().startsWith('WateredSoil_'))?.getMesh()
    : null
  // gltf-transform's static join pass correctly removes empty nodes. Our
  // Anchor_* nodes are deliberately empty, however: runtime interaction and
  // NPC placement read them by name. Preserve and restore them around the
  // mine optimization instead of relying on transform implementation details.
  const deferredAnchors = document.getRoot().listNodes().filter((node) => node.getName().startsWith('Anchor_')).map((node) => ({
         name: node.getName(),
         translation: [...node.getTranslation()],
         rotation: [...node.getRotation()],
         scale: [...node.getScale()],
      }))
  if (deferredWetTiles.length) document.getRoot().listNodes().filter((node) => node.getName().startsWith('WateredSoil_')).forEach((node) => node.dispose())
  document.createExtension(EXTMeshGPUInstancing).setRequired(true)
  const woodlandSource = await readFile(path.join(root, 'public', 'assets', 'textures', 'woodland-ground-v1.png'))
  const caveStoneSource = await readFile(path.join(root, 'public', 'assets', 'textures', 'storybook-cave-stone-v1.png'))
  const groundTexture = document
    .createTexture('Woodland Ground V1')
    .setImage(await sharp(woodlandSource).resize(1024, 1024).png({ compressionLevel: 9 }).toBuffer())
    .setMimeType('image/png')
  const farmTexture = document
    .createTexture('Sunmeadow Grass V1')
    .setImage(await sharp(woodlandSource).resize(1024, 1024).tint('#88ad62').modulate({ brightness: 1.12, saturation: 0.9 }).png({ compressionLevel: 9 }).toBuffer())
    .setMimeType('image/png')
  const mineTexture = document
    .createTexture('Storybook Cave Stone V1')
    .setImage(await sharp(caveStoneSource).resize(1024, 1024).modulate({ brightness: 0.78, saturation: 0.58 }).tint('#888078').png({ compressionLevel: 9 }).toBuffer())
    .setMimeType('image/png')
  const soilTexture = document
    .createTexture('Storybook Tilled Soil V1')
    .setImage(await sharp(caveStoneSource).resize(1024, 1024).modulate({ brightness: 0.62, saturation: 0.34 }).tint('#79533d').blur(0.35).png({ compressionLevel: 9 }).toBuffer())
    .setMimeType('image/png')
  for (const mat of document.getRoot().listMaterials()) {
    if (mat.getName() === 'Ground') {
      const greenGround = filename === 'farm.glb' || filename === 'forage.glb' || filename === 'hub.glb' || filename === 'farm-rush.glb' || filename === 'forage-rush.glb'
      mat.setBaseColorTexture(greenGround ? farmTexture : groundTexture).setBaseColorFactor(greenGround ? [0.74, 0.9, 0.64, 1] : [0.9, 0.9, 0.9, 1]).setRoughnessFactor(0.95).setMetallicFactor(0)
    }
    if (mat.getName() === 'Path') mat.setBaseColorTexture(groundTexture).setBaseColorFactor([0.68, 0.59, 0.48, 1]).setRoughnessFactor(1).setMetallicFactor(0)
    if (mat.getName() === 'Mine Ground') mat.setBaseColorTexture(mineTexture).setBaseColorFactor([0.64, 0.62, 0.58, 1]).setRoughnessFactor(1).setMetallicFactor(0)
    if (mat.getName() === 'Mine Path') mat.setBaseColorTexture(mineTexture).setBaseColorFactor([0.68, 0.59, 0.48, 1]).setRoughnessFactor(1).setMetallicFactor(0)
    if (['Mine Wall', 'Cavern Roof Stone', 'Cavern Perimeter Stone', 'Mine Wall Backing'].includes(mat.getName())) mat.setBaseColorTexture(mineTexture).setBaseColorFactor([0.58, 0.58, 0.55, 1]).setRoughnessFactor(1).setMetallicFactor(0)
    if (mat.getName() === 'Mine Strata') mat.setBaseColorTexture(mineTexture).setBaseColorFactor([0.44, 0.43, 0.41, 1]).setRoughnessFactor(1).setMetallicFactor(0)
    if (mat.getName() === 'Soil') mat.setBaseColorTexture(soilTexture).setBaseColorFactor([0.82, 0.72, 0.64, 1]).setRoughnessFactor(1).setMetallicFactor(0)
    if (mat.getName() === 'Watered Soil') mat.setBaseColorTexture(soilTexture).setBaseColorFactor([0.53, 0.47, 0.43, 1]).setRoughnessFactor(0.96).setMetallicFactor(0)
    if (mat.getName() === 'Tilled Soil Furrow') mat.setBaseColorTexture(soilTexture).setBaseColorFactor([0.42, 0.36, 0.32, 1]).setRoughnessFactor(1).setMetallicFactor(0)
  }
  // Event resources must keep their authored parent hierarchy so runtime state can
  // recolor/hide one player's ore or crop without affecting every matching mesh.
  // Mine scenery contains many small sibling meshes (rails, rubble, columns).
  // Joining compatible static siblings preserves every vertex and material while
  // removing a substantial amount of draw-call overhead. Interactive ore pieces
  // remain separate and are batched by the runtime so their state can still change.
  const joinableMineNode = (node) => !/^(Embedded Ore|Ore (Boulder|Vein|Fleck|Shard)|Animated |Watered|Assigned Plot Beacon)/.test(node.getName().replaceAll('_', ' '))
  if (filename === 'farm-rush.glb') await document.transform(dedup())
  else if (filename === 'mining-rush.glb' || filename === 'mine.glb') await document.transform(dedup(), join({ filter: joinableMineNode }), instance({ min: 5 }))
  else await document.transform(dedup(), instance({ min: filename === 'forage.glb' ? 3 : 5 }))
  if (deferredWetMesh && deferredWetTiles.length) {
    const targetScene = document.getRoot().listScenes()[0]
    deferredWetTiles.forEach(({ name, translation }) => targetScene.addChild(document.createNode(name).setMesh(deferredWetMesh).setTranslation(translation)))
  }
  // Geometry compression includes a prune pass, so restore the deliberately
  // empty interaction anchors only after it completes.
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  if (deferredAnchors.length) {
    const targetScene = document.getRoot().listScenes()[0]
    const remainingNames = new Set(document.getRoot().listNodes().map((node) => node.getName()))
    deferredAnchors.forEach(({ name, translation, rotation, scale }) => {
      if (remainingNames.has(name)) return
      targetScene.addChild(document.createNode(name).setTranslation(translation).setRotation(rotation).setScale(scale))
    })
  }
  // The source kits and authored terrain textures arrive as large embedded PNGs.
  // WebP preserves their full dimensions and alpha while cutting scene transfer
  // size substantially; modern browsers and Three's GLTFLoader support the
  // required EXT_texture_webp extension directly.
  document.createExtension(EXTTextureWebP).setRequired(true)
  await document.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 86, effort: 5 }))
  await io.write(nextPath, document)
  await rm(rawPath, { force: true })
  try {
    await rename(nextPath, outputPath)
  } catch (error) {
    // Windows can reject an otherwise valid atomic replacement while the
    // development server has served the old GLB. Copying over the exact file
    // keeps scene generation usable without stopping the running preview.
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EPERM') throw error
    await copyFile(nextPath, outputPath)
    await rm(nextPath, { force: true })
  }
  console.log(`Authored ${filename}`)
}

const requestedScenes = new Set(process.argv.slice(2))
const wants = (name) => requestedScenes.size === 0 || requestedScenes.has(name)
if (wants('hub')) await exportScene(hubScene(), 'hub.glb')
if (wants('forage')) await exportScene(forageScene(), 'forage.glb')
if (wants('farm')) await exportScene(farmScene(), 'farm.glb')
if (wants('mine')) await exportScene(mineScene(), 'mine.glb')
if (wants('mining-rush')) await exportScene(miningRushScene(), 'mining-rush.glb')
if (wants('farm-rush')) await exportScene(farmRushScene(), 'farm-rush.glb')
if (wants('forage-rush')) await exportScene(forageRushScene(), 'forage-rush.glb')
