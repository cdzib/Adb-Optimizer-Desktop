import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type {
  DeviceInfo,
  JournalEntry,
  Recipe,
  StepSpec,
  SystemLauncherDiagnostics,
  LauncherPackageState,
} from '../../shared/types'
import { AdbClient } from '../adb/adb-client'
import { assertLabAllowed } from '../lab'
import { Journal } from './journal'

const BACKUP_PREFIX = '/data/local/tmp/adb-optimizer-launcher-'
const SYSTEM_PREFIX = '/system/'

/**
 * Flujo de launcher de sistema para cualquier TV/dispositivo con escritura en
 * /system (adb root o su). Copia el APK, reinicia, verifica el escaneo, asigna
 * Home y solo entonces deshabilita el Home anterior.
 */
export class SystemLauncherService {
  constructor(
    private readonly client: AdbClient,
    private readonly journal: Journal,
    private readonly recipe: Recipe,
    private readonly onProgress: (line: string) => void = () => undefined,
  ) {}

  async diagnostics(): Promise<SystemLauncherDiagnostics> {
    const access = await this.client.probeSystemAccess()
    const currentHome = await this.client.currentHomeLauncher().catch(() => null)
    return {
      access,
      currentHome: currentHome?.packageName ?? null,
      ready: access.strategy !== 'none',
    }
  }

  /** Estado del paquete seleccionado (se consulta al elegir el APK). */
  async inspect(packageName: string): Promise<LauncherPackageState> {
    if (!isPackageName(packageName)) {
      return { packageName, packageInstalled: false, systemInstalled: false }
    }
    const paths = await this.client.shellText(`pm path ${packageName}`, 15_000).catch(() => '')
    return {
      packageName,
      packageInstalled: paths.includes('package:'),
      systemInstalled: paths.includes(SYSTEM_PREFIX),
    }
  }

