import { z } from 'zod'

export const controlActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('mcp-enable'), enabled: z.boolean() }).strict(),
  z
    .object({ action: z.literal('phone-enable'), enabled: z.boolean() })
    .strict(),
  z
    .object({
      action: z.literal('phone-pair'),
      code: z.string().min(1).max(20),
    })
    .strict(),
  z
    .object({
      action: z.literal('phone-remove'),
      id: z.string().min(1).max(128),
    })
    .strict(),
])
export const phoneRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('collect'),
      input: z.string().min(1).max(32768),
    })
    .strict(),
  z
    .object({
      action: z.enum(['pause', 'resume']),
      id: z.string().min(1).max(128),
    })
    .strict(),
])
export interface ControlTask {
  id: string
  status: string
  bytes: number
  completed: number
  speed: number
  type: string
  failure: string | null
}
export interface ControlSnapshot {
  mcp: { enabled: boolean; error: boolean; config: unknown }
  phone: {
    enabled: boolean
    urls: string[]
    qr: string
    devices: { id: string; name: string; pairedAt: number }[]
    error: boolean
  }
}
