import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import type { CredentialBroker } from '../cloud/credential-broker'
import type { WorkflowTask } from './queue-manager'
export const downloadPackageSchema = z.object({
  id: z.string(),
  name: z.string(),
  taskIds: z.array(z.string()),
  directory: z.string(),
  extract: z.boolean().default(false),
  trashArchives: z.boolean().default(false),
  description: z.string().default(''),
  pageText: z.string().default(''),
})
export type DownloadPackage = z.infer<typeof downloadPackageSchema>
export function volumeKey(name: string): { key: string; index: number } | null {
  const match = name.match(
    /^(.*?)(?:\.part(\d+)\.rar|\.(7z|zip)\.(\d{3})|\.r(\d{2}))$/i
  )
  if (!match)
    return /\.rar$/i.test(name) ? { key: name.toLowerCase(), index: 1 } : null
  return {
    key: `${match[1]}.${match[3] ?? 'rar'}`.toLowerCase(),
    index: Number(match[2] ?? match[4] ?? Number(match[5]) + 2),
  }
}
export class PackageManager {
  private packages: DownloadPackage[] = []
  constructor(
    private deps: {
      broker: CredentialBroker
      tasks(): WorkflowTask[]
      configured?(pkg: DownloadPackage): Promise<void>
      changed(): void
      control(id: string, wanted: boolean): Promise<void>
    }
  ) {}
  async load() {
    const data = this.deps.broker.get('packages')
    if (data)
      this.packages = z.array(downloadPackageSchema).parse(JSON.parse(data))
  }
  private async save() {
    await this.deps.broker.update('packages', () =>
      JSON.stringify(this.packages)
    )
    this.deps.changed()
  }
  snapshot() {
    const tasks = this.deps.tasks()
    return this.packages.map(
      ({ description: _description, pageText: _page, ...pkg }) => {
        const members = pkg.taskIds.map((id) => tasks.find((t) => t.id === id))
        const bytes = members.reduce((n, t) => n + (t?.bytes ?? 0), 0)
        return {
          ...pkg,
          bytes,
          progress: bytes
            ? members.reduce((n, t) => n + (t?.downloaded ?? 0), 0) / bytes
            : members.reduce((n, t) => n + (t?.progress ?? 0), 0) /
              Math.max(1, members.length),
          completed:
            members.length > 0 &&
            members.every(
              (t) => t && ['completed', 'seeding'].includes(t.status)
            ),
          members: members.filter((t): t is WorkflowTask => !!t),
        }
      }
    )
  }
  all() {
    return this.packages
  }
  packageFor(id: string) {
    return this.packages.find((p) => p.taskIds.includes(id))
  }
  async create(
    name: string,
    taskIds: string[],
    directory: string,
    description = '',
    pageText = ''
  ) {
    const existing = this.packages.find((p) =>
      taskIds.some((id) => p.taskIds.includes(id))
    )
    if (existing) {
      existing.taskIds = [...new Set([...existing.taskIds, ...taskIds])]
      await this.save()
      return existing.id
    }
    const pkg = downloadPackageSchema.parse({
      id: randomUUID(),
      name,
      taskIds,
      directory,
      description,
      pageText,
    })
    this.packages.push(pkg)
    await this.save()
    return pkg.id
  }
  async reconcile() {
    const groups = new Map<string, WorkflowTask[]>()
    for (const task of this.deps.tasks()) {
      const volume = volumeKey(task.name)
      if (!volume) continue
      const key = `${path.resolve(task.directory).toLowerCase()}|${volume.key}`
      const group = groups.get(key) ?? []
      group.push(task)
      groups.set(key, group)
    }
    for (const group of groups.values())
      if (group.length > 1 && !group.every((t) => this.packageFor(t.id)))
        await this.create(
          volumeKey(group[0].name)?.key ?? group[0].name,
          group.map((t) => t.id),
          group[0].directory
        )
  }
  async action(raw: unknown) {
    const req = z
      .discriminatedUnion('action', [
        z
          .object({
            action: z.literal('package-control'),
            id: z.string(),
            wanted: z.boolean(),
          })
          .strict(),
        z
          .object({
            action: z.literal('package-save'),
            id: z.string(),
            extract: z.boolean(),
            trashArchives: z.boolean(),
            description: z.string().max(32768).optional(),
            pageText: z.string().max(32768).optional(),
          })
          .strict(),
      ])
      .parse(raw)
    const pkg = this.packages.find((p) => p.id === req.id)
    if (!pkg) throw new Error('workflow.invalid')
    if (req.action === 'package-control')
      for (const id of pkg.taskIds) await this.deps.control(id, req.wanted)
    else {
      await this.deps.configured?.({
        ...pkg,
        extract: req.extract,
        trashArchives: req.trashArchives,
      })
      pkg.extract = req.extract
      pkg.trashArchives = req.trashArchives
      if (req.description !== undefined) pkg.description = req.description
      if (req.pageText !== undefined) pkg.pageText = req.pageText
    }
    await this.save()
    return this.snapshot()
  }
}
