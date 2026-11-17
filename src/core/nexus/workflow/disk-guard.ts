import { getNexusDiskSpace } from '../disk-space'
export class DiskGuard {
  private blocked = new Set<string>()
  constructor(
    private reserve: () => number,
    private changed: () => void,
    private probe = getNexusDiskSpace
  ) {}
  available(directory: string, required = 0): boolean {
    const free = this.probe(directory).freeBytes
    const blocked = free === null || free < this.reserve() + required
    const previous = this.blocked.has(directory)
    if (blocked) this.blocked.add(directory)
    else this.blocked.delete(directory)
    if (previous !== blocked) this.changed()
    return !blocked
  }
  assert(directory: string, required = 0) {
    if (!this.available(directory, required)) throw new Error('media.space')
  }
  snapshot() {
    return { diskBlocked: [...this.blocked], diskReserveBytes: this.reserve() }
  }
}
