import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/adb-client'
import type { CommandRunner, CommandResult, RunOptions } from '../src/main/adb/runner'
import { FastbootClient, parseFastbootDevices } from '../src/main/flash/fastboot'
import { FlashService } from '../src/main/flash/flash-service'

const SERIAL = 'ABC123'
const props = [
  '[ro.product.device]: [generic_tv]',
  '[ro.product.model]: [Generic TV]',
  '[ro.product.manufacturer]: [Acme]',
  '[ro.build.version.release]: [13]',
  '[ro.build.version.sdk]: [33]',
  '[ro.build.type]: [userdebug]',
  '[ro.build.tags]: [test-keys]',
  '[ro.debuggable]: [1]',
  '[ro.secure]: [0]',
  '[ro.boot.verifiedbootstate]: [orange]',
  '[ro.boot.flash.locked]: [0]',
  '[ro.boot.slot_suffix]: [_a]',
].join('\n')

class FlashRunner implements CommandRunner {
  readonly calls: Array<{ bin: string; args: string[] }> = []
  booted = true
  pulled = false

  constructor(private readonly downloadDir?: string) {}

  async run(bin: string, args: string[], _options?: RunOptions): Promise<CommandResult> {
    this.calls.push({ bin, args })
    const command = args.at(-1) ?? ''
    const stdout = bin.endsWith('fastboot') ? this.fastboot(args) : this.adb(args, command)
    return { code: 0, stdout, stderr: '', durationMs: 1, timedOut: false }
  }

  private fastboot(args: string[]): string {
    if (args.includes('--version')) return 'fastboot version 35.0.1'
    if (args.includes('devices')) return `${SERIAL}\tfastboot`
    if (args.includes('reboot')) return ''
    if (args.includes('flash')) return 'Sending sparse image... OKAY'
    return ''
  }

  private adb(args: string[], command: string): string {
    if (args.includes('pull')) {
      const remote = args[args.indexOf('pull') + 1] ?? ''
      const localDir = args.at(-1) ?? ''
      if (this.downloadDir) {
        writeFileSync(join(localDir, basename(remote)), Buffer.alloc(4096, 1))
        this.pulled = true
      }
      return '1 file pulled'
    }
    if (args.includes('install')) return 'Success'
    if (command === 'getprop') return props
    if (command === 'getprop sys.boot_completed') return this.booted ? '1' : ''
    if (command === 'id -u') return '0'
    if (command === 'which su || echo no-su') return 'no-su'
    if (command === "mount | grep ' /system '") return '/dev/block/sda1 on /system type ext4 (rw,seclabel)'
    if (command === 'getprop ro.boot.slot_suffix') return '_a'
    if (command === "ls -l '/sdcard/Download' 2>/dev/null") {
      return [
        '-rw-rw---- 1 u0_a10 sdcard_rw 104857600 2026-01-01 12:00 magisk_patched-27000.img',
        '-rw-rw---- 1 u0_a10 sdcard_rw 83886080 2026-01-01 12:01 stock-boot.img',
        '-rw-rw---- 1 u0_a10 sdcard_rw 1234 2026-01-01 12:02 notes.txt',
      ].join('\n')
    }
    if (command === "ls '/dev/block/by-name' 2>/dev/null | head -n 1") return 'boot'
    if (command === "ls '/dev/block/by-name' 2>/dev/null") return 'boot\ninit_boot\nvbmeta\n'
    if (command === 'pm path com.topjohnwu.magisk') return 'package:/data/app/com.topjohnwu.magisk/base.apk'
    if (command.includes('dumpsys package com.topjohnwu.magisk')) return 'versionName=27.0'
    if (command === 'reboot bootloader') return ''
    if (command === 'reboot') return ''
    if (command === 'magisk -v 2>/dev/null || /data/adb/magisk/magisk -v 2>/dev/null') return '27.0:MAGISK'
    if (command.startsWith('dd if=')) {
      if (this.downloadDir) {
        const match = command.match(/of='([^']+)'/)
        if (match) writeFileSync(join(this.downloadDir, basename(match[1]!)), Buffer.alloc(4096, 1))
      }
      return '1+0 records in'
    }
    if (command.startsWith('rm -f ')) return ''
    return ''
  }
}

function createClient(runner: CommandRunner): AdbClient {
  return new AdbClient({ adbPath: 'adb', runner, serial: SERIAL })
}

function createImage(directory: string, name: string, magic: string): string {
  const path = join(directory, name)
  const buffer = Buffer.alloc(4096, 0)
  buffer.write(magic, 0, 'latin1')
  writeFileSync(path, buffer)
  return path
}

