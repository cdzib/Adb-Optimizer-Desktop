import type { IpcMain } from 'electron'
import type { AppInspection } from '../../shared/types'
import { shellQuote } from '../adb/adb-client'
import type { AdbClient } from '../adb/adb-client'
import type { FeatureContext } from '../features/context'
import { requireDevice } from '../features/context'
import { assertPackageName } from '../validation'
import {
  parseAppOps,
  parseInspectorComponents,
  parseInspectorPermissions,
  parseSha256,
  parseSignature,
} from './inspector-parser'

/**
 * Inventario de una app instalada: permisos, AppOps, componentes, firma y SHA-256.
 *
 * Todo se lee con comandos de solo lectura; si una parte falla (p. ej. `appops` en
 * fabricantes que lo restringen) se devuelve vacia en vez de romper la inspeccion.
 */
export class InspectorService {
  constructor(private readonly client: AdbClient) {}

  async inspect(packageName: string): Promise<AppInspection> {
    const pkg = assertPackageName(packageName)
    const dump = await this.client.shellText(`dumpsys package ${shellQuote(pkg)}`, 30_000)
    const appOpsRaw = await this.client
      .shell(`appops get ${shellQuote(pkg)}`, 20_000)
      .then((result) => result.stdout)
      .catch(() => '')

    return {
      packageName: pkg,
      permissions: parseInspectorPermissions(dump),
      appOps: parseAppOps(appOpsRaw),
      components: parseInspectorComponents(dump, pkg),
      signature: parseSignature(dump),
      apkSha256: await this.apkSha256(pkg),
    }
  }

  /** SHA-256 del APK base con `pm path` + `sha256sum`; cualquier fallo devuelve `null`. */
  private async apkSha256(packageName: string): Promise<string | null> {
    const paths = await this.client
      .shellText(`pm path ${shellQuote(packageName)}`, 20_000)
      .catch(() => '')
    const apkPath = paths
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('package:'))
      ?.slice('package:'.length)
      .trim()
    if (!apkPath || !apkPath.startsWith('/')) return null

    const digest = await this.client
      .shellText(`sha256sum ${shellQuote(apkPath)}`, 30_000)
      .catch(() => null)
    return parseSha256(digest)
  }
}

export function registerInspectorIpc(ipc: IpcMain, ctx: FeatureContext): void {
  const service = new InspectorService(ctx.client)

  ipc.handle('inspector:inspect', async (_event, packageName: unknown) => {
    requireDevice(ctx.client)
    return service.inspect(assertPackageName(packageName))
  })
}
