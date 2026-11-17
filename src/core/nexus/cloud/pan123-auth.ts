// Port of YunX Desktop 1.3.4 Pan123Api.makeSign, Pan123DeviceId and Pan123LoginSupport.
// Copyright YunX contributors. SPDX-License-Identifier: AGPL-3.0-only
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { CloudError } from './cloud-adapter'
import { type CloudHttp, object, text } from './cloud-http'
import { platformError, platformRequest } from './platform-request'

export const PAN123_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
export const pan123CredentialSchema = z.object({
  token: z
    .string()
    .min(1)
    .max(16384)
    .refine((v) =>
      [...v].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    ),
  device: z.string().regex(/^[a-f0-9]{32}$/i),
})
function crc32(value: string) {
  let crc = 0xffffffff
  for (const byte of Buffer.from(value)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16)
}
export function pan123Sign(
  path: string,
  ts = Math.floor(Date.now() / 1000),
  nonce = randomInt(10000000)
) {
  const minute = new Date((ts + 57600) * 1000)
    .toISOString()
    .slice(0, 16)
    .replace(/[-T:]/g, '')
  const key = crc32(
    [...minute].map((n) => 'adefghlmyijnopkqrstubcvwsz'[Number(n)]).join('')
  )
  return {
    'auth-key': key,
    'auth-value': `${ts}-${nonce}-${crc32(`${ts}|${nonce}|${path}|web|3|${key}`)}`,
  }
}
export async function pan123PasswordLogin(
  http: CloudHttp,
  device: string,
  account: string,
  password: string
) {
  const passport = account.trim()
  if (!passport || passport.length > 254 || !password || password.length > 256)
    throw new CloudError('login')
  const { json } = await platformRequest(
    http,
    'https://user.123pan.cn/api/user/sign_in',
    {
      platform: 'web',
      'app-version': '132',
      loginuuid: device,
      Origin: 'https://user.123pan.cn',
      Referer: 'https://user.123pan.cn/',
      'User-Agent': PAN123_UA,
      'Content-Type': 'application/json;charset=UTF-8',
    },
    { passport, password, remember: false },
    'request',
    (json) => {
      if (json.code === 200) return
      const message = text(json.message)
      if (/频繁|频率|次数|稍后/.test(message)) throw new CloudError('rate')
      if (/验证码|滑块|安全验证|验证失败|captcha|verify/i.test(message))
        throw new CloudError('captcha')
      throw platformError(Number(json.code), '', { 429: 'rate' })
    }
  )
  return pan123CredentialSchema.parse({
    token: text(object(json.data).token),
    device,
  })
}
