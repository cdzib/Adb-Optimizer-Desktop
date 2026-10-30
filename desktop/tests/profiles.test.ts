import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/adb-client'
import type { CommandResult, CommandRunner } from '../src/main/adb/runner'
import { PackageStateService } from '../src/main/packages/package-state'
import {
  PROFILE_ORDER,
  kindsFor,
  planProfile,
  snapshotProfile,
  undoSteps,
} from '../src/main/profiles/profile-planner'
import { ProfileStore } from '../src/main/profiles/profile-store'
import { ProfilesService } from '../src/main/profiles/profiles-service'
import type {
  AppProfile,
  ProfileAppState,
  ProfileChange,
  ProfileProgress,
} from '../src/shared/types'

function ok(stdout = ''): CommandResult {
  return { code: 0, stdout, stderr: '', durationMs: 1, timedOut: false }
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function makeProfile(overrides: Partial<AppProfile> = {}): AppProfile {
  return {
    id: 'perfil-1',
    name: 'Bateria',
    createdAt: 1_000,
    apps: [],
    watched: false,
    ...overrides,
  }
}

/**
 * Transporte ADB local que emula `pm list packages` y los comandos de estado.
 * `confirm = false` simula un dispositivo que acepta el comando pero no lo aplica.
 */
class PackageRunner implements CommandRunner {
  readonly installed = new Set<string>()
  readonly disabled = new Set<string>()
  readonly unavailable = new Set<string>()
  readonly failing = new Set<string>()
  readonly commands: string[] = []
  confirm = true

  async run(_bin: string, args: string[]): Promise<CommandResult> {
    const command = args[args.length - 1] ?? ''
    this.commands.push(command)

    const modifier = /^pm (install-existing --user 0|enable --user 0|disable-user --user 0|uninstall --user 0) (\S+)$/.exec(
      command,
    )
    if (modifier) {
      const kind = modifier[1] ?? ''
      const pkg = modifier[2] ?? ''
      if (this.failing.has(pkg)) {
        return { code: 1, stdout: `Failure [CHANGE_FAILED: ${pkg}]`, stderr: '', durationMs: 1, timedOut: false }
      }
      if (this.confirm) this.change(kind, pkg)
      return ok('Success')
    }

    if (command === 'pm list packages') return ok(lines(this.installed))
    if (command === 'pm list packages -u') {
      return ok(lines(new Set([...this.installed, ...this.unavailable])))
    }
    if (command === 'pm list packages -d') return ok(lines(this.disabled))

    const filtered = /^pm list packages (-[ed]) (\S+)$/.exec(command)
    if (filtered) {
      const set = filtered[1] === '-d' ? this.disabled : enabled(this.installed, this.disabled)
      return ok(set.has(filtered[2] ?? '') ? `package:${filtered[2]}` : '')
    }

    const single = /^pm list packages (\S+)$/.exec(command)
    if (single) {
      return ok(this.installed.has(single[1] ?? '') ? `package:${single[1]}` : '')
    }

    return ok()
  }

  private change(kind: string, pkg: string): void {
    if (kind.startsWith('install-existing')) {
      this.installed.add(pkg)
      this.unavailable.delete(pkg)
      return
    }
    if (kind.startsWith('enable')) {
      this.disabled.delete(pkg)
      return
    }
    if (kind.startsWith('disable-user')) {
      this.disabled.add(pkg)
      return
    }
    this.installed.delete(pkg)
    this.disabled.delete(pkg)
    this.unavailable.add(pkg)
  }
}

function enabled(installed: Set<string>, disabled: Set<string>): Set<string> {
  return new Set([...installed].filter((pkg) => !disabled.has(pkg)))
}

function lines(packages: Set<string>): string {
  return [...packages].map((pkg) => `package:${pkg}`).join('\n')
}

function stateService(runner: PackageRunner, protectedPackages: Set<string> = new Set()) {
  const client = new AdbClient({ adbPath: 'adb', serial: 'emulator-5554', runner })
  return new PackageStateService(client, protectedPackages)
}

describe('ProfilePlanner', () => {
  it('ordena los pasos: reinstalar, habilitar, deshabilitar y desinstalar', () => {
    expect(PROFILE_ORDER).toEqual(['REINSTALL', 'ENABLE', 'DISABLE', 'UNINSTALL'])

    const profile = makeProfile({
      apps: [
        { packageName: 'com.a.restore', label: 'A', state: 'ENABLED' },
        { packageName: 'com.b.enable', label: 'B', state: 'ENABLED' },
        { packageName: 'com.c.disable', label: 'C', state: 'DISABLED' },
        { packageName: 'com.d.remove', label: 'D', state: 'UNINSTALLED' },
      ],
    })

    const plan = planProfile(profile, {
      'com.a.restore': 'UNINSTALLED',
      'com.b.enable': 'DISABLED',
      'com.c.disable': 'ENABLED',
      'com.d.remove': 'ENABLED',
    })

    expect(plan.steps).toEqual([
      { kind: 'REINSTALL', packages: ['com.a.restore'] },
      { kind: 'ENABLE', packages: ['com.b.enable'] },
      { kind: 'DISABLE', packages: ['com.c.disable'] },
      { kind: 'UNINSTALL', packages: ['com.d.remove'] },
    ])
    expect(plan.same).toBe(0)
    expect(plan.missing).toBe(0)
    expect(plan.blocked).toBe(0)
  })

  it('cuenta apps iguales, desconocidas y protegidas', () => {
    const profile = makeProfile({
      apps: [
        { packageName: 'com.same', label: 'Same', state: 'ENABLED' },
        { packageName: 'com.unknown', label: 'Unknown', state: 'DISABLED' },
        { packageName: 'com.critical', label: 'Critical', state: 'UNINSTALLED' },
      ],
    })

    const plan = planProfile(
      profile,
      { 'com.same': 'ENABLED', 'com.critical': 'ENABLED' },
      (pkg) => pkg === 'com.critical',
    )

    expect(plan.steps).toEqual([])
    expect(plan.same).toBe(1)
    expect(plan.missing).toBe(1)
    expect(plan.blocked).toBe(1)
  })

  it('reinstala antes de deshabilitar una app desinstalada', () => {
    const profile = makeProfile({
      apps: [{ packageName: 'com.example.app', label: 'App', state: 'DISABLED' }],
    })

    const plan = planProfile(profile, { 'com.example.app': 'UNINSTALLED' })

    expect(plan.steps).toEqual([
      { kind: 'REINSTALL', packages: ['com.example.app'] },
      { kind: 'DISABLE', packages: ['com.example.app'] },
    ])
  })

  it('calcula kindsFor para cada transicion', () => {
    expect(kindsFor('ENABLED', 'ENABLED')).toEqual([])
    expect(kindsFor('ENABLED', 'UNINSTALLED')).toEqual(['REINSTALL'])
    expect(kindsFor('ENABLED', 'DISABLED')).toEqual(['ENABLE'])
    expect(kindsFor('DISABLED', 'ENABLED')).toEqual(['DISABLE'])
    expect(kindsFor('DISABLED', 'UNINSTALLED')).toEqual(['REINSTALL', 'DISABLE'])
    expect(kindsFor('UNINSTALLED', 'ENABLED')).toEqual(['UNINSTALL'])
    expect(kindsFor('UNINSTALLED', 'DISABLED')).toEqual(['UNINSTALL'])
  })

  it('reconstruye el undo desde el estado aplicado al anterior', () => {
    const changes: ProfileChange[] = [
      { packageName: 'com.a', from: 'ENABLED', to: 'DISABLED' },
      { packageName: 'com.b', from: 'DISABLED', to: 'UNINSTALLED' },
      { packageName: 'com.critical', from: 'ENABLED', to: 'UNINSTALLED' },
    ]

    expect(undoSteps(changes, (pkg) => pkg === 'com.critical')).toEqual([
      { kind: 'REINSTALL', packages: ['com.b'] },
      { kind: 'ENABLE', packages: ['com.a'] },
      { kind: 'DISABLE', packages: ['com.b'] },
    ])
  })

  it('ordena el snapshot por nombre visible', () => {
    expect(
      snapshotProfile(
        { 'com.z': 'ENABLED', 'com.a': 'DISABLED', 'com.m': 'UNINSTALLED' },
        { 'com.z': 'Zebra', 'com.a': 'alfa' },
      ),
    ).toEqual([
      { packageName: 'com.a', label: 'alfa', state: 'DISABLED' },
      { packageName: 'com.m', label: 'com.m', state: 'UNINSTALLED' },
      { packageName: 'com.z', label: 'Zebra', state: 'ENABLED' },
    ])
  })
})

describe('ProfileStore', () => {
  it('persiste y recarga el documento', () => {
    const file = join(tempDir('profiles-store-'), 'profiles.json')
    const store = new ProfileStore(file)

    store.update(() => ({
      profiles: [makeProfile({ apps: [{ packageName: 'com.a', label: 'A', state: 'ENABLED' }] })],
      runs: [],
    }))

    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      profiles: [{ id: 'perfil-1', name: 'Bateria' }],
    })

    const reloaded = new ProfileStore(file).document()
    expect(reloaded.profiles).toHaveLength(1)
    expect(reloaded.profiles[0]?.apps[0]?.packageName).toBe('com.a')
  })

  it('trata un archivo corrupto como documento vacio', () => {
    const file = join(tempDir('profiles-corrupt-'), 'profiles.json')
    writeFileSync(file, '{ esto no es json', 'utf8')

    expect(new ProfileStore(file).document()).toEqual({ profiles: [], runs: [] })
  })

  it('deja un solo perfil en vigilancia', () => {
    const file = join(tempDir('profiles-watch-'), 'profiles.json')
    const store = new ProfileStore(file)

    store.update(() => ({
      profiles: [
        makeProfile({ id: 'uno', watched: true }),
        makeProfile({ id: 'dos', watched: true }),
        makeProfile({ id: 'tres', watched: false }),
      ],
      runs: [],
    }))

    const watched = store.document().profiles.filter((profile) => profile.watched)
    expect(watched).toHaveLength(1)
  })
})

