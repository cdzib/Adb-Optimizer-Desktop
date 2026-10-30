import { contextBridge, ipcRenderer } from 'electron'
import type {
  ActionSpec, ApkExtractResult, ApkInstallResult, AppList, AppSettings, DeviceInfo, DeviceMetrics,
  DeviceRef, DpcPreflight, DpcResult, InstalledApp, JournalEntry, LauncherPackageState, MdnsService,
  PlanItem, Profile, QrDiagnostics, QrStartResult, QrStatus, Recipe, RemoteLauncher,
  RunResult, ScrcpyStatus, StepResult, SystemAccessReport, SystemAppCandidate, SystemLauncherDiagnostics,
  FlashDiagnostics, FlashImage, FlashResult,
  AppInspection, ConsoleResult, DebloatAction, DebloatCatalogState, DebloatRestoreItem,
  DebloatRun, DebloatSuggestion, DeviceDiagnostics, DevicePowerAction, DozeAction, DozeStatus,
  InstallOptions, LogcatEntry, PowerResult, ProfileApp, ProfileAppState, ProfileChange,
  ProfilePlan, ProfileProgress, ProfileRun, ProfilesDocument, QuickSettings, RemoteFileEntry,
  SettingEntry, SettingsChange, SettingsNamespace, SettingsWriteResult, AppProfile,
} from '../shared/types'

interface DesktopApi {
  appState(): Promise<AppSettings & { catalogVersion: string; recipeCount: number; actionCount: number; labMode: boolean }>
  i18n(locale: string): Promise<Record<string, string>>
  listDevices(): Promise<DeviceRef[]>
  mdns(): Promise<MdnsService[]>
  pair(address: string, code: string): Promise<{ ok: boolean; message: string }>
  connect(address: string): Promise<DeviceInfo>
  enableWireless(port: number): Promise<{ ok: boolean; message: string; address: string | null }>
  useUsbMode(): Promise<{ ok: boolean; message: string }>
  deviceIp(): Promise<string | null>
  qrDiagnostics(): Promise<QrDiagnostics>
  startQr(): Promise<QrStartResult>
  cancelQr(): Promise<void>
  onQrStatus(listener: (status: QrStatus) => void): () => void
  disconnect(): Promise<void>
  sessionDevices(): Promise<DeviceInfo[]>
  switchDevice(id: string): Promise<DeviceInfo>
  disconnectDevice(id?: string): Promise<void>
  deviceInfo(): Promise<DeviceInfo | null>
  metrics(): Promise<DeviceMetrics | null>
  recipes(): Promise<Recipe[]>
  actions(): Promise<ActionSpec[]>
  plan(profile: Profile): Promise<PlanItem[]>
  run(recipeIds: string[], dryRun: boolean): Promise<RunResult[]>
  pickApks(): Promise<string[]>
  installApks(apkPaths: string[], options?: InstallOptions): Promise<ApkInstallResult>
  extractApk(packageName: string): Promise<ApkExtractResult | null>
  openFolder(path: string): Promise<void>
  launchers(): Promise<RemoteLauncher[]>
  currentLauncher(): Promise<RemoteLauncher | null>
  setLauncher(packageName: string): Promise<RemoteLauncher>
  pickWanboosApk(): Promise<{ name: string } | null>
  launcherDiagnostics(): Promise<SystemLauncherDiagnostics>
  launcherInspect(packageName: string): Promise<LauncherPackageState>
  installSystemLauncher(packageName: string, privileged: boolean): Promise<JournalEntry>
  activateSystemLauncher(packageName: string): Promise<void>
  installLauncherApk(): Promise<ApkInstallResult & { packageName: string | null }>
  rootDiagnostics(): Promise<SystemAccessReport>
  rootEnableAdbRoot(): Promise<SystemAccessReport>
  rootCheckSu(): Promise<SystemAccessReport>
  rootRemount(): Promise<SystemAccessReport>
  rootReboot(): Promise<void>
  systemApps(): Promise<SystemAppCandidate[]>
  convertToSystemApp(packageName: string, privileged: boolean): Promise<JournalEntry>
  flashDiagnostics(): Promise<FlashDiagnostics>
  flashImages(): Promise<FlashImage[]>
  flashPickImage(): Promise<{ path: string; name: string; size: number } | null>
  flashPullImage(remotePath: string): Promise<string>
  flashBackup(partition: string): Promise<{ path: string; size: number }>
  flashPickMagisk(): Promise<{ path: string; name: string } | null>
  flashInstallMagisk(apkPath: string): Promise<string>
  flashOpenMagisk(): Promise<void>
  flashImage(input: {
    imagePath: string
    partition: string
    slot: 'a' | 'b' | 'all' | 'none'
    disableVerity: boolean
    confirmDevice: string
  }): Promise<FlashResult>
  flashVerifyRoot(): Promise<string | null>
  listApps(): Promise<AppList>
  uninstallApp(app: InstalledApp): Promise<void>
  restoreApp(app: InstalledApp): Promise<void>
  enableApp(packageName: string): Promise<void>
  runAppAction(actionId: string, packageName: string): Promise<StepResult>
  dpcPreflight(mode?: 'device' | 'profile'): Promise<DpcPreflight>
  dpcReceivers(packageName?: string): Promise<string[]>
  dpcPickApk(): Promise<string | null>
  dpcInstall(apkPath: string, options?: { downgrade?: boolean }): Promise<DpcResult>
  dpcSetOwner(component: string, mode: 'device' | 'profile'): Promise<DpcResult>
  dpcRemoveOwner(component: string): Promise<DpcResult>
  dpcScript(apkPath: string, component: string, mode: 'device' | 'profile'): Promise<string>
  journal(): Promise<JournalEntry[]>
  undo(entryId: string): Promise<{ ok: boolean; steps: StepResult[] }>
  onLog(listener: (line: string) => void): () => void
  scrcpyStatus(): Promise<ScrcpyStatus>
  scrcpyStart(): Promise<ScrcpyStatus>
  scrcpyStop(): Promise<ScrcpyStatus>
  onScrcpyStatus(listener: (status: ScrcpyStatus) => void): () => void

