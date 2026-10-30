import { describe, expect, it } from 'vitest'
import { AdbError } from '../src/main/adb/adb-client'
import type { AdbClient } from '../src/main/adb/adb-client'
import type { CommandResult } from '../src/main/adb/runner'
import { dozePhase, parseDozeBool, parseDozeToken } from '../src/main/power/doze-parser'
import { PowerService } from '../src/main/power/power-service'

function ok(stdout = ''): CommandResult {
  return { code: 0, stdout, stderr: '', durationMs: 1, timedOut: false }
}

/** Cliente ADB falso con el estado de Doze y la cola de PID. */
class FakePowerClient {
  readonly calls: string[] = []
  deep = 'ACTIVE'
  light = 'ACTIVE'
  forced = 'false'
  pidResponses: string[] = ['100']
  failing = new Set<string>()
  crashOutput = ''

  async shell(command: string): Promise<CommandResult> {
    this.calls.push(command)

    if (this.failing.has(command)) {
      throw new AdbError('fallo simulado', 'shell', 'fallo simulado')
    }

    switch (command) {
      case 'dumpsys deviceidle get deep':
        return ok(this.deep)
      case 'dumpsys deviceidle get light':
        return ok(this.light)
      case 'dumpsys deviceidle get force':
        return ok(this.forced)
      case 'dumpsys deviceidle force-idle deep':
        this.forced = 'true'
        return ok()
      case 'dumpsys deviceidle unforce':
        this.forced = 'false'
        return ok()
      case 'dumpsys deviceidle step deep':
      case 'dumpsys deviceidle motion':
        return ok()
      case 'am crash com.android.systemui':
        return ok(this.crashOutput)
      case 'pidof com.android.systemui':
        return ok(this.pidResponses.shift() ?? '')
      default:
        return ok()
    }
  }
}

function setup() {
  const client = new FakePowerClient()
  const service = new PowerService(client as unknown as AdbClient)
  return { client, service }
}

describe('parseDozeToken', () => {
  it('acepta tokens sueltos de deep y light', () => {
    expect(parseDozeToken('ACTIVE\n', false)).toBe('ACTIVE')
    expect(parseDozeToken('IDLE_MAINTENANCE', false)).toBe('IDLE_MAINTENANCE')
    expect(parseDozeToken('QUICK_DOZE_DELAY', false)).toBe('QUICK_DOZE_DELAY')
    expect(parseDozeToken('PRE_IDLE', true)).toBe('PRE_IDLE')
    expect(parseDozeToken('WAITING_FOR_NETWORK', true)).toBe('WAITING_FOR_NETWORK')
    expect(parseDozeToken('OVERRIDE', true)).toBe('OVERRIDE')
  })

  it('lee el volcado completo y los pasos', () => {
    expect(parseDozeToken('Deep state: IDLE_PENDING, light state: ACTIVE', false)).toBe(
      'IDLE_PENDING',
    )
    expect(parseDozeToken('Light state: IDLE_MAINTENANCE', true)).toBe('IDLE_MAINTENANCE')
    expect(parseDozeToken('Stepped to deep: SENSING', false)).toBe('SENSING')
    expect(parseDozeToken('Stepped to light: IDLE', true)).toBe('IDLE')
  })

  it('ignora tokens fuera de la lista y estados del otro nivel', () => {
    expect(parseDozeToken(null, false)).toBeNull()
    expect(parseDozeToken('', false)).toBeNull()
    expect(parseDozeToken('DESCONOCIDO', false)).toBeNull()
    expect(parseDozeToken('Stepped to light: IDLE', false)).toBeNull()
    expect(parseDozeToken('Deep state: IDLE', true)).toBeNull()
    expect(parseDozeToken('ACTIVE', true)).toBe('ACTIVE')
  })
})

describe('parseDozeBool y dozePhase', () => {
  it('interpreta solo true/false', () => {
    expect(parseDozeBool('true\n')).toBe(true)
    expect(parseDozeBool('FALSE')).toBe(false)
    expect(parseDozeBool(' false ')).toBe(false)
    expect(parseDozeBool('1')).toBeNull()
    expect(parseDozeBool(null)).toBeNull()
  })

  it('mapea el estado profundo a una fase', () => {
    expect(dozePhase('ACTIVE')).toBe('active')
    expect(dozePhase('INACTIVE')).toBe('inactive')
    expect(dozePhase('QUICK_DOZE_DELAY')).toBe('inactive')
    expect(dozePhase('IDLE_PENDING')).toBe('pending')
    expect(dozePhase('SENSING')).toBe('pending')
    expect(dozePhase('LOCATING')).toBe('pending')
    expect(dozePhase('IDLE')).toBe('idle')
    expect(dozePhase('IDLE_MAINTENANCE')).toBe('maintenance')
    expect(dozePhase('otro')).toBe('unknown')
    expect(dozePhase(null)).toBe('unknown')
  })
})

