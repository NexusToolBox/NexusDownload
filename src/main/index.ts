import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { homedir, release as osRelease } from 'node:os'
import path from 'node:path'
import { TaskActivityService, TaskActivityStore } from '@core/activity'
import { createDownloadDirectories } from '@core/bridge-receiver/download-directories'
import { HlsDashPipeline } from '@core/bridge-receiver/pipelines/hls-dash-pipeline'
import { MuxPipeline } from '@core/bridge-receiver/pipelines/mux-pipeline'
import { Aria2SegmentClient } from '@core/download/aria2-segment-client'
import { SegmentDownloader } from '@core/download/segment-downloader'
import { Aria2Adapter } from '@core/engine/aria2/aria2-adapter'
import { Aria2ConfigBuilder } from '@core/engine/aria2/aria2-config-builder'
import { Aria2ProcessManager } from '@core/engine/aria2/aria2-process-manager'
import { Aria2RpcClient } from '@core/engine/aria2/aria2-rpc-client'
import { Aria2TrustStore } from '@core/engine/aria2/aria2-trust-store'
import { CompletedTaskStartupGuard } from '@core/engine/aria2/completed-task-startup-guard'
import type { DnsFallbackConsumer } from '@core/engine/aria2/dns-fallback'
import { createDnsFallbackConsumer } from '@core/engine/aria2/dns-fallback'
import { JsonRpcProtocol } from '@core/engine/aria2/json-rpc-protocol'
import {
  PollingScheduler,
  type PollingTaskUpdateSource,
} from '@core/engine/aria2/polling-scheduler'
import { translateRawToTask } from '@core/engine/aria2/translate'
import type { Aria2TaskStatus } from '@core/engine/aria2/types'
import { WebSocketTransport } from '@core/engine/aria2/web-socket-transport'
import {
  ENGINE_READY_TIMEOUT_MS,
  EngineSupervisor,
} from '@core/engine/engine-supervisor'
import { EventBus } from '@core/events/event-bus'
import { locateFfmpeg } from '@core/ffmpeg/ffmpeg-locator'
import { FfmpegService } from '@core/ffmpeg/ffmpeg-service'
import { pathExists } from '@core/fs/path-exists'
import { GeoIPManager } from '@core/geoip/geo-ip-manager'
import { LocaleCoordinator } from '@core/i18n/locale-coordinator'
import {
  createTaskInspectorActivityQuery,
  type RuntimeTransitionInput,
  TaskInspectorActivityRuntime,
  TaskInspectorActivityStore,
  taskInspectorActivityEnvironment,
} from '@core/inspector-activity'
import { LegacyBtActivationService } from '@core/legacy-import/bt-activation-service'
import { LegacyHttpActivationService } from '@core/legacy-import/http-activation-service'
import { LegacyImportService } from '@core/legacy-import/import-service'
import {
  getLegacyQuarantinedGids,
  hasLegacyImport,
} from '@core/legacy-import/legacy-task-policy'
import { newTaskId } from '@core/lib/ids'
import { getLogger } from '@core/logger'
import { fetchManifest } from '@core/media/manifest-fetcher'
import { assembleSegments } from '@core/media/segment-assembler'
import { SegmentDecryptor } from '@core/media/segment-decryptor'
import { CloudRuntime } from '@core/nexus/cloud/cloud-runtime'
import { CredentialBroker } from '@core/nexus/cloud/credential-broker'
import { ControlRuntime } from '@core/nexus/control/control-runtime'
import { controlTaskView } from '@core/nexus/control/task-view'
import { NexusDiagnostics } from '@core/nexus/diagnostics'
import { detectMedia } from '@core/nexus/media/domestic-parsers'
import { DouyinAnonymous } from '@core/nexus/media/douyin-anonymous'
import { probeDouyinMedia } from '@core/nexus/media/douyin-play'
import { ExternalMedia } from '@core/nexus/media/external-media'
import { MediaFinisher } from '@core/nexus/media/media-finisher'
import {
  MediaRecovery,
  segmentCheckpoints,
} from '@core/nexus/media/media-recovery'
import { MediaRuntime } from '@core/nexus/media/media-runtime'
import { ServiceConnectors } from '@core/nexus/media/service-connectors'
import { markNetworkFile, NexusNetworkMarker } from '@core/nexus/network-marker'
import { relocateEncryptedJobs } from '@core/nexus/portable-jobs'
import { pan115OfflineAdapter } from '@core/nexus/remote/pan115-offline-adapter'
import { SpeedProfiles } from '@core/nexus/speed-profiles'
import { ToolManager } from '@core/nexus/tools/tool-manager'
import { PortableUpdateService } from '@core/nexus/update/portable-update-service'
import { ArchiveService } from '@core/nexus/workflow/archive-service'
import { DiskGuard } from '@core/nexus/workflow/disk-guard'
import { organizeFiles } from '@core/nexus/workflow/organize-files'
import { PackageManager } from '@core/nexus/workflow/package-manager'
import { ProcessingPipeline } from '@core/nexus/workflow/processing-pipeline'
import { QueueManager } from '@core/nexus/workflow/queue-manager'
import { NexusWorkspace } from '@core/nexus/workspace'
import { registerEngineCompatibilitySubscriber } from '@core/notifications/engine-compatibility-subscriber'
import { registerEngineFailureSubscriber } from '@core/notifications/engine-failure-subscriber'
import { NotificationCenter } from '@core/notifications/notification-center'
import { createNotificationOccurrenceConsumer } from '@core/notifications/occurrence-consumer'
import { projectActiveToLegacy } from '@core/plugin/capabilities/ffmpeg-detect'
import { wireCommandSystem } from '@core/plugin/commands/wire'
import type { NativeFinalizeFilesystemAdapter } from '@core/plugin/finalize/filesystem-adapter'
import { resolveFinalizeSidecarPath } from '@core/plugin/finalize/sidecar-path'
import { GrantsManager } from '@core/plugin/grants/grants-manager'
import type { HookAuditLog } from '@core/plugin/hooks/audit-log'
import type { HookOrchestrator } from '@core/plugin/hooks/hook-orchestrator'
import { ActivationDispatcher } from '@core/plugin/host/activation-dispatcher'
import {
  PluginHost,
  parsePluginIdleDisposeMs,
} from '@core/plugin/host/plugin-host'
import { PluginInstaller } from '@core/plugin/install/plugin-installer'
import { PluginHttpClient } from '@core/plugin/network/plugin-http-client'
import { PluginRegistry } from '@core/plugin/plugin-registry'
import { RegistryClient } from '@core/plugin/registry/registry-client'
import type { PluginHookRuntime } from '@core/plugin/runtime/plugin-hook-runtime'
import { createPluginRuntime } from '@core/plugin/runtime/runtime-factory'
import { PluginRuntimeStartupCoordinator } from '@core/plugin/runtime/startup-coordinator'
import { PluginSecurityService } from '@core/plugin/security/security-service'
import { PluginStateStore } from '@core/plugin/state/plugin-state-store'
import { BuiltinUpdater } from '@core/plugin/update/builtin-updater'
import { AppliedDownloadProxyPolicy } from '@core/proxy/applied-download-proxy-policy'
import { ProxyBridgeManager } from '@core/proxy/proxy-bridge-manager'
import { isDomesticPlatform } from '@core/proxy/request-proxy'
import type { DurableFinalizeRuntime } from '@core/session/durable-finalize-runtime'
import { MotrixDatabase } from '@core/session/motrix-database'
import { SessionManager } from '@core/session/session-manager'
import { SettingsManager } from '@core/settings/settings-manager'
import { SpeedLimitController } from '@core/speed-limit/speed-limit-controller'
import {
  SpeedHistoryStore,
  StatsAggregator,
  TaskSpeedHistoryStore,
  TransferStatsRuntime,
} from '@core/stats'
import {
  pauseAllTasks,
  pauseTask as pauseTaskAction,
  reAddTask as reAddTaskAction,
  resumeAllTasks,
  resumeTask as resumeTaskAction,
} from '@core/task/actions'
import {
  type FinalizeArtifactCommitRequest,
  finalizeTask,
} from '@core/task/actions/finalize-task'
import { removeTask } from '@core/task/actions/remove-task'
import { commitPolledTerminalTransition } from '@core/task/actions/shared'
import { countActiveDownloads } from '@core/task/active-downloads'
import { CompletedEngineTaskCleanup } from '@core/task/completed-engine-task-cleanup'
import { handleCreateTask } from '@core/task/create-task-handler'
import { DirectResourceValidatorService } from '@core/task/direct-resource-validator'
import { FileCleanupServiceImpl } from '@core/task/file-cleanup-service'
import { FinalNamePickerImpl } from '@core/task/final-name-picker'
import { MediaMetaStoreImpl } from '@core/task/media-meta-store'
import { MediaTaskCoordinator } from '@core/task/media-task-coordinator'
import {
  hasEngineTaskDelta,
  mergeEngineTask,
} from '@core/task/merge-engine-task'
import { createFailureLogConsumer } from '@core/task/occurrences/log-consumer'
import { OccurrenceDispatcher } from '@core/task/occurrences/occurrence-dispatcher'
import { shouldEvictFromEngine } from '@core/task/should-evict-from-engine'
import { shouldSkipEngineCompletionFinalize } from '@core/task/should-skip-engine-completion-finalize'
import { shouldTriggerTransitionSave } from '@core/task/should-trigger-transition-save'
import { slimTasksForBroadcast } from '@core/task/slim-task-for-broadcast'
import { TaskManager } from '@core/task/task-manager'
import {
  defaultRecoveryFs,
  TaskRecoveryServiceImpl,
} from '@core/task/task-recovery-service'
import { TaskUpdatePublisher } from '@core/task/task-update-publisher'
import { TorrentMetaStoreImpl } from '@core/task/torrent-meta-store'
import { MagnetTracker } from '@core/torrent/magnet-tracker'
import { shouldSkipForPendingMagnetMetadata } from '@core/torrent/metadata-task-filter'
import { TorrentParser } from '@core/torrent/torrent-parser'
import {
  TrackerManager,
  TrackerProber,
  TrackerStore,
  TrackerSyncer,
} from '@core/tracker'
import { TaskTrackerRepository } from '@core/tracker/task-tracker-repository'
import { attachmentZonePolicy } from '@main/nexus/attachment-policy'
import { startNexusClipboard } from '@main/nexus/clipboard-monitor'
import {
  authorizeAliyun,
  cloudCipher,
  loginCloud,
} from '@main/nexus/cloud-login'
import { exportNexusDiagnostics } from '@main/nexus/export-diagnostics'
import { mediaSession } from '@main/nexus/media-session'
import { QueuePower } from '@main/nexus/queue-power'
import { clearSystemRemnants } from '@main/nexus/system-cleanup'
import type { NatManager } from '@motrix/nat'
import { APP_ID, APP_NAME } from '@shared/constants'
import { DEFAULT_LOCALE, type SupportedLocale } from '@shared/constants/locales'
import { AppError, ErrorCode } from '@shared/errors'
import { EXTERNAL_URLS } from '@shared/external-urls'
import { LEGACY_MIGRATION_INVITATION_ROUTE } from '@shared/lib/legacy-import-navigation'
import {
  ALL_DOWNLOADS_ROUTE,
  resolveTaskRoute,
} from '@shared/lib/task-navigation'
import { NEXUS_BUILD_POLICY } from '@shared/nexus-build-policy'
import { NEXUS_RELEASE_CONFIG } from '@shared/nexus-release-config'
import { MOTRIX_COMPAT_VERSION, NEXUS_VERSION } from '@shared/nexus-version'
import { Events } from '@shared/protocol/events'
import { Queries } from '@shared/protocol/queries'
import {
  DEFAULT_BYTE_UNIT_PREFERENCE,
  resolveByteUnitSystem,
} from '@shared/schemas/byte-unit-system'
import { REGISTRY_CACHE_FILENAME } from '@shared/schemas/registry'
import { CliToolReason } from '@shared/types/cli-tool'
import { EngineState } from '@shared/types/engine'
import type { AppNotification } from '@shared/types/notification'
import {
  getHiddenNotificationKinds,
  NotificationKinds,
} from '@shared/types/notification'
import type { AppSettings } from '@shared/types/settings'
import type { DownloadTask } from '@shared/types/task'
import { TaskStatus, TaskType } from '@shared/types/task'
import type { TaskOccurrence } from '@shared/types/task-occurrence'
import {
  app,
  type BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  autoUpdater as nativeAutoUpdater,
  powerMonitor,
  shell,
  systemPreferences,
} from 'electron'
import { bootstrapBridge, createNativeMessagingInstaller } from './bridge'
import { BridgeManager } from './bridge/bridge-manager'
import { isPackagedLinuxFlatpak } from './bridge/flatpak-environment'
import { resolvePackagedLinuxSnapEnvironment } from './bridge/snap-environment'
import { CliToolService } from './cli/cli-tool-service'
import { CommandRegistry } from './commands/command-registry'
import { ContextStore } from './commands/context-store'
import { registerAllCommands } from './commands/definitions'
import { KeybindingRegistry } from './commands/keybindings/keybinding-registry'
import type { CommandDeps } from './commands/types'
import { createAppUpdateService } from './core/app-update-service'
import {
  DevelopmentUpdateSimulator,
  shouldUseDevelopmentUpdateSimulator,
} from './core/development-update-simulator'
import { registerUpdateQuitPreparation } from './core/update-quit-preparation'
import { setupExceptionHandler } from './exception-handler'
import { registerApplicationMenuIpc } from './ipc/application-menu'
import { registerCommandHandlers } from './ipc/commands'
import { createRevealInFolderHandler } from './ipc/commands/reveal-in-folder'
import { registerDisclaimerIpc } from './ipc/disclaimer'
import { setupEventForwarding } from './ipc/events'
import { registerNotificationIpc } from './ipc/notifications'
import { registerQueryHandlers } from './ipc/queries'
import { registerTrustedIpcHandler } from './ipc/trusted-ipc'
import { setupLauncher } from './launcher'
import {
  defaultLegacyRoots,
  legacyPidRunning,
  registerLegacyImportIpc,
} from './legacy-import/desktop-import'
import { LegacyImportNavigation } from './legacy-import/navigation-state'
import { applyMainLocale, i18n } from './lib/i18n'
import { closeLogger, setupLogger } from './logger'
import { MainProcessWorkCoordinator } from './main-process-work-coordinator'
import { installAllMenubarContributions } from './menu/contributions'
import { suppressMacOSAutomaticFullscreenMenuItem } from './menu/macos-fullscreen-menu'
import { MenuManager } from './menu/menu-manager'
import { MenuRegistry } from './menu/menu-registry'
import { createNatManager } from './nat/nat-manager-factory'
import { scanAttachments } from './nexus/attachment-scanner'
import { NexusGlobalShortcut } from './nexus/global-shortcut'
import { configureNexusNotifications } from './nexus/notification-identity'
import {
  acknowledgePortableUpdate,
  acknowledgePortableUpdateBoot,
  isPortableUpdateDirectory,
  preparePortableUpdate,
  scheduleInterruptedRecovery,
  updateDirectory,
} from './nexus/portable-updater'
import {
  type ProcessGuardian,
  startProcessGuardian,
} from './nexus/process-guardian'
import { createOsNotificationBridge } from './notifications/os-bridge'
import { DisclaimerGate } from './onboarding/disclaimer-gate'
import { setupAppImageIntegration } from './platform/appimage-integration-host'
import { syncAutoLaunch } from './platform/auto-launch'
import { setupCompletionShutdown } from './platform/completion-shutdown'
import { resolveDefaultSaveDirOptions } from './platform/default-save-dir'
import { resolveDesktopBackgroundPolicy } from './platform/desktop-background-policy'
import { resolveDistributionContext } from './platform/distribution-context'
import { setupDownloadProgress } from './platform/download-progress'
import { removePathRecursive, renameAtomic } from './platform/fs-helpers'
import { setupGraphicsRecovery } from './platform/graphics-recovery-runtime'
import { getMacUpdateInstallBlockReason } from './platform/mac-update-install-policy'
import { setupNativeThemeSync } from './platform/native-theme-sync'
import {
  getPortableProfile,
  PortableProfileError,
} from './platform/portable-profile'
import {
  portableEngineStateDirectory,
  relocatePortableProfile,
} from './platform/portable-relocation'
import { setupPowerManager } from './platform/power-manager'
import { createProtocolManager } from './platform/protocol-manager'
import { isElectronSelfUpdateSupported } from './platform/self-update-policy'
import { createElectronPlatformServices } from './platform/services'
import { setupSystemAccentColorSync } from './platform/system-accent-color'
import { removeTaskPath } from './platform/task-file-remover'
import { setupTray } from './platform/tray'
import { createElectronCapabilityHost } from './plugin/capability-host'
import { startDevWatcher } from './plugin/dev-watcher'
import {
  makeElectronFfmpegDetect,
  resolveElectronFfmpegEnvPath,
} from './plugin/ffmpeg-detect-electron'
import { resolvePluginHostLanguage } from './plugin/host-language'
import { resolvePluginsDir } from './plugin/plugins-dir'
import { resolveVerifiedFfmpeg } from './plugin/verified-ffmpeg-electron'
import { createRequestRouting } from './proxy/request-routing'
import { createMainProxyApplier } from './proxy/wiring'
import { QuitController } from './quit/quit-controller'
import {
  registerDevShutdownHandler,
  registerTerminationSignalHandlers,
} from './quit/termination-signals'
import {
  LiquidGlassController,
  shouldEnableLiquidGlassByDefault,
} from './window/liquid-glass'
import { createRendererRecoveryRuntime } from './window/renderer-recovery-runtime'
import { initializeRendererUrlPolicy } from './window/renderer-url-policy'
import { WindowManager } from './window/window-manager'
import { resolveMainWindowStartupPlan } from './window/window-startup-plan'

// ─── Platform Early Setup ───────────────────────────────

suppressMacOSAutomaticFullscreenMenuItem(process.platform, systemPreferences)

const distributionContext = resolveDistributionContext({
  platform: process.platform,
  isPackaged: app.isPackaged,
  windowsStore: process.windowsStore,
})

if (process.platform === 'win32') {
  app.setName(APP_NAME)
  app.setAppUserModelId(APP_ID)
}

// macOS shows the "Electron wants to use 'Motrix Safe Storage'" keychain
// prompt only when Chromium's OSCrypt touches the keychain AND the running
// binary's code signature doesn't match the keychain item's ACL — i.e. the
// ad-hoc-signed dev binary after an Electron upgrade. Signed release builds
// match their own ACL (and electronFuses.enableCookieEncryption is off), so
// end users never see it. There is no proper macOS runtime switch for this
// (use-mock-keychain is a test-only flag), so we intentionally do nothing
// here on darwin and rely on release signing.
// Linux differs: gnome-keyring/kwallet would prompt in production too. We no
// longer depend on the OS keychain (plugin secrets use the file-backed
// libsodium store), so force Chromium's basic password store to avoid the
// keyring prompt. `password-store=basic` is a documented production switch.
// See docs/specs/macos-keychain-and-signing.md.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('password-store', 'basic')
}

const platform = (() => {
  try {
    return createElectronPlatformServices(distributionContext)
  } catch (error) {
    if (error instanceof PortableProfileError) {
      dialog.showErrorBox(
        i18n.t('settings.portable.title'),
        i18n.t('settings.portable.startupError')
      )
      app.exit(1)
    }
    throw error
  }
})()
const portableProfile = getPortableProfile()
const rendererUrlPolicy = initializeRendererUrlPolicy({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  devServerUrl: app.isPackaged ? null : process.env.VITE_DEV_SERVER_URL,
})

// Immutable startup capability must be available before onboarding or settings
// windows mount; late service registration can still be waiting on plugin IO.
registerTrustedIpcHandler(Queries.GetPortableMode, () => ({
  enabled: Boolean(portableProfile),
  dataDirectory: portableProfile?.dataDir,
}))
app.once('will-quit', () => ipcMain.removeHandler(Queries.GetPortableMode))

// ─── Logger ─────────────────────────────────────────────

const logDir = path.join(platform.userDataDir, 'logs')
setupLogger({ level: 'info', logDir, isDev: platform.isDev })
const log = getLogger('main')

// ─── Core Services ──────────────────────────────────────

const eventBus = new EventBus({
  onListenerError: (channel, err) =>
    log.warn({ err, channel }, 'event listener threw'),
})
const taskManager = new TaskManager()
// Coalesces the per-commit TaskUpdated fan-out (see
// docs/superpowers/specs/2026-08-07-task-updated-emit-coalescing-design.md).
// Phase 1: only commitTaskUpdate routes through it, via the optional
// publishTaskUpdate/publishTaskUpdateNow deps handed to task actions below.
// The broadcast snapshot is projected through slimTasksForBroadcast
// (option E): static per-task tracker data stays in TaskManager and the
// per-task GetTaskDetail query, but leaves the hot full-list payload.
const taskUpdatePublisher = new TaskUpdatePublisher({
  taskManager: { getAll: () => slimTasksForBroadcast(taskManager.getAll()) },
  eventBus,
})
const publishTaskUpdate = () => taskUpdatePublisher.publish()
const publishTaskUpdateNow = () => taskUpdatePublisher.publishNow()
const statsAggregator = new StatsAggregator()
const speedHistoryStore = new SpeedHistoryStore()
const taskSpeedHistoryStore = new TaskSpeedHistoryStore()
const torrentParser = new TorrentParser()
let windowManager: WindowManager
let graphicsRuntime: ReturnType<typeof setupGraphicsRecovery> | undefined
let rendererRecovery:
  | ReturnType<typeof createRendererRecoveryRuntime>
  | undefined
