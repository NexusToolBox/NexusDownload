import { CompletionShutdownController } from '@core/task/completion-shutdown-controller'
import type { CompletionShutdownState } from '@shared/schemas/completion-shutdown'
import {
  type NexusQueue,
  queueSchema,
  workflowActionSchema,
} from '@shared/schemas/nexus-workflow'
import {
  type DownloadTask,
  makeDownloadTask,
  TaskKind,
  TaskStatus,
  TaskType,
} from '@shared/types/task'
import { z } from 'zod'
import type { CredentialBroker } from '../cloud/credential-broker'
export interface WorkflowTask {
  createdAt?: number
  id: string
  name: string
  directory: string
  status: string
  progress: number
  bytes: number
  downloaded: number
  files: string[]
}
const stateSchema = z.object({
  queues: z.array(queueSchema),
  members: z.record(
    z.string(),
    z.object({
      queueId: z.string(),
      wanted: z.boolean(),
      attempts: z.number(),
      retryAt: z.number(),
      lastStatus: z.string(),
    })
  ),
  scheduleKeys: z.record(z.string(), z.string()),
})
export function scheduleWindow(
  queue: NexusQueue,
  now: Date
): { start: number; stop: number; key: string } | null {
  if (!queue.schedule.enabled) return null
  const minutes = (value: string) => {
    const [h, m] = value.split(':').map(Number)
    return h * 60 + m
  }
  const startMinutes = minutes(queue.schedule.start),
    stopMinutes = minutes(queue.schedule.stop)
  for (const back of [0, 1]) {
    const day = new Date(now)
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - back)
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    if (
      queue.schedule.date
        ? date !== queue.schedule.date
        : !queue.schedule.days.includes(day.getDay())
    )
      continue
    const start = new Date(day)
    start.setMinutes(startMinutes)
    const stop = new Date(day)
    stop.setMinutes(stopMinutes)
    if (stopMinutes <= startMinutes) stop.setDate(stop.getDate() + 1)
    if (now.getTime() >= start.getTime() && now.getTime() < stop.getTime())
      return { start: start.getTime(), stop: stop.getTime(), key: date }
  }
  return null
}
export function nextQueueStart(queue: NexusQueue, now: Date): number | null {
  if (!queue.schedule.enabled || !queue.schedule.wake) return null
  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(now)
    candidate.setDate(candidate.getDate() + offset)
    const [h, m] = queue.schedule.start.split(':').map(Number)
    candidate.setHours(h, m, 0, 0)
    const after = new Date(candidate.getTime() + 1)
    if (candidate.getTime() > now.getTime() && scheduleWindow(queue, after))
      return candidate.getTime()
  }
  return null
}
export class QueueManager {
  private state: z.infer<typeof stateSchema> = {
    queues: [queueSchema.parse({ id: 'main', name: '主队列', running: true })],
    members: {},
    scheduleKeys: {},
  }
  private controls?: {
    pause(id: string): Promise<void>
    resume(id: string): Promise<void>
    retry(id: string): Promise<void>
  }
  private controllers = new Map<string, CompletionShutdownController>()
  private countdowns: Record<string, CompletionShutdownState> = {}
  private busy = false
  private manualUntil = new Map<string, number>()
  private lastWake = 0
  constructor(
    private deps: {
      broker: CredentialBroker
      extra?(): Record<string, unknown>
      tasks(): WorkflowTask[]
      changed(): void
      canStart?(task: WorkflowTask): boolean
      ready(): boolean
      execute(queue: NexusQueue): Promise<void>
      save(): Promise<void>
      wake?(times: { id: string; at: number | null }[]): Promise<void>
      settled?(id: string): boolean
    }
  ) {}
  async load() {
    const data = this.deps.broker.get('queues')
    if (data) this.state = stateSchema.parse(JSON.parse(data))
    for (const q of this.state.queues) q.running = q.id === 'main'
    await this.wake()
  }
  setControls(controls: NonNullable<QueueManager['controls']>) {
    this.controls = controls
  }
  snapshot() {
    return {
      ...structuredClone(this.state),
      ...this.deps.extra?.(),
      countdowns: this.countdowns,
      wake: this.state.queues.map((q) => ({
        id: q.id,
        at: nextQueueStart(q, new Date()),
      })),
    }
  }
  private async persist() {
    await this.deps.broker.update('queues', () => JSON.stringify(this.state))
    this.deps.changed()
  }
  private async wake() {
    await this.deps.wake?.(
      this.state.queues.map((q) => ({
        id: q.id,
        at: nextQueueStart(q, new Date()),
      }))
    )
  }
  async action(raw: unknown) {
    const req = workflowActionSchema.parse(raw)
    if (req.action === 'queue-save') {
      const old = this.state.queues.find((q) => q.id === req.queue.id)
      if (old) Object.assign(old, req.queue, { running: old.running })
      else this.state.queues.push(req.queue)
      this.controllers.get(req.queue.id)?.cancel()
      await this.wake()
    } else if (req.action === 'queue-delete') {
      if (req.id === 'main') throw new Error('workflow.mainQueue')
      this.controllers.get(req.id)?.dispose()
      this.controllers.delete(req.id)
      this.state.queues = this.state.queues.filter((q) => q.id !== req.id)
      for (const m of Object.values(this.state.members))
        if (m.queueId === req.id) m.queueId = 'main'
      await this.wake()
    } else if (req.action === 'queue-run') {
      const queue = this.state.queues.find((q) => q.id === req.id)
      if (!queue) throw new Error('workflow.invalid')
      queue.running = req.running
      if (req.running) {
        const until = new Date()
        const [h, m] = queue.schedule.stop.split(':').map(Number)
        until.setHours(h, m, 0, 0)
        if (until.getTime() <= Date.now()) until.setDate(until.getDate() + 1)
        this.manualUntil.set(queue.id, until.getTime())
      } else this.manualUntil.delete(queue.id)
      if (req.running) await this.arm(queue)
      else this.controllers.get(req.id)?.cancel()
    } else if (req.action === 'assign') {
      if (!this.state.queues.some((q) => q.id === req.queueId))
        throw new Error('workflow.invalid')
      for (const id of req.taskIds) {
        if (!this.deps.tasks().some((t) => t.id === id))
          throw new Error('workflow.invalid')
        this.state.members[id] = {
          queueId: req.queueId,
          wanted: true,
          attempts: 0,
          retryAt: 0,
          lastStatus: '',
        }
      }
    } else this.controllers.get(req.id)?.cancel()
    await this.persist()
    await this.tick()
    return this.snapshot()
  }
  async intent(ids: string[], wanted: boolean) {
    for (const id of ids) {
      this.state.members[id] ??= {
        queueId: 'main',
        wanted,
        attempts: 0,
        retryAt: 0,
        lastStatus: '',
      }
      const member = this.state.members[id]
      if (member) {
        member.wanted = wanted
        if (wanted) {
          member.attempts = 0
          member.retryAt = 0
        }
      }
    }
    await this.persist()
  }
  private taskView(task: WorkflowTask): DownloadTask {
    return makeDownloadTask({
      id: task.id,
      name: task.name,
      type: TaskType.Http,
      kind: TaskKind.Direct,
      saveDir: task.directory,
      filename: task.name,
      finalName: task.name,
      finalPath: '',
      diskPath: '',
      source: 'user',
      sourceMeta: null,
      instances: [],
      createdAt: 0,
      updatedAt: 0,
      status:
        ['completed', 'seeding'].includes(task.status) &&
        this.deps.settled?.(task.id) !== false
          ? TaskStatus.Completed
          : task.status === 'error'
            ? TaskStatus.Error
            : TaskStatus.Downloading,
      progress: task.progress,
    })
  }
  private async arm(queue: NexusQueue) {
    if (queue.completion === 'none') return
    this.controllers.get(queue.id)?.dispose()
    const controller = new CompletionShutdownController({
      supported: true,
      getTasks: () =>
        this.deps
          .tasks()
          .filter((t) => this.state.members[t.id]?.queueId === queue.id)
          .map((t) => this.taskView(t)),
      isReady: () => this.deps.ready(),
      probe: async () => undefined,
      prepare: () => ({
        drain: async () => undefined,
        hasIncomingWork: () =>
          this.deps
            .tasks()
            .some(
              (t) =>
                [
                  'queued',
                  'downloading',
                  'finalizing',
                  'fetching_metadata',
                ].includes(t.status) ||
                (['completed', 'seeding'].includes(t.status) &&
                  this.deps.settled?.(t.id) === false)
            ),
        release: () => undefined,
      }),
      save: this.deps.save,
      requestShutdown: () => this.deps.execute(queue),
      onState: (state) => {
        this.countdowns[queue.id] = state
        this.deps.changed()
      },
      onError: () => undefined,
    })
    this.controllers.set(queue.id, controller)
    await controller.setEnabled(true)
  }
  async tick(now = new Date()) {
    if (this.busy || !this.controls || !this.deps.ready()) return
    this.busy = true
    let changed = false
    try {
      if (now.getTime() - this.lastWake > 60000) {
        this.lastWake = now.getTime()
        await this.wake()
      }
      const tasks = this.deps.tasks()
      for (const task of tasks)
        if (!this.state.members[task.id]) {
          this.state.members[task.id] = {
            queueId: 'main',
            wanted: !['paused', 'completed', 'error', 'removed'].includes(
              task.status
            ),
            attempts: 0,
            retryAt: 0,
            lastStatus: task.status,
          }
          changed = true
        }
      for (const q of this.state.queues) {
        const window = scheduleWindow(q, now)
        if (window && this.state.scheduleKeys[q.id] !== window.key) {
          q.running = true
          this.state.scheduleKeys[q.id] = window.key
          await this.arm(q)
          changed = true
        } else if (
          q.schedule.enabled &&
          !window &&
          q.running &&
          now.getTime() >= (this.manualUntil.get(q.id) ?? 0)
        ) {
          q.running = false
          this.controllers.get(q.id)?.cancel()
          changed = true
        }
        let active = 0
        for (const task of tasks.filter(
          (t) => this.state.members[t.id]?.queueId === q.id
        )) {
          const member = this.state.members[task.id]
          if (task.status === 'error' && member.lastStatus !== 'error') {
            member.retryAt = now.getTime() + 30000
            changed = true
          }
          member.lastStatus = task.status
          if (['completed', 'removed', 'seeding'].includes(task.status))
            continue
          if (!q.running || !member.wanted || active >= q.concurrency) {
            if (
              ['downloading', 'queued', 'fetching_metadata'].includes(
                task.status
              )
            )
              await this.controls.pause(task.id)
            continue
          }
          if (
            ['error', 'paused', 'queued'].includes(task.status) &&
            this.deps.canStart?.(task) === false
          )
            continue
          if (task.status === 'error') {
            if (member.attempts >= q.retries || now.getTime() < member.retryAt)
              continue
            member.attempts++
            await this.controls.retry(task.id)
            changed = true
            active++
            continue
          }
          if (['paused', 'queued'].includes(task.status))
            await this.controls.resume(task.id)
          active++
        }
        this.controllers.get(q.id)?.evaluate()
      }
      if (changed) await this.persist()
    } finally {
      this.busy = false
    }
  }
  dispose() {
    for (const c of this.controllers.values()) c.dispose()
  }
}
