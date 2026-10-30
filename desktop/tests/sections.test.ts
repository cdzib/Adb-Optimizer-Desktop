import { describe, expect, it } from 'vitest'
import {
  GROUPS,
  NAV_ENTRIES,
  groupScreens,
  type Screen,
  type SectionGroup,
} from '../src/renderer/lib/sections'

const SCREENS: Screen[] = [
  'devices',
  'dashboard',
  'optimize',
  'apps',
  'profiles',
  'debloat',
  'files',
  'console',
  'logcat',
  'inspector',
  'settingsdb',
  'power',
  'dpc',
  'launcher',
  'root',
  'flash',
  'history',
]

const EXPECTED_COUNTS: Record<SectionGroup, number> = {
  equipo: 6,
  diagnostico: 5,
  sistema: 4,
  conexion: 2,
}

describe('secciones de navegacion', () => {
  it('registra cada pantalla exactamente una vez', () => {
    const ids = NAV_ENTRIES.map((entry) => entry.id)
    expect([...ids].sort()).toEqual([...SCREENS].sort())
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(SCREENS.length)
  })

  it('reparte los conteos 6/5/4/2 por grupo', () => {
    const grouped = groupScreens()
    for (const group of GROUPS) {
      expect(grouped[group.id]).toHaveLength(EXPECTED_COUNTS[group.id])
    }
    expect(GROUPS.map((group) => group.id)).toEqual([
      'equipo',
      'diagnostico',
      'sistema',
      'conexion',
    ])
  })

  it('solo devices e history no requieren equipo', () => {
    for (const entry of NAV_ENTRIES) {
      const requiresDevice = entry.id !== 'devices' && entry.id !== 'history'
      expect(entry.requiresDevice).toBe(requiresDevice)
    }
  })

  it('groupScreens conserva las mismas entradas sin duplicados', () => {
    const flat = GROUPS.flatMap((group) => groupScreens()[group.id])
    expect(flat).toHaveLength(NAV_ENTRIES.length)
    expect(new Set(flat.map((entry) => entry.id)).size).toBe(NAV_ENTRIES.length)
    expect(new Set(flat)).toEqual(new Set(NAV_ENTRIES))
  })

  it('cada entrada usa una etiqueta i18n y un grupo valido', () => {
    const groups = new Set(GROUPS.map((group) => group.id))
    for (const entry of NAV_ENTRIES) {
      expect(entry.labelKey.startsWith('nav.')).toBe(true)
      expect(groups.has(entry.group)).toBe(true)
    }
  })
})
