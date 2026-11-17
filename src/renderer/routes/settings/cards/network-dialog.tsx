import { Button, Input, Switch } from '@renderer/components/desktop-kit/nexus'
import { EndpointList } from '@renderer/components/settings-kit/endpoint-list'
import { SettingsFormRow } from '@renderer/components/settings-kit/settings-form-row'
import { SettingsSelectTrigger } from '@renderer/components/settings-kit/settings-select-trigger'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
import { Separator } from '@renderer/components/ui/separator'
import { pickDirty } from '@renderer/lib/form-utils'
import { saveSettings } from '@renderer/lib/settings-save'
import { transport } from '@renderer/lib/transport'
import { AdvancedGroup } from '@renderer/routes/nexus-settings/advanced-group'
import {
  InlineSettings as Dialog,
  InlineContent as DialogContent,
  InlineDescription as DialogDescription,
  InlineFooter as DialogFooter,
  InlineHeader as DialogHeader,
  InlineTitle as DialogTitle,
} from '@renderer/routes/nexus-settings/inline-settings'
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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SettingsCardDialogProps } from './card-types'
import { ProxySection } from './proxy-section'
import { networkFormSchema } from './settings-form-schemas'

export interface NetworkFields {
  proxy: ProxySettings
  nat: NatSettings
  // Only the DNS slice of EngineSettings is edited here; the rest of the
  // engine namespace stays with the Downloads dialog.
  engine: { dnsMode: DnsResolutionMode }
}

// Source of truth: src/shared/schemas/{proxy,nat,engine}-settings.ts.
// Keep in sync with the corresponding DEFAULT_* exports.
const DEFAULTS: NetworkFields = {
  proxy: { ...DEFAULT_PROXY_SETTINGS },
  nat: { ...DEFAULT_NAT_SETTINGS },
  engine: { dnsMode: DEFAULT_ENGINE_SETTINGS.dnsMode },
}

const NAT_PROTOCOL_OPTIONS = [
  { label: 'auto', value: 'auto' },
  { label: 'PCP', value: 'pcp' },
  { label: 'NAT-PMP', value: 'natpmp' },
  { label: 'UPnP', value: 'upnp' },
] as const satisfies ReadonlyArray<{
  label: string
  value: NatSettings['preferredProtocol']
}>

