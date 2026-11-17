import type { NexusDiagnostics } from '@core/nexus/diagnostics'
import { i18n } from '@main/lib/i18n'
import { dialog } from 'electron'
import writeFileAtomic from 'write-file-atomic'
export async function exportNexusDiagnostics(
  diagnostics: NexusDiagnostics
): Promise<boolean> {
  const result = await dialog.showSaveDialog({
    title: i18n.t('nexus.settings.exportDiagnostics'),
    defaultPath:
      'NexusDownload-diagnostics-' +
      new Date().toISOString().slice(0, 10) +
      '.json.gz',
    filters: [{ name: 'GZIP', extensions: ['gz'] }],
  })
  if (result.canceled || !result.filePath) return false
  await writeFileAtomic(result.filePath, await diagnostics.bundle())
  return true
}
