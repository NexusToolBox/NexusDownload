import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@renderer/components/desktop-kit/nexus'
import { PlatformLogo } from '@renderer/components/desktop-kit/nexus/platform-logo'
import {
  CheckIcon,
  CloseIcon,
  CopyLinkIcon,
  FolderIcon,
  WarningIcon,
} from '@renderer/components/icons'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { toast } from '@renderer/components/ui/toast'
import { transport } from '@renderer/lib/transport'
import { usePlatformServices } from '@renderer/platform/services'
import { Commands } from '@shared/protocol/commands'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import {
  type CloudBrowse,
  type CloudMethod,
  type CloudPreflight,
  cloudBrowseSchema,
  cloudPreflightSchema,
} from '@shared/schemas/nexus-cloud'
import {
  type NexusPreflight,
  nexusPreflightSchema,
} from '@shared/schemas/nexus-workspace'
import { formatBytes } from '@shared/utils/format-bytes'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { cloudCall, cloudError, useCloud } from '../nexus-cloud/cloud-client'
import { CloudLoginButton } from '../nexus-cloud/cloud-login-button'
import { OfflineDownload } from '../nexus-services/offline-download'
import { NEXUS_ADD_EVENT } from './nexus-events'
import { useNexusWorkspace } from './use-workspace'

