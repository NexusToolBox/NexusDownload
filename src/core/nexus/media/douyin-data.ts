const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
const str = (v: unknown) =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : ''

/** Do not pick a recommendation for a different work when the main item is blocked. */
export function douyinDetail(
  value: unknown,
  expected = '',
  depth = 0
): Record<string, unknown> | undefined {
  if (depth > 15) return
  if (typeof value === 'string') {
    try {
      return douyinDetail(JSON.parse(value), expected, depth + 1)
    } catch {
      return
    }
  }
  const o = obj(value),
    id = str(o.aweme_id ?? o.awemeId)
  if (
    (!expected || !id || id === expected) &&
    (o.video || o.images || o.image_post_info) &&
    (o.desc || id)
  )
    return o
  for (const child of Object.values(o)) {
    for (const entry of Array.isArray(child) ? child : [child]) {
      const result = douyinDetail(entry, expected, depth + 1)
      if (result) return result
    }
  }
}
