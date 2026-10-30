import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Ultimos comandos recordados por la consola, del mas reciente al mas antiguo. */
const MAX_ENTRIES = 40

/**
 * Historial de comandos en JSON.
 *
 * La lista vive en memoria y cada cambio se publica con escritura atomica
 * (temporal + rename) para que un cierre inesperado no deje el documento a medias.
 * Un archivo corrupto se trata como historial vacio: la consola no debe romperse.
 */
export class ConsoleHistoryStore {
  private commands: string[]

  constructor(private readonly filePath: string) {
    this.commands = this.load()
  }

  list(): string[] {
    return [...this.commands]
  }

  append(command: string): string[] {
    const clean = command.trim()
    if (clean.length > 0) {
      this.commands = [clean, ...this.commands.filter((item) => item !== clean)].slice(0, MAX_ENTRIES)
      this.persist()
    }
    return this.list()
  }

  clear(): void {
    this.commands = []
    this.persist()
  }

  private load(): string[] {
    if (!existsSync(this.filePath)) return []
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, MAX_ENTRIES)
    } catch {
      return []
    }
  }

  private persist(): void {
    const directory = dirname(this.filePath)
    mkdirSync(directory, { recursive: true })
    const tempPath = `${this.filePath}.${process.pid}.tmp`
    try {
      writeFileSync(tempPath, JSON.stringify(this.commands, null, 2), 'utf8')
      renameSync(tempPath, this.filePath)
    } finally {
      if (existsSync(tempPath)) {
        try {
          unlinkSync(tempPath)
        } catch {
          // El temporal ya se movio o no existe: no hay nada que limpiar.
        }
      }
    }
  }
}

export { MAX_ENTRIES as CONSOLE_HISTORY_MAX }