export function NexusAddHost() {
  const { t } = useTranslation()
  const workspace = useNexusWorkspace()
  const services = usePlatformServices()
  const cloudState = useCloud()
  const navigate = useNavigate()
  const location = useLocation()

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [preflight, setPreflight] = useState<NexusPreflight | null>(null)
  const [busy, setBusy] = useState(false)
  const [directory, setDirectory] = useState<string>()
  const [feedback, setFeedback] = useState('')
  const [offlineSource, setOfflineSource] = useState('')
  const [cloudData, setCloudData] = useState<CloudBrowse | null>(null)
  const [cloudCheck, setCloudCheck] = useState<CloudPreflight | null>(null)
  const [cloudMethod, setCloudMethod] = useState<CloudMethod>('guest')
  const revision = useRef(0)
  const [recognizing, setRecognizing] = useState(false)
  const [consent, setConsent] = useState(false)
  const inputRevision = useRef(0)
  const [retry, setRetry] = useState(0)
  const [loginRequired, setLoginRequired] =
    useState<import('@shared/schemas/nexus-cloud').CloudPlatform>()
  useEffect(() => {
    let alive = true
    setOfflineSource('')
    const entry = preflight?.items.find((item) =>
      ['http', 'magnet'].includes(item.source.platform)
    )
    if (entry)
      void transport
        .invoke(Commands.NexusReadCloudInput, entry.id)
        .then((value) => {
          if (alive && typeof value === 'string') setOfflineSource(value)
        })
        .catch(() => {})
    return () => {
      alive = false
    }
  }, [preflight])
  const show = useCallback(
    (value?: string) => {
      setInput(value ?? '')
      setConsent(false)
      setPreflight(null)
      setCloudData(null)
      setCloudCheck(null)
      setDirectory(undefined)
      setFeedback('')
      setLoginRequired(undefined)
      setOpen(true)
      const request = ++inputRevision.current
      if (!value)
        void services
          .readClipboard()
          .then((text) => {
            if (
              request === inputRevision.current &&
              /(?:https?|ftp):\/\/|magnet:\?|[\u4e00-\u9fff]/i.test(text)
            )
              setInput(text)
          })
          .catch(() => undefined)
    },
    [services]
  )
  useEffect(() => {
    const value = new URLSearchParams(location.search).get('nexusAdd')
    if (!value) return
    show()
    if (value !== 'new') {
      void transport
        .invoke(Queries.GetNexusPreflight, { ids: value.split(',') })
        .then((raw) => {
          const parsed = nexusPreflightSchema.safeParse(raw)
          if (parsed.success) setPreflight(parsed.data)
        })
        .catch(() => undefined)
    }
    void navigate(location.pathname, { replace: true })
  }, [location.pathname, location.search, navigate, show])
  useEffect(() => {
    const event = (value: Event) => show((value as CustomEvent<string>).detail)
    const shell = (payload: unknown) => {
      show(
        payload &&
          typeof payload === 'object' &&
          'input' in payload &&
          typeof payload.input === 'string'
          ? payload.input
          : undefined
      )
      if (payload && typeof payload === 'object' && 'ids' in payload) {
        void transport
          .invoke(Queries.GetNexusPreflight, { ids: payload.ids })
          .then((raw) => {
            const parsed = nexusPreflightSchema.safeParse(raw)
            if (parsed.success) setPreflight(parsed.data)
          })
          .catch(() => undefined)
      }
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        event.stopPropagation()
        show()
      }
    }
    const paste = (event: ClipboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'input,textarea,[contenteditable]:not([contenteditable="false"])'
        )
      )
        return
      const value = event.clipboardData?.getData('text/plain')
      if (
        value &&
        /(?:https?|ftp):\/\/|magnet:\?|[\u4e00-\u9fff]/i.test(value)
      ) {
        event.preventDefault()
        show(value)
      }
    }
    const drop = (event: DragEvent) => {
      const value =
        event.dataTransfer?.getData('text/uri-list') ||
        event.dataTransfer?.getData('text/plain')
      if (
        value &&
        /(?:https?|ftp):\/\/|magnet:\?|[\u4e00-\u9fff]/i.test(value)
      ) {
        event.preventDefault()
        show(value)
      }
    }
    const drag = (event: DragEvent) => {
      if (
        event.dataTransfer?.types.some(
          (type) => type === 'text/uri-list' || type === 'text/plain'
        )
      )
        event.preventDefault()
    }
    window.addEventListener(NEXUS_ADD_EVENT, event)
    window.addEventListener('keydown', keyboard, true)
    window.addEventListener('paste', paste)
    window.addEventListener('drop', drop)
    window.addEventListener('dragover', drag)
    transport.on(Events.NexusOpenAdd, shell)
    return () => {
      window.removeEventListener(NEXUS_ADD_EVENT, event)
      window.removeEventListener('keydown', keyboard, true)
      window.removeEventListener('paste', paste)
      window.removeEventListener('drop', drop)
      window.removeEventListener('dragover', drag)
      transport.off(Events.NexusOpenAdd, shell)
    }
  }, [show])
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setFeedback('')
    try {
      return await operation()
    } catch {
      setFeedback(t('nexus.preflight.failed'))
    } finally {
      setBusy(false)
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: Successful login retries the same input.
  useEffect(() => {
    const request = ++revision.current
    if (!open || !input.trim()) {
      setRecognizing(false)
      return
    }
    if (!/(?:https?|ftp):\/\/|magnet:\?/i.test(input) && !consent) {
      setRecognizing(false)
      return
    }
    setRecognizing(true)
    setFeedback('')
    setLoginRequired(undefined)
    const timer = setTimeout(() => {
      let detected:
        | import('@shared/schemas/nexus-cloud').CloudPlatform
        | undefined
      void (async () => {
        let value = input.trim()
        if (!/(?:https?|ftp):\/\/|magnet:\?/i.test(value)) {
          const resolved = (await cloudCall(Commands.NexusCloudKouling, {
            input: value,
            consent,
          })) as { url: string }
          value = resolved.url
        }
        if (request !== revision.current) return
        const raw = await transport.invoke(Commands.NexusCollect, {
          input: value,
        })
        if (request !== revision.current) return
        const parsed = nexusPreflightSchema.safeParse(raw)
        if (!parsed.success) {
          setFeedback(t('nexus.preflight.unrecognized'))
          return
        }
        setPreflight(parsed.data)
        const source = parsed.data.items[0]?.source.platform
        if (
          source &&
          ['baidu', 'quark', 'uc', '115', '123', 'aliyun'].includes(source)
        ) {
          detected =
            source as import('@shared/schemas/nexus-cloud').CloudPlatform
          const data = cloudBrowseSchema.parse(
            await cloudCall(Commands.NexusCloudOpenShare, {
              platform: source,
              input: value,
            })
          )
          if (request !== revision.current) return
          setCloudData(data)
          const method = data.accountId
            ? data.capabilities.withoutSave
              ? 'without-save'
              : 'save'
            : 'guest'
          setCloudMethod(method)
          const saveDir = parsed.data.items[0]?.saveDir
          if (data.files.length && saveDir) {
            const check = cloudPreflightSchema.parse(
              await cloudCall(Commands.NexusCloudPreflight, {
                contextId: data.contextId,
                ids: data.files.map((file) => file.id),
                method,
                directory: saveDir,
              })
            )
            if (request === revision.current) setCloudCheck(check)
          }
        }
      })()
        .catch((error) => {
          if (request === revision.current) {
            setFeedback(t(`nexus.cloudError.${cloudError(error)}`))
            if (['login', 'login-elsewhere'].includes(cloudError(error))) {
              setLoginRequired(detected)
            }
          }
        })
        .finally(() => {
          if (request === revision.current) setRecognizing(false)
        })
    }, 450)
    return () => {
      clearTimeout(timer)
      revision.current++
    }
  }, [input, open, retry, consent, t])
  const choose = async () => {
    const raw = await run(() => transport.invoke(Commands.PickSaveDir))
    if (typeof raw !== 'string' || !raw) return
    setDirectory(raw)
    if (cloudData) {
      const checked = await run(() =>
        cloudCall(Commands.NexusCloudPreflight, {
          contextId: cloudData.contextId,
          ids: cloudData.files.map((file) => file.id),
          method: cloudMethod,
          directory: raw,
        })
      )
      const parsed = cloudPreflightSchema.safeParse(checked)
      if (parsed.success) setCloudCheck(parsed.data)
      return
    }
    const checked = await run(() =>
      transport.invoke(Queries.GetNexusPreflight, {
        ids: preflight?.items.map((item) => item.id),
        directory: raw,
      })
    )
    const parsed = nexusPreflightSchema.safeParse(checked)
    if (parsed.success) setPreflight(parsed.data)
  }
  const download = async () => {
    if (cloudData && cloudCheck) {
      await run(async () => {
        await cloudCall(Commands.NexusCloudDownload, {
          contextId: cloudData.contextId,
          ids: cloudData.files.map((file) => file.id),
          method: cloudMethod,
          directory: directory ?? preflight?.items[0]?.saveDir,
        })
        setOpen(false)
        navigate('/downloads/all')
      })
      return
    }
    const raw = await run(() =>
      transport.invoke(Commands.NexusDownload, {
        ids: downloadable.map((item) => item.id),
        directory,
      })
    )
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('taskIds' in raw) ||
      !Array.isArray(raw.taskIds)
    )
      return
    if ('failed' in raw && raw.failed)
      toast.add({ type: 'warning', title: t('nexus.preflight.partial') })
    if (raw.taskIds.length) {
      setOpen(false)
      setInput('')
      setPreflight(null)
      navigate('/downloads/all')
    }
  }
  const downloadable =
    preflight?.items.filter(
      (item) =>
        item.available && ['http', 'magnet'].includes(item.source.platform)
    ) ?? []
  const cloud = preflight?.items.some(
    (item) => !['http', 'magnet'].includes(item.source.platform)
  )
  const disk = preflight?.disks[0]
  const httpFailure = preflight?.items.find((item) => item.probe?.error)
  const noRange = preflight?.items.some((item) => item.probe?.range === false)
  const httpProbe = httpFailure?.probe
  const diskBlocked =
    !!disk &&
    disk.freeBytes !== null &&
    disk.freeBytes <
      (preflight?.knownBytes ?? 0) +
        (workspace?.preferences.diskReserveGiB ?? 5) * 1024 ** 3
  const openSource = async () => {
    const id = httpFailure?.id
    if (!id) return
    const value = await transport.invoke(Commands.NexusReadCloudInput, id)
    if (typeof value === 'string') await services.openExternal(value)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setOpen(value)
          if (!value) {
            inputRevision.current++
            revision.current++
            setInput('')
          }
        }
      }}
    >
      <DialogContent
        anchored
        className="nexus-shell nexus-dialog"
        overlayClassName="nexus-add-scrim"
        showCloseButton={false}
      >
        <div className="precheck">
          <div className="pc-input">
            <CopyLinkIcon />
            <Input
              value={input}
              onChange={(event) => {
                setInput(event.target.value)
                inputRevision.current++
                setConsent(false)
                revision.current++
                setPreflight(null)
                setCloudData(null)
                setCloudCheck(null)
                setFeedback('')
              }}
              aria-label={t('nexus.addPlaceholder')}
              placeholder={t('nexus.addPlaceholder')}
              maxLength={32768}
              className="nexus-source-input"
              autoFocus
            />
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={busy}
              aria-label={t('common.close')}
              onClick={() => {
                inputRevision.current++
                revision.current++
                setOpen(false)
              }}
            >
              <CloseIcon />
            </Button>
            <kbd>Esc</kbd>
          </div>
          <div className="pc-body">
            <DialogTitle className={preflight ? 'pc-title' : 'sr-only'}>
              {cloudData && (
                <PlatformLogo platform={cloudData.platform} small />
              )}
              {cloudData?.title ||
                (preflight
                  ? preflight.items.length === 1
                    ? preflight.items[0].title
                    : t('nexus.preflight.batch', {
                        count: preflight.items.length,
                      })
                  : t('nexus.v11.addTitle'))}
            </DialogTitle>
            <DialogDescription className="pc-sum">
              {recognizing
                ? t('nexus.preflight.working')
                : preflight
                  ? t('nexus.preflight.summary', {
                      count: cloudCheck?.count ?? preflight.items.length,
                      size: (
                        cloudCheck
                          ? cloudCheck.unknown > 0
                          : preflight.unknownCount > 0
                      )
                        ? t('nexus.v12.unknownSize')
                        : formatBytes(
                            cloudCheck?.knownBytes ?? preflight.knownBytes
                          ),
                    })
                  : ''}
            </DialogDescription>
            {input.trim() && !/(?:https?|ftp):\/\/|magnet:\?/i.test(input) && (
              <div className="nx-kouling-consent">
                <p>{t('nexus.cloudV2.koulingPrivacy')}</p>
                <label htmlFor="nx-add-kouling-consent">
                  <Checkbox
                    id="nx-add-kouling-consent"
                    checked={consent}
                    onCheckedChange={(value) => setConsent(value === true)}
                  />
                  {t('nexus.cloudV2.koulingConfirm')}
                </label>
              </div>
            )}
            {preflight && !recognizing && (
              <ul className="checks">
                {httpProbe?.error ? (
                  <li className="e">
                    <WarningIcon />
                    <div>
                      <b>
                        {t(`nexus.v12.http.${httpProbe.error}`, {
                          status: httpProbe.status,
                        })}
                      </b>
                      <small>
                        {t(
                          httpProbe.error === 'forbidden'
                            ? 'nexus.v12.http.forbiddenHelp'
                            : 'nexus.v12.http.networkHelp'
                        )}
                      </small>
                    </div>
                  </li>
                ) : (
                  <li>
                    <CheckIcon />
                    <div>
                      <b>
                        {t(
                          cloudData
                            ? 'nexus.preflight.recognized'
                            : 'nexus.v12.http.accessible'
                        )}
                      </b>
                    </div>
                  </li>
                )}
                {!httpFailure && noRange && (
                  <li className="w">
                    <WarningIcon />
                    <div>
                      <b>{t('nexus.v12.http.noRange')}</b>
                      <small>{t('nexus.v12.http.noRangeHelp')}</small>
                    </div>
                  </li>
                )}
                <li className={diskBlocked ? 'e' : ''}>
                  {diskBlocked ? <WarningIcon /> : <CheckIcon />}
                  <div>
                    <b>
                      {t(
                        diskBlocked
                          ? 'nexus.preflight.noSpace'
                          : disk?.freeBytes === null
                            ? 'nexus.preflight.diskUnknown'
                            : 'nexus.preflight.spaceAvailable'
                      )}
                    </b>
                    <small>
                      {disk?.freeBytes != null
                        ? formatBytes(disk.freeBytes)
                        : t('nexus.preflight.spaceDesc')}
                    </small>
                  </div>
                </li>
              </ul>
            )}
            {preflight &&
              offlineSource &&
              workspace?.preferences.offline115 && (
                <OfflineDownload source={offlineSource} />
              )}
            {feedback && (
              <p className="nexus-add-feedback" role="alert">
                {feedback}
              </p>
            )}
            {loginRequired && (
              <CloudLoginButton
                platform={loginRequired}
                accountId={
                  cloudData?.accountId ??
                  cloudState?.accounts.find(
                    (account) =>
                      account.platform === loginRequired &&
                      account.health?.login === 'expired'
                  )?.id ??
                  cloudState?.accounts.find(
                    (account) => account.platform === loginRequired
                  )?.id
                }
                onError={(kind) => setFeedback(t(`nexus.cloudError.${kind}`))}
                onSuccess={() => setRetry((value) => value + 1)}
              />
            )}
          </div>
          {preflight && !recognizing && (
            <div className="pc-foot">
              <Button
                variant="ghost"
                className="muted"
                disabled={!preflight || busy}
                onClick={() => void choose()}
              >
                <FolderIcon />
                <span
                  className="nexus-save-path"
                  title={directory ?? preflight?.items[0]?.saveDir}
                >
                  {httpProbe?.error === 'forbidden' && httpProbe.retried
                    ? t('nexus.v12.http.retryDenied')
                    : preflight
                      ? t('nexus.preflight.saveTo', {
                          directory: directory ?? preflight.items[0]?.saveDir,
                        })
                      : t('nexus.preflight.localOnly')}
                </span>
              </Button>
              {httpFailure ? (
                <Button onClick={() => void run(openSource)}>
                  {t('nexus.v12.http.browser')}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={
                    busy ||
                    !!feedback ||
                    (cloud
                      ? !cloudCheck || cloudCheck.blocked
                      : !downloadable.length || preflight.blocked)
                  }
                  onClick={() => void download()}
                >
                  {t(
                    busy
                      ? 'nexus.preflight.working'
                      : 'nexus.preflight.download',
                    { count: cloudCheck?.downloadCount ?? downloadable.length }
                  )}
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
