import { basename } from 'node:path'
import { dialog } from 'electron'
import type { IpcMain } from 'electron'
import type {
  InstallOptions,
  RemoteFileEntry,
} from '../../shared/types'
import { shellQuote } from '../adb/adb-client'
import type { AdbClient } from '../adb/adb-client'
import type { FeatureContext } from '../features/context'
import { requireDevice } from '../features/context'
import { assertLabAllowed } from '../lab'
import { parseFileListing } from './file-listing'
import {
  assertRemoteName,
  childRemotePath,
  isProtectedRemotePath,
  normalizeRemotePath,
  parentRemotePath,
} from './file-paths'

// El contrato del explorador vive en estos modulos; se reexportan aqui para que
// quien importe el servicio tenga las funciones puras a mano.
export * from './file-listing'
export * from './file-paths'

const LIST_TIMEOUT_MS = 20_000
const READ_TIMEOUT_MS = 20_000
const WRITE_TIMEOUT_MS = 30_000
const INSTALL_TIMEOUT_MS = 120_000
const MAX_TEXT_BYTES = 128 * 1024

/**
 * Explorador de archivos del dispositivo.
 *
 * Todo pasa por comandos POSIX sobre la sesion ADB activa: no se usa el
 * protocolo de sincronizacion. Las rutas se normalizan y se citan siempre; las
 * operaciones destructivas se validan antes de ejecutarse.
 */
export class FileService {
  constructor(private readonly client: AdbClient) {}

  async list(path: string): Promise<RemoteFileEntry[]> {
    const directory = normalizeRemotePath(path)
    const result = await this.client.shell(`ls -la ${shellQuote(directory)}`, LIST_TIMEOUT_MS)
    if (result.code !== 0) {
      throw new Error(failureOutput(result, `No se pudo abrir ${directory}.`))
    }
    return parseFileListing(directory, result.stdout)
  }

  async readText(path: string): Promise<string> {
    const target = normalizeRemotePath(path)
    const size = await this.sizeOf(target)
    if (size !== null && size > MAX_TEXT_BYTES) {
      throw new Error(`El archivo pesa ${size} bytes: es demasiado grande para verlo aquí.`)
    }

    const result = await this.client.shell(`head -c ${MAX_TEXT_BYTES} ${shellQuote(target)}`, READ_TIMEOUT_MS)
    if (result.code !== 0) {
      throw new Error(failureOutput(result, 'No se pudo leer el archivo.'))
    }
    if (result.stdout.includes('\u0000')) {
      throw new Error('El archivo no es texto.')
    }
    return result.stdout
  }

  async mkdir(parent: string, name: string): Promise<void> {
    const target = childRemotePath(parent, name)
    await this.run(`mkdir -p ${shellQuote(target)}`, 'No se pudo crear la carpeta.')
  }

  async rename(path: string, newName: string): Promise<void> {
    const source = normalizeRemotePath(path)
    const target = childRemotePath(parentRemotePath(source), newName)
    await this.run(`mv ${shellQuote(source)} ${shellQuote(target)}`, 'No se pudo renombrar.')
  }

  async remove(path: string): Promise<void> {
    const target = normalizeRemotePath(path)
    if (isProtectedRemotePath(target)) {
      throw new Error('Esa ruta no se puede borrar desde la app.')
    }
    await this.run(`rm -rf ${shellQuote(target)}`, 'No se pudo borrar.')
  }

  async installApk(path: string, options?: InstallOptions): Promise<{ ok: boolean; message: string }> {
    const target = normalizeRemotePath(path)
    const flags = ['-r']
    if (options?.grantPermissions) flags.push('-g')
    if (options?.allowDowngrade) flags.push('-d')
    if (options?.allowTest) flags.push('-t')

    const result = await this.client.shell(
      `pm install ${flags.join(' ')} ${shellQuote(target)}`,
      INSTALL_TIMEOUT_MS,
    )
    const output = `${result.stdout}\n${result.stderr}`.trim()
    if (result.code !== 0 || !/success/i.test(output)) {
      throw new Error(output || 'El dispositivo rechazó la instalación.')
    }
    return { ok: true, message: output }
  }

