import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { writeLivePhoto } from '../src/core/nexus/media/live-photo-writer.ts'
import { renderUgoira } from '../src/core/nexus/media/ugoira.ts'

const root = path.resolve('../.nexus-v1-fixtures/media')
await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })
const bin = path.resolve('../.nexus-v1-fixtures/tools/bin')
const ffmpeg = path.join(bin, 'ffmpeg/N-128915-g3d16b774d7/ffmpeg.exe')
const probe = path.join(bin, 'ffmpeg/N-128915-g3d16b774d7/ffprobe.exe')
const seven = path.join(bin, '7zip/26.06/7z.exe')
const run = promisify(execFile)
const ff = async (args) =>
  run(ffmpeg, ['-nostdin', '-v', 'error', ...args], { windowsHide: true })
await ff([
  '-f',
  'lavfi',
  '-i',
  'color=red:s=32x32',
  '-frames:v',
  '1',
  '-y',
  path.join(root, '0.png'),
])
await ff([
  '-f',
  'lavfi',
  '-i',
  'color=blue:s=32x32',
  '-frames:v',
  '1',
  '-y',
  path.join(root, '1.png'),
])
await ff([
  '-f',
  'lavfi',
  '-i',
  'testsrc2=s=32x32:r=30',
  '-t',
  '1',
  '-c:v',
  'libopenh264',
  '-pix_fmt',
  'yuv420p',
  '-y',
  path.join(root, 'motion.mp4'),
])
await ff(['-i', path.join(root, '0.png'), '-y', path.join(root, 'still.jpg')])
await run(
  seven,
  ['a', '-tzip', path.join(root, 'frames.zip'), '0.png', '1.png'],
  { cwd: root, windowsHide: true }
)
for (const format of ['mp4', 'mkv']) {
  const output = path.join(root, `ugoira.${format}`)
  await renderUgoira(
    ffmpeg,
    path.join(root, 'frames.zip'),
    [
      { file: '0.png', delay: 100 },
      { file: '1.png', delay: 300 },
    ],
    root,
    output
  )
  const result = JSON.parse(
    (
      await run(
        probe,
        ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output],
        { windowsHide: true }
      )
    ).stdout
  )
  assert.equal(result.streams[0].codec_name, 'h264')
  assert.ok(Math.abs(Number(result.format.duration) - 0.4) < 0.08)
  await ff(['-i', output, '-f', 'null', '-'])
}
await writeLivePhoto(
  path.join(root, 'still.jpg'),
  path.join(root, 'motion.mp4'),
  path.join(root, 'live.jpg'),
  path.join(root, 'live.mov')
)
const live = JSON.parse(
  (
    await run(
      probe,
      [
        '-v',
        'error',
        '-show_format',
        '-show_streams',
        '-show_packets',
        '-of',
        'json',
        path.join(root, 'live.mov'),
      ],
      { windowsHide: true }
    )
  ).stdout
)
assert.ok(live.streams.some((s) => s.codec_tag_string === 'mebx'))
assert.ok(live.format.tags['com.apple.quicktime.content.identifier'])
const metadata = live.packets.find((p) => p.codec_type === 'data')
assert.equal(Number(metadata.size), 9)
assert.equal(Number(metadata.pts_time), 0)
const mov = await readFile(path.join(root, 'live.mov'))
assert.equal(
  mov.subarray(Number(metadata.pos), Number(metadata.pos) + 9).toString('hex'),
  '000000090000000100'
)
const frameHash = async (file) =>
  (await ff(['-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'])).stdout
assert.equal(
  await frameHash(path.join(root, 'motion.mp4')),
  await frameHash(path.join(root, 'live.mov'))
)
await writeFile(
  'output/v1-media-live.json',
  JSON.stringify(
    {
      ugoiraMp4AndMkv: true,
      frameDurations: true,
      livePhotoMetadataTrack: true,
      pairedIdentifier: true,
      videoContentPreserved: true,
      externalToolsInstalledAndRun: true,
    },
    null,
    2
  ) + '\n'
)
console.log(
  'Media fixture encoding, duration, paired metadata and decoded-frame identity passed.'
)
