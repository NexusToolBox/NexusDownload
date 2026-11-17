import { z } from 'zod'
export const processingSteps = [
  'verify',
  'extract',
  'scan',
  'mark',
  'organize',
  'notify',
] as const
export const processingConfigSchema = z.object({
  extract: z.boolean().default(false),
  trashArchives: z.boolean().default(false),
  expectedBytes: z.number().int().nonnegative().optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
})
export const processingRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  taskIds: z.array(z.string()),
  directory: z.string(),
  files: z.array(z.string()),
  moves: z
    .array(
      z.object({ source: z.string(), target: z.string(), linked: z.boolean() })
    )
    .default([]),
  outputs: z.array(z.string()).default([]),
  extracted: z.boolean().default(false),
  archives: z.array(z.string()).default([]),
  config: processingConfigSchema,
  steps: z.array(
    z.object({
      name: z.enum(processingSteps),
      status: z.enum(['pending', 'running', 'done', 'skipped', 'failed']),
      reason: z.string().default(''),
    })
  ),
})
export type ProcessingRecord = z.infer<typeof processingRecordSchema>
export const processingActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('processing-save'),
      id: z.string(),
      config: processingConfigSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('processing-retry'),
      id: z.string(),
      step: z.enum(processingSteps),
      password: z.string().max(1024).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('processing-password-book'),
      passwords: z.array(z.string().min(1).max(1024)).max(200),
      keepIndices: z
        .array(z.number().int().min(0).max(199))
        .max(200)
        .optional(),
      expectedCount: z.number().int().min(0).max(200).optional(),
    })
    .strict(),
])
