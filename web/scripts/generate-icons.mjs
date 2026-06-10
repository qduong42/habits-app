// One-off icon generator: rasterizes public/icons/icon.svg into the PNG sizes
// referenced by the PWA manifest and index.html. The PNGs are committed; re-run
// this script only when icon.svg changes:
//
//   node web/scripts/generate-icons.mjs
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const iconsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
const svg = await readFile(path.join(iconsDir, 'icon.svg'))

// Maskable variant: full-bleed background (no rounded corners — the platform
// applies its own mask) and the flame shrunk into the ~80% safe zone.
const maskableSvg = Buffer.from(
  svg
    .toString()
    .replace('rx="112"', 'rx="0"')
    .replace('translate(76 86) scale(15)', 'translate(112 120) scale(12)'),
)

const outputs = [
  { src: svg, size: 192, file: 'icon-192.png' },
  { src: svg, size: 512, file: 'icon-512.png' },
  { src: svg, size: 180, file: 'apple-touch-icon.png' },
  { src: maskableSvg, size: 512, file: 'icon-maskable-512.png' },
]

for (const { src, size, file } of outputs) {
  const png = await sharp(src, { density: 300 }).resize(size, size).png().toBuffer()
  await writeFile(path.join(iconsDir, file), png)
  console.log(`wrote ${file} (${size}x${size}, ${png.length} bytes)`)
}
