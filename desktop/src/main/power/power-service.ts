import type { IpcMain } from 'electron'
import type {
  DevicePowerAction,
  DozeAction,
  DozeStatus,
  PowerResult,
} from '../../shared/types'
import { AdbError } from '../adb/adb-client'
import type { AdbClient } from '../adb/adb-client'
import type { FeatureContext } from '../features/context'
import { requireDevice } from '../features/context'
import { assertLabAllowed } from '../lab'
import { dozePhase, parseDozeBool, parseDozeToken } from './doze-parser'

export * from './doze-parser'

const STATUS_TIMEOUT_MS = 10_000
const ACTION_TIMEOUT_MS = 15_000
const ATTEMPTS = 4
const PAUSE_MS = 250
const RESTART_ATTEMPTS = 6
const RESTART_PAUSE_MS = 400
const SYSTEM_UI = 'com.android.systemui'

const POWER_COMMANDS: Record<Exclude<DevicePowerAction, 'restart-system-ui'>, string> = {
  reboot: 'svc power reboot',
  shutdown: 'svc power shutdown',
  recovery: 'svc power reboot recovery',
  bootloader: 'svc power reboot bootloader',
}

const POWER_LABELS: Record<Exclude<DevicePowerAction, 'restart-system-ui'>, string> = {
  reboot: 'reinicio',
  shutdown: 'apagado',
  recovery: 'reinicio a recovery',
  bootloader: 'reinicio a bootloader',
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** Lectura y control del controlador de reposo (Doze) y de la energia del equipo. */
export class PowerService {
  constructor(private readonly client: AdbClient) {}

  async status(): Promise<DozeStatus> {
    const [deepRaw, lightRaw, forceRaw] = await Promise.all([
      this.read('dumpsys deviceidle get deep'),
      this.read('dumpsys deviceidle get light'),
      this.read('dumpsys deviceidle get force'),
    ])
    const deep = parseDozeToken(deepRaw, false)
    return {
      deep,
      light: parseDozeToken(lightRaw, true),
      forced: parseDozeBool(forceRaw),
      phase: dozePhase(deep),
    }
  }

  async runDoze(action: DozeAction): Promise<DozeStatus> {
    switch (action) {
      case 'force':
        await this.exec('dumpsys deviceidle force-idle deep')
        await this.awaitForced(true)
        break
      case 'unforce':
        await this.exec('dumpsys deviceidle unforce')
        await this.awaitForced(false)
        break
      case 'step':
        await this.exec('dumpsys deviceidle step deep')
        break
      case 'motion':
        await this.exec('dumpsys deviceidle motion')
        break
    }
    return this.status()
  }

  async runPower(action: DevicePowerAction): Promise<PowerResult> {
    if (action === 'restart-system-ui') {
      return this.restartSystemUi()
    }

    const command = POWER_COMMANDS[action]
    try {
      const result = await this.client.shell(command, ACTION_TIMEOUT_MS)
      const output = `${result.stdout}\n${result.stderr}`.trim()
      if (
        result.code !== 0 ||
        result.stderr.trim().length > 0 ||
        /error|exception|failed|permission denial|unknown command|usage:/i.test(output)
      ) {
        return { ok: false, message: output || `exit=${result.code}` }
      }
      return {
        ok: true,
        message: `Solicitud de ${POWER_LABELS[action]} enviada; el equipo puede desconectarse.`,
      }
    } catch (cause) {
      if (isTransportClosed(cause)) {
        return { ok: true, message: 'Solicitud enviada; el equipo puede desconectarse.' }
      }
      return { ok: false, message: failureMessage(cause) }
    }
  }

  private async restartSystemUi(): Promise<PowerResult> {
    const before = await this.processId()
    const crash = await this.client.shell(`am crash ${SYSTEM_UI}`, ACTION_TIMEOUT_MS)
    const output = `${crash.stdout}\n${crash.stderr}`.trim()
    if (crash.code !== 0 || /error|exception|failed|permission denial|unknown command|usage:/i.test(output)) {
      return { ok: false, message: output || `exit=${crash.code}` }
    }

    for (let attempt = 0; attempt < RESTART_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await pause(RESTART_PAUSE_MS)
      const after = await this.processId()
      if (after !== null && after !== before) {
        return { ok: true, message: `Interfaz reiniciada (PID ${after}).` }
      }
    }

    return {
      ok: false,
      message: `La interfaz no reinició: el proceso sigue con el mismo PID (${before ?? 'desconocido'}).`,
    }
  }

  private async processId(): Promise<string | null> {
    try {
      const result = await this.client.shell(`pidof ${SYSTEM_UI}`, 5_000)
      const value = result.stdout.trim()
      return value.length > 0 ? value : null
    } catch {
      return null
    }
  }

  private async awaitForced(expected: boolean): Promise<void> {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      if (attempt > 0) await pause(PAUSE_MS)
      if (parseDozeBool(await this.read('dumpsys deviceidle get force')) === expected) return
    }
  }

  private async read(command: string): Promise<string | null> {
    try {
      const result = await this.client.shell(command, STATUS_TIMEOUT_MS)
      return result.stdout
    } catch {
      return null
    }
  }

  private async exec(command: string): Promise<void> {
    await this.client.shell(command, ACTION_TIMEOUT_MS)
  }
}

function isTransportClosed(cause: unknown): boolean {
  const message = failureMessage(cause)
  if (cause instanceof AdbError) {
    if (cause.kind === 'offline' || cause.kind === 'timeout') return true
    return /offline|closed|timed?\s?out|tiempo límite|device not found|no devices|connection/i.test(
      `${cause.output ?? ''} ${message}`,
    )
  }
  return /offline|closed|timed?\s?out|tiempo límite|device not found|no devices|connection|ENOENT/i.test(
    message,
  )
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function registerPowerIpc(ipc: IpcMain, ctx: FeatureContext): void {
  const service = new PowerService(ctx.client)

  ipc.handle('doze:status', async () => {
    requireDevice(ctx.client)
    return service.status()
  })

  ipc.handle('doze:run', async (_event, action: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'cambiar el estado de Doze')
    const result = await service.runDoze(assertDozeAction(action))
    ctx.log(`doze ${action}: ${result.phase} (deep ${result.deep ?? '—'})`)
    return result
  })

  ipc.handle('power:run', async (_event, action: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'reiniciar o apagar el dispositivo')
    const result = await service.runPower(assertPowerAction(action))
    ctx.log(`power ${action}: ${result.ok ? 'enviado' : 'fallo'}`)
    return result
  })
}

function assertDozeAction(value: unknown): DozeAction {
  if (value === 'force' || value === 'step' || value === 'unforce' || value === 'motion') {
    return value
  }
  throw new Error('La acción de Doze no es válida.')
}

function assertPowerAction(value: unknown): DevicePowerAction {
  if (
    value === 'reboot' ||
    value === 'shutdown' ||
    value === 'recovery' ||
    value === 'bootloader' ||
    value === 'restart-system-ui'
  ) {
    return value
  }
  throw new Error('La acción de energía no es válida.')
}
