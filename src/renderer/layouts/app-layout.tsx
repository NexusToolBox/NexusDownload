import { AddTaskDialogHost } from '@renderer/components/add-task-dialog/add-task-dialog-host'
import { AppSidebar } from '@renderer/components/desktop-kit/sidebar/app-sidebar'
import {
  RendererSubmissionNotice,
  RendererToaster,
} from '@renderer/components/renderer-recovery-notice'
import { SidebarInset, SidebarProvider } from '@renderer/components/ui/sidebar'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { WebConnectionNotice } from '@renderer/components/web-connection-notice'
import { DesktopMenuActions } from '@renderer/features/application-menu/desktop-menu-actions'
import { MenuNavigationFocus } from '@renderer/features/application-menu/navigation-focus'
import { EngineDiagnosticsDialogHost } from '@renderer/features/engine-diagnostics/engine-diagnostics-dialog'
import { OperationDialogHost } from '@renderer/features/plugin-operations/operation-dialog'
import { useEngineRestartRequiredToast } from '@renderer/hooks/use-engine-restart-required-toast'
import { useGraphicsRecoveryToast } from '@renderer/hooks/use-graphics-recovery-toast'
import { useIpcEvent } from '@renderer/hooks/use-ipc-event'
import { useMenuContextSync } from '@renderer/hooks/use-menu-context-sync'
import { useNotificationToasts } from '@renderer/hooks/use-notification-toasts'
import { useToastEvents } from '@renderer/hooks/use-toast-events'
import { useWindowTorrentDrop } from '@renderer/hooks/use-window-torrent-drop'
import { cn } from '@renderer/lib/utils'
import { electronServices } from '@renderer/platform/electron-services'
import { FnosEntry } from '@renderer/platform/fnos-entry'
import { PlatformServicesProvider } from '@renderer/platform/services'
import { webServices } from '@renderer/platform/web-services'
import { RedownloadOverwriteDialogHost } from '@renderer/routes/downloads/inspector/redownload-overwrite-dialog-host'
import { RemoveTasksDialogHost } from '@renderer/routes/downloads/inspector/remove-tasks-dialog-host'
import { RetryParametersDialogHost } from '@renderer/routes/downloads/inspector/retry-parameters-dialog-host'
import { useDownloadsSelection } from '@renderer/routes/downloads/store'
import { useDownloadsView } from '@renderer/routes/downloads/view-preferences'
import { MigrationPage } from '@renderer/routes/migration/migration-page'
import { AccountHealthNotice } from '@renderer/routes/nexus-cloud/account-health-notice'
import { NexusAddHost } from '@renderer/routes/nexus-downloads/add-host'
import { NexusTitlebar } from '@renderer/routes/nexus-downloads/window-titlebar'
import { WorkflowNotice } from '@renderer/routes/nexus-settings/workflow-notice'
import { usePairRequestPrompts } from '@renderer/routes/settings/cards/integration/use-pair-request-prompts'
import { LEGACY_MIGRATION_ROUTE } from '@shared/lib/legacy-import-navigation'
import { isDownloadsListRoute } from '@shared/lib/task-navigation'
import { Events } from '@shared/protocol/events'
import { type ReactNode, useRef } from 'react'
import { useLocation, useNavigate, useOutlet } from 'react-router'

const platformServices =
  __MOTRIX_TARGET__ === 'electron' ? electronServices : webServices

function DesktopMenuContext() {
  useMenuContextSync()
  return <DesktopMenuActions />
}

/** Web only: drop .torrent files on the window to start the Add Task flow. */
function WindowTorrentDrop() {
  useWindowTorrentDrop()
  return null
}

export function AppLayout() {
  useToastEvents()
  usePairRequestPrompts()
  useEngineRestartRequiredToast()
  useGraphicsRecoveryToast()
  useNotificationToasts()

  const navigate = useNavigate()
  const location = useLocation()
  const outlet = useOutlet()
  const migrationActive = location.pathname === LEGACY_MIGRATION_ROUTE
  const settingsActive = /^\/settings(?:\/|$)/.test(location.pathname)
  const retainedSettings = useRef<ReactNode>(null)
  if (settingsActive) retainedSettings.current = outlet
  useIpcEvent(Events.NavigateTo, (...args) => {
    const path = args[0]
    if (typeof path !== 'string' || !path) return
    if (isDownloadsListRoute(path)) {
      // List navigation must not retain a previous task selection or inspector.
      useDownloadsView.getState().setInspectorVisible(false)
      useDownloadsSelection.getState().clearSelection()
    }
    return navigate(path)
  })

  return (
    <TooltipProvider>
      <RendererToaster>
        <PlatformServicesProvider services={platformServices}>
          {__MOTRIX_TARGET__ === 'web' && <FnosEntry />}
          {/* Unconditional bg-sidebar: below the md breakpoint the Sidebar
            renders as a portaled Sheet without data-variant="inset", so the
            wrapper's built-in has-data-[variant=inset]:bg-sidebar stops
            matching and transparent-inset pages would fall through to the
            white body background. */}
          <SidebarProvider
            className={cn(
              'nexus-shell h-svh overflow-hidden bg-sidebar',
              __MOTRIX_TARGET__ === 'web' && 'web-window-chrome',
              __MOTRIX_TARGET__ === 'electron' && 'electron-window-chrome',
              __MOTRIX_TARGET__ === 'electron' &&
                __MOTRIX_PREVIEW_MAC_MENU__ &&
                'preview-desktop-window-controls'
            )}
          >
            <AppSidebar />
            <div className="main">
              <NexusTitlebar />
              <WorkflowNotice />
              <SidebarInset className="panel">
                <RendererSubmissionNotice
                  className="mx-4 mb-2 mt-12"
                  onOpenDownloads={() => void navigate('/downloads/all')}
                />
                <div className="min-h-0 flex-1 overflow-hidden">
                  <div hidden={!migrationActive} className="h-full min-h-0">
                    <MigrationPage active={migrationActive} />
                  </div>
                  <div hidden={!settingsActive} className="h-full min-h-0">
                    {retainedSettings.current}
                  </div>
                  <div
                    hidden={migrationActive || settingsActive}
                    className="h-full min-h-0"
                  >
                    {!settingsActive && outlet}
                  </div>
                </div>
                <WebConnectionNotice />
              </SidebarInset>
            </div>
          </SidebarProvider>
          {__MOTRIX_TARGET__ === 'electron' && <DesktopMenuContext />}
          <MenuNavigationFocus />
          <AccountHealthNotice />
          <NexusAddHost />
          <RemoveTasksDialogHost />
          <RedownloadOverwriteDialogHost />
          <RetryParametersDialogHost />
          <OperationDialogHost />
          <EngineDiagnosticsDialogHost />
          {__MOTRIX_TARGET__ === 'web' && <AddTaskDialogHost />}
          {__MOTRIX_TARGET__ === 'web' && <WindowTorrentDrop />}
        </PlatformServicesProvider>
      </RendererToaster>
    </TooltipProvider>
  )
}
