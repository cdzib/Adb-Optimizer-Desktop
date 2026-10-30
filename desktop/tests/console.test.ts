import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/adb-client'
import type { CommandResult, CommandRunner, RunOptions } from '../src/main/adb/runner'
import { ConsoleService } from '../src/main/console/console-service'

class LocalRunner implements CommandRunner {
  readonly calls: string[] = []

  constructor(
    private readonly handler: (command: string) => Partial<CommandResult> = () => ({}),
  ) {}

  async run(_bin: string, args: string[], _options?: RunOptions): Promise<CommandResult> {
    const command = args[args.length - 1] ?? ''
    this.calls.push(command)
    const result = this.handler(command)
    return {
      code: result.code ?? 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      durationMs: result.durationMs ?? 7,
      timedOut: result.timedOut ?? false,
    }
  }
}

function clientFor(runner: CommandRunner): AdbClient {
  return new AdbClient({ adbPath: 'adb', runner, serial: 'x' })
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'adbopt-console-'))
}

describe('ConsoleService', () => {
  it('devuelve la salida del comando y registra el historial', async () => {
    const runner = new LocalRunner((command) => ({
      stdout: `salida de ${command}\n`,
      durationMs: 12,
    }))
    const service = new ConsoleService(clientFor(runner), tempDir())

    const result = await service.run('getprop ro.product.model')

    expect(result.command).toBe('getprop ro.product.model')
    expect(result.stdout).toBe('salida de getprop ro.product.model\n')
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.durationMs).toBe(12)
    expect(result.timedOut).toBe(false)
    expect(service.history()).toEqual(['getprop ro.product.model'])
  })

  it('convierte el error: del dispositivo en resultado visible, sin lanzar', async () => {
    const runner = new LocalRunner(() => ({ stdout: 'error: closed\n', code: 0 }))
    const service = new ConsoleService(clientFor(runner), tempDir())

    const result = await service.run('pm list packages')

    expect(result.exitCode).toBe(-1)
    expect(result.stderr).toContain('error: closed')
    expect(result.timedOut).toBe(false)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('rechaza un comando vacio sin invocar al dispositivo', async () => {
    const runner = new LocalRunner()
    const service = new ConsoleService(clientFor(runner), tempDir())

    const result = await service.run('   ')

    expect(result.exitCode).toBe(-1)
    expect(result.stderr.length).toBeGreaterThan(0)
    expect(runner.calls).toHaveLength(0)
    expect(service.history()).toEqual([])
  })

  it('rechaza comandos de mas de 4000 caracteres', async () => {
    const runner = new LocalRunner()
    const service = new ConsoleService(clientFor(runner), tempDir())

    const result = await service.run('a'.repeat(4001))

    expect(result.exitCode).toBe(-1)
    expect(result.stderr).toContain('4000')
    expect(runner.calls).toHaveLength(0)
  })

  it('persiste el historial, sin duplicados y truncado a 40 entradas', async () => {
    const dataDir = tempDir()
    const runner = new LocalRunner()
    const service = new ConsoleService(clientFor(runner), dataDir)

    for (let index = 1; index <= 45; index += 1) {
      await service.run(`echo ${index}`)
    }
    await service.run('echo 45')

    const history = service.history()
    expect(history).toHaveLength(40)
    expect(history[0]).toBe('echo 45')
    expect(history.filter((item) => item === 'echo 45')).toHaveLength(1)
    expect(history[39]).toBe('echo 6')

    const serialized = JSON.parse(
      readFileSync(join(dataDir, 'console-history.json'), 'utf8'),
    ) as string[]
    expect(serialized).toHaveLength(40)

    const reloaded = new ConsoleService(clientFor(runner), dataDir)
    expect(reloaded.history()).toEqual(history)
  })

  it('trata un documento corrupto como historial vacio', () => {
    const dataDir = tempDir()
    writeFileSync(join(dataDir, 'console-history.json'), '{esto no es json', 'utf8')

    const service = new ConsoleService(clientFor(new LocalRunner()), dataDir)

    expect(service.history()).toEqual([])
  })

  it('limpia el historial en memoria y en disco', async () => {
    const dataDir = tempDir()
    const service = new ConsoleService(clientFor(new LocalRunner()), dataDir)
    await service.run('echo hola')

    service.clear()

    expect(service.history()).toEqual([])
    expect(JSON.parse(readFileSync(join(dataDir, 'console-history.json'), 'utf8'))).toEqual([])
  })
})
