import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AdbClient } from '../src/main/adb/adb-client'
import type { CommandResult } from '../src/main/adb/runner'
import { parseFileListing } from '../src/main/files/file-listing'
import {
  assertRemoteName,
  isProtectedRemotePath,
  normalizeRemotePath,
} from '../src/main/files/file-paths'
import { FileService } from '../src/main/files/file-service'

function ok(stdout = ''): CommandResult {
  return { code: 0, stdout, stderr: '', durationMs: 1, timedOut: false }
}

function failed(stdout = '', stderr = ''): CommandResult {
  return { code: 1, stdout, stderr, durationMs: 1, timedOut: false }
}

/** Cliente ADB falso: responde por comando y registra el historial. */
class FakeClient {
  readonly calls: string[] = []
  readonly pulled: Array<{ remote: string; localDir: string }> = []
  readonly pushed: Array<{ local: string; remote: string }> = []
  handler: (command: string) => CommandResult = () => ok()

  async shell(command: string): Promise<CommandResult> {
    this.calls.push(command)
    return this.handler(command)
  }

  async pull(remotePaths: string[], localDir: string): Promise<string[]> {
    return remotePaths.map((remote) => {
      this.pulled.push({ remote, localDir })
      return join(localDir, remote.split('/').pop() ?? 'archivo')
    })
  }

  async push(localPath: string, remotePath: string): Promise<string> {
    this.pushed.push({ local: localPath, remote: remotePath })
    return 'ok'
  }
}

function setup(handler?: (command: string) => CommandResult) {
  const client = new FakeClient()
  if (handler) client.handler = handler
  const service = new FileService(client as unknown as AdbClient)
  return { client, service }
}

describe('rutas remotas', () => {
  it('normaliza relativas, puntos y retrocesos', () => {
    expect(normalizeRemotePath('sdcard/Download/')).toBe('/sdcard/Download')
    expect(normalizeRemotePath('/sdcard/./Download/../Pictures')).toBe('/sdcard/Pictures')
    expect(normalizeRemotePath('//sdcard///Download')).toBe('/sdcard/Download')
    expect(normalizeRemotePath('/../../etc')).toBe('/etc')
    expect(normalizeRemotePath('')).toBe('/')
    expect(normalizeRemotePath('/')).toBe('/')
  })

  it('rechaza caracteres de control', () => {
    expect(() => normalizeRemotePath('/sdcard/a\u0000b')).toThrow(/inválida/i)
    expect(() => normalizeRemotePath('/sdcard/a\nb')).toThrow(/inválida/i)
  })

  it('protege las carpetas del sistema', () => {
    for (const path of [
      '/',
      '/sdcard',
      '/storage',
      '/system',
      '/data',
      '/vendor',
      '/product',
      '/apex',
      '/proc',
      '/sys',
    ]) {
      expect(isProtectedRemotePath(path)).toBe(true)
    }
    expect(isProtectedRemotePath('/sdcard/Download')).toBe(false)
    expect(isProtectedRemotePath('/data/local/tmp')).toBe(false)
    expect(isProtectedRemotePath('/system/bin')).toBe(false)
  })

  it('valida nombres simples', () => {
    expect(assertRemoteName('foto.jpg')).toBe('foto.jpg')
    for (const name of ['', ' ', '.', '..', 'a/b', 'a\nb']) {
      expect(() => assertRemoteName(name)).toThrow(/inválido/i)
    }
  })
})

describe('parseFileListing', () => {
  const iso = [
    'total 20',
    'drwxrwx--x 4 root sdcard_rw 4096 2024-05-01 10:20 Download',
    '-rw-r--r-- 1 root sdcard_rw  123 2024-05-01 10:21 notes.txt',
    'lrwxrwxrwx 1 root root        8 2024-05-01 10:22 link -> /sdcard/Download',
    '-rw-r--r-- 1 root root     9000 2024-05-01 10:23 app.apk',
    '-rw-r--r-- 1 root root      100 2024-05-01 10:24 bundle.apks',
    'drwxr-xr-x 2 root root     4096 2024-05-01 10:25 .',
    'drwxr-xr-x 2 root root     4096 2024-05-01 10:25 ..',
  ].join('\n')

  it('parsea el formato ISO y ordena carpetas primero', () => {
    const entries = parseFileListing('/sdcard', iso)

    expect(entries.map((entry) => entry.name)).toEqual([
      'Download',
      'app.apk',
      'bundle.apks',
      'link',
      'notes.txt',
    ])
    expect(entries[0]?.isDirectory).toBe(true)
    expect(entries[0]?.path).toBe('/sdcard/Download')
    expect(entries[0]?.mode).toBe('drwxrwx--x')
    expect(entries[1]?.isApk).toBe(true)
    expect(entries[2]?.isApk).toBe(true)
    expect(entries[3]?.isLink).toBe(true)
    expect(entries[3]?.path).toBe('/sdcard/link')
    expect(entries[4]?.sizeBytes).toBe(123)
    expect(entries[4]?.isApk).toBe(false)
  })

  it('parsea el formato antiguo y la raiz', () => {
    const old = [
      '-rw-r--r-- 1 root root 5 Jan  1 12:00 viejo.txt',
      'drwxr-xr-x 2 root root 0 Jan  1  2023 carpeta',
      'lrwxrwxrwx 1 root root 4 Feb 29  2024 enlace -> /data',
    ].join('\n')

    const entries = parseFileListing('/', old)

    expect(entries.map((entry) => entry.name)).toEqual(['carpeta', 'enlace', 'viejo.txt'])
    expect(entries[0]?.path).toBe('/carpeta')
    expect(entries[1]?.isLink).toBe(true)
    expect(entries[2]?.path).toBe('/viejo.txt')
  })
})

