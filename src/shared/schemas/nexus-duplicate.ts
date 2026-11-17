import { z } from 'zod'

export const nexusDuplicateSchema = z.object({
  taskId: z.string(),
  status: z.enum(['active', 'completed']),
})
export type NexusDuplicate = z.infer<typeof nexusDuplicateSchema>
