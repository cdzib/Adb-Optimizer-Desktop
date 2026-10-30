import type {
  CpuCoreFrequency,
  DiagnosticsBattery,
  DiagnosticsNetworkInterface,
  DiagnosticsScreenInfo,
  DiagnosticsSensor,
} from '../../shared/types'

/** Codigos de `dumpsys battery` que Android documenta; el resto se descarta. */
const BATTERY_HEALTH: Record<number, string> = {
  2: 'Good',
  3: 'Overheat',
  4: 'Dead',
  5: 'Over voltage',
  6: 'Failure',
  7: 'Cold',
}

const BATTERY_STATUS: Record<number, string> = {
  2: 'Charging',
  3: 'Discharging',
  4: 'Not charging',
  5: 'Full',
}

const INT_MIN = -2147483648

/**
 * `dumpsys battery` en pares `clave: valor`. Los centinelas del framework
 * (`-1`, `Int.MIN_VALUE`) y los valores no numericos se traducen a null para
 * que la UI nunca muestre una lectura falsa.
 */
export function parseBatteryDiagnostics(raw: string): DiagnosticsBattery {
  const values = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    values.set(
      line.slice(0, separator).trim().toLowerCase(),
      line.slice(separator + 1).trim(),
    )
  }

  if (values.get('present') === 'false') return emptyBattery()

  const level = integerValue(values.get('level'))
  const scale = integerValue(values.get('scale')) ?? 100
  const percent =
    level !== null && scale > 0 && level >= 0 && level <= scale
      ? Math.round((level * 100) / scale)
      : null

  const voltage = numericValue(values.get('voltage'))
  const temperature = numericValue(values.get('temperature'))
  const chargeCounter = numericValue(values.get('charge counter'))
  const current = numericValue(values.get('current now'))

  return {
    level: percent,
    health: labelFor(BATTERY_HEALTH, integerValue(values.get('health'))),
    status: labelFor(BATTERY_STATUS, integerValue(values.get('status'))),
    voltageV: voltage !== null && voltage > 0 ? round(voltage / 1000, 3) : null,
    temperatureC: temperature !== null ? round(temperature / 10, 1) : null,
    technology: textOrNull(values.get('technology')),
    chargeCounterUah: chargeCounter !== null && chargeCounter > 0 ? chargeCounter : null,
    currentMa: current !== null ? round(current / 1000, 3) : null,
  }
}

/**
 * Una linea `indice|cur|min|max` en kHz por nucleo. Un nucleo sin cpufreq
 * conserva sus campos en null en lugar de desaparecer de la lista.
 */
export function parseCpuFrequencies(raw: string): CpuCoreFrequency[] {
  const seen = new Set<number>()
  const cores: CpuCoreFrequency[] = []

  for (const line of raw.split('\n')) {
    const parts = line.split('|')
    const index = integerValue(parts[0]?.trim())
    if (index === null || index < 0 || seen.has(index)) continue
    seen.add(index)
    cores.push({
      index,
      currentMhz: frequencyMhz(parts[1]),
      minMhz: frequencyMhz(parts[2]),
      maxMhz: frequencyMhz(parts[3]),
    })
  }

  return cores.sort((left, right) => left.index - right.index)
}

/** `wm size`, `wm density` y `DisplayDeviceInfo`; el override manda si existe. */
export function parseScreenInfo(raw: string): DiagnosticsScreenInfo {
  const sizes = new Map<string, { width: number; height: number }>()
  for (const match of raw.matchAll(/(Physical|Override) size:\s*(\d+)\s*x\s*(\d+)/g)) {
    const width = Number.parseInt(match[2] ?? '', 10)
    const height = Number.parseInt(match[3] ?? '', 10)
    if (Number.isInteger(width) && Number.isInteger(height)) {
      sizes.set(match[1] ?? '', { width, height })
    }
  }

  const densities = new Map<string, number>()
  for (const match of raw.matchAll(/(Physical|Override) density:\s*(\d+)/g)) {
    const density = Number.parseInt(match[2] ?? '', 10)
    if (Number.isInteger(density)) densities.set(match[1] ?? '', density)
  }

  const fallback = /DisplayDeviceInfo\{[^}]*?(\d{3,5})\s+x\s+(\d{3,5}),/.exec(raw)
  const fallbackSize = fallback
    ? {
        width: Number.parseInt(fallback[1] ?? '', 10),
        height: Number.parseInt(fallback[2] ?? '', 10),
      }
    : null

  const active = sizes.get('Override') ?? sizes.get('Physical') ?? fallbackSize
  const density = densities.get('Override') ?? densities.get('Physical') ?? null
  const refresh =
    /(?:refreshRate|renderFrameRate)\s+([\d.]+)/.exec(raw)?.[1] ??
    /([\d.]+)\s*fps/.exec(raw)?.[1]

  return {
    width: active?.width ?? null,
    height: active?.height ?? null,
    densityDpi: density,
    refreshRateHz: refreshNumber(refresh),
  }
}

