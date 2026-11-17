import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import { CloudError } from './cloud-adapter'

export interface CredentialCipher {
  available(): Promise<boolean>
  encrypt(value: string): Promise<Buffer>
  decrypt(value: Buffer): Promise<string>
}
/** The only persistent secret store. All mutations and refreshes share one queue. */
export class CredentialBroker {
  private values: Record<string, string> = {}
  private pending: Promise<unknown> = Promise.resolve()
  private loaded = false
  private refreshes = new Map<string, Promise<string>>()
  constructor(
    private file: string,
    private cipher: CredentialCipher
  ) {}
  get directory() {
    return path.dirname(this.file)
  }
  async recoverForRelogin(): Promise<void> {
    if (!(await this.cipher.available())) throw new CloudError('login')
    // Preserve the original vault for its original Windows user.
    await copyFile(this.file, `${this.file}.locked`, 1).catch((error) => {
      if (
        !['EEXIST', 'ENOENT'].includes(
          (error as NodeJS.ErrnoException).code ?? ''
        )
      )
        throw error
    })
    this.values = {}
    this.loaded = true
  }
  async load(): Promise<void> {
    this.loaded = false
    this.values = {}
    if (!(await this.cipher.available())) throw new CloudError('login')
    let data: Buffer
    try {
      data = await readFile(this.file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.loaded = true
        return
      }
      throw new CloudError('login')
    }
    try {
      this.values = z
        .record(z.string(), z.string())
        .parse(JSON.parse(await this.cipher.decrypt(data)))
      this.loaded = true
    } catch {
      throw new CloudError('login')
    }
  }
  get(id: string): string {
    return this.values[id] ?? ''
  }
  async update(
    id: string,
    change: (current: string) => string | Promise<string>
  ): Promise<void> {
    const operation = this.pending
      .catch(() => undefined)
      .then(async () => {
        if (!this.loaded) throw new CloudError('login')
        if (!(await this.cipher.available())) throw new CloudError('login')
        const next = { ...this.values, [id]: await change(this.get(id)) }
        const encrypted = await this.cipher.encrypt(JSON.stringify(next))
        await mkdir(path.dirname(this.file), { recursive: true })
        await writeFileAtomic(this.file, encrypted, { mode: 0o600 })
        this.values = next
      })
    this.pending = operation
    return operation
  }
  async remove(id: string): Promise<void> {
    await this.update(id, () => '')
  }
  /** Exchange outside the write queue: account admission may itself persist counters. */
  async refresh(
    id: string,
    exchange: (current: string) => Promise<string>
  ): Promise<string> {
    const existing = this.refreshes.get(id)
    if (existing) return existing
    const pending = (async () => {
      const original = this.get(id)
      const next = await exchange(original)
      await this.update(id, (current) => {
        if (current !== original) throw new CloudError('login')
        return next
      })
      return next
    })()
    this.refreshes.set(id, pending)
    try {
      return await pending
    } finally {
      if (this.refreshes.get(id) === pending) this.refreshes.delete(id)
    }
  }
  async drain(): Promise<void> {
    await this.pending
  }
}
export function mergeCookies(
  original: string,
  setCookies: string[],
  allowed?: string[]
): string {
  const pairs = new Map(
    original
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)])
  )
  for (const value of setCookies) {
    const pair = value.split(';')[0]
    const index = pair.indexOf('=')
    const name = pair.slice(0, index).trim()
    if (index > 0 && (!allowed || allowed.includes(name))) {
      if (/max-age\s*=\s*0(?:;|$)/i.test(value) || !pair.slice(index + 1))
        pairs.delete(name)
      else pairs.set(name, pair.slice(index + 1))
    }
  }
  return [...pairs].map(([key, value]) => `${key}=${value}`).join('; ')
}
