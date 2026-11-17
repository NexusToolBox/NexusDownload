import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initWasm, Resvg } from '@resvg/resvg-wasm'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sources = path.join(root, 'design/final/icons')
const output = path.join(root, 'extra/nexus')
const sizes = [16, 20, 24, 32, 40, 48, 64, 256]
await mkdir(output, { recursive: true })
await initWasm(
  await readFile(
    path.join(root, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')
  )
)

function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  for (const [index, { size, data }] of images.entries()) {
    const entry = 6 + index * 16
    header[entry] = size === 256 ? 0 : size
    header[entry + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(data.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += data.length
  }
  return Buffer.concat([header, ...images.map(({ data }) => data)])
}

function render(svg, size) {
  return Buffer.from(
    new Resvg(svg, {
      fitTo: { mode: 'width', value: size },
    })
      .render()
      .asPng()
  )
}

const app = (
  await readFile(path.join(sources, 'app-icon.svg'), 'utf8')
).replace('<svg ', '<svg role="img" aria-label="NexusDownload" ')
const appImages = []
for (const size of sizes) {
  // Small Windows icons need 1.5 physical-pixel strokes and no node glow.
  const artwork =
    size <= 20
      ? app
          .replace(/<circle[^>]+fill="url\(#node\)"\s*\/>/, '')
          .replace(/stroke-width="(?:3.6|4.2)"/g, `stroke-width="${96 / size}"`)
      : app
  const data = render(artwork, size)
  appImages.push({ size, data })
  await writeFile(path.join(output, `app-icon-${size}.png`), data)
  if (size <= 20)
    await writeFile(
      path.join(output, `app-icon-${size}.svg`),
      artwork.replace(/[ \t]+$/gm, '')
    )
}
await writeFile(path.join(output, 'app-icon.ico'), ico(appImages))
// Keep every shell and browser entry point on the same application artwork.
for (const [file, size] of [
  ['public/app-icon.png', 256],
  ['public/apple-touch-icon.png', 180],
  ['build/256x256.png', 256],
]) {
  await writeFile(path.join(root, file), render(app, size))
}
for (const file of ['public/favicon.ico', 'build/icon.ico']) {
  await writeFile(path.join(root, file), ico(appImages))
}
await writeFile(path.join(root, 'public/mo-logo.svg'), app)
for (const theme of ['light', 'dark']) {
  for (const state of ['idle', 'downloading', 'error']) {
    const name = `tray-${state}-${theme}-taskbar`
    const svg = await readFile(path.join(sources, `${name}.svg`), 'utf8')
    const images = [16, 20, 24, 32].map((size) => ({
      size,
      data: render(svg, size),
    }))
    await writeFile(path.join(output, `${name}.ico`), ico(images))
    await writeFile(path.join(output, `${name}.png`), images[3].data)
  }
}
console.log(
  'Exported application ICO (8 sizes) and 6 tray ICO variants (4 sizes each)'
)
