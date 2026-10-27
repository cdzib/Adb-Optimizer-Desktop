import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/adb-client'
import type { CommandRunner, CommandResult } from '../src/main/adb/runner'
import { loadCatalog } from '../src/main/optimization/catalog'
import { Journal } from '../src/main/optimization/journal'
import { SystemAppService } from '../src/main/optimization/system-app'
import { SystemLauncherService } from '../src/main/optimization/system-launcher'
import type { DeviceInfo } from '../src/shared/types'
import { findSharedDir } from './fake-runner'

const device: DeviceInfo = {
  id: '192.0.2.12:5555', model: 'Generic TV', manufacturer: 'Acme', sdk: 30,
  androidVersion: '11', isTv: true, hasRoot: false, abi: 'arm64-v8a',
}

const LAUNCHER_APK = '/host/launcher.apk'
const LAUNCHER_PACKAGE = 'com.example.launcher'
const LAUNCHER_TARGET = `/system/priv-app/${LAUNCHER_PACKAGE}/launcher.apk`
const SYSTEM_APP_TARGET = '/system/priv-app/com.example.app'
const QUERY = 'cmd package query-activities --brief --components --user 0 -a android.intent.action.MAIN -c android.intent.category.HOME'
const RESOLVE = 'cmd package resolve-activity --brief --user 0 -a android.intent.action.MAIN -c android.intent.category.HOME'

const props = [
  '[ro.product.device]: [generic_tv]',
  '[ro.product.model]: [Generic TV]',
  '[ro.product.manufacturer]: [Acme]',
  '[ro.build.version.release]: [11]',
  '[ro.build.version.sdk]: [30]',
  '[ro.build.type]: [userdebug]',
  '[ro.build.tags]: [test-keys]',
  '[ro.debuggable]: [1]',
  '[ro.secure]: [0]',
  '[ro.boot.verifiedbootstate]: [orange]',
  '[ro.boot.flash.locked]: [0]',
  '[ro.boot.dynamic_partitions]: [true]',
  '[ro.build.system_root_image]: [true]',
].join('\n')

/** Dispositivo genérico (no Wanbo) con adb root y /system escribible. */
class GenericRunner implements CommandRunner {
  readonly history: string[] = []
  rebooted = false
  homeSelected = false
  homeDisabled = false
  systemPackageScanned = true
  systemAppScanned = true
  packageName = LAUNCHER_PACKAGE

  async run(_bin: string, args: string[]): Promise<CommandResult> {
    const command = args.at(-1) ?? ''
    this.history.push(command)
    return { code: 0, stdout: this.output(args, command), stderr: '', durationMs: 1, timedOut: false }
  }

