import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { parsePackagePaths } from '../src/main/adb/adb-client'
import type { AdbClient } from '../src/main/adb/adb-client'
import type { CommandResult } from '../src/main/adb/runner'
import {
  AppService,
  loadProtectedPackages,
  parsePackageList,
  toInstalledApps,
} from '../src/main/apps/app-service'
import { Journal } from '../src/main/optimization/journal'
import { findSharedDir } from './fake-runner'

class FakeShell {
  readonly calls: string[] = []
  readonly removed = new Set<string>()
  readonly pulled: Array<{ remote: string; localDir: string }> = []
  uninstallOutput = 'Success'
  apkPaths = [
    '/data/app/~~abc==/com.example.game-xyz==/base.apk',
    '/data/app/~~abc==/com.example.game-xyz==/split_config.arm64_v8a.apk',
  ]

  async packageApkPaths(packageName: string): Promise<string[]> {
    this.calls.push(`pm path ${packageName}`)
    return this.apkPaths
  }

  async pull(remotePaths: string[], localDir: string): Promise<string[]> {
    return remotePaths.map((remote) => {
      this.pulled.push({ remote, localDir })
      const local = join(localDir, remote.split('/').pop() as string)
      writeFileSync(local, 'apk-de-prueba')
      return local
    })
  }

  async shell(command: string): Promise<CommandResult> {
    this.calls.push(command)
    if (command.startsWith('pm uninstall')) {
      const pkg = command.split(/\s+/).pop() as string
      if (/Success/i.test(this.uninstallOutput)) this.removed.add(pkg)
      return { code: 0, stdout: this.uninstallOutput, stderr: '', durationMs: 1, timedOut: false }
    }
    if (command.startsWith('cmd package install-existing')) {
      const pkg = command.split(/\s+/).pop() as string
      this.removed.delete(pkg)
      return { code: 0, stdout: `Package ${pkg} installed for user: 0`, stderr: '', durationMs: 1, timedOut: false }
    }
    return { code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false }
  }

  async shellText(command: string): Promise<string> {
    this.calls.push(command)
    if (command === 'pm list packages -3') {
      return 'package:com.whatsapp\npackage:com.example.game\n'
    }
    if (command.startsWith('pm list packages -s ')) {
      const pkg = command.split(/\s+/).pop() as string
      return ['com.android.systemui', 'com.google.android.youtube.tv'].includes(pkg)
        ? `package:${pkg}\n`
        : ''
    }
    if (command === 'pm list packages -s') {
      return 'package:com.android.systemui\npackage:com.google.android.youtube.tv\n'
    }
    if (command === 'pm list packages -d') {
      return 'package:com.example.game\n'
    }
    if (command === 'pm list packages -u -s') {
      return [
        'package:com.android.systemui',
        'package:com.google.android.youtube.tv',
        'package:com.vendor.bloat',
        '',
      ].join('\n')
    }
    if (command.startsWith('pm list packages --user 0')) {
      const pkg = command.split(/\s+/).pop() as string
      return this.removed.has(pkg) ? '' : `package:${pkg}\n`
    }
    return ''
  }
}

const protectedPackages = new Set(['com.android.systemui', 'com.google.android.gms'])

function setup() {
  const shell = new FakeShell()
  const journal = new Journal(join(mkdtempSync(join(tmpdir(), 'apps-')), 'journal.json'))
  const service = new AppService(shell as unknown as AdbClient, journal, protectedPackages)
  return { shell, journal, service }
}

const DEVICE = { id: '192.168.1.125:45069', model: 'Samsung SM-A356E' }

describe('catalogo de aplicaciones', () => {
  it('parsea pm list packages ignorando ruido', () => {
    expect(parsePackageList('package:com.a\n\n  package:com.b  \nWarning: algo\n')).toEqual([
      'com.a',
      'com.b',
    ])
  })

  it('marca sistema, deshabilitadas y protegidas', () => {
    const apps = toInstalledApps(['com.x'], true, new Set(['com.x']), new Set(['com.x']))
    expect(apps[0]).toEqual({
      packageName: 'com.x',
      system: true,
      disabled: true,
      protected: true,
    })
  })

  it('carga la lista compartida de paquetes protegidos', () => {
    const file = join(findSharedDir(), 'apps', 'protected-packages.json')
    const loaded = loadProtectedPackages(file)
    expect(loaded.has('com.android.systemui')).toBe(true)
    expect(loaded.has('com.google.android.tvlauncher')).toBe(true)
    expect(loaded.size).toBeGreaterThan(10)
  })

  it('parsea pm path ignorando ruido y rutas repetidas', () => {
    const output = [
      'package:/data/app/~~a==/com.x-1==/base.apk',
      'Warning: algo',
      '',
      'package:/data/app/~~a==/com.x-1==/split_config.es.apk',
      'package:/data/app/~~a==/com.x-1==/base.apk',
      'package:',
    ].join('\n')

    expect(parsePackagePaths(output)).toEqual([
      '/data/app/~~a==/com.x-1==/base.apk',
      '/data/app/~~a==/com.x-1==/split_config.es.apk',
    ])
  })
})

