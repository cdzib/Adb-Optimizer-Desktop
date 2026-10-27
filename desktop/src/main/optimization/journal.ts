import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { JournalEntry, JournalStep } from '../../shared/types'

const JOURNAL_VERSION = 1
const MAX_ENTRIES = 500

interface JournalFile {
  version: number
  entries: JournalEntry[]
}

function isJournalEntry(value: unknown): value is JournalEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.deviceId === 'string' &&
    Array.isArray(entry.steps)
  )
}

/**
 * Bitacora de cambios con undo.
 *
 * Persistencia en JSON con escritura atomica (tmp + rename). Se eligio sobre SQLite
 * para el MVP: el volumen es bajo (decenas de entradas) y no requiere binarios nativos.
 * Ver docs/adr/ADR-006-bitacora-json.md.
 *
 * Si el archivo esta corrupto no se descarta en silencio: se renombra a
 * `<archivo>.corrupt-<timestamp>` y el error queda en `lastLoadError`.
 */
export class Journal {
  private entries: JournalEntry[] = []
  private loadError: string | null = null

  constructor(private readonly filePath: string) {
    this.entries = this.load()
  }

  get lastLoadError(): string | null {
    return this.loadError
  }

  private load(): JournalEntry[] {
    if (!existsSync(this.filePath)) return []

    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      const entries = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as Partial<JournalFile>).entries)
          ? (parsed as JournalFile).entries
          : null

      if (!entries) throw new Error('El archivo no tiene el formato de bitacora esperado.')

      const valid = entries.filter(isJournalEntry)
      if (valid.length !== entries.length) {
        this.loadError = `Se descartaron ${entries.length - valid.length} entradas invalidas de la bitacora.`
      }
      return valid
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error)
      this.backupCorrupt()
      return []
    }
  }

  private backupCorrupt(): void {
    const backup = `${this.filePath}.corrupt-${Date.now()}`
    try {
      renameSync(this.filePath, backup)
      this.loadError = `${this.loadError ?? 'Bitacora corrupta'}. Copia en ${backup}.`
    } catch {
      // Si no se puede mover, se conserva el archivo original y el error original.
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const payload: JournalFile = { version: JOURNAL_VERSION, entries: this.entries }
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
  }

  append(entry: Omit<JournalEntry, 'id' | 'appliedAt'>): JournalEntry {
    const stored: JournalEntry = {
      ...entry,
      id: `j_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      appliedAt: new Date().toISOString(),
    }
    this.entries.unshift(stored)
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(0, MAX_ENTRIES)
    }
    this.persist()
    return stored
  }

  /** Actualiza una entrada ya registrada (por ejemplo, al completar la activación). */
  update(id: string, patch: Partial<Omit<JournalEntry, 'id'>>): JournalEntry | undefined {
    const entry = this.get(id)
    if (!entry) return undefined
    Object.assign(entry, patch)
    this.persist()
    return entry
  }

  list(deviceId?: string): JournalEntry[] {
    return deviceId ? this.entries.filter((entry) => entry.deviceId === deviceId) : this.entries
  }

  get(id: string): JournalEntry | undefined {
    return this.entries.find((entry) => entry.id === id)
  }

  markReverted(id: string): void {
    const entry = this.get(id)
    if (entry) {
      entry.revertedAt = new Date().toISOString()
      this.persist()
    }
  }

  static reversibleSteps(entry: JournalEntry): JournalStep[] {
    return entry.steps.filter((step) => step.reversible)
  }
}
