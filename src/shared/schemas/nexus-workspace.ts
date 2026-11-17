import { z } from 'zod'
import { nexusDiskSpaceSchema } from './nexus-disk'
import { nexusDuplicateSchema } from './nexus-duplicate'

export const nexusPlatformSchema = z.enum([
  'http',
  'magnet',
  'baidu',
  'quark',
  'uc',
  'aliyun',
  '115',
  '123',
  'other',
])
export const nexusFileTypeSchema = z.enum([
  'video',
  'audio',
  'archive',
  'document',
  'software',
  'image',
  'other',
])
const reference = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/)
export const sourceRefSchema = z
  .object({
    id: reference,
    platform: nexusPlatformSchema,
    identity: z.string().regex(/^[a-f0-9]{64}$/),
    host: z.string().max(253),
    shareId: reference.optional(),
    fileId: reference.optional(),
    originalPath: z.string().max(1024).optional(),
    resourceKind: z.enum(['original-file', 'playback-stream']),
    expectedBytes: z.number().int().nonnegative().nullable(),
    hash: z
      .object({
        algorithm: z.enum(['sha256', 'sha1', 'md5']),
        value: z
          .string()
          .regex(/^[a-fA-F0-9]+$/)
          .max(128),
      })
      .strict()
      .optional(),
  })
  .strict()
export const accountRefSchema = z
  .object({
    id: reference,
    platform: nexusPlatformSchema,
    identity: reference,
    credentialRef: reference,
    authorization: z.enum(['official-login', 'oauth', 'import']),
    refreshServiceRef: reference.optional(),
    governor: z.enum(['conservative', 'standard', 'custom']),
  })
  .strict()
export const routePlanSchema = z
  .object({
    id: reference,
    resolver: reference,
    linkMethod: z.enum(['direct', 'without-save', 'guest', 'save', 'playback']),
    refresh: z.enum(['none', 'local-account', 'credential-service']),
    executor: z.enum(['local', 'remote']),
    accountRef: reference.optional(),
    exitRequirement: z.enum(['any', 'same-ip', 'same-agent']),
    repatriation: z.enum(['none', 'download-back']),
    cleanup: z.enum(['none', 'after-complete', 'manual']),
  })
  .strict()
export const packageRefSchema = z
  .object({
    id: reference,
    name: z.string().max(255),
    taskIds: z.array(reference),
    passwordRef: reference.optional(),
    directory: z.string().max(1024),
    postProcess: z.array(
      z.enum(['verify', 'extract', 'scan', 'mark', 'organize'])
    ),
  })
  .strict()
