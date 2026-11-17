import { describe, expect, it } from 'vitest'
import { speedPath } from './speed-path'

describe('observed task speed', () => {
  it('preserves real timing, a burst and the pause at zero', () => {
    const line = speedPath([
      { t: 0, down: 0, up: 0 },
      { t: 100, down: 100, up: 0 },
      { t: 1000, down: 0, up: 0 },
    ])
    expect(line).toBe('M0.00 40.00 L27.60 10.43 L276.00 40.00')
  })
  it('does not invent a trace from a single measurement', () => {
    expect(speedPath([{ t: 0, down: 42, up: 0 }])).toBe('')
  })
})
