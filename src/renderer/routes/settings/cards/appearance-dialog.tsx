import { Button, Switch } from '@renderer/components/desktop-kit/nexus'
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
  FormLabel,
} from '@renderer/components/ui/form'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectValue,
} from '@renderer/components/ui/select'
import { Separator } from '@renderer/components/ui/separator'
import { useByteFormat } from '@renderer/hooks/use-byte-format'
import { pickDirty } from '@renderer/lib/form-utils'
import { saveSettings } from '@renderer/lib/settings-save'
import { useSidebarColorState } from '@renderer/lib/sidebar-color'
import { transport } from '@renderer/lib/transport'
import {
  InlineSettings as Dialog,
  InlineContent as DialogContent,
  InlineDescription as DialogDescription,
  InlineFooter as DialogFooter,
  InlineHeader as DialogHeader,
  InlineTitle as DialogTitle,
} from '@renderer/routes/nexus-settings/inline-settings'
import { SUPPORTED_LOCALES } from '@shared/constants/locales'
import { DEFAULT_APP_SETTINGS } from '@shared/schemas'
import { resolveByteUnitSystem } from '@shared/schemas/byte-unit-system'
import type { MotrixAppSettings } from '@shared/types/settings'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { SettingsCardDialogProps } from './card-types'
import { appearanceFormSchema } from './settings-form-schemas'
import { SidebarColorPicker } from './sidebar-color-picker'

type AppearanceFields = Pick<
  MotrixAppSettings,
  | 'theme'
  | 'sidebarColor'
  | 'reduceMotion'
  | 'hardwareAcceleration'
  | 'language'
  | 'byteUnitSystem'
  | 'traySpeedometer'
  | 'showDownloadProgress'
  | 'trayIconColor'
  | 'liquidGlassEffect'
>

// Source of truth: src/shared/schemas/app-settings.ts (DEFAULT_APP_SETTINGS).
// Defaults are sourced from the schema; the renderer mirrors the subset of
// fields it edits. Keep this Pick<> in sync if the schema fields change.
const DEFAULTS: AppearanceFields = {
  theme: DEFAULT_APP_SETTINGS.theme,
  sidebarColor: DEFAULT_APP_SETTINGS.sidebarColor,
  reduceMotion: DEFAULT_APP_SETTINGS.reduceMotion,
  hardwareAcceleration: DEFAULT_APP_SETTINGS.hardwareAcceleration,
  language: DEFAULT_APP_SETTINGS.language,
  byteUnitSystem: DEFAULT_APP_SETTINGS.byteUnitSystem,
  traySpeedometer: DEFAULT_APP_SETTINGS.traySpeedometer,
  showDownloadProgress: DEFAULT_APP_SETTINGS.showDownloadProgress,
  trayIconColor: DEFAULT_APP_SETTINGS.trayIconColor,
  liquidGlassEffect: DEFAULT_APP_SETTINGS.liquidGlassEffect,
}

const LANGUAGE_OPTIONS = SUPPORTED_LOCALES.map(({ code, nativeName }) => ({
  value: code,
  label: nativeName,
})) satisfies Array<{
  value: AppearanceFields['language']
  label: string
}>

