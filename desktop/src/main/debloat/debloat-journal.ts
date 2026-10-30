import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Paquetes que el debloater desinstalo para el usuario 0, para poder reinstalarlos
 * desde «Restaurar» aunque la app se haya reiniciado.
 *
 * Las apps congeladas no necesitan bitacora: su estado se lee del dispositivo con
 * `pm list packages -d`.
 */
export class DebloatJournal {
  constructor(private readonly filePath: string) {}

  /** Paquetes desinstalados por el debloater que siguen sin reinstalarse. */
  uninstalled(): string[] {
    return [...this.read()]
  }

  record(packageName: string): void {
    const current = this.read()
    if (current.has(packageName)) return
    current.add(packageName)
    this.write(current)
  }

  /** Olvida el paquete cuando ya se reinstalo o se restauro. */
  forget(packageName: string): void {
    const current = this.read()
    if (!current.delete(packageName)) return
    this.write(current)
  }

  private read(): Set<string> {
    if (!existsSync(this.filePath)) return new Set()
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      if (!Array.isArray(parsed)) return new Set()
      return new Set(parsed.filter((item): item is string => typeof item === 'string'))
    } catch {
      return new Set()
    }
  }

  private write(packages: Set<string>): void {
    const directory = dirname(this.filePath)
    mkdirSync(directory, { recursive: true })
    const tmp = join(
      directory,
      `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
    )
    try {
      writeFileSync(tmp, `${JSON.stringify([...packages].sort(), null, 2)}\n`, 'utf8')
      renameSync(tmp, this.filePath)
    } catch (cause) {
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        // El temporal se limpia en el mejor intento posible.
      }
      throw cause
    }
  }
}
