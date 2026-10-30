import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
  THEME_STORAGE_KEY,
  watchSystemTheme,
} from '../src/renderer/lib/theme'

class FakeStorage {
  readonly map = new Map<string, string>()

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

interface FakeMediaQueryList {
  matches: boolean
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
}

function fakeQuery(matches: boolean): FakeMediaQueryList {
  return {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveTheme', () => {
  it('sigue al sistema cuando la preferencia es system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('respeta la preferencia manual por encima del sistema', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('readThemePreference', () => {
  it('devuelve system si no hay valor guardado', () => {
    const storage = new FakeStorage()
    expect(readThemePreference(storage)).toBe('system')
  })

  it('devuelve system si el valor es invalido', () => {
    const storage = new FakeStorage()
    storage.setItem(THEME_STORAGE_KEY, 'sepia')
    expect(readThemePreference(storage)).toBe('system')
  })

  it('devuelve la preferencia valida guardada', () => {
    const storage = new FakeStorage()
    storage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(readThemePreference(storage)).toBe('dark')
  })
})

describe('saveThemePreference', () => {
  it('escribe la clave y el valor en el storage', () => {
    const storage = new FakeStorage()
    saveThemePreference('light', storage)
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })
})

describe('applyTheme', () => {
  it('escribe data-theme y color-scheme resueltos', () => {
    const query = fakeQuery(true)
    vi.stubGlobal('window', { matchMedia: vi.fn(() => query) })
    const element = { dataset: {} as Record<string, string>, style: {} as Record<string, string> }
    vi.stubGlobal('document', { documentElement: element })

    expect(applyTheme('system')).toBe('dark')
    expect(element.dataset.theme).toBe('dark')
    expect(element.style.colorScheme).toBe('dark')
  })

  it('tolera la ausencia de window y document', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('document', undefined)
    expect(applyTheme('light')).toBe('light')
  })
})

describe('watchSystemTheme', () => {
  it('escucha change y limpia el listener', () => {
    const query = fakeQuery(false)
    vi.stubGlobal('window', { matchMedia: vi.fn(() => query) })

    const listener = vi.fn()
    const cleanup = watchSystemTheme(listener)

    expect(query.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    const handler = query.addEventListener.mock.calls[0]?.[1] as (event: { matches: boolean }) => void
    handler({ matches: true })
    expect(listener).toHaveBeenCalledWith(true)

    cleanup()
    expect(query.removeEventListener).toHaveBeenCalledWith('change', handler)
  })

  it('devuelve un noop si no existe matchMedia', () => {
    vi.stubGlobal('window', {})
    const cleanup = watchSystemTheme(() => undefined)
    expect(() => cleanup()).not.toThrow()
  })
})
