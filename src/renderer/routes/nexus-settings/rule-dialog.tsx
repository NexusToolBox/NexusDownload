import { zodResolver } from '@hookform/resolvers/zod'
import {
  Banner,
  Button,
  Choice,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Group,
  IconButton,
  Input,
  Item,
  Section,
  Switch,
} from '@renderer/components/desktop-kit/nexus'
import { MoreIcon } from '@renderer/components/icons'
import { toast } from '@renderer/components/ui/toast'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import {
  classificationRuleSchema,
  type NexusPreferences,
} from '@shared/schemas/nexus-workspace'
import { useEffect, useRef, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

const schema = z.object({ rules: z.array(classificationRuleSchema).max(100) })
const fileTypes = [
  'video',
  'software',
  'archive',
  'document',
  'audio',
  'image',
  'other',
] as const
const platforms = [
  'http',
  'magnet',
  'baidu',
  'quark',
  'uc',
  'aliyun',
  '115',
  '123',
] as const
export function NexusRuleDialog({
  open,
  onClose,
  preferences,
}: {
  open: boolean
  onClose(): void
  preferences: NexusPreferences
}) {
  const { t } = useTranslation()
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { rules: preferences.rules },
  })
  const array = useFieldArray({ control: form.control, name: 'rules' })
  const baseline = useRef(preferences.rules)
  baseline.current = preferences.rules
  useEffect(() => {
    if (open) form.reset({ rules: baseline.current })
  }, [open, form])
  const rules = form.watch('rules')
  const [dragged, setDragged] = useState<number | null>(null)
  const saved = useRef(JSON.stringify(preferences.rules))
  const queue = useRef(Promise.resolve(true))
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const persist = () => {
    clearTimeout(timer.current)
    const parsed = schema.safeParse(form.getValues())
    if (!parsed.success) return Promise.resolve(false)
    const values = parsed.data.rules
    const serialized = JSON.stringify(values)
    queue.current = queue.current.then(async () => {
      if (serialized === saved.current) return true
      try {
        await transport.invoke(Commands.NexusUpdatePreferences, {
          rules: values,
        })
        saved.current = serialized
        return true
      } catch {
        toast.add({ type: 'error', title: t('nexus.settings.saveFailed') })
        return false
      }
    })
    return queue.current
  }
  const latestPersist = useRef(persist)
  latestPersist.current = persist
  useEffect(() => {
    if (!open) return
    const subscription = form.watch((_values, { name }) => {
      if (!name) return
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        void latestPersist.current()
      }, 350)
    })
    return () => {
      subscription.unsubscribe()
      void latestPersist.current()
    }
  }, [form, open])
  const close = async () => {
    if (await persist()) onClose()
    else await form.trigger()
  }
  const submit = form.handleSubmit(close)
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) void close()
      }}
    >
      <DialogContent className="nexus-rule-dialog">
        <DialogTitle>{t('nexus.settings.editRules')}</DialogTitle>
        <form onSubmit={submit} className="nx-dialog-form">
          <div className="nexus-rule-editor">
            <Section
              action={
                <Button
                  onClick={() =>
                    array.append({
                      id: crypto.randomUUID(),
                      enabled: true,
                      kind: 'type',
                      value: 'other',
                      directory: t('nexus.settings.fileType.other'),
                    })
                  }
                  disabled={array.fields.length >= 100}
                >
                  {t('nexus.v11.add')}
                </Button>
              }
            >
              {array.fields.map((row, index) => (
                <Group
                  key={row.id}
                  className="mb-3"
                  draggable
                  onDragStart={() => setDragged(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (dragged !== null && dragged !== index)
                      array.move(dragged, index)
                    setDragged(null)
                  }}
                >
                  <Item title={t('nexus.v12.ruleNumber', { index: index + 1 })}>
                    <Switch
                      aria-label={t('nexus.settings.enableRule')}
                      checked={rules[index]?.enabled ?? false}
                      onCheckedChange={(value) =>
                        form.setValue(`rules.${index}.enabled`, value, {
                          shouldDirty: true,
                        })
                      }
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <IconButton aria-label={t('nexus.more')}>
                            <MoreIcon />
                          </IconButton>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={index === 0}
                          onClick={() => array.move(index, index - 1)}
                        >
                          {t('nexus.settings.moveUp')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={index === array.fields.length - 1}
                          onClick={() => array.move(index, index + 1)}
                        >
                          {t('nexus.settings.moveDown')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => array.remove(index)}
                        >
                          {t('nexus.settings.removeRule')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </Item>
                  <Item title={t('nexus.settings.matchBy')}>
                    <Choice
                      label={t('nexus.settings.matchBy')}
                      value={rules[index]?.kind ?? 'type'}
                      choices={['type', 'platform', 'source'].map((value) => ({
                        value,
                        label: t(`nexus.settings.ruleKind.${value}`),
                      }))}
                      onChange={(value) => {
                        form.setValue(
                          `rules.${index}.kind`,
                          value as 'type' | 'platform' | 'source',
                          { shouldDirty: true }
                        )
                        form.setValue(
                          `rules.${index}.value`,
                          value === 'type'
                            ? 'video'
                            : value === 'platform'
                              ? 'http'
                              : '',
                          { shouldDirty: true }
                        )
                      }}
                    />
                  </Item>
                  <Item title={t('nexus.settings.matchValue')}>
                    {rules[index]?.kind === 'source' ? (
                      <Input
                        aria-label={t('nexus.settings.matchValue')}
                        {...form.register(`rules.${index}.value`)}
                        placeholder="example.com"
                      />
                    ) : (
                      <Choice
                        label={t('nexus.settings.matchValue')}
                        value={rules[index]?.value ?? ''}
                        choices={(rules[index]?.kind === 'platform'
                          ? platforms
                          : fileTypes
                        ).map((value) => ({
                          value,
                          label: t(
                            rules[index]?.kind === 'platform'
                              ? `nexus.platform.${value}`
                              : `nexus.settings.fileType.${value}`
                          ),
                        }))}
                        onChange={(value) =>
                          form.setValue(`rules.${index}.value`, value, {
                            shouldDirty: true,
                          })
                        }
                      />
                    )}
                  </Item>
                  <Item title={t('nexus.settings.subdirectory')}>
                    <Input
                      aria-label={t('nexus.settings.subdirectory')}
                      {...form.register(`rules.${index}.directory`)}
                    />
                  </Item>
                </Group>
              ))}
            </Section>
          </div>
          {Object.keys(form.formState.errors).length > 0 && (
            <Banner>{t('nexus.settings.ruleHelp')}</Banner>
          )}
          <DialogFooter>
            <Button
              variant="primary"
              onClick={() => {
                void close()
              }}
            >
              {t('common.close')}
            </Button>{' '}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
