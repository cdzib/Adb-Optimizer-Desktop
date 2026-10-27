import type { CommandRunner, CommandResult } from '../adb/runner'

export interface FastbootDevice {
  serial: string
  state: string
}

export interface FastbootFlashOptions {
  serial: string
  partition: string
  imagePath: string
  slot?: 'a' | 'b' | 'all'
  disableVerity?: boolean
}

export function parseFastbootDevices(stdout: string): FastbootDevice[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('*'))
    .map((line) => {
      const [serial, state] = line.split(/\s+/)
      return { serial: serial ?? '', state: state ?? '' }
    })
    .filter((device) => device.serial.length > 0)
}

/**
 * Cliente `fastboot` mínimo para flashear particiones. Se ejecuta en el host,
 * nunca a través de `adb shell` (necesita el bootloader en modo fastboot).
 */
export class FastbootClient {
  constructor(
    private readonly fastbootPath: string,
    private readonly runner: CommandRunner,
  ) {}

  private async run(args: string[], timeoutMs = 120_000): Promise<CommandResult> {
    return this.runner.run(this.fastbootPath, args, { timeoutMs })
  }

  async version(): Promise<string> {
    const result = await this.run(['--version'], 10_000).catch(() => null)
    if (!result || result.code !== 0) throw new Error('fastboot no está disponible en este equipo.')
    return `${result.stdout}${result.stderr}`.trim()
  }

  async devices(): Promise<FastbootDevice[]> {
    const result = await this.run(['devices'], 15_000)
    return parseFastbootDevices(result.stdout)
  }

  /** Espera a que el dispositivo aparezca en fastboot tras `reboot bootloader`. */
  async waitForDevice(preferredSerial: string | null, timeoutMs = 90_000): Promise<string> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const devices = await this.devices().catch(() => [] as FastbootDevice[])
      if (devices.length > 0) {
        const match = preferredSerial
          ? devices.find((device) => device.serial === preferredSerial)
          : undefined
        if (match) return match.serial
        if (!preferredSerial && devices.length === 1) return devices[0]!.serial
        if (preferredSerial && devices.length === 1) return devices[0]!.serial
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500))
    }
    throw new Error('El dispositivo no apareció en modo fastboot. Revisa el cable USB y el modo bootloader.')
  }

  async flash(options: FastbootFlashOptions): Promise<string> {
    const partition = options.partition
    const args = ['-s', options.serial]
    if (options.disableVerity && partition.startsWith('vbmeta')) {
      args.push('--disable-verity', '--disable-verification')
    }
    if (options.slot === 'all') {
      args.push('--slot', 'all', 'flash', partition, options.imagePath)
    } else if (options.slot && !/_[ab]$/.test(partition)) {
      args.push('flash', `${partition}_${options.slot}`, options.imagePath)
    } else {
      args.push('flash', partition, options.imagePath)
    }

    const result = await this.run(args, 300_000)
    const output = `${result.stdout}${result.stderr}`.trim()
    if (result.code !== 0 || /FAILED|error|cannot|not allowed/i.test(output)) {
      throw new Error(output || `fastboot rechazó el flasheo de ${partition}.`)
    }
    return output || `fastboot flash ${partition}: OK`
  }

  async reboot(serial: string): Promise<void> {
    const result = await this.run(['-s', serial, 'reboot'], 30_000)
    const output = `${result.stdout}${result.stderr}`.trim()
    if (result.code !== 0 || /FAILED|error/i.test(output)) {
      throw new Error(output || 'fastboot no pudo reiniciar el dispositivo.')
    }
  }
}
