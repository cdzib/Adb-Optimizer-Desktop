import { describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/adb-client'
import type { CommandResult, CommandRunner, RunOptions } from '../src/main/adb/runner'

const DEVICES = [
  'List of devices attached',
  'R58M1234ABC          device product:o1s model:SM_G991B device:o1s transport_id:1',
  '192.168.1.40:5555    device product:atv model:Chromecast_HD device:sabrina transport_id:2',
  '192.168.1.41:5555    unauthorized',
  '',
].join('\n')

const PROPS = [
  '[ro.product.model]: [SM_G991B]',
  '[ro.product.manufacturer]: [samsung]',
  '[ro.build.version.sdk]: [34]',
  '[ro.build.version.release]: [14]',
  '[ro.product.cpu.abi]: [arm64-v8a]',
].join('\n')

class ScriptedRunner implements CommandRunner {
  readonly calls: string[][] = []
  tcpipMessage = 'restarting in TCP mode port: 5555'

  async run(_bin: string, args: string[], _options?: RunOptions): Promise<CommandResult> {
    this.calls.push(args)
    return { code: 0, stdout: this.respond(args), stderr: '', durationMs: 1, timedOut: false }
  }

  private respond(args: string[]): string {
    if (args[0] === 'devices') return DEVICES
    if (args[0] === 'connect') return `connected to ${args[1]}`
    if (args[0] === 'pair') return `Successfully paired to ${args[1]}`
    if (args.includes('tcpip')) return this.tcpipMessage

    const command = args[args.length - 1] ?? ''
    if (command === 'getprop') return PROPS
    if (command.includes('which su')) return 'no-su'
    if (command.includes('ip -f inet')) return '    inet 192.168.1.40/24 brd 192.168.1.255 scope global wlan0'
    return ''
  }

  used(command: string): boolean {
    return this.calls.some((args) => args[0] === command)
  }
}

function client(runner: CommandRunner): AdbClient {
  return new AdbClient({ adbPath: 'adb', runner })
}

describe('seleccion de transporte', () => {  it('pasa el codigo QR como argumento de adb pair, no por stdin', async () => {
    const runner = new ScriptedRunner()

    const result = await client(runner).pair('192.168.1.40:41021', 'ABC23456')

    expect(result.ok).toBe(true)
    expect(runner.calls).toContainEqual(['pair', '192.168.1.40:41021', 'ABC23456'])
  })

  it('rechaza direcciones de pair/connect con opciones o inyeccion', async () => {
    const runner = new ScriptedRunner()
    const adb = client(runner)

    await expect(adb.pair('-l', '123456')).rejects.toThrow(/no es valida/)
    await expect(adb.pair('192.168.1.40:5555; reboot', '123456')).rejects.toThrow(/caracteres/)
    await expect(adb.connect('192.168.1.40:5555 && reboot')).rejects.toThrow(/caracteres/)
    expect(runner.calls).toHaveLength(0)
  })

  it('USB: asocia el serial y no ejecuta adb connect', async () => {
    const runner = new ScriptedRunner()
    const info = await client(runner).connectDevice('R58M1234ABC')

    expect(info.model).toBe('SM_G991B')
    expect(runner.used('connect')).toBe(false)
    expect(runner.calls.some((args) => args.includes('R58M1234ABC'))).toBe(true)
  })

  it('Wi-Fi: si ejecuta adb connect antes de leer el dispositivo', async () => {
    const runner = new ScriptedRunner()
    const info = await client(runner).connectDevice('192.168.1.40:5555')

    expect(info.model).toBe('SM_G991B')
    expect(runner.calls[1]).toEqual(['connect', '192.168.1.40:5555'])
  })

  it('rechaza dispositivos inexistentes o no autorizados', async () => {
    await expect(client(new ScriptedRunner()).connectDevice('10.0.0.99:5555')).rejects.toThrow(
      /No se encontro/,
    )
    await expect(client(new ScriptedRunner()).connectDevice('192.168.1.41:5555')).rejects.toThrow(
      /Authorize debugging/i,
    )
  })

  it('permite una IP manual que aun no estaba en adb devices', async () => {
    const runner = new ScriptedRunner()
    const adb = client(runner)

    // Tras `adb connect`, el dispositivo aparece en la lista.
    const original = runner.run.bind(runner)
    let connected = false
    runner.run = async (bin, args, options) => {
      if (args[0] === 'connect') connected = true
      if (args[0] === 'devices' && connected) {
        runner.calls.push(args)
        return {
          code: 0,
          stdout: `${DEVICES}192.168.1.50:5555    device product:atv model:MiBox device:mibox transport_id:3\n`,
          stderr: '',
          durationMs: 1,
          timedOut: false,
        }
      }
      return original(bin, args, options)
    }

    const info = await adb.connectDevice('192.168.1.50:5555')
    expect(info.model).toBe('SM_G991B')
    expect(runner.calls.filter((args) => args[0] === 'connect')).toHaveLength(1)
  })

  it('activar modo Wi-Fi usa tcpip y devuelve la IP del dispositivo', async () => {
    const runner = new ScriptedRunner()
    const adb = client(runner)
    await adb.connectDevice('R58M1234ABC')

    const result = await adb.enableWireless(5555)
    expect(result.ok).toBe(true)
    expect(result.address).toBe('192.168.1.40:5555')
    expect(runner.calls.some((args) => args.includes('tcpip'))).toBe(true)
  })
})

describe('lectura de informacion del dispositivo', () => {
  class ParallelRunner extends ScriptedRunner {
    active = 0
    maxActive = 0

    override async run(bin: string, args: string[], options?: RunOptions): Promise<CommandResult> {
      const isInfo = args.some((arg) => arg === 'getprop' || arg.includes('which su'))
      if (isInfo) {
        this.active += 1
        this.maxActive = Math.max(this.maxActive, this.active)
      }
      try {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return await super.run(bin, args, options)
      } finally {
        if (isInfo) this.active -= 1
      }
    }
  }

  it('lanza getprop y la sonda de root en paralelo', async () => {
    const runner = new ParallelRunner()
    const info = await client(runner).connectDevice('R58M1234ABC')

    expect(info.model).toBe('SM_G991B')
    expect(runner.maxActive).toBe(2)
  })

  it('devuelve el dispositivo aunque la sonda de root falle', async () => {
    const runner = new ScriptedRunner()
    const original = runner.run.bind(runner)
    runner.run = async (bin, args, options) => {
      if (args.some((arg) => arg.includes('which su'))) {
        throw new Error('adbd no responde')
      }
      return original(bin, args, options)
    }

    const info = await client(runner).connectDevice('R58M1234ABC')
    expect(info.model).toBe('SM_G991B')
    expect(info.hasRoot).toBe(false)
  })
})
