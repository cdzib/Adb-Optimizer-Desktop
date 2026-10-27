import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { dialog, ipcMain, shell } from 'electron'
import { registerMirrorIpc } from '@adb-optimizer/mirror'
import type { DeviceInfo, InstalledApp, Profile } from '../shared/types'
import { AdbClient, AdbError } from './adb/adb-client'
import type { CommandRunner } from './adb/runner'
import { AppService, parsePackageList } from './apps/app-service'
import { DpcService } from './apps/dpc-service'
import { buildProvisionScript } from './apps/dpc-script'
import { MdnsBrowser } from './adb/mdns-browser'
import { QrPairingSession } from './adb/qr-pairing'
import type { ScrcpySession } from './adb/scrcpy-session'
import { FlashService } from './flash/flash-service'
import { assertLabAllowed, isLabMode } from './lab'
import type { CatalogBundle } from './optimization/catalog'
import { Journal } from './optimization/journal'
import { RecipeEngine } from './optimization/recipe-engine'
import { SystemAppService } from './optimization/system-app'
import { SystemLauncherService } from './optimization/system-launcher'
import { resolveLocale } from './security'

export interface IpcDeps {
  client: AdbClient
  engine: RecipeEngine
  apps: AppService
  dpc: DpcService
  journal: Journal
  catalog: CatalogBundle
  sharedDir: string
  adbPath: string
  fastbootPath: string
  dataDir: string
  runner: CommandRunner
  mdns: MdnsBrowser
  scrcpy: ScrcpySession
  onLog: (line: string) => void
  send: (channel: string, payload: unknown) => void
}

interface Session {
  device: DeviceInfo | null
}

