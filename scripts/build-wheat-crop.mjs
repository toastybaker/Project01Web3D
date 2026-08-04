import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

class NodeFileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = value
      this.onloadend?.({ target: this })
    })
  }
}

globalThis.FileReader = NodeFileReader

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(root, 'public', 'assets', '3d', 'crops')
await mkdir(outputDirectory, { recursive: true })

const stemMaterial = new THREE.MeshStandardMaterial({ name: 'Wheat Stem', color: 0x8ca34c, roughness: 0.92, flatShading: true })
const grainMaterial = new THREE.MeshStandardMaterial({ name: 'Golden Grain', color: 0xd9a13f, roughness: 0.84, flatShading: true })
const ripeMaterial = new THREE.MeshStandardMaterial({ name: 'Ripe Wheat', color: 0xf0c35b, roughness: 0.82, flatShading: true })

function wheatCrop() {
  const crop = new THREE.Group()
  crop.name = 'Wheat Crop'
  const stalks = [
    [-0.18, -0.08, 0.93, -0.08], [0, -0.12, 1.08, 0.04], [0.18, -0.07, 0.98, 0.1],
    [-0.1, 0.1, 1.02, 0.06], [0.12, 0.12, 0.9, -0.1], [-0.26, 0.12, 0.82, 0.12], [0.27, 0.1, 0.86, -0.05],
  ]

  stalks.forEach(([x, z, height, lean], index) => {
    const stalk = new THREE.Group()
    stalk.name = `Stalk ${index + 1}`
    stalk.position.set(x, 0, z)
    stalk.rotation.z = lean

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.027, height, 5), stemMaterial)
    stem.position.y = height * 0.5
    stem.name = 'Stem'
    stalk.add(stem)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 6, 5), index % 2 ? grainMaterial : ripeMaterial)
    head.name = 'Grain Head'
    head.scale.set(0.72, 1.72, 0.72)
    head.position.y = height + 0.12
    head.rotation.z = index % 2 ? 0.08 : -0.06
    stalk.add(head)

    for (let row = 0; row < 4; row += 1) {
      const y = height + 0.055 + row * 0.04
      const awnLeft = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.18, 4), grainMaterial)
      awnLeft.name = 'Awn'
      awnLeft.position.set(-0.08, y, 0)
      awnLeft.rotation.z = -0.78
      const awnRight = awnLeft.clone()
      awnRight.position.x = 0.08
      awnRight.rotation.z = 0.78
      stalk.add(awnLeft, awnRight)
    }

    crop.add(stalk)
  })

  const leaves = [[-0.2, 0.34, -0.28], [0.2, 0.3, 0.3], [-0.05, 0.28, 0.05]]
  leaves.forEach(([x, y, rotation], index) => {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.54, 4), stemMaterial)
    leaf.name = `Wheat Leaf ${index + 1}`
    leaf.position.set(x, y, index === 1 ? 0.08 : -0.05)
    leaf.rotation.z = rotation
    crop.add(leaf)
  })

  crop.traverse((object) => {
    if (!object.isMesh) return
    object.castShadow = true
    object.receiveShadow = true
  })
  return crop
}

const exporter = new GLTFExporter()
const binary = await exporter.parseAsync(wheatCrop(), { binary: true, trs: true })
await writeFile(path.join(outputDirectory, 'wheat_crop.glb'), Buffer.from(binary))
console.log('Authored wheat_crop.glb')
