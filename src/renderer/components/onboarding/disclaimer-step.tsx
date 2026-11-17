import { Button } from '@renderer/components/desktop-kit/nexus'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function DisclaimerStep() {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const agree = async () => {
    setFailed(false)
    setBusy(true)
    try {
      await transport.invoke(Commands.AcceptDisclaimer)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-8">
      <section
        className="w-full max-w-[560px] space-y-6"
        data-testid="disclaimer-panel"
        aria-labelledby="disclaimer-title"
      >
        <div className="flex items-center gap-4">
          <img
            src={`${import.meta.env.BASE_URL}app-icon.png`}
            className="size-12"
            alt=""
          />
          <h1 id="disclaimer-title" className="text-2xl font-semibold">
            {t('nexus.v15.notice.title')}
          </h1>
        </div>
        <ol className="list-decimal space-y-4 ps-5 text-[13.5px] leading-6">
          {[1, 2, 3, 4].map((item) => (
            <li key={item}>{t(`nexus.v15.notice.item${item}`)}</li>
          ))}
          <li>
            {t('nexus.v15.notice.feedbackPrefix')}
            <button
              type="button"
              className="underline underline-offset-4 rounded focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() =>
                void transport.invoke(Commands.OpenDisclaimerIssues)
              }
            >
              GitHub Issues
            </button>
            {t('nexus.v15.notice.feedbackSuffix')}
          </li>
        </ol>
        {failed && (
          <p role="alert" data-testid="disclaimer-error">
            {t('onboarding.disclaimer.saveFailed')}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            variant="quiet"
            disabled={busy}
            data-testid="disclaimer-quit"
            onClick={() => void transport.invoke(Commands.DeclineDisclaimer)}
          >
            {t('nexus.v15.notice.quit')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            data-testid="disclaimer-agree"
            onClick={() => void agree()}
          >
            {t('nexus.v15.notice.agree')}
          </Button>
        </div>
      </section>
    </main>
  )
}
