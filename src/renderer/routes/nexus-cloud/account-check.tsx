import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Item,
} from '@renderer/components/desktop-kit/nexus'
import { Commands } from '@shared/protocol/commands'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { cloudCall, cloudError } from './cloud-client'

export function AccountCheck({
  accountId,
  compact = false,
}: {
  accountId?: string
  compact?: boolean
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<
    | {
        platform: string
        account: number
        steps: { step: string; status: string }[]
      }[]
    | null
  >(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [shareInput, setShareInput] = useState('')
  return (
    <>
      {accountId && !compact && (
        <Item
          title={
            <label htmlFor={`check-share-${accountId}`}>
              {t('nexus.cloudV3.checkShare')}
            </label>
          }
        >
          <Input
            id={`check-share-${accountId}`}
            value={shareInput}
            maxLength={8192}
            disabled={busy}
            placeholder={t('nexus.cloudV3.checkShareHelp')}
            onChange={(e) => setShareInput(e.target.value)}
          />
        </Item>
      )}
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          setError('')
          setCopied(false)
          void cloudCall(
            Commands.NexusCloudSelfCheck,
            shareInput.trim() && accountId
              ? { accountId, shareInput: shareInput.trim() }
              : accountId
          )
            .then((value) =>
              setReport(
                z
                  .object({
                    reports: z.array(
                      z.object({
                        platform: z.string(),
                        account: z.number(),
                        steps: z.array(
                          z.object({ step: z.string(), status: z.string() })
                        ),
                      })
                    ),
                  })
                  .parse(value).reports
              )
            )
            .catch((e) => setError(cloudError(e)))
            .finally(() => {
              setBusy(false)
              setShareInput('')
            })
        }}
      >
        {t(
          busy
            ? 'nexus.cloudV2.checking'
            : accountId
              ? 'nexus.v11.detect'
              : 'nexus.v11.detectAll'
        )}
      </Button>
      {error && <p role="alert">{t(`nexus.cloudError.${error}`)}</p>}
      <Dialog
        open={!!report}
        onOpenChange={(open) => {
          if (!open) setReport(null)
        }}
      >
        <DialogContent className="nexus-cloud-report">
          <DialogTitle>{t('nexus.cloudV2.reportTitle')}</DialogTitle>
          <div className="nx-check-results">
            {report?.map((row) => (
              <section key={`${row.platform}-${row.account}`}>
                <h3>
                  {t(`nexus.platform.${row.platform}`)} · {row.account}
                </h3>
                <div>
                  {(['login', 'list', 'link', 'range'] as const).map(
                    (step, i) => {
                      const result = row.steps.find(
                        (value) => value.step === step
                      )?.status
                      const label = t(
                        `nexus.v14.${['checkLogin', 'checkBrowse', 'checkDownload', 'checkResume'][i]}`
                      )
                      return (
                        <span key={step}>
                          {label}{' '}
                          <b
                            role="img"
                            aria-label={
                              result === 'pass'
                                ? label
                                : t(
                                    result === 'fail'
                                      ? 'nexus.v14.checkFailed'
                                      : 'nexus.v14.checkSkipped'
                                  )
                            }
                          >
                            {result === 'pass'
                              ? '✓'
                              : result === 'fail'
                                ? '✕'
                                : '—'}
                          </b>
                        </span>
                      )
                    }
                  )}
                </div>
              </section>
            ))}
          </div>
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  (report ?? [])
                    .map(
                      (row) =>
                        `${t(`nexus.platform.${row.platform}`)} ${row.account}: ${['login', 'list', 'link', 'range'].map((step, i) => `${t(`nexus.v14.${['checkLogin', 'checkBrowse', 'checkDownload', 'checkResume'][i]}`)} ${row.steps.find((value) => value.step === step)?.status === 'pass' ? '✓' : '—'}`).join(' ')}`
                    )
                    .join('\n')
                )
                .then(() => setCopied(true))
                .catch(() => setError('permission'))
            }}
          >
            {t(copied ? 'nexus.cloudV2.copied' : 'nexus.cloudV2.copyReport')}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
