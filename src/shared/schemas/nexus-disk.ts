import { z } from 'zod'

export const nexusDiskRequestSchema = z
  .object({ directory: z.string().max(1024).optional() })
  .default({})

export const nexusDiskSpaceSchema = z.object({
  directory: z.string(),
  volume: z.string(),
  freeBytes: z.number().nonnegative().nullable(),
  totalBytes: z.number().nonnegative().nullable(),
})

export type NexusDiskSpace = z.infer<typeof nexusDiskSpaceSchema>