  /* ---------------------------- paridad con Android */
  consoleHistory(): Promise<string[]>
  consoleRun(command: string): Promise<ConsoleResult>
  consoleClearHistory(): Promise<void>

  logcatRead(limit: number, since?: string): Promise<LogcatEntry[]>
  logcatClear(): Promise<void>
  logcatExport(entries: LogcatEntry[]): Promise<string | null>

  inspectApp(packageName: string): Promise<AppInspection>

  settingsList(namespace: SettingsNamespace): Promise<SettingEntry[]>
  settingsSave(namespace: SettingsNamespace, key: string, value: string): Promise<SettingsWriteResult>
  settingsHistory(): Promise<SettingsChange[]>
  settingsUndo(id: string): Promise<SettingsWriteResult>
  settingsQuick(): Promise<QuickSettings>
  settingsSetNightMode(mode: 'yes' | 'no' | 'auto'): Promise<SettingsWriteResult>

  dozeStatus(): Promise<DozeStatus>
  dozeRun(action: DozeAction): Promise<DozeStatus>
  devicePower(action: DevicePowerAction): Promise<PowerResult>

  filesList(path: string): Promise<RemoteFileEntry[]>
  filesReadText(path: string): Promise<string>
  filesMkdir(parent: string, name: string): Promise<void>
  filesRename(path: string, newName: string): Promise<void>
  filesDelete(path: string): Promise<void>
  filesInstallApk(path: string, options?: InstallOptions): Promise<{ ok: boolean; message: string }>
  filesPull(path: string): Promise<{ directory: string; files: string[] } | null>
  filesPush(targetDir: string): Promise<{ files: string[] } | null>

  profilesDocument(): Promise<ProfilesDocument>
  profilesSave(profile: AppProfile): Promise<AppProfile>
  profilesDelete(id: string): Promise<boolean>
  profilesSetWatched(id: string, watched: boolean): Promise<boolean>
  profilesStates(): Promise<Record<string, ProfileAppState>>
  profilesSnapshot(): Promise<ProfileApp[]>
  profilesPlan(profile: AppProfile): Promise<ProfilePlan>
  profilesApply(profile: AppProfile): Promise<ProfileRun>
  profilesUndo(changes: ProfileChange[]): Promise<number>
  onProfileProgress(listener: (progress: ProfileProgress) => void): () => void

  debloatCatalog(): Promise<DebloatCatalogState>
  debloatDownload(): Promise<DebloatCatalogState>
  debloatSuggestions(): Promise<DebloatSuggestion[]>
  debloatRestorable(): Promise<DebloatRestoreItem[]>
  debloatApply(action: DebloatAction, targets: string[]): Promise<DebloatRun>
  debloatUndo(run: DebloatRun): Promise<number>
  debloatRestore(targets: string[]): Promise<DebloatRun>

  deviceDiagnostics(): Promise<DeviceDiagnostics>
}

