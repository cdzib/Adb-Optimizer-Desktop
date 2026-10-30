import { join } from 'node:path'
import type { IpcMain } from 'electron'
import type {
  DebloatAction,
  DebloatCatalogState,
  DebloatRestoreItem,
  DebloatRisk,
  DebloatRun,
  DebloatSuggestion,
  ProfileAppState,
  ProfileChange,
  ProfileStepKind,
} from '../../shared/types'
import type { AdbClient } from '../adb/adb-client'
import type { FeatureContext } from '../features/context'
import { requireDevice } from '../features/context'
import { assertLabAllowed } from '../lab'
import { PackageStateService } from '../packages/package-state'
import { undoSteps } from '../profiles/profile-planner'
import { assertPackageName } from '../validation'
import { DebloatCatalog } from './debloat-catalog'
import { DebloatJournal } from './debloat-journal'

const ACTIONS: DebloatAction[] = ['FREEZE', 'UNFREEZE', 'UNINSTALL', 'RESTORE']
const STATES: ProfileAppState[] = ['ENABLED', 'DISABLED', 'UNINSTALLED']
const RISK_ORDER: Record<DebloatRisk, number> = { recommended: 0, advanced: 1, expert: 2 }

const STEP_FOR: Record<DebloatAction, ProfileStepKind> = {
  FREEZE: 'DISABLE',
  UNFREEZE: 'ENABLE',
  UNINSTALL: 'UNINSTALL',
  RESTORE: 'ENABLE',
}

const TARGET_STATE_FOR: Record<DebloatAction, ProfileAppState> = {
  FREEZE: 'DISABLED',
  UNFREEZE: 'ENABLED',
  UNINSTALL: 'UNINSTALLED',
  RESTORE: 'ENABLED',
}

function assertAction(value: unknown): DebloatAction {
  if (typeof value !== 'string' || !ACTIONS.includes(value as DebloatAction)) {
    throw new Error('La accion del debloater no es valida.')
  }
  return value as DebloatAction
}

function assertTargets(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Los paquetes seleccionados no son validos.')
  }
  const seen = new Set<string>()
  const targets: string[] = []
  for (const item of value) {
    const packageName = assertPackageName(item)
    if (seen.has(packageName)) continue
    seen.add(packageName)
    targets.push(packageName)
  }
  return targets
}

function assertState(value: unknown): ProfileAppState {
  if (typeof value !== 'string' || !STATES.includes(value as ProfileAppState)) {
    throw new Error('El estado de la app no es valido.')
  }
  return value as ProfileAppState
}

function assertChanges(value: unknown): ProfileChange[] {
  if (!Array.isArray(value)) {
    throw new Error('Los cambios a deshacer no son validos.')
  }
  return value.map((change) => {
    if (!change || typeof change !== 'object') {
      throw new Error('Los cambios a deshacer no son validos.')
    }
    const entry = change as Partial<ProfileChange>
    return {
      packageName: assertPackageName(entry.packageName),
      from: assertState(entry.from),
      to: assertState(entry.to),
    }
  })
}

/**
 * Debloater sobre el dispositivo activo: catalogo descargado en runtime, estado real
 * de los paquetes y bitacora de lo desinstalado para poder restaurarlo.
 *
 * Los cambios se ejecutan con `PackageStateService`, compartido con los perfiles: cada
 * paso se confirma releyendo el dispositivo.
 */
export class DebloatService {
  private readonly catalogStore: DebloatCatalog
  private readonly journal: DebloatJournal
  private readonly packages: PackageStateService

  constructor(
    client: AdbClient,
    dataDir: string,
    private readonly protectedPackages: Set<string>,
  ) {
    this.catalogStore = new DebloatCatalog(join(dataDir, 'debloat-catalog.json'))
    this.journal = new DebloatJournal(join(dataDir, 'debloat-uninstalled.json'))
    this.packages = new PackageStateService(client, protectedPackages)
  }

  async catalog(): Promise<DebloatCatalogState> {
    return {
      entries: this.catalogStore.cached() ?? [],
      updatedAt: this.catalogStore.updatedAt(),
    }
  }

  async download(): Promise<DebloatCatalogState> {
    await this.catalogStore.download()
    return this.catalog()
  }

  /** Paquetes del catalogo que siguen instalados o congelados en el dispositivo. */
  async suggestions(): Promise<DebloatSuggestion[]> {
    const entries = this.catalogStore.cached() ?? []
    if (entries.length === 0) return []

    const states = await this.packages.states()
    return entries
      .flatMap((entry) => {
        const state = states[entry.packageName]
        if (!state || state === 'UNINSTALLED') return []
        return [
          {
            packageName: entry.packageName,
            label: entry.packageName,
            state,
            risk: entry.risk,
            description: entry.description,
            source: entry.source,
          },
        ]
      })
      .sort(
        (a, b) =>
          RISK_ORDER[a.risk] - RISK_ORDER[b.risk] ||
          a.packageName.localeCompare(b.packageName),
      )
  }

