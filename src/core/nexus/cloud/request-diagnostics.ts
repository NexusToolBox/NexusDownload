import { cloudPlatformSchema } from '@shared/schemas/nexus-cloud'
import { z } from 'zod'

export const cloudRequestRecordSchema = z
  .object({
    at: z.number(),
    platform: cloudPlatformSchema,
    path: z.string().max(256),
    status: z.number().int(),
    redirect: z.string().max(256).optional(),
    code: z.union([z.number(), z.string().max(64)]).optional(),
    message: z.string().max(128).optional(),
    fields: z.array(z.string().max(256)).max(100),
    profile: z
      .object({
        nickname: z.enum(['已取到', '未取到']),
        avatar: z.enum(['已取到', '未取到']),
        avatarField: z
          .string()
          .max(256)
          .regex(/^[A-Za-z][\w.]*$/u)
          .optional(),
      })
      .optional(),
  })
  .strict()
export type CloudRequestRecord = z.infer<typeof cloudRequestRecordSchema>

const families = {
  quark: ['quark.cn', 'quark.com'],
  uc: ['uc.cn', 'ucweb.com'],
  baidu: ['baidu.com'],
  '115': ['115.com', '115cdn.com', '115rc.com'],
  '123': ['123pan.com', '123pan.cn', '123865.com', '123684.com', '123684.cn'],
  aliyun: ['alipan.com', 'aliyundrive.com', 'aliyun.com'],
} as const

export function requestPlatform(host: string) {
  return (Object.keys(families) as (keyof typeof families)[]).find((platform) =>
    families[platform].some(
      (root) => host === root || host.endsWith(`.${root}`)
    )
  )
}

export function isLoginPage(url: URL) {
  return (
    (/^(?:passport|passport-api|login|user)\./i.test(url.hostname) &&
      !/\/api\/user\/(?:info|sign_in)/.test(url.pathname)) ||
    /\/(?:login|signin|sign-in|waplogin)(?:[/.]|$)/i.test(url.pathname)
  )
}

// Only public endpoint names survive. Dynamic IDs, filenames and signed path parts do not.
const segments = new Set(
  'api b v1 v2 v1.0 1 2 0 rest xpan clouddrive account info user loginStatus gettemplatevariable list quota file files download locatedownload filemetas share sharepage token detail save transfer delete mkdir create rename sort task status member space config get sign_in device session authorize oauth access_token refresh_token me users personal_info index_info snap downurl down web android app openfile userinfo user_info get_info getAccountInfo vip right getdownloadurl get_download_url download_url new getDriveInfo getUserInfo adrive getSpaceInfo get_share_token get_share_by_anonymous get_download_url_by_share_token get_share_link_download_url get_download_url get_file getDownloadUrl get user_space_info user_info index.php share.php downurl.php getid.php 3.0 2.0 list/new share_token'.split(
    ' '
  )
)
const symbolicCodes = new Set(
  'AccessTokenInvalid AccessTokenExpired RefreshTokenInvalid RefreshTokenExpired InvalidGrant I400JD ShareLinkTokenInvalid ShareLinkNotFound ShareLinkExpired ShareLinkCancelled ShareLinkForbidden ShareLinkPwdInvalid InvalidSharePwd Forbidden TooManyRequests InvalidParameter'.split(
    ' '
  )
)
export function diagnosticCode(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (
    typeof value === 'string' &&
    (/^-?\d{1,12}$/.test(value) || symbolicCodes.has(value))
  )
    return value
  return undefined
}
export function diagnosticPath(url: URL) {
  return `/${url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => (segments.has(part) ? part : ':redacted'))
    .join('/')}`.slice(0, 256)
}

export function diagnosticMessage(value: unknown) {
  if (typeof value !== 'string' || !value) return undefined
  // Platform messages can echo filenames, passwords, tokens or signatures.
  // Keep only known phrases; never retain arbitrary server text.
  const phrases = value.match(
    /未登录|登录失效|登录过期|已在其他地方登录|异地登录|账号在其他|not logged in|unauthorized|login expired|验证码|captcha|请求频繁|频率限制|权限不足|permission denied|success|成功/gi
  )
  return phrases?.join(' / ').slice(0, 128) ?? '[详情已脱敏]'
}
