import sharp from 'sharp'

const source = 'public/assets/ui/items/gold-pickaxe.png'
const output = 'public/assets/ui/items/steel-pickaxe.png'
const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

for (let index = 0; index < data.length; index += 4) {
  const red = data[index]
  const green = data[index + 1]
  const blue = data[index + 2]
  const brightness = red * .3 + green * .55 + blue * .15
  const gold = brightness > 105 && red > green * 1.08 && green > blue * 1.22
  if (!gold) continue
  data[index] = Math.min(255, Math.round(brightness * .94 + 18))
  data[index + 1] = Math.min(255, Math.round(brightness * 1.01 + 20))
  data[index + 2] = Math.min(255, Math.round(brightness * 1.08 + 24))
}

await sharp(data, { raw: info }).png().toFile(output)
console.log(output)
