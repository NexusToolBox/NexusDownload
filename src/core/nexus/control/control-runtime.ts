import { networkInterfaces } from 'node:os'
import {
  type ControlSnapshot,
  type ControlTask,
  controlActionSchema,
} from '@shared/schemas/nexus-control'
import type { CredentialBroker } from '../cloud/credential-broker'
import { McpServer } from './mcp-server'
import { PhoneServer } from './phone-server'

export class ControlRuntime {
  private enabled = false
  private error = false
  private mcpEnabled = false
  private mcpError = false
  private tail: Promise<unknown> = Promise.resolve()
  private controls?: {
    pause(id: string): Promise<void>
    resume(id: string): Promise<void>
    remove(id: string, deleteFiles: boolean): Promise<void>
    add(input: string): Promise<{ taskId?: string; pending?: boolean }>
  }
  readonly phone: PhoneServer
  readonly mcp: McpServer
  constructor(
    private deps: {
      broker: CredentialBroker
      webRoot: string
      changed(): void
      collect(input: string): Promise<void>
      tasks(): ControlTask[]
      directory: string
      confirmDelete(id: string): Promise<boolean>
      checkAccounts(): Promise<unknown>
    }
  ) {
    this.mcp = new McpServer({
      ...deps,
      add: async (input) => {
        if (!this.controls) throw new Error('control.failed')
        return this.controls.add(input)
      },
      control: async (action, id, deleteFiles = false) => {
        if (!this.controls) throw new Error('control.failed')
        if (action === 'remove') await this.controls.remove(id, deleteFiles)
        else await this.controls[action](id)
      },
    })
    this.phone = new PhoneServer({
      ...deps,
      addresses: () =>
        Object.values(networkInterfaces())
          .flatMap((values) => values || [])
          .filter((v) => v.family === 'IPv4' && !v.internal)
          .map((v) => v.address),
      control: async (action, id) => {
        if (!this.controls) throw new Error('control.failed')
        await this.controls[action](id)
      },
    })
  }
  setControls(controls: NonNullable<ControlRuntime['controls']>) {
    this.controls = controls
  }
  async load() {
    await this.phone.load()
    this.enabled = this.deps.broker.get('phone-enabled') === 'true'
    if (this.enabled)
      await this.phone.start().catch(() => {
        this.error = true
      })
    this.mcpEnabled = this.deps.broker.get('mcp-enabled') === 'true'
    if (this.mcpEnabled)
      await this.mcp.start().catch(() => {
        this.mcpError = true
      })
  }
  snapshot(): ControlSnapshot {
    return {
      mcp: {
        enabled: this.mcpEnabled,
        error: this.mcpError,
        config: this.mcp.config(),
      },
      phone: {
        enabled: this.enabled,
        error: this.error,
        ...this.phone.snapshot(),
      },
    }
  }
  action(raw: unknown): Promise<ControlSnapshot> {
    const req = controlActionSchema.parse(raw)
    const work = this.tail
      .catch(() => undefined)
      .then(async () => {
        if (req.action === 'mcp-enable') {
          if (req.enabled) await this.mcp.start()
          else await this.mcp.stop()
          try {
            await this.deps.broker.update('mcp-enabled', () =>
              String(req.enabled)
            )
          } catch (error) {
            await this.mcp.stop()
            this.mcpEnabled = false
            throw error
          }
          this.mcpEnabled = req.enabled
          this.mcpError = false
        } else if (req.action === 'phone-enable') {
          if (req.enabled) await this.phone.start()
          else await this.phone.stop()
          try {
            await this.deps.broker.update('phone-enabled', () =>
              String(req.enabled)
            )
          } catch (error) {
            await this.phone.stop()
            this.enabled = false
            throw error
          }
          this.enabled = req.enabled
          this.error = false
        } else if (req.action === 'phone-pair') {
          if (!this.enabled) throw new Error('control.failed')
          await this.phone.approve(req.code)
        } else await this.phone.revoke(req.id)
        this.deps.changed()
        return this.snapshot()
      })
    this.tail = work
    return work
  }
  async stop() {
    await this.tail.catch(() => undefined)
    await this.phone.stop()
    await this.mcp.stop()
  }
}
