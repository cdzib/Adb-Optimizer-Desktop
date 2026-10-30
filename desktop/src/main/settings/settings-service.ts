import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { IpcMain } from 'electron'
import type {
  QuickSettings,
  SettingEntry,
  SettingsChange,
  SettingsNamespace,
  SettingsWriteResult,
} from '../../shared/types'
import { shellQuote } from '../adb/adb-client'
import type { AdbClient } from '../adb/adb-client'
import type { FeatureContext } from '../features/context'
import { requireDevice } from '../features/context'
import { assertLabAllowed } from '../lab'
import { SettingsHistory } from './settings-history'
import {
  assertSettingsKey,
  assertSettingsNamespace,
  assertSettingsValue,
  normalizePrinted,
  parseNightMode,
  parseSettingBool,
  parseSettingInt,
  parseSettingsList,
  readBackMatches,
} from './settings-parser'

export type NightMode = 'yes' | 'no' | 'auto'

const ATTEMPTS = 3
const PAUSE_MS = 150

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Lectura y escritura de las tablas `global`, `secure` y `system`.
 *
 * Android acepta `settings put` con exit 0 aunque la clave este protegida por el
 * fabricante: por eso cada escritura se confirma releyendo el valor. Solo cuando el
 * read-back coincide se registra en el historial, que permite deshacer el cambio.
 */
export class SettingsService {
  private readonly historyStore: SettingsHistory

  constructor(
    private readonly client: AdbClient,
    dataDir: string,
  ) {
    this.historyStore = new SettingsHistory(join(dataDir, 'settings-history.json'))
  }

  async list(namespace: SettingsNamespace): Promise<SettingEntry[]> {
    const table = assertSettingsNamespace(namespace)
    const result = await this.client.shell(`settings list ${table}`, 25_000)
    if (result.code !== 0) {
      throw new Error(
        result.stdout.trim() || result.stderr.trim() || 'El dispositivo rechazo la lectura de la tabla.',
      )
    }
    return parseSettingsList(result.stdout)
  }

  async save(
    namespace: SettingsNamespace,
    key: string,
    value: string,
  ): Promise<SettingsWriteResult> {
    return this.write(namespace, key, value, true)
  }

  history(): SettingsChange[] {
    return this.historyStore.list()
  }

  async undo(id: string): Promise<SettingsWriteResult> {
    const change = this.historyStore.list().find((entry) => entry.id === id)
    if (!change) return { ok: false, value: '' }

    const result = await this.write(change.namespace, change.key, change.previousValue, false)
    if (result.ok) this.historyStore.remove(change.id)
    return result
  }

  /** Lectura de los cuatro ajustes rapidos; cada uno que falle queda en `null`. */
  async quick(): Promise<QuickSettings> {
    const [nightRaw, timeoutRaw, brightnessRaw, batteryRaw] = await Promise.all([
      this.readRaw('cmd uimode night'),
      this.readRaw('settings get system screen_off_timeout'),
      this.readRaw('settings get system screen_brightness'),
      this.readRaw('settings get global low_power'),
    ])

    return {
      nightMode: parseNightMode(nightRaw),
      screenOffTimeoutMs: parseSettingInt(timeoutRaw),
      brightness: parseSettingInt(brightnessRaw),
      batterySaver: parseSettingBool(batteryRaw),
    }
  }

  async setNightMode(mode: NightMode): Promise<SettingsWriteResult> {
    const target = assertNightMode(mode)
    await this.client.shell(`cmd uimode night ${target}`, 15_000)

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      if (attempt > 0) await pause(PAUSE_MS)
      const printed = await this.readRaw('cmd uimode night')
      if (printed && printed.trim().toLowerCase().endsWith(target)) {
        return { ok: true, value: target }
      }
    }

    return { ok: false, value: target }
  }

  private async write(
    namespace: SettingsNamespace,
    key: string,
    value: string,
    record: boolean,
  ): Promise<SettingsWriteResult> {
    const table = assertSettingsNamespace(namespace)
    const settingKey = assertSettingsKey(key)
    const nextValue = assertSettingsValue(value)

    const previous = normalizePrinted(await this.readRaw(`settings get ${table} ${settingKey}`))
    await this.client.shell(
      `settings put ${table} ${settingKey} ${shellQuote(nextValue)}`,
      20_000,
    )

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      if (attempt > 0) await pause(PAUSE_MS)
      const printed = await this.readRaw(`settings get ${table} ${settingKey}`)
      if (printed !== null && readBackMatches(printed, nextValue)) {
        if (record) {
          this.historyStore.append({
            id: randomUUID(),
            namespace: table,
            key: settingKey,
            previousValue: previous,
            newValue: nextValue,
            appliedAt: new Date().toISOString(),
          })
        }
        return { ok: true, value: nextValue }
      }
    }

    return { ok: false, value: nextValue }
  }

  /** Salida de un comando de lectura; `null` si el dispositivo lo rechaza. */
  private async readRaw(command: string): Promise<string | null> {
    try {
      const result = await this.client.shell(command, 10_000)
      return result.stdout
    } catch {
      return null
    }
  }
}

function assertNightMode(value: unknown): NightMode {
  if (value !== 'yes' && value !== 'no' && value !== 'auto') {
    throw new Error('El modo noche debe ser yes, no o auto.')
  }
  return value
}

export function registerSettingsIpc(ipc: IpcMain, ctx: FeatureContext): void {
  const service = new SettingsService(ctx.client, ctx.dataDir)

  ipc.handle('settingsdb:list', async (_event, namespace: unknown) => {
    requireDevice(ctx.client)
    return service.list(assertSettingsNamespace(namespace))
  })

  ipc.handle('settingsdb:save', async (_event, namespace: unknown, key: unknown, value: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'editar ajustes del sistema')
    return service.save(
      assertSettingsNamespace(namespace),
      assertSettingsKey(key),
      assertSettingsValue(value),
    )
  })

  ipc.handle('settingsdb:history', async () => {
    requireDevice(ctx.client)
    return service.history()
  })

  ipc.handle('settingsdb:undo', async (_event, id: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'deshacer un ajuste del sistema')
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('El cambio a deshacer no es valido.')
    }
    return service.undo(id)
  })

  ipc.handle('settingsdb:quick', async () => {
    requireDevice(ctx.client)
    return service.quick()
  })

  ipc.handle('settingsdb:night', async (_event, mode: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'cambiar el modo noche')
    return service.setNightMode(assertNightMode(mode))
  })
}
