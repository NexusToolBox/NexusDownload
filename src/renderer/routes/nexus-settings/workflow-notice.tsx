import { Button, Item } from '@renderer/components/desktop-kit/nexus'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueues, workflowCall } from './queue-settings'
export function WorkflowNotice() {
  const state = useQueues()
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <div role="status" className="nexus-workflow-notice">
      {state?.diskBlocked?.map((dir) => (
        <p key={dir}>
          {t('nexus.v4.diskBlocked')} · {dir}
        </p>
      ))}
      {state?.queues
        .filter((q) => state.countdowns[q.id]?.phase === 'countdown')
        .map((q) => (
          <Item className="" key={q.id}>
            <strong>
              {q.name} · {t(`nexus.v4.completionAction.${q.completion}`)} ·{' '}
              {Math.max(
                0,
                Math.ceil(
                  ((state.countdowns[q.id].deadline ?? now) - now) / 1000
                )
              )}
              s
            </strong>
            <Button
              onClick={() =>
                void workflowCall({ action: 'cancel-completion', id: q.id })
              }
            >
              {t('common.cancel')}
            </Button>
          </Item>
        ))}
    </div>
  )
}
