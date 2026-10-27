import { basename, join } from 'node:path'
import type {
  DeviceInfo,
  DeviceMetrics,
  DeviceRef,
  DeviceState,
  MdnsService,
  RemoteLauncher,
  RootStrategy,
  SystemAccessReport,
  Transport,
  WirelessResult,
} from '../../shared/types'
import type { CommandRunner, CommandResult } from './runner'
import { assertHostPort, assertPort, isHostPort } from '../validation'

export interface AdbClientOptions {
  adbPath: string
  serial?: string
  runner: CommandRunner
}

export class AdbError extends Error {
  constructor(
    message: string,
    readonly kind: 'notFound' | 'unauthorized' | 'offline' | 'timeout' | 'shell',
    readonly output?: string,
  ) {
    super(message)
    this.name = 'AdbError'
  }
}

export class AdbClient {
  private serial?: string
  private strategy: RootStrategy | null = null
  private adbRootActive = false
  private suVerified = false
  private systemWritable = false

  constructor(private readonly options: AdbClientOptions) {
    this.serial = options.serial
  }

  get adbPath(): string {
    return this.options.adbPath
  }

  get deviceSerial(): string | undefined {
    return this.serial
  }

  useDevice(serial: string): void {
    this.serial = serial
    this.resetSystemSession()
  }

  /** Tras reiniciar o cambiar de dispositivo el root y el remount dejan de ser validos. */
  private resetSystemSession(): void {
    this.strategy = null
    this.adbRootActive = false
    this.suVerified = false
    this.systemWritable = false
  }

  private async adb(args: string[], timeoutMs = 20_000, stdin?: string): Promise<CommandResult> {
    const result = await this.options.runner.run(this.options.adbPath, args, { timeoutMs, stdin })

    if (result.code === -1 && /ENOENT|not found/i.test(result.stderr)) {
      throw new AdbError('adb no esta disponible en esta maquina.', 'notFound', result.stderr)
    }
    if (result.timedOut) {
      throw new AdbError('El comando ADB excedio el tiempo limite.', 'timeout', result.stderr)
    }
    if (/unauthorized/i.test(result.stderr)) {
      throw new AdbError('Authorize debugging on the device screen.', 'unauthorized', result.stderr)
    }
    if (/device offline/i.test(result.stderr)) {
      throw new AdbError('The device is offline.', 'offline', result.stderr)
    }

    // Solo errores de transporte en stderr. Algunos fabricantes (Samsung con Secure
    // Folder / usuario 150) escriben SecurityException en stderr aunque el comando
    // haya funcionado y la salida valida este en stdout. No es un fallo.
    if (/^adb:\s/m.test(result.stderr) || /error: (closed|device not found|no devices)/i.test(result.stderr)) {
      const detail = result.stderr.trim()
      throw new AdbError(detail, 'shell', detail)
    }

    // `adb shell` devuelve exit 0 casi siempre: los fallos reales del comando
    // aparecen como "error:" en stdout.
    if (/^error:/im.test(result.stdout)) {
      const detail = result.stdout.trim()
      throw new AdbError(detail, 'shell', detail)
    }

    return result
  }

  async listDevices(): Promise<DeviceRef[]> {
    const result = await this.adb(['devices', '-l'])
    return parseDevices(result.stdout)
  }

  /**
   * Selecciona un dispositivo ya visible en `adb devices`.
   * USB solo requiere asociar el serial; red requiere `adb connect`.
   */
  async connectDevice(id: string): Promise<DeviceInfo> {
    const transport = detectTransport(id)
    let devices = await this.listDevices()
    let target = devices.find((device) => device.id === id)
    let alreadyConnected = false

    // Una IP manual puede no estar en `adb devices` todavia: primero conectamos.
    if (!target && transport === 'network') {
      const result = await this.connect(id)
      if (!result.ok) {
        throw new AdbError(result.message || 'No se pudo conectar por red.', 'offline')
      }
      alreadyConnected = true
      devices = await this.listDevices()
      target = devices.find((device) => device.id === id)
    }

    if (!target) {
      throw new AdbError(`No se encontro el dispositivo ${id}.`, 'offline')
    }
    if (target.state === 'unauthorized') {
      throw new AdbError('Authorize debugging on the device screen.', 'unauthorized')
    }
    if (target.state !== 'device') {
      throw new AdbError(`El dispositivo esta ${target.state}.`, 'offline')
    }

    // Un serial mDNS ya visible como `device` no necesita otro `adb connect`.
    if (transport === 'network' && !alreadyConnected && isHostPort(id)) {
      const result = await this.connect(id)
      if (!result.ok) {
        throw new AdbError(result.message || 'No se pudo conectar por red.', 'offline')
      }
    }

    this.serial = id
    this.resetSystemSession()
    return this.getInfo()
  }

  /** Pasa un dispositivo conectado por USB a modo red (`adb tcpip`). */
  async enableWireless(value = 5555): Promise<WirelessResult> {
    const serial = this.requireSerial()
    const port = assertPort(value)
    const result = await this.adb(['-s', serial, 'tcpip', String(port)], 20_000)
    const message = `${result.stdout}${result.stderr}`.trim()
    const ok = result.code === 0 && /tcpip|tcp mode/i.test(message)
    const ip = await this.deviceIpAddress().catch(() => null)

    return {
      ok,
      message,
      address: ip ? `${ip}:${port}` : null,
    }
  }

