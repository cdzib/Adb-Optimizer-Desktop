export type Screen =
  | 'devices'
  | 'dashboard'
  | 'optimize'
  | 'apps'
  | 'profiles'
  | 'debloat'
  | 'files'
  | 'console'
  | 'logcat'
  | 'inspector'
  | 'settingsdb'
  | 'power'
  | 'dpc'
  | 'launcher'
  | 'root'
  | 'flash'
  | 'history'

export type SectionGroup = 'equipo' | 'diagnostico' | 'sistema' | 'conexion'

export interface NavEntry {
  id: Screen
  labelKey: string
  group: SectionGroup
  requiresDevice: boolean
}

export const GROUPS: Array<{ id: SectionGroup; labelKey: string }> = [
  { id: 'equipo', labelKey: 'nav.group.equipo' },
  { id: 'diagnostico', labelKey: 'nav.group.diagnostico' },
  { id: 'sistema', labelKey: 'nav.group.sistema' },
  { id: 'conexion', labelKey: 'nav.group.conexion' },
]

/**
 * Etiquetas de respaldo: el catalogo compartido aun no publica `nav.group.*`.
 * Cuando existan, `t()` devuelve la traduccion y el respaldo no se usa.
 */
const GROUP_FALLBACK: Record<SectionGroup, string> = {
  equipo: 'Equipo',
  diagnostico: 'Diagnóstico',
  sistema: 'Sistema',
  conexion: 'Conexión',
}

export const NAV_ENTRIES: NavEntry[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', group: 'equipo', requiresDevice: true },
  { id: 'optimize', labelKey: 'nav.optimize', group: 'equipo', requiresDevice: true },
  { id: 'apps', labelKey: 'nav.apps', group: 'equipo', requiresDevice: true },
  { id: 'profiles', labelKey: 'nav.profiles', group: 'equipo', requiresDevice: true },
  { id: 'debloat', labelKey: 'nav.debloat', group: 'equipo', requiresDevice: true },
  { id: 'files', labelKey: 'nav.files', group: 'equipo', requiresDevice: true },
  { id: 'console', labelKey: 'nav.console', group: 'diagnostico', requiresDevice: true },
  { id: 'logcat', labelKey: 'nav.logcat', group: 'diagnostico', requiresDevice: true },
  { id: 'inspector', labelKey: 'nav.inspector', group: 'diagnostico', requiresDevice: true },
  { id: 'settingsdb', labelKey: 'nav.settingsdb', group: 'diagnostico', requiresDevice: true },
  { id: 'power', labelKey: 'nav.power', group: 'diagnostico', requiresDevice: true },
  { id: 'launcher', labelKey: 'nav.launcher', group: 'sistema', requiresDevice: true },
  { id: 'root', labelKey: 'nav.root', group: 'sistema', requiresDevice: true },
  { id: 'flash', labelKey: 'nav.flash', group: 'sistema', requiresDevice: true },
  { id: 'dpc', labelKey: 'nav.dpc', group: 'sistema', requiresDevice: true },
  { id: 'devices', labelKey: 'nav.discovery', group: 'conexion', requiresDevice: false },
  { id: 'history', labelKey: 'nav.history', group: 'conexion', requiresDevice: false },
]

export function groupScreens(): Record<SectionGroup, NavEntry[]> {
  const grouped: Record<SectionGroup, NavEntry[]> = {
    equipo: [],
    diagnostico: [],
    sistema: [],
    conexion: [],
  }
  for (const entry of NAV_ENTRIES) grouped[entry.group].push(entry)
  return grouped
}

/** Resuelve la etiqueta de un grupo aunque el catalogo no la traduzca. */
export function groupLabel(t: (key: string) => string, group: SectionGroup): string {
  const entry = GROUPS.find((item) => item.id === group)
  if (!entry) return GROUP_FALLBACK[group]
  const label = t(entry.labelKey)
  return label === entry.labelKey ? GROUP_FALLBACK[group] : label
}
