// Ported from YunX Desktop 1.3.4 data/download/MotionPhotoWriter.kt.
// Copyright YunX contributors. SPDX-License-Identifier: AGPL-3.0-only
// OPPO Exif template in upstream credits flashlab/motion-live-photo.
import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
export async function writeMotionPhoto(
  still: string,
  motion: string,
  output: string
): Promise<void> {
  const size = (await stat(motion)).size
  if (!size) throw new Error('processing.mediaFailed')
  const input = await open(still, 'r')
  const head = Buffer.alloc(1024 * 1024)
  const { bytesRead } = await input.read(head, 0, head.length, 0)
  await input.close()
  if (bytesRead < 6 || head[0] !== 255 || head[1] !== 216)
    throw new Error('processing.mediaFailed')
  const offset =
    head[2] === 255 && head[3] === 224 ? 4 + head.readUInt16BE(4) : 2
  if (offset > bytesRead) throw new Error('processing.mediaFailed')
  let width = 0,
    height = 0
  let cursor = 2
  while (cursor + 9 < bytesRead && head[cursor] === 255) {
    const marker = head[cursor + 1]
    if (marker === 218 || marker === 217) break
    const length = head.readUInt16BE(cursor + 2)
    if (length < 2) break
    if ([192, 193, 194].includes(marker)) {
      height = head.readUInt16BE(cursor + 5)
      width = head.readUInt16BE(cursor + 7)
      break
    }
    cursor += 2 + length
  }
  const exif = Buffer.from(
    'FFE100724578696600004D4D002A0000000800040100000400000001000005A001010004000000010000043C87690004000000010000003E011200030000000100000000000000000002928600020000000E0000005C920800040000000100000000000000006F706C75735F3833383836303800',
    'hex'
  )
  if (width && height) {
    exif.writeUInt32BE(width, 28)
    exif.writeUInt32BE(height, 40)
  }
  const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" xmlns:OpCamera="http://ns.oplus.com/photos/1.0/camera/" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" GCamera:MotionPhoto="1" GCamera:MotionPhotoVersion="1" GCamera:MotionPhotoPresentationTimestampUs="0" OpCamera:MotionPhotoPrimaryPresentationTimestampUs="0" OpCamera:MotionPhotoOwner="oplus" OpCamera:OLivePhotoVersion="2" OpCamera:VideoLength="${size}"><Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0" Item:Padding="0"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${size}"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>`
  const payload = Buffer.concat([
    Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii'),
    Buffer.from(xml),
  ])
  const segment = Buffer.alloc(4)
  segment[0] = 255
  segment[1] = 225
  segment.writeUInt16BE(payload.length + 2, 2)
  const target = await open(output, 'wx')
  try {
    await target.write(head.subarray(0, offset))
    await target.write(segment)
    await target.write(payload)
    await target.write(exif)
    for await (const chunk of createReadStream(still, { start: offset }))
      await target.write(chunk)
    for await (const chunk of createReadStream(motion))
      await target.write(chunk)
    await target.sync()
  } finally {
    await target.close()
  }
}
