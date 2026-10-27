/**
 * Helpers puros para la politica de navegacion y permisos de la ventana.
 * Se mantienen fuera de index.ts para poder probarlos sin arrancar Electron.
 */
export function resolveLocale(value: unknown): 'es' | 'en' {
  return value === 'en' ? 'en' : 'es'
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isNavigationAllowed(targetUrl: string, currentUrl: string): boolean {
  try {
    const target = new URL(targetUrl)
    const current = new URL(currentUrl)

    if (target.protocol === 'file:' && current.protocol === 'file:') {
      return target.pathname === current.pathname
    }
    if (target.protocol === 'http:' || target.protocol === 'https:') {
      return target.origin === current.origin
    }
    return false
  } catch {
    return false
  }
}