  async pull(path: string, localDir: string): Promise<{ directory: string; files: string[] }> {
    const target = normalizeRemotePath(path)
    const localFiles = await this.client.pull([target], localDir)
    return { directory: localDir, files: localFiles.map((file) => basename(file)) }
  }

  async push(localPaths: string[], targetDir: string): Promise<{ files: string[] }> {
    if (localPaths.length === 0) {
      throw new Error('Selecciona al menos un archivo para subir.')
    }
    const directory = normalizeRemotePath(targetDir)
    for (const localPath of localPaths) {
      const name = assertRemoteName(basename(localPath))
      const remotePath = childRemotePath(directory, name)
      await this.client.push(localPath, remotePath)
    }
    return { files: localPaths.map((file) => basename(file)) }
  }

  private async sizeOf(path: string): Promise<number | null> {
    const result = await this.client.shell(`wc -c ${shellQuote(path)}`, READ_TIMEOUT_MS)
    if (result.code !== 0) return null
    const raw = result.stdout.trim().split(/\s+/)[0] ?? ''
    const size = Number.parseInt(raw, 10)
    return Number.isFinite(size) ? size : null
  }

  private async run(command: string, failure: string): Promise<void> {
    const result = await this.client.shell(command, WRITE_TIMEOUT_MS)
    if (result.code !== 0) {
      throw new Error(failureOutput(result, failure))
    }
  }
}

function failureOutput(
  result: { stdout: string; stderr: string },
  fallback: string,
): string {
  return result.stdout.trim() || result.stderr.trim() || fallback
}

export function registerFilesIpc(ipc: IpcMain, ctx: FeatureContext): void {
  const service = new FileService(ctx.client)

  ipc.handle('files:list', async (_event, path: unknown) => {
    requireDevice(ctx.client)
    return service.list(assertPath(path))
  })

  ipc.handle('files:read', async (_event, path: unknown) => {
    requireDevice(ctx.client)
    return service.readText(assertPath(path))
  })

  ipc.handle('files:mkdir', async (_event, parent: unknown, name: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'crear carpetas')
    await service.mkdir(assertPath(parent), assertName(name))
  })

  ipc.handle('files:rename', async (_event, path: unknown, newName: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'renombrar archivos')
    await service.rename(assertPath(path), assertName(newName))
  })

  ipc.handle('files:delete', async (_event, path: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'borrar archivos')
    await service.remove(assertPath(path))
  })

  ipc.handle('files:install-apk', async (_event, path: unknown, options: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'instalar un APK desde el dispositivo')
    return service.installApk(assertPath(path), assertInstallOptions(options))
  })

  ipc.handle('files:pull', async (_event, path: unknown) => {
    requireDevice(ctx.client)
    const target = assertPath(path)
    const chosen = await dialog.showOpenDialog({
      title: 'Elegir carpeta de destino',
      buttonLabel: 'Descargar aquí',
      properties: ['openDirectory', 'createDirectory'],
    })
    const directory = chosen.filePaths[0]
    if (chosen.canceled || !directory) return null
    const result = await service.pull(target, directory)
    ctx.log(`files: ${target} → ${result.directory}`)
    return result
  })

  ipc.handle('files:push', async (_event, targetDir: unknown) => {
    requireDevice(ctx.client)
    assertLabAllowed(ctx.client.deviceSerial, 'subir archivos al dispositivo')
    const directory = assertPath(targetDir)
    const chosen = await dialog.showOpenDialog({
      title: 'Elegir archivos para subir',
      buttonLabel: 'Subir',
      properties: ['openFile', 'multiSelections'],
    })
    if (chosen.canceled || chosen.filePaths.length === 0) return null
    const result = await service.push(chosen.filePaths, directory)
    ctx.log(`files: ${result.files.length} archivo(s) → ${directory}`)
    return result
  })
}

function assertPath(value: unknown): string {
  if (typeof value !== 'string') throw new Error('La ruta no es válida.')
  return value
}

function assertName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('El nombre no es válido.')
  return assertRemoteName(value)
}

function assertInstallOptions(value: unknown): InstallOptions | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') throw new Error('Las opciones de instalación no son válidas.')
  const raw = value as Partial<InstallOptions>
  return {
    grantPermissions: raw.grantPermissions === true,
    allowDowngrade: raw.allowDowngrade === true,
    allowTest: raw.allowTest === true,
  }
}
