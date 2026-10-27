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