export function AppearanceDialog({
  open,
  onClose,
  labelKey,
}: SettingsCardDialogProps) {
  const { t } = useTranslation()
  const _languageOptions = [
    { value: 'system', label: t('settings.appearance.followSystem') },
    ...LANGUAGE_OPTIONS,
  ]
  const form = useSettingsForm<AppearanceFields>(appearanceFormSchema, DEFAULTS)

  const load = useSettingsLoad((all) => {
    if (!all?.app) throw new Error('Missing settings baseline')
    if (all?.app) {
      form.reset({
        theme: all.app.theme,
        sidebarColor: all.app.sidebarColor ?? DEFAULTS.sidebarColor,
        reduceMotion: all.app.reduceMotion ?? DEFAULTS.reduceMotion,
        hardwareAcceleration:
          all.app.hardwareAcceleration ?? DEFAULTS.hardwareAcceleration,
        language: all.app.language,
        byteUnitSystem: all.app.byteUnitSystem ?? DEFAULTS.byteUnitSystem,
        traySpeedometer: all.app.traySpeedometer,
        showDownloadProgress:
          all.app.showDownloadProgress ?? DEFAULTS.showDownloadProgress,
        trayIconColor: all.app.trayIconColor ?? DEFAULTS.trayIconColor,
        liquidGlassEffect: all.app.liquidGlassEffect,
      })
    }
  })

  const sidebarColor = form.watch('sidebarColor')
  const colorIsDirty = !!form.formState.dirtyFields.sidebarColor
  useEffect(() => {
    useSidebarColorState.setState({
      preview: open && colorIsDirty ? sidebarColor : null,
    })
    return () => useSidebarColorState.setState({ preview: null })
  }, [open, colorIsDirty, sidebarColor])

  const onSubmit = useSettingsSubmit(form, async (values) => {
    if (!load.ready) return
    const dirty = pickDirty(values, form.formState.dirtyFields)
    if (!dirty) {
      onClose()
      return
    }
    await saveSettings({ app: dirty })
    if (dirty.sidebarColor !== undefined) {
      useSidebarColorState.setState((state) => ({
        saved: dirty.sidebarColor,
        revision: state.revision + 1,
      }))
    }
    onClose()
  })

  const { formatByteUnit } = useByteFormat()
  const systemUnits = resolveByteUnitSystem(
    'system',
    transport.platform === 'web' ? navigator.platform : transport.platform
  )
  const byteUnitOptions = [
    {
      value: 'system',
      label: t('settings.appearance.byteUnitSystemDefault', {
        units: (systemUnits === 'binary'
          ? [formatByteUnit('MiB'), formatByteUnit('GiB')]
          : [formatByteUnit('MB'), formatByteUnit('GB')]
        ).join(', '),
      }),
    },
    {
      value: 'decimal',
      label: t('settings.appearance.byteUnitDecimal', {
        megabyte: formatByteUnit('MB'),
        gigabyte: formatByteUnit('GB'),
      }),
    },
    {
      value: 'binary',
      label: t('settings.appearance.byteUnitBinary', {
        megabyte: formatByteUnit('MiB'),
        gigabyte: formatByteUnit('GiB'),
      }),
    },
  ] satisfies Array<{
    value: AppearanceFields['byteUnitSystem']
    label: string
  }>

  const themeOptions = [
    {
      value: 'system',
      label: t('settings.appearance.themeAuto'),
    },
    {
      value: 'light',
      label: t('settings.appearance.themeLight'),
    },
    {
      value: 'dark',
      label: t('settings.appearance.themeDark'),
    },
  ] satisfies Array<{
    value: AppearanceFields['theme']
    label: string
  }>
  const isMac = transport.platform === 'darwin'
  const isWindows = transport.platform === 'win32'
  const isLinux = transport.platform === 'linux'
  const trayIconColorOptions = [
    { value: 'auto', label: t('settings.appearance.trayIconColorAuto') },
    { value: 'light', label: t('settings.appearance.trayIconColorLight') },
    { value: 'dark', label: t('settings.appearance.trayIconColorDark') },
  ] satisfies Array<{ value: AppearanceFields['trayIconColor']; label: string }>

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
            {t('settings.appearance.description')}
          </DialogDescription>
        </DialogHeader>

        <div>
          <div>
            <div>
              <SettingsLoadStatus {...load} />
              <Form {...form}>
                <form noValidate onSubmit={onSubmit}>
                  <fieldset
                    inert={!load.ready || form.formState.isSubmitting}
                    disabled={!load.ready || form.formState.isSubmitting}
                    className="min-w-0 space-y-4"
                  >
                    <h3 className="text-sm font-semibold">
                      {t('settings.appearance.themeAndEffects')}
                    </h3>
                    <FormField
                      control={form.control}
                      name="theme"
                      render={({ field }) => (
                        <SettingsFormRow>
                          <FormLabel>
                            {t('settings.appearance.theme')}
                          </FormLabel>
                          <FormControl>
                            <Select
                              items={themeOptions}
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
                                  {themeOptions.map((option) => (
                                    <SelectItem
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
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
                      name="sidebarColor"
                      render={({ field }) => (
                        <SettingsFormRow className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                          <FormLabel className="sm:pt-2">
                            {t('settings.appearance.sidebarColor')}
                          </FormLabel>
                          <FormControl>
                            <SidebarColorPicker
                              value={field.value}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                              disabled={
                                !load.ready || form.formState.isSubmitting
                              }
                            />
                          </FormControl>
                        </SettingsFormRow>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="reduceMotion"
                      render={({ field }) => (
                        <SettingsFormRow>
                          <div className="space-y-1">
                            <FormLabel>
                              {t('settings.appearance.reduceMotion')}
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
                    {isMac && (
                      <FormField
                        control={form.control}
                        name="liquidGlassEffect"
                        render={({ field }) => (
                          <SettingsFormRow>
                            <div className="space-y-1">
                              <FormLabel>
                                {t('settings.appearance.liquidGlassEffect')}
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
                    )}
                    {transport.platform !== 'web' && (
                      <FormField
                        control={form.control}
                        name="hardwareAcceleration"
                        render={({ field }) => (
                          <SettingsFormRow>
                            <div className="space-y-1">
                              <FormLabel>
                                {t('settings.appearance.hardwareAcceleration')}
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
                    )}
                    <Separator className="my-4" />
                    <h3 className="text-sm font-semibold">
                      {t('nexus.settings.appearanceOptions')}
                    </h3>
                    <FormField
                      control={form.control}
                      name="byteUnitSystem"
                      render={({ field }) => (
                        <SettingsFormRow>
                          <div className="space-y-1">
                            <FormLabel>
                              {t('settings.appearance.byteUnitSystem')}
                            </FormLabel>
                          </div>
                          <FormControl>
                            <Select
                              items={byteUnitOptions}
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
                                  {byteUnitOptions.map((option) => (
                                    <SelectItem
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </FormControl>
                        </SettingsFormRow>
                      )}
                    />
                    {(isMac || isWindows || isLinux) && (
                      <>
                        <Separator className="my-4" />
                        <h3 className="text-sm font-semibold">
                          {t(
                            isMac
                              ? 'settings.appearance.dockAndMenuBar'
                              : isWindows
                                ? 'settings.appearance.taskbar'
                                : 'settings.appearance.menuBar'
                          )}
                        </h3>
                      </>
                    )}
                    {isLinux && (
                      <FormField
                        control={form.control}
                        name="trayIconColor"
                        render={({ field }) => (
                          <SettingsFormRow>
                            <div className="space-y-1">
                              <FormLabel>
                                {t('settings.appearance.trayIconColor')}
                              </FormLabel>
                            </div>
                            <FormControl>
                              <Select
                                items={trayIconColorOptions}
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
                                    {trayIconColorOptions.map((option) => (
                                      <SelectItem
                                        key={option.value}
                                        value={option.value}
                                      >
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </FormControl>
                          </SettingsFormRow>
                        )}
                      />
                    )}
                    {(isMac || isWindows) && (
                      <FormField
                        control={form.control}
                        name="showDownloadProgress"
                        render={({ field }) => (
                          <SettingsFormRow>
                            <div className="space-y-1">
                              <FormLabel>
                                {t(
                                  isMac
                                    ? 'settings.appearance.dockProgress'
                                    : 'settings.appearance.taskbarProgress'
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
                    )}
                    {isMac && (
                      <FormField
                        control={form.control}
                        name="traySpeedometer"
                        render={({ field }) => (
                          <SettingsFormRow>
                            <div className="space-y-1">
                              <FormLabel>
                                {t('settings.appearance.traySpeedometer')}
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
                    )}
                  </fieldset>
                </form>
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
