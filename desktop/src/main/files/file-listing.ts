import type { RemoteFileEntry } from '../../shared/types'

/**
 * Convierte la salida de `ls -la` en entradas navegables.
 *
 * Acepta el formato ISO (`2024-01-01 12:00`) y el formato antiguo
 * (`Jan  1 12:00` o `Jan  1  2023`). Los enlaces aparecen como
 * `nombre -> destino`: se conserva el nombre del enlace y se marca `isLink`.
 */
const LISTING = new RegExp(
  '^([bcdlps-][rwxsStT-]{9}[.+@]?)\\s+\\d+\\s+\\S+\\s+\\S+\\s+(\\d+)\\s+' +
    '(?:\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}|[A-Z][a-z]{2}\\s+\\d{1,2}\\s+(?:\\d{2}:\\d{2}|\\d{4}))\\s+(.+)$',
)

export function parseFileListing(directory: string, output: string): RemoteFileEntry[] {
  const entries: RemoteFileEntry[] = []

  for (const raw of output.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue

    const match = LISTING.exec(line)
    if (!match) continue

    const mode = match[1] ?? ''
    const sizeBytes = Number.parseInt(match[2] ?? '0', 10)
    const rawName = (match[3] ?? '').trim()
    if (rawName.length === 0 || rawName === '.' || rawName === '..') continue

    const isLink = mode.startsWith('l')
    const name = isLink ? rawName.split(' -> ')[0]?.trim() ?? rawName : rawName
    if (name.length === 0) continue

    entries.push({
      name,
      path: directory === '/' ? `/${name}` : `${directory}/${name}`,
      isDirectory: mode.startsWith('d'),
      isLink,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
      mode,
      isApk: /\.(?:apk|apks)$/i.test(name),
    })
  }

  return entries.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1
    return left.name.toLowerCase().localeCompare(right.name.toLowerCase())
  })
}
