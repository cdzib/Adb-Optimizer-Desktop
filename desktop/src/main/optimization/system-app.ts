import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type {
  DeviceInfo,
  JournalEntry,
  SystemAppCandidate,
  SystemAppMetadata,
} from '../../shared/types'
import { AdbClient } from '../adb/adb-client'
import { assertLabAllowed } from '../lab'
import { Journal } from './journal'

const BACKUP_ROOT = '/data/local/tmp/adb-optimizer-apps'

/**
 * Convierte apps de usuario (instaladas en /data) en apps de sistema copiando
 * sus APKs a /system/priv-app o /system/app. Requiere escritura en /system.
 */
export class SystemAppService {
  constructor(
    private readonly client: AdbClient,
    private readonly journal: Journal,
    private readonly onProgress: (line: string) => void = () => undefined,
  ) {}

  /** Apps de terceros con su APK base (aptas para mover a /system). */
  async candidates(): Promise<SystemAppCandidate[]> {
    const [userRaw, systemRaw] = await Promise.all([
      this.client.shellText('pm list packages -3 -f', 60_000),
      this.client.shellText('pm list packages -s -f', 60_000).catch(() => ''),
    ])
    const systemPackages = new Set(
      systemRaw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('package:'))
        .map((line) => line.split('=').pop()?.trim() ?? ''),
    )
    const seen = new Set<string>()
    const result: SystemAppCandidate[] = []

    for (const line of userRaw.split('\n')) {
      const value = line.trim()
      if (!value.startsWith('package:')) continue
      const [path, packageName] = value.slice('package:'.length).split('=')
      if (!path || !packageName || !path.endsWith('.apk')) continue
      if (path.startsWith('/system/') || systemPackages.has(packageName)) continue
      if (!isPackageName(packageName) || seen.has(packageName)) continue
      seen.add(packageName)
      result.push({ packageName, apkPath: path, apkName: basename(path) })
    }

    return result.sort((a, b) => a.packageName.localeCompare(b.packageName))
  }

  async convert(input: {
    packageName: string
    privileged: boolean
    device: DeviceInfo
  }): Promise<JournalEntry> {
    assertLabAllowed(this.client.deviceSerial, 'convertir una app a sistema')
    if (!isPackageName(input.packageName)) throw new Error('El nombre del paquete no es válido.')

    const access = await this.client.probeSystemAccess()
    if (access.strategy === 'none') {
      throw new Error(
        `Este dispositivo no permite escribir en /system. ${access.reasons.join(' ')} ` +
          'Conéctalo con un build userdebug/eng o instala root (Magisk/KernelSU) y vuelve a intentarlo.',
      )
    }

    const userPackages = await this.client.shellText(`pm list packages -3 ${input.packageName}`, 20_000)
    if (!userPackages.includes(`package:${input.packageName}`)) {
      throw new Error(`${input.packageName} no es una app de usuario instalada en /data.`)
    }

    const remotePaths = await this.client.packageApkPaths(input.packageName)
    if (remotePaths.some((path) => path.startsWith('/system/'))) {
      throw new Error(`${input.packageName} ya tiene un APK en /system.`)
    }
    if (remotePaths.length > 12) {
      throw new Error(`El paquete expone ${remotePaths.length} APKs; demasiados splits para moverlo a /system.`)
    }

    const targetDir = `/system/${input.privileged ? 'priv-app' : 'app'}/${input.packageName}`
    const backupDir = `${BACKUP_ROOT}/${input.packageName}`
    const workDir = mkdtempSync(join(tmpdir(), 'adbopt-system-app-'))

    try {
      const localPaths = await this.client.pull(remotePaths, workDir)
      const files = localPaths.map((localPath) => ({
        localPath,
        remoteName: basename(localPath),
      }))
      const names = new Set(files.map((file) => file.remoteName))
      if (names.size !== files.length) throw new Error('Los APKs del paquete tienen nombres repetidos.')

      this.onProgress(`system-app: copiando ${input.packageName} a ${targetDir}`)
      const outcome = await this.client.installSystemBundle({
        files,
        targetDir,
        backupDir,
        mode: '0644',
        owner: '0:0',
      })

      const metadata: SystemAppMetadata = {
        packageName: input.packageName,
        targetDir,
        backupDir,
        files: files.map((file) => `${targetDir}/${file.remoteName}`),
        hadPrevious: outcome.hadPrevious,
      }
      const entry = this.journal.append({
        deviceId: input.device.id,
        deviceModel: `${input.device.manufacturer} ${input.device.model}`.trim(),
        recipeId: `system-app-${input.packageName}`,
        titleKey: 'systemApp.title',
        risk: 'advanced',
        steps: [{
          index: 0,
          run: `installSystemBundle ${targetDir}`,
          undo: 'restoreSystemBundle',
          previousValue: null,
          output: outcome.output,
          reversible: true,
          systemApp: metadata,
        }],
      })

      this.onProgress('system-app: APK copiado; reiniciando para que Android lo escanee')
      await this.client.rebootDevice()
      await this.client.waitForBoot()

      const after = await this.client.shellText(`pm path ${input.packageName}`, 20_000)
      if (!after.includes(targetDir)) {
        throw new Error(
          `Android no registró ${input.packageName} desde ${targetDir} tras reiniciar; el APK no fue escaneado. ` +
            'Usa "Restaurar cambios" para quitarlo.',
        )
      }
      const context = await this.client.systemFileContext(metadata.files[0] ?? targetDir)
      const contextToken = context.split(/\s+/).find((value) => value.startsWith('u:object_r:')) ?? (context || 'no disponible')
      const stored = this.journal.update(entry.id, {
        steps: [{
          ...entry.steps[0]!,
          output: [
            outcome.output,
            `apk: ${targetDir}`,
            `contexto: ${contextToken}`,
            `verificado: ${input.packageName} sigue instalada (copia de usuario conservada)`,
          ].filter(Boolean).join('\n'),
        }],
      })
      this.onProgress(`system-app: ${input.packageName} convertida a app de sistema`)
      return stored ?? entry
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  }
}

function isPackageName(value: string): boolean {
  return /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(value)
}