describe('FastbootClient', () => {
  it('parsea dispositivos fastboot', () => {
    expect(parseFastbootDevices('ABC\tfastboot\nXYZ\tfastboot\n')).toEqual([
      { serial: 'ABC', state: 'fastboot' },
      { serial: 'XYZ', state: 'fastboot' },
    ])
  })

  it('arma el flasheo con slot y verity', async () => {
    const runner = new FlashRunner()
    const fastboot = new FastbootClient('fastboot', runner)

    await fastboot.flash({ serial: 'ABC', partition: 'boot', imagePath: '/tmp/boot.img', slot: 'a' })
    await fastboot.flash({ serial: 'ABC', partition: 'boot', imagePath: '/tmp/boot.img', slot: 'all' })
    await fastboot.flash({ serial: 'ABC', partition: 'vbmeta', imagePath: '/tmp/vbmeta.img', disableVerity: true })

    const flashes = runner.calls.filter((call) => call.args.includes('flash'))
    expect(flashes[0]?.args).toEqual(['-s', 'ABC', 'flash', 'boot_a', '/tmp/boot.img'])
    expect(flashes[1]?.args).toEqual(['-s', 'ABC', '--slot', 'all', 'flash', 'boot', '/tmp/boot.img'])
    expect(flashes[2]?.args).toEqual([
      '-s', 'ABC', '--disable-verity', '--disable-verification', 'flash', 'vbmeta', '/tmp/vbmeta.img',
    ])
  })
})

describe('FlashService', () => {
  it('diagnostica init_boot, fastboot y las imágenes de Download', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'flash-'))
    try {
      const runner = new FlashRunner(directory)
      const service = new FlashService(createClient(runner), {
        dataDir: directory,
        fastbootPath: 'fastboot',
        runner,
      })

      const diagnostics = await service.diagnostics()
      expect(diagnostics.bootPartition).toBe('init_boot')
      expect(diagnostics.slotSuffix).toBe('_a')
      expect(diagnostics.fastbootAvailable).toBe(true)
      expect(diagnostics.usb).toBe(true)
      expect(diagnostics.magiskApp).toBe(true)
      expect(diagnostics.magiskAppVersion).toBe('27.0')
      expect(diagnostics.images.map((image) => image.name)).toEqual([
        'magisk_patched-27000.img',
        'stock-boot.img',
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('respalda boot y lo devuelve al host', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'flash-'))
    try {
      const runner = new FlashRunner(directory)
      const service = new FlashService(createClient(runner), {
        dataDir: directory,
        fastbootPath: 'fastboot',
        runner,
      })

      const backup = await service.backupPartition('boot')
      expect(backup.path).toContain(join(directory, 'backups'))
      expect(backup.path.endsWith('.img')).toBe(true)
      expect(backup.size).toBe(4096)
      expect(runner.calls.some((call) => call.args.at(-1)?.startsWith('dd if='))).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('reinicia al bootloader, flashea y verifica Magisk', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'flash-'))
    try {
      const runner = new FlashRunner()
      const client = createClient(runner)
      const service = new FlashService(client, { dataDir: directory, fastbootPath: 'fastboot', runner })
      const image = createImage(directory, 'magisk_patched.img', 'ANDROID!')

      const result = await service.flashImage({
        imagePath: image,
        partition: 'init_boot',
        slot: 'a',
        disableVerity: false,
        confirmDevice: 'generic_tv',
      })

      expect(result.partition).toBe('init_boot')
      expect(result.magiskVersion).toContain('27.0')
      const commands = runner.calls.map((call) => call.args.join(' '))
      const reboot = commands.findIndex((command) => command.endsWith('reboot bootloader'))
      const flash = commands.findIndex((command) => command.includes('flash init_boot_a'))
      expect(reboot).toBeGreaterThan(-1)
      expect(flash).toBeGreaterThan(reboot)
      expect(commands.some((command) => command.endsWith(' reboot'))).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rechaza una imagen con cabecera incorrecta antes de reiniciar', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'flash-'))
    try {
      const runner = new FlashRunner()
      const service = new FlashService(createClient(runner), {
        dataDir: directory,
        fastbootPath: 'fastboot',
        runner,
      })
      const image = createImage(directory, 'vendor.img', 'VNDRBOOT')

      await expect(service.flashImage({
        imagePath: image,
        partition: 'boot',
        slot: 'none',
        disableVerity: false,
        confirmDevice: 'generic_tv',
      })).rejects.toThrow('no parece un boot válido')
      expect(runner.calls.some((call) => call.args.at(-1) === 'reboot bootloader')).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('exige confirmar el nombre del dispositivo', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'flash-'))
    try {
      const runner = new FlashRunner()
      const service = new FlashService(createClient(runner), {
        dataDir: directory,
        fastbootPath: 'fastboot',
        runner,
      })
      const image = createImage(directory, 'patched.img', 'ANDROID!')

      await expect(service.flashImage({
        imagePath: image,
        partition: 'boot',
        slot: 'none',
        disableVerity: false,
        confirmDevice: 'otro',
      })).rejects.toThrow('escribe el nombre del dispositivo')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