const api: DesktopApi = {
  appState: () => ipcRenderer.invoke('app:state'),
  i18n: (locale) => ipcRenderer.invoke('i18n:get', locale),
  listDevices: () => ipcRenderer.invoke('adb:devices'),
  mdns: () => ipcRenderer.invoke('adb:mdns'),
  pair: (address, code) => ipcRenderer.invoke('adb:pair', address, code),
  connect: (address) => ipcRenderer.invoke('adb:connect', address),
  enableWireless: (port) => ipcRenderer.invoke('adb:wireless', port),
  useUsbMode: () => ipcRenderer.invoke('adb:usb-mode'),
  deviceIp: () => ipcRenderer.invoke('adb:device-ip'),
  qrDiagnostics: () => ipcRenderer.invoke('qr:diagnostics'),
  startQr: () => ipcRenderer.invoke('qr:start'),
  cancelQr: () => ipcRenderer.invoke('qr:cancel'),
  onQrStatus: (listener) => subscribe('qr:status', listener),
  disconnect: () => ipcRenderer.invoke('adb:disconnect'),
  sessionDevices: () => ipcRenderer.invoke('session:devices'),
  switchDevice: (id) => ipcRenderer.invoke('device:switch', id),
  disconnectDevice: (id) => ipcRenderer.invoke('device:disconnect', id),
  deviceInfo: () => ipcRenderer.invoke('device:info'),
  metrics: () => ipcRenderer.invoke('device:metrics'),
  recipes: () => ipcRenderer.invoke('catalog:recipes'),
  actions: () => ipcRenderer.invoke('catalog:actions'),
  plan: (profile) => ipcRenderer.invoke('optimize:plan', profile),
  run: (recipeIds, dryRun) => ipcRenderer.invoke('optimize:run', recipeIds, dryRun),
  pickApks: () => ipcRenderer.invoke('apps:pick-apks'),
  installApks: (paths, options) => ipcRenderer.invoke('apps:install-apks', paths, options),
  extractApk: (packageName) => ipcRenderer.invoke('apps:extract-apk', packageName),
  openFolder: (path) => ipcRenderer.invoke('apps:open-folder', path),
  launchers: () => ipcRenderer.invoke('device:launchers'),
  currentLauncher: () => ipcRenderer.invoke('device:launcher-current'),
  setLauncher: (packageName) => ipcRenderer.invoke('device:launcher-set', packageName),
  pickWanboosApk: () => ipcRenderer.invoke('launcher:pick-apk'),
  launcherDiagnostics: () => ipcRenderer.invoke('launcher:diagnostics'),
  launcherInspect: (packageName) => ipcRenderer.invoke('launcher:inspect', packageName),
  installSystemLauncher: (packageName, privileged) => ipcRenderer.invoke('launcher:install', packageName, privileged),
  activateSystemLauncher: (packageName) => ipcRenderer.invoke('launcher:activate', packageName),
  installLauncherApk: () => ipcRenderer.invoke('launcher:install-apk'),
  rootDiagnostics: () => ipcRenderer.invoke('root:diagnostics'),
  rootEnableAdbRoot: () => ipcRenderer.invoke('root:adb-root'),
  rootCheckSu: () => ipcRenderer.invoke('root:check-su'),
  rootRemount: () => ipcRenderer.invoke('root:remount'),
  rootReboot: () => ipcRenderer.invoke('root:reboot'),
  systemApps: () => ipcRenderer.invoke('system:apps'),
  convertToSystemApp: (packageName, privileged) => ipcRenderer.invoke('system:convert', packageName, privileged),
  flashDiagnostics: () => ipcRenderer.invoke('flash:diagnostics'),
  flashImages: () => ipcRenderer.invoke('flash:images'),
  flashPickImage: () => ipcRenderer.invoke('flash:pick-image'),
  flashPullImage: (remotePath) => ipcRenderer.invoke('flash:pull-image', remotePath),
  flashBackup: (partition) => ipcRenderer.invoke('flash:backup', partition),
  flashPickMagisk: () => ipcRenderer.invoke('flash:pick-magisk'),
  flashInstallMagisk: (apkPath) => ipcRenderer.invoke('flash:magisk-install', apkPath),
  flashOpenMagisk: () => ipcRenderer.invoke('flash:open-magisk'),
  flashImage: (input) => ipcRenderer.invoke('flash:flash', input),
  flashVerifyRoot: () => ipcRenderer.invoke('flash:verify-root'),
  listApps: () => ipcRenderer.invoke('apps:list'),
  uninstallApp: (app) => ipcRenderer.invoke('apps:uninstall', app),
  restoreApp: (app) => ipcRenderer.invoke('apps:restore', app),
  enableApp: (packageName) => ipcRenderer.invoke('apps:enable', packageName),
  runAppAction: (actionId, packageName) => ipcRenderer.invoke('apps:action', actionId, packageName),
  dpcPreflight: (mode) => ipcRenderer.invoke('dpc:preflight', mode),
  dpcReceivers: (packageName) => ipcRenderer.invoke('dpc:receivers', packageName),
  dpcPickApk: () => ipcRenderer.invoke('dpc:pick-apk'),
  dpcInstall: (path, options) => ipcRenderer.invoke('dpc:install', path, options),
  dpcSetOwner: (component, mode) => ipcRenderer.invoke('dpc:set-owner', component, mode),
  dpcRemoveOwner: (component) => ipcRenderer.invoke('dpc:remove-owner', component),
  dpcScript: (path, component, mode) => ipcRenderer.invoke('dpc:script', path, component, mode),
  journal: () => ipcRenderer.invoke('journal:list'),
  undo: (entryId) => ipcRenderer.invoke('journal:undo', entryId),
  onLog: (listener) => subscribe('app:log', listener),
  scrcpyStatus: () => ipcRenderer.invoke('scrcpy:status'),
  scrcpyStart: () => ipcRenderer.invoke('scrcpy:start'),
  scrcpyStop: () => ipcRenderer.invoke('scrcpy:stop'),
  onScrcpyStatus: (listener) => subscribe('scrcpy:status', listener),

  consoleHistory: () => ipcRenderer.invoke('console:history'),
  consoleRun: (command) => ipcRenderer.invoke('console:run', command),
  consoleClearHistory: () => ipcRenderer.invoke('console:clear'),

  logcatRead: (limit, since) => ipcRenderer.invoke('logcat:read', limit, since),
  logcatClear: () => ipcRenderer.invoke('logcat:clear'),
  logcatExport: (entries) => ipcRenderer.invoke('logcat:export', entries),

  inspectApp: (packageName) => ipcRenderer.invoke('inspector:inspect', packageName),

  settingsList: (namespace) => ipcRenderer.invoke('settingsdb:list', namespace),
  settingsSave: (namespace, key, value) => ipcRenderer.invoke('settingsdb:save', namespace, key, value),
  settingsHistory: () => ipcRenderer.invoke('settingsdb:history'),
  settingsUndo: (id) => ipcRenderer.invoke('settingsdb:undo', id),
  settingsQuick: () => ipcRenderer.invoke('settingsdb:quick'),
  settingsSetNightMode: (mode) => ipcRenderer.invoke('settingsdb:night', mode),

  dozeStatus: () => ipcRenderer.invoke('doze:status'),
  dozeRun: (action) => ipcRenderer.invoke('doze:run', action),
  devicePower: (action) => ipcRenderer.invoke('power:run', action),

  filesList: (path) => ipcRenderer.invoke('files:list', path),
  filesReadText: (path) => ipcRenderer.invoke('files:read', path),
  filesMkdir: (parent, name) => ipcRenderer.invoke('files:mkdir', parent, name),
  filesRename: (path, newName) => ipcRenderer.invoke('files:rename', path, newName),
  filesDelete: (path) => ipcRenderer.invoke('files:delete', path),
  filesInstallApk: (path, options) => ipcRenderer.invoke('files:install-apk', path, options),
  filesPull: (path) => ipcRenderer.invoke('files:pull', path),
  filesPush: (targetDir) => ipcRenderer.invoke('files:push', targetDir),

  profilesDocument: () => ipcRenderer.invoke('profiles:document'),
  profilesSave: (profile) => ipcRenderer.invoke('profiles:save', profile),
  profilesDelete: (id) => ipcRenderer.invoke('profiles:delete', id),
  profilesSetWatched: (id, watched) => ipcRenderer.invoke('profiles:watch', id, watched),
  profilesStates: () => ipcRenderer.invoke('profiles:states'),
  profilesSnapshot: () => ipcRenderer.invoke('profiles:snapshot'),
  profilesPlan: (profile) => ipcRenderer.invoke('profiles:plan', profile),
  profilesApply: (profile) => ipcRenderer.invoke('profiles:apply', profile),
  profilesUndo: (changes) => ipcRenderer.invoke('profiles:undo', changes),
  onProfileProgress: (listener) => subscribe('profiles:progress', listener),

  debloatCatalog: () => ipcRenderer.invoke('debloat:catalog'),
  debloatDownload: () => ipcRenderer.invoke('debloat:download'),
  debloatSuggestions: () => ipcRenderer.invoke('debloat:suggestions'),
  debloatRestorable: () => ipcRenderer.invoke('debloat:restorable'),
  debloatApply: (action, targets) => ipcRenderer.invoke('debloat:apply', action, targets),
  debloatUndo: (run) => ipcRenderer.invoke('debloat:undo', run),
  debloatRestore: (targets) => ipcRenderer.invoke('debloat:restore', targets),

  deviceDiagnostics: () => ipcRenderer.invoke('diagnostics:read'),
}

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('api', api)
