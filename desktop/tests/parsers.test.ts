import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/adb-client'
import type { CommandRunner } from '../src/main/adb/runner'
import {
  buildMetrics,
  detectTransport,
  parseBatteryPercent,
  parseHomeLaunchers,
  parseCpuinfo,
  parseDevices,
  parseGetprop,
  parseMdns,
  parseMeminfo,
  parseStorage,
  parseThermal,
} from '../src/main/adb/adb-client'
import { findSharedDir } from './fake-runner'

interface ConformanceCase {
  id: string
  command: string
  stdout: string
  expected: unknown
}

const casesDir = join(findSharedDir(), 'conformance', 'cases')
const cases: ConformanceCase[] = readdirSync(casesDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join(casesDir, file), 'utf8')) as ConformanceCase)

function parseByCommand(command: string, stdout: string): unknown {
  if (command.startsWith('dumpsys meminfo')) return parseMeminfo(stdout)
  if (command.startsWith('dumpsys cpuinfo')) return parseCpuinfo(stdout)
  if (command.startsWith('df ')) return parseStorage(stdout)
  if (command.startsWith('dumpsys thermalservice')) return parseThermal(stdout)
  throw new Error(`Caso de conformidad sin parser: ${command}`)
}

describe('conformance suite', () => {
  it('encuentra los casos compartidos', () => {
    expect(cases.length).toBeGreaterThanOrEqual(4)
  })

  for (const testCase of cases) {
    it(`parsea ${testCase.id}`, () => {
      expect(parseByCommand(testCase.command, testCase.stdout)).toEqual(testCase.expected)
    })
  }
})

describe('manejo de errores de ADB', () => {
  it('no falla por SecurityException en stderr si el comando devolvio datos', async () => {
    const runner: CommandRunner = {
      run: async () => ({
        code: 0,
        stdout: 'package:com.whatsapp\n',
        stderr:
          'Error: java.lang.SecurityException: Shell does not have permission to access user 150\n com.android.server.am.ActivityManagerService',
        durationMs: 1,
        timedOut: false,
      }),
    }
    const adb = new AdbClient({ adbPath: 'adb', runner, serial: '192.168.1.121:45103' })

    await expect(adb.shellText('pm list packages -3')).resolves.toBe('package:com.whatsapp')
  })

  it('si falla cuando el propio comando imprime error: en stdout', async () => {
    const runner: CommandRunner = {
      run: async () => ({
        code: 0,
        stdout: 'error: no such package',
        stderr: '',
        durationMs: 1,
        timedOut: false,
      }),
    }
    const adb = new AdbClient({ adbPath: 'adb', runner, serial: 'x' })

    await expect(adb.shell('pm uninstall nada')).rejects.toThrow(/no such package/)
  })

  it('detecta errores de transporte en stderr', async () => {
    const runner: CommandRunner = {
      run: async () => ({
        code: 0,
        stdout: '',
        stderr: 'error: device offline',
        durationMs: 1,
        timedOut: false,
      }),
    }
    const adb = new AdbClient({ adbPath: 'adb', runner, serial: 'x' })

    await expect(adb.shell('getprop')).rejects.toThrow(/offline/i)
  })
})

describe('parsers de ADB', () => {
  it('parsea adb devices -l', () => {
    const stdout = [
      'List of devices attached',
      '192.168.1.40:5555    device product:atv model:Chromecast_HD device:sabrina transport_id:2',
      'emulator-5554        offline',
      '',
    ].join('\n')

    expect(parseDevices(stdout)).toEqual([
      {
        id: '192.168.1.40:5555',
        address: '192.168.1.40:5555',
        state: 'device',
        transport: 'network',
        model: 'Chromecast_HD',
      },
      {
        id: 'emulator-5554',
        address: 'emulator-5554',
        state: 'offline',
        transport: 'emulator',
        model: undefined,
      },
    ])
  })

  it('distingue USB, red y emulador', () => {
    expect(detectTransport('R58M1234ABC')).toBe('usb')
    expect(detectTransport('0123456789ABCDEF')).toBe('usb')
    expect(detectTransport('192.168.1.40:5555')).toBe('network')
    expect(detectTransport('adb-1234ABCD._adb-tls-connect._tcp')).toBe('network')
    expect(detectTransport('emulator-5554')).toBe('emulator')
  })

  it('parsea adb mdns services', () => {
    const stdout = [
      'List of discovered mdns services',
      'adb-1234ABCD-xyz\t_adb-tls-pairing._tcp.\t192.168.1.40:41021',
      'adb-1234ABCD\t_adb-tls-connect._tcp.\t192.168.1.40:37211',
      '',
    ].join('\n')

    expect(parseMdns(stdout)).toEqual([
      { kind: 'pairing', name: 'adb-1234ABCD-xyz', address: '192.168.1.40:41021' },
      { kind: 'connect', name: 'adb-1234ABCD', address: '192.168.1.40:37211' },
    ])
  })

  it('parsea getprop', () => {
    const stdout = [
      '[ro.product.model]: [Chromecast HD]',
      '[ro.build.version.sdk]: [31]',
      '[ro.build.characteristics]: [tv]',
    ].join('\n')

    expect(parseGetprop(stdout)).toEqual({
      'ro.product.model': 'Chromecast HD',
      'ro.build.version.sdk': '31',
      'ro.build.characteristics': 'tv',
    })
  })

  it('compone metricas completas', () => {
    const metrics = buildMetrics({
      meminfo: 'Total RAM: 2,097,152K (status normal)\n Free RAM: 897,152K (400,000K cached pss + 300,000K cached kernel + 197,152K free)',
      cpuinfo: 'Load: 1.42 / 1.10 / 0.98\n1.2% TOTAL: 0.8% user + 0.4% kernel',
      storage: '/dev/block/dm-5 24000000 12000000 12000000 50% /data',
      thermal: 'Thermal Status: 2\n  Temperature{mValue=44.5, mType=3, mName=CPU, mStatus=1}',
      uptime: '98765.43 123456.00',
      processes: { code: 0, stdout: '7\n', stderr: '', durationMs: 1, timedOut: false },
      battery: 'Current Battery Service state:\n  level: 87\n  scale: 100\n',
    })

    expect(metrics.totalRamKb).toBe(2097152)
    expect(metrics.usedRamKb).toBe(1200000)
    expect(metrics.cpuBusyPercent).toBe(1.2)
    expect(metrics.storageUsedKb).toBe(12000000)
    expect(metrics.temperatureC).toBe(44.5)
    expect(metrics.uptimeSeconds).toBe(98765)
    expect(metrics.backgroundProcesses).toBe(7)
    expect(metrics.batteryPercent).toBe(87)
  })

  it('devuelve -1 cuando la bateria no esta disponible', () => {
    expect(parseBatteryPercent('')).toBe(-1)
  })

  it('parsea launchers HOME y descarta duplicados', () => {
    const output = [
      'com.google.android.tvlauncher/com.google.android.tvlauncher.MainActivity',
      'com.google.android.tvlauncher/com.google.android.tvlauncher.MainActivity',
      'com.example.launcher/.Home',
    ].join('\n')

    expect(parseHomeLaunchers(output)).toEqual([
      {
        packageName: 'com.google.android.tvlauncher',
        componentName:
          'com.google.android.tvlauncher/com.google.android.tvlauncher.MainActivity',
      },
      {
        packageName: 'com.example.launcher',
        componentName: 'com.example.launcher/com.example.launcher.Home',
      },
    ])
  })
})
