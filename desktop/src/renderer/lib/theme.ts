export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'adb-optimizer.theme'

const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

function isPreference(value: string | null): value is ThemePreference {
  return value !== null && (PREFERENCES as readonly string[]).includes(value)
}

function defaultReader(): Pick<Storage, 'getItem'> | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined
  } catch {
    return undefined
  }
}

function defaultWriter(): Pick<Storage, 'setItem'> | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined
  } catch {
    return undefined
  }
}

export function readThemePreference(storage?: Pick<Storage, 'getItem'>): ThemePreference {
  const store = storage ?? defaultReader()
  if (!store) return 'system'
  try {
    const value = store.getItem(THEME_STORAGE_KEY)
    return isPreference(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

export function saveThemePreference(
  preference: ThemePreference,
  storage?: Pick<Storage, 'setItem'>,
): void {
  const store = storage ?? defaultWriter()
  if (!store) return
  try {
    store.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Storage puede estar lleno o bloqueado; el tema sigue funcionando en memoria.
  }
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

function darkQuery(): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
  return window.matchMedia('(prefers-color-scheme: dark)')
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const query = darkQuery()
  const resolved = resolveTheme(preference, query?.matches ?? false)
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved
    document.documentElement.style.colorScheme = resolved
  }
  return resolved
}

export function watchSystemTheme(listener: (dark: boolean) => void): () => void {
  const query = darkQuery()
  if (!query) return () => undefined
  const handleChange = (event: MediaQueryListEvent) => listener(event.matches)
  query.addEventListener('change', handleChange)
  return () => query.removeEventListener('change', handleChange)
}