/** Lineas `0x... nombre | vendor | ver: n | type: tipo(codigo)` del sensor service. */
export function parseSensors(raw: string): DiagnosticsSensor[] {
  const linePattern =
    /^0x[0-9a-fA-F]+\)\s*(.+?)\s*\|\s*(.+?)\s*\|\s*ver:\s*\d+\s*\|\s*type:\s*([^(|]+?)\s*\(\s*(-?\d+)\s*\)/
  const seen = new Set<string>()
  const sensors: DiagnosticsSensor[] = []

  for (const line of raw.split('\n')) {
    const match = linePattern.exec(line.trim())
    if (!match) continue
    const name = (match[1] ?? '').trim()
    const vendor = (match[2] ?? '').trim()
    const type = (match[3] ?? '').trim()
    if (!name || !type) continue
    const key = `${name}|${type}`
    if (seen.has(key)) continue
    seen.add(key)
    sensors.push({ name, vendor, type })
  }

  return sensors
}

/** `ip -o addr show up`: una fila por direccion, incluida loopback si esta up. */
export function parseNetworkInterfaces(raw: string): DiagnosticsNetworkInterface[] {
  const seen = new Set<string>()
  const interfaces: DiagnosticsNetworkInterface[] = []

  for (const line of raw.split('\n')) {
    const match = /^\d+:\s+(\S+)\s+inet6?\s+(\S+)/.exec(line.trim())
    if (!match) continue
    const name = (match[1] ?? '').split('@')[0] ?? ''
    const cidr = match[2] ?? ''
    const slash = cidr.indexOf('/')
    const address = slash >= 0 ? cidr.slice(0, slash) : cidr
    if (!name || !address) continue
    const prefix = slash >= 0 ? Number.parseInt(cidr.slice(slash + 1), 10) : Number.NaN
    const normalizedPrefix = Number.isInteger(prefix) ? prefix : null
    const key = `${name}|${address}|${normalizedPrefix ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    interfaces.push({ name, address, prefix: normalizedPrefix })
  }

  return interfaces
}

/**
 * Version de Vulkan anunciada por SurfaceFlinger. Acepta el texto ya legible
 * (`Vulkan 1.1.128`) o el entero de feature con la mascara de 12 bits de patch.
 */
export function parseVulkanVersion(raw: string | null): string | null {
  if (!raw) return null
  const line = /vulkan[^\n]*/i.exec(raw)?.[0]
  if (!line) return null

  const triple = /(\d+)\.(\d+)\.(\d+)/.exec(line)
  if (triple) return `${triple[1]}.${triple[2]}.${triple[3]}`

  const integer = /\b(\d{4,})\b/.exec(line)
  if (integer) {
    const version = Number(integer[1])
    if (Number.isSafeInteger(version) && version > 0) {
      const major = (version >>> 22) & 0x3ff
      const minor = (version >>> 12) & 0x3ff
      const patch = version & 0xfff
      return `${major}.${minor}.${patch}`
    }
  }

  const text = line.replace(/^vulkan\s*(?:version)?\s*:?\s*/i, '').trim()
  return text.length > 0 ? text : null
}

/** Renderer OpenGL ES del volcado de SurfaceFlinger (`GLES: ...`). */
export function parseGlesVersion(raw: string | null): string | null {
  if (!raw) return null
  const match = /GLES:\s*([^\n]+)/.exec(raw)
  const text = match?.[1]?.trim().replace(/[,\s]+$/, '') ?? ''
  return text.length > 0 ? text : null
}

function emptyBattery(): DiagnosticsBattery {
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

function integerValue(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(value) || value === -1 || value === INT_MIN) return null
  return value
}

function numericValue(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const text = raw.trim()
  if (text.length === 0) return null
  const value = Number(text)
  if (!Number.isFinite(value) || value === -1 || value === INT_MIN) return null
  return value
}

function frequencyMhz(raw: string | undefined): number | null {
  const value = numericValue(raw)
  if (value === null || value <= 0) return null
  return round(value / 1000, 3)
}

function labelFor(labels: Record<number, string>, code: number | null): string | null {
  if (code === null) return null
  return labels[code] ?? null
}

function textOrNull(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value || value.toLowerCase() === 'null' || value.toLowerCase() === 'unknown') return null
  return value
}

function refreshNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? round(value, 2) : null
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