  /** Vuelve a modo USB (`adb usb`). */
  async useUsbMode(): Promise<{ ok: boolean; message: string }> {
    const serial = this.requireSerial()
    const result = await this.adb(['-s', serial, 'usb'], 20_000)
    const message = `${result.stdout}${result.stderr}`.trim()
    return { ok: result.code === 0, message }
  }

  /** IP local del dispositivo conectado, para sugerir la conexion Wi-Fi. */
  async deviceIpAddress(): Promise<string | null> {
    const candidates = [
      "ip -f inet addr show wlan0 2>/dev/null | grep -m1 'inet '",
      "ip route get 1.1.1.1 2>/dev/null",
    ]

    for (const command of candidates) {
      const raw = await this.shellText(command, 5_000).catch(() => '')
      const match = raw.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/) ?? raw.match(/src\s+(\d+\.\d+\.\d+\.\d+)/)
      if (match?.[1]) return match[1]
    }
    return null
  }

  /** Salida de `adb mdns check`: util para diagnosticar el backend mDNS. */
  async mdnsCheck(): Promise<string> {
    const result = await this.adb(['mdns', 'check'], 10_000)
    return `${result.stdout}${result.stderr}`.trim()
  }

  async mdnsServices(): Promise<MdnsService[]> {
    const result = await this.adb(['mdns', 'services'], 10_000)
    return parseMdns(result.stdout)
  }

  async connect(value: string): Promise<{ ok: boolean; message: string }> {
    const address = assertHostPort(value)
    const result = await this.adb(['connect', address], 20_000)
    const message = `${result.stdout}${result.stderr}`.trim()
    const ok = /connected to/i.test(message) && !/failed|cannot|unable/i.test(message)
    if (ok) {
      this.serial = address
    }
    return { ok, message }
  }

  async disconnect(address?: string): Promise<void> {
    await this.adb(address ? ['disconnect', address] : ['disconnect'], 10_000)
    if (!address || address === this.serial) {
      this.serial = undefined
    }
  }

  async pair(value: string, code: string): Promise<{ ok: boolean; message: string }> {
    const address = assertHostPort(value)
    // `adb pair` accepts the pairing code as its second positional argument.
    // Do not send it through stdin: on several platform-tools builds that is not
    // consumed by the interactive prompt and the command waits until timeout.
    const result = await this.adb(['pair', address, code], 30_000)
    const message = `${result.stdout}${result.stderr}`.trim()
    return { ok: /Successfully paired/i.test(message), message }
  }

  private requireSerial(): string {
    if (!this.serial) {
      throw new AdbError('No hay dispositivo conectado.', 'offline')
    }
    return this.serial
  }

  async shell(command: string, timeoutMs = 20_000): Promise<CommandResult> {
    const serial = this.requireSerial()
    return this.adb(['-s', serial, 'shell', command], timeoutMs)
  }

  /** `adb install` devuelve "Success" o "Failure [...]" en stdout. */
  async install(apkPath: string, flags: string[] = ['-r', '-g']): Promise<string> {
    const serial = this.requireSerial()
    const result = await this.adb(['-s', serial, 'install', ...flags, apkPath], 180_000)
    return `${result.stdout}${result.stderr}`.trim()
  }

  /** Instala un conjunto base + splits en una sola sesion. */
  async installMultiple(apkPaths: string[], flags: string[] = ['-r', '-g']): Promise<string> {
    const serial = this.requireSerial()
    if (apkPaths.length === 0) throw new Error('Selecciona al menos un APK.')
    if (apkPaths.length === 1) return this.install(apkPaths[0]!, flags)
    const result = await this.adb(
      ['-s', serial, 'install-multiple', ...flags, ...apkPaths],
      300_000,
    )
    return `${result.stdout}${result.stderr}`.trim()
  }

  /**
   * Rutas de los APK del paquete: `base.apk` y, en apps con splits, cada
   * `split_config.*.apk`. `pm path` solo lista lo instalado para el usuario actual.
   */
  async packageApkPaths(packageName: string): Promise<string[]> {
    if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(packageName)) {
      throw new Error('El nombre del paquete no es valido.')
    }
    const raw = await this.shellText(`pm path ${packageName}`, 20_000)
    const paths = parsePackagePaths(raw)
    if (paths.length === 0) {
      throw new Error(`${packageName} no expone ningun APK. Puede estar oculta o no instalada.`)
    }
    return paths
  }

  /** Copia archivos del dispositivo a una carpeta local ya existente. */
  async pull(remotePaths: string[], localDir: string): Promise<string[]> {
    const serial = this.requireSerial()
    if (remotePaths.length === 0) throw new Error('No hay archivos que extraer.')

    const localFiles: string[] = []
    for (const remotePath of remotePaths) {
      const result = await this.adb(['-s', serial, 'pull', remotePath, localDir], 600_000)
      const message = `${result.stdout}${result.stderr}`.trim()
      if (result.code !== 0 || /^error:|failed|cannot/i.test(message)) {
        throw new AdbError(message || `No se pudo extraer ${remotePath}.`, 'shell', message)
      }
      localFiles.push(join(localDir, basename(remotePath)))
    }
    return localFiles
  }

  async shellText(command: string, timeoutMs = 20_000): Promise<string> {
    const result = await this.shell(command, timeoutMs)
    return result.stdout.trim()
  }

  async rootDaemon(): Promise<string> {
    const serial = this.requireSerial()
    const result = await this.adb(['-s', serial, 'root'], 20_000)
    const output = `${result.stdout}${result.stderr}`.trim()
    if (result.code !== 0 || /cannot run as root|adbd cannot run/i.test(output)) {
      throw new AdbError(output || 'El dispositivo no permite adb root.', 'shell', output)
    }
    return output
  }

  async disableVerity(): Promise<string> {
    const serial = this.requireSerial()
    const result = await this.adb(['-s', serial, 'disable-verity'], 30_000)
    const output = `${result.stdout}${result.stderr}`.trim()
    if (result.code !== 0 || /failed|error/i.test(output)) {
      throw new AdbError(output || 'No se pudo desactivar verity.', 'shell', output)
    }
    return output
  }

  async remount(): Promise<string> {
    const serial = this.requireSerial()
    const result = await this.adb(['-s', serial, 'remount'], 30_000)
    const output = `${result.stdout}${result.stderr}`.trim()
    if (result.code !== 0 || /failed|error/i.test(output)) {
      throw new AdbError(output || 'No se pudo montar /system en escritura.', 'shell', output)
    }
    return output
  }

  /**
   * Espera a que el dispositivo vuelva tras un reinicio y termine de arrancar.
   * Necesario cuando se escribe en /system: el paquete solo se escanea al arrancar.
   */
  async waitForBoot(timeoutMs = 180_000): Promise<void> {
    const serial = this.requireSerial()
    const network = detectTransport(serial) === 'network'
    const deadline = Date.now() + timeoutMs
    let lastError = ''
    let reconnected = false

    while (Date.now() < deadline) {
      try {
        const result = await this.adb(['-s', serial, 'shell', 'getprop sys.boot_completed'], 10_000)
        if (result.stdout.trim() === '1') {
          this.resetSystemSession()
          return
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        if (network && !reconnected) {
          await this.connect(serial).catch(() => undefined)
          reconnected = true
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000))
    }

    throw new AdbError(
      'El dispositivo no volvió a estar disponible tras el reinicio.',
      'timeout',
      lastError,
    )
  }

  /** Reinicia y deja el cliente listo para reconectar. */
  async rebootDevice(): Promise<void> {
    await this.shell('reboot', 15_000).catch(() => undefined)
    this.resetSystemSession()
  }

  /** Espera a que adbd responda (p. ej. después de `adb root`). */
  async waitForDevice(timeoutMs = 30_000): Promise<void> {
    const serial = this.requireSerial()
    const network = detectTransport(serial) === 'network'
    const deadline = Date.now() + timeoutMs
    let reconnected = false
    while (Date.now() < deadline) {
      try {
        const result = await this.adb(['-s', serial, 'shell', 'echo ready'], 5_000)
        if (result.stdout.includes('ready')) return
      } catch {
        // adbd se está reiniciando
        if (network && !reconnected) {
          await this.connect(serial).catch(() => undefined)
          reconnected = true
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    throw new AdbError('El dispositivo no respondió tras reiniciar adbd.', 'timeout')
  }

  /**
   * Diagnóstico de acceso a sistema sin efectos secundarios. No ejecuta `adb root`
   * ni pide permisos a `su`: solo informa de lo que está disponible.
   */
  async probeSystemAccess(): Promise<SystemAccessReport> {
    const props = parseGetprop(await this.shellText('getprop'))
    const [uidRaw, suProbe, mountRaw] = await Promise.all([
      this.shellText('id -u', 8_000).catch(() => ''),
      this.shell('which su || echo no-su', 8_000).catch(() => null),
      this.shellText("mount | grep ' /system '", 8_000).catch(() => ''),
    ])

    const uid = Number.parseInt(uidRaw.trim(), 10)
    const debuggable = props['ro.debuggable'] === '1'
    const suAvailable = Boolean(suProbe && !/no-su/i.test(suProbe.stdout) && suProbe.stdout.trim().length > 0)
    const strategy: RootStrategy = uid === 0 ? 'adb' : debuggable ? 'adb' : suAvailable ? 'su' : 'none'
    const lockedRaw = props['ro.boot.flash.locked']
    const sdk = Number.parseInt(props['ro.build.version.sdk'] ?? '0', 10)
    const reasons: string[] = []

    if (uid === 0) reasons.push('adbd ya ejecuta como root.')
    else if (debuggable) reasons.push('El build permite `adb root`.')
    else reasons.push('Build de producción (ro.debuggable=0): `adb root` no está disponible.')
    if (suAvailable) reasons.push(this.suVerified ? '`su` respondió con uid 0.' : 'Se detectó `su`; verifícalo para confirmar que concede root.')
    if (!suAvailable && !debuggable && uid !== 0) reasons.push('No hay root disponible sin desbloquear el dispositivo.')
    if (lockedRaw === '1') reasons.push('Bootloader bloqueado: la partición de sistema no se puede desbloquear solo con ADB.')
    if (props['ro.boot.verifiedbootstate'] === 'green') reasons.push('Verificación de arranque activa (verifiedbootstate=green).')
    if (props['ro.build.system_root_image'] === 'true') reasons.push('Sistema como raíz (system-as-root).')
    if (props['ro.boot.dynamic_partitions'] === 'true') reasons.push('Particiones dinámicas: el remount puede requerir overlayfs.')

    const report: SystemAccessReport = {
      device: props['ro.product.device'] ?? '',
      model: props['ro.product.model'] ?? '',
      manufacturer: props['ro.product.manufacturer'] ?? '',
      androidVersion: props['ro.build.version.release'] ?? '',
      sdk: Number.isFinite(sdk) ? sdk : 0,
      buildType: props['ro.build.type'] ?? '',
      buildTags: props['ro.build.tags'] ?? '',
      debuggable,
      secure: props['ro.secure'] === '1',
      verifiedBootState: props['ro.boot.verifiedbootstate'] ?? '',
      bootloaderLocked: lockedRaw === '1' ? true : lockedRaw === '0' ? false : null,
      dynamicPartitions: props['ro.boot.dynamic_partitions'] === 'true',
      systemRootImage: props['ro.build.system_root_image'] === 'true',
      adbRootSupported: uid === 0 || debuggable,
      suAvailable,
      suUid: this.suVerified ? 0 : null,
      strategy,
      systemWritable: /[ (]rw[,)]/.test(mountRaw),
      reasons,
    }
    this.strategy = strategy
    return report
  }

  /** Pide root a `su` (puede mostrar un diálogo en el dispositivo). */
  async checkSu(): Promise<number | null> {
    const probe = await this.shell("su -c 'id -u'", 30_000).catch(() => null)
    const uid = Number.parseInt(probe?.stdout.trim() ?? '', 10)
    this.suVerified = Boolean(probe && probe.code === 0 && uid === 0)
    if (this.suVerified) this.strategy = this.adbRootActive ? 'adb' : 'su'
    return this.suVerified ? 0 : null
  }

  /** Ejecuta `adb root` y espera a que adbd vuelva como uid 0. */
  async enableAdbRoot(): Promise<string> {
    const output = await this.rootDaemon()
    await this.waitForDevice()
    const uid = (await this.shellText('id -u', 10_000)).trim()
    if (uid !== '0') throw new Error('`adb root` no elevó los permisos del daemon.')
    this.adbRootActive = true
    this.strategy = 'adb'
    return output
  }

  private async resolveStrategy(): Promise<RootStrategy> {
    if (this.strategy) return this.strategy
    await this.probeSystemAccess()
    return this.strategy ?? 'none'
  }

  private async ensureAdbRoot(): Promise<void> {
    if (this.adbRootActive) return
    const uid = (await this.shellText('id -u', 8_000)).trim()
    if (uid === '0') {
      this.adbRootActive = true
      return
    }
    await this.enableAdbRoot()
  }

  /** Comando con uid 0 usando adb root o `su`, según lo que exista. */
  async rootShell(command: string, timeoutMs = 20_000): Promise<CommandResult> {
    const strategy = await this.resolveStrategy()
    if (strategy === 'none') {
      throw new AdbError('No hay root disponible: ni `adb root` ni `su`. No se modificó el sistema.', 'shell')
    }
    if (strategy === 'su') {
      return this.shell(`su -c ${shellQuote(command)}`, timeoutMs)
    }
    await this.ensureAdbRoot()
    return this.shell(command, timeoutMs)
  }

  /**
   * Deja /system en lectura/escritura y lo comprueba escribiendo un archivo temporal.
   * Intenta `adb remount` y, si falla, desactiva verity (que puede exigir reinicio).
   */
  async ensureSystemWritable(targetPath = '/system'): Promise<string[]> {
    if (!/^\/system(?:\/|$)/.test(targetPath)) {
      throw new Error('Solo se admite la partición /system.')
    }
    const strategy = await this.resolveStrategy()
    if (strategy === 'none') {
      throw new AdbError('No hay root disponible: ni `adb root` ni `su`. No se modificó el sistema.', 'shell')
    }
    const log: string[] = []

    if (this.systemWritable) return log

    if (strategy === 'adb') {
      await this.ensureAdbRoot()
      try {
        log.push(await this.remount())
      } catch (error) {
        const verity = await this.disableVerity().catch(() => null)
        if (verity && /reboot/i.test(verity)) {
          throw new Error('Verity quedó desactivada. Reinicia el dispositivo y vuelve a ejecutar; aún no se escribió nada.')
        }
        log.push(await this.remount())
      }
    } else {
      const mounted = await this.rootShell(
        'mount -o rw,remount / 2>/dev/null || mount -o rw,remount /system 2>/dev/null; echo ADBOPT_MOUNT',
        20_000,
      )
      log.push(mounted.stdout.trim())
    }

    const probePath = '/system/.adbopt-probe'
    const probe = await this.rootShell(`(touch '${probePath}' && rm -f '${probePath}' && echo ADBOPT_RW) 2>&1`, 20_000)
    if (!/ADBOPT_RW/.test(probe.stdout)) {
      throw new Error(`/system sigue en solo lectura: ${probe.stdout.trim() || 'remount rechazado'}`)
    }
    this.systemWritable = true
    return log
  }

  /** Copia un archivo a /system usando adb root o `su` + /data/local/tmp. */
  async pushToSystem(localPath: string, remotePath: string): Promise<void> {
    const strategy = await this.resolveStrategy()
    const directory = remotePath.slice(0, remotePath.lastIndexOf('/'))
    await this.ensureSystemWritable(directory)
    if (strategy === 'adb') {
      await this.push(localPath, remotePath)
      return
    }
    const temp = `/data/local/tmp/adbopt-${Date.now()}-${basename(remotePath)}`
    await this.push(localPath, temp)
    const result = await this.rootShell(`cp '${temp}' '${remotePath}' && rm -f '${temp}'`, 60_000)
    if (/error|failed/i.test(result.stdout)) throw new Error(result.stdout.trim())
  }

  async applySystemFile(remotePath: string, mode: string, owner: string): Promise<void> {
    const result = await this.rootShell(
      `chown ${owner} '${remotePath}' && chmod ${mode} '${remotePath}' && restorecon '${remotePath}'`,
      30_000,
    )
    if (/error|failed/i.test(result.stdout)) throw new Error(result.stdout.trim())
  }

  /** Contexto SELinux real de un archivo de sistema (vacío si no se pudo leer). */
  async systemFileContext(remotePath: string): Promise<string> {
    return this.shellText(`ls -lZ '${remotePath}'`, 15_000).catch(() => '')
  }

  async push(localPath: string, remotePath: string): Promise<string> {
    const serial = this.requireSerial()
    const result = await this.adb(['-s', serial, 'push', localPath, remotePath], 180_000)
    const output = `${result.stdout}${result.stderr}`.trim()
    if (result.code !== 0 || /failed|error/i.test(output)) {
      throw new AdbError(output || 'No se pudo copiar el APK al dispositivo.', 'shell', output)
    }
    return output
  }

  async installSystemApk(input: {
    apkPath: string
    targetPath: string
    backupPath: string
    mode: string
    owner: string
    selinuxContext: string
    disablePackages: string[]
  }): Promise<{ output: string; hadPrevious: boolean }> {
    if (!/^\/system\/(priv-app|app)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.apk$/.test(input.targetPath) || input.targetPath.includes('..')) {
      throw new Error('Ruta destino de sistema inválida.')
    }
    if (!/^\/data\/local\/tmp\/[A-Za-z0-9_.-]+$/.test(input.backupPath)) throw new Error('Ruta de respaldo inválida.')
    if (!/^[0-7]{3,4}$/.test(input.mode) || !/^\d+:\d+$/.test(input.owner)) throw new Error('Permisos u owner inválidos.')
    if (!/^u:object_r:[A-Za-z0-9_]+:s0$/.test(input.selinuxContext)) throw new Error('Contexto SELinux inválido.')
    if (input.disablePackages.some((pkg) => !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(pkg))) {
      throw new Error('Paquete a deshabilitar inválido.')
    }

    const prep = await this.ensureSystemWritable(input.targetPath)
    const directory = input.targetPath.slice(0, input.targetPath.lastIndexOf('/'))
    const backupResult = await this.rootShell(
      `mkdir -p '${directory}' && if [ -f '${input.targetPath}' ]; then cp -p '${input.targetPath}' '${input.backupPath}' && echo PRESENT; else rm -f '${input.backupPath}' && echo ABSENT; fi`,
      30_000,
    )
    if (/error|failed/i.test(backupResult.stdout)) throw new Error(backupResult.stdout.trim())
    const hadPrevious = backupResult.stdout.includes('PRESENT')

    try {
      await this.pushToSystem(input.apkPath, input.targetPath)
      await this.applySystemFile(input.targetPath, input.mode, input.owner)
      return { output: [...prep, backupResult.stdout.trim()].filter(Boolean).join('\n'), hadPrevious }
    } catch (error) {
      await this.restoreSystemApk({ ...input, hadPrevious }).catch(() => undefined)
      throw error
    }
  }

  /** Copia uno o varios APKs (base + splits) a una carpeta de /system. */
  async installSystemBundle(input: {
    files: Array<{ localPath: string; remoteName: string }>
    targetDir: string
    backupDir: string
    mode: string
    owner: string
  }): Promise<{ output: string; hadPrevious: boolean }> {
    if (!/^\/system\/(priv-app|app)\/[A-Za-z0-9_.-]+$/.test(input.targetDir) || input.targetDir.includes('..')) {
      throw new Error('Carpeta destino de sistema inválida.')
    }
    if (!/^\/data\/local\/tmp\/[A-Za-z0-9_./-]+$/.test(input.backupDir) || input.backupDir.includes('..')) {
      throw new Error('Ruta de respaldo inválida.')
    }
    if (input.files.length === 0) throw new Error('No hay archivos para copiar.')
    if (input.files.some((file) => !/^[A-Za-z0-9_.-]+\.apk$/.test(file.remoteName))) {
      throw new Error('Nombre de APK inválido.')
    }
    if (!/^[0-7]{3,4}$/.test(input.mode) || !/^\d+:\d+$/.test(input.owner)) throw new Error('Permisos u owner inválidos.')

    const prep = await this.ensureSystemWritable(input.targetDir)
    const backup = await this.rootShell(
      `rm -rf '${input.backupDir}'; if [ -d '${input.targetDir}' ]; then mkdir -p '${input.backupDir}' && cp -a '${input.targetDir}/.' '${input.backupDir}/' && echo PRESENT; else echo ABSENT; fi`,
      60_000,
    )
    if (/error|failed/i.test(backup.stdout)) throw new Error(backup.stdout.trim())
    const hadPrevious = backup.stdout.includes('PRESENT')

    try {
      await this.rootShell(`mkdir -p '${input.targetDir}'`, 20_000)
      for (const file of input.files) {
        await this.pushToSystem(file.localPath, `${input.targetDir}/${file.remoteName}`)
        await this.applySystemFile(`${input.targetDir}/${file.remoteName}`, input.mode, input.owner)
      }
      return { output: [...prep, backup.stdout.trim()].filter(Boolean).join('\n'), hadPrevious }
    } catch (error) {
      await this.restoreSystemBundle({ targetDir: input.targetDir, backupDir: input.backupDir, hadPrevious })
        .catch(() => undefined)
      throw error
    }
  }

  async restoreSystemApk(input: {
    targetPath: string
    backupPath: string
    mode: string
    owner: string
    selinuxContext: string
    disablePackages: string[]
    userInstalledPackage?: string
    hadPrevious: boolean
  }): Promise<string> {
    if (!/^\/system\/(priv-app|app)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.apk$/.test(input.targetPath) || input.targetPath.includes('..')) {
      throw new Error('Ruta de restauración inválida.')
    }
    if (!/^\/data\/local\/tmp\/[A-Za-z0-9_.-]+$/.test(input.backupPath)) throw new Error('Ruta de respaldo inválida.')
    if (!/^[0-7]{3,4}$/.test(input.mode) || !/^\d+:\d+$/.test(input.owner)) throw new Error('Permisos u owner inválidos.')
    if (!/^u:object_r:[A-Za-z0-9_]+:s0$/.test(input.selinuxContext)) throw new Error('Contexto SELinux inválido.')
    if (input.disablePackages.some((pkg) => !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(pkg))) {
      throw new Error('Paquete a rehabilitar inválido.')
    }
    if (input.userInstalledPackage && !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(input.userInstalledPackage)) {
      throw new Error('Paquete de la app instalada inválido.')
    }

    await this.ensureSystemWritable(input.targetPath)
    const restore = input.hadPrevious
      ? `cp -p '${input.backupPath}' '${input.targetPath}' && rm -f '${input.backupPath}' && chown ${input.owner} '${input.targetPath}' && chmod ${input.mode} '${input.targetPath}' && restorecon '${input.targetPath}'`
      : `rm -f '${input.targetPath}'`
    const restoreResult = await this.rootShell(restore, 30_000)
    if (/error|failed/i.test(restoreResult.stdout)) throw new Error(restoreResult.stdout.trim())

    const commands: string[] = []
    if (input.userInstalledPackage) commands.push(`pm uninstall --user 0 '${input.userInstalledPackage}'`)
    for (const pkg of input.disablePackages) commands.push(`pm enable --user 0 '${pkg}'`)
    commands.push('reboot')
    const result = await this.shell(commands.join('; '), 30_000)
    this.resetSystemSession()
    return result.stdout.trim() || 'Rollback aplicado; el dispositivo está reiniciando.'
  }

  /** Quita (o restaura) una carpeta completa de app de sistema. */
  async restoreSystemBundle(input: {
    targetDir: string
    backupDir: string
    hadPrevious: boolean
  }): Promise<string> {
    if (!/^\/system\/(priv-app|app)\/[A-Za-z0-9_.-]+$/.test(input.targetDir) || input.targetDir.includes('..')) {
      throw new Error('Carpeta de restauración inválida.')
    }
    if (!/^\/data\/local\/tmp\/[A-Za-z0-9_./-]+$/.test(input.backupDir) || input.backupDir.includes('..')) {
      throw new Error('Ruta de respaldo inválida.')
    }
    await this.ensureSystemWritable(input.targetDir)
    const restore = input.hadPrevious
      ? `rm -rf '${input.targetDir}' && mkdir -p '${input.targetDir}' && cp -a '${input.backupDir}/.' '${input.targetDir}/' && rm -rf '${input.backupDir}'`
      : `rm -rf '${input.targetDir}' && rm -rf '${input.backupDir}'`
    const result = await this.rootShell(restore, 60_000)
    if (/error|failed/i.test(result.stdout)) throw new Error(result.stdout.trim())
    await this.rebootDevice()
    return result.stdout.trim() || 'App de sistema restaurada; el dispositivo está reiniciando.'
  }

  async getInfo(): Promise<DeviceInfo> {
    const serial = this.requireSerial()
    // Ambas lecturas son independientes: en serie costaban una ida y vuelta extra
    // antes de poder pintar "Conectado" tras vincular por QR.
    const [propsRaw, rootProbe] = await Promise.all([
      this.shellText('getprop'),
      this.shell('which su || echo no-su', 5_000).catch(() => null),
    ])
    const props = parseGetprop(propsRaw)
    const characteristics = props['ro.build.characteristics'] ?? ''
    const sdk = Number.parseInt(props['ro.build.version.sdk'] ?? '0', 10)
    const rootOutput = rootProbe?.stdout ?? ''

    return {
      id: serial,
      model: props['ro.product.model'] ?? props['ro.product.device'] ?? 'Android',
      manufacturer: props['ro.product.manufacturer'] ?? 'unknown',
      sdk: Number.isFinite(sdk) ? sdk : 0,
      androidVersion: props['ro.build.version.release'] ?? '?',
      isTv: /tv|television/i.test(characteristics) || props['ro.build.type'] === 'tv',
      hasRoot: rootOutput.includes('/su') && !rootOutput.includes('no-su'),
      abi: props['ro.product.cpu.abi'] ?? '?',
    }
  }

  async listHomeLaunchers(): Promise<RemoteLauncher[]> {
    const result = await this.shell(
      'cmd package query-activities --brief --components --user 0 -a android.intent.action.MAIN -c android.intent.category.HOME',
      25_000,
    )
    if (result.code !== 0) {
      throw new Error(result.stdout.trim() || result.stderr.trim() || 'No se pudieron consultar los launchers.')
    }
    return parseHomeLaunchers(result.stdout)
  }

  async currentHomeLauncher(): Promise<RemoteLauncher | null> {
    const result = await this.shell(
      'cmd package resolve-activity --brief --user 0 -a android.intent.action.MAIN -c android.intent.category.HOME',
      20_000,
    )
    if (result.code !== 0) return null
    return parseHomeLaunchers(result.stdout)[0] ?? null
  }

  async setDefaultHomeLauncher(packageName: string): Promise<RemoteLauncher> {
    if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(packageName)) {
      throw new Error('El paquete del launcher no es valido.')
    }
    const launchers = await this.listHomeLaunchers()
    const target = launchers.find((item) => item.packageName === packageName)
    if (!target) throw new Error(`${packageName} no esta disponible como launcher de inicio.`)
    const result = await this.shell(`cmd package set-home-activity --user 0 '${packageName}'`, 20_000)
    if (result.code !== 0 || /error/i.test(result.stdout)) {
      throw new Error(result.stdout.trim() || result.stderr.trim() || 'Android rechazo el cambio de launcher.')
    }
    const current = await this.currentHomeLauncher()
    if (current?.packageName !== packageName) {
      throw new Error('Android no confirmo el cambio de launcher.')
    }
    return current
  }

  async getMetrics(): Promise<DeviceMetrics> {
    const [meminfo, cpuinfo, storage, thermal, uptime, processes, battery] = await Promise.all([
      this.shellText('dumpsys meminfo'),
      this.shellText('dumpsys cpuinfo'),
      this.shellText('df /data'),
      this.shellText('dumpsys thermalservice'),
      this.shellText('cat /proc/uptime'),
      this.shell('dumpsys activity processes | grep -c "ProcessRecord"').catch(() => null),
      this.shellText('dumpsys battery').catch(() => ''),
    ])

    return buildMetrics({ meminfo, cpuinfo, storage, thermal, uptime, processes, battery })
  }
}

// --- Parsers puros (compartidos con la suite de conformidad) ---

/** Escapa un comando para `su -c '<comando>'`. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export function parseDevices(stdout: string): DeviceRef[] {
  return stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('*'))
    .flatMap((line) => {
      const [id, state, ...rest] = line.split(/\s+/)
      if (!id) return []
      const model = rest.join(' ').match(/model:(\S+)/)?.[1]
      return [
        {
          id,
          address: id,
          state: normalizeState(state ?? 'unknown'),
          transport: detectTransport(id),
          model,
        },
      ]
    })
}

/** Un serial USB no lleva ':', un target de red siempre es host:puerto o mDNS. */
export function detectTransport(id: string): Transport {
  if (id.startsWith('emulator-')) return 'emulator'
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(id)) return 'network'
  if (/^\[.+\]:\d+$/.test(id)) return 'network'
  if (id.includes('_adb-tls')) return 'network'
  return 'usb'
}

export function parseHomeLaunchers(output: string): RemoteLauncher[] {
  const pattern = /^([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\/([A-Za-z0-9_.$]+)$/
  const seen = new Set<string>()
  const result: RemoteLauncher[] = []
  for (const raw of output.split('\n')) {
    const component = raw.trim().split(/\s+/)[0] ?? ''
    const match = pattern.exec(component)
    if (!match) continue
    const packageName = match[1]!
    if (seen.has(packageName)) continue
    seen.add(packageName)
    const activityName = match[2]!
    const activity = activityName.startsWith('.') ? `${packageName}${activityName}` : activityName
    result.push({ packageName, componentName: `${packageName}/${activity}` })
  }
  return result
}

function normalizeState(raw: string): DeviceState {
  if (raw === 'device') return 'device'
  if (raw === 'offline') return 'offline'
  if (raw === 'unauthorized') return 'unauthorized'
  return 'unknown'
}

/**
 * `pm path <pkg>` devuelve una linea `package:<ruta>` por APK (base y splits).
 * Algunos fabricantes agregan `package:/data/app/...` sin nombres estables, por
 * eso se normaliza y se descartan rutas vacias o repetidas.
 */
export function parsePackagePaths(stdout: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('package:')) continue
    const path = line.slice('package:'.length).trim()
    if (!path.startsWith('/') || seen.has(path)) continue
    seen.add(path)
    result.push(path)
  }
  return result
}

export function parseMdns(stdout: string): MdnsService[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('_adb-'))
    .map((line) => {
      const [name, , address] = line.split(/\s+/)
      const kind = line.includes('_adb-tls-pairing')
        ? 'pairing'
        : line.includes('_adb-tls-connect')
          ? 'connect'
          : 'other'
      return { kind, name, address } as MdnsService
    })
    .filter((service) => Boolean(service.name) && Boolean(service.address))
}

