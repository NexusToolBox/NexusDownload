import { z } from 'zod'

export const remoteFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  bytes: z.number().int().nonnegative().safe(),
  hash: z
    .string()
    .regex(/^(?:sha256:[a-fA-F0-9]{64}|sha1:[a-fA-F0-9]{40})$/)
    .optional(),
  localPath: z.string().optional(),
  downloaded: z.number().nonnegative().default(0),
  verified: z.boolean().default(false),
  etag: z.string().optional(),
})
export const remoteJobSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  adapter: z.string(),
  source: z.string(),
  directory: z.string(),
  remoteId: z.string().optional(),
  intent: z.boolean().default(false),
  phase: z
    .enum(['remote', 'waiting', 'retrieving', 'processing', 'completed'])
    .default('remote'),
  progress: z.number().min(0).max(100).default(0),
  files: z.array(remoteFileSchema).default([]),
  maxBytes: z.number().int().positive().safe(),
  retainHours: z.number().int().min(0).max(8760).default(24),
  remoteOnly: z.boolean().default(false),
  createdAt: z.number(),
  verifiedAt: z.number().optional(),
  cleaned: z.boolean().default(false),
  error: z.string().optional(),
  usage: z.string().optional(),
})
export type RemoteFile = z.infer<typeof remoteFileSchema>
export type RemoteJob = z.infer<typeof remoteJobSchema>
export const nodeUrlSchema = z.url().refine((s) => {
  const u = new URL(s)
  return (
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash &&
    (u.protocol === 'https:' ||
      (u.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
  )
})
export const remoteNodeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(60),
  url: nodeUrlSchema,
  bridgeUrl: nodeUrlSchema,
})
export type RemoteNode = z.infer<typeof remoteNodeSchema>
export const nodeActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('node-pair'), node: remoteNodeSchema }).strict(),
  z.object({ action: z.literal('node-poll'), id: z.string().uuid() }).strict(),
  z
    .object({ action: z.literal('node-remove'), id: z.string().uuid() })
    .strict(),
])
export const nodeSubmitSchema = z
  .object({
    id: z.string().uuid(),
    source: z.string().max(32768),
    maxBytes: z.number().int().positive().safe(),
  })
  .strict()
export const remoteSubmitSchema = z
  .object({
    adapter: z.string().min(1).max(120),
    source: z
      .string()
      .min(1)
      .max(32768)
      .refine((s) => {
        try {
          const u = new URL(s)
          return (
            ['magnet:', 'http:', 'https:'].includes(u.protocol) &&
            !u.username &&
            !u.password
          )
        } catch {
          return false
        }
      }),
    directory: z.string().min(1),
    maxBytes: z.number().int().positive().safe(),
    retainHours: z.number().int().min(0).max(8760).default(24),
    remoteOnly: z.boolean().default(false),
  })
  .strict()
export const remoteActionSchema = z.discriminatedUnion('action', [
  remoteSubmitSchema.extend({ action: z.literal('remote-submit') }),
  z
    .object({ action: z.literal('remote-refresh'), id: z.string().uuid() })
    .strict(),
  z
    .object({ action: z.literal('remote-retrieve'), id: z.string().uuid() })
    .strict(),
])
