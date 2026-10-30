import type { IpcMain } from 'electron'
import type { DeviceDiagnostics } from '../../shared/types'
import { parseGetprop } from '../adb/adb-client'
import type { AdbClient } from '../adb/adb-client'
import type { FeatureContext } from '../features/context'
import { requireDevice } from '../features/context'
import {
  parseBatteryDiagnostics,
  parseCpuFrequencies,
  parseGlesVersion,
  parseNetworkInterfaces,
  parseScreenInfo,
  parseSensors,
  parseVulkanVersion,
} from './diagnostics-parser'

/** Copiado de la app Android: un nucleo sin cpufreq simplemente no imprime linea. */
const CPU_FREQUENCY_COMMAND = `for d in /sys/devices/system/cpu/cpu[0-9]*/cpufreq; do [ -d "$d" ] || continue; i=\${d#/sys/devices/system/cpu/cpu}; i=\${i%/cpufreq}; printf '%s|%s|%s|%s\\n' "$i" "$(cat "$d/scaling_cur_freq" 2>/dev/null)" "$(cat "$d/cpuinfo_min_freq" 2>/dev/null)" "$(cat "$d/cpuinfo_max_freq" 2>/dev/null)"; done`

const DEFAULT_TIMEOUT_MS = 15_000
const SENSORS_TIMEOUT_MS = 12_000
const SURFACE_FLINGER_TIMEOUT_MS = 20_000
const CPU_TIMEOUT_MS = 8_000

/**
 * Diagnostico ampliado del dispositivo activo. Solo `getprop` es obligatorio:
 * una lectura opcional que falla deja su bloque vacio y no invalida el resto.
 */
export class DiagnosticsService {
  constructor(private readonly client: AdbClient) {}

  async read(): Promise<DeviceDiagnostics> {
    const [propsRaw, kernel, features, screen, sensors, network, battery, surface, cpu] =
      await Promise.all([
        this.client.shellText('getprop'),
        this.optional('uname -r'),
        this.optional('pm list features'),
        this.optional("wm size; wm density; dumpsys display | grep -m 1 'DisplayDeviceInfo{'"),
        this.optional("dumpsys sensorservice | sed -n '/Sensor List:/,$p'", SENSORS_TIMEOUT_MS),
        this.optional('ip -o addr show up'),
        this.optional('dumpsys battery'),
        this.optional('dumpsys SurfaceFlinger', SURFACE_FLINGER_TIMEOUT_MS),
        this.optional(CPU_FREQUENCY_COMMAND, CPU_TIMEOUT_MS),
      ])

    const props = parseGetprop(propsRaw)

    return {
      hardware: {
        brand: prop(props, 'ro.product.brand'),
        product: prop(props, 'ro.product.product', 'ro.product.name'),
        board: prop(props, 'ro.product.board'),
        hardware: prop(props, 'ro.product.hardware', 'ro.hardware'),
        abis: prop(props, 'ro.product.cpu.abilist', 'ro.product.cpu.abi'),
        usbHost: features === null ? null : /android\.hardware\.usb\.host\b/.test(features),
      },
      system: {
        patch: prop(props, 'ro.build.version.security_patch'),
        build: prop(props, 'ro.build.display.id', 'ro.build.id'),
        kernel: textOrNull(kernel),
        vm: prop(props, 'ro.dalvik.vm.native.bridge', 'java.vm.version'),
        baseband: prop(props, 'gsm.version.baseband', 'ro.baseband'),
      },
      gles: parseGlesVersion(surface),
      vulkan: parseVulkanVersion(surface),
      battery: battery === null ? emptyBattery() : parseBatteryDiagnostics(battery),
      cpuCores: cpu === null ? [] : parseCpuFrequencies(cpu),
      screen: screen === null ? emptyScreen() : parseScreenInfo(screen),
      sensors: sensors === null ? [] : parseSensors(sensors),
      network: network === null ? [] : parseNetworkInterfaces(network),
    }
  }

  private async optional(command: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string | null> {
    try {
      const result = await this.client.shell(command, timeoutMs)
      return result.stdout
    } catch {
      return null
    }
  }
}

export function registerDiagnosticsIpc(ipc: IpcMain, ctx: FeatureContext): void {
  const service = new DiagnosticsService(ctx.client)

  ipc.handle('diagnostics:read', async () => {
    requireDevice(ctx.client)
    const diagnostics = await service.read()
    ctx.log(
      `diagnostics: ${diagnostics.cpuCores.length} nucleos, ${diagnostics.sensors.length} sensores, ${diagnostics.network.length} interfaces`,
    )
    return diagnostics
  })
}

function prop(props: Record<string, string>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = textOrNull(props[key])
    if (value !== null) return value
  }
  return null
}

function textOrNull(raw: string | null | undefined): string | null {
  const value = raw?.trim()
  if (!value || value.toLowerCase() === 'unknown') return null
  return value
}

function emptyBattery(): DeviceDiagnostics['battery'] {
  return {
    level: null,
    health: null,
    status: null,
    voltageV: null,
    temperatureC: null,
    technology: null,
    chargeCounterUah: null,
    currentMa: null,
  }
}

function emptyScreen(): DeviceDiagnostics['screen'] {
  return { width: null, height: null, densityDpi: null, refreshRateHz: null }
}