describe('PackageStateService', () => {
  let runner: PackageRunner

  beforeEach(() => {
    runner = new PackageRunner()
    runner.installed.add('com.example.enabled')
    runner.installed.add('com.example.disabled')
    runner.disabled.add('com.example.disabled')
    runner.unavailable.add('com.example.gone')
  })

  it('reporta habilitadas, deshabilitadas y desinstaladas', async () => {
    const states = await stateService(runner).states()

    expect(states).toEqual({
      'com.example.enabled': 'ENABLED',
      'com.example.disabled': 'DISABLED',
      'com.example.gone': 'UNINSTALLED',
    })
  })

  it('filtra paquetes con espacios y nombres invalidos', async () => {
    runner.unavailable.add('com.raro con espacio')

    const states = await stateService(runner).states()

    expect(states['com.raro con espacio']).toBeUndefined()
  })

  it('ejecuta cada paso y confirma con read-back exacto', async () => {
    const service = stateService(runner)

    await service.execute('REINSTALL', 'com.example.gone')
    expect(runner.installed.has('com.example.gone')).toBe(true)

    await service.execute('ENABLE', 'com.example.disabled')
    expect(runner.disabled.has('com.example.disabled')).toBe(false)

    await service.execute('DISABLE', 'com.example.enabled')
    expect(runner.disabled.has('com.example.enabled')).toBe(true)

    await service.execute('UNINSTALL', 'com.example.enabled')
    expect(runner.installed.has('com.example.enabled')).toBe(false)

    expect(runner.commands).toContain('pm install-existing --user 0 com.example.gone')
    expect(runner.commands).toContain('pm enable --user 0 com.example.disabled')
    expect(runner.commands).toContain('pm disable-user --user 0 com.example.enabled')
    expect(runner.commands).toContain('pm uninstall --user 0 com.example.enabled')
  })

  it('falla cuando el read-back no confirma el cambio', async () => {
    runner.confirm = false
    const service = stateService(runner)

    await expect(service.execute('ENABLE', 'com.example.disabled')).rejects.toThrow(/no confirm/i)
  })

  it('propaga el rechazo del dispositivo', async () => {
    runner.failing.add('com.example.enabled')
    const service = stateService(runner)

    await expect(service.execute('UNINSTALL', 'com.example.enabled')).rejects.toThrow(/Failure/)
  })

  it('nunca toca un paquete protegido', async () => {
    const service = stateService(runner, new Set(['com.example.enabled']))

    await expect(service.execute('DISABLE', 'com.example.enabled')).rejects.toThrow(/crítico/i)
    expect(runner.commands).toHaveLength(0)
  })
})

