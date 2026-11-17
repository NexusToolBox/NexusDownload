import type { RemoteNodeHost } from '@core/nexus/remote/node-host'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

export function registerNexusRemote(
  app: FastifyInstance,
  host: RemoteNodeHost,
  authenticate: (token: string) => string | null
) {
  const owner = (req: FastifyRequest) => {
    const h = req.headers.authorization
    const id =
      typeof h === 'string' && h.startsWith('Bearer ')
        ? authenticate(h.slice(7))
        : null
    if (!id || req.headers.origin) throw new Error('remote.authorization')
    return id
  }
  const safe = (e: unknown) =>
    e instanceof Error && /^remote\.[a-z-]+$/.test(e.message)
      ? e.message
      : 'remote.failed'
  const params = z.object({
    id: z.string().uuid(),
    file: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  app.post('/nexus/v05/jobs', async (req, reply) => {
    try {
      return await host.submit(owner(req), req.body)
    } catch (e) {
      return reply.code(400).send({ error: safe(e) })
    }
  })
  app.get('/nexus/v05/jobs/:id', async (req, reply) => {
    try {
      return await host.status(owner(req), params.parse(req.params).id)
    } catch (e) {
      return reply.code(400).send({ error: safe(e) })
    }
  })
  app.get('/nexus/v05/jobs/:id/files', async (req, reply) => {
    try {
      return { files: await host.list(owner(req), params.parse(req.params).id) }
    } catch (e) {
      return reply.code(400).send({ error: safe(e) })
    }
  })
  app.get('/nexus/v05/jobs/:id/files/:file', async (req, reply) => {
    try {
      const p = params.parse(req.params)
      const f = await host.file(owner(req), p.id, p.file!)
      reply
        .header('cache-control', 'no-store')
        .header('accept-ranges', 'bytes')
        .header('etag', f.etag)
        .header('content-type', 'application/octet-stream')
      const range = req.headers.range
      let start = 0,
        end = f.bytes - 1
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range)
        if (
          !match ||
          (req.headers['if-range'] && req.headers['if-range'] !== f.etag)
        )
          return reply.code(412).send()
        start = Number(match[1])
        end = match[2] ? Number(match[2]) : end
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          end >= f.bytes
        )
          return reply
            .code(416)
            .header('content-range', `bytes */${f.bytes}`)
            .send()
        reply
          .code(206)
          .header('content-range', `bytes ${start}-${end}/${f.bytes}`)
      }
      reply.header('content-length', Math.max(0, end - start + 1))
      return f.bytes
        ? reply.send(f.stream(start, end))
        : reply.send(Buffer.alloc(0))
    } catch (e) {
      return reply.code(400).send({ error: safe(e) })
    }
  })
  app.post('/nexus/v05/jobs/:id/cleanup', async (req, reply) => {
    try {
      await host.cleanup(owner(req), params.parse(req.params).id)
      return { ok: true }
    } catch (e) {
      return reply.code(400).send({ error: safe(e) })
    }
  })
}
