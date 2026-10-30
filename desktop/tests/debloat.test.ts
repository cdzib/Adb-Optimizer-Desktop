import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdbClient } from '../src/main/adb/adb-client'
import type { CommandResult, CommandRunner } from '../src/main/adb/runner'
import {
  CATALOG_URL,
  DebloatCatalog,
  parseDebloatCatalog,
} from '../src/main/debloat/debloat-catalog'
import { DebloatJournal } from '../src/main/debloat/debloat-journal'
import { DebloatService } from '../src/main/debloat/debloat-service'
import type { DebloatEntry } from '../src/shared/types'

function ok(stdout = ''): CommandResult {
  return { code: 0, stdout, stderr: '', durationMs: 1, timedOut: false }
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function lines(packages: Set<string>): string {
  return [...packages].map((pkg) => `package:${pkg}`).join('\n')
}

function enabled(installed: Set<string>, disabled: Set<string>): Set<string> {
  return new Set([...installed].filter((pkg) => !disabled.has(pkg)))
}

/** Transporte ADB local que emula `pm list packages` y los comandos de estado. */
class DebloatRunner implements CommandRunner {
  readonly installed = new Set<string>()
  readonly disabled = new Set<string>()
  readonly unavailable = new Set<string>()
  readonly failing = new Set<string>()
  readonly commands: string[] = []

  async run(_bin: string, args: string[]): Promise<CommandResult> {
    const command = args[args.length - 1] ?? ''
    this.commands.push(command)

    const modifier =
      /^pm (install-existing --user 0|enable --user 0|disable-user --user 0|uninstall --user 0) (\S+)$/.exec(
        command,
      )
    if (modifier) {
      const kind = modifier[1] ?? ''
      const pkg = modifier[2] ?? ''
      if (this.failing.has(pkg)) {
        return { code: 1, stdout: `Failure [CHANGE_FAILED: ${pkg}]`, stderr: '', durationMs: 1, timedOut: false }
      }
      this.change(kind, pkg)
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

function makeCatalog(): string {
  return JSON.stringify({
    'com.example.recommended': {
      list: 'OEM',
      removal: 'Recommended',
      description: '  Se puede quitar sin riesgo.  ',
    },
    'com.example.advanced': { list: 'AOSP', removal: 'advanced', description: 'Avanzado.' },
    'com.example.expert': { list: 'Google', removal: 'expert', description: 'Experto.' },
    'com.example.unsafe': { list: 'OEM', removal: 'unsafe', description: 'Nunca.' },
    'com.example.unknown': { list: 'OEM', removal: 'weird', description: 'Desconocido.' },
    'com.example.empty': { list: 'OEM', removal: '', description: 'Vacio.' },
    'com.example.malformed': 'texto',
  })
}

function stateService(runner: DebloatRunner, dataDir: string, protectedPackages = new Set<string>()) {
  const client = new AdbClient({ adbPath: 'adb', serial: 'emulator-5554', runner })
  return new DebloatService(client, dataDir, protectedPackages)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseDebloatCatalog', () => {
  it('conserva recommended, advanced y expert y descarta unsafe/desconocidos/vacios', () => {
    const entries = parseDebloatCatalog(makeCatalog())

    expect(entries).toEqual<DebloatEntry[]>([
      {
        packageName: 'com.example.advanced',
        source: 'AOSP',
        risk: 'advanced',
        description: 'Avanzado.',
      },
      {
        packageName: 'com.example.expert',
        source: 'Google',
        risk: 'expert',
        description: 'Experto.',
      },
      {
        packageName: 'com.example.recommended',
        source: 'OEM',
        risk: 'recommended',
        description: 'Se puede quitar sin riesgo.',
      },
    ])
  })

  it('rechaza una raiz que no sea un objeto', () => {
    expect(() => parseDebloatCatalog('[]')).toThrow(/formato/)
    expect(() => parseDebloatCatalog('null')).toThrow(/formato/)
    expect(() => parseDebloatCatalog('{ roto')).toThrow()
  })
})

describe('DebloatCatalog', () => {
  it('expone la URL oficial de UAD-NG', () => {
    expect(CATALOG_URL).toContain('universal-android-debloater-next-generation')
    expect(CATALOG_URL.endsWith('uad_lists.json')).toBe(true)
  })

  it('lee un archivo valido y su fecha de actualizacion', () => {
    const file = join(tempDir('debloat-catalog-'), 'catalog.json')
    writeFileSync(file, makeCatalog(), 'utf8')
    const catalog = new DebloatCatalog(file)

    expect(catalog.cached()).toHaveLength(3)
    expect(catalog.updatedAt()).toBeGreaterThan(0)
  })

  it('trata un archivo corrupto o inexistente como sin cache', () => {
    const directory = tempDir('debloat-catalog-corrupt-')
    const file = join(directory, 'catalog.json')

    expect(new DebloatCatalog(file).cached()).toBeNull()
    expect(new DebloatCatalog(file).updatedAt()).toBeNull()

    writeFileSync(file, '{ esto no es json', 'utf8')
    expect(new DebloatCatalog(file).cached()).toBeNull()
  })

  it('descarga, parsea y guarda el texto crudo de forma atomica', async () => {
    const directory = tempDir('debloat-download-')
    const file = join(directory, 'catalog.json')
    const raw = makeCatalog()
    const progress: number[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        body: null,
        headers: new Headers(),
        text: async () => raw,
      })),
    )

    const entries = await new DebloatCatalog(file).download((percent) => progress.push(percent))

    expect(entries).toHaveLength(3)
    expect(readFileSync(file, 'utf8')).toBe(raw)
    expect(readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([])
    expect(progress.at(-1)).toBe(100)
  })

  it('falla cuando el servidor no responde 2xx', async () => {
    const file = join(tempDir('debloat-download-bad-'), 'catalog.json')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        body: null,
        headers: new Headers(),
        text: async () => '',
      })),
    )

    await expect(new DebloatCatalog(file).download()).rejects.toThrow(/503/)
  })

  it('rechaza una lista descargada sin paquetes validos', async () => {
    const directory = tempDir('debloat-download-empty-')
    const file = join(directory, 'catalog.json')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        body: null,
        headers: new Headers(),
        text: async () => JSON.stringify({ 'com.example.unsafe': { removal: 'unsafe' } }),
      })),
    )

    await expect(new DebloatCatalog(file).download()).rejects.toThrow(/paquetes validos/)
    expect(() => readFileSync(file, 'utf8')).toThrow()
  })
})

