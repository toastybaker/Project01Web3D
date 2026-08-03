import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

class NodeFileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((value) => { this.result = value; this.onloadend?.({ target: this }) })
  }
}
globalThis.FileReader = NodeFileReader

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'source-assets', '3d', 'crops')
const output = path.join(root, 'public', 'assets', '3d', 'crops')
const loader = new FBXLoader()
const exporter = new GLTFExporter()

for (const crop of ['Pumpkin', 'Watermelon']) {
  for (const stage of ['1', '3', 'Crop']) {
    const data = await readFile(path.join(source, `${crop}_${stage}.fbx`))
    const object = loader.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), source)
    object.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        materials.forEach((material) => { material.roughness = 0.88; material.metalness = 0 })
      }
    })
    const binary = await exporter.parseAsync(object, { binary: true, onlyVisible: false, trs: true })
    const suffix = stage === 'Crop' ? 'crop' : stage
    await writeFile(path.join(output, `${crop.toLowerCase()}_${suffix}.glb`), Buffer.from(binary))
    console.log(`Converted ${crop}_${stage}`)
  }
}