export function parseGetprop(stdout: string): Record<string, string> {
  const props: Record<string, string> = {}
  for (const match of stdout.matchAll(/\[([^\]]+)\]:\s*\[([^\]]*)\]/g)) {
    const key = match[1]
    const value = match[2]
    if (key !== undefined && value !== undefined) {
      props[key] = value
    }
  }
  return props
}

export interface MeminfoParsed {
  totalKb: number
  freeKb: number
  usedKb: number
  cachedKb: number
}

export function parseMeminfo(stdout: string): MeminfoParsed {
  const total = numberFrom(stdout, /Total RAM:\s*([\d,]+)K/i)
  const freeMatch = stdout.match(/Free RAM:\s*([\d,]+)K\s*\(([^)]*)\)/i)
  const free = freeMatch ? toNumber(freeMatch[1] ?? '0') : 0
  const cached = freeMatch
    ? toNumber((freeMatch[2] ?? '').match(/([\d,]+)K cached pss/i)?.[1] ?? '0')
    : 0

  return {
    totalKb: total,
    freeKb: free,
    usedKb: Math.max(total - free, 0),
    cachedKb: cached,
  }
}

export interface CpuinfoParsed {
  load1: number
  load5: number
  load15: number
  busyPercent: number
}

export function parseCpuinfo(stdout: string): CpuinfoParsed {
  const load = stdout.match(/Load:\s*([\d.]+)\s*\/\s*([\d.]+)\s*\/\s*([\d.]+)/i)
  const total = stdout.match(/([\d.]+)%\s*TOTAL/i)
  return {
    load1: load ? Number(load[1] ?? 0) : 0,
    load5: load ? Number(load[2] ?? 0) : 0,
    load15: load ? Number(load[3] ?? 0) : 0,
    busyPercent: total ? Number(total[1] ?? 0) : 0,
  }
}

