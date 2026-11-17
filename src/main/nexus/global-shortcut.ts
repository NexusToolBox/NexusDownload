interface ShortcutHost {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

/** Owns only the product shortcut; other application shortcuts are untouched. */
export class NexusGlobalShortcut {
  private requested: string | undefined
  private registered = ''
  private capturing = false
  private captureTimer: ReturnType<typeof setTimeout> | undefined
  constructor(
    private options: {
      host: ShortcutHost
      open(): void
      changed(registered: boolean | null): void
    }
  ) {}

  apply(accelerator: string) {
    if (this.requested === accelerator) return
    this.requested = accelerator
    this.register()
  }

  capture(active: boolean) {
    clearTimeout(this.captureTimer)
    this.capturing = active
    this.register()
    // Restore registration if a renderer disappears while recording.
    if (active) this.captureTimer = setTimeout(() => this.capture(false), 30000)
  }

  private register() {
    if (this.registered) this.options.host.unregister(this.registered)
    this.registered = ''
    const accelerator = this.requested ?? ''
    if (!accelerator || this.capturing) {
      this.options.changed(null)
      return
    }
    let registered = false
    try {
      registered = this.options.host.register(accelerator, this.options.open)
    } catch {}
    if (registered) this.registered = accelerator
    this.options.changed(registered)
  }

  dispose() {
    clearTimeout(this.captureTimer)
    if (this.registered) this.options.host.unregister(this.registered)
    this.registered = ''
  }
}