describe('DebloatJournal', () => {
  it('persiste, ordena y olvida paquetes', () => {
    const file = join(tempDir('debloat-journal-'), 'debloat-uninstalled.json')
    const journal = new DebloatJournal(file)

    journal.record('com.b.app')
    journal.record('com.a.app')
    journal.record('com.a.app')

    expect(journal.uninstalled()).toEqual(['com.a.app', 'com.b.app'])
    expect(new DebloatJournal(file).uninstalled()).toEqual(['com.a.app', 'com.b.app'])

    journal.forget('com.a.app')
    expect(new DebloatJournal(file).uninstalled()).toEqual(['com.b.app'])
  })

  it('trata un archivo corrupto como bitacora vacia', () => {
    const file = join(tempDir('debloat-journal-corrupt-'), 'debloat-uninstalled.json')
    writeFileSync(file, '{ no es json', 'utf8')

    expect(new DebloatJournal(file).uninstalled()).toEqual([])
  })
})

describe('DebloatService', () => {
  let runner: DebloatRunner
  let dataDir: string
  let service: DebloatService
  let journalFile: string

  beforeEach(() => {
    runner = new DebloatRunner()
    runner.installed.add('com.example.enabled')
    runner.installed.add('com.example.disabled')
    runner.disabled.add('com.example.disabled')
    runner.installed.add('com.example.other')
    dataDir = tempDir('debloat-service-')
    journalFile = join(dataDir, 'debloat-uninstalled.json')
    service = stateService(runner, dataDir)
  })

  it('mapea cada accion a su paso y estado destino', async () => {
    const frozen = await service.apply('FREEZE', ['com.example.enabled'])
    expect(frozen).toEqual({
      action: 'FREEZE',
      changes: [{ packageName: 'com.example.enabled', from: 'ENABLED', to: 'DISABLED' }],
      failures: [],
    })
    expect(runner.disabled.has('com.example.enabled')).toBe(true)

    const unfrozen = await service.apply('UNFREEZE', ['com.example.disabled'])
    expect(unfrozen.changes).toEqual([
      { packageName: 'com.example.disabled', from: 'DISABLED', to: 'ENABLED' },
    ])
    expect(runner.disabled.has('com.example.disabled')).toBe(false)

    const removed = await service.apply('UNINSTALL', ['com.example.other'])
    expect(removed.changes).toEqual([
      { packageName: 'com.example.other', from: 'ENABLED', to: 'UNINSTALLED' },
    ])
    expect(new DebloatJournal(journalFile).uninstalled()).toEqual(['com.example.other'])

    expect(runner.commands).toContain('pm disable-user --user 0 com.example.enabled')
    expect(runner.commands).toContain('pm enable --user 0 com.example.disabled')
    expect(runner.commands).toContain('pm uninstall --user 0 com.example.other')
  })

  it('un fallo se anota y no detiene el resto', async () => {
    runner.failing.add('com.example.disabled')

    const run = await service.apply('FREEZE', ['com.example.disabled', 'com.example.enabled'])

    expect(run.failures).toEqual(['com.example.disabled'])
    expect(run.changes).toEqual([
      { packageName: 'com.example.enabled', from: 'ENABLED', to: 'DISABLED' },
    ])
    expect(runner.disabled.has('com.example.enabled')).toBe(true)
  })

  it('rechaza paquetes criticos sin ejecutar comandos', async () => {
    const guarded = stateService(runner, dataDir, new Set(['com.example.enabled']))

    const run = await guarded.apply('FREEZE', ['com.example.enabled'])

    expect(run.changes).toEqual([])
    expect(run.failures).toEqual(['com.example.enabled'])
    expect(runner.commands.some((command) => command.includes('--user 0'))).toBe(false)
  })

  it('valida la accion y la lista de paquetes', async () => {
    await expect(service.apply('BORRAR' as never, ['com.example.enabled'])).rejects.toThrow(
      /accion/,
    )
    await expect(service.apply('FREEZE', 'com.example.enabled' as never)).rejects.toThrow(
      /paquetes/,
    )
    await expect(service.apply('FREEZE', ['raro con espacio'])).rejects.toThrow(/paquete/)
  })

  it('el undo elige ENABLE o REINSTALL y olvida la bitacora', async () => {
    const run = await service.apply('UNINSTALL', ['com.example.other'])
    expect(new DebloatJournal(journalFile).uninstalled()).toEqual(['com.example.other'])

    const restored = await service.undo(run)

    expect(restored).toBe(1)
    expect(runner.installed.has('com.example.other')).toBe(true)
    expect(new DebloatJournal(journalFile).uninstalled()).toEqual([])
    expect(runner.commands).toContain('pm install-existing --user 0 com.example.other')

    runner.commands.length = 0
    const frozen = await service.apply('FREEZE', ['com.example.enabled'])
    expect(await service.undo(frozen)).toBe(1)
    expect(runner.commands).toContain('pm enable --user 0 com.example.enabled')
    expect(runner.disabled.has('com.example.enabled')).toBe(false)
  })

  it('el undo cuenta solo los paquetes confirmados', async () => {
    runner.failing.add('com.example.disabled')

    const restored = await service.undo({
      action: 'FREEZE',
      changes: [
        { packageName: 'com.example.disabled', from: 'ENABLED', to: 'DISABLED' },
        { packageName: 'com.example.enabled', from: 'DISABLED', to: 'ENABLED' },
      ],
      failures: [],
    })

    expect(restored).toBe(1)
  })

  it('restore habilita lo congelado, reinstala lo desinstalado y omite lo activo', async () => {
    runner.installed.delete('com.example.other')
    runner.unavailable.add('com.example.other')
    new DebloatJournal(journalFile).record('com.example.other')

    const run = await service.restore([
      'com.example.disabled',
      'com.example.other',
      'com.example.enabled',
    ])

    expect(run.action).toBe('RESTORE')
    expect(run.failures).toEqual([])
    expect(run.changes).toEqual([
      { packageName: 'com.example.disabled', from: 'DISABLED', to: 'ENABLED' },
      { packageName: 'com.example.other', from: 'UNINSTALLED', to: 'ENABLED' },
    ])
    expect(runner.disabled.has('com.example.disabled')).toBe(false)
    expect(runner.installed.has('com.example.other')).toBe(true)
    expect(new DebloatJournal(journalFile).uninstalled()).toEqual([])
    expect(runner.commands).toContain('pm enable --user 0 com.example.disabled')
    expect(runner.commands).toContain('pm install-existing --user 0 com.example.other')
  })

  it('lista solo paquetes instalados o congelados, ordenados por riesgo y nombre', async () => {
    writeFileSync(join(dataDir, 'debloat-catalog.json'), makeCatalog(), 'utf8')
    runner.unavailable.add('com.example.recommended')
    runner.installed.add('com.example.expert')
    runner.installed.add('com.example.advanced')
    runner.disabled.add('com.example.advanced')

    const suggestions = await service.suggestions()

    expect(suggestions.map((item) => [item.packageName, item.risk, item.state])).toEqual([
      ['com.example.advanced', 'advanced', 'DISABLED'],
      ['com.example.expert', 'expert', 'ENABLED'],
    ])
  })

  it('ofrece para restaurar las congeladas y las desinstaladas por el debloater', async () => {
    runner.installed.delete('com.example.other')
    runner.unavailable.add('com.example.other')
    new DebloatJournal(journalFile).record('com.example.other')
    new DebloatJournal(journalFile).record('com.example.ignored')

    const items = await service.restorable()

    expect(items).toEqual([
      { packageName: 'com.example.disabled', label: 'com.example.disabled', state: 'DISABLED' },
      { packageName: 'com.example.other', label: 'com.example.other', state: 'UNINSTALLED' },
    ])
  })

  it('catalog e download devuelven el estado descargado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        body: null,
        headers: new Headers(),
        text: async () => makeCatalog(),
      })),
    )

    const before = await service.catalog()
    expect(before.entries).toEqual([])
    expect(before.updatedAt).toBeNull()

    const after = await service.download()
    expect(after.entries).toHaveLength(3)
    expect(after.updatedAt).toBeGreaterThan(0)
  })
})
