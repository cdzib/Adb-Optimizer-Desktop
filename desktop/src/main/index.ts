import { app, BrowserWindow, session, shell } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AdbClient } from './adb/adb-client'
import { MdnsBrowser } from './adb/mdns-browser'
import { AppService, loadProtectedPackages } from './apps/app-service'
import { DpcService } from './apps/dpc-service'
import { ProcessRunner } from './adb/runner'
import { ScrcpySession } from './adb/scrcpy-session'
import { registerIpc } from './ipc'
import { loadCatalog } from './optimization/catalog'
import { Journal } from './optimization/journal'
import { RecipeEngine } from './optimization/recipe-engine'
import { isNavigationAllowed, isSafeExternalUrl } from './security'

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

let mdns: MdnsBrowser | null = null
let scrcpy: ScrcpySession | null = null

function resolveSharedDir(): string {
  const candidates = [
    process.env.ADB_OPTIMIZER_SHARED,
    isDev ? join(app.getAppPath(), '..', 'shared') : join(process.resourcesPath, 'shared'),
    join(__dirname, '..', '..', '..', 'shared'),
    join(__dirname, '..', '..', 'shared'),
  ].filter((value): value is string => Boolean(value))

  const found = candidates.find((candidate) => existsSync(join(candidate, 'recipes', 'recipes.json')))
  if (!found) {
    throw new Error(`No se encontro la carpeta shared. Buscado en: ${candidates.join(', ')}`)
  }
  return found
}

function resolveAdbPath(): string {
  const candidates = [
    process.env.ADB_PATH,
    join(process.resourcesPath, 'platform-tools', 'adb'),
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
  ].filter((value): value is string => Boolean(value))

  return candidates.find((candidate) => existsSync(candidate)) ?? 'adb'
}

function resolveFastbootPath(adbPath: string): string {
  const candidates = [
    process.env.FASTBOOT_PATH,
    adbPath === 'adb' ? null : join(dirname(adbPath), 'fastboot'),
    join(process.resourcesPath, 'platform-tools', 'fastboot'),
    '/opt/homebrew/bin/fastboot',
    '/usr/local/bin/fastboot',
  ].filter((value): value is string => Boolean(value))

  return candidates.find((candidate) => existsSync(candidate)) ?? 'fastboot'
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#e6ebed',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (current && !isNavigationAllowed(url, current)) {
      event.preventDefault()
    }
  })

  if (isDev) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL as string)
  } else {
    void window.loadFile(join(__dirname, '..', 'renderer', 'index.html'))
  }

  if (process.env.ADB_OPTIMIZER_SHOT_DIR) {
    void captureReviewShots(window)
  }

  return window
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    // La unica excepcion es copiar el script DPC desde la pantalla de aprovisionamiento.
    callback(permission === 'clipboard-sanitized-write')
  })

  const sharedDir = resolveSharedDir()
  const adbPath = resolveAdbPath()
  const fastbootPath = resolveFastbootPath(adbPath)

  const catalog = loadCatalog(sharedDir)
  const browser = new MdnsBrowser()
  browser.start()
  mdns = browser
  const runner = new ProcessRunner()
  const client = new AdbClient({ adbPath, runner })
  const journal = new Journal(join(app.getPath('userData'), 'journal.json'))
  const engine = new RecipeEngine(client, journal)
  const dpc = new DpcService(client)
  const apps = new AppService(
    client,
    journal,
    loadProtectedPackages(join(sharedDir, 'apps', 'protected-packages.json')),
  )

  const window = createWindow()

  const onLog = (line: string) => {
    if (!window.isDestroyed()) {
      window.webContents.send('app:log', line)
    }
  }
  const send = (channel: string, payload: unknown) => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
  scrcpy = new ScrcpySession({
    adbPath,
    onLog,
  })
  scrcpy.subscribe((status) => send('scrcpy:status', status))

  registerIpc({
    client,
    engine,
    apps,
    dpc,
    journal,
    catalog,
    sharedDir,
    adbPath,
    fastbootPath,
    dataDir: app.getPath('userData'),
    runner,
    mdns: browser,
    scrcpy,
    onLog,
    send,
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

/**
 * Hook de revision de diseno: captura las pantallas principales en PNG.
 * Solo corre si ADB_OPTIMIZER_SHOT_DIR esta definido. No afecta al uso normal.
 */
async function captureReviewShots(window: BrowserWindow): Promise<void> {
  const dir = process.env.ADB_OPTIMIZER_SHOT_DIR as string
  window.webContents.on('console-message', (_event, level, message) => {
    console.log('[renderer]', level, message)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.log('[renderer-gone]', details.reason, details.exitCode)
  })
  mkdirSync(dir, { recursive: true })
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const shot = async (name: string) => {
    await wait(450)
    const image = await window.webContents.capturePage()
    writeFileSync(join(dir, `${name}.png`), image.toPNG())
  }

  try {
    await wait(2200)
    console.log(
      '[shot] mdns app:',
      JSON.stringify(await window.webContents.executeJavaScript(`window.api.qrDiagnostics()`)),
    )
    await shot('01-devices')

    const clicked = await window.webContents.executeJavaScript(`(() => {
      const rows = [...document.querySelectorAll('.device-row')]
      for (const row of rows) {
        const button = [...row.querySelectorAll('button')].find(
          (b) => b.textContent.includes('Conectar') && !b.disabled
        )
        if (button) { button.click(); return 'click ok' }
      }
      return 'sin filas conectables'
    })()`)
    console.log('[shot] conectar:', clicked)
    await wait(6000)
    await window.webContents.executeJavaScript(
      `document.querySelectorAll('.nav-item')[1]?.click(); true`,
    )
    await wait(1500)
    await shot('02-dashboard')

    for (const [index, name] of [
      [2, '04-optimize'],
      [3, '05-apps'],
      [4, '06-dpc'],
      [5, '07-launcher'],
      [6, '08-root'],
      [7, '09-flash'],
      [8, '10-history'],
    ] as const) {
      await window.webContents.executeJavaScript(
        `document.querySelectorAll('.nav-item')[${index}]?.click(); true`,
      )
      await wait(2600)
      if (index === 3) {
        await window.webContents.executeJavaScript(
          `document.querySelector('.screen').scrollTop = 0; window.scrollTo(0, 0); true`,
        )
        await wait(500)
        console.log(
          '[shot] menu:',
          await window.webContents.executeJavaScript(`(() => {
            const button = document.querySelector('.app-row .row-actions button')
            if (!button) return 'sin boton'
            button.click()
            return 'click ok'
          })()`),
        )
        await wait(600)
      }
      await shot(name)
    }
  } catch (error) {
    console.error('[shot] error', error)
  } finally {
    app.quit()
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  mdns?.stop()
  scrcpy?.dispose()
})
