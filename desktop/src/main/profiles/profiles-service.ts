import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { IpcMain } from 'electron'
import type {
  AppProfile,
  ProfileApp,
  ProfileAppState,
  ProfileChange,
  ProfilePlan,
  ProfileProgress,
  ProfileRun,
  ProfilesDocument,
} from '../../shared/types'
import type { AdbClient } from '../adb/adb-client'
import type { FeatureContext } from '../features/context'
import { requireDevice } from '../features/context'
import { assertLabAllowed } from '../lab'
import { PackageStateService } from '../packages/package-state'
import { assertPackageName } from '../validation'
import { planProfile, snapshotProfile, undoSteps } from './profile-planner'
import { ProfileStore } from './profile-store'

const MAX_RUNS = 10
const STATES: ProfileAppState[] = ['ENABLED', 'DISABLED', 'UNINSTALLED']

function assertState(value: unknown): ProfileAppState {
  if (typeof value !== 'string' || !STATES.includes(value as ProfileAppState)) {
    throw new Error('El estado de la app no es valido.')
  }
  return value as ProfileAppState
}

/** Normaliza un perfil que llega del renderer: sin duplicados y con paquetes validos. */
function normalizeProfile(profile: AppProfile): AppProfile {
  if (!profile || typeof profile !== 'object') {
    throw new Error('El perfil no es valido.')
  }
  const name = typeof profile.name === 'string' ? profile.name.trim() : ''
  if (name.length === 0) {
    throw new Error('El perfil necesita un nombre.')
  }
  if (!Array.isArray(profile.apps)) {
    throw new Error('El perfil no tiene una lista de apps valida.')
  }

  const apps: ProfileApp[] = []
  const seen = new Set<string>()
  for (const entry of profile.apps) {
    const packageName = assertPackageName(entry?.packageName)
    if (seen.has(packageName)) continue
    seen.add(packageName)
    const label =
      typeof entry.label === 'string' && entry.label.trim().length > 0
        ? entry.label.trim()
        : packageName
    apps.push({ packageName, label, state: assertState(entry.state) })
  }

  return {
    id: typeof profile.id === 'string' && profile.id.trim().length > 0 ? profile.id : randomUUID(),
    name,
    createdAt: Number.isFinite(profile.createdAt) ? profile.createdAt : Date.now(),
    apps,
    watched: Boolean(profile.watched),
  }
}

function normalizeChanges(changes: ProfileChange[]): ProfileChange[] {
  if (!Array.isArray(changes)) {
    throw new Error('Los cambios a deshacer no son validos.')
  }
  return changes.map((change) => {
    if (!change || typeof change !== 'object') {
      throw new Error('Los cambios a deshacer no son validos.')
    }
    return {
      packageName: assertPackageName(change.packageName),
      from: assertState(change.from),
      to: assertState(change.to),
    }
  })
}

/**
 * Perfiles de estado de apps sobre el dispositivo activo.
 *
 * El trabajo con paquetes vive en `PackageStateService`, compartido con el debloater:
 * ambos ejecutan `pm` y confirman cada cambio leyendolo de vuelta.
 */
export class ProfilesService {
  private readonly store: ProfileStore
  private readonly packages: PackageStateService

  /** Progreso de `apply`, uno por paquete; lo conecta el registro IPC con `ctx.send`. */
  onProgress: (progress: ProfileProgress) => void = () => {}

  constructor(
    client: AdbClient,
    dataDir: string,
    private readonly protectedPackages: Set<string>,
  ) {
    this.store = new ProfileStore(join(dataDir, 'profiles.json'))
    this.packages = new PackageStateService(client, protectedPackages)
  }

  document(): ProfilesDocument {
    return this.store.document()
  }

  save(profile: AppProfile): AppProfile {
    const next = normalizeProfile(profile)
    this.store.update((document) => {
      const exists = document.profiles.some((item) => item.id === next.id)
      let profiles = exists
        ? document.profiles.map((item) => (item.id === next.id ? next : item))
        : [...document.profiles, next]
      // Solo un perfil queda en vigilancia.
      if (next.watched) {
        profiles = profiles.map((item) =>
          item.id === next.id ? item : { ...item, watched: false },
        )
      }
      return { ...document, profiles }
    })
    return next
  }

  delete(id: string): boolean {
    if (typeof id !== 'string' || id.length === 0) return false
    const before = this.store.document()
    if (!before.profiles.some((profile) => profile.id === id)) return false
    this.store.update((document) => ({
      ...document,
      profiles: document.profiles.filter((profile) => profile.id !== id),
    }))
    return true
  }

