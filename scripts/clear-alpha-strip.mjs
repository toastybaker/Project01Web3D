import sharp from 'sharp'
import path from 'node:path'

const [input, output, topValue = '0', bottomValue = '0', leftValue = '0', rightValue = '0'] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: clear-alpha-strip.mjs <input> <output> [top] [bottom] [left] [right]')

const source = sharp(path.resolve(input)).ensureAlpha()
const { width = 0, height = 0 } = await source.metadata()
if (!width || !height) throw new Error(`Could not read image dimensions for ${input}`)

const top = Math.max(0, Math.min(height, Number(topValue) || 0))
const bottom = Math.max(0, Math.min(height - top, Number(bottomValue) || 0))
const left = Math.max(0, Math.min(width, Number(leftValue) || 0))
const right = Math.max(0, Math.min(width - left, Number(rightValue) || 0))
const { data, info } = await source.raw().toBuffer({ resolveWithObject: true })

for (let y = 0; y < info.height; y += 1) {
  for (let x = 0; x < info.width; x += 1) {
    if (y < top || y >= info.height - bottom || x < left || x >= info.width - right) data[(y * info.width + x) * 4 + 3] = 0
  }
}

await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toFile(path.resolve(output))
console.log(`Wrote ${output}`)
