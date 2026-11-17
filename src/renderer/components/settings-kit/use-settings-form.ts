import { zodResolver } from '@hookform/resolvers/zod'
import { settingsValidationError } from '@renderer/lib/settings-validation'
import { useContext, useEffect, useRef } from 'react'
import {
  type DefaultValues,
  type FieldValues,
  type Resolver,
  type SubmitHandler,
  type UseFormReturn,
  useForm,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'
import { ImmediateSettingsContext } from './immediate-settings'

export function useSettingsForm<Values extends FieldValues>(
  schema: z.ZodType<Values, Values>,
  defaultValues: DefaultValues<Values>
) {
  const { t } = useTranslation()
  return useForm<Values>({
    defaultValues,
    resolver: zodResolver(schema, {
      error: settingsValidationError(t, schema),
    }) as Resolver<Values>,
    mode: 'onBlur',
  })
}

export function useSettingsSubmit<Values extends FieldValues>(
  form: UseFormReturn<Values>,
  save: SubmitHandler<Values>
) {
  const { t } = useTranslation()
  const immediate = useContext(ImmediateSettingsContext)
  const submit = form.handleSubmit(
    async (values, event) => {
      form.clearErrors('root.save')
      try {
        await save(values, event)
      } catch {
        form.setError('root.save', {
          type: 'server',
          message: t('settings.validation.saveFailed'),
        })
      }
    },
    () => form.clearErrors('root.save')
  )
  const latest = useRef(submit)
  latest.current = submit
  useEffect(() => {
    if (!immediate) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending = Promise.resolve()
    const flush = () => {
      timer = undefined
      pending = pending.then(() => latest.current())
    }
    const subscription = form.watch((_values, { name }) => {
      if (!name) return
      clearTimeout(timer)
      timer = setTimeout(flush, 350)
    })
    return () => {
      subscription.unsubscribe()
      if (timer) {
        clearTimeout(timer)
        flush()
      }
    }
  }, [form, immediate])
  return submit
}
