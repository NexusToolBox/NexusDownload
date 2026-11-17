import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { PortableInstallRequest } from '@core/nexus/update/portable-update-service'
import { z } from 'zod'
import type { PortableProfile } from '../platform/portable-profile'
import type { ProcessGuardian } from './process-guardian'

export function updateDirectory(profile: PortableProfile) {
  return path.join(profile.dataDir, 'updates')
}
export function isPortableUpdateDirectory(
  profile: PortableProfile | null,
  directory: string
) {
  if (!profile || !directory) return false
  const normalize = (value: string) => {
    const resolved = path.resolve(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  const actual = normalize(directory)
  if (actual === normalize(updateDirectory(profile))) return true
  if (process.platform === 'win32') {
    try {
      // Resolve only our local data directory; ordinary task paths may be remote.
      return (
        actual ===
        normalize(path.join(realpathSync.native(profile.dataDir), 'updates'))
      )
    } catch {}
  }
  return false
}
export async function preparePortableUpdate(options: {
  profile: PortableProfile
  request: PortableInstallRequest
  source: string
  executable: string
  guardian?: ProcessGuardian
  releaseNotes?: string
}) {
  if (!options.guardian) throw new Error('update.install')
  const probe = path.join(options.profile.root, `.update-probe-${randomUUID()}`)
  try {
    await writeFile(probe, '', { flag: 'wx' })
    await rm(probe)
  } catch {
    throw new Error('update.permission')
  }
  const directory = updateDirectory(options.profile)
  await mkdir(directory, { recursive: true })
  const helper = path.join(
    await mkdtemp(path.join(tmpdir(), 'nexus-updater-')),
    'updater.ps1'
  )
  await copyFile(options.source, helper)
  const request = path.join(directory, 'request.json')
  await writeFile(
    request,
    JSON.stringify({
      ...options.request,
      root: options.profile.root,
      exe: options.executable,
      parentPid: process.pid,
      token: randomUUID(),
      releaseNotes: options.releaseNotes ?? '',
    })
  )
  return () => options.guardian?.scheduleUpdate(helper, request)
}
const transactionSchema = z.object({
  phase: z.enum([
    'backing-up',
    'replacing',
    'booting',
    'completed',
    'restored',
    'rolling-back',
  ]),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  previousVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  token: z.string().uuid(),
  releaseNotes: z.string().optional(),
})
export async function inspectPortableUpdate(profile: PortableProfile) {
  const directory = updateDirectory(profile)
  try {
    const state = transactionSchema.parse(
      JSON.parse(
        await readFile(path.join(directory, 'transaction.json'), 'utf8')
      )
    )
    // Older PowerShell helpers decoded non-ASCII release notes using ANSI.
    // The original request remains UTF-8 and belongs to this exact transaction.
    try {
      const request = JSON.parse(
        await readFile(path.join(directory, 'request.json'), 'utf8')
      )
      if (
        request.token === state.token &&
        request.version === state.version &&
        typeof request.releaseNotes === 'string'
      )
        state.releaseNotes = request.releaseNotes
    } catch {}
    return state
  } catch {
    return undefined
  }
}
/** A usable consent window also completes boot; the update notice waits for the main shell. */
export async function acknowledgePortableUpdateBoot(
  profile: PortableProfile,
  version: string
) {
  const state = await inspectPortableUpdate(profile)
  if (state?.phase === 'booting' && state.version === version)
    await writeFile(
      path.join(updateDirectory(profile), 'boot-ok.json'),
      JSON.stringify({ token: state.token, version })
    )
  return state
}
/** Called only after shell initialization, engine restoration and renderer readiness. */
export async function acknowledgePortableUpdate(
  profile: PortableProfile,
  version: string
) {
  const state = await acknowledgePortableUpdateBoot(profile, version)
  if (state && ['booting', 'completed', 'restored'].includes(state.phase)) {
    const receipt = `${state.token}:${state.phase === 'restored' ? 'restored' : 'completed'}`
    const notice = path.join(updateDirectory(profile), 'notice-seen.json')
    if ((await readFile(notice, 'utf8').catch(() => '')) === receipt)
      return undefined
    await writeFile(notice, receipt)
  }
  return state
}
export async function scheduleInterruptedRecovery(
  profile: PortableProfile,
  source: string,
  guardian: ProcessGuardian,
  currentVersion?: string
) {
  const state = await inspectPortableUpdate(profile)
  if (
    !state ||
    !(
      ['backing-up', 'replacing', 'rolling-back'].includes(state.phase) ||
      (state.phase === 'booting' && state.version !== currentVersion)
    )
  )
    return false
  const helper = path.join(
    await mkdtemp(path.join(tmpdir(), 'nexus-recovery-')),
    'updater.ps1'
  )
  await copyFile(source, helper)
  const request = path.join(updateDirectory(profile), 'request.json')
  const job = JSON.parse(await readFile(request, 'utf8'))
  job.parentPid = process.pid
  await writeFile(request, JSON.stringify(job))
  guardian.scheduleUpdate(helper, request, 'Recover')
  return true
}
