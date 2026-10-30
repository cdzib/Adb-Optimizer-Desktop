import { describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/adb-client'
import type { CommandResult, CommandRunner } from '../src/main/adb/runner'
import {
  parseAppOps,
  parseInspectorComponents,
  parseInspectorPermissions,
  parseSha256,
  parseSignature,
} from '../src/main/inspector/inspector-parser'
import { InspectorService } from '../src/main/inspector/inspector-service'

const DUMP = `Packages:
  Package [com.example.app] (a1b2c3):
    grantedPermissions:
      android.permission.INTERNET
    requested permissions:
      android.permission.INTERNET
      android.permission.CAMERA
      android.permission.POST_NOTIFICATIONS
    install permissions:
      android.permission.INTERNET: granted=true
    runtime permissions:
      android.permission.CAMERA: granted=false
      android.permission.POST_NOTIFICATIONS: granted=false
    User 0: installed=true
    signatures=PackageSignatures{a1b2c3 version:3, signatures:[71c782a3, 22ab]}
Activity Resolver Table:
  Non-Data Actions:
      android.intent.action.MAIN:
        a1b2c3 com.example.app/.MainActivity filter 1a2b
        d4e5f6 com.example.app/com.example.app.SecondActivity filter 99
        f0f0f0 com.other.app/.OtherActivity filter 12
Service Resolver Table:
        abc123 com.example.app/.SyncService filter 55
        abc124 com.example.app/.SyncService filter 55
Receiver Resolver Table:
        ac1234 com.example.app/.BootReceiver filter 7
Provider Resolver Table:
        aaa111 com.example.app/.provider.DataProvider filter 3
`

const OPS = `COARSE_LOCATION: allow
CAMERA: deny
CAMERA: allow
VIBRATE: default
`

const SHA = '71c782a3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f'

class ScriptedRunner implements CommandRunner {
  readonly commands: string[] = []

  constructor(private readonly handler: (command: string) => Partial<CommandResult> | string) {}

  async run(_bin: string, args: string[]): Promise<CommandResult> {
    const command = args[args.length - 1] ?? ''
    this.commands.push(command)
    const result = this.handler(command)
    const payload = typeof result === 'string' ? { stdout: result } : result
    return {
      code: payload.code ?? 0,
      stdout: payload.stdout ?? '',
      stderr: payload.stderr ?? '',
      durationMs: 1,
      timedOut: payload.timedOut ?? false,
    }
  }
}

function clientFor(handler: (command: string) => Partial<CommandResult> | string): {
  client: AdbClient
  runner: ScriptedRunner
} {
  const runner = new ScriptedRunner(handler)
  return {
    client: new AdbClient({ adbPath: '/usr/bin/adb', serial: 'emulator-5554', runner }),
    runner,
  }
}

describe('parseInspectorPermissions', () => {
  it('separa permisos pedidos de los concedidos y gana la concesion', () => {
    const permissions = parseInspectorPermissions(DUMP)

    expect(permissions).toEqual([
      { name: 'android.permission.INTERNET', granted: true },
      { name: 'android.permission.CAMERA', granted: false },
      { name: 'android.permission.POST_NOTIFICATIONS', granted: false },
    ])
  })

  it('ignora lineas que no son permisos y deduplica conservando true', () => {
    const dump = `    requested permissions:
      android.permission.A
      android.permission.A
      not a permission
    install permissions:
      android.permission.A: granted=false
      android.permission.A: granted=true
`
    expect(parseInspectorPermissions(dump)).toEqual([
      { name: 'android.permission.A', granted: true },
    ])
  })

  it('devuelve lista vacia cuando el volcado no trae permisos', () => {
    expect(parseInspectorPermissions('Package [x] (y):\n')).toEqual([])
  })
})

describe('parseInspectorComponents', () => {
  it('clasifica por tabla, filtra el paquete y deduplica', () => {
    const components = parseInspectorComponents(DUMP, 'com.example.app')

    expect(components).toEqual([
      { kind: 'activity', className: '.MainActivity' },
      { kind: 'activity', className: 'com.example.app.SecondActivity' },
      { kind: 'service', className: '.SyncService' },
      { kind: 'receiver', className: '.BootReceiver' },
      { kind: 'provider', className: '.provider.DataProvider' },
    ])
  })

  it('no inventa componentes de un paquete distinto', () => {
    expect(parseInspectorComponents(DUMP, 'com.other.app')).toEqual([
      { kind: 'activity', className: '.OtherActivity' },
    ])
  })
})

describe('parseAppOps', () => {
  it('lee nombre y modo, quedandose con el primero de cada nombre', () => {
    expect(parseAppOps(OPS)).toEqual([
      { name: 'COARSE_LOCATION', mode: 'allow' },
      { name: 'CAMERA', mode: 'deny' },
      { name: 'VIBRATE', mode: 'default' },
    ])
  })

  it('descarta lineas con formato inesperado', () => {
    expect(parseAppOps('Uid mode: COARSE_LOCATION: allow\nlower_case: allow\n')).toEqual([])
  })
})

describe('firma y sha256', () => {
  it('formatea la version de firma con sus hashes', () => {
    expect(parseSignature(DUMP)).toBe('v3 · 71c782a3, 22ab')
  })

  it('devuelve null sin bloque de firmas o sin hashes', () => {
    expect(parseSignature('Package [x]:\n')).toBeNull()
    expect(
      parseSignature('signatures=PackageSignatures{abc version:3, signatures:[]}'),
    ).toBeNull()
  })

  it('normaliza el sha256 a minusculas y rechaza entradas invalidas', () => {
    expect(parseSha256(`${SHA.toUpperCase()}  /data/app/base.apk`)).toBe(SHA)
    expect(parseSha256(null)).toBeNull()
    expect(parseSha256('no es un hash')).toBeNull()
  })
})

describe('InspectorService', () => {
  const responses: Record<string, Partial<CommandResult> | string> = {
    'dumpsys package': DUMP,
    'appops get': OPS,
    'pm path': 'package:/data/app/~~abc==/com.example.app-xyz==/base.apk\n',
    sha256sum: `${SHA}  /data/app/~~abc==/com.example.app-xyz==/base.apk\n`,
  }

  const handler = (command: string): Partial<CommandResult> | string => {
    const key = Object.keys(responses).find((prefix) => command.startsWith(prefix))
    return key ? (responses[key] as Partial<CommandResult> | string) : ''
  }

  it('compone la inspeccion completa', async () => {
    const { client, runner } = clientFor(handler)
    const inspection = await new InspectorService(client).inspect('com.example.app')

    expect(inspection.packageName).toBe('com.example.app')
    expect(inspection.permissions).toHaveLength(3)
    expect(inspection.appOps).toEqual([
      { name: 'COARSE_LOCATION', mode: 'allow' },
      { name: 'CAMERA', mode: 'deny' },
      { name: 'VIBRATE', mode: 'default' },
    ])
    expect(inspection.components).toHaveLength(5)
    expect(inspection.signature).toBe('v3 · 71c782a3, 22ab')
    expect(inspection.apkSha256).toBe(SHA)
    expect(runner.commands[0]).toContain('dumpsys package')
    expect(runner.commands[1]).toContain('appops get')
  })

  it('deja appOps vacio cuando `appops get` falla', async () => {
    const { client } = clientFor((command) => {
      if (command.startsWith('appops get')) {
        return { code: -1, stderr: 'ENOENT: adb not found' }
      }
      return handler(command)
    })

    const inspection = await new InspectorService(client).inspect('com.example.app')
    expect(inspection.appOps).toEqual([])
    expect(inspection.permissions.length).toBeGreaterThan(0)
  })

  it('deja el sha256 en null si `pm path` no devuelve una ruta valida', async () => {
    const { client } = clientFor((command) =>
      command.startsWith('pm path') ? 'package:\n' : handler(command),
    )
    const inspection = await new InspectorService(client).inspect('com.example.app')
    expect(inspection.apkSha256).toBeNull()
  })

  it('rechaza paquetes invalidos antes de ejecutar comandos', async () => {
    const { client, runner } = clientFor(handler)
    await expect(new InspectorService(client).inspect('../../etc/passwd')).rejects.toThrow(
      /paquete no es valido/i,
    )
    expect(runner.commands).toEqual([])
  })
})
