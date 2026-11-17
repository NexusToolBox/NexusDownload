import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { writeMotionPhoto } from './motion-photo-writer'

it('preserves JFIF boundaries, writes both motion markers and appends the complete video', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexus-motion-'))
  try {
    const jpeg = Buffer.from([255, 216, 255, 224, 0, 4, 0, 0, 255, 217])
    const mp4 = Buffer.from('local-video-bytes')
    const still = path.join(root, 'still.jpg'),
      motion = path.join(root, 'motion.mp4'),
      out = path.join(root, 'output.jpg')
    await writeFile(still, jpeg)
    await writeFile(motion, mp4)
    await writeMotionPhoto(still, motion, out)
    const output = await readFile(out)
    expect(output.subarray(0, 8)).toEqual(jpeg.subarray(0, 8))
    expect(output.subarray(8, 10)).toEqual(Buffer.from([255, 225]))
    expect(output.toString()).toContain('oplus_8388608')
    expect(output.toString()).toContain(`Item:Length="${mp4.length}"`)
    expect(output.subarray(-mp4.length)).toEqual(mp4)
    expect(await readFile(still)).toEqual(jpeg)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
