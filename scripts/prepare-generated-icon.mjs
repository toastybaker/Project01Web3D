import sharp from 'sharp'
import path from 'node:path'

const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: prepare-generated-icon.mjs <input> <output>')

const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const rgba = Buffer.alloc(info.width * info.height * 4)
let minX = info.width
let minY = info.height
let maxX = 0
let maxY = 0
for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
  const source = pixel * 3
  const target = pixel * 4
  const r = data[source]
  const g = data[source + 1]
  const b = data[source + 2]
  const high = Math.max(r, g, b)
  const low = Math.min(r, g, b)
  const neutral = high - low < 13
  const lightness = (r + g + b) / 3
  const alpha = neutral && lightness > 205 ? Math.max(0, Math.min(255, (220 - lightness) * 17)) : 255
  rgba[target] = r
  rgba[target + 1] = g
  rgba[target + 2] = b
  rgba[target + 3] = alpha
  if (alpha > 32) {
    const x = pixel % info.width
    const y = Math.floor(pixel / info.width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
}

const pad = 28
const left = Math.max(0, minX - pad)
const top = Math.max(0, minY - pad)
const width = Math.min(info.width - left, maxX - minX + 1 + pad * 2)
const height = Math.min(info.height - top, maxY - minY + 1 + pad * 2)
await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
  .extract({ left, top, width, height })
  .resize(470, 470, { fit: 'inside', withoutEnlargement: false })
  .extend({
    top: 21,
    bottom: 21,
    left: 21,
    right: 21,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile(path.resolve(output))

console.log(`Prepared ${output}`)
