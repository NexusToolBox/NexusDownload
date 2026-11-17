import { Button } from '@renderer/components/desktop-kit/nexus'
import { WarningIcon } from '@renderer/components/icons'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import type { NexusDuplicate } from '@shared/schemas/nexus-duplicate'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

export function DuplicateNotice({
  duplicates,
  total,
  skip,
  onSkip,
  onDownload,
  onClose,
  busy = false,
}: {
  duplicates: (Omit<NexusDuplicate, 'taskId'> & { taskId?: string })[]
  total: number
  skip: boolean
  onSkip(value: boolean): void
  onDownload(): void
  onClose(): void
  busy?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)
  if (!duplicates.length) return null
  const single = total === 1 ? duplicates[0] : undefined
  return (
    <div className="nx-duplicate" data-testid="duplicate-warning">
      <p role="status">
        <WarningIcon />
        {t(
          single
            ? single.status === 'active'
              ? 'nexus.v151.duplicate.active'
              : 'nexus.v151.duplicate.completed'
            : 'nexus.v151.duplicate.batch',
          { count: duplicates.length }
        )}
      </p>
      {single ? (
        <div className="flex gap-2 justify-end">
          {single.status === 'active' && single.taskId ? (
            <Button
              disabled={busy}
              onClick={() => {
                onClose()
                void navigate(
                  `/downloads/all?task=${encodeURIComponent(single.taskId ?? '')}`
                )
              }}
            >
              {t('nexus.v151.duplicate.view')}
            </Button>
          ) : (
            <>
              {single.taskId && (
                <Button
                  disabled={busy}
                  variant="quiet"
                  onClick={() => {
                    void transport
                      .invoke(Commands.OpenTaskFile, { taskId: single.taskId })
                      .catch(() => setFailed(true))
                  }}
                >
                  {t('nexus.v151.duplicate.open')}
                </Button>
              )}
              <Button disabled={busy} variant="primary" onClick={onDownload}>
                {t('nexus.v151.duplicate.again')}
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="flex gap-2 justify-end">
          <Button
            disabled={busy}
            aria-pressed={skip}
            variant={skip ? 'secondary' : 'quiet'}
            onClick={() => onSkip(true)}
          >
            {t('nexus.v151.duplicate.skip')}
          </Button>
          <Button
            disabled={busy}
            aria-pressed={!skip}
            variant={!skip ? 'secondary' : 'quiet'}
            onClick={() => onSkip(false)}
          >
            {t('nexus.v151.duplicate.all')}
          </Button>
        </div>
      )}
      {failed && <p role="alert">{t('nexus.actionFailed')}</p>}
    </div>
  )
}
