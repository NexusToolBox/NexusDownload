// Port of YunX Desktop 1.3.4 data/network/Pan115Crypto.kt.
// Copyright YunX contributors. SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto'
import { CloudError } from './cloud-adapter'

const table = [
  0xf0, 0xe5, 0x69, 0xae, 0xbf, 0xdc, 0xbf, 0x8a, 0x1a, 0x45, 0xe8, 0xbe, 0x7d,
  0xa6, 0x73, 0xb8, 0xde, 0x8f, 0xe7, 0xc4, 0x45, 0xda, 0x86, 0xc4, 0x9b, 0x64,
  0x8b, 0x14, 0x6a, 0xb4, 0xf1, 0xaa, 0x38, 0x01, 0x35, 0x9e, 0x26, 0x69, 0x2c,
  0x86, 0x00, 0x6b, 0x4f, 0xa5, 0x36, 0x34, 0x62, 0xa6, 0x2a, 0x96, 0x68, 0x18,
  0xf2, 0x4a, 0xfd, 0xbd, 0x6b, 0x97, 0x8f, 0x4d, 0x8f, 0x89, 0x13, 0xb7, 0x6c,
  0x8e, 0x93, 0xed, 0x0e, 0x0d, 0x48, 0x3e, 0xd7, 0x2f, 0x88, 0xd8, 0xfe, 0xfe,
  0x7e, 0x86, 0x50, 0x95, 0x4f, 0xd1, 0xeb, 0x83, 0x26, 0x34, 0xdb, 0x66, 0x7b,
  0x9c, 0x7e, 0x9d, 0x7a, 0x81, 0x32, 0xea, 0xb6, 0x33, 0xde, 0x3a, 0xa9, 0x59,
  0x34, 0x66, 0x3b, 0xaa, 0xba, 0x81, 0x60, 0x48, 0xb9, 0xd5, 0x81, 0x9c, 0xf8,
  0x6c, 0x84, 0x77, 0xff, 0x54, 0x78, 0x26, 0x5f, 0xbe, 0xe8, 0x1e, 0x36, 0x9f,
  0x34, 0x80, 0x5c, 0x45, 0x2c, 0x9b, 0x76, 0xd5, 0x1b, 0x8f, 0xcc, 0xc3, 0xb8,
  0xf5,
]
const longKey = Buffer.from([
  0x78, 0x06, 0xad, 0x4c, 0x33, 0x86, 0x5d, 0x18, 0x4c, 0x01, 0x3f, 0x46,
])
const modulus = BigInt(
  '0x8686980c0f5a24c4b9d43020cd2c22703ff3f450756529058b1cf88f09b8602136477198a6e2683149659bd122c33592fdb5ad47944ad1ea4d36c6b172aad6338c3bb6ac6227502d010993ac967d1aef00f0c8e038de2e4d3bc2ec368af2e9f10a6f1eda4f7262f136420c07c331b871bf139f74f3010e3c4fe57df3afb71683'
)
function derive(seed: Buffer, size: number) {
  return Buffer.from(
    Array.from(
      { length: size },
      (_, i) =>
        ((seed[i % seed.length] + table[size * i]) & 255) ^
        table[size * (size - 1 - i)]
    )
  )
}
function xor(data: Buffer, key: Buffer) {
  const offset = data.length % 4
  for (let i = 0; i < data.length; i++)
    data[i] ^= key[(i < offset ? i : i - offset) % key.length]
}
export class Pan115Crypto {
  constructor(private n = modulus) {}
  private rsa(block: Buffer) {
    let base = BigInt(`0x${block.toString('hex')}`)
    let e = 65537n
    let result = 1n
    while (e) {
      if (e & 1n) result = (result * base) % this.n
      base = (base * base) % this.n
      e >>= 1n
    }
    return Buffer.from(result.toString(16).padStart(256, '0'), 'hex')
  }
  newKey() {
    return randomBytes(16)
  }
  encode(payload: string, key: Buffer) {
    if (key.length !== 16) throw new CloudError('identity')
    const body = Buffer.from(payload)
    xor(body, derive(key, 4))
    body.reverse()
    xor(body, longKey)
    const data = Buffer.concat([key, body])
    const blocks: Buffer[] = []
    for (let i = 0; i < data.length; i += 117) {
      const part = data.subarray(i, i + 117)
      const block = Buffer.alloc(128, 255)
      block[0] = 0
      block[1] = 2
      block[127 - part.length] = 0
      part.copy(block, 128 - part.length)
      blocks.push(this.rsa(block))
    }
    return Buffer.concat(blocks).toString('base64')
  }
  decode(encoded: string, key: Buffer) {
    const data = Buffer.from(encoded, 'base64')
    if (key.length !== 16 || !data.length || data.length % 128)
      throw new CloudError('identity')
    const blocks: Buffer[] = []
    for (let i = 0; i < data.length; i += 128) {
      const block = this.rsa(data.subarray(i, i + 128))
      const start = block.indexOf(0, 2) + 1
      if (start < 3 || start >= 128) throw new CloudError('identity')
      blocks.push(block.subarray(start))
    }
    const plain = Buffer.concat(blocks)
    if (plain.length <= 16) throw new CloudError('identity')
    const body = plain.subarray(16)
    xor(body, derive(plain.subarray(0, 16), 12))
    body.reverse()
    xor(body, derive(key, 4))
    return body.toString('utf8')
  }
}
