import { writeFileSync } from 'node:fs'
import type { IpcMain } from 'electron'
import type { LogcatEntry } from '../../shared/types'
import type { AdbClient } from '../adb/adb-client'
import type { FeatureContext } from '../features/context'
import { requireDevice } from '../features/context'
import { assertLabAllowed } from '../lab'
import { parseLogcat } from './logcat-parser'

const MIN_LIMIT = 1
const MAX_LIMIT = 5000
const READ_TIMEOUT_MS = 30_000
/** `MM-DD HH:MM:SS.mmm`, el formato que devuelve `-v threadtime`. */
const SINCE_PATTERN = /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/

/** Lectura y limpieza del registro del dispositivo activo. */
export class LogcatService {
  constructor(private readonly client: AdbClient) {}

  async read(limit: number, since?: string): Promise<LogcatEntry[]> {
    const safeLimit = Number.isInteger(limit) ? limit : Number.NaN
    if (!Number.isInteger(safeLimit) || safeLimit < MIN_LIMIT || safeLimit > MAX_LIMIT) {
      throw new Error(`El limite debe ser un entero entre ${MIN_LIMIT} y ${MAX_LIMIT}.`)
    }
    if (since !== undefined && !SINCE_PATTERN.test(since)) {
      throw new Error('La marca de tiempo debe tener el formato MM-DD HH:MM:SS.mmm.')
    }

    const command = since
      ? `logcat -d -v threadtime -T "${since}"`
      : `logcat -d -v threadtime -t ${safeLimit}`

    try {
      const result = await this.client.shell(command, READ_TIMEOUT_MS)
      return parseLogcat(result.stdout)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new Error(message || 'No se pudo leer el registro del dispositivo.')
    }
  }

  async clear(): Promise<void> {
    try {
      await this.client.shell('logcat -c', 20_000)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new Error(message || 'No se pudo limpiar el registro del dispositivo.')
    }
  }
}

export function formatLogcat(entries: LogcatEntry[]): string {
  return entries
    .map((entry) => `${entry.time} ${entry.level}/${entry.tag}(${entry.pid}): ${entry.message}`)
    .join('\n')
}

export function registerLogcatIpc(ipc: IpcMain, ctx: FeatureContext): void {
  const service = new LogcatService(ctx.client)

  ipc.handle('logcat:read', async (_event, limit: unknown, since?: unknown) => {
    requireDevice(ctx.client)
    if (typeof limit !== 'number') {
      throw new Error('El limite debe ser un numero entero.')
    }
    if (since !== undefined && typeof since !== 'string') {
      throw new Error('La marca de tiempo debe ser texto.')
    }
    return service.read(limit, since)
  })

  ipc.handle('logcat:clear', async () => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'limpiar el registro del sistema')
    await service.clear()
    ctx.log('logcat: registro limpiado')
  })

  ipc.handle('logcat:export', async (_event, entries: unknown) => {
    if (!Array.isArray(entries)) {
      throw new Error('No hay entradas para exportar.')
    }
    const { dialog } = await import('electron')
    const result = await dialog.showSaveDialog({
      title: 'Exportar logcat',
      defaultPath: `logcat-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`,
      filters: [{ name: 'Texto', extensions: ['txt'] }],
    })
    const target = result.canceled ? null : result.filePath
    if (!target) return null

    writeFileSync(target, formatLogcat(entries as LogcatEntry[]), 'utf8')
    ctx.log(`logcat: exportado en ${target}`)
    return target
  })
}
