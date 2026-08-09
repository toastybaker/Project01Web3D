import { copyFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, textureCompress } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'

await MeshoptEncoder.ready
await MeshoptDecoder.ready

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, EXTTextureWebP])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })

for (const filename of ['ranger.glb', 'shopkeeper.glb', 'merchant.glb']) {
  const target = path.resolve('public', 'assets', '3d', 'characters', filename)
  const pending = `${target}.next`
  const document = await io.read(target)

  // Preserve the authored rig, geometry, and full 1024px texture resolution.
  // Meshopt changes only delivery encoding; WebP removes several megabytes of
  // embedded PNG overhead without changing the in-game material setup.
  await document.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  document.createExtension(EXTTextureWebP).setRequired(true)
  await document.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90, effort: 5 }))
  await writeFile(pending, await io.writeBinary(document))
  try {
    await rename(pending, target)
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EPERM') throw error
    await copyFile(pending, target)
    await rm(pending, { force: true })
  }
}

console.log('Optimized character GLBs without reducing geometry or texture resolution.')