  async install(input: {
    apkPath: string
    packageName: string
    privileged: boolean
    device: DeviceInfo
  }): Promise<JournalEntry> {
    assertLabAllowed(this.client.deviceSerial, 'instalar el launcher en /system')
    if (!existsSync(input.apkPath)) throw new Error('El APK seleccionado ya no existe.')
    if (!isPackageName(input.packageName)) throw new Error('El nombre del paquete no es válido.')

    const access = await this.client.probeSystemAccess()
    if (access.strategy === 'none') {
      throw new Error(
        `Este dispositivo no permite escribir en /system. ${access.reasons.join(' ')} ` +
          'Conéctalo con un build userdebug/eng o instala root (Magisk/KernelSU) y vuelve a intentarlo.',
      )
    }

    const state = await this.inspect(input.packageName)
    if (!state.packageInstalled) {
      throw new Error(
        `${input.packageName} no está registrado en el dispositivo. Instala primero el APK como app normal y vuelve a comprobarlo; no se escribió ningún archivo.`,
      )
    }
    if (state.systemInstalled) {
      throw new Error(`${input.packageName} ya se está ejecutando desde /system.`)
    }

    const step = this.requireInstallStep()
    const previousHome = await this.client.currentHomeLauncher().catch(() => null)
    const disablePackages = this.packagesToDisable(step, input.packageName, previousHome?.packageName)

    const directory = `/system/${input.privileged ? 'priv-app' : 'app'}/${input.packageName}`
    const remoteName = apkFileName(input.apkPath, input.packageName)
    const targetPath = `${directory}/${remoteName}`
    const backupPath = `${BACKUP_PREFIX}${input.packageName.replace(/[^A-Za-z0-9_.-]/g, '_')}.backup.apk`

    this.onProgress(`system-launcher: copiando ${input.packageName} a ${targetPath}`)
    const outcome = await this.client.installSystemApk({
      apkPath: input.apkPath,
      targetPath,
      backupPath,
      mode: step.mode,
      owner: step.owner,
      selinuxContext: step.selinuxContext,
      disablePackages,
    })

    const systemApk = {
      targetPath,
      backupPath,
      mode: step.mode,
      owner: step.owner,
      selinuxContext: step.selinuxContext,
      disablePackages,
      userInstalledPackage: input.packageName,
      hadPrevious: outcome.hadPrevious,
    }
    const entry = this.journal.append({
      deviceId: input.device.id,
      deviceModel: `${input.device.manufacturer} ${input.device.model}`.trim(),
      recipeId: this.recipe.id,
      titleKey: this.recipe.titleKey,
      risk: this.recipe.risk,
      steps: [{
        index: 0,
        run: `installSystemApk ${targetPath}`,
        undo: 'restoreSystemApk',
        previousValue: null,
        output: outcome.output,
        reversible: true,
        systemApk,
      }],
    })

    this.onProgress('system-launcher: APK copiado; reiniciando para que Android lo escanee')
    await this.client.rebootDevice()
    await this.client.waitForBoot()

    try {
      const activationOutput = await this.activateSystemHome(input.packageName, targetPath, disablePackages)
      const stored = this.journal.update(entry.id, {
        steps: [{
          ...entry.steps[0]!,
          output: [outcome.output, activationOutput].filter(Boolean).join('\n'),
        }],
      })
      this.onProgress('system-launcher: Home asignado y launcher anterior deshabilitado')
      return stored ?? entry
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `${message} El APK quedó en /system y el Home anterior sigue activo; usa "Restaurar cambios" o reintenta la activación.`,
      )
    }
  }

  /** Recuperación: activa un launcher que ya está registrado desde /system. */
  async activate(packageName: string): Promise<void> {
    assertLabAllowed(this.client.deviceSerial, 'activar el launcher de sistema')
    if (!isPackageName(packageName)) throw new Error('El nombre del paquete no es válido.')
    const access = await this.client.probeSystemAccess()
    if (access.strategy === 'none') throw new Error('Este dispositivo no permite escribir en /system.')
    const paths = await this.client.shellText(`pm path ${packageName}`, 20_000)
    if (!paths.includes(SYSTEM_PREFIX)) {
      throw new Error(`${packageName} aún no está registrado desde /system. Reinicia, reconecta ADB y vuelve a diagnosticar.`)
    }
    const previousHome = await this.client.currentHomeLauncher().catch(() => null)
    await this.activateSystemHome(
      packageName,
      undefined,
      this.packagesToDisable(this.requireInstallStep(), packageName, previousHome?.packageName),
    )
  }

  private requireInstallStep(): StepSpec & Required<Pick<StepSpec, 'mode' | 'owner' | 'selinuxContext'>> {
    const step = this.recipe.steps.find((item) => item.type === 'installSystemApk')
    if (!step?.mode || !step.owner || !step.selinuxContext) {
      throw new Error('La receta de sistema no contiene la configuración de instalación requerida.')
    }
    return step as StepSpec & Required<Pick<StepSpec, 'mode' | 'owner' | 'selinuxContext'>>
  }

  private packagesToDisable(step: StepSpec, packageName: string, previousHome?: string | null): string[] {
    return [...new Set([...(step.disablePackages ?? []), previousHome ?? ''])]
      .filter((pkg) => pkg.length > 0 && pkg !== packageName)
  }

  private async activateSystemHome(
    packageName: string,
    targetPath: string | undefined,
    disablePackages: string[],
  ): Promise<string> {
    const lines: string[] = []
    if (targetPath) {
      const context = await this.client.systemFileContext(targetPath)
      if (!context || /unlabeled/i.test(context)) {
        throw new Error(`Android no reconoce el contexto SELinux de ${targetPath}; reinicia o revisa restorecon.`)
      }
      lines.push(`contexto: ${context.split(/\s+/).find((value) => value.startsWith('u:object_r:')) ?? context}`)
    }

    const packagePaths = await this.client.shellText(`pm path ${packageName}`, 20_000)
    if (!packagePaths.includes(SYSTEM_PREFIX)) {
      throw new Error(`Android no registró ${packageName} desde /system tras reiniciar; el APK no fue escaneado.`)
    }
    if (targetPath && !packagePaths.includes(targetPath)) {
      throw new Error(`Android no registró ${targetPath} tras reiniciar; el APK no fue escaneado.`)
    }

    const home = await this.client.setDefaultHomeLauncher(packageName)
    lines.push(`apk: ${packagePaths.split('\n').find((line) => line.includes(SYSTEM_PREFIX)) ?? ''}`)
    lines.push(`home: ${home.componentName}`)

    for (const pkg of disablePackages) {
      const output = await this.disablePreviousHome(pkg, packageName)
      if (output) lines.push(output)
    }

    const resolved = await this.client.currentHomeLauncher()
    if (resolved?.packageName !== packageName) {
      throw new Error('El Home dejó de resolver el launcher nuevo tras deshabilitar el anterior.')
    }
    lines.push(`home verificado: ${resolved.componentName}`)
    return lines.filter(Boolean).join('\n')
  }

  private async disablePreviousHome(packageName: string, newHome: string): Promise<string> {
    if (packageName === newHome) return ''
    const enabled = await this.client.shellText(`pm list packages -e ${packageName}`, 15_000)
    if (!enabled.includes(packageName)) return `${packageName}: no estaba habilitado`

    const result = await this.client.shell(`pm disable-user --user 0 '${packageName}'`, 20_000)
    if (/error|failure|failed/i.test(result.stdout)) {
      throw new Error(`No se pudo deshabilitar ${packageName}: ${result.stdout.trim()}`)
    }
    const disabled = await this.client.shellText(`pm list packages -d ${packageName}`, 15_000)
    if (!disabled.includes(packageName)) {
      throw new Error(`${packageName} sigue habilitado tras pm disable-user.`)
    }
    return `${packageName}: deshabilitado`
  }
}

function isPackageName(value: string): boolean {
  return /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(value)
}

function apkFileName(apkPath: string, packageName: string): string {
  const base = basename(apkPath).replace(/\.apk$/i, '')
  const sanitized = base.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '')
  return `${sanitized || packageName}.apk`
}
