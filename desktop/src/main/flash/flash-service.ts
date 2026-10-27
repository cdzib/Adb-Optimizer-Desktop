import { closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { FlashDiagnostics, FlashImage, FlashResult } from '../../shared/types'
import { AdbClient, detectTransport } from '../adb/adb-client'
import type { CommandRunner } from '../adb/runner'
import { assertLabAllowed } from '../lab'
import { FastbootClient } from './fastboot'

const MAGISK_PACKAGE = 'com.topjohnwu.magisk'
const DOWNLOAD_DIR = '/sdcard/Download'
const BOOT_PARTITION = /^(boot|init_boot|vendor_boot|recovery|vbmeta)(_[ab])?$/
const FLASH_PARTITION = /^(boot|init_boot|vendor_boot|recovery|vbmeta)$/
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/

export interface FlashServiceOptions {
  dataDir: string
  fastbootPath: string
  runner: CommandRunner
}

/**
 * Respaldo de particiones de arranque, preparación de Magisk y flasheo por
 * fastboot. El parcheo del boot.img lo hace la app oficial de Magisk en el
 * dispositivo: Magisk no publica un parcheador headless para PC.
 */
export class FlashService {
  private readonly fastboot: FastbootClient

  constructor(
    private readonly client: AdbClient,
    private readonly options: FlashServiceOptions,
  ) {
    this.fastboot = new FastbootClient(options.fastbootPath, options.runner)
  }

  async diagnostics(): Promise<FlashDiagnostics> {
    const access = await this.client.probeSystemAccess()
    const partitionDir = await this.detectPartitionDir()
    const partitions = await this.listPartitions(partitionDir)
    const [slotSuffix, magiskPath, fastbootVersion, images] = await Promise.all([
      this.client.shellText('getprop ro.boot.slot_suffix', 8_000).catch(() => ''),
      this.client.shellText(`pm path ${MAGISK_PACKAGE}`, 10_000).catch(() => ''),
      this.fastboot.version().catch(() => null),
      this.listImages(),
    ])
    const magiskApp = magiskPath.includes('package:')
    const magiskAppVersion = magiskApp ? await this.magiskAppVersion() : null
    const bootPartition = access.sdk >= 33 && partitions.includes('init_boot')
      ? 'init_boot'
      : partitions.includes('boot')
        ? 'boot'
        : partitions.find((name) => name.startsWith('boot')) ?? 'boot'
    const slottedBootPartition = `${bootPartition}${slotSuffix.trim()}`
    const activeBootPartition = partitions.includes(slottedBootPartition) ? slottedBootPartition : bootPartition
    const usb = this.client.deviceSerial ? detectTransport(this.client.deviceSerial) !== 'network' : false
    const reasons: string[] = []

    if (!usb) reasons.push('El flasheo necesita USB. Reconecta el dispositivo por cable; fastboot no funciona sobre Wi-Fi.')
    if (!fastbootVersion) reasons.push('`fastboot` no está disponible en el PATH ni junto a `adb`.')
    if (access.bootloaderLocked) reasons.push('Bootloader bloqueado: el flasheo será rechazado hasta desbloquearlo.')
    if (access.sdk >= 33) reasons.push('Android 13+ puede usar `init_boot` en lugar de `boot` para Magisk.')
    if (!access.adbRootSupported && !access.suAvailable) reasons.push('Sin root no se puede respaldar el boot.img desde el dispositivo; consigue la imagen stock del firmware.')
    if (!magiskApp) reasons.push('La app de Magisk no está instalada; instálala para parchear el boot.img.')
    if (images.length === 0) reasons.push(`No hay imágenes .img en ${DOWNLOAD_DIR}.`)

    return {
      device: access.device,
      model: access.model,
      manufacturer: access.manufacturer,
      sdk: access.sdk,
      slotSuffix,
      partitions,
      partitionDir,
      bootPartition,
      activeBootPartition,
      fastbootAvailable: Boolean(fastbootVersion),
      fastbootVersion,
      usb,
      adbRoot: access.adbRootSupported,
      suAvailable: access.suAvailable,
      magiskApp,
      magiskAppVersion,
      bootloaderLocked: access.bootloaderLocked,
      images,
      reasons,
    }
  }

  async listImages(): Promise<FlashImage[]> {
    const raw = await this.client.shellText(`ls -l '${DOWNLOAD_DIR}' 2>/dev/null`, 20_000).catch(() => '')
    const images: FlashImage[] = []
    for (const line of raw.split('\n')) {
      const parts = line.trim().split(/\s+/)
      const name = parts.at(-1)
      if (!name || !name.toLowerCase().endsWith('.img') || !SAFE_NAME.test(name)) continue
      const size = Number(parts[4] ?? 0)
      images.push({ name, path: `${DOWNLOAD_DIR}/${name}`, size: Number.isFinite(size) ? size : 0 })
    }
    return images.sort((a, b) => {
      const aPatched = a.name.toLowerCase().includes('magisk_patched') ? 1 : 0
      const bPatched = b.name.toLowerCase().includes('magisk_patched') ? 1 : 0
      return bPatched - aPatched || a.name.localeCompare(b.name)
    })
  }

  async pullImage(remotePath: string): Promise<string> {
    if (!new RegExp(`^${DOWNLOAD_DIR}/[A-Za-z0-9_.-]+\\.img$`).test(remotePath)) {
      throw new Error('Ruta de imagen no permitida.')
    }
    const directory = join(this.options.dataDir, 'images')
    mkdirSync(directory, { recursive: true })
    const [local] = await this.client.pull([remotePath], directory)
    if (!local || !existsSync(local) || statSync(local).size === 0) {
      throw new Error('La imagen se copió vacía o no se pudo extraer.')
    }
    return local
  }

  /** Respalda boot/init_boot con `dd` (requiere adb root o su). */
  async backupPartition(partition: string): Promise<{ path: string; size: number }> {
    if (!BOOT_PARTITION.test(partition)) throw new Error('Partición de respaldo no permitida.')
    const access = await this.client.probeSystemAccess()
    if (access.strategy === 'none') {
      throw new Error('Para respaldar la partición hace falta adb root o su. Sin root usa la imagen stock del firmware.')
    }
    const partitionDir = await this.detectPartitionDir()
    const remote = `/data/local/tmp/adbopt-${partition}-${Date.now()}.img`
    const directory = join(this.options.dataDir, 'backups')
    mkdirSync(directory, { recursive: true })

    const dump = await this.client.rootShell(
      `dd if='${partitionDir}/${partition}' of='${remote}' bs=4M 2>&1`,
      180_000,
    )
    if (/No such file|Permission denied|error|failed/i.test(`${dump.stdout}${dump.stderr}`)) {
      throw new Error(`${dump.stdout}${dump.stderr}`.trim() || `No se pudo leer ${partitionDir}/${partition}.`)
    }
    await this.client.rootShell(`chmod 644 '${remote}'`, 10_000).catch(() => undefined)
    const [local] = await this.client.pull([remote], directory)
    await this.client.rootShell(`rm -f '${remote}'`, 10_000).catch(() => undefined)
    if (!local || !existsSync(local) || statSync(local).size === 0) {
      throw new Error('El respaldo quedó vacío.')
    }
    const size = statSync(local).size
    const target = join(directory, `${access.device || 'device'}-${partition}-${new Date().toISOString().replace(/[:.]/g, '-')}.img`)
    renameSync(local, target)
    return { path: target, size }
  }

  /** Instala la app oficial de Magisk (necesaria para parchear el boot.img). */
  async installMagiskApp(apkPath: string): Promise<string> {
    assertLabAllowed(this.client.deviceSerial, 'instalar la app de Magisk')
    if (!existsSync(apkPath) || !apkPath.toLowerCase().endsWith('.apk')) {
      throw new Error('Selecciona un APK válido de Magisk.')
    }
    const message = await this.client.install(apkPath, ['-r'])
    if (!/success/i.test(message) || /failure/i.test(message)) {
      throw new Error(message || 'Android rechazó la instalación de Magisk.')
    }
    return message
  }

  /** Abre Magisk para hacer «Instalar → Seleccionar y parchear un archivo». */
  async openMagisk(): Promise<void> {
    const result = await this.client.shell(
      `monkey -p ${MAGISK_PACKAGE} -c android.intent.category.LAUNCHER 1`,
      20_000,
    )
    if (/error|No activities found|aborted/i.test(`${result.stdout}${result.stderr}`)) {
      throw new Error('No se pudo abrir Magisk. ¿Está instalado?')
    }
  }

  async flashImage(input: {
    imagePath: string
    partition: string
    slot: 'a' | 'b' | 'all' | 'none'
    disableVerity: boolean
    confirmDevice: string
  }): Promise<FlashResult> {
    assertLabAllowed(this.client.deviceSerial, 'flashear una partición')
    if (!FLASH_PARTITION.test(input.partition)) throw new Error('Partición de flasheo no permitida.')
    if (input.slot !== 'none' && /_[ab]$/.test(input.partition)) {
      throw new Error('La partición ya incluye slot; no elijas otro slot.')
    }
    if (!existsSync(input.imagePath) || !input.imagePath.toLowerCase().endsWith('.img')) {
      throw new Error('Selecciona una imagen .img válida.')
    }
    const serial = this.client.deviceSerial
    if (!serial) throw new Error('No hay dispositivo conectado.')
    if (detectTransport(serial) === 'network') {
      throw new Error('El flasheo necesita USB. Reconecta el dispositivo por cable.')
    }

    const access = await this.client.probeSystemAccess()
    if (input.confirmDevice.trim() !== access.device) {
      throw new Error(`Para confirmar, escribe el nombre del dispositivo: ${access.device || '(desconocido)'}`)
    }
    this.assertImageHeader(input.imagePath, input.partition)

    const output: string[] = []
    const rebootOutput = await this.client.shell('reboot bootloader', 15_000).catch(() => null)
    if (rebootOutput) output.push(rebootOutput.stdout.trim())
    const fastbootSerial = await this.fastboot.waitForDevice(serial)
    output.push(await this.fastboot.flash({
      serial: fastbootSerial,
      partition: input.partition,
      imagePath: input.imagePath,
      slot: input.slot === 'none' ? undefined : input.slot,
      disableVerity: input.disableVerity,
    }))
    await this.fastboot.reboot(fastbootSerial)

    let magiskVersion: string | null = null
    try {
      await this.client.waitForBoot(240_000)
      magiskVersion = await this.verifyMagisk()
    } catch {
      output.push('El flasheo terminó, pero el dispositivo no reconectó por ADB. Revisa la pantalla y vuelve a conectar el cable.')
    }

    return {
      serial: fastbootSerial,
      partition: input.partition,
      output: output.filter(Boolean).join('\n'),
      magiskVersion,
    }
  }

  /** Comprueba si el sistema arrancó con Magisk activo. */
  async verifyMagisk(): Promise<string | null> {
    const result = await this.client.rootShell(
      'magisk -v 2>/dev/null || /data/adb/magisk/magisk -v 2>/dev/null',
      20_000,
    ).catch(() => null)
    const text = result?.stdout.trim() ?? ''
    return /^\d+(?:\.\d+)+/.test(text) ? text.split('\n')[0]!.trim() : null
  }

  private assertImageHeader(imagePath: string, partition: string): void {
    const header = Buffer.alloc(8)
    const fd = openSync(imagePath, 'r')
    try {
      readSync(fd, header, 0, 8, 0)
    } finally {
      closeSync(fd)
    }
    const magic = header.toString('latin1')
    const expected = partition.startsWith('vbmeta')
      ? ['AVB0', 'AVBf']
      : partition.startsWith('vendor_boot')
        ? ['VNDRBOOT']
        : ['ANDROID!']
    if (!expected.some((prefix) => magic.startsWith(prefix))) {
      throw new Error(
        `La imagen no parece un ${partition} válido (cabecera «${magic.replace(/[^\x20-\x7E]/g, '.')}»). ` +
          'Para boot/init_boot se espera ANDROID!.',
      )
    }
  }

  private async detectPartitionDir(): Promise<string> {
    for (const directory of ['/dev/block/by-name', '/dev/block/bootdevice/by-name']) {
      const probe = await this.client.shellText(`ls '${directory}' 2>/dev/null | head -n 1`, 8_000).catch(() => '')
      if (probe.trim().length > 0) return directory
    }
    return '/dev/block/by-name'
  }

  private async listPartitions(directory: string): Promise<string[]> {
    const raw = await this.client.shellText(`ls '${directory}' 2>/dev/null`, 10_000).catch(() => '')
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((name) => /^[A-Za-z0-9_]+$/.test(name))
  }

  private async magiskAppVersion(): Promise<string | null> {
    const raw = await this.client
      .shellText(`dumpsys package ${MAGISK_PACKAGE} | grep -m1 versionName`, 15_000)
      .catch(() => '')
    const value = raw.split('versionName=').pop()?.trim()
    return value && value.length > 0 ? value : null
  }
}
