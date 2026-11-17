import {
  Button,
  Group,
  Input,
  Item,
} from '@renderer/components/desktop-kit/nexus'
import { MediaIcon } from '@renderer/components/icons'
import { transport } from '@renderer/lib/transport'
import { usePlatformServices } from '@renderer/platform/services'
import { Commands } from '@shared/protocol/commands'
import { Queries } from '@shared/protocol/queries'
import {
  type MediaResult,
  mediaResultSchema,
} from '@shared/schemas/nexus-media'
import { toolIdSchema } from '@shared/schemas/nexus-tools'
import { formatBytes } from '@shared/utils/format-bytes'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNexusWorkspace } from '../nexus-downloads/use-workspace'
import { changeToolBundle, toolBundle } from '../nexus-settings/tool-bundles'
import { ExternalJobs } from './external-jobs'

export async function mediaCall(request: unknown): Promise<unknown> {
  const raw = (await transport.invoke(Commands.NexusMediaAction, request)) as {
    ok: boolean
    value?: unknown
    error?: string
  }
  if (!raw.ok) throw new Error(raw.error || 'media.failed')
  return raw.value
}
export function NexusMediaPage() {
  const { t } = useTranslation()
  const services = usePlatformServices()
  const [input, setInput] = useState('')
  const workspace = useNexusWorkspace()
  const [needsLogin, setNeedsLogin] = useState(false)
  const [result, setResult] = useState<MediaResult | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [format, setFormat] = useState('mp4'),
    [subtitle, setSubtitle] = useState('')
  const [directory, setDirectory] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const [missingTool, setMissingTool] = useState('')
  const quality = workspace?.preferences.mediaQuality ?? 120
  const livePhoto = workspace?.preferences.livePhoto ?? true
  const [recent, setRecent] = useState<MediaResult[]>([])
  useEffect(() => {
    void transport
      .invoke(Queries.GetSettings)
      .then((raw) => {
        const value = raw as { app?: { defaultSaveDir?: string } }
        if (value.app?.defaultSaveDir) setDirectory(value.app.defaultSaveDir)
      })
      .catch(() => undefined)
    void transport
      .invoke(Queries.GetNexusMedia)
      .then((raw) => setRecent((raw as { recent: MediaResult[] }).recent))
      .catch(() => undefined)
  }, [])
  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    setMissingTool('')
    try {
      await operation()
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('tools.'))
        setMissingTool(error.message.slice(6))
      if (error instanceof Error && error.message === 'media.login')
        setNeedsLogin(true)
      setMessage(
        t(`nexus.v4.${error instanceof Error ? error.message : 'media.failed'}`)
      )
    } finally {
      setBusy(false)
    }
  }
  const parseResult = async () => {
    const value = mediaResultSchema.parse(
      await mediaCall({
        action: 'parse',
        url: input.trim(),
        quality,
      })
    )
    setResult(value)
    setNeedsLogin(value.notice === 'media.loginForQuality')
    setRecent((v) => [value, ...v].slice(0, 20))
    const entries = new Set<string>()
    setSelected(
      value.choices
        .filter(
          (c) =>
            c.kind === 'image' ||
            (!entries.has(c.entry) && entries.add(c.entry))
        )
        .map((c) => c.id)
    )
  }
  const parse = () => void run(parseResult)
  const loginButton = (
    <Button
      disabled={busy}
      onClick={() =>
        void run(async () => {
          await mediaCall({
            action: 'login',
            platform: result?.platform ?? 'external',
            url: input.trim(),
          })
          setNeedsLogin(false)
          await parseResult()
        })
      }
    >
      {t(
        result?.platform === 'bilibili' || /bilibili\.com|b23\.tv/.test(input)
          ? 'nexus.v11.loginBilibili'
          : 'nexus.v11.loginMedia'
      )}
    </Button>
  )
  return (
    <div className="page on">
      <header className="phead">
        <h1>{t('nexus.nav.media')}</h1>
      </header>
      <div className="media">
        <ExternalJobs />
        <form
          className="addbar nexus-media-input"
          onSubmit={(e) => {
            e.preventDefault()
            parse()
          }}
        >
          <Input
            aria-label={t('nexus.media.placeholder')}
            placeholder={t('nexus.media.placeholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={8192}
          />
          <Button
            variant="primary"
            type="submit"
            disabled={busy || !input.trim()}
          >
            {t(busy ? 'common.loading' : 'nexus.media.parse')}
          </Button>
        </form>
        {toolIdSchema.safeParse(missingTool).success && (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await changeToolBundle(toolBundle(missingTool), 'install')
                await parseResult()
              })
            }
          >
            {t('nexus.v4.install')}
          </Button>
        )}
        {message && (
          <p role="status" className="nexus-v4-message">
            {message}
          </p>
        )}
        {needsLogin && !result && (
          <div className="mcard nexus-v4-card nexus-media-login-card">
            {loginButton}
          </div>
        )}
        {result ? (
          <div className="mcard nexus-v4-card nexus-media-result">
            <h2>{result.title}</h2>
            {needsLogin && loginButton}
            {result.notice && result.notice !== 'media.loginForQuality' && (
              <p>{t(`nexus.v4.${result.notice}`)}</p>
            )}
            <fieldset>
              <legend>
                {t(
                  result.choices.some((choice) => choice.kind === 'video')
                    ? 'nexus.v11.chooseQuality'
                    : 'nexus.v4.selection'
                )}
              </legend>
              <div className="nexus-v4-controls">
                {result.choices.map((choice) => (
                  <Button
                    key={choice.id}
                    variant="quiet"
                    aria-pressed={selected.includes(choice.id)}
                    className={`chip nexus-media-choice ${selected.includes(choice.id) ? 'selected' : ''}`}
                    onClick={() =>
                      setSelected((v) =>
                        v.includes(choice.id)
                          ? v.filter((id) => id !== choice.id)
                          : [
                              ...v.filter(
                                (id) =>
                                  choice.kind === 'image' ||
                                  result.choices.find((c) => c.id === id)
                                    ?.entry !== choice.entry
                              ),
                              choice.id,
                            ]
                      )
                    }
                  >
                    {choice.label || choice.format}
                    {choice.motion ? ` · ${t('nexus.v11.livePhoto')}` : ''}
                  </Button>
                ))}
              </div>
            </fieldset>
            {result.choices.some((choice) => choice.kind === 'video') && (
              <fieldset>
                <legend>{t('nexus.v4.format')}</legend>
                <div className="nexus-v4-controls">
                  {['mp4', 'mkv'].map((value) => (
                    <Button
                      key={value}
                      variant={format === value ? 'secondary' : 'quiet'}
                      aria-pressed={format === value}
                      onClick={() => setFormat(value)}
                    >
                      {value.toUpperCase()}
                    </Button>
                  ))}
                </div>
              </fieldset>
            )}
            {!!result.subtitles.length && (
              <fieldset>
                <legend>{t('nexus.v4.subtitle')}</legend>
                <div className="nexus-v4-controls">
                  {['', ...result.subtitles].map((value) => (
                    <Button
                      key={value}
                      variant={subtitle === value ? 'secondary' : 'quiet'}
                      aria-pressed={subtitle === value}
                      onClick={() => setSubtitle(value)}
                    >
                      {value || t('nexus.v4.none')}
                    </Button>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="nexus-v4-controls">
              <Group className="nx-media-directory">
                <Item title={t('nexus.v4.directory')} description={directory}>
                  <Button
                    variant="quiet"
                    onClick={() =>
                      void run(async () => {
                        const picked = await services.pickSaveDir(directory, {
                          allowFavoriteEditing: false,
                        })
                        if (picked) setDirectory(picked)
                      })
                    }
                  >
                    {t('nexus.settings.change')}
                  </Button>
                </Item>
              </Group>
              <Button
                variant="primary"
                disabled={busy || !directory || !selected.length}
                onClick={() =>
                  void run(async () => {
                    await mediaCall({
                      action: 'download',
                      livePhoto,
                      id: result.id,
                      choices: selected,
                      directory,
                      format,
                      subtitle: subtitle || undefined,
                    })
                    setMessage(t('nexus.v4.added'))
                  })
                }
              >
                {selected.length &&
                result.choices
                  .filter((choice) => selected.includes(choice.id))
                  .every((choice) => choice.bytes !== null)
                  ? t('nexus.v11.downloadSize', {
                      size: formatBytes(
                        result.choices
                          .filter((choice) => selected.includes(choice.id))
                          .reduce((sum, choice) => sum + (choice.bytes ?? 0), 0)
                      ),
                    })
                  : t('nexus.v4.download', { count: selected.length })}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mcard nexus-media-empty">
            <div className="empty">
              <MediaIcon className="glyph" />
              <h2>{t('nexus.media.emptyTitle')}</h2>
            </div>
          </div>
        )}
        <div className="group-label nexus-recent-label">
          {t('nexus.media.recent')}
        </div>
        {!recent.length && (
          <p className="nexus-recent-empty">{t('nexus.v11.noRecentMedia')}</p>
        )}
        {recent.map((item) => (
          <div className="nexus-recent-item" key={item.id}>
            <MediaIcon />
            <span title={item.title}>{item.title}</span>
            <small>
              {t(`nexus.platform.${item.platform}`, {
                defaultValue: item.platform,
              })}
            </small>
          </div>
        ))}
      </div>
    </div>
  )
}
