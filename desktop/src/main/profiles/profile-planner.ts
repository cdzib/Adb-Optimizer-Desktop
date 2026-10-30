import type {
  AppProfile,
  ProfileApp,
  ProfileAppState,
  ProfileChange,
  ProfilePlan,
  ProfileStep,
  ProfileStepKind,
} from '../../shared/types'

/** El orden importa: recuperar, habilitar, deshabilitar y desinstalar. */
export const PROFILE_ORDER: ProfileStepKind[] = ['REINSTALL', 'ENABLE', 'DISABLE', 'UNINSTALL']

export type ProfileGuard = (packageName: string) => boolean

const allowAll: ProfileGuard = () => false

/**
 * Reglas puras de los perfiles de estado de apps: reciben el estado que reporta el
 * dispositivo y devuelven los pasos ordenados que lo acercan al perfil. No conocen
 * ADB; la capa de datos ejecuta y confirma cada cambio.
 */
export function planProfile(
  profile: AppProfile,
  current: Record<string, ProfileAppState>,
  isProtected: ProfileGuard = allowAll,
): ProfilePlan {
  const byKind = new Map<ProfileStepKind, string[]>(
    PROFILE_ORDER.map((kind) => [kind, [] as string[]]),
  )
  let same = 0
  let missing = 0
  let blocked = 0

  for (const entry of profile.apps) {
    const state = current[entry.packageName]
    if (isProtected(entry.packageName)) {
      blocked += 1
    } else if (state == null) {
      missing += 1
    } else if (state === entry.state) {
      same += 1
    } else {
      for (const kind of kindsFor(entry.state, state)) {
        byKind.get(kind)?.push(entry.packageName)
      }
    }
  }

  const steps: ProfileStep[] = PROFILE_ORDER.flatMap((kind) => {
    const packages = byKind.get(kind) ?? []
    return packages.length > 0 ? [{ kind, packages }] : []
  })

  return { steps, same, missing, blocked }
}

/**
 * Los pasos que llevan una app desde `current` hasta `target`.
 * Una app desinstalada que debe quedar deshabilitada se reinstala primero.
 */
export function kindsFor(
  target: ProfileAppState,
  current: ProfileAppState,
): ProfileStepKind[] {
  if (target === 'UNINSTALLED') return ['UNINSTALL']
  if (target === 'ENABLED') {
    if (current === 'UNINSTALLED') return ['REINSTALL']
    if (current === 'DISABLED') return ['ENABLE']
    return []
  }
  if (current === 'UNINSTALLED') return ['REINSTALL', 'DISABLE']
  if (current === 'ENABLED') return ['DISABLE']
  return []
}

/** Reconstruye los pasos para volver al estado anterior de una ejecucion. */
export function undoSteps(changes: ProfileChange[], isProtected: ProfileGuard = allowAll): ProfileStep[] {
  const byKind = new Map<ProfileStepKind, string[]>(
    PROFILE_ORDER.map((kind) => [kind, [] as string[]]),
  )

  for (const change of changes) {
    if (isProtected(change.packageName)) continue
    for (const kind of kindsFor(change.from, change.to)) {
      byKind.get(kind)?.push(change.packageName)
    }
  }

  return PROFILE_ORDER.flatMap((kind) => {
    const packages = byKind.get(kind) ?? []
    return packages.length > 0 ? [{ kind, packages }] : []
  })
}

/** Snapshot ordenado por nombre visible, con el paquete como respaldo. */
export function snapshotProfile(
  states: Record<string, ProfileAppState>,
  labels: Record<string, string>,
): ProfileApp[] {
  return Object.entries(states)
    .map(([packageName, state]) => ({
      packageName,
      label: labels[packageName]?.trim() || packageName,
      state,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}
