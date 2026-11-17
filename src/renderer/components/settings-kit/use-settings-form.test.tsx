import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ImmediateSettings } from './immediate-settings'
import { useSettingsForm, useSettingsSubmit } from './use-settings-form'

const schema = z.object({ name: z.string().min(2) })
function Editor({ save }: { save(value: { name: string }): Promise<void> }) {
  const form = useSettingsForm(schema, { name: 'initial' })
  useSettingsSubmit(form, save)
  return (
    <>
      <input aria-label="name" {...form.register('name')} />
      {form.formState.errors.root?.save && (
        <p role="alert">{form.formState.errors.root.save.message}</p>
      )}
    </>
  )
}
it('coalesces changes, validates them, and flushes when switching sections', async () => {
  const save = vi.fn(async () => {})
  const view = render(
    <ImmediateSettings>
      <Editor save={save} />
    </ImmediateSettings>
  )
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a' } })
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)))
  expect(save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'second' } })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'latest' } })
  view.unmount()
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ name: 'latest' }, undefined)
  )
  expect(save).toHaveBeenCalledOnce()
})
it('keeps a failed change editable and retries after another edit', async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue(undefined)
  render(
    <ImmediateSettings>
      <Editor save={save} />
    </ImmediateSettings>
  )
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'second' } })
  expect(await screen.findByRole('alert')).toBeVisible()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'retry' } })
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})
