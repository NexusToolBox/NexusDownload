import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readFile, stat, writeFile } from 'node:fs/promises'

const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
const atom = (type: string, ...data: Buffer[]) => {
  const body = Buffer.concat(data)
  return Buffer.concat([
    u32(body.length + 8),
    Buffer.from(type, 'latin1'),
    body,
  ])
}
const hex = (s: string) => Buffer.from(s, 'hex')

/** Apple MakerApple tag 17, with offsets relative to the embedded MakerNote TIFF. */
export function livePhotoExif(identifier: string) {
  const id = Buffer.from(`${identifier}\0`)
  const maker = Buffer.concat([
    Buffer.from('Apple iOS\0'),
    hex('00014d4d000100110002'),
    u32(id.length),
    u32(32),
    u32(0),
    id,
  ])
  // IFD0 -> ExifIFD -> MakerNote. The surrounding image's existing EXIF is removed.
  const tiff = Buffer.concat([
    hex('4d4d002a00000008000187690004000000010000001a000000000001927c0007'),
    u32(maker.length),
    u32(44),
    u32(0),
    maker,
  ])
  const body = Buffer.concat([Buffer.from('Exif\0\0'), tiff])
  const length = Buffer.alloc(2)
  length.writeUInt16BE(body.length + 2)
  return Buffer.concat([hex('ffe1'), length, body])
}

async function writeStill(input: string, output: string, id: string) {
  if ((await stat(input)).size > 64 * 1024 ** 2)
    throw new Error('processing.mediaFailed')
  const jpeg = await readFile(input)
  if (jpeg.length > 64 * 1024 ** 2 || jpeg[0] !== 255 || jpeg[1] !== 216)
    throw new Error('processing.mediaFailed')
  const chunks = [jpeg.subarray(0, 2), livePhotoExif(id)]
  let p = 2
  while (p + 4 <= jpeg.length && jpeg[p] === 255) {
    const marker = jpeg[p + 1]
    if (marker === 218 || marker === 217) break
    const end = p + 2 + jpeg.readUInt16BE(p + 2)
    if (end <= p + 3 || end > jpeg.length)
      throw new Error('processing.mediaFailed')
    if (
      !(marker === 225 && jpeg.toString('ascii', p + 4, p + 10) === 'Exif\0\0')
    )
      chunks.push(jpeg.subarray(p, end))
    p = end
  }
  chunks.push(jpeg.subarray(p))
  await writeFile(output, Buffer.concat(chunks), { flag: 'wx' })
}

function children(buffer: Buffer, start = 8) {
  const result: Buffer[] = []
  for (let p = start; p < buffer.length; ) {
    if (p + 8 > buffer.length) throw new Error('processing.mediaFailed')
    const size = buffer.readUInt32BE(p)
    if (size < 8 || p + size > buffer.length)
      throw new Error('processing.mediaFailed')
    result.push(buffer.subarray(p, p + size))
    p += size
  }
  return result
}

/** A mebx signed-int8 still-image-time sample, plus the paired asset identifier.
 * Appending moov and marking the old one free preserves every original media offset,
 * including co64 files. No video bytes are buffered or re-encoded here.
 */