export function registerIpc(deps: IpcDeps): void {
  const session: Session = { device: null }
  let selectedLauncherApk: string | null = null
  let verifiedLauncher: { apk: string; packageName: string | null } | null = null
  const systemRecipe = deps.catalog.catalog.recipes.find((item) => item.id === 'wanboos-launcher')
  const systemLauncher = systemRecipe
    ? new SystemLauncherService(deps.client, deps.journal, systemRecipe, (line) => deps.onLog(line))
    : null
  const systemApps = new SystemAppService(deps.client, deps.journal, (line) => deps.onLog(line))
  const flash = new FlashService(deps.client, {
    dataDir: deps.dataDir,
    fastbootPath: deps.fastbootPath,
    runner: deps.runner,
  })
  // Solo se pueden abrir carpetas que hayan resultado de una extraccion de esta sesion.
  const extractDirs = new Set<string>()

  // Mismo flujo QR que el proyecto de referencia: QR -> pairing -> connect.
  const qr = new QrPairingSession({
    client: deps.client,
    discover: () => deps.mdns.list(),
    // Respaldo cuando Bonjour no ve el puerto TLS anunciado.
    fallbackDiscover: () => deps.client.mdnsServices(),
    onStatus: (status) => {
      if (status.device) session.device = status.device
      deps.onLog(
        `qr ${status.state}${status.address ? ` ${status.address}` : ''}${
          status.message ? ` · ${status.message}` : ''
        }`,
      )
      deps.send('qr:status', status)
    },
  })

  ipcMain.handle('app:state', () => ({
    adbPath: deps.adbPath,
    catalogVersion: deps.catalog.catalog.catalogVersion,
    recipeCount: deps.catalog.catalog.recipes.length,
    actionCount: deps.catalog.actions.actions.length,
    labMode: isLabMode(),
  }))

  ipcMain.handle('i18n:get', (_event, locale: unknown) => {
    const file = join(deps.sharedDir, 'i18n', `${resolveLocale(locale)}.json`)
    if (!existsSync(file)) {
      return JSON.parse(readFileSync(join(deps.sharedDir, 'i18n', 'es.json'), 'utf8'))
    }
    return JSON.parse(readFileSync(file, 'utf8'))
  })

  ipcMain.handle('adb:devices', async () => deps.client.listDevices())

  ipcMain.handle('adb:mdns', async () => {
    const discovered = deps.mdns.list()
    // Fallback al backend de adb por si Bonjour no esta disponible.
    return discovered.length > 0 ? discovered : deps.client.mdnsServices()
  })

  ipcMain.handle('qr:diagnostics', async () => ({
    backend: await deps.client.mdnsCheck().catch((error) => String(error?.message ?? error)),
    discovered: deps.mdns.list(),
  }))

  ipcMain.handle('adb:pair', async (_event, address: string, code: string) => {
    const result = await deps.client.pair(address, code)
    deps.onLog(`pair ${address}: ${result.message}`)
    return result
  })

  ipcMain.handle('adb:connect', async (_event, deviceId: string) => {
    const info = await deps.client.connectDevice(deviceId)
    deps.onLog(`connect ${deviceId} (${info.model})`)
    session.device = info
    return info
  })

  ipcMain.handle('adb:wireless', async (_event, port: number) => {
    const result = await deps.client.enableWireless(port)
    deps.onLog(`tcpip ${port}: ${result.message}`)
    return result
  })

  ipcMain.handle('adb:usb-mode', async () => {
    const result = await deps.client.useUsbMode()
    deps.onLog(`usb: ${result.message}`)
    return result
  })

  ipcMain.handle('adb:device-ip', async () => deps.client.deviceIpAddress())

  ipcMain.handle('qr:start', async () => {
    const result = await qr.start()
    // El payload incluye el secreto de pairing; nunca debe quedar en logs.
    deps.onLog(`qr generado: ${result.name}`)
    return result
  })

  ipcMain.handle('qr:cancel', () => {
    qr.cancel()
  })

  ipcMain.handle('adb:disconnect', async () => {
    qr.cancel()
    const current = session.device?.id
    deps.scrcpy.stop()
    session.device = null
    if (current) {
      await deps.client.disconnect(current)
    }
  })

  ipcMain.handle('device:info', async () => {
    if (!deps.client.deviceSerial) return null
    session.device = await deps.client.getInfo()
    return session.device
  })

  ipcMain.handle('device:metrics', async () => {
    if (!deps.client.deviceSerial) return null
    return deps.client.getMetrics()
  })

  registerMirrorIpc({
    ipcMain,
    mirror: deps.scrcpy,
    authorize: (event) => {
      const frame = event.senderFrame
      return frame !== null && frame === event.sender.mainFrame &&
        frame.url === event.sender.getURL()
    },
    getDevice: () => session.device ? {
      serial: session.device.id,
      title: `ADB Optimizer · ${session.device.model || session.device.id}`,
    } : null,
  })

  ipcMain.handle('device:launchers', async () => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    return deps.client.listHomeLaunchers()
  })

  ipcMain.handle('device:launcher-current', async () => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    return deps.client.currentHomeLauncher()
  })

  ipcMain.handle('device:launcher-set', async (_event, packageName: string) => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    const launcher = await deps.client.setDefaultHomeLauncher(packageName)
    deps.onLog(`launcher ${launcher.packageName}`)
    return launcher
  })

  ipcMain.handle('launcher:pick-apk', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Elegir APK de launcher para TV',
      properties: ['openFile'],
      filters: [{ name: 'Android package', extensions: ['apk'] }],
    })
    selectedLauncherApk = result.canceled ? null : result.filePaths[0] ?? null
    verifiedLauncher = null
    return selectedLauncherApk ? { name: selectedLauncherApk.split(/[\\/]/).pop() ?? 'launcher.apk' } : null
  })

  ipcMain.handle('launcher:diagnostics', async () => {
    if (!session.device || !systemLauncher) throw new AdbError('Conecta un dispositivo Android TV.', 'offline')
    return systemLauncher.diagnostics()
  })

  ipcMain.handle('launcher:inspect', async (_event, packageName: string) => {
    if (!systemLauncher) throw new AdbError('No hay flujo de sistema disponible.', 'offline')
    return systemLauncher.inspect(packageName)
  })

  ipcMain.handle('launcher:install', async (_event, packageName: string, privileged: boolean) => {
    if (!session.device || !systemLauncher) throw new AdbError('Conecta un dispositivo Android TV.', 'offline')
    if (!selectedLauncherApk) throw new Error('Selecciona el APK del launcher.')
    if (selectedLauncherApk !== verifiedLauncher?.apk) {
      throw new Error('Para la instalación de sistema, instala primero este mismo APK como app normal para verificar su paquete.')
    }
    if (verifiedLauncher?.packageName && verifiedLauncher.packageName !== packageName) {
      throw new Error(`El APK instalado declara ${verifiedLauncher.packageName}, no ${packageName}.`)
    }
    const result = await systemLauncher.install({
      apkPath: selectedLauncherApk,
      packageName,
      privileged,
      device: session.device,
    })
    deps.onLog('system-launcher: instalado en /system, Home asignado y launcher anterior deshabilitado')
    return result
  })

  ipcMain.handle('launcher:activate', async (_event, packageName: string) => {
    if (!session.device || !systemLauncher) throw new AdbError('Conecta un dispositivo Android TV.', 'offline')
    await systemLauncher.activate(packageName)
    deps.onLog('system-launcher: Home asignado; launcher anterior deshabilitado')
  })

  ipcMain.handle('launcher:install-apk', async () => {
    if (!session.device) throw new AdbError('Conecta primero el Android TV o Google TV.', 'offline')
    assertLabAllowed(session.device.id, 'instalar el APK del launcher')
    if (!selectedLauncherApk || !existsSync(selectedLauncherApk)) throw new Error('Selecciona un APK de launcher válido.')

    const before = new Set(parsePackageList(await deps.client.shellText('pm list packages -3', 30_000)))
    const previous = verifiedLauncher
    const message = await deps.client.install(selectedLauncherApk)
    const ok = /success/i.test(message) && !/failure/i.test(message)
    let packageName: string | null = null

    if (ok) {
      const after = parsePackageList(await deps.client.shellText('pm list packages -3', 30_000))
      const added = after.filter((pkg) => !before.has(pkg))
      if (added.length === 1) {
        packageName = added[0] ?? null
      } else {
        // Reinstalación: comparar el nombre base del APK con `pm list packages -3 -f`.
        const raw = await deps.client.shellText('pm list packages -3 -f', 30_000)
        const base = basename(selectedLauncherApk, '.apk').toLowerCase()
        const match = raw
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith('package:'))
          .find((line) => line.toLowerCase().includes(`/${base}.apk=`))
        packageName = match?.split('=').pop()?.trim() ?? null
        if (!packageName && previous?.apk === selectedLauncherApk) packageName = previous.packageName
      }
    }

    verifiedLauncher = ok ? { apk: selectedLauncherApk, packageName } : null
    deps.onLog(`launcher sideload: ${ok ? 'installed' : 'failed'} · ${message}${packageName ? ` · ${packageName}` : ''}`)
    return { ok, message, packageName }
  })

  ipcMain.handle('root:diagnostics', async () => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    return deps.client.probeSystemAccess()
  })

  ipcMain.handle('root:adb-root', async () => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    const output = await deps.client.enableAdbRoot()
    deps.onLog(`root: adb root · ${output}`)
    return deps.client.probeSystemAccess()
  })

  ipcMain.handle('root:check-su', async () => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    const uid = await deps.client.checkSu()
    deps.onLog(`root: su ${uid === 0 ? 'concede uid 0' : 'no disponible'}`)
    return deps.client.probeSystemAccess()
  })

  ipcMain.handle('root:remount', async () => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    assertLabAllowed(session.device.id, 'remontar /system')
    const log = await deps.client.ensureSystemWritable('/system')
    deps.onLog(`root: /system rw${log.length > 0 ? ` · ${log.join(' · ')}` : ''}`)
    return deps.client.probeSystemAccess()
  })

  ipcMain.handle('root:reboot', async () => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    assertLabAllowed(session.device.id, 'reiniciar el dispositivo')
    await deps.client.rebootDevice()
  })

  ipcMain.handle('system:apps', async () => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    return systemApps.candidates()
  })

  ipcMain.handle('system:convert', async (_event, packageName: string, privileged: boolean) => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    const entry = await systemApps.convert({ packageName, privileged, device: session.device })
    deps.onLog(`system-app: ${packageName} convertida a ${privileged ? 'priv-app' : 'app'}`)
    return entry
  })

  ipcMain.handle('flash:diagnostics', async () => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    return flash.diagnostics()
  })

  ipcMain.handle('flash:images', async () => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    return flash.listImages()
  })

  ipcMain.handle('flash:pick-image', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Elegir imagen .img',
      properties: ['openFile'],
      filters: [{ name: 'Imagen de arranque', extensions: ['img'] }],
    })
    const path = result.canceled ? null : result.filePaths[0] ?? null
    if (!path) return null
    return { path, name: basename(path), size: statSync(path).size }
  })

  ipcMain.handle('flash:pull-image', async (_event, remotePath: string) => {
    return flash.pullImage(remotePath)
  })

  ipcMain.handle('flash:backup', async (_event, partition: string) => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    const backup = await flash.backupPartition(partition)
    deps.onLog(`flash: respaldo ${partition} en ${backup.path}`)
    return backup
  })

  ipcMain.handle('flash:pick-magisk', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Elegir APK de Magisk',
      properties: ['openFile'],
      filters: [{ name: 'Android package', extensions: ['apk'] }],
    })
    const path = result.canceled ? null : result.filePaths[0] ?? null
    return path ? { path, name: basename(path) } : null
  })

  ipcMain.handle('flash:magisk-install', async (_event, apkPath: string) => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    return flash.installMagiskApp(apkPath)
  })

  ipcMain.handle('flash:open-magisk', async () => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    await flash.openMagisk()
  })

  ipcMain.handle('flash:flash', async (_event, input: {
    imagePath: string
    partition: string
    slot: 'a' | 'b' | 'all' | 'none'
    disableVerity: boolean
    confirmDevice: string
  }) => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    deps.onLog(`flash: ${input.partition} ← ${basename(input.imagePath)} (slot ${input.slot})`)
    const result = await flash.flashImage(input)
    deps.onLog(`flash: ${result.partition} OK${result.magiskVersion ? ` · Magisk ${result.magiskVersion}` : ''}`)
    return result
  })

  ipcMain.handle('flash:verify-root', async () => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    return flash.verifyMagisk()
  })

  ipcMain.handle('catalog:recipes', () => deps.catalog.catalog.recipes)

  ipcMain.handle('catalog:actions', () => deps.catalog.actions.actions)

  ipcMain.handle('optimize:plan', (_event, profile: Profile) => {
    if (!session.device) return []
    return deps.engine.plan(deps.catalog.catalog.recipes, session.device, profile)
  })

  ipcMain.handle('optimize:run', async (_event, recipeIds: string[], dryRun: boolean) => {
    if (!session.device) {
      throw new AdbError('No hay dispositivo conectado.', 'offline')
    }
    const results = []
    for (const id of recipeIds) {
      const recipe = deps.catalog.catalog.recipes.find((item) => item.id === id)
      if (!recipe) continue
      deps.onLog(`${dryRun ? '[preview]' : '[run]'} ${recipe.id}`)
      results.push(await deps.engine.run(recipe, session.device, { dryRun }))
    }
    return results
  })

  ipcMain.handle('apps:pick-apks', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Elegir APK para instalar',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Android package', extensions: ['apk'] }],
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('apps:install-apks', async (_event, apkPaths: string[]) => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    const files = apkPaths.filter((path) => existsSync(path))
    if (files.length !== apkPaths.length) throw new Error('Uno de los APK seleccionados no existe.')
    deps.onLog(`install-multiple ${files.length} archivo(s)`)
    const message = await deps.client.installMultiple(files)
    const ok = /success/i.test(message) && !/failure/i.test(message)
    return { ok, message }
  })

  ipcMain.handle('apps:list', async () => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    return deps.apps.list()
  })

  ipcMain.handle('apps:extract-apk', async (_event, packageName: string) => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    const chosen = await dialog.showOpenDialog({
      title: `Elegir carpeta para extraer ${packageName}`,
      buttonLabel: 'Extraer aqui',
      properties: ['openDirectory', 'createDirectory'],
    })
    const destination = chosen.filePaths[0]
    if (chosen.canceled || !destination) return null

    const result = await deps.apps.extractApks(packageName, destination)
    extractDirs.add(result.directory)
    deps.onLog(`extract ${packageName}: ${result.files.length} archivo(s) en ${result.directory}`)
    return result
  })

  ipcMain.handle('apps:open-folder', async (_event, targetPath: string) => {
    if (!extractDirs.has(targetPath)) throw new Error('Ruta no autorizada.')
    const error = await shell.openPath(targetPath)
    if (error) throw new Error(error)
  })

  ipcMain.handle('apps:uninstall', async (_event, app: InstalledApp) => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    const model = `${session.device.manufacturer} ${session.device.model}`.trim()
    await deps.apps.uninstall(app, { id: session.device.id, model })
    deps.onLog(`uninstall ${app.packageName}`)
  })

  ipcMain.handle('apps:restore', async (_event, app: InstalledApp) => {
    await deps.apps.restore(app)
    deps.onLog(`restore ${app.packageName}`)
  })

  ipcMain.handle('apps:action', async (_event, actionId: string, packageName: string) => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    const action = deps.catalog.actions.actions.find((item) => item.id === actionId)
    if (!action) throw new Error(`Accion desconocida: ${actionId}`)
    const result = await deps.engine.runAction(action, session.device, packageName)
    deps.onLog(`${actionId} ${packageName}: ${result.status}`)
    return result
  })

  ipcMain.handle('apps:enable', async (_event, packageName: string) => {
    await deps.apps.enable(packageName)
    deps.onLog(`enable ${packageName}`)
  })

  ipcMain.handle('dpc:preflight', async (_event, mode: 'device' | 'profile' = 'device') => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    return deps.dpc.preflight(mode)
  })

  ipcMain.handle('dpc:receivers', async (_event, packageName?: string) => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    return deps.dpc.receivers(packageName)
  })

  ipcMain.handle('dpc:pick-apk', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Elegir APK del DPC',
      properties: ['openFile'],
      filters: [{ name: 'Android package', extensions: ['apk'] }],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('dpc:install', async (_event, apkPath: string, options: { downgrade?: boolean } = {}) => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    const result = await deps.dpc.install(apkPath, options)
    deps.onLog(`install ${apkPath}: ${result.ok ? 'ok' : 'fallo'}`)
    return result
  })

  ipcMain.handle('dpc:set-owner', async (_event, component: string, mode: 'device' | 'profile') => {
    if (!session.device) throw new AdbError('No hay dispositivo conectado.', 'offline')
    const result = await deps.dpc.setOwner(component, mode)
    deps.onLog(`dpm set-${mode}-owner ${component}: ${result.ok ? 'ok' : 'fallo'}`)
    return result
  })

  ipcMain.handle('dpc:remove-owner', async (_event, component: string) => {
    const result = await deps.dpc.removeOwner(component)
    deps.onLog(`dpm remove-active-admin ${component}: ${result.ok ? 'ok' : 'fallo'}`)
    return result
  })

  ipcMain.handle(
    'dpc:script',
    (_event, apkPath: string, component: string, mode: 'device' | 'profile') => {
      const serial = session.device?.id ?? '<serial>'
      return buildProvisionScript({ serial, apkPath, component, mode })
    },
  )

  ipcMain.handle('journal:list', () => deps.journal.list(session.device?.id))

  ipcMain.handle('journal:undo', async (_event, entryId: string) => {
    const result = await deps.engine.undo(entryId)
    deps.onLog(`undo ${entryId}: ${result.ok ? 'ok' : 'fallo'}`)
    return result
  })
}
