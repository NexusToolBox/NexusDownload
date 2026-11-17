import { z } from 'zod'

const token = z.string().max(16384).default('')
const httpsUrl = z
  .string()
  .url()
  .max(2048)
  .refine((v) => {
    const u = new URL(v)
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash
  })
export const aliyunLoginSchema = z.discriminatedUnion('mode', [
  z.object({
    platform: z.literal('aliyun'),
    mode: z.literal('official'),
    clientId: z.string().min(1).max(1024),
    clientSecret: z.string().min(1).max(4096),
    redirectUri: httpsUrl,
  }),
  z.object({
    platform: z.literal('aliyun'),
    mode: z.literal('online'),
    refreshToken: token.refine(Boolean),
    serviceUrl: httpsUrl,
    consent: z.literal(true),
  }),
  z.object({
    platform: z.literal('aliyun'),
    mode: z.literal('share'),
    refreshToken: token.refine(Boolean),
  }),
])
export const aliyunCredentialSchema = z.object({
  mode: z.enum(['official', 'online', 'share']),
  clientId: z.string().default(''),
  clientSecret: z.string().default(''),
  redirectUri: z.string().default(''),
  serviceUrl: z.string().default(''),
  consent: z.boolean().default(false),
  refreshToken: token,
  accessToken: token,
  expiresAt: z.number().default(0),
})
export type AliyunCredential = z.infer<typeof aliyunCredentialSchema>
