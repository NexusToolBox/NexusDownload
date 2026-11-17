import { Button, Item } from '@renderer/components/desktop-kit/nexus'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import type { NexusSnapshot } from '@shared/schemas/nexus-workspace'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function ShortcutSetting({
  workspace,
  disabled,
}: {
  workspace: NexusSnapshot | null
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [recording, setRecording] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const current = workspace?.preferences.globalShortcut ?? 'Alt+D'
  const stop = () => {
    setRecording(false)
    void transport
      .invoke(Commands.NexusShortcutCapture, false)
      .catch(() => undefined)
  }
  useEffect(
    () => () => {
      void transport
        .invoke(Commands.NexusShortcutCapture, false)
        .catch(() => undefined)
    },
    []
  )
  const save = async (value: string) => {
    setBusy(true)
    setInvalid(false)
    try {
      await transport.invoke(Commands.NexusUpdatePreferences, {
        globalShortcut: value,
      })
    } catch {
      setInvalid(true)
    } finally {
      stop()
      setBusy(false)
    }
  }
  return (
    <Item
      title={t('nexus.v151.shortcut.setting')}
      description={
        invalid
          ? t('nexus.v151.shortcut.invalid')
          : workspace?.shortcutRegistered === false
            ? t('nexus.v151.shortcut.conflict')
            : t('nexus.v152.shortcutHelp')
      }
    >
      <div className="flex gap-2 items-center" data-shortcut-capture>
        <Button
          data-testid="shortcut-capture"
          aria-label={t('nexus.v151.shortcut.setting')}
          aria-pressed={recording}
          aria-invalid={invalid || workspace?.shortcutRegistered === false}
          disabled={disabled || busy}
          onClick={() => {
            setInvalid(false)
            void transport
              .invoke(Commands.NexusShortcutCapture, true)
              .then(() => setRecording(true))
              .catch(() => setInvalid(true))
          }}
          onBlur={stop}
          onKeyDown={(event) => {
            if (!recording) return
            event.preventDefault()
            event.stopPropagation()
            if (event.key === 'Escape') {
              stop()
              return
            }
            if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
            const modifiers = [
              event.ctrlKey && 'Ctrl',
              event.altKey && 'Alt',
              event.shiftKey && 'Shift',
              event.metaKey && 'Super',
            ].filter(Boolean)
            const key =
              event.key === ' ' ? 'Space' : event.key.replace(/^Arrow/, '')
            if (
              !modifiers.length ||
              !/^(?:[a-z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Home|End|PageUp|PageDown|Insert|Delete|Up|Down|Left|Right)$/i.test(
                key
              )
            ) {
              setInvalid(true)
              return
            }
            void save(
              [...modifiers, key.length === 1 ? key.toUpperCase() : key].join(
                '+'
              )
            )
          }}
        >
          {recording
            ? t('nexus.v151.shortcut.capture')
            : current || t('nexus.v151.shortcut.off')}
        </Button>
        {current && (
          <Button
            variant="quiet"
            disabled={disabled || busy}
            onClick={() => void save('')}
          >
            {t('nexus.v151.shortcut.clear')}
          </Button>
        )}
      </div>
    </Item>
  )
}
