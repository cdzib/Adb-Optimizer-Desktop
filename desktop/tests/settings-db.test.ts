import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/adb-client'
import type { CommandResult, CommandRunner } from '../src/main/adb/runner'
import { SettingsHistory } from '../src/main/settings/settings-history'
import {
  parseSettingsList,
  readBackMatches,
} from '../src/main/settings/settings-parser'
import { SettingsService } from '../src/main/settings/settings-service'
import type { SettingsChange, SettingsNamespace } from '../src/shared/types'

function ok(stdout = ''): CommandResult {
  return { code: 0, stdout, stderr: '', durationMs: 1, timedOut: false }
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/'\\''/g, "'")
  }
  return value
}

/** Transporte ADB local: emula `settings` y `cmd uimode night` sin dispositivo. */
class SettingsRunner implements CommandRunner {
  readonly values = new Map<string, string>()
  readonly commands: string[] = []
  /** Si es true el `put` responde OK pero el valor no cambia (clave protegida). */
  stale = false

  async run(_bin: string, args: string[]): Promise<CommandResult> {
    const command = args[args.length - 1] ?? ''
    this.commands.push(command)

    if (command.startsWith('cmd uimode night ')) {
      const mode = command.split(/\s+/).pop() ?? ''
      if (!this.stale) this.values.set('uimode:night', `Night mode: ${mode}`)
      return ok()
    }
    if (command === 'cmd uimode night') {
      return ok(this.values.get('uimode:night') ?? 'Night mode: no')
    }

    const get = /^settings get (\w+) ([\w.]+)$/.exec(command)
    if (get) {
      return ok(this.values.get(`${get[1]}:${get[2]}`) ?? 'null')
    }

    const put = /^settings put (\w+) ([\w.]+) (.*)$/.exec(command)
    if (put) {
      if (!this.stale) this.values.set(`${put[1]}:${put[2]}`, unquote(put[3] ?? ''))
      return ok()
    }

    const list = /^settings list (\w+)$/.exec(command)
    if (list) {
      const prefix = `${list[1]}:`
      const lines = [...this.values.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => `${key.slice(prefix.length)}=${value}`)
      return ok(lines.join('\n'))
    }

    return ok()
  }
}

function makeService(runner: SettingsRunner, dataDir: string): SettingsService {
  const client = new AdbClient({ adbPath: '/usr/bin/adb', serial: 'emulator-5554', runner })
  return new SettingsService(client, dataDir)
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'adbopt-settings-'))
}

describe('parseSettingsList y readBackMatches', () => {
  it('parsea clave=valor y descarta lineas sin clave', () => {
    expect(parseSettingsList('a=1\n\n=roto\nsin-separador\nb=2=3\n  c=hola \n')).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2=3' },
      { key: 'c', value: 'hola' },
    ])
  })

  it('trata `null` como cadena vacia al confirmar el read-back', () => {
    expect(readBackMatches('null', '')).toBe(true)
    expect(readBackMatches('  null \n', '')).toBe(true)
    expect(readBackMatches('30000', '30000')).toBe(true)
    expect(readBackMatches('30000', '15000')).toBe(false)
  })
})

