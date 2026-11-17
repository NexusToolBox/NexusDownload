import {
  Item as BaseItem,
  Button,
  Choice,
  Group,
  Input,
  Section,
  Switch,
} from '@renderer/components/desktop-kit/nexus'
import { EndpointList } from '@renderer/components/settings-kit/endpoint-list'
import {
  useSettingsForm,
  useSettingsSubmit,
} from '@renderer/components/settings-kit/use-settings-form'
import {
  SettingsLoadStatus,
  useSettingsLoad,
} from '@renderer/components/settings-kit/use-settings-load'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@renderer/components/ui/form'
import { pickDirty } from '@renderer/lib/form-utils'
import { saveSettings } from '@renderer/lib/settings-save'
import { AdvancedGroup } from '@renderer/routes/nexus-settings/advanced-group'
import {
  DEFAULT_ENGINE_SETTINGS,
  DEFAULT_NAT_SETTINGS,
  DEFAULT_PROXY_SETTINGS,
} from '@shared/schemas'
import {
  portCheckerInputSchema,
  stunServerInputSchema,
} from '@shared/schemas/nat-settings'
import type {
  DnsResolutionMode,
  NatSettings,
  ProxySettings,
} from '@shared/types/settings'
import { useTranslation } from 'react-i18next'
import type { SettingsCardDialogProps } from './card-types'
import { ProxySection } from './proxy-section'
import { networkFormSchema } from './settings-form-schemas'

