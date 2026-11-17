import { z } from 'zod'

export const mediaPlatformSchema = z.enum([
  'douyin',
  'kuaishou',
  'weibo',
  'xiaohongshu',
  'bilibili',
  'acfun',
  'pixiv',
  'external',
])
export type MediaPlatform = z.infer<typeof mediaPlatformSchema>
export const mediaChoiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['video', 'image']),
  format: z.string(),
  bytes: z.number().nullable(),
  entry: z.string(),
  motion: z.boolean().default(false),
})
export const mediaResultSchema = z.object({
  id: z.string(),
  platform: mediaPlatformSchema,
  title: z.string(),
  choices: z.array(mediaChoiceSchema),
  subtitles: z.array(z.string()),
  notice: z.string().optional(),
})
export type MediaResult = z.infer<typeof mediaResultSchema>
export const mediaActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('parse'),
      url: z.url().max(8192),
      gallery: z.boolean().default(false),
      quality: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('download'),
      id: z.string(),
      choices: z.array(z.string()).min(1).max(500),
      directory: z.string().min(1).max(1024),
      subtitle: z.string().optional(),
      format: z.enum(['mp4', 'mkv']).default('mp4'),
      livePhoto: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('login'),
      platform: mediaPlatformSchema,
      url: z.url().optional(),
    })
    .strict(),
  z
    .object({ action: z.literal('logout'), platform: mediaPlatformSchema })
    .strict(),
])
