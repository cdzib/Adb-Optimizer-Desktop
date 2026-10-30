import type { DozePhase } from '../../shared/types'

/**
 * Reglas puras sobre lo que imprime `dumpsys deviceidle`.
 *
 * El estado llega como token suelto (`get deep` / `get light`) o dentro del
 * volcado completo (`Deep state: X`, `Stepped to deep: X`).
 */
export const DEEP_STATES = [
  'ACTIVE',
  'INACTIVE',
  'IDLE_PENDING',
  'SENSING',
  'LOCATING',
  'IDLE',
  'IDLE_MAINTENANCE',
  'QUICK_DOZE_DELAY',
] as const

export const LIGHT_STATES = [
  'ACTIVE',
  'INACTIVE',
  'PRE_IDLE',
  'IDLE',
  'WAITING_FOR_NETWORK',
  'IDLE_MAINTENANCE',
  'OVERRIDE',
] as const

const STEPPED = /^Stepped to (deep|light): ([A-Z_]+)/
const DEEP_LINE = /Deep state: ([A-Z_]+)/
const LIGHT_LINE = /Light state: ([A-Z_]+)/

export function parseDozeToken(raw: string | null, light: boolean): string | null {
  const allowed: readonly string[] = light ? LIGHT_STATES : DEEP_STATES

  for (const rawLine of (raw ?? '').split('\n')) {
    const text = rawLine.trim()
    if (text.length === 0) continue
    if (allowed.includes(text)) return text

    if (!light) {
      const deep = DEEP_LINE.exec(text)?.[1]
      if (deep && allowed.includes(deep)) return deep
      const stepped = STEPPED.exec(text)
      if (stepped && stepped[1] === 'deep' && allowed.includes(stepped[2] ?? '')) {
        return stepped[2] ?? null
      }
    } else {
      const lightState = LIGHT_LINE.exec(text)?.[1]
      if (lightState && allowed.includes(lightState)) return lightState
      const stepped = STEPPED.exec(text)
      if (stepped && stepped[1] === 'light' && allowed.includes(stepped[2] ?? '')) {
        return stepped[2] ?? null
      }
    }
  }

  return null
}

export function parseDozeBool(raw: string | null): boolean | null {
  const first = (raw ?? '').split('\n')[0]?.trim().toLowerCase()
  if (first === 'true') return true
  if (first === 'false') return false
  return null
}

export function dozePhase(deep: string | null): DozePhase {
  switch (deep) {
    case 'ACTIVE':
      return 'active'
    case 'INACTIVE':
    case 'QUICK_DOZE_DELAY':
      return 'inactive'
    case 'IDLE_PENDING':
    case 'SENSING':
    case 'LOCATING':
      return 'pending'
    case 'IDLE':
      return 'idle'
    case 'IDLE_MAINTENANCE':
      return 'maintenance'
    default:
      return 'unknown'
  }
}
