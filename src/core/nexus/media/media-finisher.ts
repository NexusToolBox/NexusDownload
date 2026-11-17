import { spawn } from 'node:child_process'
import { mkdtemp, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { FfmpegService, muxerForOutputName } from '@core/ffmpeg/ffmpeg-service'
import type { ProcessingRecord } from '@shared/schemas/nexus-processing'
import type { CredentialBroker } from '../cloud/credential-broker'
import type { ToolManager } from '../tools/tool-manager'
import type { WorkflowTask } from '../workflow/queue-manager'
import { writeLivePhoto } from './live-photo-writer'
import { writeMotionPhoto } from './motion-photo-writer'
import { renderUgoira, type UgoiraFrame } from './ugoira'
export interface MediaFinishJob {
  ugoira?: UgoiraFrame[]
  taskId: string
  motionId?: string
  container?: 'mp4' | 'mkv'
}
export class MediaFinisher {
  constructor(
    private deps: {
      broker: CredentialBroker
      tools: ToolManager
      tasks(): WorkflowTask[]
    }
  ) {}
  async register(job: MediaFinishJob) {
    await this.deps.broker.update('media-finishing', (current) =>
      JSON.stringify([
        ...(JSON.parse(current || '[]') as MediaFinishJob[]),
        job,
      ])
    )
  }
  async prepare(record: ProcessingRecord) {
    const jobs = (
      JSON.parse(
        this.deps.broker.get('media-finishing') || '[]'
      ) as MediaFinishJob[]
    ).filter((j) => record.taskIds.includes(j.taskId))
    if (!jobs.length) return
    const files = [...record.files]
    await this.deps.tools.using(['ffmpeg'], async () => {
      const binary = await this.deps.tools.executable('ffmpeg')
      for (const job of jobs) {
        const source = this.deps.tasks().find((t) => t.id === job.taskId)
          ?.files[0]
        const motion = this.deps.tasks().find((t) => t.id === job.motionId)
          ?.files[0]
        if (!source || (job.motionId && !motion))
          throw new Error('processing.mediaFailed')
        const stage = await mkdtemp(
          path.join(record.directory, '.nexus-media-')
        )
        try {
          const output = path.join(
            stage,
            job.motionId ? 'motion-photo.jpg' : `remux.${job.container}`
          )
          const additional: string[] = []
          if (job.ugoira) {
            await renderUgoira(binary, source, job.ugoira, stage, output)
          } else if (motion) {
            // Normalize EXIF orientation before replacing private camera metadata.
            const still = path.join(stage, 'still.jpg')
            await new Promise<void>((resolve, reject) => {
              const child = spawn(
                binary,
                [
                  '-nostdin',
                  '-i',
                  source,
                  '-frames:v',
                  '1',
                  '-q:v',
                  '2',
                  '-y',
                  still,
                ],
                { windowsHide: true, stdio: 'ignore' }
              )
              child.once('error', () =>
                reject(new Error('processing.mediaFailed'))
              )
              child.once('close', (code) =>
                code === 0
                  ? resolve()
                  : reject(new Error('processing.mediaFailed'))
              )
            })
            const mp4 = path.join(stage, 'motion.mp4')
            await new FfmpegService().run(
              {
                binaryPath: binary,
                videoPath: motion,
                output: mp4,
                fromMpegts: false,
                format: 'mp4',
              },
              () => undefined,
              (cmd, args) => spawn(cmd, args, { windowsHide: true })
            )
            await writeMotionPhoto(still, mp4, output)
            await writeLivePhoto(
              still,
              mp4,
              path.join(stage, 'live-photo.jpg'),
              path.join(stage, 'live-photo.mov')
            )
            additional.push('live-photo.jpg', 'live-photo.mov')
            if (still !== source) await rm(still, { force: true })
            await rm(mp4, { force: true })
          } else
            await new FfmpegService().run(
              {
                binaryPath: binary,
                videoPath: source,
                output,
                fromMpegts: false,
                format: muxerForOutputName(output),
              },
              () => undefined,
              (cmd, args) => spawn(cmd, args, { windowsHide: true })
            )
          const target = `${stage}-complete`
          await rename(stage, target)
          files.push(path.join(target, path.basename(output)))
          files.push(...additional.map((name) => path.join(target, name)))
        } finally {
          await rm(stage, { recursive: true, force: true })
        }
      }
    })
    record.outputs = files
  }
}
