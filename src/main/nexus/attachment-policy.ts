import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
let cached: { until: number; value: 'preserve' | 'skip' } | undefined
/** Attachment Manager: SaveZoneInformation=1 means do not preserve zone information. */
export async function attachmentZonePolicy(): Promise<'preserve' | 'skip'> {
  if (cached && cached.until > Date.now()) return cached.value
  const results = await Promise.all(
    ['HKCU', 'HKLM'].map(async (hive) => {
      try {
        const { stdout } = await run(
          'reg.exe',
          [
            'query',
            hive +
              '\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Attachments',
            '/v',
            'SaveZoneInformation',
          ],
          { windowsHide: true, timeout: 5000 }
        )
        return /SaveZoneInformation\s+REG_DWORD\s+0x1\b/i.test(stdout)
      } catch {
        return false
      }
    })
  )
  const value = results.some(Boolean) ? 'skip' : 'preserve'
  cached = { until: Date.now() + 30_000, value }
  return value
}
