import {
  Button,
  Group,
  Input,
  Section,
  Choice as SettingChoice,
  Item as SettingRow,
  Switch,
} from '@renderer/components/desktop-kit/nexus'
import { ImmediateSettings } from '@renderer/components/settings-kit/immediate-settings'
import {
  SettingsLoadStatus,
  useSettingsLoad,
} from '@renderer/components/settings-kit/use-settings-load'
import { toast } from '@renderer/components/ui/toast'
import { onSettingsSaved, saveSettings } from '@renderer/lib/settings-save'
import { transport } from '@renderer/lib/transport'
import { AccountRow } from '@renderer/routes/nexus-cloud/account-row'
import { useNexusWorkspace } from '@renderer/routes/nexus-downloads/use-workspace'
import { findCard } from '@renderer/routes/settings/card-registry'
import {
  isLanguagePreference,
  SUPPORTED_LOCALES,
} from '@shared/constants/locales'
import { Commands } from '@shared/protocol/commands'
import { Events } from '@shared/protocol/events'
import type { NexusPreferences } from '@shared/schemas/nexus-workspace'
import type { AppSettings } from '@shared/types/settings'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useParams, useSearchParams } from 'react-router'
import { AccountCheck } from '../nexus-cloud/account-check'
import { cloudCall, cloudError, useCloud } from '../nexus-cloud/cloud-client'
import { PasswordBook } from '../nexus-downloads/processing-steps'
import { NexusAbout } from './about-page'
import { AdvancedGroup } from './advanced-group'
import { ControlSettings } from './control-settings'
import { ExternalTools } from './external-tools'
import { QueueSettings } from './queue-settings'
import { NexusRuleDialog } from './rule-dialog'
import { SystemCleanup } from './system-cleanup'

