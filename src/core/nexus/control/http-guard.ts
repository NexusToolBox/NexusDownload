import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export function privateAddress(raw: string): boolean {
  const ip = raw.replace(/^::ffff:/, '')
  const parts = ip.split('.').map(Number)
  if (
    parts.length === 4 &&
    parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  )
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    )
  return ip === '::1'
}
export function equalSecret(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
export function sameOrigin(req: IncomingMessage, hosts: string[]) {
  return (
    hosts.includes(req.headers.host || '') &&
    (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`)
  )
}
export async function jsonBody(req: IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new Error('control.invalid')
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 65536) throw new Error('control.invalid')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export function reply(res: ServerResponse, code: number, value: unknown) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}