const directory = z
  .string()
  .min(1)
  .max(180)
  .refine((value) => {
    if (/^[\\/]|[:\0]/.test(value)) return false
    return value
      .split(/[\\/]/)
      .every(
        (part) =>
          part.length > 0 &&
          part !== '.' &&
          part !== '..' &&
          !/[. ]$/.test(part) &&
          !/[<>"|?*]/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      )
  }, 'nexus.invalidRuleDirectory')
export const classificationRuleSchema = z
  .object({
    id: reference,
    enabled: z.boolean(),
    kind: z.enum(['type', 'platform', 'source']),
    value: z.string().min(1).max(253),
    directory,
  })
  .strict()
export const nexusPreferencesSchema = z
  .object({
    diskReserveGiB: z.number().min(0.1).max(1024).default(5),
    classificationEnabled: z.boolean().default(true),
    clipboardEnabled: z.boolean().default(true),
    duplicateWarning: z.boolean().default(true),
    notificationShortcut: z.boolean().default(true),
    diagnosticsEnabled: z.boolean().default(false),
    mediaQuality: z
      .number()
      .int()
      .refine((value) =>
        [16, 32, 64, 74, 80, 112, 116, 120, 125, 126, 127].includes(value)
      )
      .default(120),
    livePhoto: z.boolean().default(true),
    offline115: z.boolean().default(false),
    markInternet: z.boolean().default(true),
    trayNoticeShown: z.boolean().default(false),
    taskbarProgressInitialized: z.boolean().optional(),
    rules: z
      .array(classificationRuleSchema)
      .max(100)
      .default([
        {
          id: 'video',
          enabled: true,
          kind: 'type',
          value: 'video',
          directory: '视频',
        },
        {
          id: 'software',
          enabled: true,
          kind: 'type',
          value: 'software',
          directory: '软件',
        },
        {
          id: 'archive',
          enabled: true,
          kind: 'type',
          value: 'archive',
          directory: '压缩包',
        },
        {
          id: 'document',
          enabled: true,
          kind: 'type',
          value: 'document',
          directory: '文档',
        },
      ]),
  })
  .strict()
export const nexusInboxEntrySchema = z
  .object({
    id: reference,
    source: sourceRefSchema,
    title: z.string().max(255),
    fileType: nexusFileTypeSchema,
    addedAt: z.number().int(),
  })
  .strict()
export const nexusBindingSchema = z
  .object({
    taskId: reference,
    source: sourceRefSchema,
    routeRef: reference,
    accountRef: reference.optional(),
  })
  .strict()
export const nexusStateSchema = z
  .object({
    version: z.literal(1),
    networkMarks: z
      .record(
        reference,
        z.enum([
          'marked',
          'failed',
          'policy-skipped',
          'unsupported',
          'disabled',
        ])
      )
      .default({}),
    preferences: nexusPreferencesSchema,
    inbox: z.array(nexusInboxEntrySchema).max(500),
    accounts: z.array(accountRefSchema),
    routes: z.array(routePlanSchema),
    bindings: z.array(nexusBindingSchema),
    packages: z.array(packageRefSchema),
  })
  .strict()
export const nexusSnapshotSchema = nexusStateSchema.extend({
  availableInputIds: z.array(reference),
  diagnostics: z.object({ files: z.number(), bytes: z.number() }).optional(),
})
export const nexusCollectRequestSchema = z
  .object({ input: z.string().min(1).max(32768) })
  .strict()
export const nexusPreflightRequestSchema = z
  .object({
    ids: z.array(reference).min(1).max(50),
    directory: z.string().max(1024).optional(),
    skipDuplicates: z.boolean().default(true),
  })
  .strict()
export const httpProbeSchema = z.object({
  status: z.number().int(),
  range: z.boolean().nullable(),
  retried: z.boolean(),
  error: z
    .enum([
      'unauthorized',
      'forbidden',
      'not-found',
      'server',
      'http',
      'network',
    ])
    .optional(),
})
export type HttpProbe = z.infer<typeof httpProbeSchema>
export const nexusPreflightSchema = z.object({
  items: z.array(
    nexusInboxEntrySchema.extend({
      available: z.boolean(),
      saveDir: z.string(),
      probe: httpProbeSchema.optional(),
      duplicate: nexusDuplicateSchema.optional(),
    })
  ),
  disks: z.array(nexusDiskSpaceSchema),
  knownBytes: z.number(),
  unknownCount: z.number(),
  blocked: z.boolean(),
})
export type SourceRef = z.infer<typeof sourceRefSchema>
export type AccountRef = z.infer<typeof accountRefSchema>
export type RoutePlan = z.infer<typeof routePlanSchema>
export type RouteRef = RoutePlan['id']
export type PackageRef = z.infer<typeof packageRefSchema>
export type NexusPlatform = z.infer<typeof nexusPlatformSchema>
export type NexusFileType = z.infer<typeof nexusFileTypeSchema>
export type NexusPreferences = z.infer<typeof nexusPreferencesSchema>
export type NexusState = z.infer<typeof nexusStateSchema>
export type NexusSnapshot = z.infer<typeof nexusSnapshotSchema>
export type NexusInboxEntry = z.infer<typeof nexusInboxEntrySchema>
export type NexusPreflight = z.infer<typeof nexusPreflightSchema>