  private output(args: string[], command: string): string {
    if (args.includes('root')) return 'restarting adbd as root'
    if (args.includes('disable-verity')) return 'Verity disabled on /system'
    if (args.includes('remount')) return 'remount succeeded'
    if (args.includes('push')) return '1 file pushed'
    if (args.includes('pull')) return '1 file pulled'
    if (command === 'reboot') {
      this.rebooted = true
      return ''
    }

    if (command === 'getprop') return props
    if (command === 'getprop sys.boot_completed') return this.rebooted ? '1' : ''
    if (command === 'id -u') return '0'
    if (command === 'which su || echo no-su') return 'no-su'
    if (command === "mount | grep ' /system '") return '/dev/block/sda1 on /system type ext4 (rw,seclabel)'
    if (command === 'ls -lZ ' + `'${LAUNCHER_TARGET}'`) return launcherContext()
    if (command === `ls -lZ '${SYSTEM_APP_TARGET}/base.apk'`) return appContext()

    if (command === `pm path ${this.packageName}`) {
      const user = `package:/data/app/~~x/${this.packageName}-1/base.apk`
      if (!this.rebooted) return user
      if (this.packageName === LAUNCHER_PACKAGE) {
        return this.systemPackageScanned ? `${user}\npackage:${LAUNCHER_TARGET}` : user
      }
      return this.systemAppScanned ? `${user}\npackage:${SYSTEM_APP_TARGET}/base.apk` : user
    }
    if (command === 'pm path com.example.app') {
      const user = 'package:/data/app/~~y/com.example.app-1/base.apk'
      return this.rebooted && this.systemAppScanned ? `${user}\npackage:${SYSTEM_APP_TARGET}/base.apk` : user
    }
    if (command === QUERY) return `${this.packageName}/.HomeActivity\ncom.google.android.tvlauncher/.MainActivity`
    if (command === RESOLVE) {
      return this.homeSelected ? `${this.packageName}/.HomeActivity` : 'com.google.android.tvlauncher/.MainActivity'
    }
    if (command.startsWith('cmd package set-home-activity')) {
      this.homeSelected = true
      return ''
    }
    if (command === 'pm list packages -e com.google.android.tvlauncher') {
      return this.homeDisabled ? '' : 'package:com.google.android.tvlauncher'
    }
    if (command.startsWith('pm disable-user')) {
      this.homeDisabled = true
      return ''
    }
    if (command === 'pm list packages -d com.google.android.tvlauncher') {
      return this.homeDisabled ? 'package:com.google.android.tvlauncher' : ''
    }
    if (command === 'pm list packages -3 com.example.app') return 'package:com.example.app'
    if (command === 'pm list packages -3 -f') {
      return 'package:/data/app/~~y/com.example.app-1/base.apk=com.example.app'
    }
    if (command.includes("touch '/system")) return 'ADBOPT_RW'
    if (command.startsWith('mount -o rw,remount')) return 'ADBOPT_MOUNT'
    if (command.startsWith('mkdir -p ') || command.startsWith('rm -rf ')) return ''
    return ''
  }
}

function launcherContext(): string {
  return `-rw-r--r-- 1 root root 1024 2026-01-01 00:00 ${LAUNCHER_TARGET} u:object_r:system_file:s0`
}

function appContext(): string {
  return `-rw-r--r-- 1 root root 2048 2026-01-01 00:00 ${SYSTEM_APP_TARGET}/base.apk u:object_r:system_file:s0`
}

function createClient(runner: CommandRunner): AdbClient {
  return new AdbClient({ adbPath: 'adb', runner, serial: device.id })
}

