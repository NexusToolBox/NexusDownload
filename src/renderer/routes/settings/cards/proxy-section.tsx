import {
  Item as BaseItem,
  Group,
  Input,
  Section,
  Segmented,
} from '@renderer/components/desktop-kit/nexus'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@renderer/components/ui/form'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { NetworkFields } from './network-dialog'

export function ProxySection({ form }: { form: UseFormReturn<NetworkFields> }) {
  const { t } = useTranslation()
  const mode =
    form.watch('proxy.mode') ??
    (form.watch('proxy.enabled') ? 'manual' : 'system')
  return (
    <Section title={t('settings.network.proxy.title')}>
      <Group>
        <Item title={t('settings.network.proxy.title')}>
          <FormField
            control={form.control}
            name="proxy.mode"
            render={({ field }) => (
              <FormControl>
                <Segmented
                  label={t('settings.network.proxy.title')}
                  value={mode}
                  choices={['system', 'none', 'manual'].map((value) => ({
                    value,
                    label: t(`nexus.v152.proxy.${value}`),
                  }))}
                  onChange={(value) => {
                    form.setValue('proxy.enabled', value === 'manual', {
                      shouldDirty: true,
                    })
                    form.setValue(
                      'proxy.scopes',
                      {
                        download: true,
                        updateApp: true,
                        updateTrackers: true,
                        plugins: true,
                      },
                      { shouldDirty: true }
                    )
                    field.onChange(value)
                  }}
                />
              </FormControl>
            )}
          />
        </Item>
        {mode === 'manual' && (
          <>
            <FormField
              control={form.control}
              name="proxy.protocol"
              render={({ field }) => (
                <Item title={t('settings.network.proxy.protocol')}>
                  <Segmented
                    label={t('settings.network.proxy.protocol')}
                    value={field.value}
                    choices={['http', 'https', 'socks5'].map((value) => ({
                      value,
                      label: value.toUpperCase(),
                    }))}
                    onChange={field.onChange}
                  />
                </Item>
              )}
            />
            {(['host', 'port', 'user', 'password'] as const).map((name) => (
              <FormField
                key={name}
                control={form.control}
                name={`proxy.${name}`}
                render={({ field }) => (
                  <Item
                    title={
                      <FormLabel>
                        {t(
                          `settings.network.proxy.${name === 'host' ? 'server' : name}`
                        )}
                      </FormLabel>
                    }
                  >
                    <FormControl>
                      <Input
                        {...field}
                        aria-label={t(
                          `settings.network.proxy.${name === 'host' ? 'server' : name}`
                        )}
                        type={
                          name === 'password'
                            ? 'password'
                            : name === 'port'
                              ? 'number'
                              : 'text'
                        }
                        value={field.value}
                        onChange={(event) =>
                          field.onChange(
                            name === 'port'
                              ? event.target.valueAsNumber
                              : event.target.value
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </Item>
                )}
              />
            ))}
            <FormField
              control={form.control}
              name="proxy.bypass"
              render={({ field }) => (
                <Item
                  title={
                    <FormLabel>{t('settings.network.proxy.bypass')}</FormLabel>
                  }
                >
                  <FormControl>
                    <Input
                      aria-label={t('settings.network.proxy.bypass')}
                      value={field.value.join(',')}
                      onChange={(event) =>
                        field.onChange(
                          event.target.value
                            .split(',')
                            .map((value) => value.trim())
                            .filter(Boolean)
                        )
                      }
                    />
                  </FormControl>
                  <FormMessage>
                    {form.formState.errors.proxy?.bypass?.[0]?.message}
                  </FormMessage>
                </Item>
              )}
            />
          </>
        )}
      </Group>
    </Section>
  )
}

function Item(props: import('react').ComponentProps<typeof BaseItem>) {
  return (
    <FormItem>
      <BaseItem {...props} />
    </FormItem>
  )
}
