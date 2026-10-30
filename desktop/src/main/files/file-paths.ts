/**
 * Reglas de rutas remotas compartidas por el explorador de archivos.
 *
 * Todo lo que llega del renderer se normaliza antes de citarse en un comando:
 * rutas absolutas, sin `.` ni `..`, y sin caracteres de control.
 */

const PROTECTED = new Set([
  '/',
  '/sdcard',
  '/storage',
  '/system',
  '/data',
  '/vendor',
  '/product',
  '/apex',
  '/proc',
  '/sys',
])

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/** Ruta absoluta normalizada; lanza si contiene caracteres de control. */
export function normalizeRemotePath(path: string): string {
  const raw = path.trim().length === 0 ? '/' : path.trim()
  if (CONTROL_CHARS.test(raw)) {
    throw new Error('Ruta inválida.')
  }

  const absolute = raw.startsWith('/') ? raw : `/${raw}`
  const stack: string[] = []
  for (const part of absolute.split('/')) {
    if (part.length === 0 || part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }

  return stack.length === 0 ? '/' : `/${stack.join('/')}`
}

/** Carpetas del sistema que nunca se borran desde la app. */
export function isProtectedRemotePath(path: string): boolean {
  return PROTECTED.has(normalizeRemotePath(path))
}

/** Carpeta contenedora de una ruta remota. */
export function parentRemotePath(path: string): string {
  const normalized = normalizeRemotePath(path)
  if (normalized === '/') return '/'
  const cut = normalized.lastIndexOf('/')
  return cut <= 0 ? '/' : normalized.slice(0, cut)
}

/** Nombre simple de archivo o carpeta, sin `/`, `.` ni `..`. */
export function assertRemoteName(value: string): string {
  const name = value.trim()
  if (
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    CONTROL_CHARS.test(name)
  ) {
    throw new Error('Nombre de archivo inválido.')
  }
  return name
}

/** Une una carpeta remota normalizada con un nombre validado. */
export function childRemotePath(parent: string, name: string): string {
  const clean = assertRemoteName(name)
  const directory = normalizeRemotePath(parent)
  return directory === '/' ? `/${clean}` : `${directory}/${clean}`
}