describe('SystemLauncherService (cualquier dispositivo con /system)', () => {
  it('instala, asigna Home y deshabilita el Home anterior en un equipo que no es Wanbo', async () => {
    const runner = new GenericRunner()
    const directory = mkdtempSync(join(tmpdir(), 'sys-launcher-'))
    try {
      const apk = join(directory, 'launcher.apk')
      writeFileSync(apk, 'test')
      const client = createClient(runner)
      const journal = new Journal(join(directory, 'journal.json'))
      const recipe = loadCatalog(findSharedDir()).catalog.recipes.find((item) => item.id === 'wanboos-launcher')
      if (!recipe) throw new Error('system launcher recipe missing')
      const service = new SystemLauncherService(client, journal, recipe)

      const entry = await service.install({
        apkPath: apk,
        packageName: LAUNCHER_PACKAGE,
        privileged: true,
        device,
      })

      expect(runner.homeSelected).toBe(true)
      expect(runner.homeDisabled).toBe(true)
      expect(entry.steps[0]?.systemApk?.targetPath).toBe(LAUNCHER_TARGET)
      expect(entry.steps[0]?.systemApk?.disablePackages).toContain('com.google.android.tvlauncher')

      const setHome = runner.history.findIndex((command) => command.startsWith('cmd package set-home-activity'))
      const disable = runner.history.findIndex((command) => command.startsWith('pm disable-user'))
      expect(setHome).toBeGreaterThan(-1)
      expect(disable).toBeGreaterThan(setHome)
      expect(runner.history.filter((command) => command === 'reboot')).toHaveLength(1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('no toca el Home si el APK no fue escaneado tras reiniciar', async () => {
    const runner = new GenericRunner()
    runner.systemPackageScanned = false
    const directory = mkdtempSync(join(tmpdir(), 'sys-launcher-'))
    try {
      const apk = join(directory, 'launcher.apk')
      writeFileSync(apk, 'test')
      const client = createClient(runner)
      const journal = new Journal(join(directory, 'journal.json'))
      const recipe = loadCatalog(findSharedDir()).catalog.recipes.find((item) => item.id === 'wanboos-launcher')
      if (!recipe) throw new Error('system launcher recipe missing')
      const service = new SystemLauncherService(client, journal, recipe)

      await expect(service.install({
        apkPath: apk,
        packageName: LAUNCHER_PACKAGE,
        privileged: true,
        device,
      })).rejects.toThrow('no fue escaneado')
      expect(runner.homeDisabled).toBe(false)
      expect(runner.history.some((command) => command.startsWith('pm disable-user'))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('aborta sin escribir cuando no hay adb root ni su', async () => {
    const runner = new NoRootRunner()
    const directory = mkdtempSync(join(tmpdir(), 'sys-launcher-'))
    try {
      const apk = join(directory, 'launcher.apk')
      writeFileSync(apk, 'test')
      const client = createClient(runner)
      const journal = new Journal(join(directory, 'journal.json'))
      const recipe = loadCatalog(findSharedDir()).catalog.recipes.find((item) => item.id === 'wanboos-launcher')
      if (!recipe) throw new Error('system launcher recipe missing')
      const service = new SystemLauncherService(client, journal, recipe)

      await expect(service.install({
        apkPath: apk,
        packageName: LAUNCHER_PACKAGE,
        privileged: true,
        device,
      })).rejects.toThrow('no permite escribir en /system')
      expect(runner.history.some((command) => ['remount', 'push'].includes(command))).toBe(false)
      expect(journal.list()).toHaveLength(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

class NoRootRunner implements CommandRunner {
  readonly history: string[] = []

  async run(_bin: string, args: string[]): Promise<CommandResult> {
    const command = args.at(-1) ?? ''
    this.history.push(command)
    let stdout = ''
    if (command === 'getprop') {
      stdout = props.replace('[ro.debuggable]: [1]', '[ro.debuggable]: [0]').replace('[ro.boot.flash.locked]: [0]', '[ro.boot.flash.locked]: [1]')
    } else if (command === 'id -u') {
      stdout = '2000'
    } else if (command === 'which su || echo no-su') {
      stdout = 'no-su'
    }
    return { code: 0, stdout, stderr: '', durationMs: 1, timedOut: false }
  }
}

describe('SystemAppService', () => {
  it('convierte una app de usuario en app de sistema y deja rollback', async () => {
    const runner = new GenericRunner()
    const directory = mkdtempSync(join(tmpdir(), 'sys-app-'))
    try {
      const client = createClient(runner)
      const journal = new Journal(join(directory, 'journal.json'))
      const service = new SystemAppService(client, journal)

      const candidates = await service.candidates()
      expect(candidates.map((item) => item.packageName)).toEqual(['com.example.app'])

      const entry = await service.convert({ packageName: 'com.example.app', privileged: true, device })

      expect(entry.steps[0]?.systemApp).toMatchObject({
        packageName: 'com.example.app',
        targetDir: SYSTEM_APP_TARGET,
        files: [`${SYSTEM_APP_TARGET}/base.apk`],
        hadPrevious: false,
      })
      expect(runner.history).toContain(`mkdir -p '${SYSTEM_APP_TARGET}'`)
      expect(runner.history.some((command) => command === 'reboot')).toBe(true)

      await client.restoreSystemBundle(entry.steps[0]!.systemApp!)
      expect(runner.history).toContain(`rm -rf '${SYSTEM_APP_TARGET}' && rm -rf '/data/local/tmp/adb-optimizer-apps/com.example.app'`)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rechaza paquetes que ya viven en /system', async () => {
    const runner = new GenericRunner()
    const directory = mkdtempSync(join(tmpdir(), 'sys-app-'))
    try {
      const client = createClient(runner)
      const journal = new Journal(join(directory, 'journal.json'))
      const service = new SystemAppService(client, journal)

      await expect(service.convert({ packageName: 'com.example.system', privileged: true, device }))
        .rejects.toThrow('no es una app de usuario')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
