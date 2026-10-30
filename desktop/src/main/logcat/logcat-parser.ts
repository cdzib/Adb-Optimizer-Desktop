import type { LogcatEntry, LogcatLevel } from '../../shared/types'

/** De menos a mas grave. */
export const LOGCAT_LEVELS: LogcatLevel[] = ['V', 'D', 'I', 'W', 'E', 'F']

const THREADTIME =
  /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.+?)\s*:\s?(.*)$/

const DEFAULT_MAX_ENTRIES = 2000

/**
 * Convierte la salida de `logcat -v threadtime` en entradas.
 *
 * Las lineas de continuacion (stack traces) llegan indentadas y se anexan al
 * mensaje de la entrada anterior; las lineas sin formato y sin continuacion se
 * descartan en lugar de inventar una entrada incompleta.
 */
export function parseLogcat(raw: string): LogcatEntry[] {
  const entries: LogcatEntry[] = []

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    if (line.trim().length === 0) continue

    const match = THREADTIME.exec(line)
    if (match) {
      entries.push({
        time: match[1] ?? '',
        pid: match[2] ?? '',
        tid: match[3] ?? '',
        level: (match[4] ?? 'I') as LogcatLevel,
        tag: (match[5] ?? '').trim(),
        message: match[6] ?? '',
      })
      continue
    }

    const previous = entries[entries.length - 1]
    const continues = line.startsWith(' ') || line.startsWith('\t')
    if (previous && continues) {
      entries[entries.length - 1] = {
        ...previous,
        message: `${previous.message}\n${line.trim()}`,
      }
    }
  }

  return entries
}

/**
 * Anexa lecturas incrementales. `logcat -T <hora>` incluye la ultima linea ya
 * vista, asi que se descarta el primer duplicado y se conservan solo las
 * `max` entradas mas recientes.
 */
export function appendLogcat(
  existing: LogcatEntry[],
  incoming: LogcatEntry[],
  max = DEFAULT_MAX_ENTRIES,
): LogcatEntry[] {
  if (incoming.length === 0) return existing

  const last = existing[existing.length - 1]
  const duplicate = last !== undefined && sameEntry(last, incoming[0]!)
  const fresh = duplicate ? incoming.slice(1) : incoming
  if (fresh.length === 0) return existing

  return [...existing, ...fresh].slice(Math.max(existing.length + fresh.length - max, 0))
}

/** Conserva desde `minLevel` hacia arriba y lo que contenga `query` en tag o mensaje. */
export function filterLogcat(
  entries: LogcatEntry[],
  minLevel: LogcatLevel,
  query: string,
): LogcatEntry[] {
  const threshold = Math.max(LOGCAT_LEVELS.indexOf(minLevel), 0)
  const needle = query.trim().toLowerCase()

  return entries.filter((entry) => {
    const level = LOGCAT_LEVELS.indexOf(entry.level)
    if (level < threshold) return false
    if (needle.length === 0) return true
    return (
      entry.tag.toLowerCase().includes(needle) ||
      entry.message.toLowerCase().includes(needle)
    )
  })
}

function sameEntry(left: LogcatEntry, right: LogcatEntry): boolean {
  return (
    left.time === right.time &&
    left.pid === right.pid &&
    left.tid === right.tid &&
    left.level === right.level &&
    left.tag === right.tag &&
    left.message === right.message
  )
}
