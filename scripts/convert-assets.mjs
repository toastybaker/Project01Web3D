import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import sharp from 'sharp'

const require = createRequire(import.meta.url)
const convert = require('fbx2gltf')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'public', 'assets', '3d')

await mkdir(path.join(out, 'characters'), { recursive: true })
await mkdir(path.join(out, 'crops'), { recursive: true })

async function convertOne(source, target) {
  await convert(path.join(root, source), path.join(root, target), [
    '--binary',
    '--pbr-metallic-roughness',
    '--compute-normals',
    'missing',
  ])
}

await convertOne('source-assets/3d/characters/models/Male_Ranger.fbx', 'public/assets/3d/characters/ranger.glb')
await convertOne('source-assets/3d/characters/models/Female_Ranger.fbx', 'public/assets/3d/characters/shopkeeper.glb')
await convertOne('source-assets/3d/characters/models/Female_Ranger.fbx', 'public/assets/3d/characters/merchant.glb')

for (const name of ['Tomato_1', 'Tomato_2', 'Tomato_3', 'Tomato_4', 'Tomato_Crop', 'Mushroom_Crop', 'Lettuce_Crop']) {
  await convertOne(`source-assets/3d/crops/${name}.fbx`, `public/assets/3d/crops/${name.toLowerCase()}.glb`)
}

const io = new NodeIO()

async function patchCropMaterial(filename, materialName, color) {
  const cropPath = path.join(out, 'crops', filename)
  const crop = await io.read(cropPath)
  const material = crop.getRoot().listMaterials().find((entry) => entry.getName() === materialName)
  if (!material) throw new Error(`Missing ${materialName} material in ${filename}`)
  material
    .setBaseColorFactor(color)
    .setMetallicFactor(0)
    .setRoughnessFactor(0.82)
  await io.write(cropPath, crop)
}

async function merchantBaseColor(source) {
  const { data, info } = await sharp(source).resize(1024, 1024).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const recolored = Buffer.from(data)
  for (let index = 0; index < recolored.length; index += 4) {
    const red = recolored[index]
    const green = recolored[index + 1]
    const blue = recolored[index + 2]
    // Preserve skin, leather, steel, and fur while turning the ranger's
    // yellow-green cloth into a deep blue travelling coat.
    if (red > 12 && green / red > .72 && blue / Math.max(1, green) < .58) {
      const value = Math.max(12, Math.round(red * .48 + green * .42 + blue * .1))
      recolored[index] = Math.min(255, Math.round(value * .42))
      recolored[index + 1] = Math.min(255, Math.round(value * .72))
      recolored[index + 2] = Math.min(255, Math.round(value * .92))
    }
  }
  return sharp(recolored, { raw: info }).png({ compressionLevel: 9 }).toBuffer()
}

async function shopkeeperBaseColor(source) {
  const { data, info } = await sharp(source).resize(1024, 1024).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const recolored = Buffer.from(data)
  for (let index = 0; index < recolored.length; index += 4) {
    const red = recolored[index]
    const green = recolored[index + 1]
    const blue = recolored[index + 2]
    // Keep skin, leather, fur, and metal intact. The ranger cloth becomes a
    // clear sage-green uniform so shopkeepers cannot be mistaken for players.
    if (red > 12 && green / red > .72 && blue / Math.max(1, green) < .58) {
      const value = Math.max(18, Math.round(red * .46 + green * .46 + blue * .08))
      recolored[index] = Math.min(255, Math.round(value * .42))
      recolored[index + 1] = Math.min(255, Math.round(value * 1.08))
      recolored[index + 2] = Math.min(255, Math.round(value * .62))
    }
  }
  return sharp(recolored, { raw: info }).png({ compressionLevel: 9 }).toBuffer()
}

async function patchRanger(filename, colorFilename, variant = 'player') {
  const rangerPath = path.join(out, 'characters', filename)
  const ranger = await io.read(rangerPath)
  const colorSource = await readFile(path.join(root, 'source-assets/3d/characters/textures', colorFilename))
  const baseColor = ranger
    .createTexture('Ranger Base Color')
    .setImage(variant === 'merchant' ? await merchantBaseColor(colorSource) : variant === 'shopkeeper' ? await shopkeeperBaseColor(colorSource) : await sharp(colorSource).resize(1024, 1024).png({ compressionLevel: 9 }).toBuffer())
    .setMimeType('image/png')
  const normal = ranger
    .createTexture('Ranger Normal')
    .setImage(await sharp(await readFile(path.join(root, 'source-assets/3d/characters/textures/T_Ranger_Normal.png'))).resize(1024, 1024).png({ compressionLevel: 9 }).toBuffer())
    .setMimeType('image/png')
  const orm = ranger
    .createTexture('Ranger ORM')
    .setImage(await sharp(await readFile(path.join(root, 'source-assets/3d/characters/textures/T_Ranger_ORM.png'))).resize(1024, 1024).png({ compressionLevel: 9 }).toBuffer())
    .setMimeType('image/png')
  for (const material of ranger.getRoot().listMaterials()) {
    material
      .setBaseColorTexture(baseColor)
      .setNormalTexture(normal)
      .setMetallicFactor(0)
      .setRoughnessFactor(0.88)
      .setMetallicRoughnessTexture(orm)
      .setOcclusionTexture(orm)
  }
  await io.write(rangerPath, ranger)
}

await patchCropMaterial('tomato_4.glb', 'Red', [0.72, 0.075, 0.018, 1])
await patchCropMaterial('tomato_crop.glb', 'Red', [0.72, 0.075, 0.018, 1])
await patchRanger('ranger.glb', 'T_Ranger_BaseColor.png')
await patchRanger('shopkeeper.glb', 'T_Ranger_3_BaseColor.png', 'shopkeeper')
await patchRanger('merchant.glb', 'T_Ranger_3_BaseColor.png', 'merchant')
console.log('Converted Ranger and representative crop stages to GLB with web-ready PBR materials.')
