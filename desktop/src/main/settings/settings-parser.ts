import type { SettingEntry, SettingsNamespace } from '../../shared/types'

export const SETTINGS_NAMESPACES: readonly SettingsNamespace[] = ['global', 'secure', 'system']

const KEY = /^[A-Za-z0-9_.]+$/

/**
 * Salida de `settings list <ns>`: una linea `clave=valor`.
 *
 * Se descartan lineas vacias, sin `=` y las que empiezan con `=` (el separador 0
 * corresponde a una clave vacia, que no es escribible de forma segura).
 */
export function parseSettingsList(raw: string): SettingEntry[] {
  const entries: SettingEntry[] = []

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim()
    if (line.length === 0) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    entries.push({
      key: line.slice(0, separator),
      value: line.slice(separator + 1),
    })
  }

  return entries
}

/** `settings get` imprime `null` cuando la clave no existe: equivale a cadena vacia. */
export function readBackMatches(printed: string, expected: string): boolean {
  return normalizePrinted(printed) === expected
}

/** Valor impreso por `settings get` normalizado a lo que se mostraria al usuario. */
export function normalizePrinted(printed: string | null | undefined): string {
  const value = (printed ?? '').trim()
  return value === 'null' ? '' : value
}

export function assertSettingsNamespace(value: unknown): SettingsNamespace {
  if (typeof value !== 'string' || !SETTINGS_NAMESPACES.includes(value as SettingsNamespace)) {
    throw new Error('La tabla de ajustes debe ser global, secure o system.')
  }
  return value as SettingsNamespace
}

export function assertSettingsKey(value: unknown): string {
  if (typeof value !== 'string' || !KEY.test(value)) {
    throw new Error('La clave del ajuste no es valida.')
  }
  return value
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const MAX_VALUE_LENGTH = 512

export function assertSettingsValue(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('El valor del ajuste debe ser texto.')
  }
  if (value.length > MAX_VALUE_LENGTH) {
    throw new Error(`El valor supera ${MAX_VALUE_LENGTH} caracteres.`)
  }
  if (CONTROL_CHARS.test(value)) {
    throw new Error('El valor contiene caracteres de control.')
  }
  return value
}

/** Modo noche reportado por `cmd uimode night` (termina en yes/no/auto). */
export function parseNightMode(raw: string | null): string | null {
  if (!raw) return null
  const text = raw.trim().toLowerCase()
  const modes = ['yes', 'no', 'auto']
  return modes.find((mode) => text.endsWith(mode)) ?? null
}

export function parseSettingInt(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(value) ? value : null
}

export function parseSettingBool(raw: string | null): boolean | null {
  const value = raw?.trim().toLowerCase()
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return null
}
