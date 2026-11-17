import type {
  CloudAccount,
  CloudErrorKind,
  CloudPlatform,
} from '@shared/schemas/nexus-cloud'
import { CloudError } from './cloud-adapter'

export interface GovernorState {
  day: string
  requests: number
  links: number
  transfers: number
  reason?: CloudErrorKind
  recentRiskAt?: number
  profile?: 'conservative' | 'standard'
}
export class AccountGovernor {
  private states = new Map<string, GovernorState>()
  private queues = new Map<string, Promise<unknown>>()
  private lastRequest = new Map<string, number>()
  constructor(
    private options: {
      persist: (id: string, state: GovernorState) => Promise<void>
      pause: (id: string, reason: CloudErrorKind) => Promise<void>
      now?: () => number
      wait?: (ms: number) => Promise<void>
    }
  ) {}
  load(id: string, state: GovernorState) {
    this.states.set(id, { ...state })
  }
  private state(id: string) {
    const day = new Date(this.options.now?.() ?? Date.now()).toLocaleDateString(
      'en-CA',
      { timeZone: 'Asia/Shanghai' }
    )
    let state = this.states.get(id)
    if (!state || state.day !== day) {
      state = {
        day,
        requests: 0,
        links: 0,
        transfers: 0,
        reason: state?.reason,
        recentRiskAt: state?.recentRiskAt,
        profile: state?.profile,
      }
      this.states.set(id, state)
    }
    return state
  }
  snapshot(id: string, platform: CloudPlatform): CloudAccount {
    const state = this.state(id)
    return {
      id,
      platform,
      governor:
        state.profile ?? (platform === 'baidu' ? 'conservative' : 'standard'),
      state: state.reason ? 'paused' : 'ready',
      reason: state.reason,
      requests: state.requests,
      links: state.links,
      transfers: state.transfers,
      transferLimit:
        (state.profile ??
          (platform === 'baidu' ? 'conservative' : 'standard')) ===
        'conservative'
          ? 20
          : 100,
      concurrency: 1,
      recentRiskAt: state.recentRiskAt ?? null,
    }
  }
  async trip(id: string, kind: CloudErrorKind) {
    const state = this.state(id)
    state.reason = kind
    if (['captcha', 'risk', 'rate'].includes(kind))
      state.recentRiskAt = this.options.now?.() ?? Date.now()
    // Block admission synchronously; pause active tasks even if persistence fails.
    await Promise.all([
      this.options.persist(id, { ...state }),
      this.options.pause(id, kind),
    ])
  }
  async setProfile(id: string, profile: 'conservative' | 'standard') {
    const state = this.state(id)
    state.profile = profile
    await this.options.persist(id, { ...state })
  }
  async resume(id: string) {
    const state = { ...this.state(id) }
    delete state.reason
    await this.options.persist(id, { ...state })
    this.states.set(id, state)
  }
  async run<T>(
    id: string,
    platform: CloudPlatform,
    kind: 'request' | 'link' | 'transfer',
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve()
    const pending = previous
      .catch(() => undefined)
      .then(async () => {
        const state = this.state(id)
        if (state.reason) throw new CloudError(state.reason)
        if (
          kind === 'transfer' &&
          state.transfers >= this.snapshot(id, platform).transferLimit
        ) {
          throw new CloudError('rate')
        }
        const now = this.options.now?.() ?? Date.now()
        const delay = Math.max(
          0,
          (this.lastRequest.get(id) ?? 0) +
            (this.snapshot(id, platform).governor === 'conservative'
              ? 2000
              : 500) -
            now
        )
        if (delay)
          await (
            this.options.wait ??
            ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
          )(delay)
        if (this.state(id).reason)
          throw new CloudError(this.state(id).reason ?? 'risk')
        this.lastRequest.set(id, this.options.now?.() ?? Date.now())
        state.requests++
        if (kind === 'transfer') state.transfers++
        if (kind === 'link') state.links++
        // Count before sending; a failed/ambiguous transfer still consumes budget.
        await this.options.persist(id, { ...state })
        try {
          return await operation()
        } catch (error) {
          if (
            error instanceof CloudError &&
            ['captcha', 'risk', 'rate', 'login', 'login-elsewhere'].includes(
              error.kind
            )
          )
            await this.trip(id, error.kind)
          throw error
        }
      })
    this.queues.set(id, pending)
    try {
      return await pending
    } finally {
      if (this.queues.get(id) === pending) this.queues.delete(id)
    }
  }
}
