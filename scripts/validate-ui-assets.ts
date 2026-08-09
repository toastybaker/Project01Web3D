import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const sources = [
  'src/App.tsx', 'src/game/World.tsx', 'src/game/items.ts', 'src/game/audio.ts', 'src/styles.css',
]
const assetPattern = /\/assets\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|svg|ogg|mp3|glb|fbx)/gi
const referenced = new Set<string>()
for (const source of sources) {
  const text = readFileSync(source, 'utf8')
  for (const match of text.matchAll(assetPattern)) referenced.add(match[0])
}
const missing = [...referenced].filter((asset) => !existsSync(join('public', asset)))
assert.deepEqual(missing, [], `Missing player-facing assets:\n${missing.join('\n')}`)
console.log(JSON.stringify({ status: 'passed', checked: referenced.size }, null, 2))
