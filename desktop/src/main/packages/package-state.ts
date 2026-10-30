import type { ProfileAppState, ProfileStepKind } from '../../shared/types'
import type { AdbClient } from '../adb/adb-client'
import { parsePackageList } from '../apps/app-service'
import { assertPackageName } from '../validation'

const LIST_TIMEOUT_MS = 30_000
const COMMAND_TIMEOUT_MS = 45_000
const VALID_PACKAGE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/

/** Nombres de paquete utiles: sin espacios, sin vacios y con formato valido. */
function readPackages(stdout: string): Set<string> {
  return new Set(parsePackageList(stdout).filter((name) => VALID_PACKAGE.test(name)))
}

function commandFor(kind: ProfileStepKind, packageName: string): string {
  switch (kind) {
    case 'REINSTALL':
      return `pm install-existing --user 0 ${packageName}`
    case 'ENABLE':
      return `pm enable --user 0 ${packageName}`
    case 'DISABLE':
      return `pm disable-user --user 0 ${packageName}`
    case 'UNINSTALL':
      return `pm uninstall --user 0 ${packageName}`
  }
}

function readBackFor(kind: ProfileStepKind, packageName: string): string {
  switch (kind) {
    case 'REINSTALL':
      return `pm list packages ${packageName}`
    case 'ENABLE':
      return `pm list packages -e ${packageName}`
    case 'DISABLE':
      return `pm list packages -d ${packageName}`
    case 'UNINSTALL':
      return `pm list packages ${packageName}`
  }
}

function containsExact(output: string, packageName: string): boolean {
  return output
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line === `package:${packageName}`)
}

/**
 * Lectura y cambio del estado de paquetes por `pm`, compartido por perfiles y debloater.
 *
 * Un `pm` que responde 0 no basta: Android aplica algunos cambios con retraso, por eso
 * cada cambio se confirma leyendo el estado de vuelta. Los paquetes criticos nunca se
 * tocan, aunque un perfil los incluya.
 */
export class PackageStateService {
  constructor(
    private readonly client: AdbClient,
    private readonly protectedPackages: Set<string>,
  ) {}

  available(): boolean {
    return Boolean(this.client.deviceSerial)
  }

  /** Estado de cada app conocida: instalada, deshabilitada o desinstalada para el usuario. */
  async states(): Promise<Record<string, ProfileAppState>> {
    const [installedRaw, disabledRaw, knownRaw] = await Promise.all([
      this.client.shellText('pm list packages', LIST_TIMEOUT_MS),
      this.client.shellText('pm list packages -d', LIST_TIMEOUT_MS),
      this.client.shellText('pm list packages -u', LIST_TIMEOUT_MS),
    ])

    const installed = readPackages(installedRaw)
    const disabled = readPackages(disabledRaw)
    const states: Record<string, ProfileAppState> = {}

    for (const packageName of [...readPackages(knownRaw), ...installed]) {
      if (!installed.has(packageName)) {
        states[packageName] = 'UNINSTALLED'
      } else if (disabled.has(packageName)) {
        states[packageName] = 'DISABLED'
      } else {
        states[packageName] = 'ENABLED'
      }
    }

    return states
  }

  async execute(kind: ProfileStepKind, packageName: string): Promise<void> {
    const pkg = assertPackageName(packageName)
    if (this.protectedPackages.has(pkg)) {
      throw new Error(`${pkg} es un paquete crítico y no se modifica.`)
    }

    const result = await this.client.shell(commandFor(kind, pkg), COMMAND_TIMEOUT_MS)
    const output = `${result.stdout}\n${result.stderr}`.trim()
    const rejected =
      result.code !== 0 ||
      /Failure/i.test(output) ||
      /Error/i.test(output) ||
      /Unknown package/i.test(output)
    if (rejected) {
      throw new Error(output || `El dispositivo rechazó el cambio en ${pkg}.`)
    }

    const readBack = await this.client.shellText(readBackFor(kind, pkg), LIST_TIMEOUT_MS)
    const present = containsExact(readBack, pkg)
    const confirmed = kind === 'UNINSTALL' ? !present : present
    if (!confirmed) {
      throw new Error(`El dispositivo no confirmó el cambio en ${pkg}.`)
    }
  }
}