export async function writeLivePhoto(
  still: string,
  motion: string,
  jpeg: string,
  mov: string,
  id = randomUUID().toUpperCase()
) {
  const source = await open(motion, 'r'),
    size = (await stat(motion)).size
  let moov: Buffer | undefined,
    offset = 0
  try {
    for (let p = 0; p < size; ) {
      const h = Buffer.alloc(16)
      await source.read(h, 0, 16, p)
      const short = h.readUInt32BE(0),
        length =
          short === 1
            ? Number(h.readBigUInt64BE(8))
            : short === 0
              ? size - p
              : short
      if (!Number.isSafeInteger(length) || length < 8 || p + length > size)
        throw new Error('processing.mediaFailed')
      if (h.toString('ascii', 4, 8) === 'moov') {
        if (moov || short === 1 || length > 64 * 1024 ** 2)
          throw new Error('processing.mediaFailed')
        moov = Buffer.alloc(length)
        await source.read(moov, 0, length, p)
        offset = p
      }
      p += length
    }
  } finally {
    await source.close()
  }
  if (!moov) throw new Error('processing.mediaFailed')
  const parts = children(moov),
    mvhd = parts.find((b) => b.toString('ascii', 4, 8) === 'mvhd')
  if (!mvhd) throw new Error('processing.mediaFailed')
  const timescale = mvhd.readUInt32BE(mvhd[8] === 1 ? 28 : 20),
    next = mvhd.readUInt32BE(mvhd.length - 4)
  if (!timescale || !next || next >= 0xfffffffe)
    throw new Error('processing.mediaFailed')
  mvhd.writeUInt32BE(next + 1, mvhd.length - 4)
  const duration = Math.max(1, Math.round(timescale / 15))
  const tkhd = Buffer.alloc(84)
  tkhd.writeUInt32BE(3, 0)
  tkhd.writeUInt32BE(next, 12)
  tkhd.writeUInt32BE(duration, 20)
  tkhd.writeUInt32BE(0x10000, 40)
  tkhd.writeUInt32BE(0x10000, 56)
  tkhd.writeUInt32BE(0x40000000, 72)
  const mdhd = Buffer.concat([
    Buffer.alloc(12),
    u32(1000),
    u32(67),
    hex('55c40000'),
  ])
  const sample = Buffer.concat([u32(9), u32(1), Buffer.from([0])])
  const key = atom(
    'keyd',
    Buffer.from('mdtacom.apple.quicktime.still-image-time')
  )
  const datatype = atom('dtyp', u32(0), u32(65))
  const entry = atom(
    'mebx',
    hex('0000000000000001'),
    atom('keys', atom('\0\0\0\x01', key, datatype))
  )
  const sampleOffset = size + 8
  const table = atom(
    'stbl',
    atom('stsd', u32(0), u32(1), entry),
    atom('stts', u32(0), u32(1), u32(1), u32(67)),
    atom('stsc', u32(0), u32(1), u32(1), u32(1), u32(1)),
    atom('stsz', u32(0), u32(9), u32(1)),
    sampleOffset <= 0xffffffff
      ? atom('stco', u32(0), u32(1), u32(sampleOffset))
      : atom(
          'co64',
          u32(0),
          u32(1),
          (() => {
            const b = Buffer.alloc(8)
            b.writeBigUInt64BE(BigInt(sampleOffset))
            return b
          })()
        )
  )
  const handler = atom(
    'hdlr',
    u32(0),
    Buffer.from('mhlrmetaappl'),
    u32(1),
    u32(0),
    Buffer.from('\x0dCore Metadata')
  )
  const minf = atom(
    'minf',
    atom('gmhd', atom('gmin', hex('00000000004080008000800000000000'))),
    atom('dinf', atom('dref', u32(0), u32(1), atom('alis', u32(1)))),
    table
  )
  const track = atom(
    'trak',
    atom('tkhd', tkhd),
    atom('mdia', atom('mdhd', mdhd), handler, minf)
  )
  const meta = atom(
    'meta',
    atom('hdlr', u32(0), u32(0), Buffer.from('mdta'), Buffer.alloc(13)),
    atom(
      'keys',
      u32(0),
      u32(1),
      atom('mdta', Buffer.from('com.apple.quicktime.content.identifier'))
    ),
    atom(
      'ilst',
      atom('\0\0\0\x01', atom('data', u32(1), u32(0), Buffer.from(id)))
    )
  )
  const target = await open(mov, 'wx')
  try {
    for await (const chunk of createReadStream(motion, {
      start: 0,
      end: offset + 3,
    }))
      await target.write(chunk)
    await target.write(Buffer.from('free'))
    for await (const chunk of createReadStream(motion, { start: offset + 8 }))
      await target.write(chunk)
    await target.write(atom('mdat', sample))
    await target.write(atom('moov', ...parts, track, meta))
    const header = await open(motion, 'r')
    try {
      const ftyp = Buffer.alloc(12)
      await header.read(ftyp, 0, 12, 0)
      if (ftyp.toString('ascii', 4, 8) === 'ftyp')
        await target.write(Buffer.from('qt  '), 0, 4, 8)
    } finally {
      await header.close()
    }
    await target.sync()
  } finally {
    await target.close()
  }
  await writeStill(still, jpeg, id)
}
