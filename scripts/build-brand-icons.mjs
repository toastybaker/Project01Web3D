import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { siAmd, siApple, siGoogle, siNvidia, siSamsung } from 'simple-icons'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'public', 'assets', 'brands')
await mkdir(output, { recursive: true })

const brands = [siApple, siGoogle, siNvidia, siSamsung, siAmd]
for (const brand of brands) {
  const filename = `${brand.slug}.svg`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="${brand.title}"><path fill="#${brand.hex}" d="${brand.path}"/></svg>\n`
  await writeFile(path.join(output, filename), svg, 'utf8')
  console.log(`Wrote ${filename}`)
}