export interface StorageParsed {
  totalKb: number
  usedKb: number
  availableKb: number
  usedPercent: number
}

export function parseStorage(stdout: string): StorageParsed {
  const line = stdout
    .split('\n')
    .map((value) => value.trim())
    .find((value) => /^\/dev\/|^Filesystem/.test(value) && /\d+%|\d+\s+\/data/.test(value))

  if (!line) {
    return { totalKb: 0, usedKb: 0, availableKb: 0, usedPercent: 0 }
  }

  const parts = line.split(/\s+/)
  const totalKb = toNumber(parts[1] ?? '0')
  const usedKb = toNumber(parts[2] ?? '0')
  const availableKb = toNumber(parts[3] ?? '0')
  const usedPercent = toNumber((parts[4] ?? '0').replace('%', ''))

  return { totalKb, usedKb, availableKb, usedPercent }
}

export interface ThermalParsed {
  maxStatus: number
  temperatures: Array<{ name: string; value: number }>
}

export function parseThermal(stdout: string): ThermalParsed {
  const statuses = [...stdout.matchAll(/Thermal Status:\s*(\d+)/gi)].map((match) =>
    Number(match[1] ?? 0),
  )
  const temperatures = [
    ...stdout.matchAll(/Temperature\{[^}]*mValue=([\d.]+)[^}]*mName=([^,}]+)/g),
  ].map((match) => ({ name: (match[2] ?? '').trim(), value: Number(match[1] ?? 0) }))

  return {
    maxStatus: statuses.length > 0 ? Math.max(...statuses) : 0,
    temperatures,
  }
}

