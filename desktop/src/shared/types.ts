export type Risk = 'safe' | 'moderate' | 'advanced'
export type Category = 'performance' | 'storage' | 'battery' | 'tv' | 'privacy' | 'startup'
export type Impact = 'low' | 'medium' | 'high'

export type StepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped' | 'unsupported'

export interface VerifySpec {
  run: string
  equals?: string
  contains?: string
  matches?: string
  expectEmptyOrExitCode?: number
}

export interface StepSpec {
  type?: 'shell' | 'installSystemApk'
  run: string
  verify: VerifySpec
  undo?: string | null
  undoIfUnset?: string
  timeoutMs: number
  optional?: boolean
  /** Host-local APK selected by the user, never a shell argument from renderer input. */
  apkPath?: string
  targetPath?: string
  mode?: string
  owner?: string
  selinuxContext?: string
  disablePackages?: string[]
}

export interface SystemApkMetadata {
  targetPath: string
  backupPath: string
  mode: string
  owner: string
  selinuxContext: string
  disablePackages: string[]
  userInstalledPackage?: string
  hadPrevious: boolean
}

/** Mecanismo disponible para ejecutar comandos con uid 0. */
export type RootStrategy = 'adb' | 'su' | 'none'

export interface SystemAccessReport {
  device: string
  model: string
  manufacturer: string
  androidVersion: string
  sdk: number
  buildType: string
  buildTags: string
  debuggable: boolean
  secure: boolean
  verifiedBootState: string
  bootloaderLocked: boolean | null
  dynamicPartitions: boolean
  systemRootImage: boolean
  adbRootSupported: boolean
  suAvailable: boolean
  suUid: number | null
  strategy: RootStrategy
  systemWritable: boolean
  reasons: string[]
}

export interface SystemLauncherDiagnostics {
  access: SystemAccessReport
  currentHome: string | null
  ready: boolean
}

export interface LauncherPackageState {
  packageName: string
  packageInstalled: boolean
  systemInstalled: boolean
}

export interface SystemAppCandidate {
  packageName: string
  apkPath: string
  apkName: string
}

export interface SystemAppMetadata {
  packageName: string
  targetDir: string
  backupDir: string
  files: string[]
  hadPrevious: boolean
}

export interface FlashImage {
  name: string
  path: string
  size: number
}

export interface FlashDiagnostics {
  device: string
  model: string
  manufacturer: string
  sdk: number
  slotSuffix: string
  partitions: string[]
  partitionDir: string
  bootPartition: string
  /** Partición con sufijo de slot para respaldar (p. ej. boot_a). */
  activeBootPartition: string
  fastbootAvailable: boolean
  fastbootVersion: string | null
  usb: boolean
  adbRoot: boolean
  suAvailable: boolean
  magiskApp: boolean
  magiskAppVersion: string | null
  bootloaderLocked: boolean | null
  images: FlashImage[]
  reasons: string[]
}

export interface FlashResult {
  serial: string
  partition: string
  output: string
  magiskVersion: string | null
}

export interface AppliesTo {
  minSdk?: number
  maxSdk?: number
  isTv?: boolean | null
  manufacturers?: string[] | null
}

export interface Recipe {
  id: string
  category: Category
  risk: Risk
  requiresRoot: boolean
  impact: Impact
  appliesTo: AppliesTo
  titleKey: string
  summaryKey: string
  steps: StepSpec[]
}

export interface ActionSpec {
  id: string
  titleKey: string
  paramKind: 'package' | 'none'
  risk: Risk
  run: string
  verify: VerifySpec
  undo?: string | null
  timeoutMs: number
  minSdk?: number
  blocklist?: string[]
}

export interface Catalog {
  schemaVersion: number
  catalogVersion: string
  recipes: Recipe[]
}

export interface ActionCatalog {
  schemaVersion: number
  actions: ActionSpec[]
}

export type DeviceState = 'device' | 'offline' | 'unauthorized' | 'unknown'

/** Como esta conectado el dispositivo al host. */
export type Transport = 'usb' | 'network' | 'emulator'

export interface DeviceRef {
  id: string
  address: string
  state: DeviceState
  transport: Transport
  model?: string
}

export interface WirelessResult {
  ok: boolean
  message: string
  address: string | null
}

export interface MdnsService {
  kind: 'connect' | 'pairing' | 'other'
  name: string
  address: string
}

