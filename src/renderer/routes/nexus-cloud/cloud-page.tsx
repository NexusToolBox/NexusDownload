import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Group,
  Input,
  Item,
  Choice as SettingChoice,
} from '@renderer/components/desktop-kit/nexus'
import {
  NEXUS_PLATFORMS,
  PlatformLogo,
} from '@renderer/components/desktop-kit/nexus/platform-logo'
import {
  ArchiveIcon,
  ConfluenceIcon,
  DocumentIcon,
  FilesIcon,
  FolderIcon,
  ImageIcon,
  MediaIcon,
} from '@renderer/components/icons'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { Queries } from '@shared/protocol/queries'
import {
  type CloudBrowse,
  type CloudMethod,
  type CloudPlatform,
  type CloudPreflight,
  cloudBrowseSchema,
  cloudPreflightSchema,
} from '@shared/schemas/nexus-cloud'
import { formatBytes } from '@shared/utils/format-bytes'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { z } from 'zod'
import { DuplicateNotice } from '../nexus-downloads/duplicate-notice'
import { useNexusWorkspace } from '../nexus-downloads/use-workspace'
import { AccountMenu } from './account-menu'
import { AccountPanel } from './account-panel'
import { cloudCall, cloudError, takeCloudInput, useCloud } from './cloud-client'
import { CloudLoginButton } from './cloud-login-button'