describe('AppService', () => {
  let ctx: ReturnType<typeof setup>

  beforeEach(() => {
    ctx = setup()
  })

  it('separa usuario, sistema y ocultas', async () => {
    const list = await ctx.service.list()

    expect(list.user.map((app) => app.packageName)).toEqual(['com.example.game', 'com.whatsapp'])
    expect(list.system.map((app) => app.packageName)).toEqual([
      'com.android.systemui',
      'com.google.android.youtube.tv',
    ])
    expect(list.hidden.map((app) => app.packageName)).toEqual(['com.vendor.bloat'])
    expect(list.user.find((app) => app.packageName === 'com.example.game')?.disabled).toBe(true)
  })

  it('desinstala una app de usuario y lo registra como irreversible', async () => {
    const list = await ctx.service.list()
    const app = list.user.find((item) => item.packageName === 'com.whatsapp')
    if (!app) throw new Error('sin app de prueba')

    await ctx.service.uninstall(app, DEVICE)

    expect(ctx.shell.calls).toContain('pm uninstall com.whatsapp')
    expect(ctx.shell.removed.has('com.whatsapp')).toBe(true)

    const entry = ctx.journal.list().at(0)
    expect(entry?.recipeId).toBe('uninstall:com.whatsapp')
    expect(entry?.steps[0]?.reversible).toBe(false)
    expect(entry?.steps[0]?.undo).toBeNull()
  })

  it('oculta una app de sistema con --user 0 y permite restaurarla', async () => {
    const list = await ctx.service.list()
    const app = list.system.find((item) => item.packageName === 'com.google.android.youtube.tv')
    if (!app) throw new Error('sin app de prueba')

    await ctx.service.uninstall(app, DEVICE)

    expect(ctx.shell.calls).toContain('pm uninstall --user 0 com.google.android.youtube.tv')
    const entry = ctx.journal.list().at(0)
    expect(entry?.steps[0]?.reversible).toBe(true)
    expect(entry?.steps[0]?.undo).toBe('cmd package install-existing com.google.android.youtube.tv')

    await ctx.service.restore({ ...app, hidden: true })
    expect(ctx.shell.removed.has('com.google.android.youtube.tv')).toBe(false)
  })

  it('rechaza paquetes protegidos sin ejecutar comandos', async () => {
    const app = {
      packageName: 'com.android.systemui',
      system: true,
      disabled: false,
      protected: true,
    }

    await expect(ctx.service.uninstall(app, DEVICE)).rejects.toThrow(/protegida/i)
    expect(ctx.shell.calls.some((command) => command.startsWith('pm uninstall'))).toBe(false)
  })

  it('rechaza nombres de paquete con inyeccion sin ejecutar comandos', async () => {
    const app = {
      packageName: 'com.whatsapp; reboot',
      system: false,
      disabled: false,
      protected: false,
    }

    await expect(ctx.service.uninstall(app, DEVICE)).rejects.toThrow(/no es valido/)
    expect(ctx.shell.calls).toHaveLength(0)
  })

  it('no confia en el flag system del renderer', async () => {
    const app = {
      packageName: 'com.google.android.youtube.tv',
      system: false,
      disabled: false,
      protected: false,
    }

    await ctx.service.uninstall(app, DEVICE)

    expect(ctx.shell.calls).toContain('pm uninstall --user 0 com.google.android.youtube.tv')
    expect(ctx.shell.calls).not.toContain('pm uninstall com.google.android.youtube.tv')
  })

  it('falla si el dispositivo no confirma la desinstalacion', async () => {
    const list = await ctx.service.list()
    const app = list.user.find((item) => item.packageName === 'com.whatsapp')
    if (!app) throw new Error('sin app de prueba')

    ctx.shell.uninstallOutput = 'Failure [DELETE_FAILED_INTERNAL_ERROR]'

    await expect(ctx.service.uninstall(app, DEVICE)).rejects.toThrow(/DELETE_FAILED/)
    expect(ctx.journal.list()).toHaveLength(0)
  })

  it('extrae base y splits a una carpeta local sin registrar cambios', async () => {
    const destination = mkdtempSync(join(tmpdir(), 'apk-out-'))

    const result = await ctx.service.extractApks('com.example.game', destination)

    expect(result.directory).toBe(join(destination, 'com.example.game'))
    expect(result.files.map((file) => file.name)).toEqual([
      'base.apk',
      'split_config.arm64_v8a.apk',
    ])
    expect(result.files.every((file) => existsSync(file.path))).toBe(true)
    expect(ctx.shell.pulled).toHaveLength(2)
    expect(ctx.journal.list()).toHaveLength(0)
  })
})
