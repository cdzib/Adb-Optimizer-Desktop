import type {
  ActionSpec,
  ApkInstallResult,
  ApkExtractResult,
  AppList,
  InstalledApp,
  DeviceInfo,
  DpcPreflight,
  DpcResult,
  DeviceMetrics,
  DeviceRef,
  JournalEntry,
  MdnsService,
  PlanItem,
  Profile,
  RemoteLauncher,
  QrDiagnostics,
  QrStartResult,
  QrStatus,
  Recipe,
  RunResult,
  ScrcpyStatus,
  StepResult,
  SystemAccessReport,
  SystemAppCandidate,
  SystemLauncherDiagnostics,
  LauncherPackageState,
  FlashDiagnostics,
  FlashImage,
  FlashResult,
} from '../shared/types'

export interface DesktopApi {
  appState(): Promise<{
    adbPath: string
    catalogVersion: string
    recipeCount: number
    actionCount: number
    labMode: boolean
  }>
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
  deviceInfo(): Promise<DeviceInfo | null>
  metrics(): Promise<DeviceMetrics | null>
  recipes(): Promise<Recipe[]>
  actions(): Promise<ActionSpec[]>
  plan(profile: Profile): Promise<PlanItem[]>
  run(recipeIds: string[], dryRun: boolean): Promise<RunResult[]>
  pickApks(): Promise<string[]>
  installApks(apkPaths: string[]): Promise<ApkInstallResult>
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
}

declare global {
  interface Window {
    api: DesktopApi
  }
}

export {}
