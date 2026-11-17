import { z } from 'zod'

export const cloudPlatformSchema = z.enum([
  'baidu',
  'quark',
  'uc',
  'aliyun',
  '115',
  '123',
])
export const cloudMethodSchema = z.enum([
  'own',
  'without-save',
  'guest',
  'save',
])
export const cloudErrorSchema = z.enum([
  'login',
  'login-elsewhere',
  'captcha',
  'risk',
  'rate',
  'permission',
  'extraction-code',
  'expired-share',
  'expired-link',
  'headers',
  'size',
  'identity',
  'space',
  'checkpoint',
  'path',
  'network',
  'unsupported',
  'playback',
  'open-platform',
  'share-auth',
])
export type CloudPlatform = z.infer<typeof cloudPlatformSchema>
export type CloudMethod = z.infer<typeof cloudMethodSchema>
export type CloudErrorKind = z.infer<typeof cloudErrorSchema>
export const cloudFileSchema = z
  .object({
    id: z.string().min(1).max(1024),
    name: z.string().min(1).max(255),
    bytes: z.number().int().nonnegative().safe().nullable(),
    directory: z.boolean(),
    parent: z.string().max(1024),
    path: z.string().max(4096),
    version: z.string().max(256).optional(),
    hash: z.string().max(128).optional(),
    modified: z.string().max(64).optional(),
  })
  .strict()
export type CloudFile = z.infer<typeof cloudFileSchema>
export const cloudBrowseRequestSchema = z
  .object({
    platform: cloudPlatformSchema,
    accountId: z.string().max(128).optional(),
    shareRef: z.string().max(128).optional(),
    directory: z.string().max(1024).default('0'),
  })
  .strict()
export const cloudSelectionSchema = z
  .object({
    contextId: z.string().min(1).max(128),
    ids: z.array(z.string().min(1).max(1024)).min(1).max(200),
    method: cloudMethodSchema,
    directory: z.string().min(1).max(1024),
    allowPlayback: z.boolean().default(false),
    skipExisting: z.boolean().default(true),
  })
  .strict()
export const cloudOpenShareSchema = z
  .object({
    platform: cloudPlatformSchema,
    accountId: z.string().max(128).optional(),
    input: z.string().min(1).max(8192),
  })
  .strict()
export const cloudProfileSchema = z.object({
  nickname: z.string().max(256).default(''),
  avatarPath: z.string().max(4096).optional(),
  readAt: z.number(),
  avatarCheckedAt: z.number().optional(),
})
export const cloudAccountSchema = z
  .object({
    id: z.string(),
    platform: cloudPlatformSchema,
    state: z.enum(['ready', 'paused']),
    reason: cloudErrorSchema.optional(),
    governor: z.enum(['conservative', 'standard']),
    requests: z.number(),
    links: z.number(),
    transfers: z.number(),
    transferLimit: z.number(),
    concurrency: z.number(),
    note: z.string().max(128).optional(),
    transferOnly: z.boolean().optional(),
    authorization: z.enum(['web', 'official', 'online', 'share']).optional(),
    profile: cloudProfileSchema.optional(),
    avatarData: z.string().max(3000000).optional(),
    needsLocalLogin: z.boolean().optional(),
    health: z
      .object({
        checkedAt: z.number(),
        login: z.enum(['unknown', 'valid', 'expired', 'error']),
        member: z.boolean().nullable(),
        quota: z.object({ total: z.number(), used: z.number() }).nullable(),
        platformUsedBytes: z.number().nullable(),
        expiresAt: z.number().nullable(),
      })
      .optional(),
    recentRiskAt: z.number().nullable().optional(),
    temporaryCount: z.number().optional(),
  })
  .strict()
export type CloudAccount = z.infer<typeof cloudAccountSchema>
export const cloudSelfCheckSchema = z.union([
  z
    .string()
    .max(128)
    .optional()
    .transform((accountId) => ({
      accountId,
      shareInput: undefined as string | undefined,
    })),
  z
    .object({
      accountId: z.string().max(128),
      shareInput: z.string().min(1).max(8192).optional(),
    })
    .strict(),
])
export const cloudAccountUpdateSchema = z
  .object({
    id: z.string().max(128),
    note: z.string().trim().max(128),
    transferOnly: z.boolean(),
    governor: z.enum(['conservative', 'standard']).optional(),
  })
  .strict()
export const cloudResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: cloudErrorSchema }),
])
export const cloudSnapshotSchema = z.object({
  available: z.boolean(),
  accounts: z.array(cloudAccountSchema),
  tasks: z.array(
    z.object({
      taskId: z.string(),
      phase: z.string(),
      reason: cloudErrorSchema.optional(),
      platform: cloudPlatformSchema,
      accountId: z.string().optional(),
      method: cloudMethodSchema,
      kind: z.enum(['original-file', 'playback-stream']),
      cleanup: z.string(),
    })
  ),
  orphans: z.array(z.object({ accountId: z.string(), directory: z.string() })),
  koulingEnabled: z.boolean(),
})
export const cloudBrowseSchema = z.object({
  contextId: z.string(),
  platform: cloudPlatformSchema,
  accountId: z.string().optional(),
  title: z.string(),
  shareRef: z.string().optional(),
  files: z.array(cloudFileSchema),
  capabilities: z.object({
    own: z.boolean(),
    withoutSave: z.boolean(),
    guest: z.boolean(),
    save: z.boolean(),
    playback: z.boolean(),
  }),
})
export const cloudPreflightSchema = z.object({
  etaSeconds: z.number().nonnegative().nullable().default(null),
  speedBps: z.number().nonnegative().nullable().default(null),
  successRate: z.number().min(0).max(1).nullable().default(null),
  duplicates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      path: z.string(),
      basis: z.string(),
      taskId: z.string().optional(),
      status: z.enum(['active', 'completed']).optional(),
    })
  ),
  skipped: z.number(),
  downloadCount: z.number(),
  count: z.number(),
  knownBytes: z.number(),
  unknown: z.number(),
  disk: z.object({ freeBytes: z.number().nullable() }),
  quota: z.object({ total: z.number(), used: z.number() }).nullable(),
  spaceEnough: z.boolean(),
  diskEnough: z.boolean(),
  transferEnough: z.boolean(),
  account: cloudAccountSchema.nullable(),
  method: cloudMethodSchema,
  blocked: z.boolean(),
  files: z.array(z.object({ name: z.string(), bytes: z.number().nullable() })),
})
export type CloudSnapshot = z.infer<typeof cloudSnapshotSchema>
export type CloudBrowse = z.infer<typeof cloudBrowseSchema>
export type CloudPreflight = z.infer<typeof cloudPreflightSchema>
