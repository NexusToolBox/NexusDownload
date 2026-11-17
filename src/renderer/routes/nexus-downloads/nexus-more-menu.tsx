import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/desktop-kit/nexus'
import { MoreIcon } from '@renderer/components/icons'
import { openAddTaskDialog } from '@renderer/lib/open-add-task-dialog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { OfflineDownload } from '../nexus-services/offline-download'

import { openNexusAdd } from './nexus-events'

export function NexusMoreMenu({
  taskId,
  source,
}: {
  taskId?: string
  source?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [offlineOpen, setOfflineOpen] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('nexus.more')}
            />
          }
        >
          <MoreIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openNexusAdd()}>
            {t('nexus.inbox')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void openAddTaskDialog()}>
            {t('nexus.advancedAdd')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              navigate(
                `/downloads/all?view=classic${taskId ? `&task=${encodeURIComponent(taskId)}` : ''}`
              )
            }
          >
            {t('nexus.fullTaskTools')}
          </DropdownMenuItem>
          {source && (
            <DropdownMenuItem onClick={() => setOfflineOpen(true)}>
              {t('nexus.remote.use115')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {(
            [
              'dashboard',
              'plugins',
              'trackers',
              'notifications',
              'migration',
            ] as const
          ).map((page) => (
            <DropdownMenuItem key={page} onClick={() => navigate(`/${page}`)}>
              {t(`nexus.tools.${page}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {source && (
        <OfflineDownload
          source={source}
          open={offlineOpen}
          onOpenChange={setOfflineOpen}
        />
      )}
    </>
  )
}