describe('ProfilesService', () => {
  let runner: PackageRunner
  let dataDir: string
  let service: ProfilesService

  const profile = makeProfile({
    apps: [
      { packageName: 'com.example.enabled', label: 'Enabled', state: 'ENABLED' },
      { packageName: 'com.example.disabled', label: 'Disabled', state: 'DISABLED' },
      { packageName: 'com.example.gone', label: 'Gone', state: 'UNINSTALLED' },
    ],
  })

  beforeEach(() => {
    runner = new PackageRunner()
    runner.installed.add('com.example.enabled')
    runner.installed.add('com.example.disabled')
    runner.installed.add('com.example.gone')
    dataDir = tempDir('profiles-service-')
    const client = new AdbClient({ adbPath: 'adb', serial: 'emulator-5554', runner })
    service = new ProfilesService(client, dataDir, new Set())
  })

  it('guarda, vigila y elimina perfiles', () => {
    const saved = service.save(makeProfile({ watched: true }))
    expect(saved.id).toBe('perfil-1')
    expect(service.document().profiles).toHaveLength(1)

    service.save(makeProfile({ id: 'perfil-2', name: 'Juegos', watched: true }))
    expect(service.document().profiles.filter((item) => item.watched)).toHaveLength(1)

    expect(service.setWatched('perfil-1', true)).toBe(true)
    expect(service.document().profiles.find((item) => item.id === 'perfil-1')?.watched).toBe(true)
    expect(service.document().profiles.find((item) => item.id === 'perfil-2')?.watched).toBe(false)

    expect(service.delete('perfil-1')).toBe(true)
    expect(service.delete('perfil-1')).toBe(false)
    expect(service.document().profiles).toHaveLength(1)
  })

  it('un fallo no detiene el resto y solo registra los cambios confirmados', async () => {
    runner.failing.add('com.example.disabled')
    const progress: ProfileProgress[] = []
    service.onProgress = (event) => progress.push(event)

    const run = await service.apply(profile)

    expect(run.changes).toEqual([
      { packageName: 'com.example.gone', from: 'ENABLED', to: 'UNINSTALLED' },
    ])
    expect(run.failures).toEqual(['com.example.disabled'])
    expect(progress.map((event) => [event.packageName, event.done, event.total])).toEqual([
      ['com.example.disabled', 1, 2],
      ['com.example.gone', 2, 2],
    ])
    expect(runner.disabled.has('com.example.disabled')).toBe(false)
    expect(runner.installed.has('com.example.gone')).toBe(false)
    expect(service.document().runs[0]?.id).toBe(run.id)
    expect(service.document().runs[0]?.appliedAt).toBe(run.appliedAt)
  })

  it('persiste la ejecucion y la ofrece para deshacer', async () => {
    const run = await service.apply(profile)
    expect(run.changes).toHaveLength(2)

    const reloaded = new ProfileStore(join(dataDir, 'profiles.json')).document()
    expect(reloaded.runs).toHaveLength(1)
    expect(reloaded.runs[0]?.changes).toEqual(run.changes)

    const restored = await service.undo(run.changes)

    expect(restored).toBe(2)
    expect(runner.installed.has('com.example.gone')).toBe(true)
    expect(runner.disabled.has('com.example.disabled')).toBe(false)
  })

  it('el undo cuenta solo los paquetes confirmados', async () => {
    runner.failing.add('com.example.disabled')

    const restored = await service.undo([
      { packageName: 'com.example.gone', from: 'ENABLED', to: 'UNINSTALLED' },
      { packageName: 'com.example.disabled', from: 'ENABLED', to: 'DISABLED' },
    ])

    expect(restored).toBe(1)
    expect(runner.installed.has('com.example.gone')).toBe(true)
    expect(runner.disabled.has('com.example.disabled')).toBe(false)
  })

  it('no modifica paquetes criticos al aplicar ni al deshacer', async () => {
    const protectedPackages = new Set(['com.example.disabled'])
    const client = new AdbClient({ adbPath: 'adb', serial: 'emulator-5554', runner })
    const guarded = new ProfilesService(client, dataDir, protectedPackages)

    const run = await guarded.apply(profile)
    expect(run.changes.map((change) => change.packageName)).toEqual(['com.example.gone'])
    expect(guarded.document().runs[0]?.failures ?? []).not.toContain('com.example.disabled')

    const restored = await guarded.undo([
      { packageName: 'com.example.disabled', from: 'ENABLED', to: 'DISABLED' },
    ])
    expect(restored).toBe(0)
    expect(runner.commands.some((command) => command.includes('com.example.disabled'))).toBe(false)
  })
})
