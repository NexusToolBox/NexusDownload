import { z } from 'zod'
export const completionActionSchema = z.enum([
  'none',
  'open',
  'exit',
  'shutdown',
  'sleep',
  'hibernate',
])
export const queueSchema = z.object({
  id: z.string().regex(/^[\w-]{1,128}$/),
  name: z.string().trim().min(1).max(80),
  concurrency: z.number().int().min(1).max(32).default(3),
  retries: z.number().int().min(0).max(20).default(0),
  running: z.boolean().default(false),
  schedule: z
    .object({
      enabled: z.boolean().default(false),
      start: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .default('23:00'),
      stop: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .default('07:00'),
      days: z
        .array(z.number().int().min(0).max(6))
        .max(7)
        .default([0, 1, 2, 3, 4, 5, 6]),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      wake: z.boolean().default(false),
    })
    .default({
      enabled: false,
      start: '23:00',
      stop: '07:00',
      days: [0, 1, 2, 3, 4, 5, 6],
      wake: false,
    }),
  completion: completionActionSchema.default('none'),
  openFile: z.string().max(1024).default(''),
})
export type NexusQueue = z.infer<typeof queueSchema>
export const workflowActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('queue-save'), queue: queueSchema }).strict(),
  z.object({ action: z.literal('queue-delete'), id: z.string() }).strict(),
  z
    .object({
      action: z.literal('queue-run'),
      id: z.string(),
      running: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('assign'),
      queueId: z.string(),
      taskIds: z.array(z.string()).min(1).max(1000),
    })
    .strict(),
  z.object({ action: z.literal('cancel-completion'), id: z.string() }).strict(),
])