let transferStats: TransferStatsRuntime | null = null
let taskActivityService: TaskActivityService | null = null
let taskInspectorActivityRuntime: TaskInspectorActivityRuntime | null = null

function requireTaskActivityService(): TaskActivityService {
  if (!taskActivityService) {
    throw new Error('TaskActivityService is not initialized')
  }
  return taskActivityService
}

eventBus.on(Events.TaskUpdated, (...args) => {
  const tasks = args[0]
  if (Array.isArray(tasks)) {
    taskSpeedHistoryStore.append(tasks as readonly DownloadTask[])
  }
})

const settingsPath = path.join(platform.userDataDir, 'settings.json')
log.info({ settingsPath }, 'resolved settings path')
const settingsSnapEnvironment =
  process.platform === 'linux'
    ? resolvePackagedLinuxSnapEnvironment({
        platform: 'linux',
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        env: process.env,
      })
    : null
const settingsFlatpakEnvironment =
  process.platform === 'linux' &&
  isPackagedLinuxFlatpak({
    platform: 'linux',
    isPackaged: app.isPackaged,
    env: process.env,
  })
const defaultSaveDirOptions = resolveDefaultSaveDirOptions({
  snapEnvironment: settingsSnapEnvironment,
  getSystemDownloadsDir: () => app.getPath('downloads'),
  getHomeDir: homedir,
  ensureDirectory: (directory) => mkdirSync(directory, { recursive: true }),
  onSystemDownloadsDirError: (error, fallbackDir) =>
    log.warn(
      { err: error, fallbackDir },
      'system downloads directory unavailable; using home fallback'
    ),
})
const cliToolService = new CliToolService({
  manualOnlyReason: portableProfile ? CliToolReason.Portable : undefined,
  directInstallSupported:
    !portableProfile &&
    !settingsFlatpakEnvironment &&
    settingsSnapEnvironment === null,
})
const settingsManager = new SettingsManager(settingsPath, {
  defaultByteUnitSystem: resolveByteUnitSystem(
    DEFAULT_BYTE_UNIT_PREFERENCE,
    process.platform
  ),
  liquidGlassEffectDefault: shouldEnableLiquidGlassByDefault({
    isDev: platform.isDev,
  }),
  ...defaultSaveDirOptions,
  onChange: (old, updated) => {
    if (old.app.hardwareAcceleration !== updated.app.hardwareAcceleration) {
      graphicsRuntime?.recovery.preferenceChanged(
        updated.app.hardwareAcceleration
      )
    }
    eventBus.emit(Events.SettingsChanged, { old, updated })
    if (
      old.app.notifyInAppOnComplete !== updated.app.notifyInAppOnComplete ||
      old.app.notifyInAppOnError !== updated.app.notifyInAppOnError ||
      old.app.notificationBadgeStyle !== updated.app.notificationBadgeStyle
    ) {
      eventBus.emit(Events.NotificationsChanged)
    }
    if (old.app.sidebarColor !== updated.app.sidebarColor) {
      eventBus.emit(Events.SidebarColorChanged, {
        sidebarColor: updated.app.sidebarColor,
      })
    }
    if (old.app.liquidGlassEffect !== updated.app.liquidGlassEffect) {
      eventBus.emit(Events.LiquidGlassChanged, {
        liquidGlassEffect: updated.app.liquidGlassEffect,
      })
    }
    if (old.app.byteUnitSystem !== updated.app.byteUnitSystem) {
      eventBus.emit(Events.ByteUnitSystemChanged, {
        byteUnitSystem: updated.app.byteUnitSystem,
      })
    }
    if (
      JSON.stringify(old.app.directoryPreferences) !==
      JSON.stringify(updated.app.directoryPreferences)
    ) {
      eventBus.emit(
        Events.DirectoryPreferencesChanged,
        structuredClone(updated.app.directoryPreferences)
      )
    }
    if (old.app.reduceMotion !== updated.app.reduceMotion) {
      eventBus.emit(Events.ReducedMotionChanged, {
        reduceMotion: updated.app.reduceMotion,
      })
    }
    // Forward GeoIP changes to the manager so it can swap the in-memory
    // reader when `enabled` flips. The manager guards itself against
    // reentrancy (own update() calls don't loop because they only mutate
    // lastUpdatedAt/databaseVersion, which the change listener ignores).
    if (
      geoipManager &&
      (old.geoip.enabled !== updated.geoip.enabled ||
        old.geoip.source !== updated.geoip.source)
    ) {
      void geoipManager.onSettingsChanged(old.geoip, updated.geoip)
    }
    if (
      windowManager &&
      process.platform === 'darwin' &&
      old.app.liquidGlassEffect !== updated.app.liquidGlassEffect
    ) {
      setTimeout(() => windowManager?.recreate('main'), 100)
    }
    if (
      windowManager &&
      (old.app.lightweightMode !== updated.app.lightweightMode ||
        old.app.runMode !== updated.app.runMode)
    ) {
      // Let the settings IPC response reach its renderer before a newly
      // enabled policy is allowed to release any hidden window.
      setTimeout(() => windowManager?.reconcileWindowRetention(), 100)
    }
    if (
      speedLimitController &&
      JSON.stringify(old.speedLimit) !== JSON.stringify(updated.speedLimit)
    ) {
      void speedLimitController.recompute()
    }
  },
})
const appliedDownloadProxyPolicy = new AppliedDownloadProxyPolicy()

// ─── aria2 Infrastructure ───────────────────────────────

const transport = new WebSocketTransport()
const protocol = new JsonRpcProtocol(transport)
const processManager = new Aria2ProcessManager({
  ownershipFilePath: path.join(platform.userDataDir, 'aria2-owner.json'),
})

log.info({ extraDir: platform.extraResourceDir }, 'resolved extra directory')

const configBuilder = new Aria2ConfigBuilder(
  path.join(platform.extraResourceDir, 'aria2.conf'),
  platform.userDataDir,
  {
    supervisorPid: process.pid,
    ...(portableProfile
      ? { persistenceDirectory: portableEngineStateDirectory(portableProfile) }
      : {}),
  }
)
const trustStore = new Aria2TrustStore(platform.userDataDir)

// ─── Database ───────────────────────────────────────────

const motrixDb = new MotrixDatabase(
  path.join(platform.userDataDir, 'motrix.db')
)

// Delivers durably-persisted terminal/diagnosis occurrences to in-process
// consumers (timeline, failure log, notification center); registered
// inside startEngineAndRestore() below, at the "occurrence consumer
// registration" marker. See the notificationCenter construction comment
// in initializeMainProcess (Phase 2) for the full must-reach
// registration/drain ordering rationale.
const occurrenceDispatcher = new OccurrenceDispatcher({
  listUndispatched: () => motrixDb.listUndispatchedOccurrences(),
  markDispatched: (occurrenceId) =>
    motrixDb.markOccurrenceDispatched(occurrenceId),
  log,
})

// ─── Task lifecycle helpers ─────────────────────────────

const finalNamePicker = new FinalNamePickerImpl({
  exists: pathExists,
})
const torrentMetaStore = new TorrentMetaStoreImpl(
  path.join(platform.userDataDir, 'torrents')
)
const mediaMetaStore = new MediaMetaStoreImpl(
  path.join(platform.userDataDir, 'media')
)
const fileCleanupService = new FileCleanupServiceImpl({
  removePathRecursive: (absPath) =>
    removeTaskPath(absPath, settingsManager.getApp().fileDeletionMode),
})

// ─── Late-Initialized (assigned in app.on('ready')) ─────

let rpcClient: Aria2RpcClient
let supervisor: EngineSupervisor
let pluginHttpClient: PluginHttpClient | undefined
let proxyBridge: ProxyBridgeManager
let requestRouting: ReturnType<typeof createRequestRouting> | undefined
let speedLimitController: SpeedLimitController
let sessionManager: SessionManager
let completedEngineTaskCleanup: CompletedEngineTaskCleanup
let pollingScheduler: PollingScheduler
let aria2Adapter: Aria2Adapter
// Constructed in Phase 2 below (F4); see that construction site's comment
// for the full must-reach registration/drain ordering rationale.
let notificationCenter: NotificationCenter
// Constructed and registered in startEngineAndRestore; its task retry is
// late-bound by buildCommandHandlers to the ReAddTasks deps bundle.
let dnsFallbackConsumer: DnsFallbackConsumer | undefined
let recoveryService: TaskRecoveryServiceImpl | undefined
let dnsFallbackRetry: ((taskId: string) => Promise<unknown>) | undefined
let trayHandle: ReturnType<typeof setupTray> | null = null
let natManager: NatManager | null = null
let stopNatDiagnostics: (() => Promise<void>) | null = null
let trackerManager: TrackerManager | null = null
let menuManager: MenuManager | null = null
let osNotificationBridge: { dispose(): void } | null = null
let geoipManager: GeoIPManager | null = null
let pluginHost: PluginHost | null = null
let pluginHookRuntime: PluginHookRuntime | null = null
let hookAuditLog: HookAuditLog | null = null
let hookOrchestrator: HookOrchestrator | null = null
let durableFinalizeRuntime: DurableFinalizeRuntime | null = null
let finalizeFilesystemAdapter: NativeFinalizeFilesystemAdapter | null = null
let postDeliveryAbortController: AbortController | null = null
let postDeliveryLoop: Promise<void> | null = null
let devWatcherHandle: { close(): Promise<void> } | null = null
let nexusPackageManager: PackageManager | undefined
let nexusTools: ToolManager | undefined
let bridgeManager: BridgeManager | null = null
let magnetTracker: MagnetTracker | null = null
let segmentClient: Aria2SegmentClient | null = null
let disposeIpcIngress: (() => void) | null = null
let legacyImportService: LegacyImportService | null = null
let legacyBtActivationService: LegacyBtActivationService | null = null
let legacyHttpActivationService: LegacyHttpActivationService | null = null
let pendingDisclaimerGate: DisclaimerGate | null = null
const mainProcessWork = new MainProcessWorkCoordinator()
const pollingNotificationUnsubscribers: Array<() => void> = []
// Media (hls/dash/mux) segment downloads run on the shared aria2 daemon and
// write under this root. The poll loop suppresses minting DownloadTasks for any
// row whose dir is here — a gid-timing-independent backstop against the
// segment-gid add/remove races that otherwise leak phantom "seg" tasks.
let mediaTmpRoot: string | null = null
let resolvedApplicationLocale: SupportedLocale = DEFAULT_LOCALE

// ─── Cleanup (shared by exception handler & quit) ───────

let cleanupPromise: Promise<void> | null = null
let processGuardian: ProcessGuardian | undefined

function armShutdownDeadline(): void {
  try {
    processGuardian?.beginShutdown()
  } catch {
    log.warn('Unable to arm the external shutdown deadline')
  }
}

function performCleanup(): Promise<void> {
  // Fence engine exit handling before the first await. Windows may terminate
  // aria2 as soon as session end begins, before graceful cleanup reaches it.
  supervisor?.prepareForShutdown()

  // Release a first-run bootstrap waiting for legal consent before asking the
  // work coordinator to drain that bootstrap. This must happen synchronously
  // or declining/closing the disclaimer can deadlock shutdown.
  pendingDisclaimerGate?.cancel()
  pendingDisclaimerGate = null

  if (cleanupPromise) return cleanupPromise
  cleanupPromise = (async () => {
    const safely = async (
      label: string,
      action: () => void | Promise<void>
    ) => {
      try {
        await action()
      } catch (err) {
        log.warn({ err, label }, 'cleanup step failed')
      }
    }

    // Disable native menu ingress in the same synchronous shutdown turn.
    // Stale Electron MenuItem references are still guarded by mainProcessWork.
    menuManager?.disable()

    // Removing existing handlers and gating bootstrap/IPC must happen in the
    // same turn. Awaiting the synchronous removal first would yield a microtask
    // in which a Phase 2 continuation could install handlers after removal.
    const ingressClose = safely('ipc-ingress', () => disposeIpcIngress?.())
    disposeIpcIngress = null

    // Gate the ready bootstrap, IPC, startup restore, and detached shell work
    // synchronously. Cancellation-capable teardown must begin before awaiting
    // the drain: startup can be blocked on the engine/plugin/session that only
    // those teardown operations can release.
    void legacyBtActivationService?.drain()
    void legacyHttpActivationService?.drain()
    const acceptedWorkDrain = mainProcessWork.stopAndDrain()
    postDeliveryAbortController?.abort()
    await ingressClose
    const cancellationDrain = Promise.all([
      safely('nexus-data', () => drainNexusData?.()),
      safely('polling', () => pollingScheduler?.stopAndDrain()),
      safely('completed-engine-tasks', () =>
        completedEngineTaskCleanup?.stopAndDrain()
      ),
      // The bridge owns long-lived HLS/DASH/mux jobs. Closing it cancels media
      // work and drains accepted bridge handlers.
      safely('bridge', () => bridgeManager?.stop()),
      safely('rpc-notifications', () => {
        for (const unsubscribe of pollingNotificationUnsubscribers.splice(0)) {
          unsubscribe()
        }
        aria2Adapter?.dispose()
      }),
      safely('dev-watcher', async () => {
        const handle = devWatcherHandle
        devWatcherHandle = null
        await handle?.close()
      }),
      safely('plugin-network', () => pluginHttpClient?.close()),
      safely('plugin-host', async () => {
        await postDeliveryLoop
        postDeliveryLoop = null
        postDeliveryAbortController = null
        pluginHookRuntime = null
        const host = pluginHost
        try {
          await hookAuditLog?.drain()
        } finally {
          hookAuditLog = null
          hookOrchestrator = null
          pluginHost = null
          await host?.shutdown()
        }
      }),
      safely('magnet', () => magnetTracker?.stopAndDrain()),
      safely('speed-limit', () => speedLimitController?.stop()),
      safely('geoip', () => geoipManager?.stop()),
      safely('nat', async () => {
        await stopNatDiagnostics?.()
        await natManager?.stop()
      }),
    ])
    // Tracker edits pause active tasks while changing bt-tracker. Drain their
    // unconditional resume compensation while both Session persistence and
    // engine RPC are still available.
    const trackerDrain = safely('tracker', () => trackerManager?.stopAndDrain())
    await Promise.all([
      cancellationDrain,
      trackerDrain,
      safely('session', () => sessionManager?.stopAndDrain()),
      safely('engine', () => supervisor?.stop()),
    ])
    await safely('finalize-filesystem', async () => {
      const adapter = finalizeFilesystemAdapter
      finalizeFilesystemAdapter = null
      durableFinalizeRuntime = null
      await adapter?.dispose()
    })
    await safely('proxy-bridge', () => proxyBridge?.close())
    await safely('request-routing', () => requestRouting?.close())
    await safely('main-process-work', () => acceptedWorkDrain)
    await safely('task-inspector-activity', () =>
      taskInspectorActivityRuntime?.dispose()
    )
    await safely('transfer-stats', () => {
      if (!transferStats) return
      const flushed = transferStats.dispose()
      transferStats = null
      if (!flushed) {
        log.warn('transfer statistics final checkpoint failed')
      }
    })
    await safely('legacy-bt-activation', () =>
      legacyBtActivationService?.drain()
    )
    await safely('legacy-http-activation', () =>
      legacyHttpActivationService?.drain()
    )
    await safely('legacy-import', () => legacyImportService?.drain())
    await safely('database', () => {
      if (motrixDb?.database.open) motrixDb.close()
    })
  })()
  return cleanupPromise
}

// ─── Window Manager & Protocol (must register before ready) ─

function loadWindowUrl(win: BrowserWindow, route: string) {
  const [pathname = '', query = ''] = route.split('?')
  const params = new URLSearchParams(query)
  params.set('locale', resolvedApplicationLocale)
  const localizedRoute = `${pathname}?${params.toString()}`
  return rendererUrlPolicy.loadWindow(win, localizedRoute)
}

// Durable UI intents are released only when the actual consumer is mounted.
function dispatchWhenReady(
  win: BrowserWindow,
  channel: string,
  payload: unknown,
  resolvePayload?: () => unknown
) {
  const id = (
    ['main', 'add-task', 'onboarding', 'create-torrent'] as const
  ).find((id) => windowManager?.get(id) === win)
  if (!id || win.isDestroyed()) return
  if (rendererRecovery?.intents.deliver(id, channel, payload, resolvePayload))
    return
  // Snapshot notifications have a query-on-mount consumer and need no replay.
  win.webContents.send(channel, resolvePayload ? resolvePayload() : payload)
}

// Notifications and protocol links share the same last-moment availability
// check, including the wait for a released main window to finish loading.
function navigateToTask(taskId: string) {
  runShellAsyncWork('task navigation', async () => {
    // A cold-start link can arrive before the persisted tasks are restored.
    await mainProcessWork.waitForStartup()
    if (!mainProcessWork.isAccepting()) return
    const win = windowManager?.get('main')
    if (!win || win.isDestroyed()) return
    dispatchWhenReady(win, Events.NavigateTo, ALL_DOWNLOADS_ROUTE, () =>
      resolveTaskRoute(taskId, taskManager.getById(taskId)?.status)
    )
  })
}

let protocolNoticeActive = false

const protocolManager = createProtocolManager({
  onShowMain: () => windowManager?.show('main'),
  onNavigate: (route) => {
    if (!windowManager) return
    windowManager.show('main')
    const win = windowManager.get('main')
    if (!win || win.isDestroyed()) return
    dispatchWhenReady(win, Events.NavigateTo, route)
  },
  onNotice: (notice) => {
    // Native feedback also works before the renderer subscribes. Coalesce
    // repeated external clicks while a notice is already on screen.
    if (protocolNoticeActive) return
    protocolNoticeActive = true
    runShellAsyncWork('protocol notice', async () => {
      try {
        if (!mainProcessWork.isAccepting()) return
        windowManager?.show('main')
        await dialog.showMessageBox({
          type: 'info',
          title: i18n.t('protocol.title'),
          message: i18n.t(`protocol.${notice}`),
        })
      } finally {
        protocolNoticeActive = false
      }
    })
  },
  settingsManager,
  torrentParser,
  // In an AppImage, appimage-integration owns the scheme defaults; don't let
  // Electron's setAsDefaultProtocolClient race it (see ProtocolManagerDeps).
  isAppImage: process.platform === 'linux' && Boolean(process.env.APPIMAGE),
  // External URL clicks (magnet/http(s)/ftp and
  // nexusdl://new-task?uri=...) open add-task with Links prefilled.
  onOpenAddTask: (params) => {
    if (!windowManager) return
    windowManager.show('add-task')
    const win = windowManager.get('add-task')
    if (!win || win.isDestroyed()) return
    dispatchWhenReady(win, Events.SetAddTaskMode, params)
  },
  // .torrent file association (and queue increments) ship a parsed
  // TorrentMeta to the add-task window — too rich for AddTaskUrlParams,
  // so this routes through ProtocolTorrentFile with the same
  // wait-for-ready guarantee.
  deliverToAddTask: (channel, payload) => {
    if (!windowManager) return
    windowManager.show('add-task')
    const win = windowManager.get('add-task')
    if (!win || win.isDestroyed()) return
    dispatchWhenReady(
      win,
      channel,
      payload,
      channel === Events.ProtocolTorrentFile
        ? () => protocolManager.getCurrentTorrentSnapshot()
        : undefined
    )
  },
  // nexusdl://plugins/<id> — navigation-only by contract
  // (.claude/rules/plugin-registry.md): open the marketplace detail route in
  // the main window. Dispatching directly (not via eventBus) keeps cold-start
  // deeplinks independent of setupEventForwarding registration order, and
  // NavigateTo is replay-buffered in the preload for the pre-subscribe gap.
  onOpenPluginDetail: (pluginId) => {
    if (!windowManager) return
    windowManager.show('main')
    const win = windowManager.get('main')
    if (!win || win.isDestroyed()) return
    dispatchWhenReady(win, Events.NavigateTo, `/plugins/${pluginId}`)
  },
  onOpenTaskDetail: (taskId) => {
    if (!windowManager) return
    windowManager.show('main')
    navigateToTask(taskId)
  },
})

setupExceptionHandler({
  isDev: platform.isDev,
  getWindow: () => windowManager?.get('main') ?? null,
  onFatalError: async () => {
    armShutdownDeadline()
    const deadline = setTimeout(() => app.exit(1), 5000)
    try {
      await performCleanup()
    } finally {
      clearTimeout(deadline)
      try {
        if (motrixDb?.database.open) motrixDb.close()
      } catch {}
      closeLogger()
    }
  },
})

const launcher = setupLauncher({
  onProtocolUrl: (url) => protocolManager.handle(url),
  onTorrentFile: (filePath) => {
    protocolManager.handleTorrentFile(filePath)
  },
  onShowWindow: () => {
    windowManager?.show('main')
  },
})

