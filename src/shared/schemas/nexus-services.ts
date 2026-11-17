import { z } from 'zod'

const field = z.string().regex(/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+){0,8}$/)
export const connectorSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    name: z.string().min(1).max(80),
    platforms: z
      .array(z.string().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/))
      .min(1)
      .max(20),
    endpoint: z.url().refine((s) => {
      const u = new URL(s)
      return (
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      )
    }),
    method: z.enum(['GET', 'POST']),
    inputField: field.default('url'),
    resultField: field.default('data.url'),
    titleField: field.default('data.title'),
  })
  .strict()
export type ParserConnector = z.infer<typeof connectorSchema>
export const servicesActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('connector-save'),
      connector: connectorSchema,
      key: z.string().max(4096).optional(),
    })
    .strict(),
  z.object({ action: z.literal('connector-remove'), id: z.string() }).strict(),
  z.object({ action: z.literal('rd-authorize') }).strict(),
  z.object({ action: z.literal('rd-poll') }).strict(),
  z.object({ action: z.literal('rd-logout') }).strict(),
  z
    .object({
      action: z.literal('rd-link'),
      url: z.url().max(8192),
      directory: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal('rd-add-magnet'),
      magnet: z.string().startsWith('magnet:?').max(32768),
    })
    .strict(),
  z
    .object({
      action: z.literal('rd-torrent'),
      id: z.string().regex(/^[a-zA-Z0-9]+$/),
    })
    .strict(),
  z
    .object({
      action: z.literal('rd-select'),
      id: z.string().regex(/^[a-zA-Z0-9]+$/),
      files: z.array(z.number().int().positive()).min(1).max(5000),
    })
    .strict(),
  z
    .object({
      action: z.literal('rd-delete'),
      id: z.string().regex(/^[a-zA-Z0-9]+$/),
    })
    .strict(),
])