  setWatched(id: string, watched: boolean): boolean {
    if (typeof id !== 'string' || id.length === 0) return false
    const before = this.store.document()
    if (!before.profiles.some((profile) => profile.id === id)) return false
    this.store.update((document) => ({
      ...document,
      profiles: document.profiles.map((profile) => {
        if (profile.id === id) return { ...profile, watched }
        return watched ? { ...profile, watched: false } : profile
      }),
    }))
    return true
  }

  async states(): Promise<Record<string, ProfileAppState>> {
    return this.packages.states()
  }

  async snapshot(): Promise<ProfileApp[]> {
    return snapshotProfile(await this.packages.states(), {})
  }

  async plan(profile: AppProfile): Promise<ProfilePlan> {
    const target = normalizeProfile(profile)
    const current = await this.packages.states()
    return planProfile(target, current, (packageName) => this.protectedPackages.has(packageName))
  }

  /**
   * Ejecuta el plan del perfil. Un paso que el dispositivo rechaza no detiene el resto:
   * se anota el paquete y la ejecucion queda con lo aplicado para poder deshacerlo.
   */
  async apply(profile: AppProfile): Promise<ProfileRun> {
    const target = normalizeProfile(profile)
    const before = await this.packages.states()
    const plan = planProfile(target, before, (packageName) =>
      this.protectedPackages.has(packageName),
    )
    const targets = new Map(target.apps.map((app) => [app.packageName, app.state]))
    const total = plan.steps.reduce((count, step) => count + step.packages.length, 0)
    const changes: ProfileChange[] = []
    const failures: string[] = []
    let done = 0

    for (const step of plan.steps) {
      for (const packageName of step.packages) {
        try {
          await this.packages.execute(step.kind, packageName)
          const from = before[packageName]
          const to = targets.get(packageName)
          if (from && to) {
            changes.push({ packageName, from, to })
          }
        } catch {
          failures.push(packageName)
        }
        done += 1
        this.onProgress({ done, total, packageName, kind: step.kind })
      }
    }

    const run: ProfileRun = {
      id: randomUUID(),
      profileId: target.id,
      profileName: target.name,
      appliedAt: Date.now(),
      changes,
      failures,
    }

    if (changes.length > 0) {
      this.store.update((document) => ({
        ...document,
        runs: [run, ...document.runs].slice(0, MAX_RUNS),
      }))
    }

    return run
  }

  /** Devuelve las apps al estado que tenian antes de la ejecucion. */
  async undo(changes: ProfileChange[]): Promise<number> {
    const steps = undoSteps(normalizeChanges(changes), (packageName) =>
      this.protectedPackages.has(packageName),
    )
    let restored = 0
    for (const step of steps) {
      for (const packageName of step.packages) {
        try {
          await this.packages.execute(step.kind, packageName)
          restored += 1
        } catch {
          // Un paquete que no confirma no cuenta como restaurado.
        }
      }
    }
    return restored
  }
}

/** Registra los canales de perfiles; el servicio se crea una vez por sesion. */
export function registerProfilesIpc(
  ipc: IpcMain,
  ctx: FeatureContext,
  protectedPackages: Set<string>,
): void {
  const service = new ProfilesService(ctx.client, ctx.dataDir, protectedPackages)
  service.onProgress = (progress) => ctx.send('profiles:progress', progress)

  ipc.handle('profiles:document', () => service.document())

  ipc.handle('profiles:save', (_event, profile: unknown) =>
    service.save(profile as AppProfile),
  )

  ipc.handle('profiles:delete', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('El perfil a eliminar no es valido.')
    return service.delete(id)
  })

  ipc.handle('profiles:watch', (_event, id: unknown, watched: unknown) => {
    if (typeof id !== 'string') throw new Error('El perfil no es valido.')
    return service.setWatched(id, Boolean(watched))
  })

  ipc.handle('profiles:states', async () => {
    requireDevice(ctx.client)
    return service.states()
  })

  ipc.handle('profiles:snapshot', async () => {
    requireDevice(ctx.client)
    return service.snapshot()
  })

  ipc.handle('profiles:plan', async (_event, profile: unknown) => {
    requireDevice(ctx.client)
    return service.plan(profile as AppProfile)
  })

  ipc.handle('profiles:apply', async (_event, profile: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'aplicar un perfil de apps')
    const run = await service.apply(profile as AppProfile)
    ctx.log(`profiles: ${run.profileName} · ${run.changes.length} cambios, ${run.failures.length} fallos`)
    return run
  })

  ipc.handle('profiles:undo', async (_event, changes: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'deshacer un perfil de apps')
    if (!Array.isArray(changes)) throw new Error('Los cambios a deshacer no son validos.')
    const restored = await service.undo(changes as ProfileChange[])
    ctx.log(`profiles: undo ${restored} paquete(s)`)
    return restored
  })
}
