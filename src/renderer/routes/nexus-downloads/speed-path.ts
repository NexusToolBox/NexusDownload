import type { SpeedPoint } from '@shared/types/stats'

/** Keep zero as the baseline and preserve the actual sampling intervals. */
export function speedPath(history: readonly SpeedPoint[]): string {
  const values = history
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.down))
    .slice(-60)
  if (values.length < 2) return ''
  const start = values[0].t
  const span = Math.max(1, values[values.length - 1].t - start)
  const peak = Math.max(1, ...values.map((p) => p.down)) * 1.15
  return values
    .map(
      (p, i) =>
        `${i ? 'L' : 'M'}${(((p.t - start) * 276) / span).toFixed(2)} ${(40 - (Math.max(0, p.down) * 34) / peak).toFixed(2)}`
    )
    .join(' ')
}
