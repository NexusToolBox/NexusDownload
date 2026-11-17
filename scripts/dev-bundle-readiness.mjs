/** A successful bundle remains usable only until its next build starts. */
export function createBundleReadiness(names) {
  const required = new Set(names)
  const ready = new Set()
  return {
    building(name) {
      ready.delete(name)
    },
    written(name) {
      if (required.has(name)) ready.add(name)
    },
    canLaunch() {
      return ready.size === required.size
    },
  }
}
