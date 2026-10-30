import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SettingsChange, SettingsNamespace } from '../../shared/types'

const MAX_ENTRIES = 100
const NAMESPACES: readonly SettingsNamespace[] = ['global', 'secure', 'system']

/**
 * Historial de cambios de ajustes en disco (`settings-history.json`).
 *
 * La escritura es atomica (temporal + rename) para que un cierre a mitad de guardado
 * no deje un JSON truncado. Un archivo ilegible se trata como historial vacio.
 */
export class SettingsHistory {
  constructor(private readonly filePath: string) {}

  list(): SettingsChange[] {
    return this.read()
  }

  append(change: SettingsChange): void {
    const next = [change, ...this.read()].slice(0, MAX_ENTRIES)
    this.write(next)
  }

  remove(id: string): void {
    this.write(this.read().filter((change) => change.id !== id))
  }

  private read(): SettingsChange[] {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      if (!Array.isArray(raw)) return []
      return raw.filter(isChange).slice(0, MAX_ENTRIES)
    } catch {
      return []
    }
  }

  private write(entries: SettingsChange[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temp, JSON.stringify(entries, null, 2), 'utf8')
    renameSync(temp, this.filePath)
  }
}

function isChange(value: unknown): value is SettingsChange {
  if (!value || typeof value !== 'object') return false
  const change = value as Partial<SettingsChange>
  return (
    typeof change.id === 'string' &&
    typeof change.key === 'string' &&
    typeof change.previousValue === 'string' &&
    typeof change.newValue === 'string' &&
    typeof change.appliedAt === 'string' &&
    NAMESPACES.includes(change.namespace as SettingsNamespace)
  )
}