// Run synchronously before ready, after the launcher owns this profile.
// SettingsManager loads asynchronously after ready, which is too late for
// Electron's hardware acceleration switch.
if (app.hasSingleInstanceLock()) {
  graphicsRuntime = setupGraphicsRecovery(platform.userDataDir, settingsPath)
}

function runShellAsyncWork(
  label: string,
  operation: () => Promise<void>
): void {
  if (!mainProcessWork.isAccepting()) return
  void mainProcessWork
    .run(async () => {
      if (!mainProcessWork.isAccepting()) return
      await operation()
    })
    .catch((err) => {
      // stopAndDrain can win the small isAccepting() → run() race.
      if (
        !mainProcessWork.isAccepting() &&
        err instanceof Error &&
        err.message === 'AsyncWorkTracker is stopped'
      ) {
        return
      }
      log.warn({ err, label }, 'detached shell work failed')
    })
}

// ─── Polling Callback ───────────────────────────────────

async function handlePolledTasks(
  rawTasks: Aria2TaskStatus[],
  source: PollingTaskUpdateSource
): Promise<void> {
  if (supervisor.getState() !== EngineState.Ready) return
  let dirty = false
  for (const raw of rawTasks) {
    // The portable updater owns its ZIP, progress and engine result lifecycle.
    if (isPortableUpdateDirectory(portableProfile, raw.dir)) continue
    if (shouldSkipForPendingMagnetMetadata(raw, magnetTracker)) {
      continue
    }
    // Segment downloads run on the shared aria2 daemon. Skip phantom
    // DownloadTask minting for gids that belong to active segment downloads.
    // The SegmentDownloader's own completion handling is independent — it
    // subscribes via Aria2SegmentClient's fan-out callbacks, so this skip
    // does NOT affect segment download progress or completion.
    if (segmentClient?.isSegmentGid(raw.gid)) {
      continue
    }
    // Backstop for the segment-gid add/remove timing races: a segment can be
    // live in aria2 but momentarily absent from segmentClient.active (between
    // addUri's RPC reply and active.add, or between active.delete and aria2
    // actually dropping the group on forceRemove). Segment downloads ALWAYS
    // write under mediaTmpRoot, so suppress minting for any such row — this is
    // independent of skip-set timing and kills the phantom "seg" task leak.
    if (mediaTmpRoot && raw.dir.startsWith(mediaTmpRoot)) {
      continue
    }
    // A remove/GID swap can complete after this poll's RPC captured the old
    // row but before reconciliation runs. Do not reinterpret that explicitly
    // retired ownership as a brand-new aria2 orphan.
    if (taskManager.isEngineTaskIdRetired(raw.gid)) {
      continue
    }

    const translated = translateRawToTask(raw)
    if (await completedEngineTaskCleanup?.observe(translated)) {
      dirty = true
      continue
    }
    const existing = taskManager.getByEngineTaskId(raw.gid)
    if (existing) {
      const merged = mergeEngineTask(existing, translated)
      if (hasEngineTaskDelta(existing, merged)) {
        let publishedTerminal = false
        if (existing.status !== merged.status) {
          log.info(
            {
              gid: raw.gid,
              taskId: existing.id,
              from: existing.status,
              to: merged.status,
            },
            'task status changed'
          )
          // A poll-detected transition into Completed/Error is committed
          // through the occurrence-aware durable path INSTEAD OF the
          // batch requestSave() below — this task gets its own single-task
          // write (task row + occurrence row, one transaction) rather than
          // waiting on (or duplicating) the batch flush. Awaited inline
          // and published only on success: a terminal status that reached
          // the renderer without its row on disk would revert on the next
          // restart with no occurrence ever recorded. Terminal-vs-not is
          // owned by commitPolledTerminalTransition itself — a non-terminal
          // destination comes back as 'not-terminal' with nothing written.
          const outcome = await commitPolledTerminalTransition(
            existing.status,
            merged,
            {
              isCurrent: () => taskManager.getById(existing.id) === existing,
              persistTaskWithOccurrence,
              occurrenceDispatcher,
              publish: (task) => taskManager.set(task.id, task),
              runTaskMutation: <T>(
                taskIds: readonly string[],
                operation: () => Promise<T>
              ) =>
                taskInspectorActivityRuntime
                  ? taskInspectorActivityRuntime.runTaskMutation(
                      taskIds,
                      operation
                    )
                  : operation(),
              log,
            }
          )
          // Nothing was published and nothing is durable: leave the prior
          // in-memory state (and its aria2 row) alone so the next poll
          // observes the same delta and retries.
          if (outcome === 'persist-failed' || outcome === 'stale') continue
          publishedTerminal = outcome === 'published'
          if (
            outcome === 'not-terminal' &&
            shouldTriggerTransitionSave(existing.status, merged.status)
          ) {
            // Capture mirror snapshot before aria2_motrix may zero fields.
            // requestSave coalesces with neighboring transitions in the
            // same poll tick (e.g. several tasks flipping Queued →
            // Downloading on the first active poll) so this stays cheap.
            void sessionManager
              .requestSave()
              .catch((err) =>
                log.warn({ err, taskId: existing.id }, 'transition save failed')
              )
          }
          if (
            !hasLegacyImport(existing) &&
            shouldEvictFromEngine(
              existing.status,
              merged.status,
              existing.type,
              existing
            )
          ) {
            // Either BT/Magnet seeding just satisfied its ratio/time target,
            // or the task just landed in Error (see shouldEvictFromEngine).
            // For Error this is in-session hygiene — the task row is already
            // durable via commitPolledTerminalTransition, and the restore
            // shield in SessionManager is what stops the per-boot duplicate
            // notification. Order matters:
            //   1. requestSave so announceList / isPrivate / file
            //      structure are durable — adoptByMetadata reads these
            //      to rebuild task.bt for the Trackers/Files tabs after
            //      the aria2 row is gone. Coalescing matters here: a burst
            //      of same-tick Error transitions (host down → 50 tasks
            //      fail at once) folds into one save instead of N full
            //      flushes.
            //   2. removeDownloadResult to purge aria2.db's
            //      `download_history` + session row so the next launch
            //      doesn't reload it.
            // Promise chained so save→remove run sequentially without
            // blocking the polling loop. See SessionManager.restore Pass 2.
            runShellAsyncWork('terminal engine eviction', async () => {
              try {
                await sessionManager.requestSave()
                if (!mainProcessWork.isAccepting()) return
                await aria2Adapter.removeDownloadResult(merged.engineTaskId)
              } catch (err) {
                log.warn(
                  {
                    err,
                    taskId: existing.id,
                    gid: merged.engineTaskId,
                  },
                  'terminal engine eviction failed'
                )
              }
            })
          }
        }
        // Sync task_files whenever the engine reports a non-empty file
        // list — covers BT/magnet metadata arrival, fresh tasks, AND
        // legacy tasks restored from a prior session where the auto-sync
        // trigger never ran, plus placeholder rows written by older magnet
        // swaps. The helper validates structural completeness before its
        // early-exit, so the steady-state cost remains ~one prepared query.
        if (!publishedTerminal && taskManager.getById(existing.id) !== existing)
          continue
        if (merged.fileCount > 0) {
          runShellAsyncWork('task-files sync', () =>
            syncTaskFilesIfIncomplete(existing.id, merged.engineTaskId)
          )
        }
        if (!publishedTerminal) taskManager.set(existing.id, merged)
        dirty = true
      }
    } else {
      const id = newTaskId()
      const discoveredTask: DownloadTask = { ...translated, id }
      const persistParent = (): Promise<void> => persistTask(discoveredTask)
      try {
        if (taskInspectorActivityRuntime) {
          await taskInspectorActivityRuntime.parentTaskCreated(
            discoveredTask,
            persistParent
          )
        } else {
          await persistParent()
        }
      } catch (err) {
        // Nothing has been published yet. Leave the engine row ownerless so
        // the next poll retries the complete parent write with no Activity FK
        // race and no in-memory task that would disappear after restart.
        log.warn(
          { err, gid: raw.gid, taskId: id },
          'engine task adoption failed'
        )
        continue
      }
      taskManager.set(id, discoveredTask)
      log.info(
        { gid: raw.gid, taskId: id, name: translated.name },
        'new task discovered from engine'
      )
      // The complete parent is durable now, so FK-backed sidecars can be
      // written immediately instead of waiting for a later batch save.
      if (translated.fileCount > 0) {
        runShellAsyncWork('task-files orphan sync', () =>
          syncTaskFilesIfIncomplete(id, raw.gid)
        )
      }
      dirty = true
    }
  }
  // Publish the full task snapshot (the publisher snapshots getAll() at
  // flush time — the same array this tick just reconciled) so the renderer
  // applies it directly without an IPC round-trip back for ListTasks.
  // Skip publication when nothing changed.
  const tasks = taskManager.getAll()
  if (source === 'authoritative-poll') {
    await taskInspectorActivityRuntime?.recordAuthoritativeReconnectAnchors(
      tasks
    )
  }
  taskInspectorActivityRuntime?.recordSamples(tasks)
  if (dirty) publishTaskUpdate()
}

async function syncTaskFilesIfIncomplete(
  taskId: string,
  engineTaskId: string
): Promise<void> {
  try {
    const persisted = motrixDb.getTaskFiles(taskId)
    // Magnet confirmation persists selected indices immediately, before the
    // replacement aria2 task has exposed real paths. Treat those placeholder
    // rows as missing so the first authoritative file list replaces them.
    if (persisted.length > 0 && persisted.every((file) => file.path !== '')) {
      return
    }
    // task_files has FK on task_metadata.motrix_id. The metadata row is
    // written by the periodic SessionManager.save() (15s default) — for
    // a freshly-created task, polling fires the file sync each tick from
    // T0 onwards, but the metadata row only lands at T0+15s at the
    // earliest. Until then any insert into task_files trips
    // SQLITE_CONSTRAINT_FOREIGNKEY. Bail out quietly here; the next tick
    // after the first auto-save flush will succeed.
    if (motrixDb.getTask(taskId) === null) return
    const live = await aria2Adapter.getTaskFiles(engineTaskId)
    if (!mainProcessWork.isAccepting()) return
    if (live.length === 0) return
    motrixDb.replaceTaskFiles(
      taskId,
      live.map((f) => ({
        fileIndex: f.index,
        path: f.path,
        size: f.size,
        selected: f.selected,
      }))
    )
    eventBus.emit(Events.TaskFilesUpdated, { taskId })
  } catch (err) {
    log.warn({ err, taskId }, 'task_files initial sync failed')
  }
}

function rebaseTaskFilePaths(
  taskId: string,
  sourceRoot: string,
  finalRoot: string
): void {
  const rows = motrixDb.getTaskFiles(taskId)
  let changed = false
  const rebased = rows.map((row) => {
    if (!row.path) return row
    const relative = path.relative(sourceRoot, row.path)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return row
    changed = true
    return {
      ...row,
      path: relative === '' ? finalRoot : path.join(finalRoot, relative),
    }
  })
  if (!changed) return
  motrixDb.replaceTaskFiles(taskId, rebased)
  eventBus.emit(Events.TaskFilesUpdated, { taskId })
}

// ─── Task persistence / finalize wiring ─────────────────

/**
 * `finalizeTask` and `TaskRecoveryService` expect a `taskManager` with
 * per-task `persist(task)` semantics. Our real `TaskManager` is
 * in-memory; durable persistence runs through `SessionManager.save()`
 * in batch. The shim writes the task back into `TaskManager` so polling
 * and subsequent reads see the mutation, and relies on the session
 * auto-save loop to flush to sqlite. Callers never await sqlite I/O on
 * the hot path.
 */
// Update the in-memory task and flush to motrix.db. finalizeTask /
// TaskRecoveryService call this on discrete state changes (completion, reseed,
// error, adopt), so persistence must NOT depend on the periodic auto-save —
// especially now that the auto-save is gated off while the engine is idle, and
// Downloading→Completed is not in TRANSITION_SAVE_PAIRS. This is also the
// hard durability barrier before rename/reseed side effects: saveTask() is
// serialized and rejects on SQLite failure, whereas requestSave() deliberately
// logs-and-resolves for fire-and-forget UI/polling snapshots.
let nexusNetworkMarker: NexusNetworkMarker | undefined
let drainNexusData: (() => Promise<void>) | undefined
let markRestoredNexusFiles: (() => Promise<void>) | undefined
let recordNexusCompletion: ((fileCount: number) => Promise<void>) | undefined

function persistTask(task: DownloadTask): Promise<void> {
  return sessionManager.persistTask(task)
}

/**
 * Same durable barrier as `persistTask`, but additionally appends the task's
 * terminal occurrence (when non-null) to the outbox in the SAME SQLite
 * transaction. Passed as `persistTaskWithOccurrence` to every commit path
 * that can reach Completed/Error (finalize, recovery, magnet tracker, the
 * generic task-action deps) INSTEAD OF `persistTask`.
 */
function persistTaskWithOccurrence(
  task: DownloadTask,
  occurrence: TaskOccurrence | null
): Promise<void> {
  if (occurrence && pluginHookRuntime) {
    return pluginHookRuntime.persistTerminal(task, occurrence)
  }
  return sessionManager.persistTaskWithOccurrence(task, occurrence)
}

/**
 * Settings shim exposing the `{ bt: { seedTime, seedRatio } }` shape
 * `finalizeTask` expects. Reads the live `EngineSettings` so user
 * changes via the Settings UI are honored on every reseed (the
 * function is invoked per-finalize, not memoized).
 *
 * Units match aria2's RPC contract: `seedTime` is minutes, `seedRatio`
 * is a unit-less share ratio.
 */
function getFinalizeSettings(): {
  bt: { seedTime: number; seedRatio: number }
} {
  const engine = settingsManager.getEngine()
  return {
    bt: { seedTime: engine.seedTime, seedRatio: engine.seedRatio },
  }
}

function buildFinalizeDeps(adapter: Aria2Adapter) {
  const activityRecorder = requireTaskActivityService()
  if (!hookAuditLog || !hookOrchestrator) {
    throw new Error('plugin hook orchestrator is unavailable')
  }
  return {
    taskManager: {
      getById: (id: string) => taskManager.getById(id),
      getAll: () => taskManager.getAll(),
      set: (id: string, task: DownloadTask) => taskManager.set(id, task),
      setReservedEngineTaskOwner: (
        id: string,
        task: DownloadTask,
        engineTaskId: string
      ) => taskManager.setReservedEngineTaskOwner(id, task, engineTaskId),
      reserveEngineTaskId: (engineTaskId: string) =>
        taskManager.reserveEngineTaskId(engineTaskId),
      releaseEngineTaskIdReservation: (engineTaskId: string) =>
        taskManager.releaseEngineTaskIdReservation(engineTaskId),
      retireEngineTaskIdReservation: (engineTaskId: string) =>
        taskManager.retireEngineTaskIdReservation(engineTaskId),
      persist: persistTask,
    },
    persistTaskWithOccurrence,
    occurrenceDispatcher,
    publishTaskUpdate,
    publishTaskUpdateNow,
    adapter,
    fs: { renameAtomic, removePathRecursive },
    torrentMetaStore,
    rebaseTaskFilePaths,
    settings: { get: getFinalizeSettings },
    eventBus,
    activityRecorder,
    orchestrator: hookOrchestrator,
    auditLog: hookAuditLog,
    recordTransition: (input: RuntimeTransitionInput) =>
      taskInspectorActivityRuntime?.recordTransition(input),
    runTaskMutation: <T>(
      taskIds: readonly string[],
      operation: () => Promise<T>
    ) =>
      taskInspectorActivityRuntime
        ? taskInspectorActivityRuntime.runTaskMutation(taskIds, operation)
        : operation(),
    log,
    finalNamePicker,
    commitFinalizedArtifact: async (input: FinalizeArtifactCommitRequest) => {
      if (!durableFinalizeRuntime) {
        throw new Error('durable finalize runtime is unavailable')
      }
      const post =
        input.occurrence?.type === 'terminal' && pluginHookRuntime
          ? await pluginHookRuntime.prepareTerminal(
              input.task,
              input.occurrence
            )
          : { postDeliveries: [], beforeCommit: () => undefined }
      await durableFinalizeRuntime.commit({
        ...input,
        postDeliveries: post.postDeliveries,
        beforeCommit: () => {
          input.beforeCommit?.()
          post.beforeCommit()
        },
      })
      if (!input.occurrence) await nexusNetworkMarker?.mark(input.task)
    },
  }
}

// ─── Engine Start & Session Restore ─────────────────────

