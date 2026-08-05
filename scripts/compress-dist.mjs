import { constants } from 'node:zlib'
import { brotliCompress } from 'node:zlib'
import { promisify } from 'node:util'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const compress = promisify(brotliCompress)
const root = path.resolve('dist')
const compressible = new Set(['.css', '.glb', '.js'])

async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return visit(filePath)
    if (!compressible.has(path.extname(entry.name).toLowerCase())) return
    const source = await readFile(filePath)
    if (source.byteLength < 1024) return
    const encoded = await compress(source, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 7,
        [constants.BROTLI_PARAM_SIZE_HINT]: source.byteLength,
      },
    })
    await writeFile(`${filePath}.br`, encoded)
  }))
}

await visit(root)
