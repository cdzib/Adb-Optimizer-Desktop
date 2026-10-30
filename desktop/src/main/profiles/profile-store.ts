import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppProfile, ProfilesDocument } from '../../shared/types'

function isDocument(value: unknown): value is ProfilesDocument {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ProfilesDocument>
  return Array.isArray(candidate.profiles) && Array.isArray(candidate.runs)
}

/** Solo un perfil queda en vigilancia: el aviso de drift habla de uno a la vez. */
function normalizeWatched(profiles: AppProfile[]): AppProfile[] {
  const index = profiles.findIndex((profile) => profile.watched)
  if (index < 0) return profiles
  return profiles.map((profile, position) =>
    position === index || !profile.watched ? profile : { ...profile, watched: false },
  )
}

/**
 * Persistencia de los perfiles de apps.
 *
 * Guarda un unico documento con escritura atomica (temporal + rename): un fallo a
 * mitad de guardado deja el archivo anterior intacto en lugar de perfiles a medias.
 * Un documento corrupto se trata como vacio.
 */
export class ProfileStore {
  private documentValue: ProfilesDocument

  constructor(private readonly filePath: string) {
    this.documentValue = this.load()
  }

  document(): ProfilesDocument {
    return this.documentValue
  }

  update(transform: (doc: ProfilesDocument) => ProfilesDocument): ProfilesDocument {
    const next = transform(this.documentValue)
    const normalized: ProfilesDocument = { profiles: normalizeWatched(next.profiles), runs: next.runs }
    this.documentValue = normalized
    this.persist(normalized)
    return normalized
  }

  private load(): ProfilesDocument {
    if (!existsSync(this.filePath)) return { profiles: [], runs: [] }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      return isDocument(parsed) ? parsed : { profiles: [], runs: [] }
    } catch {
      return { profiles: [], runs: [] }
    }
  }

  private persist(next: ProfilesDocument): void {
    const directory = dirname(this.filePath)
    mkdirSync(directory, { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    renameSync(temporary, this.filePath)
  }
}
