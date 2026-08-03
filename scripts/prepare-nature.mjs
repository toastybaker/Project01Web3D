import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'source-assets', '3d', 'quaternius-nature', 'glTF')
const output = path.join(root, 'source-assets', '3d', 'nature-glb')
await mkdir(output, { recursive: true })

const names = [
  'BirchTree_1', 'BirchTree_2', 'BirchTree_3', 'BirchTree_4', 'BirchTree_5',
  'MapleTree_1', 'MapleTree_2', 'MapleTree_3', 'MapleTree_4', 'MapleTree_5',
  'Bush', 'Bush_Large', 'Bush_Small', 'Grass_Large_Extruded', 'Flower_3_Clump',
]

const io = new NodeIO()
for (const name of names) {
  const document = await io.read(path.join(source, `${name}.gltf`))
  await io.write(path.join(output, `${name}.glb`), document)
  console.log(`Prepared ${name}.glb`)
}
