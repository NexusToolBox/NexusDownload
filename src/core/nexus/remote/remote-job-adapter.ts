import type { RemoteFile, RemoteJob } from '@shared/schemas/nexus-remote'

export interface RemoteStatus {
  ready: boolean
  progress: number
  usage?: string
}
/** URLs and authorization stay inside adapters; snapshots contain file metadata only. */
export interface RemoteJobAdapter {
  submit(job: RemoteJob): Promise<string>
  query(job: RemoteJob): Promise<RemoteStatus>
  recover(job: RemoteJob): Promise<string | null>
  listFiles(job: RemoteJob): Promise<RemoteFile[]>
  retrieve(
    job: RemoteJob,
    file: RemoteFile,
    checkpoint: () => Promise<void>
  ): Promise<void>
  cleanup(job: RemoteJob): Promise<void>
}