export interface DeviceInfo {
  id: string
  model: string
  manufacturer: string
  sdk: number
  androidVersion: string
  isTv: boolean
  hasRoot: boolean
  abi: string
}

export interface ScrcpyStatus {
  running: boolean
  serial: string | null
}

export interface DeviceMetrics {
  totalRamKb: number
  usedRamKb: number
  freeRamKb: number
  cachedKb: number
  cpuBusyPercent: number
  load1: number
  storageTotalKb: number
  storageUsedKb: number
  storageAvailableKb: number
  temperatureC: number | null
  maxThermalStatus: number
  uptimeSeconds: number
  backgroundProcesses: number
  /** Nivel de bateria 0..100; -1 cuando no aplica o no se pudo leer. */
  batteryPercent: number
}

export interface StepResult {
  index: number
  run: string
  status: StepStatus
  output: string
  error?: string
  previousValue?: string | null
  durationMs: number
  systemApk?: SystemApkMetadata
}

export interface RunResult {
  recipeId: string
  status: 'ok' | 'partial' | 'failed' | 'unsupported'
  steps: StepResult[]
  startedAt: string
  finishedAt: string
  dryRun: boolean
}

export interface JournalStep {
  index: number
  run: string
  undo: string | null
  undoIfUnset?: string
  previousValue: string | null
  output: string
  reversible: boolean
  systemApk?: SystemApkMetadata
  systemApp?: SystemAppMetadata
}

export interface JournalEntry {
  id: string
  deviceId: string
  deviceModel: string
  recipeId: string
  titleKey: string
  risk: Risk
  appliedAt: string
  revertedAt?: string
  steps: JournalStep[]
}

export interface PlanItem {
  recipe: Recipe
  supported: boolean
  reason?: string
}

export type Profile = 'conservative' | 'recommended' | 'aggressive'

export interface ConnectResult {
  ok: boolean
  message: string
}

export interface AppSettings {
  adbPath: string | null
}

export interface RemoteLauncher {
  packageName: string
  componentName: string
}

export interface ApkInstallResult {
  ok: boolean
  message: string
}

export interface ApkExtractFile {
  name: string
  path: string
}

export interface ApkExtractResult {
  packageName: string
  directory: string
  files: ApkExtractFile[]
}

export type QrState = 'waiting' | 'pairing' | 'connecting' | 'connected' | 'timeout' | 'error'

export interface QrStatus {
  state: QrState
  message?: string
  address?: string
  device?: DeviceInfo
}

export interface QrStartResult {
  name: string
  password: string
  qrText: string
  expiresInMs: number
}

export interface QrDiagnostics {
  backend: string
  discovered: MdnsService[]
}

export interface InstalledApp {
  packageName: string
  system: boolean
  disabled: boolean
  protected: boolean
  /** App de sistema oculta para el usuario 0 (se puede restaurar). */
  hidden?: boolean
}

export interface AppList {
  user: InstalledApp[]
  system: InstalledApp[]
  hidden: InstalledApp[]
}

export type DpcCheckStatus = 'ok' | 'warn' | 'fail'

export interface DpcCheck {
  id: string
  label: string
  status: DpcCheckStatus
  detail: string
}

export interface DpcPreflight {
  sdk: number
  owners: string[]
  users: Array<{ id: number; name: string }>
  accounts: number
  checks: DpcCheck[]
  ready: boolean
}

export interface DpcResult {
  ok: boolean
  message: string
}

/* ---------------------------------------------------------------------------
 * Paridad con la app Android: consola, logcat, inspector, ajustes del sistema,
 * Doze y energia, archivos, perfiles de apps, debloater y diagnostico ampliado.
 * ------------------------------------------------------------------------- */

export interface ConsoleResult {
  command: string
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  timedOut: boolean
}

export type LogcatLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F'

export interface LogcatEntry {
  time: string
  pid: string
  tid: string
  level: LogcatLevel
  tag: string
  message: string
}

export interface InspectorPermission {
  name: string
  granted: boolean | null
}

export type InspectorComponentKind = 'activity' | 'service' | 'receiver' | 'provider'

export interface InspectorComponent {
  kind: InspectorComponentKind
  className: string
}

export interface InspectorAppOp {
  name: string
  mode: string
}

export interface AppInspection {
  packageName: string
  permissions: InspectorPermission[]
  appOps: InspectorAppOp[]
  components: InspectorComponent[]
  signature: string | null
  apkSha256: string | null
}

export type SettingsNamespace = 'global' | 'secure' | 'system'

