import type {
  InspectorAppOp,
  InspectorComponent,
  InspectorComponentKind,
  InspectorPermission,
} from '../../shared/types'

/** Tope de elementos por seccion: un volcado corrupto no debe saturar la UI. */
const MAX_ITEMS = 200

const PERMISSION = /^[A-Za-z][A-Za-z0-9_.]*$/
const OPS_LINE = /^([A-Z][A-Z0-9_]+):\s*(\S+)$/
const COMPONENT_LINE = /^\s+\w+\s+([A-Za-z0-9_.$]+)\/([A-Za-z0-9_.$]+)\s+filter\b/
const SIGNATURE = /signatures=PackageSignatures\{\w+\s+version:(\d+),\s+signatures:\[([^\]]*)]/
const SHA256_LINE = /^\s*([0-9a-fA-F]{64})\s/m

type Section = 'none' | 'requested' | 'granted'

/**
 * Permisos declarados en `dumpsys package <pkg>`.
 *
 * - `requested permissions:` no dice si se concedio: `granted` queda en `null`.
 * - `install permissions:` / `runtime permissions:` imprimen `nombre: granted=true|false`.
 * Un mismo permiso puede aparecer en varias secciones; gana la concesion.
 */
export function parseInspectorPermissions(dump: string): InspectorPermission[] {
  const found = new Map<string, boolean | null>()
  let section: Section = 'none'

  for (const rawLine of dump.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trimEnd()

    if (line.endsWith('requested permissions:')) {
      section = 'requested'
      continue
    }
    if (line.endsWith('install permissions:') || line.endsWith('runtime permissions:')) {
      section = 'granted'
      continue
    }
    if (line.startsWith('User ') || line.startsWith('Queries:') || line.startsWith('Packages:')) {
      section = 'none'
      continue
    }

    if (section === 'requested') {
      const name = line.trim()
      if (PERMISSION.test(name) && !found.has(name)) found.set(name, null)
      continue
    }

    if (section === 'granted') {
      const separator = line.lastIndexOf(': granted=')
      if (separator <= 0) continue
      const name = line.slice(0, separator).trim()
      if (!PERMISSION.test(name)) continue
      const granted = line.slice(separator + ': granted='.length).startsWith('true')
      found.set(name, (found.get(name) ?? false) || granted)
    }
  }

  return [...found.entries()]
    .map(([name, granted]) => ({ name, granted }))
    .slice(0, MAX_ITEMS)
}

const RESOLVER_TABLES: Array<[string, InspectorComponentKind]> = [
  ['Activity Resolver Table:', 'activity'],
  ['Service Resolver Table:', 'service'],
  ['Receiver Resolver Table:', 'receiver'],
  ['Provider Resolver Table:', 'provider'],
]

/** Componentes del manifiesto listados en las tablas resolver, solo del paquete pedido. */
export function parseInspectorComponents(
  dump: string,
  packageName: string,
): InspectorComponent[] {
  const found = new Set<string>()
  const result: InspectorComponent[] = []
  let kind: InspectorComponentKind | null = null

  for (const line of dump.split('\n')) {
    const header = RESOLVER_TABLES.find(([prefix]) => line.startsWith(prefix))
    if (header) {
      kind = header[1]
      continue
    }
    if (!kind) continue

    const match = COMPONENT_LINE.exec(line.replace(/\r$/, ''))
    if (!match) continue
    const owner = match[1]
    const className = match[2]
    if (!owner || !className || owner !== packageName) continue

    const id = `${kind}:${className}`
    if (found.has(id)) continue
    found.add(id)
    result.push({ kind, className })
    if (result.length >= MAX_ITEMS) break
  }

  return result
}

/** Operaciones de `appops get <pkg>`; se conserva el primer modo por nombre. */
export function parseAppOps(raw: string): InspectorAppOp[] {
  const found = new Map<string, string>()

  for (const line of raw.split('\n')) {
    const match = OPS_LINE.exec(line.trim())
    if (!match) continue
    const name = match[1]
    const mode = match[2]
    if (!name || !mode || found.has(name)) continue
    found.set(name, mode)
    if (found.size >= MAX_ITEMS) break
  }

  return [...found.entries()].map(([name, mode]) => ({ name, mode }))
}

/** `version:3 · 71c782a3`: hash corto de firma que imprime el volcado, no un SHA-256. */
export function parseSignature(dump: string): string | null {
  const match = SIGNATURE.exec(dump)
  if (!match) return null
  const version = match[1]
  const hashes = (match[2] ?? '').trim()
  if (!version || hashes.length === 0) return null
  return `v${version} · ${hashes}`
}

/** Primera linea de `sha256sum <apk>`: 64 caracteres hexadecimales. */
export function parseSha256(raw: string | null): string | null {
  if (!raw) return null
  const match = SHA256_LINE.exec(raw)
  return match?.[1] ? match[1].toLowerCase() : null
}