// Resolved once the startup sequence (engine start → SessionManager.restore()
// → TaskRecoveryService → event/polling wiring) has fully settled — on both
// success AND failure paths (see the .finally at the call site, which is the
// only resolver). createTask paths (UI IPC + bridge submits) await this
// before dispatching to the engine: a create that races restore() puts its
// gid into aria2, restore's clear() then wipes the freshly-registered task,
// and Pass 1 re-adopts the gid as an engine orphan — name keeps the `.motrix`
// placeholder, source flips to 'user', sourceMeta is lost, and the taskId
// already acked to the extension points at a task that no longer exists.
async function startEngineAndRestore(
  sessionSaveInterval: number,
  adapter: Aria2Adapter
) {
  log.info({ binaryPath: platform.aria2BinaryPath }, 'resolved aria2 binary')

  // Engine-incident notifications (Task 13): wired BEFORE supervisor.start()
  // — same must-reach ordering as the occurrence consumers registered
  // below; see the notificationCenter construction comment in
  // initializeMainProcess (Phase 2) for the full rationale. Grace-clean
  // stale engine-scoped ledger rows FIRST (no replay source for an
  // EngineFailurePayload survives a boot — its incidentId is only unique
  // within the boot that produced it), THEN subscribe.
  registerEngineFailureSubscriber({
    motrixDb,
    eventBus,
    notificationCenter,
    log,
  })
  registerEngineCompatibilitySubscriber({
    eventBus,
    notificationCenter,
    log,
  })

  // ─── occurrence consumer registration ─────────────────
  // F5: registered here, BEFORE supervisor.start() and its two early
  // returns below. See the notificationCenter construction comment in
  // initializeMainProcess (Phase 2) for the full must-reach ordering
  // rationale.
  occurrenceDispatcher.register('task-inspector-activity-timeline', (occ) =>
    taskInspectorActivityRuntime?.recordOccurrence(occ)
  )
  const failureLogConsumer = createFailureLogConsumer(log)
  occurrenceDispatcher.register(
    failureLogConsumer.name,
    failureLogConsumer.consume
  )
  const notificationConsumer = createNotificationOccurrenceConsumer({
    center: notificationCenter,
    getTaskName: (id) => taskManager.getById(id)?.name ?? null,
  })
  occurrenceDispatcher.register(notificationConsumer.name, (occ) =>
    occ.type === 'terminal' && occ.toStatus === TaskStatus.Completed
      ? undefined
      : notificationConsumer.consume(occ)
  )
  dnsFallbackConsumer = createDnsFallbackConsumer({
    getDnsMode: () => settingsManager.get().engine.dnsMode,
    getTaskStatus: (id) => taskManager.getById(id)?.status ?? null,
    getTaskName: (id) => taskManager.getById(id)?.name ?? null,
    applyAsyncDns: (asyncDns) => supervisor.applyAsyncDns(asyncDns),
    reAddTask: (id) =>
      dnsFallbackRetry
        ? dnsFallbackRetry(id)
        : Promise.reject(new Error('dns fallback task retry not bound')),
    notify: (input) => notificationCenter.notify(input),
    log: getLogger('dns-fallback'),
  })
  occurrenceDispatcher.register(
    dnsFallbackConsumer.name,
    dnsFallbackConsumer.consume
  )

  const pluginStartup = new PluginRuntimeStartupCoordinator()
  await pluginStartup.recoverFinalize(async () => {
    if (!durableFinalizeRuntime) {
      throw new Error('durable finalize runtime is unavailable')
    }
    await durableFinalizeRuntime.recoverAll()
  })

  try {
    await supervisor.start(platform.aria2BinaryPath)
  } catch (err) {
    log.error({ err }, 'engine start failed')
    // F5: must-reach drain — see the notificationCenter construction
    // comment in initializeMainProcess (Phase 2) for the full rationale.
    await occurrenceDispatcher.drainAtStartup()
    return
  }

  if (supervisor.getState() !== EngineState.Ready) {
    log.error(
      { state: supervisor.getState(), error: supervisor.getLastError() },
      'engine not ready, skipping session restore'
    )
    // F5: same must-reach guarantee as the start()-throw branch above.
    await occurrenceDispatcher.drainAtStartup()
    return
  }

  try {
    await appliedDownloadProxyPolicy.runWithSnapshot(
      async (_snapshot, lease) => {
        await legacyBtActivationService?.recover()
        await legacyHttpActivationService?.recover()
        await sessionManager.restore(lease.assertCurrent, (snapshot) =>
          completedEngineTaskCleanup.observe(snapshot)
        )
        await sessionManager.recoverLegacyTaskLost(lease.assertCurrent)
      }
    )

    // Plan B: re-prime MagnetTracker's in-memory cache from the
    // restored db state so polling skips magnet metadata GIDs and
    // quarantine tombstones survive across restart.
    magnetTracker?.primeFromDatabase()

    // Backfill task_files for restored BT tasks that never had a chance
    // to sync (legacy tasks created before the auto-sync trigger landed,
    // or tasks where the prior session crashed before the trigger ran).
    // Fire-and-forget per task — TaskFilesUpdated events refresh the UI
    // when each completes; we don't block startup.
    for (const task of taskManager.getAll()) {
      if (!task.bt) continue
      if (task.fileCount === 0) continue
      runShellAsyncWork('startup task-files sync', () =>
        syncTaskFilesIfIncomplete(task.id, task.engineTaskId)
      )
    }

    // Run startup recovery BEFORE polling/event subscriptions open.
    // TaskRecoveryService scans tasks whose `transitionPhase !== Idle`
    // (or `status === Finalizing`) and replays the correct recovery
    // action (rename, reseed, adopt, mark completed/error) so the
    // renderer observes a self-healed state as soon as updates start
    // flowing. See design spec §6.6.
    const finalizeDepsFactory = () => buildFinalizeDeps(adapter)
    recoveryService = new TaskRecoveryServiceImpl({
      canRecoverAutomatically: (task) =>
        !portableProfile ||
        task.errorDetailKey !== 'task.recovery.startup.portableExternalPath',
      hasPendingFinalization: async (taskId) =>
        (await durableFinalizeRuntime?.hasPendingFinalization(taskId)) ?? false,
      taskManager: {
        getAll: () => taskManager.getAll(),
        set: (id: string, task: DownloadTask) => taskManager.set(id, task),
        persist: persistTask,
      },
      persistTaskWithOccurrence,
      occurrenceDispatcher,
      db: motrixDb,
      adapter: {
        listActiveAndWaiting: () => adapter.listActiveAndWaiting(),
      },
      fs: defaultRecoveryFs,
      finalizeTask: (taskId, recoverySha256) =>
        finalizeTask(taskId, { ...finalizeDepsFactory(), recoverySha256 }),
      activityRecorder: requireTaskActivityService(),
      recordTransition: (input: RuntimeTransitionInput) =>
        taskInspectorActivityRuntime?.recordTransition(input),
      runTaskMutation: <T>(
        taskIds: readonly string[],
        operation: () => Promise<T>
      ) =>
        taskInspectorActivityRuntime
          ? taskInspectorActivityRuntime.runTaskMutation(taskIds, operation)
          : operation(),
      log,
    })

    const recoveredAnchorOrigins =
      taskInspectorActivityRuntime?.captureRecoveredAnchorOrigins(
        taskManager.getAll()
      )
    const report = await recoveryService.recoverOnStartup()
    if (taskInspectorActivityRuntime && recoveredAnchorOrigins) {
      await taskInspectorActivityRuntime.recordRecoveredAnchors(
        taskManager.getAll(),
        recoveredAnchorOrigins
      )
    }
    log.info(
      { report, restoredTaskCount: taskManager.getAll().length },
      'startup_recovery_done'
    )
    if (report.warnings.length > 0 || report.errors.length > 0) {
      eventBus.emit(Events.ToastShow, {
        key: 'task.recovery.toast',
        params: { count: report.totalScanned },
      })
    }

    // Shutdown may have gated work while restore/recovery was awaiting SQLite
    // or filesystem operations. Do not install fresh producers after cleanup
    // already unsubscribed and stopped polling; the tracked startup promise
    // still settles so accepted queries can drain before Activity/DB teardown.
    if (!mainProcessWork.isAccepting()) return

    // The renderer can mount before Phase 3 starts and its first ListTasks IPC
    // can either wait on this restore or race handler registration entirely.
    // Publish the authoritative post-recovery snapshot as well as releasing
    // the query barrier so both paths converge on the restored task list.
    // publishNow: startup's first paint must not wait out the window.
    publishTaskUpdateNow()

    const activePluginHookRuntime = pluginHookRuntime
    if (!activePluginHookRuntime) {
      throw new Error('plugin hook runtime is unavailable')
    }
    await markRestoredNexusFiles?.()
    pluginStartup.markTasksRecovered()
    await pluginStartup.drainBeforeProducers({
      drainOccurrences: () => occurrenceDispatcher.drainAtStartup(),
      recoverAndDrainPostDeliveries: () =>
        activePluginHookRuntime.recoverAndDrain(),
    })
    if (!postDeliveryLoop) {
      const controller = new AbortController()
      postDeliveryAbortController = controller
      postDeliveryLoop = activePluginHookRuntime.scheduler
        .start(controller.signal)
        .catch((err) => {
          if (!controller.signal.aborted) {
            log.error({ err }, 'plugin post-delivery scheduler stopped')
          }
        })
    }

    // Subscribe to engine completion events so newly-finished tasks
    // are finalized (rename `.motrix` → final name; BT re-adds with
    // `bt-seed-unverified=true`). These trigger AFTER recovery so
    // in-flight finalizes from a previous run are settled first and
    // we don't race a second finalize on the same task.
    pluginStartup.openProducers(() => {
      adapter.onBtDownloadComplete((engineTaskId) => {
        runShellAsyncWork('BT finalize', async () => {
          const task = taskManager.getByEngineTaskId(engineTaskId)
          if (!task) return
          // Re-entry guard. After finalizeBt re-adds the seeding gid with
          // `bt-seed-unverified=true`, aria2 marks every piece complete at
          // add time and immediately re-fires onBtDownloadComplete for the
          // brand-new gid. Without this guard, the handler runs finalizeBt
          // again on the SAME motrix task — forceRemove(newGid),
          // addTorrent → newer gid, which itself re-fires the event,
          // ad infinitum. The chain only breaks when something throws
          // (rename-to-self, FK violation in task_progress, etc.), and the
          // last gid that survives the storm is the one that ends up
          // seeding from upload_length=0 — explaining the user-reported
          // "Completed → Seeding → Completed restart loop": each restart
          // resumes the freshly-added survivor whose progress row has
          // never accumulated any uploaded bytes.
          //
          // Sentinel "this task is past finalize":
          //   • Renamed already (diskPath stripped of .motrix), AND
          //   • Not currently in the middle of a finalize cycle
          //     (status !== Finalizing && transitionPhase === Idle).
          if (shouldSkipEngineCompletionFinalize(task)) {
            log.debug(
              {
                taskId: task.id,
                engineTaskId,
                status: task.status,
                transitionPhase: task.transitionPhase,
              },
              'skip finalize for already-finalized or in-flight BT task'
            )
            return
          }
          try {
            await finalizeTask(task.id, finalizeDepsFactory())
          } catch (err) {
            log.error({ err, taskId: task.id }, 'finalizeTask failed (BT)')
          }
        })
      })

      adapter.onDownloadComplete((engineTaskId) => {
        runShellAsyncWork('HTTP finalize', async () => {
          const task = taskManager.getByEngineTaskId(engineTaskId)
          if (!task) return
          // BT tasks emit `onDownloadComplete` again after seeding finishes;
          // route only HTTP/FTP here. BT finalize runs via onBtDownloadComplete.
          if (
            task.type !== TaskType.Http &&
            task.type !== TaskType.Ftp &&
            !hasLegacyImport(task)
          ) {
            return
          }
          if (hasLegacyImport(task) && task.type === TaskType.Http) {
            await completedEngineTaskCleanup.observe({
              ...task,
              status: TaskStatus.Completed,
            })
            return
          }
          if (shouldSkipEngineCompletionFinalize(task)) return
          try {
            await finalizeTask(task.id, finalizeDepsFactory())
          } catch (err) {
            log.error({ err, taskId: task.id }, 'finalizeTask failed (HTTP)')
          }
        })
      })

      sessionManager.startAutoSave(sessionSaveInterval * 1000)
      // Gate the periodic save on engine activity. The scheduler derives
      // active/idle from aria2 getGlobalStat.numActive and broadcasts it here;
      // the save only flushes in-progress byte counts (which change only while
      // active), so idle ⇒ stop rewriting the whole task history every interval.
      eventBus.on(Events.EngineActiveChanged, (active) => {
        sessionManager.setEngineActive(Boolean(active))
      })

      pollingNotificationUnsubscribers.push(
        rpcClient.onDownloadStart((event) => {
          pollingScheduler.handleNotification('aria2.onDownloadStart', event)
        }),
        rpcClient.onDownloadPause((event) => {
          pollingScheduler.handleNotification('aria2.onDownloadPause', event)
        }),
        rpcClient.onDownloadComplete((event) => {
          pollingScheduler.handleNotification('aria2.onDownloadComplete', event)
        }),
        rpcClient.onDownloadStop((event) => {
          pollingScheduler.handleNotification('aria2.onDownloadStop', event)
        }),
        rpcClient.onDownloadError((event) => {
          pollingScheduler.handleNotification('aria2.onDownloadError', event)
        }),
        rpcClient.onBtDownloadComplete((event) => {
          pollingScheduler.handleNotification(
            'aria2.onBtDownloadComplete',
            event
          )
        })
      )

      pollingScheduler.start()
    })
  } catch (err) {
    log.error({ err }, 'post-engine setup failed')
  }
}

// ─── Startup Sequence ───────────────────────────────────

