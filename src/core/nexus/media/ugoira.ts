import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import * as yauzl from 'yauzl'
import { z } from 'zod'

export const ugoiraFramesSchema = z
  .array(
    z.object({
      file: z.string().regex(/^[\w-]+\.(?:jpg|jpeg|png)$/i),
      delay: z.number().int().min(1).max(60000),
    })
  )
  .min(1)
  .max(10000)
  .refine(
    (frames) =>
      new Set(frames.map((f) => f.file)).size === frames.length &&
      frames.reduce((n, f) => n + f.delay, 0) <= 3600000
  )
export type UgoiraFrame = z.infer<typeof ugoiraFramesSchema>[number]

/** Only the declared regular frames can be extracted. Never execute ZIP paths. */
export async function renderUgoira(
  binary: string,
  archive: string,
  frames: UgoiraFrame[],
  directory: string,
  output: string
) {
  frames = ugoiraFramesSchema.parse(frames)
  const root = path.join(directory, 'frames')
  await mkdir(root)
  try {
    await new Promise<void>((resolve, reject) =>
      yauzl.open(archive, { lazyEntries: true }, (error, zip) => {
        if (error || !zip) {
          reject(new Error('processing.mediaFailed'))
          return
        }
        const expected = new Set(frames.map((f) => f.file)),
          found = new Set<string>()
        let bytes = 0,
          count = 0
        const fail = () => {
          zip.close()
          reject(new Error('processing.mediaFailed'))
        }
        zip.on('error', fail)
        zip.on('entry', (entry: yauzl.Entry) => {
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000
          bytes += entry.uncompressedSize
          if (
            ++count > 10000 ||
            bytes > 1024 ** 3 ||
            mode === 0o120000 ||
            !expected.has(entry.fileName) ||
            found.has(entry.fileName)
          ) {
            fail()
            return
          }
          found.add(entry.fileName)
          zip.openReadStream(entry, (err, input) => {
            if (err || !input) {
              fail()
              return
            }
            void pipeline(
              input,
              createWriteStream(path.join(root, entry.fileName), {
                flags: 'wx',
              })
            ).then(() => zip.readEntry(), fail)
          })
        })
        zip.once('end', () =>
          found.size === expected.size ? resolve() : fail()
        )
        zip.readEntry()
      })
    )
    // Relative names are validated above; no shell, URL or arbitrary concat directive.
    const list =
      frames
        .map(
          (f) =>
            `file 'frames/${f.file}'\noption framerate 1000\nduration ${f.delay / 1000}`
        )
        .join('\n') +
      `\nfile 'frames/${frames.at(-1)?.file}'\noption framerate 1000\n`
    const manifest = path.join(directory, 'frames.txt')
    await writeFile(manifest, list, { flag: 'wx' })
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        binary,
        [
          '-nostdin',
          '-v',
          'error',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          manifest,
          '-fps_mode',
          'vfr',
          '-vf',
          'pad=ceil(iw/2)*2:ceil(ih/2)*2',
          '-c:v',
          'libopenh264',
          '-pix_fmt',
          'yuv420p',
          '-y',
          output,
        ],
        { windowsHide: true, stdio: 'ignore' }
      )
      const timer = setTimeout(() => child.kill(), 30 * 60 * 1000)
      child.once('error', () => {
        clearTimeout(timer)
        reject(new Error('processing.mediaFailed'))
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        code === 0 ? resolve() : reject(new Error('processing.mediaFailed'))
      })
    })
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(path.join(directory, 'frames.txt'), { force: true })
  }
}
