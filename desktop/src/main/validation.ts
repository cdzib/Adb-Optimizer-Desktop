import { isIP } from 'node:net'

const PACKAGE_NAME = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/
const COMPONENT_NAME = /^([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)\/([A-Za-z0-9_.$]+)$/
const HOST_NAME = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/
const SHELL_UNSAFE = /[\s\0\r\n;|&`$<>"'\\*?(){}]/

/**
 * Datos que llegan del renderer no son de confianza: se validan antes de
 * convertirlos en argumentos de adb o en fragmentos de un shell remoto.
 */
export function assertPackageName(value: unknown): string {
  if (typeof value !== 'string' || !PACKAGE_NAME.test(value)) {
    throw new Error('El nombre del paquete no es valido.')
  }
  return value
}

export function assertComponentName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('El componente no es valido.')
  }
  const match = COMPONENT_NAME.exec(value)
  if (!match || !PACKAGE_NAME.test(match[1] ?? '')) {
    throw new Error('El componente debe tener el formato paquete/.Receiver.')
  }
  return value
}

/**
 * Acepta IPv4:puerto, [IPv6]:puerto y hostname:puerto. Rechaza opciones de adb
 * (`-l`) y metacaracteres de shell antes de llamar a `adb connect` o `adb pair`.
 */
export function isHostPort(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('-')) return false
  if (SHELL_UNSAFE.test(value)) return false

  const bracketed = /^\[([^\]]+)\]:(\d{1,5})$/.exec(value)
  const plain = bracketed ? null : /^([^:]+):(\d{1,5})$/.exec(value)
  const host = bracketed?.[1] ?? plain?.[1]
  const portRaw = bracketed?.[2] ?? plain?.[2]
  const port = Number.parseInt(portRaw ?? '', 10)

  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) return false
  if (bracketed) return isIP(host) === 6
  return isIP(host) === 4 || HOST_NAME.test(host)
}

export function assertHostPort(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('-')) {
    throw new Error('La direccion del dispositivo no es valida.')
  }
  if (SHELL_UNSAFE.test(value)) {
    throw new Error('La direccion del dispositivo contiene caracteres no permitidos.')
  }
  if (!isHostPort(value)) {
    throw new Error('La direccion debe tener el formato host:puerto.')
  }
  return value
}

export function assertPort(value: unknown): number {
  const port = typeof value === 'number' ? value : Number.NaN
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('El puerto debe ser un entero entre 1 y 65535.')
  }
  return port
}

export function assertLocale(value: unknown): 'es' | 'en' {
  if (value !== 'es' && value !== 'en') {
    throw new Error('El idioma solicitado no es valido.')
  }
  return value
}