const sections = [
  'general',
  'downloads',
  'network',
  'queues',
  'accounts',
  'media',
  'tools',
  'connections',
  'about',
] as const
export function NexusSettingsPage() {
  const { t } = useTranslation()
  const cloud = useCloud()
  const [cloudFailure, setCloudFailure] = useState('')
  const location = useLocation()
  const { cardId } = useParams<{ cardId: string }>()
  const [params, setParams] = useSearchParams()
  const requested =
    params.get('section') ??
    (cardId === 'about'
      ? 'about'
      : cardId === 'integration'
        ? 'browser'
        : (cardId ?? 'downloads'))
  const active =
    (
      {
        appearance: 'general',
        bittorrent: 'network',
        browser: 'connections',
        phone: 'connections',
        mcp: 'connections',
        diagnostics: 'about',
      } as Record<string, string>
    )[requested] ?? requested
  const workspace = useNexusWorkspace()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const load = useSettingsLoad(setSettings)
  const [busy, setBusy] = useState(false)
  const [editingRules, setEditingRules] = useState(false)
  const visible = /^\/settings(?:\/|$)/.test(location.pathname)
  useEffect(() => {
    const refresh = () => {
      void load.retry()
    }
    transport.on(Events.SettingsChanged, refresh)
    const detach = onSettingsSaved(refresh)
    const reconnect = transport.onConnectionChange?.((event) => {
      if (event.state === 'connected') refresh()
    })
    return () => {
      transport.off(Events.SettingsChanged, refresh)
      detach()
      reconnect?.()
    }
  }, [load.retry])
  const disabled = busy || !load.ready || !workspace
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await operation()
    } catch {
      toast.add({ type: 'error', title: t('nexus.settings.saveFailed') })
    } finally {
      setBusy(false)
    }
  }
  const preference = (patch: Partial<NexusPreferences>) =>
    void run(() => transport.invoke(Commands.NexusUpdatePreferences, patch))
  const appPreference = (patch: Partial<AppSettings['app']>) =>
    void run(() => saveSettings({ app: patch }))
  const toggle = (
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
    unavailable = false
  ) => (
    <Switch
      className="nexus-setting-switch"
      aria-label={label}
      checked={checked}
      disabled={disabled || unavailable}
      onCheckedChange={onChange}
    />
  )
  const directory = settings?.app.defaultSaveDir ?? ''
  const rules = workspace?.preferences.rules ?? []
  const inline = (id: string, advancedContent?: ReactNode) => {
    const card = findCard(id)
    return card ? (
      <card.Dialog
        key={id}
        open={visible}
        onClose={() => {}}
        labelKey={card.labelKey}
        descKey={card.descKey}
        advancedContent={advancedContent}
      />
    ) : null
  }
  return (
    <div className="page on nexus-settings">
      <header className="phead">
        <div>
          <h1>{t('nexus.nav.settings')}</h1>
        </div>
      </header>
      <div className="settings">
        <nav className="snav" aria-label={t('nexus.nav.settings')}>
          {sections.map((section) => (
            <Button
              type="button"
              key={section}
              aria-current={active === section ? 'true' : undefined}
              onClick={() => setParams({ section })}
            >
              {t(`nexus.settings.sections.${section}`)}
            </Button>
          ))}
        </nav>
        <ImmediateSettings>
          <div className="sbody" key={active}>
            <SettingsLoadStatus {...load} />
            {active === 'downloads' && (
              <>
                {inline('downloads')}
                <Group>
                  <SettingRow label={t('nexus.v4.diskReserve')}>
                    <Input
                      type="number"
                      min="0.1"
                      max="1024"
                      step="0.1"
                      aria-label={t('nexus.v4.diskReserve')}
                      defaultValue={workspace?.preferences.diskReserveGiB ?? 5}
                      onBlur={(e) => {
                        const value = Number(e.target.value)
                        if (
                          Number.isFinite(value) &&
                          value >= 0.1 &&
                          value <= 1024
                        )
                          preference({ diskReserveGiB: value })
                      }}
                    />
                  </SettingRow>
                </Group>
                <Group className="">
                  <SettingRow
                    label={t('nexus.settings.classification')}
                    description={t('nexus.settings.classificationDescription')}
                  >
                    {toggle(
                      t('nexus.settings.classification'),
                      workspace?.preferences.classificationEnabled ?? false,
                      (checked) =>
                        preference({ classificationEnabled: checked })
                    )}
                  </SettingRow>
                </Group>
                <Section
                  title={t('nexus.settings.classificationRules')}
                  description={t('nexus.settings.ruleOrder')}
                  action={
                    <Button
                      variant="quiet"
                      disabled={disabled}
                      onClick={() => setEditingRules(true)}
                    >
                      {t('nexus.settings.editRules')}
                    </Button>
                  }
                >
                  <Group>
                    {rules.map((rule) => (
                      <SettingRow
                        key={rule.id}
                        className={rule.enabled ? '' : 'nexus-rule-disabled'}
                        title={t(
                          rule.kind === 'type'
                            ? `nexus.settings.fileType.${rule.value}`
                            : `nexus.settings.ruleKind.${rule.kind}`
                        )}
                        description={
                          rule.kind === 'type'
                            ? t(`nexus.settings.typeDescription.${rule.value}`)
                            : rule.kind === 'platform'
                              ? t(`nexus.platform.${rule.value}`)
                              : rule.value
                        }
                      >
                        <span
                          className="nx-path"
                          title={`${directory}\\${rule.directory}`}
                        >
                          {rule.directory}
                        </span>
                      </SettingRow>
                    ))}
                    <SettingRow
                      title={t('nexus.settings.fileType.other')}
                      description={t('nexus.settings.fallbackRule')}
                    >
                      <span className="nx-path" title={directory}>
                        {directory}
                      </span>
                    </SettingRow>
                  </Group>
                </Section>
                <AdvancedGroup>
                  <Group>
                    {' '}
                    <SettingRow
                      label={t('nexus.settings.networkMark')}
                      description={t('nexus.settings.networkMarkDescription')}
                    >
                      {toggle(
                        t('nexus.settings.networkMark'),
                        workspace?.preferences.markInternet ?? false,
                        (checked) => preference({ markInternet: checked })
                      )}
                    </SettingRow>
                  </Group>
                </AdvancedGroup>
              </>
            )}
            {active === 'general' && (
              <>
                <Section title={t('nexus.settings.dailyUse')}>
                  <Group>
                    <SettingRow title={t('nexus.v15.language')}>
                      <SettingChoice
                        label={t('nexus.v15.language')}
                        value={settings?.app.language ?? 'system'}
                        disabled={disabled}
                        choices={[
                          {
                            value: 'system',
                            label: t('settings.appearance.followSystem'),
                          },
                          ...SUPPORTED_LOCALES.map(({ code, nativeName }) => ({
                            value: code,
                            label: nativeName,
                          })),
                        ]}
                        onChange={(value) => {
                          if (isLanguagePreference(value))
                            appPreference({ language: value })
                        }}
                      />
                    </SettingRow>
                    <SettingRow
                      title={t('nexus.settings.clipboard')}
                      description={t('nexus.settings.clipboardDescription')}
                    >
                      {toggle(
                        t('nexus.settings.clipboard'),
                        workspace?.preferences.clipboardEnabled ?? false,
                        (value) => preference({ clipboardEnabled: value })
                      )}
                    </SettingRow>
                    <SettingRow title={t('nexus.v13.autoUpdate')}>
                      {toggle(
                        t('nexus.v13.autoUpdate'),
                        settings?.app.checkForUpdatesOnLaunch ?? true,
                        (value) =>
                          appPreference({ checkForUpdatesOnLaunch: value })
                      )}
                    </SettingRow>
                  </Group>
                </Section>
                {inline('general')}
                {inline('appearance')}
              </>
            )}
            {active === 'network' &&
              inline(
                'network',
                <>
                  {' '}
                  <Group>
                    <SettingRow
                      title={t('nexus.v13.githubPrefix')}
                      description={t('nexus.v13.githubPrefixHelp')}
                    >
                      <Input
                        aria-label={t('nexus.v13.githubPrefix')}
                        defaultValue={settings?.app.githubDownloadPrefix ?? ''}
                        onBlur={(event) =>
                          appPreference({
                            githubDownloadPrefix: event.target.value.trim(),
                          })
                        }
                      />
                    </SettingRow>
                  </Group>
                  {inline('bittorrent')}
                </>
              )}
            {active === 'queues' && (
              <>
                <QueueSettings />
                <PasswordBook />
              </>
            )}
            {active === 'accounts' && (
              <Section action={<AccountCheck />}>
                <Group>
                  {(
                    ['baidu', 'quark', 'uc', 'aliyun', '115', '123'] as const
                  ).flatMap((platform) => {
                    const accounts =
                      cloud?.accounts.filter(
                        (account) => account.platform === platform
                      ) ?? []
                    return accounts.length
                      ? accounts.map((account, index) => (
                          <AccountRow
                            key={account.id}
                            sub={index > 0}
                            platform={platform}
                            account={account}
                          />
                        ))
                      : [<AccountRow key={platform} platform={platform} />]
                  })}
                  {cloud?.orphans.map((orphan) => (
                    <SettingRow
                      key={`${orphan.accountId}:${orphan.directory}`}
                      label={t('nexus.cloudV2.orphanTitle')}
                      description={`${t('nexus.cloudV2.orphanHelp')} ${orphan.directory}`}
                    >
                      <Button
                        onClick={() => {
                          void cloudCall(
                            Commands.NexusCloudCleanup,
                            orphan
                          ).catch((e) => setCloudFailure(cloudError(e)))
                        }}
                      >
                        {t('nexus.cloudV2.cleanupConfirmed')}
                      </Button>
                    </SettingRow>
                  ))}
                  {cloudFailure && (
                    <p role="alert">{t(`nexus.cloudError.${cloudFailure}`)}</p>
                  )}
                </Group>
              </Section>
            )}
            {active === 'media' && (
              <Group className="">
                <SettingRow label={t('nexus.v11.preferredQuality')}>
                  <SettingChoice
                    label={t('nexus.v11.preferredQuality')}
                    value={String(workspace?.preferences.mediaQuality ?? 120)}
                    disabled={disabled}
                    choices={[
                      16, 32, 64, 74, 80, 112, 116, 120, 125, 126, 127,
                    ].map((quality) => ({
                      value: String(quality),
                      label: t(`nexus.v11.quality.${quality}`),
                    }))}
                    onChange={(value) =>
                      preference({ mediaQuality: Number(value) })
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t('nexus.v11.livePhoto')}
                  description={t('nexus.v11.livePhotoHelp')}
                >
                  {toggle(
                    t('nexus.v11.livePhoto'),
                    workspace?.preferences.livePhoto ?? true,
                    (value) => preference({ livePhoto: value })
                  )}
                </SettingRow>
              </Group>
            )}
            {active === 'connections' && (
              <>
                <Section title={t('nexus.settings.sections.browser')}>
                  {inline('integration')}
                </Section>
                <ControlSettings />
                <ControlSettings kind="mcp" />
              </>
            )}
            {active === 'tools' && <ExternalTools />}
            {active === 'about' && (
              <>
                <NexusAbout />
                <AdvancedGroup>
                  <Group className="">
                    <SystemCleanup />
                    <SettingRow
                      label={t('nexus.settings.diagnosticsMode')}
                      description={t(
                        'nexus.settings.diagnosticsModeDescription'
                      )}
                    >
                      {toggle(
                        t('nexus.settings.diagnosticsMode'),
                        workspace?.preferences.diagnosticsEnabled ?? false,
                        (checked) => preference({ diagnosticsEnabled: checked })
                      )}
                    </SettingRow>
                  </Group>
                  {inline('advanced')}
                </AdvancedGroup>
              </>
            )}
          </div>
        </ImmediateSettings>
      </div>
      {workspace && (
        <NexusRuleDialog
          open={editingRules && visible}
          onClose={() => setEditingRules(false)}
          preferences={workspace.preferences}
        />
      )}
    </div>
  )
}