export function parseUptimeSeconds(stdout: string): number {
  const first = stdout.trim().split(/\s+/)[0] ?? ''
  const value = Number(first)
  return Number.isFinite(value) ? Math.floor(value) : 0
}

function numberFrom(stdout: string, pattern: RegExp): number {
  const match = stdout.match(pattern)
  return match ? toNumber(match[1] ?? '0') : 0
}

function toNumber(value: string): number {
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

interface MetricsInput {
  meminfo: string
  cpuinfo: string
  storage: string
  thermal: string
  uptime: string
  processes: CommandResult | null
  battery?: string
}

export function buildMetrics(input: MetricsInput): DeviceMetrics {
  const memory = parseMeminfo(input.meminfo)
  const cpu = parseCpuinfo(input.cpuinfo)
  const disk = parseStorage(input.storage)
  const thermal = parseThermal(input.thermal)

  const cpuTemp = thermal.temperatures.find((item) => /cpu/i.test(item.name))

  return {
    totalRamKb: memory.totalKb,
    usedRamKb: memory.usedKb,
    freeRamKb: memory.freeKb,
    cachedKb: memory.cachedKb,
    cpuBusyPercent: cpu.busyPercent,
    load1: cpu.load1,
    storageTotalKb: disk.totalKb,
    storageUsedKb: disk.usedKb,
    storageAvailableKb: disk.availableKb,
    temperatureC: cpuTemp ? cpuTemp.value : null,
    maxThermalStatus: thermal.maxStatus,
    uptimeSeconds: parseUptimeSeconds(input.uptime),
    backgroundProcesses: input.processes
      ? Number.parseInt(input.processes.stdout.trim(), 10) || 0
      : 0,
    batteryPercent: parseBatteryPercent(input.battery ?? ''),
  }
}

export function parseBatteryPercent(text: string): number {
  const level = /^\s*level:\s*(-?\d+)/im.exec(text)?.[1]
  const scale = /^\s*scale:\s*(-?\d+)/im.exec(text)?.[1] ?? '100'
  const levelValue = Number.parseInt(level ?? '', 10)
  const scaleValue = Number.parseInt(scale, 10)
  if (!Number.isFinite(levelValue) || !Number.isFinite(scaleValue) || scaleValue <= 0) return -1
  return Math.max(0, Math.min(100, Math.round((levelValue / scaleValue) * 100)))
}