async function initializeMainProcess(): Promise<void> {
  if (!app.hasSingleInstanceLock()) return
  try {
    processGuardian = await startProcessGuardian(platform.userDataDir)
  } catch (err) {
    log.error({ err }, 'process guardian startup failed')
    dialog.showErrorBox('NexusDownload', i18n.t('nexus.v12.processGuardFailed'))
    app.exit(1)
    return
  }
  const updateHelperSource = app.isPackaged
    ? path.join(process.resourcesPath, 'nexus-updater.ps1')
    : path.join(app.getAppPath(), 'extra/nexus-updater.ps1')
  if (
    portableProfile &&
    processGuardian &&
    (await scheduleInterruptedRecovery(
      portableProfile,
      updateHelperSource,
      processGuardian,
      app.getVersion()
    ))
  ) {
    requestForcedQuit('interrupted-update-recovery')
    return
  }
  // ── Phase 1: Show window ASAP ─────────────────────────────
  // Only the minimum work needed before the window can open:
  // settings (for window bounds/run mode) and WindowManager.

  if (portableProfile) {
    if (!app.hasSingleInstanceLock()) return
    try {
      await relocatePortableProfile(
        portableProfile,
        motrixDb.database,
        (roots, target) =>
          relocateEncryptedJobs(
            portableProfile.userDataDir,
            roots,
            target,
            cloudCipher
          )
      )
    } catch (error) {
      throw new PortableProfileError('Portable startup recovery failed', {
        cause: error,
      })
    }
  }
  await settingsManager.load()
  if (graphicsRuntime?.recovery.recoveredAtStartup) {
    await settingsManager.update({ app: { hardwareAcceleration: false } })
    graphicsRuntime.recovery.completeRecovery()
  }
  pluginHttpClient = new PluginHttpClient(() => settingsManager.getProxy())
  if (!mainProcessWork.isAccepting()) return

  let pluginLocaleTargets: {
    registry: PluginRegistry
    capabilityHost: { setLocale(locale: SupportedLocale): void }
  } | null = null
  let localeContextStore: ContextStore | null = null
  const localeCoordinator = new LocaleCoordinator({
    initialLocale: resolvedApplicationLocale,
    onAppliedLocale: (locale) => {
      // Window routes expose only a fully-published locale. A window created
      // during prepare starts on the previous locale and converges through
      // the buffered LocaleChanged event after commit.
      resolvedApplicationLocale = locale
    },
    applyLocale: async (locale, isCurrent) => {
      const targets = pluginLocaleTargets
      if (targets) {
        await targets.registry.setHostLanguageTransaction(locale, {
          beforeCommit: async () => {
            await applyMainLocale(locale)
          },
          commitHostLocale: () => {
            targets.capabilityHost.setLocale(locale)
          },
          rollbackHostLocale: async (previousLanguage) => {
            targets.capabilityHost.setLocale(previousLanguage)
            await applyMainLocale(previousLanguage)
          },
          shouldCommit: isCurrent,
        })
      } else {
        await applyMainLocale(locale)
      }
      if (!isCurrent()) return
      localeContextStore?.merge({ locale })
    },
    emitLocaleChanged: (language) => {
      eventBus.emit(Events.LocaleChanged, { language })
    },
  })

  const enqueueLocaleUpdate = (
    language: string,
    emitChange: boolean
  ): Promise<void> =>
    localeCoordinator.update(resolvePluginHostLanguage(language), emitChange)

  await enqueueLocaleUpdate(settingsManager.getApp().language, false)
  eventBus.on(Events.SettingsChanged, (payload: unknown) => {
    const { old, updated } = payload as {
      old: AppSettings
      updated: AppSettings
    }
    if (old.app.language === updated.app.language) return
    runShellAsyncWork('locale update', () =>
      enqueueLocaleUpdate(updated.app.language, true)
    )
  })

  // Apply env-driven settings overrides for e2e harnesses.
  //
  // - MOTRIX_RPC_PORT lets each test pick a free random port so it
  //   doesn't clash with a developer's running aria2 instance.
  // - MOTRIX_DEFAULT_SAVE_DIR redirects aria2's output away from the user's
  //   platform Downloads directory (SettingsManager.seedSentinels uses that
  //   when defaultSaveDir is empty), preventing test files from leaking into
  //   the developer's real download directory.
  //
  // Both are persisted into the (tmp) settings file under
  // MOTRIX_USER_DATA, which is itself per-test. They are merged into
  // a single update() call so the settings file is written once
  // rather than twice on startup.
  const enginePatch: Partial<{ rpcPort: number }> = {}
  const appPatch: Partial<{ defaultSaveDir: string }> = {}

  const rpcPortOverride = process.env.MOTRIX_RPC_PORT
  if (rpcPortOverride) {
    const port = Number.parseInt(rpcPortOverride, 10)
    if (Number.isFinite(port) && port > 0 && port < 65536) {
      enginePatch.rpcPort = port
    }
  }

  const defaultSaveDirOverride = process.env.MOTRIX_DEFAULT_SAVE_DIR
  if (defaultSaveDirOverride) {
    appPatch.defaultSaveDir = defaultSaveDirOverride
  }

  if (Object.keys(enginePatch).length > 0 || Object.keys(appPatch).length > 0) {
    await settingsManager.update({
      ...(Object.keys(enginePatch).length > 0 && { engine: enginePatch }),
      ...(Object.keys(appPatch).length > 0 && { app: appPatch }),
    })
    if (!mainProcessWork.isAccepting()) return
  }

  const engineSettings = settingsManager.getEngine()

  const gate = new DisclaimerGate({
    settings: settingsManager,
  })
  pendingDisclaimerGate = gate.isAccepted() ? null : gate
  const liquidGlass = new LiquidGlassController({ settingsManager })
  rendererRecovery = createRendererRecoveryRuntime({
    windows: () => windowManager,
    logDirectory: logDir,
    isMagnetSelectionPending: (taskId) =>
      taskManager.getById(taskId)?.status === TaskStatus.MetadataReady,
  })
  windowManager = new WindowManager({
    lifecycle: rendererRecovery.supervisor,
    canPrewarm: () => rendererRecovery?.supervisor.canPrewarm ?? true,
    deliverAddTask: (options) => {
      rendererRecovery?.intents.deliver(
        'add-task',
        Events.SetAddTaskMode,
        options
      )
    },
    onUserDismiss: (id) => {
      rendererRecovery?.intents.clear(id)
      rendererRecovery?.submissions.dismiss(id)
      if (id === 'main') trayHandle?.showCloseNotice?.()
      if (id === 'add-task') protocolManager.resetDialogState()
      if (id === 'onboarding' && !gate.isAccepted())
        requestForcedQuit('onboarding-window-closed')
    },
    settingsManager,
    preloadPath: path.join(__dirname, '../preload/preload.cjs'),
    iconPath:
      process.platform === 'win32'
        ? path.join(platform.extraResourceDir, 'nexus/app-icon.ico')
        : undefined,
    loadUrl: loadWindowUrl,
    liquidGlass,
    rendererUrlPolicy,
    resolveOpenTarget: (requested) =>
      !gate.isAccepted() && requested !== 'onboarding'
        ? 'onboarding'
        : requested,
    onSessionEnd: prepareForSessionEnd,
    retentionPolicy: {
      releaseMainOnDismiss: () => {
        const appSettings = settingsManager.getApp()
        return resolveDesktopBackgroundPolicy({
          lightweightMode: appSettings.lightweightMode,
          platform: process.platform,
          runMode: appSettings.runMode,
        }).releaseMainWindowWhenHidden
      },
      prewarmAddTask: () => !settingsManager.getApp().lightweightMode,
    },
  })
  // Apply the persisted theme before opening windows and keep native Linux
  // caption symbols readable over the renderer's changing title-bar surface.
  const nativeThemeSync = setupNativeThemeSync(
    eventBus,
    settingsManager,
    (dark) => windowManager.updateWindowControlsTheme(dark)
  )
  app.once('will-quit', () => nativeThemeSync.destroy())
  const systemAccentSync = setupSystemAccentColorSync(eventBus)
  app.once('will-quit', () => systemAccentSync.destroy())
  // Install forwarding before the onboarding window becomes interactive.
  // SetDisclaimerLanguage persists before its asynchronous locale transaction
  // completes; an immediate AcceptDisclaimer can open the main window in that
  // interval. Early forwarding guarantees the eventual LocaleChanged reaches
  // either the onboarding window or the newly-opened main window (whose
  // preload buffers it until React subscribes).
  setupEventForwarding(
    eventBus,
    windowManager,
    () => getHiddenNotificationKinds(settingsManager.getApp()),
    rendererRecovery.intents
  )

  // Subscribe before notification-center replay. Resolve task paths on click
  // so notifications follow any output moves made after download completion.
  const revealNotificationTask = createRevealInFolderHandler({
    shell,
    getTask: (taskId) => taskManager.getById(taskId),
  })
  osNotificationBridge = createOsNotificationBridge({
    subscribe: (channel, listener) =>
      eventBus.on(channel, (...args: unknown[]) =>
        listener(args[0] as AppNotification)
      ),
    getMainWindow: () => windowManager?.get('main') ?? null,
    showMainWindow: () => windowManager?.show('main'),
    getAppSettings: () => settingsManager.getApp(),
    translate: (key, params = {}) => i18n.t(key, params),
    getTaskStatus: (taskId) => taskManager.getById(taskId)?.status ?? null,
    navigateToTask,
    navigateToDownloads: () => {
      const win = windowManager?.get('main')
      if (!win || win.isDestroyed()) return
      dispatchWhenReady(win, Events.NavigateTo, ALL_DOWNLOADS_ROUTE)
    },
    revealTaskInFolder: (taskId) => revealNotificationTask({ taskId }),
    log,
  })

  // OS logout/shutdown: skip the quit dialog so session end is never blocked.
  powerMonitor.on('shutdown', prepareForSessionEnd)
  powerMonitor.on('resume', () => {
    trackerManager?.notifyWake()
    pluginHost?.notifySecurityWake()
  })

  const legacyBackupRoot = path.join(
    platform.userDataDir,
    'legacy-import-backups'
  )
  const getLegacyImportService = () => {
    if (!gate.isAccepted())
      throw new Error('legacyImport.errors.consentRequired')
    if (!legacyImportService) {
      motrixDb.init()
      legacyImportService = new LegacyImportService({
        db: motrixDb,
        taskManager,
        backupRoot: legacyBackupRoot,
        isProcessRunning: legacyPidRunning,
        publishTasks: publishTaskUpdateNow,
      })
    }
    return legacyImportService
  }
  const legacyNavigation = new LegacyImportNavigation({
    hasConsent: () => gate.isAccepted() && mainProcessWork.isAccepting(),
    getService: getLegacyImportService,
    roots: portableProfile ? () => [] : defaultLegacyRoots,
    changed: () => {
      const mainWindow = windowManager?.get('main')
      if (mainWindow)
        dispatchWhenReady(
          mainWindow,
          Events.LegacyImportNavigationChanged,
          undefined
        )
    },
  })
  const navigateToMigration = () => {
    const mainWindow = windowManager?.get('main')
    if (mainWindow)
      dispatchWhenReady(
        mainWindow,
        Events.NavigateTo,
        LEGACY_MIGRATION_INVITATION_ROUTE
      )
  }
  const finishLegacyChoice = () => {
    legacyNavigation.finishInvitation()
  }
  const getLegacyBtActivationService = () => {
    if (!legacyBtActivationService) {
      getLegacyImportService()
      legacyBtActivationService = new LegacyBtActivationService({
        db: motrixDb,
        taskManager,
        adapter,
        backupRoot: legacyBackupRoot,
        isProcessRunning: legacyPidRunning,
        publishTasks: publishTaskUpdateNow,
        runTaskMutation: (taskIds, operation) =>
          taskInspectorActivityRuntime
            ? taskInspectorActivityRuntime.runTaskMutation(taskIds, operation)
            : operation(),
        runExclusivePersistence: (operation) =>
          sessionManager
            ? sessionManager.runExclusivePersistence(operation)
            : Promise.resolve().then(operation),
      })
    }
    return legacyBtActivationService
  }
  const getLegacyHttpActivationService = () => {
    if (!legacyHttpActivationService) {
      getLegacyImportService()
      legacyHttpActivationService = new LegacyHttpActivationService({
        proxyPolicy: appliedDownloadProxyPolicy,
        db: motrixDb,
        taskManager,
        adapter,
        backupRoot: legacyBackupRoot,
        isProcessRunning: legacyPidRunning,
        publishTasks: publishTaskUpdateNow,
        runTaskMutation: (taskIds, operation) =>
          taskInspectorActivityRuntime
            ? taskInspectorActivityRuntime.runTaskMutation(taskIds, operation)
            : operation(),
        runExclusivePersistence: (operation) =>
          sessionManager
            ? sessionManager.runExclusivePersistence(operation)
            : Promise.resolve().then(operation),
      })
    }
    return legacyHttpActivationService
  }
  const disposeLegacyImportIpc = registerLegacyImportIpc({
    getActivationService: getLegacyBtActivationService,
    getHttpActivationService: getLegacyHttpActivationService,
    getService: getLegacyImportService,
    hasConsent: () => gate.isAccepted() && mainProcessWork.isAccepting(),
    getTask: (taskId) => taskManager.getById(taskId),
    backupRoot: legacyBackupRoot,
    finishInvitation: finishLegacyChoice,
    getNavigationState: () => legacyNavigation.getState(),
    onSourceDetected: () => legacyNavigation.sourceDetected(),
    waitForTasksReady: () => mainProcessWork.waitForStartup(),
    runAcceptedMutation: (operation) => mainProcessWork.run(operation),
  })
  const beginLegacyInvitation = (): void => {
    runShellAsyncWork('legacy-import-discovery', async () => {
      await legacyNavigation.detect()
      if (
        !legacyNavigation.getState().invitationPending ||
        !gate.isAccepted() ||
        !mainProcessWork.isAccepting()
      )
        return
      legacyNavigation.finishInvitation()
      windowManager?.open('main', { show: true })
      navigateToMigration()
    })
  }
  const disposeDisclaimerIpc = registerDisclaimerIpc({
    gate,
    onAccepted: beginLegacyInvitation,
    getResolvedLanguage: () => resolvedApplicationLocale,
    applyLocale: (language) => enqueueLocaleUpdate(language, true),
    settings: settingsManager,
    windowManager,
    canContinue: () => mainProcessWork.isAccepting(),
    quitApp: () => requestForcedQuit('disclaimer-declined'),
  })
  disposeIpcIngress = () => {
    disposeDisclaimerIpc()
    disposeLegacyImportIpc()
  }

  if (gate.isAccepted()) {
    const runMode = settingsManager.getApp().runMode
    const backgroundPolicy = resolveDesktopBackgroundPolicy({
      lightweightMode: settingsManager.getApp().lightweightMode,
      platform: process.platform,
      runMode,
    })
    const mainWindowPlan = resolveMainWindowStartupPlan({
      openedAtLogin: launcher.wasOpenedAtLogin,
      showMainWindowAtLogin: settingsManager.getApp().showMainWindowAtLogin,
      runMode,
      releaseWhenHidden: backgroundPolicy.releaseMainWindowWhenHidden,
    })
    if (mainWindowPlan.create)
      windowManager.open('main', { show: mainWindowPlan.show })
    launcher.markWindowReady()
    beginLegacyInvitation()
  } else {
    const onboarding = windowManager.open('onboarding')
    onboarding?.once('ready-to-show', () => {
      if (portableProfile)
        void acknowledgePortableUpdateBoot(
          portableProfile,
          app.getVersion()
        ).catch((err) =>
          log.warn({ err }, 'portable update consent readiness failed')
        )
    })

    // A second launch must also be able to restore a minimized onboarding
    // window while download ingress is still waiting for legal acceptance.
    launcher.markWindowReady()
  }
  const decision = await gate.waitForDecision()
  if (decision !== 'accepted' || !mainProcessWork.isAccepting()) return
  if (!mainProcessWork.isAccepting()) return
  disposeDisclaimerIpc()
  if (pendingDisclaimerGate === gate) pendingDisclaimerGate = null

  if (!mainProcessWork.isAccepting()) return
  syncAutoLaunch(settingsManager.getApp().launchAtStartup)
  protocolManager.register()

  // Linux AppImage self-integration (desktop entry, icon, URL-scheme handlers).
  // No-op on other platforms/packagings; deferred so the one-time consent
  // dialog never blocks startup.
  runShellAsyncWork('appimage-integration', () =>
    setupAppImageIntegration({
      getMagnetEnabled: () => settingsManager.getApp().protocols.magnet,
    })
  )

  // ── Phase 2: Initialize services while renderer loads ─────
  // The renderer needs time to load JS bundles and render React.
  // Use that window to set up IPC handlers and core services.

  rpcClient = new Aria2RpcClient(transport, protocol, engineSettings.rpcSecret)
  aria2Adapter = new Aria2Adapter(rpcClient, undefined, () =>
    settingsManager.getEngine()
  )
  const adapter = aria2Adapter
  proxyBridge = new ProxyBridgeManager()
  const routing = createRequestRouting(() => settingsManager.getProxy())
  requestRouting = routing
  const routedFetch = routing.fetch
  adapter.configureRequestProxy(async (url, headers) => {
    const referer = new Headers(headers).get('referer')
    return routing.router.resolve(
      url,
      isDomesticPlatform(url) || Boolean(referer && isDomesticPlatform(referer))
    )
  })
  supervisor = new EngineSupervisor(
    eventBus,
    settingsManager,
    processManager,
    configBuilder,
    trustStore,
    rpcClient,
    adapter,
    proxyBridge,
    appliedDownloadProxyPolicy
  )

  // Construct SpeedLimitController immediately after supervisor so
  // setEffectiveLimitsProvider is registered before the first
  // supervisor.start() inside startEngineAndRestore().
  speedLimitController = new SpeedLimitController({
    getSettings: () => settingsManager.get().speedLimit,
    applyLimits: (limits) => supervisor.applySpeedLimits(limits),
    getEngineState: () => supervisor.getState(),
    emit: (channel, payload) => eventBus.emit(channel, payload),
  })
  supervisor.setEffectiveLimitsProvider(() =>
    speedLimitController.getEffective()
  )
  speedLimitController.start()

  // When the engine reaches Ready (cold-start or reconnect), force a
  // limit push so aria2 starts with the correct effective limits.
  // EngineRecovered is emitted by EngineSupervisor on every
  // Ready-state transition (see EngineSupervisor.setState).
  eventBus.on(
    Events.EngineRecovered as Parameters<typeof eventBus.on>[0],
    () => {
      void speedLimitController.onEngineReady()
    }
  )

  if (!legacyImportService) motrixDb.init()
  getLegacyBtActivationService()
  getLegacyHttpActivationService()
  legacyImportService?.setPersistenceLane((operation) =>
    sessionManager
      ? sessionManager.runExclusivePersistence(operation)
      : Promise.resolve().then(operation)
  )
  await mediaMetaStore
    .pruneOrphans(motrixDb.getAllTasks().map(({ task }) => task.motrixId))
    .catch((err) => log.warn({ err }, 'Media metadata recovery failed'))

  const activityEnvironment = taskInspectorActivityEnvironment(process.env)
  const activeTaskInspectorActivityRuntime = new TaskInspectorActivityRuntime(
    new TaskInspectorActivityStore(motrixDb.database),
    eventBus,
    {
      ...activityEnvironment.runtime,
      onError: (err, context) => {
        log.warn(
          { err, ...context },
          'task inspector activity persistence failed'
        )
      },
    }
  )
  taskInspectorActivityRuntime = activeTaskInspectorActivityRuntime
  const activeTaskInspectorActivityQuery = createTaskInspectorActivityQuery(
    activeTaskInspectorActivityRuntime,
    activityEnvironment.query
  )
  const activeTaskActivityService = new TaskActivityService(
    new TaskActivityStore(motrixDb.database),
    eventBus,
    {
      onError: (err, context) => {
        log.warn({ err, ...context }, 'task activity persistence failed')
      },
    }
  )
  taskActivityService = activeTaskActivityService
  const activeTransferStats = new TransferStatsRuntime(
    motrixDb.database,
    eventBus,
    {
      onError: (err) => {
        log.warn({ err }, 'transfer statistics persistence failed')
      },
    }
  )
  transferStats = activeTransferStats

  // ─── Plugin runtime ─────────────────────────────────────
  const { pluginsDir, builtinDir } = await resolvePluginsDir(platform)
  if (!mainProcessWork.isAccepting()) return
  const pluginStateStore = new PluginStateStore(motrixDb.database)
  const pluginBootstrapLocale = resolvedApplicationLocale
  // Signed builtin hot-update overlay dir (2026-07-18 design §5). Declared
  // here (ahead of the RegistryClient/builtin-updater construction further
  // down) because PluginRegistry needs it immediately for overlay-aware
  // manifest resolution.
  const overlayDir = path.join(platform.userDataDir, 'builtin-updates')
  const devPath = process.env.MOTRIX_PLUGIN_DEV_PATH
  const pluginSecurity = new PluginSecurityService({
    fetchImpl: pluginHttpClient.fetch,
    cachePath: path.join(platform.userDataDir, 'plugin-security.json'),
  })
  await pluginSecurity.initialize()
  const pluginRegistry = new PluginRegistry({
    security: pluginSecurity,
    pluginsDir,
    builtinDir,
    overlayDir,
    stateStore: pluginStateStore,
    hostVersion: MOTRIX_COMPAT_VERSION,
    hostLanguage: pluginBootstrapLocale,
    devPath,
  })
  await pluginRegistry.discover()
  if (!mainProcessWork.isAccepting()) return
  const pluginCapHost = await createElectronCapabilityHost({
    appVersion: MOTRIX_COMPAT_VERSION,
    hostLanguage: pluginBootstrapLocale,
    db: motrixDb.database,
    userDataDir: app.getPath('userData'),
    pluginsDir,
    settingsManager,
    // TODO Task 22: wire settingsManager.snapshot()?.plugins?.[pluginId] ?? {}
    configReader: (_pluginId) => ({}),
    // TODO Plan F: derive from manifest contributes.configuration schema
    secretFieldsFor: (_pluginId) => new Set(),
    manifestCommandIdsFor: (pluginId) => {
      const cmds = pluginRegistry.get(pluginId)?.manifest.contributes.commands
      return new Set(cmds?.map((c) => c.id) ?? [])
    },
    localeSnapshotFor: (pluginId) =>
      pluginRegistry.getLocaleDictionaries(pluginId),
  })
  pluginLocaleTargets = {
    registry: pluginRegistry,
    capabilityHost: pluginCapHost,
  }
  // Settings may change while plugin discovery/capability construction awaits.
  // Reconcile after attaching targets so manifests and runtime snapshots cannot
  // remain on the stale bootstrap locale.
  await localeCoordinator.reconcile()
  if (!mainProcessWork.isAccepting()) return
  const pluginGrants = new GrantsManager({
    registry: pluginRegistry,
    eventBus,
  })
  const detectElectronFfmpeg = makeElectronFfmpegDetect({
    settingsManager,
    userDataDir: app.getPath('userData'),
  })
  const detectPluginFfmpeg = async () =>
    projectActiveToLegacy(
      await pluginCapHost.ffmpeg.refreshDetection(detectElectronFfmpeg)
    )
  const activePluginHost = new PluginHost({
    security: pluginSecurity,
    onSecurityChanged: () => {
      eventBus.emit(Events.PluginSecurityChanged)
      eventBus.emit(Events.ContributionIndexChanged)
    },
    registry: pluginRegistry,
    stateStore: pluginStateStore,
    capabilityHost: pluginCapHost,
    workerScriptPath: path.join(
      __dirname,
      '../core/plugin/host/quick-js-worker.cjs'
    ),
    appVersion: MOTRIX_COMPAT_VERSION,
    runtime: 'electron',
    hostLanguage: resolvedApplicationLocale,
    pluginGrants,
    ffmpegDetect: detectPluginFfmpeg,
    idleDisposeMs: parsePluginIdleDisposeMs(
      process.env.MOTRIX_PLUGIN_IDLE_DISPOSE_MS
    ),
  })
  pluginHost = activePluginHost
  pluginGrants.bindPolicyBarrier(
    activePluginHost.applyPolicyMutation.bind(activePluginHost)
  )
  // Wire Plan D: cross-plugin command safeguards (schema cache + rate limit
  // + caller throttle + chain depth + audit) and bind the invoker to the
  // capability host. Must run AFTER registry.discover() so manifest schemas
  // can be compiled at install time.
  const commandSystem = wireCommandSystem({
    registry: pluginRegistry,
    host: activePluginHost,
    capabilityHost: pluginCapHost,
    pluginsDir,
  })

  const pluginActivation = new ActivationDispatcher(
    pluginRegistry,
    activePluginHost
  )
  try {
    await pluginActivation.dispatch({ kind: 'startup' })
  } catch (err) {
    if (!mainProcessWork.isAccepting()) {
      await activePluginHost.shutdown()
      return
    }
    throw err
  }
  if (!mainProcessWork.isAccepting()) {
    await activePluginHost.shutdown()
    return
  }

  if (devPath) {
    runShellAsyncWork('dev watcher start', async () => {
      const handle = await startDevWatcher(
        devPath,
        pluginRegistry,
        activePluginHost,
        MOTRIX_COMPAT_VERSION
      )
      if (!mainProcessWork.isAccepting()) {
        await handle.close()
        return
      }
      devWatcherHandle = handle
    })
  }

  const pluginInstaller = new PluginInstaller({
    security: pluginSecurity,
    pluginsDir,
    registry: pluginRegistry,
    stateStore: pluginStateStore,
    capabilityHost: pluginCapHost,
    hostVersion: MOTRIX_COMPAT_VERSION,
    schemaCache: commandSystem.schemas,
    ffmpegDetect: detectPluginFfmpeg,
  })

  // Media (hls/dash/mux) segment downloads write under this root. Compute it
  // here so SessionManager.restore() can skip aria2-restored segment downloads
  // (phantom-task guard); the bridge bootstrap reuses the same value for the
  // coordinator's tmpRoot and the poll loop's suppression.
  const mediaTmpDir = portableProfile
    ? path.join(portableProfile.workDir, 'media')
    : path.join(platform.userDataDir, 'nexus-media-work')
  mediaTmpRoot = mediaTmpDir
  sessionManager = new SessionManager(
    taskManager,
    rpcClient,
    motrixDb,
    adapter,
    mediaTmpDir,
    undefined,
    undefined,
    () => {
      const snapshot = appliedDownloadProxyPolicy.snapshot()
      return snapshot
        ? { ...snapshot, userAgent: settingsManager.getEngine().userAgent }
        : null
    }
  )
  sessionManager.setExternalEngineDirectoryFilter((directory) =>
    isPortableUpdateDirectory(portableProfile, directory)
  )
  completedEngineTaskCleanup = new CompletedEngineTaskCleanup({
    taskManager,
    adapter,
    mintTaskId: newTaskId,
    persist: persistTaskWithOccurrence,
    adopt: (task, persist) =>
      activeTaskInspectorActivityRuntime.parentTaskCreated(task, persist),
    publish: publishTaskUpdateNow,
    dispatch: (occurrence) => occurrenceDispatcher.dispatch(occurrence),
    prepareFiles: (task) =>
      syncTaskFilesIfIncomplete(task.id, task.engineTaskId),
    // Cleanup owns the mutation lock across its exact-owner check and retry.
    finalizeLegacyHttp: (taskId) =>
      finalizeTask(taskId, {
        ...buildFinalizeDeps(adapter),
        runTaskMutation: undefined,
      }),
    runTaskMutation: (ids, operation) =>
      activeTaskInspectorActivityRuntime.runTaskMutation(ids, operation),
    log,
  })
  supervisor.setSessionRecoveryStore(
    sessionManager.getEngineSessionRecoveryStore()
  )
  supervisor.setStartupGuard(
    new CompletedTaskStartupGuard({
      completedGids: () => sessionManager.getCompletedDirectEngineTaskIds(),
      heldGids: () =>
        new Set(
          motrixDb
            .getAllTasks()
            .flatMap((pair) => [...getLegacyQuarantinedGids(pair)])
        ),
      rpc: rpcClient,
      removeResult: (gid) => adapter.removeDownloadResult(gid),
    })
  )
  supervisor.setPreReadyMaintenance(() =>
    sessionManager.purgeEphemeralMediaRows()
  )
  const pluginRuntime = await createPluginRuntime({
    getTask: (id) => taskManager.getById(id),
    activation: pluginActivation,
    registry: pluginRegistry,
    grants: pluginGrants,
    host: activePluginHost,
    installer: pluginInstaller,
    capabilityHost: pluginCapHost,
    repository: motrixDb.durablePostDeliveries,
    persistTerminal: (task, occurrence, input) =>
      sessionManager.persistTerminalHookBoundary(task, occurrence, input),
    database: motrixDb.database,
    session: sessionManager,
    pluginsDir,
    auditLogPath: path.join(
      platform.userDataDir,
      'plugin-audit',
      'hooks.ndjson'
    ),
    finalizeSidecarPath: resolveFinalizeSidecarPath({
      extraResourceDir: platform.extraResourceDir,
      isDev: platform.isDev,
    }),
    assertEngineQuiesced: async (taskId) => {
      const task = taskManager.getById(taskId)
      if (!task) return
      const active = await adapter.listActiveAndWaiting()
      if (active.some((entry) => entry.gid === task.engineTaskId)) {
        throw new Error(`engine writer is still active for task ${taskId}`)
      }
    },
  })
  hookAuditLog = pluginRuntime.auditLog
  hookOrchestrator = pluginRuntime.orchestrator
  pluginHookRuntime = pluginRuntime.hooks
  finalizeFilesystemAdapter = pluginRuntime.finalizeFilesystem
  durableFinalizeRuntime = pluginRuntime.finalize
  pollingScheduler = new PollingScheduler(
    rpcClient,
    eventBus,
    (stats) => {
      statsAggregator.update(stats)
      speedHistoryStore.append(stats)
      // PollingScheduler.stop() cancels future polls but cannot abort an RPC
      // already in flight. The nullable lifecycle reference prevents a late
      // completion from recording after Transfer has been disposed.
      transferStats?.record(stats)
      eventBus.emit(Events.StatsUpdated, stats)
    },
    handlePolledTasks
  )

  const natStack = createNatManager({
    eventBus,
    settingsManager,
    isEngineReady: () => supervisor.getState() === EngineState.Ready,
  })
  natManager = natStack.manager
  stopNatDiagnostics = natStack.stopDiagnostics
  natStack.startDiagnostics()
  log.info('NatManager constructed')

  const startupGeoipManager = new GeoIPManager({
    settingsManager,
    eventBus,
    dbPath: path.join(platform.userDataDir, 'geoip', 'GeoLite2-Country.mmdb'),
  })
  geoipManager = startupGeoipManager
  await startupGeoipManager.start()
  if (!mainProcessWork.isAccepting()) {
    await startupGeoipManager.stop()
    return
  }
  log.info('GeoIPManager started')

  // MagnetTracker owns the metadata-only magnet flow used when the user
  // wants to choose files after magnet metadata resolves. It persists
  // pending metadata fetches to MotrixDatabase so they survive restart
  // (Plan B), and mirrors them into TaskManager so the Downloads list
  // shows a row in fetching_metadata state immediately on submit.
  const activeMagnetTracker = new MagnetTracker(
    rpcClient,
    eventBus,
    settingsManager,
    motrixDb,
    taskManager,
    torrentParser,
    activeTaskActivityService,
    {
      publishTaskUpdate,
      publishTaskUpdateNow,
      parentTaskCreated: (task, persistParent) =>
        activeTaskInspectorActivityRuntime.parentTaskCreated(
          task,
          persistParent
        ),
      recordTransition: (input) =>
        activeTaskInspectorActivityRuntime.recordTransition(input),
      deleteParentTask: (taskId, deleteParent) =>
        activeTaskInspectorActivityRuntime.deleteParentTask(
          taskId,
          deleteParent
        ),
      runTaskMutation: (taskIds, operation) =>
        activeTaskInspectorActivityRuntime.runTaskMutation(taskIds, operation),
      runExclusivePersistence: (operation) =>
        sessionManager.runExclusivePersistence(operation),
      torrentMetaDir: path.join(platform.userDataDir, 'torrents'),
      metadataWorkDir: portableProfile?.workDir,
      canRestoreTask: (task) =>
        !portableProfile ||
        task.errorDetailKey !== 'task.recovery.startup.portableExternalPath',
      occurrenceDispatcher,
    }
  )
  magnetTracker = activeMagnetTracker

  // UpdateManager owns the renderer-facing snapshot while retaining raw
  // updater events for diagnostics. Downloads and installation remain
  // user-triggered even when the optional launch check is enabled.
  // electron-builder writes app-update.yml only for distributable
  // targets (dmg/zip/nsis) — dir builds and dev runs cannot update
  // themselves, so report 'unsupported' instead of letting
  // checkForUpdates surface a raw ENOENT for the missing file.
  const hasUpdateMetadata =
    app.isPackaged &&
    (await pathExists(path.join(process.resourcesPath, 'app-update.yml')))
  const updateSimulatorEnabled = shouldUseDevelopmentUpdateSimulator({
    isPackaged: app.isPackaged,
    value: process.env.MOTRIX_UPDATE_SIMULATOR,
  })
  const developmentUpdateSimulator = updateSimulatorEnabled
    ? new DevelopmentUpdateSimulator({
        currentVersion: app.getVersion(),
        onQuitAndInstall: () => app.quit(),
      })
    : null
  const updatesSupported =
    Boolean(portableProfile) ||
    (NEXUS_BUILD_POLICY.automaticUpdates &&
      !distributionContext.isWindowsPackage &&
      (Boolean(portableProfile) ||
        updateSimulatorEnabled ||
        isElectronSelfUpdateSupported({
          hasUpdateMetadata,
          isPackaged: app.isPackaged,
          isWindowsPackage: distributionContext.isWindowsPackage,
          isSnap: settingsSnapEnvironment !== null,
        })))
  if (developmentUpdateSimulator) {
    log.info('development update simulator enabled')
    registerUpdateQuitPreparation({
      updater: developmentUpdateSimulator,
      markForceQuit: () => quitController.markForceQuit(),
      setWillQuit: (value) => windowManager?.setWillQuit(value),
    })
  }
  if (!mainProcessWork.isAccepting()) return
  let portableUpdate: PortableUpdateService | null = null
  if (portableProfile) {
    portableUpdate = new PortableUpdateService({
      version: app.getVersion(),
      directory: updateDirectory(portableProfile),
      engine: adapter,
      events: eventBus,
      fetcher: routedFetch,
      latestUrl: `${NEXUS_RELEASE_CONFIG.apiBase}/repos/${NEXUS_RELEASE_CONFIG.repository}/releases/latest`,
      prefix: () => settingsManager.getApp().githubDownloadPrefix,
      activeTasks: () =>
        taskManager
          .getAll()
          .filter((task) =>
            [
              TaskStatus.Downloading,
              TaskStatus.Queued,
              TaskStatus.Seeding,
              TaskStatus.FetchingMetadata,
            ].includes(task.status)
          )
          .map((task) => task.name),
      install: async (request) => {
        let schedule: (() => void) | undefined
        try {
          schedule = await preparePortableUpdate({
            profile: portableProfile,
            request,
            source: updateHelperSource,
            executable: process.execPath,
            guardian: processGuardian,
            releaseNotes: portableUpdate?.getState().releaseNotes,
          })
        } catch (error) {
          if (error instanceof Error && error.message === 'update.permission') {
            const release = portableUpdate?.getState().releaseUrl
            if (release) await shell.openExternal(release)
          }
          throw error
        }
        await pauseAllTasks(commandDeps)
        schedule?.()
        requestForcedQuit('portable-update')
      },
    })
    await portableUpdate.initialize()
  }
  const updateManager =
    portableUpdate ??
    (await createAppUpdateService({
      eventBus,
      currentVersion: app.getVersion(),
      channel: settingsManager.getApp().updateChannel,
      isWindowsPackage: distributionContext.isWindowsPackage,
      supported: updatesSupported,
      getInstallBlockReason: () =>
        portableProfile
          ? 'portable'
          : getMacUpdateInstallBlockReason({
              platform: process.platform,
              isPackaged: app.isPackaged,
              execPath: process.execPath,
              temporaryDirectory: app.getPath('temp'),
            }),
      loadUpdater: async () => {
        if (developmentUpdateSimulator) return developmentUpdateSimulator
        const updater = (await import('electron-updater')).default.autoUpdater
        if (portableProfile)
          updater.setFeedURL({
            provider: 'generic',
            url: EXTERNAL_URLS.motrix.updateFeed,
          })
        return updater
      },
      getManagedMessage: () =>
        i18n.t('settings.about.update.managedDescription'),
    }))
  if (!mainProcessWork.isAccepting()) return

  const trackerStorePath = path.join(platform.userDataDir, 'tracker.json')
  const trackerStore = new TrackerStore(trackerStorePath)
  const trackerSyncer = new TrackerSyncer()
  const trackerProber = new TrackerProber()
  trackerManager = new TrackerManager(
    settingsManager,
    rpcClient,
    eventBus,
    trackerSyncer,
    trackerProber,
    trackerStore,
    {
      runTaskMutation: (taskIds, operation) =>
        activeTaskInspectorActivityRuntime.runTaskMutation(taskIds, operation),
      pauseTask: (taskId) =>
        pauseTaskAction(taskId, {
          taskManager,
          adapter,
          eventBus,
          log,
          persistTask,
          persistTaskWithOccurrence,
          occurrenceDispatcher,
          recordTransition: (input) =>
            activeTaskInspectorActivityRuntime.recordTransition(input),
          runTaskMutation: (taskIds, operation) =>
            activeTaskInspectorActivityRuntime.runTaskMutation(
              taskIds,
              operation
            ),
          publishTaskUpdate,
          publishTaskUpdateNow,
        }),
      resumeTask: (taskId) =>
        resumeTaskAction(taskId, {
          taskManager,
          adapter,
          eventBus,
          log,
          persistTask,
          persistTaskWithOccurrence,
          occurrenceDispatcher,
          recordTransition: (input) =>
            activeTaskInspectorActivityRuntime.recordTransition(input),
          runTaskMutation: (taskIds, operation) =>
            activeTaskInspectorActivityRuntime.runTaskMutation(
              taskIds,
              operation
            ),
          publishTaskUpdate,
          publishTaskUpdateNow,
        }),
    },
    () =>
      routing.router.resolve(
        'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt'
      )
  )
  trackerManager.configureTaskTracking(
    adapter,
    taskManager,
    new TaskTrackerRepository(motrixDb.database)
  )

  const proxyApplier = createMainProxyApplier(
    supervisor,
    trackerManager,
    proxyBridge,
    () => settingsManager.getProxy()
  )
  const initialProxySettings = settingsManager.getProxy()
  const proxyReady = mainProcessWork
    .run(() =>
      appliedDownloadProxyPolicy.applyTransition(() =>
        proxyApplier.applyAll(initialProxySettings)
      )
    )
    .catch((err) => log.warn({ err }, 'initial proxy apply failed'))

  if (
    updatesSupported &&
    !updateSimulatorEnabled &&
    settingsManager.getApp().checkForUpdatesOnLaunch
  ) {
    runShellAsyncWork('automatic update check', async () => {
      await proxyReady
      if (!mainProcessWork.isAccepting()) return
      if (portableUpdate) await portableUpdate.check(false)
      else await updateManager.check()
    })
  }

  const contextStore = new ContextStore()
  contextStore.merge({ locale: resolvedApplicationLocale })
  localeContextStore = contextStore

  const commandRegistry = new CommandRegistry()
  const menuRegistry = new MenuRegistry()
  const keybindingRegistry = new KeybindingRegistry()

  const commandDeps: CommandDeps = {
    recoverInterface: () => rendererRecovery?.recoverFocused(),
    taskManager,
    settingsManager,
    adapter,
    windowManager,
    eventBus,
    log,
    updateManager,
    protocolManager,
    fileCleanupService,
    torrentMetaStore,
    motrixDatabase: motrixDb,
    taskPersistence: sessionManager,
    magnetTracker: activeMagnetTracker,
    persistTask,
    persistTaskWithOccurrence,
    occurrenceDispatcher,
    recordTransition: (input) =>
      activeTaskInspectorActivityRuntime.recordTransition(input),
    deleteParentTasks: (taskIds, deleteParents) =>
      activeTaskInspectorActivityRuntime.deleteParentTasks(
        taskIds,
        deleteParents
      ),
    runTaskMutation: (taskIds, operation) =>
      activeTaskInspectorActivityRuntime.runTaskMutation(taskIds, operation),
    publishTaskUpdate,
    publishTaskUpdateNow,
  }

  registerAllCommands(commandRegistry, commandDeps)
  installAllMenubarContributions(menuRegistry)

  menuManager = new MenuManager({
    commandRegistry,
    menuRegistry,
    keybindingRegistry,
    contextStore,
    commandDeps,
    trackAsyncWork: (operation) => mainProcessWork.run(operation),
    onCommandError: (err) => {
      if (!mainProcessWork.isAccepting()) return
      log.warn({ err }, 'menu command tracking failed')
    },
    onApplicationMenuSet: () => {
      if (process.platform !== 'win32' && process.platform !== 'linux') return
      for (const win of windowManager.getAllWindows()) {
        win.setAutoHideMenuBar(false)
        win.setMenuBarVisibility(false)
      }
    },
  })
  menuManager.install()

  const nativeMessagingInstaller = createNativeMessagingInstaller()
  const createBridgeRuntime = async () => {
    if (!NEXUS_BUILD_POLICY.browserIntegration) {
      throw new AppError(
        ErrorCode.EngineFeatureUnavailable,
        'engine.featureUnavailable'
      )
    }
    const bridgeReAddDeps = {
      taskManager,
      adapter,
      eventBus,
      log,
      persistTask,
      persistTaskWithOccurrence,
      occurrenceDispatcher,
      recordTransition: (input: RuntimeTransitionInput) =>
        activeTaskInspectorActivityRuntime.recordTransition(input),
      runTaskMutation: <T>(
        taskIds: readonly string[],
        operation: () => Promise<T>
      ) =>
        activeTaskInspectorActivityRuntime.runTaskMutation(taskIds, operation),
      publishTaskUpdate,
      publishTaskUpdateNow,
      torrentMetaStore,
      getDirectResourceProxyOptions: () => {
        const snapshot = appliedDownloadProxyPolicy.snapshot()
        return snapshot
          ? { ...snapshot, userAgent: settingsManager.getEngine().userAgent }
          : null
      },
      directResourceProxyPolicy: appliedDownloadProxyPolicy,
    }
    const createTaskDeps = {
      adapter,
      directResourceValidator: new DirectResourceValidatorService(),
      directResourceProxyPolicy: appliedDownloadProxyPolicy,
      settingsManager,
      finalNamePicker,
      torrentMetaStore,
      taskManager,
      eventBus,
      publishTaskUpdate,
      activityRecorder: activeTaskActivityService,
      persistTask,
      persistTaskWithPluginMetadata:
        pluginRuntime.persistTaskWithPluginMetadata,
      parentTaskCreated: (
        task: DownloadTask,
        persistParent: () => void | Promise<void>
      ) =>
        activeTaskInspectorActivityRuntime.parentTaskCreated(
          task,
          persistParent
        ),
      rollbackTaskCreation: (taskId: string) =>
        sessionManager.runExclusivePersistence(() =>
          activeTaskInspectorActivityRuntime.deleteParentTask(taskId, () => {
            motrixDb.deleteTask(taskId)
          })
        ),
      runTaskMutation: <T>(
        taskIds: readonly string[],
        operation: () => Promise<T>
      ) =>
        activeTaskInspectorActivityRuntime.runTaskMutation(taskIds, operation),
      // Cold-start gate: engine ready AND startup restore settled. Without
      // the second wait, a submit racing restore() gets clobbered by its
      // clear() + orphan re-adopt (see mainProcessWork.waitForStartup()).
      waitForEngineReady: async () => {
        await supervisor.waitUntilReady(ENGINE_READY_TIMEOUT_MS)
        await mainProcessWork.waitForStartup()
      },
      assertEngineReady: () => supervisor.assertReady(),
      reuseExistingBt: (taskId: string) =>
        reAddTaskAction(taskId, bridgeReAddDeps),
    }
    // Deps for the deleteFiles-aware task/remove (Spec 4) — a SEPARATE path
    // from the extension download/cancel closure below (which is always
    // deleteWithFiles:false). Shares the full RemoveTaskDeps bundle.
    const removeTaskDeps = {
      taskManager,
      adapter,
      log,
      fileCleanupService,
      mediaMetaStore,
      torrentMetaStore,
      eventBus,
      db: motrixDb,
      magnetTracker: activeMagnetTracker,
      taskPersistence: sessionManager,
      publishTaskUpdate,
      publishTaskUpdateNow,
      // Media task removal must tear down the coordinator run (segment
      // downloaders + ffmpeg), or removing the row orphans them. Lazy over
      // bridgeManager.current — the coordinator lives in the bridge runtime.
      cancelMedia: (taskId: string) =>
        bridgeManager?.current?.cancelMedia(taskId) ?? Promise.resolve(),
      deleteParentTasks: (
        taskIds: readonly string[],
        deleteParents: () => void | Promise<void>
      ) =>
        activeTaskInspectorActivityRuntime.deleteParentTasks(
          taskIds,
          deleteParents
        ),
      runTaskMutation: <T>(
        taskIds: readonly string[],
        operation: () => Promise<T>
      ) =>
        activeTaskInspectorActivityRuntime.runTaskMutation(taskIds, operation),
    }
    // Deps for the media-aware pause/resume core action driven by the bridge
    // control-plane. getMediaSegmentGids is lazy over bridgeManager.current
    // (same as the IPC command path in commands.ts).
    const mediaActionDeps = {
      onPauseRequested: (taskId: string) =>
        trackerManager?.noteTaskControl(taskId, true),
      onResumeRequested: (taskId: string) =>
        trackerManager?.noteTaskControl(taskId, false),
      taskManager,
      adapter,
      eventBus,
      log,
      persistTask,
      persistTaskWithOccurrence,
      occurrenceDispatcher,
      recordTransition: (input: RuntimeTransitionInput) =>
        activeTaskInspectorActivityRuntime.recordTransition(input),
      runTaskMutation: <T>(
        taskIds: readonly string[],
        operation: () => Promise<T>
      ) =>
        activeTaskInspectorActivityRuntime.runTaskMutation(taskIds, operation),
      getMediaSegmentGids: (id: string) =>
        bridgeManager?.current?.getMediaSegmentGids(id) ?? [],
      publishTaskUpdate,
      publishTaskUpdateNow,
    }
    const ffmpegBinariesDir = path.join(platform.userDataDir, 'binaries')
    // Resolve the configured/user-provided FFmpeg path without executing it.
    // Running `ffmpeg -version` here would trigger Gatekeeper for quarantined
    // user binaries during app startup, before any media task needs FFmpeg.
    const resolveFfmpegLocation = async () => {
      if (nexusTools) {
        try {
          return {
            available: true,
            binaryPath: await nexusTools.executable('ffmpeg'),
            version: null,
          }
        } catch {
          return { available: false, binaryPath: null, version: null }
        }
      }
      return locateFfmpeg(
        {
          manualPath: settingsManager.getMedia().ffmpegBinaryPath,
          userDataBinariesDir: ffmpegBinariesDir,
          platform: process.platform,
          envPath: resolveElectronFfmpegEnvPath(),
        },
        (candidate) => resolveVerifiedFfmpeg(platform.userDataDir, candidate)
      )
    }
    const segmentAria2Client = new Aria2SegmentClient(rpcClient, adapter)
    segmentClient = segmentAria2Client
    const revealInFolder = createRevealInFolderHandler({
      shell,
      getTask: (taskId) => taskManager.getById(taskId),
    })
    const bridgeDataDirLockRecoveryAuthority =
      launcher.bridgeDataDirLockRecoveryAuthority
    if (bridgeDataDirLockRecoveryAuthority === null) {
      throw new Error('bridge single-instance ownership unavailable')
    }
    // mediaTmpDir / mediaTmpRoot were computed once at bootstrap (above) so
    // SessionManager.restore() and the poll loop share the exact same root.
    const downloadDirectories = createDownloadDirectories({
      getSettings: () => settingsManager.getApp(),
    })
    return bootstrapBridge({
      mediaMetaStore,
      getMainWindow: () => windowManager?.get('main') ?? null,
      motrixVersion: MOTRIX_COMPAT_VERSION,
      ffmpegAvailable: async () => (await resolveFfmpegLocation()).available,
      enabled: true,
      // Read fresh on every factory invocation (including a hot restart from
      // BridgeManager.restart()), so a `bridge.fixedPort`/`instanceId` change
      // takes effect without a full app restart.
      bridgeSettings: settingsManager.get().bridge,
      bridgeDataDirLockRecoveryAuthority,
      eventBus,
      createTaskDeps,
      activityRecorder: activeTaskActivityService,
      // Startup barrier: hold extension submits (all kinds — direct, magnet,
      // hls/dash/mux) until restore/recovery settle. The extension reconnects
      // within ~0.5s of app launch, well inside the restore window.
      waitForReady: () => mainProcessWork.waitForStartup(),
      removeTask: async (taskId: string) => {
        if (!taskManager.getById(taskId)) return
        await removeTask(taskId, { deleteWithFiles: false }, removeTaskDeps)
      },
      // Bridge magnet → MagnetTracker metadata-only fetch (file dialog + no
      // duplicate BT record), attributed source='bridge' so progress
      // notifications still reach the extension. Mirrors Commands.CreateTask.
      submitMagnetForFileSelection: (uri, saveDir, sourceMeta) =>
        activeMagnetTracker.submit(uri, saveDir, {
          source: 'bridge',
          sourceMeta,
        }),
      isMagnetFileSelectionEnabled: () =>
        settingsManager.getApp().magnetFileSelection,
      finalNamePicker,
      getDefaultSaveDir: () => settingsManager.getApp().defaultSaveDir,
      resolveSaveDir: downloadDirectories.resolveSelection,
      recordDirectory: (path) =>
        settingsManager.mutateDirectoryPreferences({
          action: 'recordRecent',
          path,
        }),
      readHandlerDeps: {
        getDownloadDirectories: downloadDirectories.list,
        taskManager,
        statsAggregator,
        supervisor,
      },
      writeHandlerDeps: {
        taskManager,
        pauseTask: (taskId: string) => pauseTaskAction(taskId, mediaActionDeps),
        resumeTask: (taskId: string) =>
          resumeTaskAction(taskId, mediaActionDeps),
        removeTask: (taskId: string, { deleteFiles }) =>
          removeTask(taskId, { deleteWithFiles: deleteFiles }, removeTaskDeps),
        createTask: (req) => handleCreateTask(req, createTaskDeps),
        parseTorrentFileCount: async (base64: string) =>
          (await torrentParser.parse(base64)).files.length,
        revealTask: (taskId) => revealInFolder({ taskId }),
      },
      ffmpegBinaryPath: null,
      resolveFfmpegBinaryPath: async () =>
        (await resolveFfmpegLocation()).binaryPath,
      publishTaskUpdate,
      publishTaskUpdateNow,
      taskManager,
      segmentAria2: segmentAria2Client,
      tmpRoot: mediaTmpDir,
      // Media completion durable-save (the coordinator's persist hook) —
      // media tasks bypass the poll loop's transition saves entirely.
      persistTask,
      persistTaskWithOccurrence,
      occurrenceDispatcher,
      parentTaskCreated: (task, persistParent) =>
        activeTaskInspectorActivityRuntime.parentTaskCreated(
          task,
          persistParent
        ),
      recordTransition: (input) =>
        activeTaskInspectorActivityRuntime.recordTransition(input),
      runTaskMutation: (taskIds, operation) =>
        activeTaskInspectorActivityRuntime.runTaskMutation(taskIds, operation),
      trackAsyncWork: (operation) => mainProcessWork.run(operation),
      pluginRegistry,
      // biome-ignore lint/style/noNonNullAssertion: pluginHost is assigned before bridgeManager.start()
      pluginHost: pluginHost!,
    })
  }
  bridgeManager = new BridgeManager(
    createBridgeRuntime,
    () =>
      portableProfile || !NEXUS_BUILD_POLICY.browserIntegration
        ? Promise.resolve()
        : nativeMessagingInstaller.unregister(),
    !nativeMessagingInstaller.preserveOnStartupFailure
  )

  await activePluginHost.enforceSecurityPolicy()
  pluginSecurity.start()
  const registryClient = new RegistryClient({
    enabled: NEXUS_BUILD_POLICY.onlinePluginRegistry,
    fetchImpl: pluginHttpClient.fetch,
    cachePath: path.join(platform.userDataDir, REGISTRY_CACHE_FILENAME),
  })
  const builtinUpdater = new BuiltinUpdater({
    fetchImpl: pluginHttpClient.fetch,
    security: pluginSecurity,
    overlayDir,
    hostVersion: MOTRIX_COMPAT_VERSION,
  })
  builtinUpdater.bindLifecycleSink({
    applyPolicyMutation: (pluginId, publish) =>
      activePluginHost.applyPolicyMutation(pluginId, publish),
    currentExecutable: (pluginId) => {
      const current = pluginRegistry.policySnapshot(pluginId)
      if (!current?.executableDigest) return undefined
      return {
        pluginId,
        version: current.version,
        digest: current.executableDigest,
      }
    },
    refreshRegistry: () => pluginRegistry.discover(),
    supersede: (executable, at) =>
      pluginRuntime.hooks.supersede(executable, at),
  })
  runShellAsyncWork('builtin updater orphan cleanup', () =>
    builtinUpdater.cleanupOrphans()
  )

  // Notification pipeline boot ordering — canonical explanation; every
  // other mention of this rationale in this file is a one-line pointer
  // back here:
  //
  // 1. `notificationCenter` is constructed here in Phase 2 (F4), not
  //    inside startEngineAndRestore (Phase 3) — it only depends on
  //    motrixDb/eventBus/log, none of which depend on the engine, so there
  //    is no reason its IPC channels (and therefore the renderer's
  //    badge/list queries) should stay dark for the entire Phase-3
  //    engine-start window, or worse, never come up at all when the engine
  //    never reaches Ready.
  // 2. registerEngineFailureSubscriber and the notification occurrence
  //    consumer still wire up inside startEngineAndRestore (Task 13 / F5),
  //    consuming this instance via closure — but BEFORE supervisor.start()
  //    and BOTH of its early-return branches (start() throwing, or landing
  //    in a non-Ready state). That is why occurrenceDispatcher's
  //    drainAtStartup() is called from those two early-return branches
  //    too, not only after a successful Ready: it still redelivers
  //    whatever must-reach task occurrence the outbox is holding from a
  //    prior boot even when the engine itself never comes up this boot.
  //    These consumers only close over module-level bindings that don't
  //    depend on the engine, so nothing about registering them early is
  //    unsafe. (The Node/server shell has no engine-readiness gate at all
  //    — this ordering makes the Electron shell's must-reach behavior
  //    converge with it instead of diverging on a failed boot.)
  notificationCenter = new NotificationCenter({
    store: motrixDb,
    emit: eventBus.emit.bind(eventBus),
    getHiddenKinds: () => getHiddenNotificationKinds(settingsManager.getApp()),
    log,
  })
  const disposeNotificationIpc = registerNotificationIpc({
    notificationCenter,
    trackAsyncWork: (operation) => mainProcessWork.run(operation, false),
  })

  // The main window can mount before the full IPC ingress is ready. The
  // application-menu bridge subscribes and immediately publishes the current
  // snapshot so an early renderer query is reconciled without losing state.
  const disposeApplicationMenuIpc = registerApplicationMenuIpc({
    menuManager: menuManager as MenuManager,
    windowManager,
    trackAsyncWork: (operation) => mainProcessWork.run(operation),
  })

  const nexusDiagnostics = new NexusDiagnostics({
    directory: path.join(platform.userDataDir, 'nexus-diagnostics'),
    enabled: () => nexusWorkspace.getPreferences().diagnosticsEnabled,
  })
  const nexusWorkspace = new NexusWorkspace({
    fetch: routedFetch,
    tasks: () => taskManager.getAll(),
    file: path.join(platform.userDataDir, 'nexus-workspace.json'),
    defaultDirectory: () => settingsManager.getApp().defaultSaveDir,
    changed: () => {
      eventBus.emit(Events.NexusWorkspaceChanged)
      const state = nexusWorkspace.snapshot()
      void nexusDiagnostics.record('workspace', 'snapshot', {
        inboxCount: state.inbox.length,
        taskCount: state.bindings.length,
      })
    },
  })
  await nexusWorkspace.load()
  configureNexusNotifications(
    () =>
      settingsManager.getApp().notifyOnComplete ||
      settingsManager.getApp().notifyOnError,
    path.join(platform.extraResourceDir, 'nexus/app-icon.ico')
  )
  const diskGuard = new DiskGuard(
    () => nexusWorkspace.getPreferences().diskReserveGiB * 1024 ** 3,
    () => eventBus.emit(Events.NexusWorkspaceChanged)
  )
  const mediaBroker = new CredentialBroker(
    path.join(platform.userDataDir, 'nexus-media.bin'),
    cloudCipher
  )
  let mediaStorageReady = true
  await mediaBroker.load().catch(() => {
    mediaStorageReady = false
  })
  const mediaRecovery = mediaStorageReady
    ? new MediaRecovery(mediaBroker, mediaTmpDir)
    : undefined
  const nexusProfiles = new SpeedProfiles(mediaBroker, () =>
    eventBus.emit(Events.NexusWorkspaceChanged)
  )
  if (mediaStorageReady) nexusProfiles.load()
  const productSegmentClient = new Aria2SegmentClient(rpcClient, adapter)
  sessionManager.setRecoverableMedia((id) => mediaRecovery?.has(id) ?? false)
  segmentClient = productSegmentClient
  const productMedia = new MediaTaskCoordinator({
    mediaMetaStore,
    taskManager,
    activityRecorder: activeTaskActivityService,
    eventBus,
    publishTaskUpdate,
    publishTaskUpdateNow,
    recovery: mediaRecovery,
    resolveFfmpegBinaryPath: async () =>
      (await nexusTools?.executable('ffmpeg')) ?? null,
    pickName: (dir, name) => finalNamePicker.pick(dir, name),
    persist: persistTask,
    persistTaskWithOccurrence,
    occurrenceDispatcher,
    parentTaskCreated: (task, persist) =>
      activeTaskInspectorActivityRuntime.parentTaskCreated(task, persist),
    recordTransition: (input) =>
      activeTaskInspectorActivityRuntime.recordTransition(input),
    runTaskMutation: (ids, operation) =>
      activeTaskInspectorActivityRuntime.runTaskMutation(ids, operation),
    makeDownloader: (tmpDir) =>
      new SegmentDownloader({
        aria2: productSegmentClient,
        tmpDir,
        checkpoints: segmentCheckpoints,
      }),
    decryptor: new SegmentDecryptor(),
    assemble: assembleSegments,
    makeFfmpeg: () => new FfmpegService(),
    mkdtemp: async () => {
      await import('node:fs/promises').then((fs) =>
        fs.mkdir(mediaTmpDir, { recursive: true })
      )
      return import('node:fs/promises').then((fs) =>
        fs.mkdtemp(path.join(mediaTmpDir, 'nexus-media-'))
      )
    },
  })
  const assertProductFfmpeg = async () => {
    await nexusTools?.executable('ffmpeg')
  }
  const productHls = new HlsDashPipeline({
    coordinator: productMedia,
    fetchManifest: (url, options) =>
      fetchManifest(url, { ...options, fetchImpl: routedFetch }),
    assertFfmpegAvailable: assertProductFfmpeg,
  })
  const productMux = new MuxPipeline({
    coordinator: productMedia,
    assertFfmpegAvailable: assertProductFfmpeg,
  })
  const oldDownloadPrefix = mediaBroker.get('tool-mirror')
  if (!settingsManager.getApp().githubDownloadPrefix && oldDownloadPrefix) {
    await settingsManager.update({
      app: { githubDownloadPrefix: oldDownloadPrefix },
    })
  }
  nexusTools = new ToolManager(
    path.join(platform.userDataDir, 'nexus-tools'),
    mediaBroker,
    () => eventBus.emit(Events.NexusWorkspaceChanged),
    routedFetch,
    () => settingsManager.getApp().githubDownloadPrefix
  )
  const nexusExternal = new ExternalMedia({
    proxy: (url) => routing.router.resolve(url),
    tools: nexusTools,
    broker: mediaBroker,
    changed: () => eventBus.emit(Events.NexusWorkspaceChanged),
  })
  if (mediaStorageReady) await nexusExternal.load()
  const nexusServices = new ServiceConnectors({
    broker: mediaBroker,
    profiles: mediaStorageReady ? nexusProfiles : undefined,
    changed: () => eventBus.emit(Events.NexusWorkspaceChanged),
    assertDisk: (dir) => diskGuard.assert(dir),
    processRemote: async (job) => {
      await nexusProcessing.tick()
      return nexusProcessing.settled(job.id)
    },
  })
  if (mediaStorageReady) await nexusServices.load()
  const mediaFinisher = new MediaFinisher({
    broker: mediaBroker,
    tools: nexusTools,
    tasks: () => workflowTasks(),
  })
  const nexusMedia = new MediaRuntime({
    finish: mediaFinisher,
    requireFfmpeg: async () => {
      await nexusTools?.executable('ffmpeg')
    },
    services: nexusServices,
    threshold: () => nexusWorkspace.getPreferences().diskReserveGiB * 1024 ** 3,
    external: nexusExternal,
    enqueue: (ids) => nexusQueues.intent(ids, true),
    completedGroup: async (name, ids, directory) => {
      await nexusPackageManager?.create(name, ids, directory)
    },
    broker: mediaBroker,
    login: (site, url) =>
      mediaSession(
        site,
        url,
        false,
        '',
        routing.sessionConfig(site !== 'external' && site !== 'pixiv')
      ),
    io: {
      anonymousCookie: (() => {
        const anonymous = new DouyinAnonymous()
        return (renew) => anonymous.get(renew)
      })(),
      resolve: async (url, headers) => {
        const platform = detectMedia(url)
        let current = url
        for (let hop = 0; hop < 6; hop++) {
          const response = await routedFetch(current, {
            method: 'GET',
            headers,
            redirect: 'manual',
            signal: AbortSignal.timeout(15000),
          })
          await response.body?.cancel()
          if (response.status < 300 || response.status >= 400) return current
          const next = new URL(response.headers.get('location') || '', current)
          if (next.protocol !== 'https:' || detectMedia(next.href) !== platform)
            throw new Error('media.invalid')
          current = next.href
        }
        throw new Error('media.blocked')
      },
      request: async (url, headers, body) => {
        let current = url
        for (let hop = 0; hop < 6; hop++) {
          const response = await routedFetch(current, {
            headers,
            method: body === undefined ? 'GET' : 'POST',
            body,
            redirect: 'manual',
            signal: AbortSignal.timeout(30000),
          })
          if (response.status >= 300 && response.status < 400) {
            const next = new URL(
              response.headers.get('location') || '',
              current
            )
            if (next.protocol !== 'https:') throw new Error('media.invalid')
            await response.body?.cancel()
            if (detectMedia(current) === 'weibo')
              throw new Error('media.blocked')
            if (
              detectMedia(current) === 'xiaohongshu' &&
              /\/(?:login|website-login)/.test(next.pathname)
            )
              throw new Error('media.login')
            if (new URL(current).hostname !== next.hostname)
              headers = Object.fromEntries(
                Object.entries(headers).filter(
                  ([key]) => key.toLowerCase() !== 'cookie'
                )
              )
            current = next.href
            continue
          }
          if (!response.ok)
            throw new Error(
              response.status === 401 ? 'media.login' : 'media.blocked'
            )
          const text = await response.text()
          if (text.length > 16 * 1024 * 1024) throw new Error('media.invalid')
          return text
        }
        throw new Error('media.blocked')
      },
      page: async (url, site, cookie) =>
        JSON.parse(
          await mediaSession(
            site,
            url,
            true,
            cookie,
            routing.sessionConfig(true)
          )
        ),
      probeMedia: (url, headers) => probeDouyinMedia(url, headers, routedFetch),
      probe: async (url, headers) => {
        try {
          const r = await routedFetch(url, {
            method: 'HEAD',
            headers,
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
          })
          return ![404, 410].includes(r.status)
        } catch {
          return true
        }
      },
    },
    stream: async (asset, directory, filename) => {
      const receiver = { muxPipeline: productMux, mediaPipeline: productHls }
      const taskId = randomUUID()
      const common = {
        startPaused: true,
        taskId,
        saveDir: directory,
        finalName: filename,
        sanitizedHeaders: asset.headers,
        sourceMeta: null,
        container: filename.endsWith('.mkv')
          ? ('mkv' as const)
          : ('mp4' as const),
      }
      if (asset.audioUrl && receiver?.muxPipeline)
        return receiver.muxPipeline.dispatch({
          ...common,
          kind: 'mux',
          videoUrl: asset.url,
          audioUrl: asset.audioUrl,
        })
      if (!receiver?.mediaPipeline) throw new Error('media.ffmpeg')
      return receiver.mediaPipeline.dispatch({
        ...common,
        kind: /\.mpd(?:[?#]|$)/i.test(asset.url) ? 'dash' : 'hls',
        manifestUrl: asset.url,
      })
    },
  })
  const nexusCloud = new CloudRuntime({
    fetch: routedFetch,
    duplicateWarning: () => nexusWorkspace.getPreferences().duplicateWarning,
    profiles: mediaStorageReady ? nexusProfiles : undefined,
    enqueue: (ids) => nexusQueues.intent(ids, true),
    group: async (name, ids, directory, description) =>
      nexusPackageManager?.create(name, ids, directory, description),
    media: async (resource, directory, filename) => {
      const pipeline = productHls
      if (!pipeline) throw new Error('media.ffmpeg')
      return pipeline.dispatch({
        startPaused: true,
        kind: 'hls',
        taskId: randomUUID(),
        manifestUrl: resource.url,
        sanitizedHeaders: resource.headers,
        saveDir: directory,
        finalName: filename,
        container: 'mp4',
        sourceMeta: null,
      })
    },
    broker: new CredentialBroker(
      path.join(platform.userDataDir, 'nexus-credentials.bin'),
      cloudCipher
    ),
    engine: adapter,
    tasks: taskManager,
    persistTask: (task) => sessionManager.persistTask(task),
    changed: () => {
      eventBus.emit(Events.NexusWorkspaceChanged)
      publishTaskUpdate()
    },
    login: (platform, validate) =>
      loginCloud(
        platform,
        validate,
        (step, reason) => {
          void nexusDiagnostics.record('cloud', 'login', {
            login: {
              platform,
              step,
              reason: reason as 'page' | 'cookie' | 'token' | 'validate',
            },
          })
        },
        routing.sessionConfig(true)
      ),
    diagnosticsEnabled: () =>
      nexusWorkspace.getPreferences().diagnosticsEnabled,
    diagnostic: (request) => {
      void nexusDiagnostics.record('cloud', 'request', { request })
    },
    authorize: (url, redirect, state) =>
      authorizeAliyun(url, redirect, state, routing.sessionConfig(true)),
    mutate: (ids, operation) =>
      activeTaskInspectorActivityRuntime.runTaskMutation(ids, operation),
  })
  await nexusCloud.start()
  nexusServices.setRemoteResolver((key) => {
    if (key.startsWith('115:'))
      return pan115OfflineAdapter(() => nexusCloud.offlineAdapter(key.slice(4)))
    throw new Error('remote.authorization')
  })
  let cloudTickRunning = false
  let cloudRestored = false
  const queuePower = new QueuePower(
    path.join(platform.userDataDir, 'nexus-power'),
    () => eventBus.emit(Events.NexusWorkspaceChanged)
  )
  const workflowTasks = () => [
    ...nexusServices.remote.snapshot().map((j) => ({
      id: j.id,
      createdAt: j.createdAt,
      name: j.files[0]?.name || j.adapter,
      directory: j.directory,
      status: ['processing', 'completed'].includes(j.phase)
        ? 'completed'
        : 'paused',
      progress:
        j.phase === 'remote'
          ? 0
          : (j.files.reduce((n, f) => n + f.downloaded, 0) /
              Math.max(
                1,
                j.files.reduce((n, f) => n + f.bytes, 0)
              )) *
            100,
      bytes: j.files.reduce((n, f) => n + f.bytes, 0),
      downloaded: j.files.reduce((n, f) => n + f.downloaded, 0),
      files: j.files.flatMap((f) => (f.localPath ? [f.localPath] : [])),
    })),
    ...taskManager
      .getAll()
      .filter((t) => t.status !== TaskStatus.Removed)
      .map((t) => ({
        id: t.id,
        createdAt: t.createdAt,
        name: t.name,
        directory: t.saveDir,
        status: t.status,
        progress: t.progress,
        bytes: t.totalBytes,
        downloaded: t.downloadedBytes,
        files: [t.finalPath || path.join(t.saveDir, t.finalName || t.name)],
      })),
    ...nexusExternal.snapshot().map((t) => ({
      id: t.id,
      createdAt: t.createdAt,
      name: t.name,
      directory: t.directory,
      status: t.status,
      progress: t.progress,
      bytes: t.totalBytes,
      downloaded: t.downloadedBytes,
      files: t.files,
    })),
  ]
  const nexusProcessing = new ProcessingPipeline({
    broker: mediaBroker,
    tasks: workflowTasks,
    packages: () => {
      if (!nexusPackageManager) throw new Error('workflow.invalid')
      return nexusPackageManager
    },
    archive: new ArchiveService({
      tools: nexusTools,
      reserve: () => nexusWorkspace.getPreferences().diskReserveGiB * 1024 ** 3,
      trash: (file) => shell.trashItem(file),
    }),
    changed: () => eventBus.emit(Events.NexusWorkspaceChanged),
    expected: (id) => {
      const source = nexusWorkspace
        .snapshot()
        .bindings.find((b) => b.taskId === id)?.source
      return {
        expectedBytes: source?.expectedBytes ?? undefined,
        sha256:
          source?.hash?.algorithm === 'sha256' ? source.hash.value : undefined,
      }
    },
    prepare: (record) => mediaFinisher.prepare(record),
    scan: scanAttachments,
    mark: async (files, ids) => {
      if (!nexusWorkspace.getPreferences().markInternet)
        return 'processing.markDisabled'
      const policy = await attachmentZonePolicy()
      let reason = ''
      for (const file of files) {
        const status = await markNetworkFile(file, policy)
        if (status === 'failed') throw new Error('processing.markFailed')
        if (status !== 'marked') reason = 'processing.markSkipped'
      }
      for (const id of ids)
        await nexusWorkspace.setNetworkMark(
          id,
          reason ? 'policy-skipped' : 'marked'
        )
      return reason
    },
    organize: async (record, checkpoint) => {
      // Seeding payload paths remain owned by the engine.
      if (
        record.taskIds.some(
          (id) => taskManager.getById(id)?.type === TaskType.Bt
        )
      )
        return record.outputs.length ? record.outputs : record.files
      const outputs = await organizeFiles(
        record.outputs.length ? record.outputs : record.files,
        record.directory,
        nexusWorkspace.getPreferences(),
        nexusWorkspace
          .snapshot()
          .bindings.find((b) => b.taskId === record.taskIds[0])?.source,
        record.moves,
        checkpoint
      )
      if (record.taskIds.length === 1 && outputs.length === 1) {
        const task = taskManager.getById(record.taskIds[0])
        if (task) {
          task.finalPath = outputs[0]
          task.finalName = path.basename(outputs[0])
          await sessionManager.persistTask(task)
        }
      }
      return outputs
    },
    notify: async (record) => {
      notificationCenter.notify({
        sourceKey: `nexus-processed-${record.id}`,
        kind: NotificationKinds.TaskComplete,
        severity: 'info',
        titleKey: 'notification.taskComplete.title',
        titleParams: { name: record.name },
        taskId: record.taskIds[0],
        createdAt: Date.now(),
      })
      await recordNexusCompletion?.(record.files.length)
    },
  })
  const nexusQueues = new QueueManager({
    extra: () => ({
      packages: nexusPackageManager?.snapshot() ?? [],
      ...nexusProcessing.snapshot(),
      ...diskGuard.snapshot(),
      wakeStatus: queuePower.status,
    }),
    settled: (id) => nexusProcessing.settled(id),
    canStart: (task) => diskGuard.available(task.directory),
    broker: mediaBroker,
    tasks: workflowTasks,
    changed: () => eventBus.emit(Events.NexusWorkspaceChanged),
    ready: () =>
      mediaStorageReady &&
      cloudRestored &&
      !nexusCloud.isSubmitting() &&
      !nexusMedia.isSubmitting(),
    execute: (q) => queuePower.execute(q),
    save: () => sessionManager.requestSave(),
    wake: (times) => queuePower.wake(times),
  })
  nexusPackageManager = new PackageManager({
    configured: (pkg) => nexusProcessing.configurePackage(pkg),
    broker: mediaBroker,
    tasks: workflowTasks,
    changed: () => eventBus.emit(Events.NexusWorkspaceChanged),
    control: async (id, wanted) => {
      await nexusQueues.intent([id], wanted)
      await nexusQueues.tick()
    },
  })
  if (mediaStorageReady) await nexusProcessing.load()
  if (mediaStorageReady) await nexusPackageManager.load()
  if (mediaStorageReady) await nexusQueues.load()
  const queueTimer = setInterval(() => {
    queuePower.setActive(
      workflowTasks().some((t) => t.status === 'downloading')
    )
    void nexusQueues
      .tick()
      .then(async () => {
        if (mediaStorageReady && cloudRestored)
          await nexusProfiles.observe([
            ...taskManager.getAll(),
            ...nexusServices.remote
              .snapshot()
              .filter((j) => j.adapter.startsWith('115:'))
              .map((j) => ({
                id: `remote:${j.id}`,
                downloadedBytes: j.files.reduce((n, f) => n + f.downloaded, 0),
                status: j.error
                  ? TaskStatus.Error
                  : j.phase === 'retrieving'
                    ? TaskStatus.Downloading
                    : ['processing', 'completed'].includes(j.phase)
                      ? TaskStatus.Completed
                      : TaskStatus.Paused,
              })),
          ])
        if (mediaStorageReady && cloudRestored && !nexusCloud.isSubmitting()) {
          await nexusPackageManager?.reconcile()
          await nexusProcessing.tick()
        }
      })
      .catch(() => undefined)
  }, 1000)
  const cloudTimer = setInterval(() => {
    if (!cloudRestored || cloudTickRunning) return
    cloudTickRunning = true
    void nexusCloud
      .tick()
      .then(() => (mediaStorageReady ? nexusServices.remote.tick() : undefined))
      .catch(() => undefined)
      .finally(() => {
        cloudTickRunning = false
      })
  }, 5000)
  if (
    process.platform === 'win32' &&
    !nexusWorkspace.getPreferences().taskbarProgressInitialized
  ) {
    await settingsManager.update({ app: { showDownloadProgress: true } })
    await nexusWorkspace.updatePreferences({ taskbarProgressInitialized: true })
  }
  nexusNetworkMarker = new NexusNetworkMarker({
    enabled: () => nexusWorkspace.getPreferences().markInternet,
    policy: attachmentZonePolicy,
    files: (id) => motrixDb.getTaskFiles(id),
    record: async (id, status) => {
      await nexusWorkspace.setNetworkMark(id, status)
      await nexusDiagnostics.record('network-mark', status)
    },
  })
  recordNexusCompletion = (fileCount) =>
    nexusDiagnostics.record('transfer', 'completed', { fileCount })
  markRestoredNexusFiles = async () => {
    if (!mediaStorageReady) return
    await nexusProcessing.afterRestore()
    await nexusProcessing.tick()
  }
  drainNexusData = async () => {
    clearInterval(queueTimer)
    nexusQueues.dispose()
    queuePower.dispose()
    clearInterval(cloudTimer)
    await Promise.allSettled([
      nexusControl.stop(),
      mediaStorageReady ? nexusProfiles.save() : Promise.resolve(),
      nexusExternal.stop(),
      productMedia.stopAndDrain(),
      nexusProcessing.drain(),
      mediaBroker.drain(),
      nexusCloud.stop(),
      nexusWorkspace.drain(),
      nexusDiagnostics.drain(),
    ])
  }
  if (!mediaStorageReady)
    notificationCenter.notify({
      sourceKey: 'nexus-storage-unavailable',
      kind: 'nexus-storage',
      severity: 'error',
      titleKey: 'nexus.v4.storageUnavailable',
    })
  const openNexusAddFromShell = (ids?: string[]) => {
    windowManager.show('main')
    const win = windowManager.get('main')
    if (win)
      dispatchWhenReady(
        win,
        Events.NavigateTo,
        `/downloads/all?nexusAdd=${ids?.join(',') || 'new'}`
      )
  }
  const nexusShortcut = new NexusGlobalShortcut({
    host: globalShortcut,
    open: () => openNexusAddFromShell(),
    changed: (registered) => nexusWorkspace.setShortcutRegistered(registered),
  })
  const syncNexusShortcut = () =>
    nexusShortcut.apply(nexusWorkspace.getPreferences().globalShortcut)
  eventBus.on(Events.NexusWorkspaceChanged, syncNexusShortcut)
  syncNexusShortcut()
  app.once('will-quit', () => {
    eventBus.off(Events.NexusWorkspaceChanged, syncNexusShortcut)
    nexusShortcut.dispose()
  })
  const nexusControl = new ControlRuntime({
    broker: mediaBroker,
    webRoot: path.join(__dirname, '../renderer'),
    directory: platform.userDataDir,
    confirmDelete: async (id) => {
      windowManager.show('main')
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: i18n.t('nexus.control.deleteTitle'),
        message: i18n.t('nexus.control.deleteMessage', { id }),
        buttons: [
          i18n.t('nexus.control.deleteFiles'),
          i18n.t('nexus.control.cancel'),
        ],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      return result.response === 0
    },
    checkAccounts: () => nexusCloud.selfCheck(undefined),
    changed: () => eventBus.emit(Events.NexusWorkspaceChanged),
    tasks: () => controlTaskView(taskManager.getAll()),
    collect: async (input) => {
      const result = await nexusWorkspace.collect({ input })
      if (result) openNexusAddFromShell(result.items.map((item) => item.id))
      else {
        windowManager.show('main')
        const win = windowManager.get('main')
        if (win) dispatchWhenReady(win, Events.NexusOpenAdd, { input })
      }
    },
  })
  if (mediaStorageReady) await nexusControl.load()
  const disposeNexusClipboard = startNexusClipboard(
    nexusWorkspace,
    windowManager,
    openNexusAddFromShell
  )
  app.once('will-quit', () => {
    disposeNexusClipboard()
    void nexusWorkspace.drain()
    void nexusDiagnostics.drain()
  })
  const disposeCommandHandlers = registerCommandHandlers({
    control: nexusControl,
    diskGuard,
    processing: nexusProcessing,
    packages: mediaStorageReady ? nexusPackageManager : undefined,
    services: nexusServices,
    queues: mediaStorageReady ? nexusQueues : undefined,
    tools: nexusTools,
    external: nexusExternal,
    media: nexusMedia,
    mediaControl: productMedia,
    cloud: nexusCloud,
    nexus: nexusWorkspace,
    nexusShortcutCapture: (active) => nexusShortcut.capture(active),
    exportNexusDiagnostics: () => exportNexusDiagnostics(nexusDiagnostics),
    nexusFeedback: async () => {
      const url = new URL(
        `https://github.com/${NEXUS_RELEASE_CONFIG.repository}/issues/new`
      )
      url.searchParams.set('template', 'bug-report.yml')
      url.searchParams.set('version', NEXUS_VERSION)
      url.searchParams.set('windows', osRelease())
      url.searchParams.set(
        'body',
        `NexusDownload ${NEXUS_VERSION}\nWindows ${osRelease()}\n\n`
      )
      await shell.openExternal(url.href)
    },
    nexusSystemCleanup: async () => {
      await settingsManager.update({
        app: {
          launchAtStartup: false,
          notifyOnComplete: false,
          notifyOnError: false,
          protocols: { magnet: false },
        },
      })
      await nativeMessagingInstaller.unregister()
      await clearSystemRemnants()
    },
    retryNexusNetworkMark: async (id) => {
      const task = taskManager.getById(id)
      if (!task || !nexusNetworkMarker) return false
      await nexusNetworkMarker.mark(task)
      return true
    },
    btStorageRuntime: pluginRuntime.finalize,
    persistBtStorage: (task, source, target) =>
      sessionManager.persistBtStorage(task, source, target),
    rendererRecovery,
    operationService: pluginRuntime.operations,
    mediaMetaStore,
    cliToolService,
    supervisor,
    dnsFallback: { reset: () => dnsFallbackConsumer?.reset() },
    bindTaskRetry: (fn) => {
      dnsFallbackRetry = fn
    },
    recoverFinalization: async (taskId, sha256) => {
      if (!recoveryService) throw new Error('Task recovery is not ready')
      try {
        const report = await recoveryService.recoverTaskById(taskId, sha256)
        if (report.errors.length > 0) throw new Error(report.errors[0].issue)
      } finally {
        publishTaskUpdateNow()
      }
    },
    sessionManager,
    settingsManager,
    applyLocale: (language) => enqueueLocaleUpdate(language, true),
    protocolManager,
    windowManager,
    natManager,
    torrentParser,
    adapter,
    taskManager,
    updateManager,
    // Startup barrier for UI-initiated creates (AddTask window, nexusdl://
    // protocol, .torrent file-open) — same restore race as bridge submits.
    waitForTasksReady: () => mainProcessWork.waitForStartup(),
    trackAsyncWork: (operation) => mainProcessWork.run(operation),
    trackerManager,
    contextStore,
    finalNamePicker,
    torrentMetaStore,
    fileCleanupService,
    eventBus,
    notificationCenter,
    motrixDatabase: motrixDb,
    geoipManager,
    proxyApplier,
    appliedDownloadProxyPolicy,
    pluginRegistry,
    pluginStateStore,
    // biome-ignore lint/style/noNonNullAssertion: assigned before registerCommandHandlers
    pluginHost: pluginHost!,
    pluginInstaller,
    pluginGrants,
    capabilityHost: pluginCapHost,
    userDataDir: platform.userDataDir,
    pluginActivation,
    hookAuditLog,
    hookOrchestrator,
    // biome-ignore lint/style/noNonNullAssertion: assigned just above in this block
    bridgeManager: bridgeManager!,
    magnetTracker: activeMagnetTracker,
    activityRecorder: activeTaskActivityService,
    persistTask,
    persistTaskWithPluginMetadata: pluginRuntime.persistTaskWithPluginMetadata,
    persistTaskWithOccurrence,
    occurrenceDispatcher,
    recordTransition: (input) =>
      activeTaskInspectorActivityRuntime.recordTransition(input),
    deleteParentTasks: (taskIds, deleteParents) =>
      activeTaskInspectorActivityRuntime.deleteParentTasks(
        taskIds,
        deleteParents
      ),
    runTaskMutation: (taskIds, operation) =>
      activeTaskInspectorActivityRuntime.runTaskMutation(taskIds, operation),
    parentTaskCreated: (task, persistParent) =>
      activeTaskInspectorActivityRuntime.parentTaskCreated(task, persistParent),
    publishTaskUpdate,
    publishTaskUpdateNow,
    registryClient,
    pluginFetch: pluginHttpClient.fetch,
    hostVersion: MOTRIX_COMPAT_VERSION,
    builtinUpdater,
    overlayDir,
  })
  const disposeQueryHandlers = registerQueryHandlers({
    profiles: nexusProfiles,
    control: nexusControl,
    services: nexusServices,
    queues: mediaStorageReady ? nexusQueues : undefined,
    tools: nexusTools,
    media: nexusMedia,
    cloud: nexusCloud,
    nexus: nexusWorkspace,
    nexusDiagnostics,
    getResolvedLanguage: () => resolvedApplicationLocale,
    mediaMetaStore,
    cliToolService,
    taskManager,
    statsAggregator,
    speedHistoryStore,
    transferStats: activeTransferStats,
    taskActivityService: activeTaskActivityService,
    taskSpeedHistoryStore,
    taskInspectorActivityRuntime: activeTaskInspectorActivityQuery,
    waitForTasksReady: () => mainProcessWork.waitForStartup(),
    trackAsyncWork: (operation) => mainProcessWork.run(operation, false),
    supervisor,
    settingsManager,
    natManager,
    trackerManager,
    engineAdapter: adapter,
    motrixDatabase: motrixDb,
    geoipManager,
    pluginRegistry,
    registryClient,
    pluginGrants,
    pluginsDir,
    capabilityHost: pluginCapHost,
    hostVersion: MOTRIX_COMPAT_VERSION,
    userDataDir: platform.userDataDir,
    speedLimitController,
    updateManager,
  })
  const disposeDownloadProgress = setupDownloadProgress({
    eventBus,
    getTasks: () => taskManager.getAll(),
    isEnabled: () => settingsManager.getApp().showDownloadProgress,
    setTaskbarProgress: (progress) =>
      windowManager.setTaskbarProgress(progress),
  })
  const disposeCompletionShutdown = setupCompletionShutdown({
    getMainWindow: () => windowManager.get('main') ?? null,
    showMainWindow: () => windowManager.show('main'),
    eventBus,
    getTasks: () =>
      taskManager
        .getAll()
        .map((task) =>
          [TaskStatus.Completed, TaskStatus.Seeding].includes(task.status) &&
          !nexusProcessing.settled(task.id)
            ? { ...task, status: TaskStatus.Finalizing }
            : task
        ),
    isReady: () =>
      mainProcessWork.isAccepting() &&
      supervisor.getState() === EngineState.Ready &&
      rpcClient.isConnected(),
    waitForReady: () => mainProcessWork.waitForStartup(),
    prepare: () => mainProcessWork.prepareForPowerAction(),
    save: async () => {
      // Check the engine too: an in-flight or external add may not yet have a parent row.
      const stats = await adapter.getGlobalStats()
      const seeding = taskManager
        .getAll()
        .filter((task) => task.status === TaskStatus.Seeding).length
      if (stats.waitingTasks > 0 || stats.activeTasks > seeding)
        throw new Error('Engine still has unfinished downloads')
      await sessionManager.save()
    },
    broadcast: (state) =>
      windowManager.broadcast(Events.CompletionShutdownChanged, state),
    translate: (key, params = {}) => i18n.t(key, params),
    logError: (err) => log.warn({ err }, 'completion shutdown failed'),
  })
  disposeIpcIngress = () => {
    disposeNexusClipboard()
    disposeLegacyImportIpc()
    disposeDownloadProgress()
    disposeCompletionShutdown()
    disposeCommandHandlers()
    disposeQueryHandlers()
    disposeNotificationIpc()
    disposeApplicationMenuIpc()
  }

  // Plugin log stream: forward every ring-buffer entry to renderers as
  // `${Events.PluginLog}:<pluginId>`. Renderers subscribe to that suffixed
  // channel via `window.motrix.on(`event:pluginLog:${id}`, ...)`. We never
  // unsubscribe — the host lives for the app lifetime.
  pluginCapHost.subscribeLog((pluginId, entry) => {
    windowManager.broadcast(`${Events.PluginLog}:${pluginId}`, entry)
  })

  setupPowerManager(eventBus)

  // menuManager is assigned and install()ed above — non-null by this point
  const activeMenuManager = menuManager as MenuManager
  trayHandle = setupTray({
    eventBus,
    settingsManager,
    menuManager: activeMenuManager,
    protocolManager,
    extraResourceDir: platform.extraResourceDir,
    toggleMainWindow: () => windowManager.toggle('main'),
    nexusWindows: {
      getTasks: () => taskManager.getAll(),
      getErrorCount: () => {
        const marks = nexusWorkspace.snapshot().networkMarks
        const enabled = nexusWorkspace.getPreferences().markInternet
        return taskManager
          .getAll()
          .filter(
            (task) =>
              task.status === TaskStatus.Error ||
              (enabled && marks[task.id] === 'failed')
          ).length
      },
      showMain: () => windowManager.show('main'),
      openAdd: openNexusAddFromShell,
      pauseAll: () => mainProcessWork.run(() => pauseAllTasks(commandDeps)),
      resumeAll: () => mainProcessWork.run(() => resumeAllTasks(commandDeps)),
      quit: () => app.quit(),
      noticeShown: () => nexusWorkspace.getPreferences().trayNoticeShown,
      saveNoticeShown: () =>
        nexusWorkspace.updatePreferences({ trayNoticeShown: true }),
    },
  })

  launcher.flushDeferred()

  // ── Phase 3: Background tasks (no blocking) ───────────────
  // NAT discovery, engine start, and add-task window creation
  // all run in the background — none of them need to complete
  // before the user can see and interact with the main window.

  const startupNatManager = natManager
  if (settingsManager.get().nat.enabled && startupNatManager) {
    runShellAsyncWork('NAT manager start', () => startupNatManager.start())
  }

  const startupTrackerManager = trackerManager
  if (startupTrackerManager) {
    runShellAsyncWork('tracker manager init', () =>
      startupTrackerManager.init()
    )
  }

  void mainProcessWork
    .startStartup(async () => {
      // Finish the non-engine proxy scopes before startup commits the exact
      // aria2 route. This prevents a late non-Ready apply result from
      // overwriting the Ready snapshot.
      await proxyReady
      await startEngineAndRestore(engineSettings.sessionSaveInterval, adapter)
      await mediaRecovery?.restore(productMedia, taskManager.getAll())
      await nexusCloud.recover()
      cloudRestored = true
      if (portableProfile && portableUpdate) {
        const main = windowManager.get('main')
        let rendered = false
        for (let attempt = 0; attempt < 100 && !rendered; attempt++) {
          rendered = !!(await main?.webContents
            .executeJavaScript(
              "Boolean(document.getElementById('root')?.children.length)"
            )
            .catch(() => false))
          if (!rendered)
            await new Promise((resolve) => setTimeout(resolve, 200))
        }
        if (rendered) {
          const result = await acknowledgePortableUpdate(
            portableProfile,
            app.getVersion()
          )
          if (result?.phase === 'booting' || result?.phase === 'completed')
            portableUpdate.setStartupResult({
              completedVersion: result.version,
              releaseNotes: result.releaseNotes,
            })
          else if (result?.phase === 'restored')
            portableUpdate.setStartupResult({
              restoredVersion: result.previousVersion,
              releaseNotes: result.releaseNotes,
            })
        }
      }
    })
    .catch((err) => {
      log.error({ err }, 'engine start/restore failed')
    })

  const bridgeEnabled =
    NEXUS_BUILD_POLICY.browserIntegration &&
    settingsManager.getApp().browserBridgeEnabled
  const startupBridgeManager = bridgeManager
  if (startupBridgeManager) {
    runShellAsyncWork(bridgeEnabled ? 'bridge start' : 'bridge cleanup', () =>
      bridgeEnabled
        ? startupBridgeManager.start()
        : startupBridgeManager.setEnabled(false)
    )
  }

  setTimeout(() => {
    if (!mainProcessWork.isAccepting()) return
    if (settingsManager.getApp().lightweightMode) return
    log.info('precreating add-task window')
    windowManager.precreate('add-task')
  }, 2000)
}

app.on('ready', () => {
  void mainProcessWork.run(initializeMainProcess).catch((err) => {
    if (
      !mainProcessWork.isAccepting() &&
      err instanceof Error &&
      err.message === 'AsyncWorkTracker is stopped'
    ) {
      return
    }
    log.error({ err }, 'main process initialization failed')
    if (err instanceof PortableProfileError) {
      dialog.showErrorBox(
        i18n.t('settings.portable.title'),
        i18n.t('settings.portable.recoveryError')
      )
      void requestForcedQuit('portable-startup-failed')
    }
  })
})

// ─── Shutdown ───────────────────────────────────────────

const t = i18n.t.bind(i18n)

async function showQuitConfirmation(activeCount: number): Promise<{
  confirmed: boolean
  dontAskAgain: boolean
}> {
  const leaveModal = rendererRecovery?.supervisor.enterModal()
  try {
    const { response, checkboxChecked } = await dialog.showMessageBox({
      type: 'question',
      buttons: [t('common.cancel'), t('quit.confirm.quitButton')],
      defaultId: 0,
      cancelId: 0,
      message: t('quit.confirm.message', { count: activeCount }),
      detail:
        process.platform === 'win32'
          ? t('nexus.tray.quitDetail', { count: activeCount })
          : t('quit.confirm.detail'),
      checkboxLabel: t('quit.confirm.dontAskAgain'),
      checkboxChecked: false,
    })
    return { confirmed: response === 1, dontAskAgain: checkboxChecked }
  } catch {
    return { confirmed: true, dontAskAgain: false } // fail-open
  } finally {
    leaveModal?.()
  }
}

function beginShutdown(): void {
  armShutdownDeadline()
  log.info('shutdown requested')
  let finishing = false
  const finish = () => {
    if (finishing) return
    finishing = true
    try {
      if (motrixDb?.database.open) motrixDb.close()
    } catch {}
    log.info('shutdown cleanup completed')
    try {
      closeLogger()
    } catch {}
    app.exit(0)
  }
  const deadline = setTimeout(finish, 5000)

  graphicsRuntime?.stop()
  // quitController.phase is already 'shutting-down' (set synchronously before
  // this call). app.quit() below re-fires before-quit synchronously; the guard
  // there relies on the phase already being terminal.
  windowManager?.setWillQuit(true) // Never before/during quit confirmation.
  supervisor?.prepareForShutdown()
  // Drain a pending coalesced TaskUpdated while consumers are still attached.
  taskUpdatePublisher.flush()
  rendererRecovery?.dispose()
  // Tear down renderer ingress before removing ipcMain handlers. Service
  // shutdown emits final state-change events (for example NAT stopped), and a
  // still-live renderer can react by invoking queries after their handlers
  // have been removed.
  windowManager?.destroyAll()
  trayHandle?.prepareForQuit()
  menuManager?.dispose()
  osNotificationBridge?.dispose()

  void performCleanup()
    .catch(() => {})
    .finally(() => {
      clearTimeout(deadline)
      finish()
    })
}

function prepareForSessionEnd(): void {
  // This callback runs from Windows query-session-end/session-end and the
  // cross-platform powerMonitor shutdown event. Mark the child exit expected
  // synchronously; the ordinary quit flow performs the graceful stop later.
  supervisor?.prepareForShutdown()
  quitController.markSessionEnding()
}

const quitController = new QuitController({
  getWarnBeforeQuit: () => settingsManager.getApp().warnBeforeQuit,
  getActiveCount: () => countActiveDownloads(taskManager.getAll()),
  confirm: showQuitConfirmation,
  persistDisableWarn: () =>
    settingsManager.update({ app: { warnBeforeQuit: false } }).then(() => {}),
  beginShutdown,
})

if (!distributionContext.isWindowsPackage && !portableProfile) {
  registerUpdateQuitPreparation({
    updater: nativeAutoUpdater,
    markForceQuit: () => quitController.markForceQuit(),
    setWillQuit: (value) => windowManager?.setWillQuit(value),
  })
}

const requestForcedQuit = (reason: string) => {
  log.info({ reason }, 'received forced quit request')
  quitController.requestForcedQuit()
}

registerTerminationSignalHandlers(requestForcedQuit)
if (rendererUrlPolicy.isDevelopmentServer) {
  registerDevShutdownHandler(() => requestForcedQuit('dev-runner'))
}

app.on('before-quit', (event) => {
  // (1) terminal re-entry from beginShutdown()'s app.quit() — must proceed.
  if (quitController.phase === 'shutting-down') return
  // (2) from here we drive quit manually.
  event.preventDefault()
  // (3) dialog already open — ignore re-entrant quit requests.
  if (quitController.phase === 'confirming') return
  // (4) idle → let the controller decide.
  quitController.requestQuit()
})

// ─── Lifecycle ──────────────────────────────────────────

app.on('window-all-closed', () => {
  // Keep running — main window is just hidden
})

app.on('activate', () => {
  windowManager?.show('main')
})
