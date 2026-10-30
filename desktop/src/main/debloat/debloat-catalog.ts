import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DebloatEntry, DebloatRisk } from '../../shared/types'

/**
 * Lista curada UAD-NG. No se empaqueta con la app: se descarga a pedido y se guarda
 * en el directorio de datos, igual que en la app Android hermana.
 */
export const CATALOG_URL =
  'https://raw.githubusercontent.com/Universal-Debloater-Alliance/universal-android-debloater-next-generation/main/resources/assets/uad_lists.json'

const DOWNLOAD_TIMEOUT_MS = 120_000

const RISKS: Record<string, DebloatRisk> = {
  recommended: 'recommended',
  advanced: 'advanced',
  expert: 'expert',
}

function riskOf(raw: unknown): DebloatRisk | null {
  if (typeof raw !== 'string') return null
  return RISKS[raw.trim().toLowerCase()] ?? null
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Lee el formato de UAD-NG: `{ "paquete": { "list": ..., "removal": ..., "description": ... } }`.
 * Solo se conservan los riesgos que la app puede ofrecer: unsafe y desconocidos se descartan.
 */
export function parseDebloatCatalog(raw: string): DebloatEntry[] {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('La lista de paquetes no tiene el formato esperado.')
  }

  const entries: DebloatEntry[] = []
  for (const [packageName, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const fields = value as Record<string, unknown>
    const risk = riskOf(fields.removal)
    if (!risk) continue
    entries.push({
      packageName,
      source: textOf(fields.list),
      risk,
      description: textOf(fields.description).trim(),
    })
  }

  return entries.sort((a, b) => a.packageName.localeCompare(b.packageName))
}

/** Escritura atomica: primero el temporal, luego el rename dentro del mismo directorio. */
function writeAtomic(filePath: string, content: string): void {
  const directory = dirname(filePath)
  mkdirSync(directory, { recursive: true })
  const tmp = join(directory, `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`)
  try {
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, filePath)
  } catch (cause) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      // El temporal se limpia en el mejor intento posible.
    }
    throw cause
  }
}

async function readBody(
  response: Response,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const body = response.body
  if (!body) {
    const text = await response.text()
    onProgress?.(100)
    return text
  }

  const header = Number(response.headers.get('content-length') ?? 0)
  const total = Number.isFinite(header) && header > 0 ? header : 0
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    received += value.byteLength
    if (total > 0) {
      onProgress?.(Math.min(100, Math.round((received * 100) / total)))
    }
  }

  onProgress?.(100)
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

/** Catalogo descargado en `filePath`; `cached()` nunca lanza por un archivo corrupto. */
export class DebloatCatalog {
  constructor(private readonly filePath: string) {}

  cached(): DebloatEntry[] | null {
    if (!existsSync(this.filePath)) return null
    try {
      const entries = parseDebloatCatalog(readFileSync(this.filePath, 'utf8'))
      return entries.length > 0 ? entries : null
    } catch {
      return null
    }
  }

  updatedAt(): number | null {
    if (!existsSync(this.filePath)) return null
    try {
      const stamp = statSync(this.filePath).mtimeMs
      return stamp > 0 ? stamp : null
    } catch {
      return null
    }
  }

  async download(onProgress?: (percent: number) => void): Promise<DebloatEntry[]> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
    timer.unref()

    try {
      const response = await fetch(CATALOG_URL, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`El servidor respondio HTTP ${response.status} al descargar la lista.`)
      }

      const raw = await readBody(response, onProgress)
      const entries = parseDebloatCatalog(raw)
      if (entries.length === 0) {
        throw new Error('La lista descargada no tiene paquetes validos.')
      }

      writeAtomic(this.filePath, raw)
      return entries
    } finally {
      clearTimeout(timer)
    }
  }
}