export function NetworkDialog({
  open,
  onClose,
  labelKey,
  advancedContent,
}: SettingsCardDialogProps) {
  const { t } = useTranslation()
  const form = useSettingsForm<NetworkFields>(networkFormSchema, DEFAULTS)
  const diagnosticSwitches = form.watch([
    'nat.natTypeDetectionEnabled',
    'nat.portReachabilityCheckEnabled',
    'nat.autoDiagnostic',
  ])
  const [revealedDiagnosticFields, setRevealedDiagnosticFields] = useState({
    stun: false,
    ports: false,
    interval: false,
  })
  const natErrors = form.formState.errors.nat
  const stunFieldsInvalid = Boolean(natErrors?.stunServers)
  const portFieldsInvalid = Boolean(natErrors?.portCheckerEndpoints)
  const intervalInvalid = Boolean(natErrors?.diagnosticIntervalSec)

  // Keep invalid dependent fields visible while the user corrects them.
  useEffect(() => {
    if (stunFieldsInvalid || portFieldsInvalid || intervalInvalid) {
      setRevealedDiagnosticFields((previous) => ({
        stun: previous.stun || stunFieldsInvalid,
        ports: previous.ports || portFieldsInvalid,
        interval: previous.interval || intervalInvalid,
      }))
    }
  }, [stunFieldsInvalid, portFieldsInvalid, intervalInvalid])

  const dnsModeOptions = [
    { value: 'auto', label: t('settings.network.dns.modeAuto') },
    { value: 'system', label: t('settings.network.dns.modeSystem') },
    { value: 'engine', label: t('settings.network.dns.modeEngine') },
  ] as const

  const load = useSettingsLoad((all) => {
    if (!all?.proxy || !all.nat) throw new Error('Missing settings baseline')
    if (all?.proxy && all?.nat) {
      form.reset({
        proxy: all.proxy,
        nat: all.nat,
        engine: {
          dnsMode: all.engine?.dnsMode ?? DEFAULT_ENGINE_SETTINGS.dnsMode,
        },
      })
    }
  })

  const onSubmit = useSettingsSubmit(form, async (values) => {
    if (!load.ready) return
    // biome-ignore lint/suspicious/noExplicitAny: dirtyFields shape doesn't fit DirtyTree; cast is safe
    const dirty = pickDirty(values, form.formState.dirtyFields as any)
    if (!dirty) {
      onClose()
      return
    }
    await saveSettings(dirty)
    onClose()
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(v: boolean, details: { cancel(): void }) => {
        if (!v) {
          if (form.formState.isSubmitting) details.cancel()
          else onClose()
        }
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[700px]"
        initialFocus={false}
      >
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle>{t(labelKey)}</DialogTitle>
          <DialogDescription>
            {t('settings.network.description')}
          </DialogDescription>
        </DialogHeader>

        <div>
          <div>
            <div>
              <SettingsLoadStatus {...load} />
              <Form {...form}>
                <div>
                  <fieldset
                    inert={!load.ready || form.formState.isSubmitting}
                    disabled={!load.ready || form.formState.isSubmitting}
                    className="min-w-0 space-y-4"
                  >
                    <ProxySection form={form} />
                    <AdvancedGroup>
                      <Separator className="my-4" />

                      {/* DNS resolution */}
                      <h3 className="text-sm font-semibold text-foreground">
                        {t('settings.network.dns.title')}
                      </h3>
                      <FormField
                        control={form.control}
                        name="engine.dnsMode"
                        render={({ field }) => (
                          <SettingsFormRow className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                            <div className="min-w-0 flex-1 space-y-1">
                              <FormLabel>
                                {t('settings.network.dns.mode')}
                              </FormLabel>
                            </div>
                            <FormControl>
                              <Select
                                items={dnsModeOptions}
                                value={field.value}
                                onValueChange={(value) => {
                                  if (value !== null) field.onChange(value)
                                }}
                              >
                                <SettingsSelectTrigger>
                                  <SelectValue />
                                </SettingsSelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    {dnsModeOptions.map(({ label, value }) => (
                                      <SelectItem key={value} value={value}>
                                        {label}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </FormControl>
                          </SettingsFormRow>
                        )}
                      />

                      <Separator className="my-4" />

                      {/* NAT mapping */}
                      {transport.platform !== 'web' && (
                        <>
                          <h3 className="text-sm font-semibold text-foreground">
                            {t('settings.network.nat.title')}
                          </h3>

                          <FormField
                            control={form.control}
                            name="nat.enabled"
                            render={({ field }) => (
                              <SettingsFormRow>
                                <div className="space-y-1">
                                  <FormLabel>
                                    {t('settings.network.nat.enable')}
                                  </FormLabel>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                              </SettingsFormRow>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="nat.preferredProtocol"
                            render={({ field }) => (
                              <SettingsFormRow>
                                <FormLabel>
                                  {t('settings.network.nat.preferredProtocol')}
                                </FormLabel>
                                <FormControl>
                                  <Select
                                    items={NAT_PROTOCOL_OPTIONS.map(
                                      (option) => ({
                                        ...option,
                                        label:
                                          option.value === 'auto'
                                            ? t(
                                                'settings.network.nat.automatic'
                                              )
                                            : option.label,
                                      })
                                    )}
                                    value={field.value}
                                    onValueChange={(value) => {
                                      if (value !== null) field.onChange(value)
                                    }}
                                  >
                                    <SelectTrigger className="w-30" size="sm">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectGroup>
                                        {NAT_PROTOCOL_OPTIONS.map((option) => (
                                          <SelectItem
                                            key={option.value}
                                            value={option.value}
                                          >
                                            {option.value === 'auto'
                                              ? t(
                                                  'settings.network.nat.automatic'
                                                )
                                              : option.label}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                              </SettingsFormRow>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="nat.mappingTtl"
                            render={({ field }) => (
                              <SettingsFormRow>
                                <FormLabel>
                                  {t('settings.network.nat.mappingTtl')}
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    type="number"
                                    min={1200}
                                    max={7200}
                                    className="w-30 h-8"
                                    value={
                                      Number.isFinite(field.value)
                                        ? field.value
                                        : ''
                                    }
                                    onChange={(event) =>
                                      field.onChange(event.target.valueAsNumber)
                                    }
                                  />
                                </FormControl>
                              </SettingsFormRow>
                            )}
                          />

                          <Separator className="my-4" />

                          <h3 className="text-sm font-semibold text-foreground">
                            {t('settings.network.diagnostics')}
                          </h3>
                          <div className="space-y-4">
                            <div className="space-y-3">
                              <FormField
                                control={form.control}
                                name="nat.natTypeDetectionEnabled"
                                render={({ field }) => (
                                  <SettingsFormRow>
                                    <div className="space-y-1">
                                      <FormLabel>
                                        {t('settings.network.stun.enable')}
                                      </FormLabel>
                                    </div>
                                    <FormControl>
                                      <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                      />
                                    </FormControl>
                                  </SettingsFormRow>
                                )}
                              />
                              <div
                                hidden={
                                  !diagnosticSwitches[0] &&
                                  !stunFieldsInvalid &&
                                  !revealedDiagnosticFields.stun
                                }
                                className="border-s border-border/60 ps-4"
                              >
                                <FormField
                                  control={form.control}
                                  name="nat.stunServers"
                                  render={() => (
                                    <FormItem className="space-y-2">
                                      <FormLabel>
                                        {t('settings.network.stun.servers')}
                                      </FormLabel>
                                      <EndpointList
                                        name="nat.stunServers"
                                        maxItems={10}
                                        itemSchema={stunServerInputSchema}
                                        placeholder="stun.example.com:3478"
                                        i18nKeys={{
                                          addButton:
                                            'settings.network.stun.addServer',
                                          empty: 'settings.network.stun.empty',
                                        }}
                                      />
                                      <FormMessage className="basis-full text-xs" />
                                    </FormItem>
                                  )}
                                />
                              </div>
                            </div>

                            <div className="space-y-3">
                              <FormField
                                control={form.control}
                                name="nat.portReachabilityCheckEnabled"
                                render={({ field }) => (
                                  <SettingsFormRow>
                                    <div className="space-y-1">
                                      <FormLabel>
                                        {t(
                                          'settings.network.reachability.enable'
                                        )}
                                      </FormLabel>
                                    </div>
                                    <FormControl>
                                      <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                      />
                                    </FormControl>
                                  </SettingsFormRow>
                                )}
                              />
                              <div
                                hidden={
                                  !diagnosticSwitches[1] &&
                                  !portFieldsInvalid &&
                                  !revealedDiagnosticFields.ports
                                }
                                className="border-s border-border/60 ps-4"
                              >
                                <FormField
                                  control={form.control}
                                  name="nat.portCheckerEndpoints"
                                  render={() => (
                                    <FormItem className="space-y-2">
                                      <FormLabel>
                                        {t(
                                          'settings.network.reachability.endpoints'
                                        )}
                                      </FormLabel>
                                      <EndpointList
                                        name="nat.portCheckerEndpoints"
                                        maxItems={5}
                                        itemSchema={portCheckerInputSchema}
                                        placeholder="https://example.com/check"
                                        i18nKeys={{
                                          addButton:
                                            'settings.network.reachability.addEndpoint',
                                          empty:
                                            'settings.network.reachability.empty',
                                        }}
                                      />
                                      <FormMessage className="basis-full text-xs" />
                                    </FormItem>
                                  )}
                                />
                              </div>
                            </div>

                            <Separator />

                            <div className="space-y-3">
                              <FormField
                                control={form.control}
                                name="nat.autoDiagnostic"
                                render={({ field }) => (
                                  <SettingsFormRow>
                                    <div className="space-y-1">
                                      <FormLabel>
                                        {t(
                                          'settings.network.diagnostic.enable'
                                        )}
                                      </FormLabel>
                                    </div>
                                    <FormControl>
                                      <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                      />
                                    </FormControl>
                                  </SettingsFormRow>
                                )}
                              />
                              <div
                                hidden={
                                  !diagnosticSwitches[2] &&
                                  !intervalInvalid &&
                                  !revealedDiagnosticFields.interval
                                }
                                className="border-s border-border/60 ps-4"
                              >
                                <FormField
                                  control={form.control}
                                  name="nat.diagnosticIntervalSec"
                                  render={({ field }) => (
                                    <SettingsFormRow>
                                      <FormLabel>
                                        {t(
                                          'settings.network.diagnostic.interval'
                                        )}
                                      </FormLabel>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          min={300}
                                          max={86400}
                                          className="w-30 h-8"
                                          value={
                                            Number.isFinite(field.value)
                                              ? field.value
                                              : ''
                                          }
                                          onChange={(event) =>
                                            field.onChange(
                                              event.target.valueAsNumber
                                            )
                                          }
                                        />
                                      </FormControl>
                                    </SettingsFormRow>
                                  )}
                                />
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                      {advancedContent}
                    </AdvancedGroup>
                  </fieldset>
                </div>
              </Form>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
          {form.formState.errors.root?.save && (
            <p role="alert" className="me-auto text-xs text-destructive">
              {form.formState.errors.root.save.message}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={form.formState.isSubmitting}
            onClick={onClose}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={!load.ready || form.formState.isSubmitting}
          >
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
