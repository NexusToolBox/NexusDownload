import '@renderer/styles/globals.css'
import '@renderer/lib/i18n'
import { Button, Input } from '@renderer/components/desktop-kit/nexus'
import type { ControlTask } from '@shared/schemas/nexus-control'
import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'

function PhonePage() {
  const { t, i18n } = useTranslation()
  const [token, setToken] = useState(
    () => localStorage.getItem('nexus-phone') || ''
  )
  const [code, setCode] = useState('')
  const [input, setInput] = useState('')
  const [tasks, setTasks] = useState<ControlTask[]>([])
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState('')
  const [busy, setBusy] = useState(false)
  const call = useCallback(
    async (url: string, body?: unknown) => {
      const res = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem('nexus-phone')
          setToken('')
        }
        throw new Error('control.failed')
      }
      return res.json()
    },
    [token]
  )
  useEffect(() => {
    void i18n.changeLanguage('zh-CN')
  }, [i18n])
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        if (token) {
          const list = await call('/tasks')
          if (alive) setTasks(list)
        } else if (pending) {
          const result = await call('/poll', { requestId: pending })
          if (!alive) return
          if (result.token) {
            localStorage.setItem('nexus-phone', result.token)
            setToken(result.token)
            setPending('')
            setCode('')
          } else if (['denied', 'expired'].includes(result.status)) {
            setPending('')
            setCode('')
            setNotice('control.pairing')
          }
        }
      } catch {
        if (alive) setNotice('control.failed')
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [token, pending, call])
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setNotice('')
    try {
      await fn()
    } catch {
      setNotice('control.failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">NexusDownload</h1>
      <h2>{t('nexus.control.phone')}</h2>
      {notice && <p role="status">{t(`nexus.${notice}`)}</p>}
      {!token ? (
        <section className="space-y-4">
          {code ? (
            <>
              <p>{t('nexus.control.enterOnComputer')}</p>
              <p className="text-3xl">{code}</p>
            </>
          ) : (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const pair = await call('/pair', {
                    name: t('nexus.control.phone'),
                  })
                  setCode(pair.userCode)
                  setPending(pair.requestId)
                })
              }
            >
              {t('nexus.control.pair')}
            </Button>
          )}
        </section>
      ) : (
        <>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                await call('/action', { action: 'collect', input })
                setInput('')
                setNotice('control.sent')
              })
            }}
          >
            <Input
              aria-label={t('nexus.control.input')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={32768}
            />
            <Button type="submit" disabled={busy || !input.trim()}>
              {t('nexus.control.send')}
            </Button>
          </form>
          <p>{t('nexus.control.confirmOnComputer')}</p>
          {tasks.map((task) => (
            <div key={task.id} className="space-y-2 rounded-xl border p-4">
              <p>
                {task.id.slice(0, 8)} ·{' '}
                {t(`nexus.status.${task.status}`, {
                  defaultValue: task.status,
                })}
              </p>
              <progress
                aria-label={t('nexus.control.progress')}
                value={task.completed}
                max={task.bytes || 1}
                className="w-full"
              />
              <p>
                {task.bytes
                  ? Math.min(
                      100,
                      Math.round((task.completed / task.bytes) * 100)
                    )
                  : 0}
                %
              </p>
              {!['completed', 'removed'].includes(task.status) && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await call('/action', {
                        action: task.status === 'paused' ? 'resume' : 'pause',
                        id: task.id,
                      })
                    })
                  }
                >
                  {t(task.status === 'paused' ? 'nexus.resume' : 'nexus.pause')}
                </Button>
              )}
            </div>
          ))}
        </>
      )}
    </main>
  )
}
const root = document.getElementById('root')
if (root) createRoot(root).render(<PhonePage />)