  /** Congeladas actuales y desinstaladas por el debloater que siguen sin reinstalarse. */
  async restorable(): Promise<DebloatRestoreItem[]> {
    const states = await this.packages.states()
    const disabled = Object.entries(states)
      .filter(([, state]) => state === 'DISABLED')
      .map(([packageName]) => packageName)
    const uninstalled = this.journal
      .uninstalled()
      .filter((packageName) => states[packageName] === 'UNINSTALLED')

    const unique = new Map<string, ProfileAppState>()
    for (const packageName of [...disabled, ...uninstalled]) {
      unique.set(packageName, states[packageName] ?? 'DISABLED')
    }

    return [...unique.entries()]
      .map(([packageName, state]) => ({ packageName, label: packageName, state }))
      .sort((a, b) => a.packageName.localeCompare(b.packageName))
  }

  /**
   * Congela, descongela o desinstala; un fallo se anota y no detiene la tanda.
   * Solo se registran los cambios confirmados por el dispositivo.
   */
  async apply(action: DebloatAction, targets: string[]): Promise<DebloatRun> {
    const kind = assertAction(action)
    const selected = assertTargets(targets)
    const before = await this.packages.states()
    const step = STEP_FOR[kind]
    const targetState = TARGET_STATE_FOR[kind]
    const changes: ProfileChange[] = []
    const failures: string[] = []

    for (const packageName of selected) {
      try {
        await this.packages.execute(step, packageName)
        if (kind === 'UNINSTALL') this.journal.record(packageName)
        changes.push({
          packageName,
          from: before[packageName] ?? 'ENABLED',
          to: targetState,
        })
      } catch {
        failures.push(packageName)
      }
    }

    return { action: kind, changes, failures }
  }

  /** Deshace una tanda confirmando cada paquete; solo los confirmados cuentan. */
  async undo(run: DebloatRun): Promise<number> {
    const changes = assertChanges(run?.changes)
    const steps = undoSteps(changes, (packageName) => this.protectedPackages.has(packageName))
    const tracked = new Set(this.journal.uninstalled())
    let restored = 0

    for (const step of steps) {
      for (const packageName of step.packages) {
        try {
          await this.packages.execute(step.kind, packageName)
          if (tracked.has(packageName)) {
            this.journal.forget(packageName)
            tracked.delete(packageName)
          }
          restored += 1
        } catch {
          // Un paquete que no confirma no cuenta como restaurado.
        }
      }
    }

    return restored
  }

  /** Devuelve al estado habilitado lo congelado o desinstalado por el debloater. */
  async restore(targets: string[]): Promise<DebloatRun> {
    const selected = assertTargets(targets)
    const before = await this.packages.states()
    const changes: ProfileChange[] = []
    const failures: string[] = []

    for (const packageName of selected) {
      const current = before[packageName]
      const step: ProfileStepKind | null =
        current === 'DISABLED' ? 'ENABLE' : current === 'UNINSTALLED' ? 'REINSTALL' : null
      if (current == null || step == null) continue

      try {
        await this.packages.execute(step, packageName)
        this.journal.forget(packageName)
        changes.push({ packageName, from: current, to: 'ENABLED' })
      } catch {
        failures.push(packageName)
      }
    }

    return { action: 'RESTORE', changes, failures }
  }
}

/** Registra los canales del debloater; el servicio se crea una vez por sesion. */
export function registerDebloatIpc(
  ipc: IpcMain,
  ctx: FeatureContext,
  protectedPackages: Set<string>,
): void {
  const service = new DebloatService(ctx.client, ctx.dataDir, protectedPackages)

  ipc.handle('debloat:catalog', async () => {
    requireDevice(ctx.client)
    return service.catalog()
  })

  ipc.handle('debloat:download', async () => {
    requireDevice(ctx.client)
    const state = await service.download()
    ctx.log(`debloat: catalogo con ${state.entries.length} paquetes`)
    return state
  })

  ipc.handle('debloat:suggestions', async () => {
    requireDevice(ctx.client)
    return service.suggestions()
  })

  ipc.handle('debloat:restorable', async () => {
    requireDevice(ctx.client)
    return service.restorable()
  })

  ipc.handle('debloat:apply', async (_event, action: unknown, targets: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'aplicar una tanda del debloater')
    const run = await service.apply(assertAction(action), assertTargets(targets))
    ctx.log(
      `debloat: ${run.action} · ${run.changes.length} cambios, ${run.failures.length} fallos`,
    )
    return run
  })

  ipc.handle('debloat:undo', async (_event, run: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'deshacer una tanda del debloater')
    if (!run || typeof run !== 'object') {
      throw new Error('La tanda a deshacer no es valida.')
    }
    const restored = await service.undo(run as DebloatRun)
    ctx.log(`debloat: undo ${restored} paquete(s)`)
    return restored
  })

  ipc.handle('debloat:restore', async (_event, targets: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'restaurar paquetes del debloater')
    const run = await service.restore(assertTargets(targets))
    ctx.log(`debloat: restore ${run.changes.length} paquete(s)`)
    return run
  })
}
