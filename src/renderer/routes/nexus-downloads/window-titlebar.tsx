import { Button } from '@renderer/components/desktop-kit/nexus'
import {
  CloseIcon,
  SubtractIcon,
  WindowMaximizeIcon,
} from '@renderer/components/icons'
import { transport } from '@renderer/lib/transport'
import { Commands } from '@shared/protocol/commands'
import { useTranslation } from 'react-i18next'

export function NexusTitlebar() {
  const { t } = useTranslation()
  return (
    <div className="titlebar app-drag">
      <div className="winctl app-no-drag">
        <Button
          variant="ghost"
          aria-label={t('nexus.window.minimize')}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={() => void transport.invoke(Commands.MinimizeCurrentWindow)}
        >
          <SubtractIcon />
        </Button>
        <Button
          variant="ghost"
          aria-label={t('nexus.window.maximize')}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={() =>
            void transport.invoke(Commands.ToggleMaximizeCurrentWindow)
          }
        >
          <WindowMaximizeIcon />
        </Button>
        <Button
          variant="ghost"
          className="close"
          aria-label={t('nexus.window.close')}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={() => void transport.invoke(Commands.CloseCurrentWindow)}
        >
          <CloseIcon />
        </Button>
      </div>
    </div>
  )
}