export function NexusCloudPage() {
  const { t } = useTranslation()
  const state = useCloud()
  const workspace = useNexusWorkspace()
  const [params] = useSearchParams()
  const [platform, setPlatform] = useState<CloudPlatform>(
    NEXUS_PLATFORMS.find((p) => p.key === params.get('platform'))?.key ??
      'baidu'
  )
  const [accountId, setAccountId] = useState<string | undefined>(
    params.get('account') ?? undefined
  )
  useEffect(() => {
    const selected = NEXUS_PLATFORMS.find(
      (p) => p.key === params.get('platform')
    )
    if (selected) {
      setPlatform(selected.key)
      setAccountId(params.get('account') ?? undefined)
    }
  }, [params])
  const [data, setData] = useState<CloudBrowse | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [breadcrumbs, setBreadcrumbs] = useState<
    { id: string; name: string }[]
  >([])
  const [input, setInput] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [directory, setDirectory] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [method, setMethod] = useState<CloudMethod>('own')
  const [check, setCheck] = useState<CloudPreflight | null>(null)
  const [allowPlayback, setAllowPlayback] = useState(false)
  const [skipExisting, setSkipExisting] = useState(true)
  const generation = useRef(0)
  const accounts = state?.accounts.filter((a) => a.platform === platform) ?? []
  const account =
    accounts.find(
      (a) => a.id === (accountId ?? check?.account?.id ?? data?.accountId)
    ) ??
    accounts.find(
      (item) => item.state === 'ready' && item.health?.login !== 'expired'
    ) ??
    accounts[0]
  const signedOut =
    !account ||
    account.health?.login === 'expired' ||
    ['login', 'login-elsewhere'].includes(account.reason ?? '')
  const capabilities = data?.capabilities ?? {
    own: account?.authorization !== 'share',
    withoutSave: platform !== 'baidu',
    guest: ['quark', 'uc', '115'].includes(platform),
    save: ['quark', 'uc', 'baidu', '115'].includes(platform),
    playback: false,
  }
  const methods = data?.shareRef
    ? data.accountId
      ? [
          ...(capabilities.withoutSave ? ['without-save'] : []),
          ...(capabilities.save ? ['save'] : []),
        ]
      : capabilities.guest
        ? ['guest']
        : []
    : ['own']
  useEffect(() => {
    const pending = takeCloudInput()
    if (pending) {
      setInput(pending)
      setShareOpen(true)
    }
    void transport
      .invoke(Queries.GetSettings)
      .then((value) => {
        const parsed = z
          .object({ app: z.object({ defaultSaveDir: z.string() }) })
          .safeParse(value)
        if (parsed.success) setDirectory(parsed.data.app.defaultSaveDir)
      })
      .catch(() => undefined)
  }, [])
  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (e) {
      setError(cloudError(e))
    } finally {
      setBusy(false)
    }
  }, [])
  const browse = useCallback(
    async (id = '0', shareRef?: string) => {
      const revision = ++generation.current
      const value = cloudBrowseSchema.parse(
        await cloudCall(Commands.NexusCloudBrowse, {
          platform,
          accountId,
          directory: id,
          shareRef,
        })
      )
      if (revision !== generation.current) return
      setData(value)
      setSelected([])
      setCheck(null)
      setMethod(
        value.shareRef
          ? value.accountId
            ? platform === 'baidu'
              ? 'save'
              : 'without-save'
            : 'guest'
          : 'own'
      )
    },
    [platform, accountId]
  )
  const selection = () => ({
    contextId: data?.contextId,
    ids: selected,
    method,
    directory,
    allowPlayback,
    skipExisting:
      workspace?.preferences.duplicateWarning === false ? false : skipExisting,
  })
  const reset = () => {
    generation.current++
    setData(null)
    setSelected([])
    setBreadcrumbs([])
    setCheck(null)
    setError('')
    setAllowPlayback(false)
    setSkipExisting(true)
  }
  const choose = async () => {
    const value = await transport.invoke(Commands.PickSaveDir)
    if (typeof value === 'string') {
      setDirectory(value)
      setCheck(null)
    }
  }
  const accountKey = accounts.map((a) => a.id).join(',')
  useEffect(() => {
    if (!accountKey) return
    void run(async () => {
      await browse()
    })
  }, [browse, run, accountKey])
  return (
    <div className="page on">
      <header className="phead">
        <h1>{t('nexus.nav.cloud')}</h1>
        <div className="spacer" />
        <div className="pillgroup">
          {account && <AccountMenu account={account} onError={setError} />}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setShareOpen(true)}
          >
            {t('nexus.cloud.openShare')}
          </Button>
        </div>
      </header>
      {error && (
        <div className="nexus-cloud-alert" role="alert">
          {t(`nexus.cloudError.${error}`)}
        </div>
      )}
      {account?.needsLocalLogin && (
        <div className="nexus-cloud-alert" role="status">
          {t('nexus.v13.localLogin')}
        </div>
      )}
      {state && !state.available && (
        <div className="nexus-cloud-alert" role="alert">
          {t('nexus.cloudV2.vaultUnavailable')}
        </div>
      )}
      <div
        className={`cloud nexus-bordered-body ${signedOut ? 'nexus-cloud-signed-out' : ''}`}
      >
        <nav className="drives" aria-label={t('nexus.nav.cloud')}>
          {NEXUS_PLATFORMS.map((item) => (
            <Button
              key={item.key}
              variant="ghost"
              className="drive"
              aria-current={platform === item.key ? 'true' : undefined}
              disabled={
                busy ||
                !['baidu', 'quark', 'uc', '115', '123', 'aliyun'].includes(
                  item.key
                )
              }
              onClick={() => {
                setPlatform(item.key as CloudPlatform)
                setAccountId(undefined)
                reset()
              }}
            >
              <PlatformLogo platform={item.key} />
              {t(`nexus.platform.${item.key}`)}
              {(() => {
                const accounts =
                  state?.accounts.filter((a) => a.platform === item.key) ?? []
                const expired = accounts.some(
                  (a) =>
                    a.health?.login === 'expired' ||
                    ['login', 'login-elsewhere'].includes(a.reason ?? '')
                )
                const ready = accounts.some(
                  (a) => a.state === 'ready' && a.health?.login === 'valid'
                )
                const hint = t(
                  expired
                    ? 'nexus.cloudV3.reauthorize'
                    : ready
                      ? 'nexus.cloudV2.loggedIn'
                      : 'nexus.cloud.notLoggedIn'
                )
                return (
                  <span
                    className={`nx-drive-dot ${expired ? 'error' : ready ? 'ready' : ''}`}
                    title={hint}
                    role="img"
                    aria-label={hint}
                  />
                )
              })()}
            </Button>
          ))}
        </nav>
        <div className="files">
          {signedOut && !data?.shareRef ? (
            <div className="empty nexus-cloud-login-empty">
              <PlatformLogo platform={platform} />
              <p>{t('nexus.v11.cloudLoginHelp')}</p>
              <CloudLoginButton
                primary
                platform={platform}
                accountId={account?.id}
                disabled={busy || !state?.available}
                onError={setError}
              />
            </div>
          ) : (
            <>
              <div className="crumbs">
                <Button
                  variant="ghost"
                  disabled={
                    busy || (!accountId && !accounts.length && !data?.shareRef)
                  }
                  onClick={() =>
                    void run(async () => {
                      setBreadcrumbs([])
                      await browse('0', data?.shareRef)
                    })
                  }
                >
                  {t(
                    data?.shareRef
                      ? 'nexus.cloud.openShare'
                      : 'nexus.cloud.myFiles'
                  )}
                </Button>
                {breadcrumbs.map((crumb, index) => (
                  <Button
                    key={crumb.id}
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await browse(crumb.id, data?.shareRef)
                        setBreadcrumbs(breadcrumbs.slice(0, index + 1))
                      })
                    }
                  >
                    / {crumb.name}
                  </Button>
                ))}
              </div>
              <div className="ftable nexus-cloud-table">
                <div className="frow head">
                  <span />
                  <span />
                  <span>{t('nexus.cloud.name')}</span>
                  <span className="r">{t('nexus.cloud.size')}</span>
                  <span className="d">{t('nexus.cloud.modified')}</span>
                </div>
                {data?.files.map((file) => (
                  <div
                    className="frow"
                    key={file.id}
                    data-selected={selected.includes(file.id)}
                  >
                    <Checkbox
                      aria-label={t('nexus.cloudV2.selectFile', {
                        name: file.name,
                      })}
                      checked={selected.includes(file.id)}
                      disabled={busy}
                      onCheckedChange={(checked) => {
                        setSelected((ids) =>
                          checked
                            ? [...ids, file.id]
                            : ids.filter((id) => id !== file.id)
                        )
                        setCheck(null)
                      }}
                    />
                    <span className="ft">
                      {file.directory ? (
                        <FolderIcon />
                      ) : /\.(mp4|mkv|mov|avi|webm|flv|ts)$/i.test(
                          file.name
                        ) ? (
                        <MediaIcon />
                      ) : /\.(zip|rar|7z|gz|tar)$/i.test(file.name) ? (
                        <ArchiveIcon />
                      ) : /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name) ? (
                        <ImageIcon />
                      ) : /\.(pdf|docx?|xlsx?|pptx?|txt|md|epub)$/i.test(
                          file.name
                        ) ? (
                        <DocumentIcon />
                      ) : (
                        <FilesIcon />
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      className="nexus-cloud-filename"
                      disabled={busy || !file.directory}
                      onClick={() =>
                        void run(async () => {
                          await browse(
                            platform === 'baidu' ? file.path : file.id,
                            data.shareRef
                          )
                          setBreadcrumbs([
                            ...breadcrumbs,
                            {
                              id: platform === 'baidu' ? file.path : file.id,
                              name: file.name,
                            },
                          ])
                        })
                      }
                    >
                      {file.name}
                    </Button>
                    <span className="r">
                      {file.directory
                        ? '—'
                        : file.bytes === null
                          ? t('nexus.cloudV2.unknown')
                          : formatBytes(file.bytes)}
                    </span>
                    <span className="d">
                      {file.modified
                        ? new Date(
                            !Number.isFinite(Number(file.modified))
                              ? file.modified
                              : Number(file.modified) < 100000000000
                                ? Number(file.modified) * 1000
                                : Number(file.modified)
                          ).toLocaleDateString()
                        : '—'}
                    </span>
                  </div>
                ))}
                {!data?.files.length && (
                  <div className="empty">
                    <ConfluenceIcon className="glyph" />
                    <h2>
                      {t(
                        data
                          ? 'nexus.cloudV2.emptyFolder'
                          : 'nexus.cloud.emptyTitle'
                      )}
                    </h2>
                    {!data && <p>{t('nexus.v11.loadingFiles')}</p>}
                  </div>
                )}
              </div>
              {selected.length > 0 && (
                <div className="nexus-cloud-selection">
                  <span>
                    {t('nexus.cloudV2.selected', { count: selected.length })}
                  </span>
                  <SettingChoice
                    label={t('nexus.fact.method')}
                    value={method}
                    choices={methods.map((m) => ({
                      value: m,
                      label: t(`nexus.cloudV2.method.${m}`),
                    }))}
                    onChange={(value) => {
                      setMethod(value as CloudMethod)
                      setCheck(null)
                    }}
                  />
                  <Button
                    className="nexus-cloud-path"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run(choose)}
                  >
                    <FolderIcon />
                    {directory || t('nexus.cloudV2.chooseFolder')}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy || !directory || !methods.includes(method)}
                    onClick={() =>
                      void run(async () => {
                        setCheck(
                          cloudPreflightSchema.parse(
                            await cloudCall(
                              Commands.NexusCloudPreflight,
                              selection()
                            )
                          )
                        )
                      })
                    }
                  >
                    {t('nexus.cloudV2.preflight')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
        {account && (
          <AccountPanel
            account={account}
            accounts={accounts}
            capabilities={capabilities}
            onError={setError}
            onChange={(id) => {
              setAccountId(id)
              reset()
            }}
          />
        )}
      </div>
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogTitle>{t('nexus.cloud.openShare')}</DialogTitle>
          <DialogDescription>{t('nexus.cloudV2.shareHelp')}</DialogDescription>
          <Group>
            <Item title={t('nexus.cloudV2.shareInput')}>
              <Input
                value={input}
                aria-label={t('nexus.cloudV2.shareInput')}
                onChange={(event) => setInput(event.target.value)}
              />
            </Item>
          </Group>
          <Button
            size="sm"
            disabled={busy || !input.trim()}
            onClick={() =>
              void run(async () => {
                const host = input.match(/https?:\/\/([^/\s]+)/)?.[1]
                const detected =
                  host === 'pan.baidu.com'
                    ? 'baidu'
                    : host === 'pan.quark.cn'
                      ? 'quark'
                      : ['drive.uc.cn', 'fast.uc.cn'].includes(host ?? '')
                        ? 'uc'
                        : /^(?:115cdn|115|115rc)\.com$/.test(host ?? '')
                          ? '115'
                          : /^(?:www\.)?123(?:pan|684|865)\.(?:com|cn)$/.test(
                                host ?? ''
                              )
                            ? '123'
                            : /^(?:www\.)?(?:alipan|aliyundrive)\.com$/.test(
                                  host ?? ''
                                )
                              ? 'aliyun'
                              : platform
                const id = detected === platform ? accountId : undefined
                const value = cloudBrowseSchema.parse(
                  await cloudCall(Commands.NexusCloudOpenShare, {
                    platform: detected,
                    accountId: id,
                    input,
                  })
                )
                setPlatform(detected)
                setAccountId(id)
                setData(value)
                setSelected([])
                setBreadcrumbs([])
                setMethod(
                  value.accountId
                    ? detected === 'baidu'
                      ? 'save'
                      : 'without-save'
                    : 'guest'
                )
                setShareOpen(false)
                setInput('')
              })
            }
          >
            {t('nexus.cloudV2.open')}
          </Button>
          {error && <p role="alert">{t(`nexus.cloudError.${error}`)}</p>}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!check}
        onOpenChange={(open) => {
          if (!open) setCheck(null)
        }}
      >
        <DialogContent className="nexus-cloud-preflight">
          <DialogTitle>{t('nexus.cloudV2.preflight')}</DialogTitle>
          <DialogDescription>
            {t('nexus.cloudV2.preflightHelp')}
          </DialogDescription>
          {check && (
            <>
              <h3>
                <PlatformLogo platform={platform} small />{' '}
                {t(`nexus.platform.${platform}`)} ·{' '}
                {t('nexus.cloudV2.fileCount', { count: check.count })} ·{' '}
                {formatBytes(check.knownBytes)}
              </h3>
              {check.account && (
                <p>
                  {t('nexus.cloudV3.selectedAccount', {
                    account:
                      check.account.note ||
                      t('nexus.cloudV2.accountNumber', {
                        count:
                          accounts.findIndex(
                            (a) => a.id === check.account?.id
                          ) + 1,
                      }),
                  })}
                </p>
              )}
              <div className="nexus-cloud-checks">
                <p>{t('nexus.cloudV2.linkValid')}</p>
                <p>{t(`nexus.cloudV2.method.${check.method}`)}</p>
                <p>
                  {t(
                    check.diskEnough
                      ? 'nexus.cloudV2.diskPass'
                      : 'nexus.cloudV2.diskFail'
                  )}
                </p>
                <p>
                  {t(
                    check.spaceEnough
                      ? 'nexus.cloudV2.spacePass'
                      : 'nexus.cloudV2.spaceFail'
                  )}
                </p>
                <p>
                  {t(
                    check.account?.state === 'paused'
                      ? 'nexus.cloudV2.accountPaused'
                      : 'nexus.cloudV2.accountPass'
                  )}
                </p>
                <p>
                  {check.etaSeconds === null
                    ? t('nexus.cloudV2.etaUnknown')
                    : t('nexus.speed.eta', {
                        minutes: Math.max(1, Math.ceil(check.etaSeconds / 60)),
                      })}
                </p>
                {check.successRate !== null && (
                  <p>
                    {t('nexus.speed.success', {
                      percent: Math.round(check.successRate * 100),
                    })}
                  </p>
                )}
                <p>{t('nexus.cloudV2.localEngine')}</p>
                {!check.transferEnough && (
                  <p role="alert">{t('nexus.cloudError.rate')}</p>
                )}
              </div>
              {check.quota && (
                <p>
                  {t('nexus.cloudV2.remainingSpace', {
                    size: formatBytes(check.quota.total - check.quota.used),
                  })}
                </p>
              )}
              <DuplicateNotice
                duplicates={check.duplicates.map((item) => ({
                  taskId: item.taskId,
                  status: item.status ?? ('completed' as const),
                }))}
                total={check.count}
                busy={busy}
                skip={skipExisting}
                onSkip={(skip) => {
                  setSkipExisting(skip)
                  void run(async () =>
                    setCheck(
                      cloudPreflightSchema.parse(
                        await cloudCall(Commands.NexusCloudPreflight, {
                          ...selection(),
                          skipExisting: skip,
                        })
                      )
                    )
                  )
                }}
                onDownload={() =>
                  void run(async () => {
                    await cloudCall(Commands.NexusCloudDownload, {
                      ...selection(),
                      skipExisting: false,
                    })
                    setCheck(null)
                    setSelected([])
                  })
                }
                onClose={() => setCheck(null)}
              />
              <p>{t('nexus.cloudV2.originalGuard')}</p>
              {error === 'playback' && (
                <label
                  htmlFor="nexus-playback-consent"
                  className="nexus-cloud-selection"
                >
                  <Checkbox
                    id="nexus-playback-consent"
                    checked={allowPlayback}
                    onCheckedChange={(value) =>
                      setAllowPlayback(value === true)
                    }
                  />
                  {t('nexus.cloudV2.allowPlayback')}
                </label>
              )}
              <p>{directory}</p>
              <Group className="">
                <h4>
                  {t('nexus.cloud.name')} · {check.count}
                </h4>
                <div className="max-h-40 overflow-auto">
                  {check.files.map((file) => (
                    <p key={file.name}>
                      {file.name} ·{' '}
                      {file.bytes === null
                        ? t('nexus.cloudV2.unknown')
                        : formatBytes(file.bytes)}
                    </p>
                  ))}
                </div>
              </Group>
              <Button
                size="sm"
                hidden={check.count === 1 && check.duplicates.length > 0}
                disabled={busy || check.blocked}
                onClick={() =>
                  void run(async () => {
                    await cloudCall(Commands.NexusCloudDownload, selection())
                    setCheck(null)
                    setSelected([])
                  })
                }
              >
                {t('nexus.cloudV2.downloadFiles', {
                  count: check.downloadCount,
                })}
              </Button>
              {error && <p role="alert">{t(`nexus.cloudError.${error}`)}</p>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
