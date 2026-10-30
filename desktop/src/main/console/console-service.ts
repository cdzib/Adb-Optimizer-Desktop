import { join } from 'node:path'
import type { IpcMain } from 'electron'
import type { ConsoleResult } from '../../shared/types'
import { AdbError } from '../adb/adb-client'
import type { AdbClient } from '../adb/adb-client'
import type { FeatureContext } from '../features/context'
import { requireDevice } from '../features/context'
import { assertLabAllowed } from '../lab'
import { ConsoleHistoryStore } from './history-store'

const COMMAND_TIMEOUT_MS = 60_000
const MAX_COMMAND_LENGTH = 4000

/**
 * Consola ADB: ejecuta un comando de shell en el dispositivo activo y guarda
 * el historial local. Los fallos se devuelven como resultado, nunca como
 * excepcion, para que la pantalla siempre pueda mostrar la salida del equipo.
 */
export class ConsoleService {
  private readonly store: ConsoleHistoryStore

  constructor(
    private readonly client: AdbClient,
    dataDir: string,
  ) {
    this.store = new ConsoleHistoryStore(join(dataDir, 'console-history.json'))
  }

  history(): string[] {
    return this.store.list()
  }

  async run(command: string): Promise<ConsoleResult> {
    const trimmed = command.trim()
    const startedAt = Date.now()

    if (trimmed.length === 0) {
      return failure(trimmed, 'Escribe un comando.', startedAt)
    }
    if (trimmed.length > MAX_COMMAND_LENGTH) {
      return failure(
        trimmed.slice(0, MAX_COMMAND_LENGTH),
        `El comando supera el limite de ${MAX_COMMAND_LENGTH} caracteres.`,
        startedAt,
      )
    }

    try {
      const result = await this.client.shell(trimmed, COMMAND_TIMEOUT_MS)
      this.store.append(trimmed)
      return {
        command: trimmed,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code,
        durationMs: result.durationMs ?? Date.now() - startedAt,
        timedOut: result.timedOut,
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      const detail = cause instanceof AdbError && cause.output ? cause.output : message
      return {
        command: trimmed,
        stdout: '',
        stderr: detail,
        exitCode: -1,
        durationMs: Date.now() - startedAt,
        timedOut: false,
      }
    }
  }

  clear(): void {
    this.store.clear()
  }
}

function failure(command: string, message: string, startedAt: number): ConsoleResult {
  return {
    command,
    stdout: '',
    stderr: message,
    exitCode: -1,
    durationMs: Date.now() - startedAt,
    timedOut: false,
  }
}

/** Registra los canales de la consola; el servicio se crea una vez por sesion. */
export function registerConsoleIpc(ipc: IpcMain, ctx: FeatureContext): void {
  const service = new ConsoleService(ctx.client, ctx.dataDir)

  ipc.handle('console:history', () => service.history())

  ipc.handle('console:run', async (_event, command: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'ejecutar comandos de shell')
    if (typeof command !== 'string') {
      return failure('', 'El comando debe ser texto.', Date.now())
    }
    const result = await service.run(command)
    ctx.log(`console: ${result.command} (exit ${result.exitCode})`)
    return result
  })

  ipc.handle('console:clear', () => {
    service.clear()
  })
}
