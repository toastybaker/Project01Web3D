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

for (const name of ['Tomato_1', 'Tomato_2', 'Tomato_3', 'Tomato_4', 'Tomato_Crop', 'Mushroom_Crop', 'Lettuce_Crop']) {
  await convertOne(`source-assets/3d/crops/${name}.fbx`, `public/assets/3d/crops/${name.toLowerCase()}.glb`)
}

const io = new NodeIO()
async function patchRanger(filename, colorFilename) {
  const rangerPath = path.join(out, 'characters', filename)
  const ranger = await io.read(rangerPath)
  const baseColor = ranger
    .createTexture('Ranger Base Color')
    .setImage(await sharp(await readFile(path.join(root, 'source-assets/3d/characters/textures', colorFilename))).resize(1024, 1024).png({ compressionLevel: 9 }).toBuffer())
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

await patchRanger('ranger.glb', 'T_Ranger_BaseColor.png')
await patchRanger('shopkeeper.glb', 'T_Ranger_3_BaseColor.png')
console.log('Converted Ranger and representative crop stages to GLB with web-ready PBR materials.')