describe('SettingsService', () => {
  let runner: SettingsRunner
  let dataDir: string

  beforeEach(() => {
    runner = new SettingsRunner()
    dataDir = tempDir()
  })

  it('lee una tabla y separa claves por namespace', async () => {
    runner.values.set('global:low_power', '1')
    runner.values.set('system:screen_brightness', '64')
    const service = makeService(runner, dataDir)

    expect(await service.list('global')).toEqual([{ key: 'low_power', value: '1' }])
    expect(await service.list('system')).toEqual([
      { key: 'screen_brightness', value: '64' },
    ])
  })

  it('escribe y confirma por read-back registrando el cambio', async () => {
    runner.values.set('system:screen_off_timeout', '15000')
    const service = makeService(runner, dataDir)

    const result = await service.save('system', 'screen_off_timeout', '30000')

    expect(result).toEqual({ ok: true, value: '30000' })
    expect(runner.values.get('system:screen_off_timeout')).toBe('30000')

    const history = service.history()
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      namespace: 'system',
      key: 'screen_off_timeout',
      previousValue: '15000',
      newValue: '30000',
    })
  })

  it('devuelve ok=false cuando Android acepta el put pero no conserva el valor', async () => {
    runner.values.set('secure:install_non_market_apps', '0')
    runner.stale = true
    const service = makeService(runner, dataDir)

    const result = await service.save('secure', 'install_non_market_apps', '1')

    expect(result).toEqual({ ok: false, value: '1' })
    expect(service.history()).toEqual([])
  })

  it('deshace un cambio restaurando el valor previo y sin registrar uno nuevo', async () => {
    runner.values.set('global:low_power', '0')
    const service = makeService(runner, dataDir)

    expect(await service.save('global', 'low_power', '1')).toEqual({ ok: true, value: '1' })
    const change = service.history()[0]
    expect(change).toBeDefined()

    const undone = await service.undo(change!.id)

    expect(undone).toEqual({ ok: true, value: '0' })
    expect(runner.values.get('global:low_power')).toBe('0')
    expect(service.history()).toEqual([])
  })

  it('mantiene la entrada del historial si el undo no se confirma', async () => {
    runner.values.set('global:low_power', '0')
    const service = makeService(runner, dataDir)
    await service.save('global', 'low_power', '1')

    runner.stale = true
    const undone = await service.undo(service.history()[0]!.id)

    expect(undone.ok).toBe(false)
    expect(service.history()).toHaveLength(1)
  })

  it('persiste el historial en dataDir entre instancias', async () => {
    runner.values.set('system:screen_brightness', '10')
    const first = makeService(runner, dataDir)
    await first.save('system', 'screen_brightness', '80')

    const file = join(dataDir, 'settings-history.json')
    expect(existsSync(file)).toBe(true)

    const second = makeService(runner, dataDir)
    expect(second.history()).toHaveLength(1)
    expect(second.history()[0]?.newValue).toBe('80')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1)
  })

  it('rechaza namespaces, claves y valores invalidos', async () => {
    const service = makeService(runner, dataDir)

    await expect(service.list('media' as SettingsNamespace)).rejects.toThrow()
    await expect(service.save('global', 'clave con espacio', '1')).rejects.toThrow()
    await expect(service.save('global', 'ok', 'a\nb')).rejects.toThrow()
    await expect(service.save('global', 'ok', 'x'.repeat(513))).rejects.toThrow()
    await expect(service.save('ajustes' as SettingsNamespace, 'ok', '1')).rejects.toThrow()
  })

  it('lee los ajustes rapidos tolerando lecturas que fallan', async () => {
    runner.values.set('uimode:night', 'Night mode: yes')
    runner.values.set('system:screen_off_timeout', '120000')
    runner.values.set('system:screen_brightness', '64')
    runner.values.set('global:low_power', '1')
    const service = makeService(runner, dataDir)

    expect(await service.quick()).toEqual({
      nightMode: 'yes',
      screenOffTimeoutMs: 120000,
      brightness: 64,
      batterySaver: true,
    })
  })

  it('aplica el modo noche y confirma que el dispositivo lo reporta', async () => {
    const service = makeService(runner, dataDir)

    expect(await service.setNightMode('yes')).toEqual({ ok: true, value: 'yes' })
    expect(runner.values.get('uimode:night')).toBe('Night mode: yes')

    runner.stale = true
    expect((await service.setNightMode('no')).ok).toBe(false)
    await expect(service.setNightMode('quizas' as 'yes')).rejects.toThrow()
  })
})

describe('SettingsHistory', () => {
  it('conserva como maximo 100 entradas y la mas reciente primero', () => {
    const file = join(tempDir(), 'settings-history.json')
    const history = new SettingsHistory(file)

    for (let index = 0; index < 105; index += 1) {
      const change: SettingsChange = {
        id: `id-${index}`,
        namespace: 'global',
        key: 'clave',
        previousValue: String(index),
        newValue: String(index + 1),
        appliedAt: new Date(index).toISOString(),
      }
      history.append(change)
    }

    const entries = history.list()
    expect(entries).toHaveLength(100)
    expect(entries[0]?.id).toBe('id-104')
  })
})
