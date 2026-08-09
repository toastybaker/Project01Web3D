import sharp from 'sharp'

const jobs = [
  {
    input: 'public/assets/textures/woodland-ground-v1.png',
    output: 'public/assets/textures/woodland-ground-normal-v1.webp',
    strength: 2.15,
  },
  {
    input: 'public/assets/textures/storybook-cave-stone-v1.png',
    output: 'public/assets/textures/storybook-cave-stone-normal-v1.webp',
    strength: 2.8,
  },
]

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))

async function normalMap({ input, output, strength }) {
  const size = 1024
  const { data, info } = await sharp(input)
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const height = new Float32Array(info.width * info.height)
  for (let index = 0; index < height.length; index += 1) {
    const offset = index * info.channels
    height[index] = (data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722) / 255
  }

  const sample = (x, y) => {
    const wrappedX = (x + info.width) % info.width
    const wrappedY = (y + info.height) % info.height
    return height[wrappedY * info.width + wrappedX]
  }
  const outputPixels = Buffer.alloc(info.width * info.height * 3)
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    const gx = (
      -sample(x - 1, y - 1) - sample(x - 1, y) * 2 - sample(x - 1, y + 1)
      + sample(x + 1, y - 1) + sample(x + 1, y) * 2 + sample(x + 1, y + 1)
    ) * strength
    const gy = (
      -sample(x - 1, y - 1) - sample(x, y - 1) * 2 - sample(x + 1, y - 1)
      + sample(x - 1, y + 1) + sample(x, y + 1) * 2 + sample(x + 1, y + 1)
    ) * strength
    const length = Math.hypot(gx, gy, 1)
    const offset = (y * info.width + x) * 3
    outputPixels[offset] = Math.round(clamp((-gx / length * 0.5 + 0.5) * 255, 0, 255))
    outputPixels[offset + 1] = Math.round(clamp((-gy / length * 0.5 + 0.5) * 255, 0, 255))
    outputPixels[offset + 2] = Math.round(clamp((1 / length * 0.5 + 0.5) * 255, 0, 255))
  }

  await sharp(outputPixels, { raw: { width: info.width, height: info.height, channels: 3 } })
    .webp({ quality: 86, effort: 6, smartSubsample: true })
    .toFile(output)
  console.log(`${output} (${info.width}×${info.height})`)
}

for (const job of jobs) await normalMap(job)
