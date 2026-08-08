import { Document, NodeIO } from '@gltf-transform/core'
import { prune } from '@gltf-transform/functions'

const document = new Document()
const buffer = document.createBuffer('Held tool buffer')

const headMaterial = document.createMaterial('Pickaxe Head')
  .setBaseColorFactor([0.48, 0.53, 0.56, 1])
  .setMetallicFactor(0.42)
  .setRoughnessFactor(0.5)
  .setDoubleSided(true)
const handleMaterial = document.createMaterial('Pickaxe Handle')
  .setBaseColorFactor([0.42, 0.23, 0.11, 1])
  .setMetallicFactor(0)
  .setRoughnessFactor(0.8)
const gripMaterial = document.createMaterial('Pickaxe Grip')
  .setBaseColorFactor([0.16, 0.105, 0.07, 1])
  .setMetallicFactor(0)
  .setRoughnessFactor(0.94)

function triangleBuffer() {
  const positions = []
  const normals = []
  const addTriangle = (a, b, c) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const normal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ]
    const length = Math.hypot(...normal) || 1
    normal[0] /= length
    normal[1] /= length
    normal[2] /= length
    positions.push(...a, ...b, ...c)
    normals.push(...normal, ...normal, ...normal)
  }
  const addQuad = (a, b, c, d) => {
    addTriangle(a, b, c)
    addTriangle(a, c, d)
  }
  return { positions, normals, addTriangle, addQuad }
}

function createPrimitive(name, material, geometry) {
  const position = document.createAccessor(`${name} position`)
    .setType('VEC3')
    .setArray(new Float32Array(geometry.positions))
    .setBuffer(buffer)
  const normal = document.createAccessor(`${name} normal`)
    .setType('VEC3')
    .setArray(new Float32Array(geometry.normals))
    .setBuffer(buffer)
  const primitive = document.createPrimitive(name)
    .setAttribute('POSITION', position)
    .setAttribute('NORMAL', normal)
    .setMaterial(material)
  return document.createMesh(name).addPrimitive(primitive)
}

function addTaperedTube(geometry, rings, sides = 8) {
  const points = rings.map(({ x = 0, y, z = 0, radius }) => Array.from({ length: sides }, (_, index) => {
    const angle = (index / sides) * Math.PI * 2
    return [x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius]
  }))
  for (let ring = 0; ring < points.length - 1; ring += 1) {
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides
      geometry.addQuad(points[ring][side], points[ring + 1][side], points[ring + 1][next], points[ring][next])
    }
  }
  const bottom = rings[0]
  const top = rings[rings.length - 1]
  const bottomCenter = [bottom.x ?? 0, bottom.y, bottom.z ?? 0]
  const topCenter = [top.x ?? 0, top.y, top.z ?? 0]
  for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides
    geometry.addTriangle(bottomCenter, points[0][next], points[0][side])
    geometry.addTriangle(topCenter, points[points.length - 1][side], points[points.length - 1][next])
  }
}

function addHeadProfile(geometry, sections) {
  const rings = sections.map(({ x, y, halfY, halfZ }) => [
    [x, y - halfY, -halfZ],
    [x, y + halfY, -halfZ],
    [x, y + halfY, halfZ],
    [x, y - halfY, halfZ],
  ])
  for (let section = 0; section < rings.length - 1; section += 1) {
    for (let side = 0; side < 4; side += 1) {
      const next = (side + 1) % 4
      geometry.addQuad(rings[section][side], rings[section + 1][side], rings[section + 1][next], rings[section][next])
    }
  }
  const first = rings[0]
  const last = rings[rings.length - 1]
  geometry.addQuad(first[0], first[3], first[2], first[1])
  geometry.addQuad(last[1], last[2], last[3], last[0])
}

const handleGeometry = triangleBuffer()
addTaperedTube(handleGeometry, [
  { x: -0.006, y: -0.49, z: 0.006, radius: 0.031 },
  { x: -0.012, y: -0.18, z: -0.004, radius: 0.037 },
  { x: 0.004, y: 0.12, z: 0.002, radius: 0.035 },
  { x: 0, y: 0.385, z: 0, radius: 0.041 },
])

const gripGeometry = triangleBuffer()
addTaperedTube(gripGeometry, [
  { x: -0.006, y: -0.495, z: 0.006, radius: 0.037 },
  { x: -0.012, y: -0.29, z: -0.001, radius: 0.043 },
  { x: -0.011, y: -0.225, z: -0.003, radius: 0.04 },
])

const headGeometry = triangleBuffer()
// Two tapered picks keep the silhouette unmistakably pickaxe-like from the
// third-person camera. One side remains longer so it does not read as a mop.
addHeadProfile(headGeometry, [
  { x: -0.035, y: 0.39, halfY: 0.068, halfZ: 0.06 },
  { x: -0.15, y: 0.405, halfY: 0.052, halfZ: 0.043 },
  { x: -0.27, y: 0.37, halfY: 0.032, halfZ: 0.026 },
  { x: -0.385, y: 0.295, halfY: 0.014, halfZ: 0.013 },
  { x: -0.445, y: 0.235, halfY: 0.004, halfZ: 0.004 },
])
addHeadProfile(headGeometry, [
  { x: 0.035, y: 0.39, halfY: 0.068, halfZ: 0.06 },
  { x: 0.16, y: 0.392, halfY: 0.046, halfZ: 0.042 },
  { x: 0.29, y: 0.355, halfY: 0.025, halfZ: 0.023 },
  { x: 0.39, y: 0.29, halfY: 0.005, halfZ: 0.005 },
])
addTaperedTube(headGeometry, [
  { y: 0.315, radius: 0.058 },
  { y: 0.455, radius: 0.058 },
], 8)

const tool = document.createNode('Held Pickaxe')
const head = document.createNode('Pickaxe Head').setMesh(createPrimitive('Pickaxe Head', headMaterial, headGeometry))
const handle = document.createNode('Pickaxe Handle').setMesh(createPrimitive('Pickaxe Handle', handleMaterial, handleGeometry))
const grip = document.createNode('Pickaxe Grip').setMesh(createPrimitive('Pickaxe Grip', gripMaterial, gripGeometry))
tool.addChild(head).addChild(handle).addChild(grip)
document.createScene('Held Tools').addChild(tool)

await document.transform(prune())
await new NodeIO().write('public/assets/3d/tools/pickaxe.glb', document)
console.log('public/assets/3d/tools/pickaxe.glb')
