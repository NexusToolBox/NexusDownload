import { TransferDownIcon, TransferUpIcon } from '@renderer/components/icons'
import { useEngineDisplayStatus } from '@renderer/hooks/use-engine-display-status'
import { useGlobalStats } from '@renderer/hooks/use-global-stats'
import { formatBytes } from '@shared/utils/format-bytes'
import { useTranslation } from 'react-i18next'

export function NexusTransferSpeed() {
  const { t } = useTranslation()
  const { stats: snapshot } = useGlobalStats()
  const { state } = useEngineDisplayStatus()
  const stats = state === 'ready' ? snapshot : null
  return (
    <span
      className="spill nexus-transfer"
      role="status"
      aria-label={t('nexus.transferSpeed')}
    >
      <span className={(stats?.totalDownloadSpeed ?? 0) > 0 ? 'live' : ''}>
        <TransferDownIcon />
        {formatBytes(stats?.totalDownloadSpeed ?? 0)}/s
      </span>
      <span>
        <TransferUpIcon />
        {formatBytes(stats?.totalUploadSpeed ?? 0)}/s
      </span>
    </span>
  )
}
