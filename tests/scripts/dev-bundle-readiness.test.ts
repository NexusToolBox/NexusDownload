import { describe, expect, it } from 'vitest'
// @ts-expect-error -- The development runner is plain JavaScript.
import { createBundleReadiness } from '../../scripts/dev-bundle-readiness.mjs'

describe('development bundle readiness', () => {
  it('waits for main while a faster preload rebuild requests a restart', () => {
    const bundles = createBundleReadiness(['main', 'preload', 'worker'])
    for (const name of ['main', 'preload', 'worker']) bundles.written(name)
    expect(bundles.canLaunch()).toBe(true)
    bundles.building('main')
    bundles.building('preload')
    bundles.written('preload')
    expect(bundles.canLaunch()).toBe(false)
    bundles.written('main')
    expect(bundles.canLaunch()).toBe(true)
  })

  it('keeps a failed build unavailable until a later successful write', () => {
    const bundles = createBundleReadiness(['main', 'preload', 'worker'])
    bundles.written('main')
    bundles.written('preload')
    bundles.written('worker')
    bundles.building('main')
    bundles.written('unrelated')
    expect(bundles.canLaunch()).toBe(false)
    bundles.written('main')
    expect(bundles.canLaunch()).toBe(true)
  })
})
