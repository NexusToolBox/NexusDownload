import { z } from 'zod'
import { cloudMethodSchema, cloudPlatformSchema } from './nexus-cloud'

export const speedKeySchema = z.object({
  platform: cloudPlatformSchema,
  accountId: z.string().nullable(),
  method: z.union([cloudMethodSchema, z.literal('offline')]),
})
export const speedProfileSchema = speedKeySchema.extend({
  averageBps: z.number().nonnegative().nullable(),
  successRate: z.number().min(0).max(1).nullable(),
  attempts: z.number().int().nonnegative(),
  updatedAt: z.number(),
})
export type SpeedKey = z.infer<typeof speedKeySchema>
export type SpeedProfile = z.infer<typeof speedProfileSchema>