describe('PowerService.status', () => {
  it('combina deep, light y force', async () => {
    const { client, service } = setup()
    client.deep = 'IDLE'
    client.light = 'PRE_IDLE'
    client.forced = 'true'

    const status = await service.status()

    expect(status).toEqual({
      deep: 'IDLE',
      light: 'PRE_IDLE',
      forced: true,
      phase: 'idle',
    })
    expect(client.calls).toEqual([
      'dumpsys deviceidle get deep',
      'dumpsys deviceidle get light',
      'dumpsys deviceidle get force',
    ])
  })

  it('tolera fallos de lectura y devuelve null', async () => {
    const { client, service } = setup()
    client.failing.add('dumpsys deviceidle get deep')
    client.failing.add('dumpsys deviceidle get force')

    const status = await service.status()

    expect(status.deep).toBeNull()
    expect(status.forced).toBeNull()
    expect(status.light).toBe('ACTIVE')
    expect(status.phase).toBe('unknown')
  })
})

describe('PowerService.runDoze', () => {
  it('fuerza deep idle y espera get force', async () => {
    const { client, service } = setup()

    const status = await service.runDoze('force')

    expect(client.calls).toContain('dumpsys deviceidle force-idle deep')
    expect(client.calls).toContain('dumpsys deviceidle get force')
    expect(status.forced).toBe(true)
  })

  it('quita el forzado con unforce', async () => {
    const { client, service } = setup()
    client.forced = 'true'

    const status = await service.runDoze('unforce')

    expect(client.calls).toContain('dumpsys deviceidle unforce')
    expect(status.forced).toBe(false)
  })

  it('avanza un paso y simula movimiento', async () => {
    const { client, service } = setup()

    await service.runDoze('step')
    await service.runDoze('motion')

    expect(client.calls).toContain('dumpsys deviceidle step deep')
    expect(client.calls).toContain('dumpsys deviceidle motion')
  })
})

describe('PowerService.runPower', () => {
  it('envia una sola solicitud de reinicio', async () => {
    const { client, service } = setup()

    const result = await service.runPower('reboot')

    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/puede desconectarse/i)
    expect(client.calls).toEqual(['svc power reboot'])
  })

  it('usa el comando exacto de cada accion', async () => {
    const commands: Array<[Parameters<PowerService['runPower']>[0], string]> = [
      ['shutdown', 'svc power shutdown'],
      ['recovery', 'svc power reboot recovery'],
      ['bootloader', 'svc power reboot bootloader'],
    ]

    for (const [action, command] of commands) {
      const { client, service } = setup()
      const result = await service.runPower(action)
      expect(result.ok).toBe(true)
      expect(client.calls).toEqual([command])
    }
  })

  it('reporta el error cuando el comando falla', async () => {
    const client = new FakePowerClient()
    client.shell = async (command: string): Promise<CommandResult> => {
      client.calls.push(command)
      return { code: 1, stdout: 'error: cannot reboot', stderr: '', durationMs: 1, timedOut: false }
    }
    const service = new PowerService(client as unknown as AdbClient)

    const result = await service.runPower('reboot')

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/cannot reboot/)
  })

  it('trata el cierre del transporte como solicitud enviada', async () => {
    const client = new FakePowerClient()
    client.shell = async (): Promise<CommandResult> => {
      throw new AdbError('adb: closed', 'shell', 'adb: closed')
    }
    const service = new PowerService(client as unknown as AdbClient)

    const result = await service.runPower('reboot')

    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/puede desconectarse/i)
  })

  it('trata un timeout del transporte como solicitud enviada', async () => {
    const client = new FakePowerClient()
    client.shell = async (): Promise<CommandResult> => {
      throw new AdbError('El comando ADB excedio el tiempo limite.', 'timeout')
    }
    const service = new PowerService(client as unknown as AdbClient)

    const result = await service.runPower('shutdown')

    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/puede desconectarse/i)
  })

  it('reinicia SystemUI solo cuando cambia el PID', async () => {
    const { client, service } = setup()
    client.pidResponses = ['100', '200']

    const result = await service.runPower('restart-system-ui')

    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/Interfaz reiniciada/)
    expect(client.calls).toContain('am crash com.android.systemui')
  })

  it('falla si SystemUI conserva el mismo PID', async () => {
    const { client, service } = setup()
    client.pidResponses = ['100', '100']

    const result = await service.runPower('restart-system-ui')

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/mismo PID/)
  })

  it('falla si am crash reporta un error', async () => {
    const { client, service } = setup()
    client.crashOutput = 'error: activity not found'

    const result = await service.runPower('restart-system-ui')

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/activity not found/)
  })
})