export interface NetworkFields {
  proxy: ProxySettings
  nat: NatSettings
  engine: { dnsMode: DnsResolutionMode }
}
const DEFAULTS: NetworkFields = {
  proxy: { ...DEFAULT_PROXY_SETTINGS },
  nat: { ...DEFAULT_NAT_SETTINGS },
  engine: { dnsMode: DEFAULT_ENGINE_SETTINGS.dnsMode },
}
export function NetworkDialog({
  onClose,
  advancedContent,
}: SettingsCardDialogProps) {
  const { t } = useTranslation()
  const form = useSettingsForm<NetworkFields>(networkFormSchema, DEFAULTS)
  const load = useSettingsLoad((all) => {
    form.reset({
      proxy: all.proxy,
      nat: all.nat,
      engine: { dnsMode: all.engine.dnsMode },
    })
  })
  const submit = useSettingsSubmit(form, async (values) => {
    if (!load.ready) return
    // biome-ignore lint/suspicious/noExplicitAny: form dirty tree
    const dirty = pickDirty(values, form.formState.dirtyFields as any)
    if (dirty) await saveSettings(dirty)
    onClose()
  })
  const toggle = (
    name:
      | 'proxy.domestic'
      | 'nat.enabled'
      | 'nat.natTypeDetectionEnabled'
      | 'nat.portReachabilityCheckEnabled'
      | 'nat.autoDiagnostic',
    label: string
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <Item title={<FormLabel>{t(label)}</FormLabel>}>
          <FormControl>
            <Switch
              aria-label={t(label)}
              checked={!!field.value}
              onCheckedChange={field.onChange}
            />
          </FormControl>
        </Item>
      )}
    />
  )
  return (
    <div className="nx-inline-settings nx-structured-settings">
      <SettingsLoadStatus {...load} />
      <Form {...form}>
        <fieldset disabled={!load.ready || form.formState.isSubmitting}>
          <ProxySection form={form} />
          <AdvancedGroup>
            <Section title={t('nexus.v152.proxy.scope')}>
              <Group>
                {toggle('proxy.domestic', 'nexus.v152.proxy.domestic')}
              </Group>
            </Section>
            <Section title={t('settings.network.dns.title')}>
              <Group>
                <FormField
                  control={form.control}
                  name="engine.dnsMode"
                  render={({ field }) => (
                    <Item
                      title={
                        <FormLabel>{t('settings.network.dns.mode')}</FormLabel>
                      }
                    >
                      <Choice
                        label={t('settings.network.dns.mode')}
                        value={field.value}
                        choices={(['auto', 'system', 'engine'] as const).map(
                          (value) => ({
                            value,
                            label: t(
                              `settings.network.dns.mode${value[0].toUpperCase()}${value.slice(1)}`
                            ),
                          })
                        )}
                        onChange={field.onChange}
                      />
                    </Item>
                  )}
                />
              </Group>
            </Section>
            <Section title={t('settings.network.nat.title')}>
              <Group>
                {toggle('nat.enabled', 'settings.network.nat.enable')}
                <FormField
                  control={form.control}
                  name="nat.preferredProtocol"
                  render={({ field }) => (
                    <Item
                      title={
                        <FormLabel>
                          {t('settings.network.nat.preferredProtocol')}
                        </FormLabel>
                      }
                    >
                      <Choice
                        label={t('settings.network.nat.preferredProtocol')}
                        value={field.value}
                        choices={['auto', 'pcp', 'natpmp', 'upnp'].map(
                          (value) => ({
                            value,
                            label:
                              value === 'auto'
                                ? t('settings.network.nat.automatic')
                                : value.toUpperCase(),
                          })
                        )}
                        onChange={field.onChange}
                      />
                    </Item>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nat.mappingTtl"
                  render={({ field }) => (
                    <Item
                      title={
                        <FormLabel>
                          {t('settings.network.nat.mappingTtl')}
                        </FormLabel>
                      }
                    >
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min={1200}
                          max={7200}
                          onChange={(event) =>
                            field.onChange(event.target.valueAsNumber)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </Item>
                  )}
                />
              </Group>
            </Section>
            <Section title={t('settings.network.diagnostic.title')}>
              <Group>
                {toggle(
                  'nat.natTypeDetectionEnabled',
                  'settings.network.stun.enable'
                )}
                {toggle(
                  'nat.portReachabilityCheckEnabled',
                  'settings.network.reachability.enable'
                )}
                {toggle(
                  'nat.autoDiagnostic',
                  'settings.network.diagnostic.enable'
                )}
                {form.watch('nat.natTypeDetectionEnabled') && (
                  <Item title={t('settings.network.stun.servers')}>
                    <EndpointList
                      name="nat.stunServers"
                      maxItems={10}
                      itemSchema={stunServerInputSchema}
                      placeholder="stun.example.com:3478"
                      i18nKeys={{
                        addButton: 'settings.network.stun.addServer',
                        empty: 'settings.network.stun.empty',
                      }}
                    />
                  </Item>
                )}
                {form.watch('nat.portReachabilityCheckEnabled') && (
                  <Item title={t('settings.network.reachability.endpoints')}>
                    <EndpointList
                      name="nat.portCheckerEndpoints"
                      maxItems={5}
                      itemSchema={portCheckerInputSchema}
                      placeholder="https://example.com/check"
                      i18nKeys={{
                        addButton: 'settings.network.reachability.addEndpoint',
                        empty: 'settings.network.reachability.empty',
                      }}
                    />
                  </Item>
                )}
                <FormField
                  control={form.control}
                  name="nat.diagnosticIntervalSec"
                  render={({ field }) => (
                    <Item
                      title={
                        <FormLabel>
                          {t('settings.network.diagnostic.interval')}
                        </FormLabel>
                      }
                    >
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min={300}
                          max={86400}
                          onChange={(event) =>
                            field.onChange(event.target.valueAsNumber)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </Item>
                  )}
                />
              </Group>
            </Section>
            {advancedContent}
          </AdvancedGroup>
        </fieldset>
      </Form>
      <div className="nx-inline-footer">
        {form.formState.errors.root?.save && (
          <p role="alert">{form.formState.errors.root.save.message}</p>
        )}
        <Button onClick={submit}>{t('common.save')}</Button>
      </div>
    </div>
  )
}

function Item(props: import('react').ComponentProps<typeof BaseItem>) {
  return (
    <FormItem>
      <BaseItem {...props} />
    </FormItem>
  )
}
