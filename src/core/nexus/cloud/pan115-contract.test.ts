// Constructed playback of YunX Desktop 1.3.4 Pan115 API shapes.
// SPDX-License-Identifier: AGPL-3.0-only
import {
  constants,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
} from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyResource } from './cloud-adapter'
import { CloudHttp } from './cloud-http'
import { Pan115Adapter } from './pan115-adapter'
import { Pan115Crypto } from './pan115-crypto'

describe('115 shared CloudAdapter contract', () => {
  function fixture(vip?: 0 | 1) {
    const secret = randomBytes(24).toString('hex')
    let error = 0
    const calls: { url: URL; headers: Headers; body: URLSearchParams }[] = []
    const http = new CloudHttp({
      cookie: () => `UID=${secret}; SEID=${secret}`,
      merge: async () => {},
      fetch: async (input, init) => {
        const url = new URL(String(input))
        calls.push({
          url,
          headers: new Headers(init?.headers),
          body: new URLSearchParams(String(init?.body ?? '')),
        })
        if (error) return Response.json({ state: false, errno: error })
        const row = {
          fid: 'f',
          cid: '0',
          n: 'sample.bin',
          s: '5',
          pc: secret,
          t: '1700000000',
          sha: 'a'.repeat(40),
        }
        if (url.hostname === 'appversion.115.com')
          return Response.json({ data: { win: { version_code: '36.0.2' } } })
        if (url.pathname === '/files')
          return Response.json({
            state: true,
            count: 1,
            data: [
              url.searchParams.get('cid') === '0'
                ? row
                : { ...row, fid: 'saved', cid: 'tmp' },
            ],
          })
        if (url.pathname === '/share/snap')
          return Response.json({
            state: true,
            data: {
              list: [{ ...row, fc: 1 }],
              count: 1,
              userinfo: { user_id: 'owner' },
              shareinfo: { share_title: 'sample' },
            },
          })
        if (url.pathname === '/files/index_info')
          return Response.json({
            state: true,
            data: {
              space_info: {
                all_total: { size: '100' },
                all_use: { size: '5' },
              },
            },
          })
        if (url.pathname === '/files/add')
          return Response.json({ state: true, cid: 'tmp' })
        if (url.pathname.includes('downurl'))
          return Response.json(
            {
              state: true,
              data:
                url.hostname === 'proapi.115.com'
                  ? secret
                  : {
                      file_url_302: `https://cdn.invalid/file?sign=${secret}`,
                      fs: '5',
                    },
            },
            { headers: { 'Set-Cookie': `${secret}=${secret}; path=/object/` } }
          )
        if (url.pathname === '/user/info')
          return Response.json({ state: true, data: { is_vip: vip } })
        return Response.json({ state: true, data: 'valid' })
      },
    })
    const adapter = new Pan115Adapter(http, {
      newKey: () => randomBytes(16),
      encode: () => secret,
      decode: () =>
        JSON.stringify({
          f: {
            file_name: 'sample.bin',
            file_size: '5',
            url: { url: `https://cdn.invalid/file?sign=${secret}` },
          },
        }),
    })
    return {
      adapter,
      calls,
      setError: (n: number) => {
        error = n
      },
      secret,
    }
  }
  it.each([
    [1, true],
    [0, false],
    [undefined, null],
  ] as const)('reads membership from data.is_vip=%s', async (flag, member) => {
    expect(await fixture(flag).adapter.health()).toEqual({ member })
  })
  it('lists own/share files, preserves hashes, renews identity and binds CDN cookies/UA', async () => {
    const { adapter, calls, secret } = fixture()
    await adapter.checkLogin()
    expect(await adapter.quota()).toEqual({ total: 100, used: 5 })
    const files = await adapter.listFiles('0')
    expect(files[0].hash).toBe(`sha1:${'a'.repeat(40)}`)
    const session = await adapter.createSession('https://115cdn.com/s/example')
    const share = await adapter.listFiles('0', session)
    expect(share[0].id).toBe('f')
    const first = await adapter.getDownloadLink(files[0], 'own')
    const renewed = await adapter.renew(files[0], 'own')
    verifyResource(files[0], renewed, first)
    expect((first.headers.Cookie ?? '').includes(secret)).toBe(true)
    expect(first.headers['User-Agent']).toBe('Mozilla/5.0 115Browser/36.0.2')
    await adapter.getDownloadLink(share[0], 'without-save', session)
    const request = calls.find((c) => c.url.pathname === '/share/downurl')
    expect(request?.url.searchParams.get('user_id')).toBe('owner')
    expect(request?.headers.get('Referer')).toBe('https://115cdn.com/s/example')
    expect(() => verifyResource(files[0], { ...first, bytes: 6 })).toThrow(
      'cloud.size'
    )
  })
  it('claims transferred identity only in an owned unique directory and refuses root cleanup', async () => {
    const { adapter, calls } = fixture()
    const session = await adapter.createSession('https://115cdn.com/s/example')
    const [file] = await adapter.listFiles('0', session)
    const dir = await adapter.ensureTempDir('NexusDownload_tr_test')
    const saved = await adapter.transferFile(session, file, dir)
    expect(saved).toBe('saved')
    verifyResource(
      file,
      await adapter.getDownloadLink(file, 'save', session, saved)
    )
    await expect(adapter.cleanupTempDir('0')).rejects.toThrow('cloud.identity')
    await adapter.cleanupTempDir(dir)
    const transfer = calls.find((c) => c.url.pathname === '/share/receive')
    expect(transfer?.body.get('cid')).toBe(dir)
    expect(
      calls.find((c) => c.url.pathname === '/rb/delete')?.body.get('fid[0]')
    ).toBe(dir)
  })
  it.each([
    [990001, 'login'],
    [4100012, 'extraction-code'],
    [4100008, 'extraction-code'],
    [4100026, 'expired-share'],
    [50029, 'permission'],
  ] as const)(
    'classifies %i without retaining response text',
    async (code, kind) => {
      const { adapter, setError } = fixture()
      setError(code)
      await expect(adapter.checkLogin()).rejects.toThrow(`cloud.${kind}`)
    }
  )
})
describe('115 crypto compatibility', () => {
  it('uses 128-byte RSA blocks and preserves the per-request key under PKCS#1 framing', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 1024,
    })
    const n = Buffer.from(
      publicKey.export({ format: 'jwk' }).n ?? '',
      'base64url'
    )
    const codec = new Pan115Crypto(BigInt(`0x${n.toString('hex')}`))
    const key = randomBytes(16)
    const encoded = Buffer.from(
      codec.encode(
        JSON.stringify({ pickcode: randomBytes(240).toString('hex') }),
        key
      ),
      'base64'
    )
    expect(encoded.length > 128 && encoded.length % 128 === 0).toBe(true)
    const block = privateDecrypt(
      { key: privateKey, padding: constants.RSA_NO_PADDING },
      encoded.subarray(0, 128)
    )
    expect(block[0] === 0 && block[1] === 2).toBe(true)
    expect(
      block
        .subarray(block.indexOf(0, 2) + 1, block.indexOf(0, 2) + 17)
        .equals(key)
    ).toBe(true)
    expect(() => codec.decode('invalid', key)).toThrow('cloud.identity')
  })
})