describe('FileService', () => {
  it('lista el directorio normalizado', async () => {
    const { client, service } = setup(() =>
      ok('drwxr-xr-x 2 root root 4096 2024-05-01 10:20 carpeta'),
    )

    const entries = await service.list('sdcard/Download')

    expect(client.calls).toEqual(["ls -la '/sdcard/Download'"])
    expect(entries[0]?.name).toBe('carpeta')
  })

  it('propaga la salida cuando ls falla', async () => {
    const { service } = setup(() => failed('ls: /priv: Permission denied'))

    await expect(service.list('/priv')).rejects.toThrow(/Permission denied/)
  })

  it('lee texto y rechaza contenido binario', async () => {
    const { service } = setup((command) => {
      if (command.startsWith('wc -c')) return ok('4 archivo')
      return ok('a\u0000b')
    })

    await expect(service.readText('/sdcard/bin.dat')).rejects.toThrow(/no es texto/i)
  })

  it('rechaza archivos mayores a 128 KB sin leerlos', async () => {
    const { client, service } = setup((command) => {
      if (command.startsWith('wc -c')) return ok('200000 archivo')
      return ok('contenido')
    })

    await expect(service.readText('/sdcard/grande.txt')).rejects.toThrow(/demasiado grande/i)
    expect(client.calls.some((command) => command.startsWith('head -c'))).toBe(false)
  })

  it('devuelve el texto cuando es pequeno', async () => {
    const { service } = setup((command) => {
      if (command.startsWith('wc -c')) return ok('3 archivo')
      return ok('hola')
    })

    await expect(service.readText('/sdcard/nota.txt')).resolves.toBe('hola')
  })

  it('crea carpetas y renombra con rutas citadas', async () => {
    const { client, service } = setup()

    await service.mkdir('/sdcard/Download', 'Nueva carpeta')
    await service.rename('/sdcard/Download/nota.txt', 'otra.txt')

    expect(client.calls).toEqual([
      "mkdir -p '/sdcard/Download/Nueva carpeta'",
      "mv '/sdcard/Download/nota.txt' '/sdcard/Download/otra.txt'",
    ])
  })

  it('rechaza nombres invalidos sin ejecutar comandos', async () => {
    const { client, service } = setup()

    await expect(service.mkdir('/sdcard', '../escape')).rejects.toThrow(/inválido/i)
    await expect(service.rename('/sdcard/a.txt', 'x/y')).rejects.toThrow(/inválido/i)
    expect(client.calls).toHaveLength(0)
  })

  it('borra rutas no protegidas y rechaza las protegidas', async () => {
    const { client, service } = setup()

    await service.remove('/sdcard/Download/tmp')
    expect(client.calls).toEqual(["rm -rf '/sdcard/Download/tmp'"])

    await expect(service.remove('/sdcard')).rejects.toThrow(/no se puede borrar/i)
    await expect(service.remove('/')).rejects.toThrow(/no se puede borrar/i)
    expect(client.calls).toHaveLength(1)
  })

  it('instala un APK con los flags permitidos', async () => {
    const { client, service } = setup(() => ok('Success'))

    const result = await service.installApk('/sdcard/app.apk', {
      grantPermissions: true,
      allowDowngrade: true,
      allowTest: true,
    })

    expect(result.ok).toBe(true)
    expect(client.calls).toEqual([
      "pm install -r -g -d -t '/sdcard/app.apk'",
    ])
  })

  it('falla la instalacion cuando Android responde Failure', async () => {
    const { service } = setup(() => ok('Failure [INSTALL_FAILED_VERSION_DOWNGRADE]'))

    await expect(service.installApk('/sdcard/app.apk')).rejects.toThrow(/INSTALL_FAILED/)
  })

  it('delega pull y push al cliente', async () => {
    const { client, service } = setup()

    const pulled = await service.pull('/sdcard/Download/nota.txt', '/tmp/salida')
    expect(pulled).toEqual({ directory: '/tmp/salida', files: ['nota.txt'] })
    expect(client.pulled).toEqual([{ remote: '/sdcard/Download/nota.txt', localDir: '/tmp/salida' }])

    const pushed = await service.push(['/tmp/a.txt', '/tmp/b.jpg'], '/sdcard/Download')
    expect(pushed.files).toEqual(['a.txt', 'b.jpg'])
    expect(client.pushed).toEqual([
      { local: '/tmp/a.txt', remote: '/sdcard/Download/a.txt' },
      { local: '/tmp/b.jpg', remote: '/sdcard/Download/b.jpg' },
    ])
  })
})
