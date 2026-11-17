import { zodResolver } from '@hookform/resolvers/zod'
import { DirectoryPicker } from '@renderer/components/desktop-kit/directory-picker'
import { Button, Switch } from '@renderer/components/desktop-kit/nexus'
import { SettingsFormRow } from '@renderer/components/settings-kit/settings-form-row'
import { useSettingsSubmit } from '@renderer/components/settings-kit/use-settings-form'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from '@renderer/components/ui/form'
import { Separator } from '@renderer/components/ui/separator'
import {
  DirectoryPreferencesSection,
  DirectoryPreferencesStatus,
} from '@renderer/features/directory-preferences/directory-preferences-section'
import { useByteFormat } from '@renderer/hooks/use-byte-format'
import {
  InlineSettings as Dialog,
  InlineContent as DialogContent,
  InlineDescription as DialogDescription,
  InlineFooter as DialogFooter,
  InlineHeader as DialogHeader,
  InlineTitle as DialogTitle,
} from '@renderer/routes/nexus-settings/inline-settings'
import { createDefaultSpeedLimitSettings } from '@shared/schemas/speed-limit'
import type { ComponentProps } from 'react'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { SettingsCardDialogProps } from './card-types'
import {
  DOWNLOADS_DEFAULTS,
  type DownloadsFields,
  downloadsFormSchema,
  downloadsValidationError,
} from './downloads-form'
import { EngineTuningSection, UserAgentSection } from './engine-tuning-section'
import { PerformanceSection } from './performance-section'
import { SpeedLimitSection } from './speed-limit-section'
import { useDownloadsSettingsDraft } from './use-downloads-settings-draft'

// Form shape, defaults, and unit constants live in ./downloads-form.ts. The
// sections follow the task flow: destinations, new tasks, performance and
// speed limits, then connection and file behavior.

export function DownloadsDialog({
  open,
  onClose,
  labelKey,
}: SettingsCardDialogProps) {
  const { t } = useTranslation()
  const { unitSystem } = useByteFormat()
  const form = useForm<DownloadsFields>({
    defaultValues: {
      ...DOWNLOADS_DEFAULTS,
      speedLimit: createDefaultSpeedLimitSettings(unitSystem),
    },
    resolver: zodResolver(downloadsFormSchema, {
      error: downloadsValidationError(t, unitSystem === 'binary' ? 1024 : 1000),
    }),
    mode: 'onBlur',
  })

  const directories = useDownloadsSettingsDraft(form)
  const contentRef = useRef<HTMLDivElement>(null)
  const [defaultPicking, setDefaultPicking] = useState(false)
  const [favoritePicking, setFavoritePicking] = useState(false)
  const busy = directories.saving || defaultPicking || favoritePicking
  const disabled = busy || directories.loading || !directories.ready
  const close = () => {
    if (!busy) onClose()
  }
  const onSubmit = useSettingsSubmit(form, async () => {
    if (disabled) return
    contentRef.current?.focus({ preventScroll: true })
    if (await directories.save()) onClose()
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(v: boolean, details: { cancel(): void }) => {
        if (!v) {
          if (busy) details.cancel()
          else close()
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
            {t('settings.downloads.description')}
          </DialogDescription>
        </DialogHeader>

        <div>
          <div>
            <div>
              <DirectoryPreferencesStatus
                loading={directories.loading}
                error={directories.error}
                disabled={busy}
                onRetry={() => void directories.refresh()}
              />
              <Form {...form}>
                <form noValidate onSubmit={onSubmit}>
                  <fieldset
                    className="min-w-0 space-y-4"
                    inert={disabled}
                    disabled={disabled}
                  >
                    <h3 className="text-sm font-semibold">
                      {t('settings.downloads.saveFolders')}
                    </h3>
                    <FormField
                      control={form.control}
                      name="app.defaultSaveDir"
                      render={({ field }) => (
                        <FormItem className="space-y-2">
                          <FormLabel>
                            {t('settings.downloads.defaultDownloadFolder')}
                          </FormLabel>
                          <SettingsDirectoryPicker
                            disabled={disabled}
                            recordRecent={false}
                            allowFavoriteEditing={false}
                            onPickingChange={setDefaultPicking}
                            inputProps={{
                              ref: field.ref,
                              onBlur: field.onBlur,
                            }}
                          />
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('directoryPreferences.description')}
                    </p>
                    <DirectoryPreferencesSection
                      preferences={directories.preferences}
                      onChange={directories.setPreferences}
                      disabled={disabled}
                      onPickingChange={setFavoritePicking}
                    />
                    <Separator className="my-4" />
                    <h3 className="text-sm font-semibold">
                      {t('settings.downloads.newTasks')}
                    </h3>
                    <FormField
                      control={form.control}
                      name="app.autofillClipboardLinks"
                      render={({ field }) => (
                        <SettingsFormRow>
                          <div className="space-y-1">
                            <FormLabel>
                              {t('settings.downloads.autofillFromClipboard')}
                            </FormLabel>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              disabled={disabled}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </SettingsFormRow>
                      )}
                    />
                    <UserAgentSection form={form} />
                    <Separator className="my-4" />
                    <PerformanceSection form={form} />
                    <Separator className="my-4" />
                    <SpeedLimitSection form={form} />
                    <Separator className="my-4" />
                    <EngineTuningSection form={form} />
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
            disabled={busy}
            onClick={close}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={disabled || form.formState.isSubmitting}
          >
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SettingsDirectoryPicker({
  inputProps,
  ...props
}: Omit<ComponentProps<typeof DirectoryPicker>, 'name'>) {
  const { formItemId, formMessageId, formDescriptionId, error } = useFormField()
  return (
    <DirectoryPicker
      {...props}
      name="app.defaultSaveDir"
      inputProps={{
        ...inputProps,
        id: formItemId,
        'aria-invalid': Boolean(error),
        'aria-describedby': `${formDescriptionId} ${formMessageId}`,
      }}
    />
  )
}
