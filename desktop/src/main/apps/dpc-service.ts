import { readFile } from 'node:fs/promises'
import type { DpcCheck, DpcPreflight, DpcResult } from '../../shared/types'
import type { AdbClient } from '../adb/adb-client'
import { assertComponentName, assertPackageName } from '../validation'

const ADMIN_ACTION = 'android.app.action.DEVICE_ADMIN_ENABLED'

export function parseOwners(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('admin='))
    .map((line) => line.split('admin=')[1]?.split(',')[0]?.trim() ?? '')
    .filter(Boolean)
}

export function parseUsers(raw: string): Array<{ id: number; name: string }> {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.match(/UserInfo\{(\d+):([^:}]*)/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({ id: Number(match[1]), name: match[2]?.trim() || `usuario ${match[1]}` }))
}

/** `cmd package query-receivers` imprime bloques con "package/component". */
export function parseReceivers(raw: string): string[] {
  const components = raw
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.match(/^([a-zA-Z0-9_.]+\/[a-zA-Z0-9_.$]+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => match[1] as string)

  return Array.from(new Set(components))
}

export function countAccounts(raw: string): number {
  return raw.split('\n').filter((line) => line.includes('Account {') && !line.includes('Account {name=null')).length
}

/**
 * Reglas de Android para `dpm set-device-owner`:
 * sin owner previo, un solo usuario y ninguna cuenta configurada.
 */
export function evaluatePreflight(input: {
  sdk: number
  owners: string[]
  users: Array<{ id: number; name: string }>
  accounts: number
  mode?: 'device' | 'profile'
}): { checks: DpcCheck[]; ready: boolean } {
  const checks: DpcCheck[] = []
  const mode = input.mode ?? 'device'
  const extraUsers = input.users.filter((user) => user.id !== 0)

  checks.push({
    id: 'sdk',
    label: 'Version de Android',
    status: input.sdk >= 24 ? 'ok' : 'warn',
    detail: `SDK ${input.sdk}`,
  })

  checks.push({
    id: 'owner',
    label: 'Sin propietario previo',
    status: input.owners.length === 0 ? 'ok' : 'fail',
    detail:
      input.owners.length === 0
        ? 'ningun admin es Device/Profile Owner'
        : `ya existe: ${input.owners.join(', ')}`,
  })

  if (mode === 'device') {
    checks.push({
      id: 'users',
      label: 'Un solo usuario',
      status: extraUsers.length === 0 ? 'ok' : 'fail',
      detail:
        extraUsers.length === 0
          ? 'solo el usuario 0'
          : `${input.users.length} usuarios: ${extraUsers
              .map((user) => `${user.id}:${user.name}`)
              .join(', ')}`,
    })

    checks.push({
      id: 'accounts',
      label: 'Sin cuentas configuradas',
      status: input.accounts === 0 ? 'ok' : 'fail',
      detail:
        input.accounts === 0
          ? 'dispositivo sin cuentas'
          : `${input.accounts} cuentas; el aprovisionamiento exige un dispositivo recien restaurado`,
    })
  } else {
    checks.push({
      id: 'users',
      label: 'Perfil de trabajo disponible',
      status: extraUsers.length > 0 ? 'ok' : 'fail',
      detail:
        extraUsers.length > 0
          ? `usuarios: ${extraUsers.map((user) => `${user.id}:${user.name}`).join(', ')}`
          : 'crea un perfil de trabajo antes de aprovisionar (el usuario 0 no puede ser profile owner)',
    })

    checks.push({
      id: 'accounts',
      label: 'Cuentas en el perfil',
      status: 'ok',
      detail: `${input.accounts} cuentas en el dispositivo (permitidas en modo perfil)`,
    })
  }

  return { checks, ready: checks.every((check) => check.status !== 'fail') }
}

export class DpcService {
  constructor(private readonly client: AdbClient) {}

  async preflight(mode: 'device' | 'profile' = 'device'): Promise<DpcPreflight> {
    const [ownersRaw, usersRaw, accountRaw, sdkRaw] = await Promise.all([
      this.client.shellText('dpm list-owners', 15_000).catch(() => ''),
      this.client.shellText('pm list users', 15_000).catch(() => ''),
      this.client.shellText('dumpsys account', 30_000).catch(() => ''),
      this.client.shellText('getprop ro.build.version.sdk', 8_000).catch(() => '0'),
    ])

    const owners = parseOwners(ownersRaw)
    const users = parseUsers(usersRaw)
    const accounts = countAccounts(accountRaw)
    const sdk = Number.parseInt(sdkRaw.trim(), 10) || 0
    const { checks, ready } = evaluatePreflight({ sdk, owners, users, accounts, mode })

    return { sdk, owners, users, accounts, checks, ready }
  }

  async receivers(packageName?: string): Promise<string[]> {
    const filter = packageName === undefined ? null : assertPackageName(packageName)
    const raw = await this.client
      .shellText(`cmd package query-receivers --brief -a ${ADMIN_ACTION}`, 20_000)
      .catch(() => '')
    const all = parseReceivers(raw)
    return filter ? all.filter((component) => component.startsWith(`${filter}/`)) : all
  }

  async install(apkPath: string, options: { downgrade?: boolean; grant?: boolean } = {}): Promise<DpcResult> {
    await readFile(apkPath).catch(() => {
      throw new Error(`No se puede leer el APK: ${apkPath}`)
    })

    const flags = ['-r']
    if (options.grant !== false) flags.push('-g')
    if (options.downgrade) flags.push('-d')

    const result = await this.client.install(apkPath, flags)
    return {
      ok: /Success/i.test(result),
      message: result.trim() || 'sin salida de adb install',
    }
  }

  async setOwner(value: string, mode: 'device' | 'profile'): Promise<DpcResult> {
    const component = assertComponentName(value)
    const command =
      mode === 'device'
        ? `dpm set-device-owner --user 0 ${component}`
        : `dpm set-profile-owner --user 0 ${component}`

    const result = await this.client.shell(command, 60_000).catch((error: Error) => ({
      stdout: '',
      stderr: error.message,
    }))
    const output = `${result.stdout}\n${result.stderr}`.trim()

    return {
      ok: /Success/i.test(output),
      message: output || 'sin respuesta del dispositivo',
    }
  }

  /**
   * Solo funciona si el DPC lo permite (por ejemplo apps con android:testOnly).
   * Para un owner real, el camino soportado es restaurar de fabrica.
   */
  async removeOwner(value: string): Promise<DpcResult> {
    const component = assertComponentName(value)
    const result = await this.client
      .shell(`dpm remove-active-admin --user 0 ${component}`, 30_000)
      .catch((error: Error) => ({ stdout: '', stderr: error.message }))
    const output = `${result.stdout}\n${result.stderr}`.trim()

    return {
      ok: /Success/i.test(output),
      message: output || 'sin respuesta del dispositivo',
    }
  }
}
