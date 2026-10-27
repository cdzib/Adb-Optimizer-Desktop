import { mkdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { AdbClient } from '../adb/adb-client'
import type { Journal } from '../optimization/journal'
import { assertPackageName } from '../validation'
import type { AppList, ApkExtractResult, InstalledApp } from '../../shared/types'

export function parsePackageList(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('package:'))
    .map((line) => line.slice('package:'.length).trim())
    .filter((name) => name.length > 0 && !name.includes(' '))
}

export function loadProtectedPackages(filePath: string): Set<string> {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as { packages?: string[] }
  return new Set(raw.packages ?? [])
}

/** Los paquetes RRO/overlay no son apps: solo recursos de tema. Se ocultan del listado. */
export function isOverlayPackage(packageName: string): boolean {
  return (
    packageName.includes('auto_generated_rro') ||
    packageName.includes('.overlay.') ||
    packageName.startsWith('com.android.internal.systemui.navbar') ||
    packageName.startsWith('com.samsung.internal.systemui.navbar') ||
    packageName.startsWith('android.auto_generated')
  )
}

export function toInstalledApps(
  packages: string[],
  system: boolean,
  disabled: Set<string>,
  protectedPackages: Set<string>,
): InstalledApp[] {
  return packages
    .map((packageName) => ({
      packageName,
      system,
      disabled: disabled.has(packageName),
      protected: protectedPackages.has(packageName),
    }))
    .sort((a, b) => a.packageName.localeCompare(b.packageName))
}

/**
 * Gestor de paquetes del dispositivo remoto.
 *
 * - Apps de usuario: `pm uninstall <pkg>` (eliminacion real, irreversible).
 * - Apps de sistema: `pm uninstall --user 0 <pkg>` (las oculta para el usuario actual,
 *   reversible con `cmd package install-existing`). Nunca toca la particion de sistema.
 */
export class AppService {
  constructor(
    private readonly client: AdbClient,
    private readonly journal: Journal,
    private readonly protectedPackages: Set<string>,
  ) {}

  async list(): Promise<AppList> {
    const [userRaw, systemRaw, disabledRaw, allSystemRaw] = await Promise.all([
      this.client.shellText('pm list packages -3', 30_000),
      this.client.shellText('pm list packages -s', 30_000),
      this.client.shellText('pm list packages -d', 30_000),
      this.client.shellText('pm list packages -u -s', 45_000),
    ])

    const disabled = new Set(parsePackageList(disabledRaw))
    const installedSystem = new Set(
      parsePackageList(systemRaw).filter((name) => !isOverlayPackage(name)),
    )
    const hiddenPackages = parsePackageList(allSystemRaw).filter(
      (name) => !installedSystem.has(name) && !isOverlayPackage(name),
    )

    return {
      user: toInstalledApps(
        parsePackageList(userRaw).filter((name) => !isOverlayPackage(name)),
        false,
        disabled,
        this.protectedPackages,
      ),
      system: toInstalledApps(
        Array.from(installedSystem),
        true,
        disabled,
        this.protectedPackages,
      ),
      hidden: toInstalledApps(hiddenPackages, true, new Set(), this.protectedPackages).map(
        (app) => ({ ...app, hidden: true }),
      ),
    }
  }

  async uninstall(app: InstalledApp, device: { id: string; model: string }): Promise<void> {
    const packageName = assertPackageName(app.packageName)
    if (this.protectedPackages.has(packageName)) {
      throw new Error(`${packageName} esta protegida: desinstalarla dejaria el equipo inutilizable.`)
    }
    if (app.disabled) {
      throw new Error(`${packageName} ya esta deshabilitada para este usuario.`)
    }

    // El flag `system` viene del renderer; se comprueba contra el dispositivo.
    const systemRaw = await this.client.shellText(`pm list packages -s ${packageName}`, 15_000)
    const isSystem = parsePackageList(systemRaw).includes(packageName)
    const command = isSystem
      ? `pm uninstall --user 0 ${packageName}`
      : `pm uninstall ${packageName}`

    const result = await this.client.shell(command, 90_000)
    const output = `${result.stdout}\n${result.stderr}`.trim()

    if (!/Success/i.test(output)) {
      throw new Error(output || `El dispositivo rechazo la desinstalacion de ${packageName}.`)
    }

    const stillThere = await this.exists(packageName)
    if (stillThere) {
      throw new Error(`${packageName} sigue instalada para el usuario 0.`)
    }

    const undo = isSystem ? `cmd package install-existing ${packageName}` : null
    this.journal.append({
      deviceId: device.id,
      deviceModel: device.model,
      recipeId: `uninstall:${packageName}`,
      titleKey: 'apps.uninstall',
      risk: isSystem ? 'moderate' : 'advanced',
      steps: [
        {
          index: 0,
          run: command,
          undo,
          previousValue: packageName,
          output,
          reversible: undo !== null,
        },
      ],
    })
  }

  async restore(app: InstalledApp): Promise<void> {
    const packageName = assertPackageName(app.packageName)
    if (!app.system) {
      throw new Error('Solo se pueden restaurar apps de sistema ocultadas para el usuario 0.')
    }
    const result = await this.client.shell(`cmd package install-existing ${packageName}`, 60_000)
    const output = `${result.stdout}\n${result.stderr}`.trim()
    if (!/installed for user/i.test(output) && !/Success/i.test(output)) {
      throw new Error(output || `No se pudo restaurar ${packageName}.`)
    }
  }

  async enable(value: string): Promise<void> {
    const packageName = assertPackageName(value)
    const result = await this.client.shell(`pm enable ${packageName}`, 20_000)
    const output = `${result.stdout}\n${result.stderr}`.trim()
    if (/Error|Exception/i.test(output)) {
      throw new Error(output)
    }
  }

  /**
   * Extrae los APK de un paquete (base + splits) a una subcarpeta con su nombre.
   * Solo lee del dispositivo: no altera nada, por eso no se registra en el journal.
   */
  async extractApks(packageName: string, destinationDir: string): Promise<ApkExtractResult> {
    const remotePaths = await this.client.packageApkPaths(packageName)
    const directory = join(destinationDir, packageName)
    mkdirSync(directory, { recursive: true })

    const localPaths = await this.client.pull(remotePaths, directory)
    return {
      packageName,
      directory,
      files: localPaths.map((path) => ({ name: basename(path), path })),
    }
  }

  private async exists(value: string): Promise<boolean> {
    const packageName = assertPackageName(value)
    const raw = await this.client.shellText(`pm list packages --user 0 ${packageName}`, 15_000)
    return raw
      .split('\n')
      .map((line) => line.trim())
      .includes(`package:${packageName}`)
  }
}
