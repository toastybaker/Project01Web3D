import { NodeIO } from '@gltf-transform/core'
import { EXTMeshGPUInstancing } from '@gltf-transform/extensions'

const io = new NodeIO().registerExtensions([EXTMeshGPUInstancing])
for (const file of process.argv.slice(2)) {
  const document = await io.read(file)
  const root = document.getRoot()
  let vertices = 0
  let triangles = 0
  let instancedNodes = 0
  let instances = 0
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      vertices += primitive.getAttribute('POSITION')?.getCount() ?? 0
      const indices = primitive.getIndices()?.getCount()
      triangles += indices ? Math.floor(indices / 3) : Math.floor((primitive.getAttribute('POSITION')?.getCount() ?? 0) / 3)
    }
  }
  for (const node of root.listNodes()) {
    const extension = node.getExtension('EXT_mesh_gpu_instancing')
    if (!extension) continue
    instancedNodes += 1
    instances += extension.getAttribute('TRANSLATION')?.getCount() ?? extension.getAttribute('ROTATION')?.getCount() ?? extension.getAttribute('SCALE')?.getCount() ?? 0
  }
  const nodeKinds = new Map()
  for (const node of root.listNodes()) {
    const kind = node.getName().replace(/_?\d.*$/, '').replace(/\s\d.*$/, '') || '(unnamed)'
    nodeKinds.set(kind, (nodeKinds.get(kind) ?? 0) + 1)
  }
  const commonNodes = [...nodeKinds].sort((a, b) => b[1] - a[1]).slice(0, 16)
  console.log(JSON.stringify({ file, nodes: root.listNodes().length, meshes: root.listMeshes().length, primitives: root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().length, 0), materials: root.listMaterials().length, textures: root.listTextures().length, vertices, triangles, instancedNodes, instances, commonNodes }, null, 2))
}