export interface SettingEntry {
  key: string
  value: string
}

export interface SettingsChange {
  id: string
  namespace: SettingsNamespace
  key: string
  previousValue: string
  newValue: string
  appliedAt: string
}

export interface SettingsWriteResult {
  ok: boolean
  value: string
}

export interface QuickSettings {
  nightMode: string | null
  screenOffTimeoutMs: number | null
  brightness: number | null
  batterySaver: boolean | null
}

export type DozeAction = 'force' | 'step' | 'unforce' | 'motion'

export type DozePhase = 'active' | 'inactive' | 'pending' | 'idle' | 'maintenance' | 'unknown'

export interface DozeStatus {
  deep: string | null
  light: string | null
  forced: boolean | null
  phase: DozePhase
}

export type DevicePowerAction = 'reboot' | 'shutdown' | 'recovery' | 'bootloader' | 'restart-system-ui'

export interface PowerResult {
  ok: boolean
  message: string
}

export interface RemoteFileEntry {
  name: string
  path: string
  isDirectory: boolean
  isLink: boolean
  sizeBytes: number
  mode: string
  isApk: boolean
}

export interface InstallOptions {
  grantPermissions: boolean
  allowDowngrade: boolean
  allowTest: boolean
}

export type ProfileAppState = 'ENABLED' | 'DISABLED' | 'UNINSTALLED'

export interface ProfileApp {
  packageName: string
  label: string
  state: ProfileAppState
}

export interface AppProfile {
  id: string
  name: string
  createdAt: number
  apps: ProfileApp[]
  watched: boolean
}

export type ProfileStepKind = 'REINSTALL' | 'ENABLE' | 'DISABLE' | 'UNINSTALL'

export interface ProfileStep {
  kind: ProfileStepKind
  packages: string[]
}

export interface ProfilePlan {
  steps: ProfileStep[]
  same: number
  missing: number
  blocked: number
}

export interface ProfileChange {
  packageName: string
  from: ProfileAppState
  to: ProfileAppState
}

export interface ProfileRun {
  id: string
  profileId: string
  profileName: string
  appliedAt: number
  changes: ProfileChange[]
  failures: string[]
}

export interface ProfilesDocument {
  profiles: AppProfile[]
  runs: ProfileRun[]
}

export interface ProfileProgress {
  done: number
  total: number
  packageName: string
  kind: ProfileStepKind
}

export type DebloatRisk = 'recommended' | 'advanced' | 'expert'

export interface DebloatEntry {
  packageName: string
  source: string
  risk: DebloatRisk
  description: string
}

export interface DebloatCatalogState {
  entries: DebloatEntry[]
  updatedAt: number | null
}

export interface DebloatSuggestion {
  packageName: string
  label: string
  state: ProfileAppState
  risk: DebloatRisk
  description: string
  source: string
}

export type DebloatAction = 'FREEZE' | 'UNFREEZE' | 'UNINSTALL' | 'RESTORE'

export interface DebloatRestoreItem {
  packageName: string
  label: string
  state: ProfileAppState
}

export interface DebloatRun {
  action: DebloatAction
  changes: ProfileChange[]
  failures: string[]
}

export interface DiagnosticsBattery {
  level: number | null
  health: string | null
  status: string | null
  voltageV: number | null
  temperatureC: number | null
  technology: string | null
  chargeCounterUah: number | null
  currentMa: number | null
}

export interface CpuCoreFrequency {
  index: number
  currentMhz: number | null
  minMhz: number | null
  maxMhz: number | null
}

export interface DiagnosticsScreenInfo {
  width: number | null
  height: number | null
  densityDpi: number | null
  refreshRateHz: number | null
}

export interface DiagnosticsSensor {
  name: string
  vendor: string
  type: string
}

export interface DiagnosticsNetworkInterface {
  name: string
  address: string
  prefix: number | null
}

export interface DeviceDiagnostics {
  hardware: {
    brand: string | null
    product: string | null
    board: string | null
    hardware: string | null
    abis: string | null
    usbHost: boolean | null
  }
  system: {
    patch: string | null
    build: string | null
    kernel: string | null
    vm: string | null
    baseband: string | null
  }
  gles: string | null
  vulkan: string | null
  battery: DiagnosticsBattery
  cpuCores: CpuCoreFrequency[]
  screen: DiagnosticsScreenInfo
  sensors: DiagnosticsSensor[]
  network: DiagnosticsNetworkInterface[]
}
