// Derived from YunX Desktop 1.3.4, ShareResolveRepository.kt and ShareModels.kt.
// Copyright YunX contributors. SPDX-License-Identifier: AGPL-3.0-only
import type {
  CloudErrorKind,
  CloudFile,
  CloudMethod,
  CloudPlatform,
} from '@shared/schemas/nexus-cloud'

export class CloudError extends Error {
  constructor(readonly kind: CloudErrorKind) {
    super(`cloud.${kind}`)
  }
}
export interface CloudSession {
  input?: string
  shareId: string
  token: string
  title: string
  extra?: Record<string, string>
}
export interface AdapterFile extends CloudFile {
  token?: string
}
export interface CloudResource {
  mediaType?: 'hls'
  fileId: string
  version?: string
  hash?: string
  bytes: number | null
  kind: 'original-file' | 'playback-stream'
  url: string
  headers: Record<string, string>
  expiresAt?: number
  savedId?: string
  cleanupDir?: string
}
export interface CloudCapabilities {
  own: boolean
  withoutSave: boolean
  guest: boolean
  save: boolean
  playback: boolean
}
export interface CloudAdapter {
  fetchProfile?(): Promise<import('./account-profile').FetchedProfile>
  restoreTransfer?(savedId: string, directory: string): Promise<void>
  readonly platform: CloudPlatform
  readonly capabilities: CloudCapabilities
  checkLogin(): Promise<void>
  health?(): Promise<{
    member: boolean | null
    quota?: { total: number; used: number }
    platformUsedBytes?: number | null
    expiresAt?: number | null
  }>
  createSession(input: string): Promise<CloudSession>
  listFiles(directory: string, session?: CloudSession): Promise<AdapterFile[]>
  quota(): Promise<{ total: number; used: number }>
  ensureTempDir(name: string): Promise<string>
  transferFile(
    session: CloudSession,
    file: AdapterFile,
    directory: string
  ): Promise<string>
  getDownloadLink(
    file: AdapterFile,
    method: CloudMethod,
    session?: CloudSession,
    savedId?: string
  ): Promise<CloudResource>
  renew(
    file: AdapterFile,
    method: CloudMethod,
    session?: CloudSession,
    savedId?: string
  ): Promise<CloudResource>
  cleanupTempDir(directory: string): Promise<void>
}
export function verifyResource(
  file: AdapterFile,
  resource: CloudResource,
  previous?: CloudResource
): void {
  if (
    resource.kind === 'original-file' &&
    file.bytes !== null &&
    resource.bytes !== null &&
    file.bytes !== resource.bytes
  )
    throw new CloudError('size')
  if (!previous) return
  // An original file's timestamp does not identify a transcoded rendition.
  if (previous.kind === 'playback-stream') throw new CloudError('identity')
  if (
    resource.fileId !== previous.fileId ||
    resource.kind !== previous.kind ||
    resource.bytes !== previous.bytes
  )
    throw new CloudError('identity')
  if (previous.version && previous.version !== resource.version)
    throw new CloudError('identity')
  if (previous.hash && previous.hash !== resource.hash)
    throw new CloudError('identity')
  // Size/name alone never authorize stitching different bytes into an old file.
  if (!previous.version && !previous.hash) throw new CloudError('identity')
}
