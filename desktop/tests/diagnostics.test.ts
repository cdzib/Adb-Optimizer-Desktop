import { describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/adb-client'
import type { CommandResult, CommandRunner, RunOptions } from '../src/main/adb/runner'
import {
  parseBatteryDiagnostics,
  parseCpuFrequencies,
  parseNetworkInterfaces,
  parseScreenInfo,
  parseSensors,
  parseVulkanVersion,
} from '../src/main/diagnostics/diagnostics-parser'
import { DiagnosticsService } from '../src/main/diagnostics/diagnostics-service'

const BATTERY_FIXTURE = [
  'Current Battery Service state:',
  '  AC powered: false',
  '  USB powered: true',
  '  status: 3',
  '  health: 2',
  '  present: true',
  '  level: 85',
  '  scale: 100',
  '  voltage: 4200',
  '  temperature: 310',
  '  technology: Li-ion',
  '  charge counter: 3200000',
  '  current now: -450000',
].join('\n')

const CPU_FIXTURE = [
  '2||300000|2000000',
  '0|1800000|300000|2000000',
  '1|not-a-number|300000|2000000',
  '0|999999|0|0',
].join('\n')

const SCREEN_FIXTURE = [
  'Physical size: 1080x2160',
  'Override size: 720x1440',
  'Physical density: 440',
  'Override density: 280',
  'DisplayDeviceInfo{"Built-in Screen": uniqueId="local:1", 720 x 1440, renderFrameRate 60.000004, refreshRate 60.000004}',
].join('\n')

const SENSORS_FIXTURE = [
  'Sensor List:',
  '0x00000000) Accelerometer | Bosch | ver: 1 | type: android.sensor.accelerometer(1) | maxRate=200.0',
  '0x00000001) Gyroscope | STMicroelectronics | ver: 2 | type: android.sensor.gyroscope(4)',
  '0x00000002) Accelerometer | Bosch | ver: 1 | type: android.sensor.accelerometer(1)',
  'Sensor Device:',
  'total 2 h/w sensors, 2 running',
].join('\n')

const NETWORK_FIXTURE = [
  '1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever',
  '2: eth0    inet 192.168.1.5/24 brd 192.168.1.255 scope global eth0',
  '3: wlan0    inet6 fe80::1/64 scope link',
  '4: dummy0    inet 10.0.0.1/32 scope global dummy0',
].join('\n')

const SURFACE_FIXTURE = [
  'GLES: Qualcomm, Adreno (TM) 610, OpenGL ES 3.2 V@1.0',
  'Vulkan: Qualcomm, Adreno (TM) 610, Vulkan 1.1.66',
].join('\n')

const PROPS_FIXTURE = [
  '[ro.product.brand]: [Google]',
  '[ro.product.product]: [sargo]',
  '[ro.product.name]: [sargo]',
  '[ro.product.board]: [sargo]',
  '[ro.product.hardware]: [sargo]',
  '[ro.product.cpu.abilist]: [arm64-v8a,armeabi-v7a]',
  '[ro.build.version.security_patch]: [2024-08-05]',
  '[ro.build.display.id]: [AP2A.240905.003]',
  '[ro.dalvik.vm.native.bridge]: [0]',
  '[gsm.version.baseband]: [g670-00015]',
].join('\n')

const KERNEL_FIXTURE = '5.10.198-android12-9-g1234'
const FEATURES_FIXTURE = [
  'feature:android.hardware.usb.host',
  'feature:android.hardware.vulkan.version=4198400',
  'feature:android.hardware.wifi',
].join('\n')

const SCREEN_COMMAND = "wm size; wm density; dumpsys display | grep -m 1 'DisplayDeviceInfo{'"
const SENSORS_COMMAND = "dumpsys sensorservice | sed -n '/Sensor List:/,$p'"

function optionalStdout(command: string): string {
  switch (command) {
    case 'getprop':
      return PROPS_FIXTURE
    case 'uname -r':
      return KERNEL_FIXTURE
    case 'pm list features':
      return FEATURES_FIXTURE
    case SCREEN_COMMAND:
      return SCREEN_FIXTURE
    case SENSORS_COMMAND:
      return SENSORS_FIXTURE
    case 'ip -o addr show up':
      return NETWORK_FIXTURE
    case 'dumpsys battery':
      return BATTERY_FIXTURE
    case 'dumpsys SurfaceFlinger':
      return SURFACE_FIXTURE
    default:
      return command.startsWith('for d in /sys/devices/system/cpu/')
        ? CPU_FIXTURE
        : ''
  }
}

class DiagnosticsRunner implements CommandRunner {
  readonly calls: string[] = []

  constructor(private readonly failing: Set<string> = new Set()) {}

  async run(_bin: string, args: string[], _options?: RunOptions): Promise<CommandResult> {
    const command = args[args.length - 1] ?? ''
    this.calls.push(command)
    if (this.failing.has(command)) {
      return { code: 1, stdout: 'error: forced failure', stderr: '', durationMs: 1, timedOut: false }
    }
    return { code: 0, stdout: optionalStdout(command), stderr: '', durationMs: 1, timedOut: false }
  }
}

function clientFor(runner: CommandRunner): AdbClient {
  return new AdbClient({ adbPath: 'adb', runner, serial: 'emulator-5554' })
}

describe('parseBatteryDiagnostics', () => {
  it('traduce nivel, salud, estado y magnitudes de la bateria', () => {
    const battery = parseBatteryDiagnostics(BATTERY_FIXTURE)

    expect(battery).toEqual({
      level: 85,
      health: 'Good',
      status: 'Discharging',
      voltageV: 4.2,
      temperatureC: 31,
      technology: 'Li-ion',
      chargeCounterUah: 3_200_000,
      currentMa: -450,
    })
  })

  it('mantiene la temperatura de bateria separada y convierte centinelas en null', () => {
    const battery = parseBatteryDiagnostics(
      ['  level: -1', '  scale: 100', '  voltage: 0', '  temperature: -1', '  current now: -1', '  charge counter: -1'].join(
        '\n',
      ),
    )

    expect(battery.level).toBeNull()
    expect(battery.temperatureC).toBeNull()
    expect(battery.voltageV).toBeNull()
    expect(battery.currentMa).toBeNull()
    expect(battery.chargeCounterUah).toBeNull()
  })

  it('devuelve todo null cuando la bateria no esta presente', () => {
    const battery = parseBatteryDiagnostics('  present: false\n  level: 50\n  temperature: 250')

    expect(battery.level).toBeNull()
    expect(battery.temperatureC).toBeNull()
    expect(battery.technology).toBeNull()
  })
})

describe('parseCpuFrequencies', () => {
  it('ordena por indice, descarta duplicados y convierte kHz a MHz', () => {
    const cores = parseCpuFrequencies(CPU_FIXTURE)

    expect(cores).toEqual([
      { index: 0, currentMhz: 1800, minMhz: 300, maxMhz: 2000 },
      { index: 1, currentMhz: null, minMhz: 300, maxMhz: 2000 },
      { index: 2, currentMhz: null, minMhz: 300, maxMhz: 2000 },
    ])
  })

  it('devuelve lista vacia sin lecturas', () => {
    expect(parseCpuFrequencies('')).toEqual([])
  })
})

describe('parseScreenInfo', () => {
  it('prioriza override de tamano y densidad y lee la tasa de refresco', () => {
    expect(parseScreenInfo(SCREEN_FIXTURE)).toEqual({
      width: 720,
      height: 1440,
      densityDpi: 280,
      refreshRateHz: 60,
    })
  })

  it('usa solo la resolucion fisica cuando no hay override', () => {
    const screen = parseScreenInfo('Physical size: 1080x1920\nPhysical density: 320')

    expect(screen).toEqual({
      width: 1080,
      height: 1920,
      densityDpi: 320,
      refreshRateHz: null,
    })
  })

  it('recurre a DisplayDeviceInfo si wm no responde', () => {
    const screen = parseScreenInfo('DisplayDeviceInfo{... 1440 x 3120, refreshRate 120.0}')

    expect(screen.width).toBe(1440)
    expect(screen.height).toBe(3120)
    expect(screen.densityDpi).toBeNull()
    expect(screen.refreshRateHz).toBe(120)
  })
})

describe('parseSensors', () => {
  it('lee nombre, vendor y tipo y descarta cabeceras y duplicados', () => {
    const sensors = parseSensors(SENSORS_FIXTURE)

    expect(sensors).toEqual([
      { name: 'Accelerometer', vendor: 'Bosch', type: 'android.sensor.accelerometer' },
      { name: 'Gyroscope', vendor: 'STMicroelectronics', type: 'android.sensor.gyroscope' },
    ])
  })

  it('devuelve lista vacia sin sensores', () => {
    expect(parseSensors('Sensor List:\nSensor Device:')).toEqual([])
  })
})

describe('parseNetworkInterfaces', () => {
  it('incluye loopback y separa direccion y prefijo', () => {
    const interfaces = parseNetworkInterfaces(NETWORK_FIXTURE)

    expect(interfaces).toEqual([
      { name: 'lo', address: '127.0.0.1', prefix: 8 },
      { name: 'eth0', address: '192.168.1.5', prefix: 24 },
      { name: 'wlan0', address: 'fe80::1', prefix: 64 },
      { name: 'dummy0', address: '10.0.0.1', prefix: 32 },
    ])
  })

  it('ignora lineas que no son direcciones', () => {
    expect(parseNetworkInterfaces('2: eth0    inet 10.0.0.2/16 scope global eth0')).toHaveLength(1)
    expect(parseNetworkInterfaces('')).toEqual([])
  })
})

describe('parseVulkanVersion', () => {
  it('extrae la version legible del volcado de SurfaceFlinger', () => {
    expect(parseVulkanVersion(SURFACE_FIXTURE)).toBe('1.1.66')
  })

  it('decodifica el entero con la mascara de 12 bits de patch', () => {
    expect(parseVulkanVersion('vulkan version 4198400')).toBe('1.1.0')
  })

  it('devuelve null sin datos', () => {
    expect(parseVulkanVersion(null)).toBeNull()
    expect(parseVulkanVersion('')).toBeNull()
    expect(parseVulkanVersion('GLES: Adreno 610')).toBeNull()
  })
})

describe('DiagnosticsService', () => {
  it('compone el diagnostico completo del dispositivo', async () => {
    const runner = new DiagnosticsRunner()
    const diagnostics = await new DiagnosticsService(clientFor(runner)).read()

    expect(diagnostics.hardware).toEqual({
      brand: 'Google',
      product: 'sargo',
      board: 'sargo',
      hardware: 'sargo',
      abis: 'arm64-v8a,armeabi-v7a',
      usbHost: true,
    })
    expect(diagnostics.system).toEqual({
      patch: '2024-08-05',
      build: 'AP2A.240905.003',
      kernel: KERNEL_FIXTURE,
      vm: '0',
      baseband: 'g670-00015',
    })
    expect(diagnostics.gles).toContain('Adreno')
    expect(diagnostics.vulkan).toBe('1.1.66')
    expect(diagnostics.battery.level).toBe(85)
    expect(diagnostics.battery.temperatureC).toBe(31)
    expect(diagnostics.cpuCores).toHaveLength(3)
    expect(diagnostics.screen).toEqual({ width: 720, height: 1440, densityDpi: 280, refreshRateHz: 60 })
    expect(diagnostics.sensors).toHaveLength(2)
    expect(diagnostics.network.map((item) => item.name)).toEqual(['lo', 'eth0', 'wlan0', 'dummy0'])

    expect(runner.calls.filter((command) => command === 'getprop')).toHaveLength(1)
  })

  it('una lectura opcional fallida no elimina las demas', async () => {
    const runner = new DiagnosticsRunner(new Set(['dumpsys battery']))
    const diagnostics = await new DiagnosticsService(clientFor(runner)).read()

    expect(diagnostics.hardware.brand).toBe('Google')
    expect(diagnostics.screen.width).toBe(720)
    expect(diagnostics.sensors).toHaveLength(2)
    expect(diagnostics.cpuCores).toHaveLength(3)
    expect(diagnostics.battery).toEqual({
      level: null,
      health: null,
      status: null,
      voltageV: null,
      temperatureC: null,
      technology: null,
      chargeCounterUah: null,
      currentMa: null,
    })
  })

  it('propaga el fallo de getprop porque sin dispositivo no hay diagnostico', async () => {
    const runner = new DiagnosticsRunner(new Set(['getprop']))

    await expect(new DiagnosticsService(clientFor(runner)).read()).rejects.toThrow()
  })
})
