import { describe, expect, it } from 'vitest'
import type { AdbClient } from '../src/main/adb/adb-client'
import {
  countAccounts,
  DpcService,
  evaluatePreflight,
  parseOwners,
  parseReceivers,
  parseUsers,
} from '../src/main/apps/dpc-service'
import { buildProvisionScript, shellQuote } from '../src/main/apps/dpc-script'

const OWNERS_RAW =
  'User 150: admin=com.samsung.knox.securefolder/.containeragent.detector.KnoxDeviceAdminReceiver,ManagedProfileOwner(parentUserId=0)\n'

const USERS_RAW = `Users:
\tUserInfo{0:Cesar Dzib:4c13} running
\tUserInfo{95:DUAL_APP:20001010} running
\tUserInfo{150:Secure Folder:61010} running
`

const RECEIVERS_RAW = `11 receivers found:
  Receiver #0:
    priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false
    com.google.android.gms/.mdm.receivers.MdmDeviceAdminReceiver
  Receiver #1:
    com.microsoft.appmanager/com.microsoft.workaccount.workplacejoin.core.WPJAdminReceiver
`

describe('parsers de DPC', () => {
  it('extrae el owner existente', () => {
    expect(parseOwners(OWNERS_RAW)).toEqual([
      'com.samsung.knox.securefolder/.containeragent.detector.KnoxDeviceAdminReceiver',
    ])
  })

  it('extrae usuarios con id y nombre', () => {
    expect(parseUsers(USERS_RAW)).toEqual([
      { id: 0, name: 'Cesar Dzib' },
      { id: 95, name: 'DUAL_APP' },
      { id: 150, name: 'Secure Folder' },
    ])
  })

  it('extrae componentes receiver sin duplicados', () => {
    expect(parseReceivers(`${RECEIVERS_RAW}  Receiver #2:\n    com.google.android.gms/.mdm.receivers.MdmDeviceAdminReceiver\n`)).toEqual([
      'com.google.android.gms/.mdm.receivers.MdmDeviceAdminReceiver',
      'com.microsoft.appmanager/com.microsoft.workaccount.workplacejoin.core.WPJAdminReceiver',
    ])
  })

  it('cuenta solo cuentas reales', () => {
    const raw = 'Account {name=null, type=null}\nAccount {name=a@b.com, type=com.google}\nAccount {name=c@d.com, type=com.google}\n'
    expect(countAccounts(raw)).toBe(2)
  })
})

describe('preflight de aprovisionamiento', () => {
  it('aprueba un dispositivo limpio', () => {
    const result = evaluatePreflight({
      sdk: 34,
      owners: [],
      users: [{ id: 0, name: 'owner' }],
      accounts: 0,
    })

    expect(result.ready).toBe(true)
    expect(result.checks.every((check) => check.status !== 'fail')).toBe(true)
  })

  it('en modo profile exige un usuario secundario y no bloquea por cuentas', () => {
    const conPerfil = evaluatePreflight({
      sdk: 34,
      owners: [],
      users: [
        { id: 0, name: 'Owner' },
        { id: 10, name: 'Trabajo' },
      ],
      accounts: 3,
      mode: 'profile',
    })
    expect(conPerfil.ready).toBe(true)

    const sinPerfil = evaluatePreflight({
      sdk: 34,
      owners: [],
      users: [{ id: 0, name: 'Owner' }],
      accounts: 0,
      mode: 'profile',
    })
    expect(sinPerfil.ready).toBe(false)
    expect(sinPerfil.checks.find((check) => check.id === 'users')?.status).toBe('fail')
  })

  it('bloquea con usuarios extra, owner previo y cuentas', () => {
    const result = evaluatePreflight({
      sdk: 36,
      owners: ['com.samsung.knox.securefolder/.x'],
      users: [
        { id: 0, name: 'Cesar' },
        { id: 150, name: 'Secure Folder' },
      ],
      accounts: 45,
    })

    expect(result.ready).toBe(false)
    expect(result.checks.filter((check) => check.status === 'fail').map((check) => check.id)).toEqual([
      'owner',
      'users',
      'accounts',
    ])
    expect(result.checks.find((check) => check.id === 'users')?.detail).toContain('150:Secure Folder')
  })
})

describe('DpcService', () => {
  class FakeClient {
    readonly calls: string[] = []
    owner = false

    async shellText(command: string): Promise<string> {
      this.calls.push(command)
      if (command === 'dpm list-owners') {
        return this.owner ? 'User 0: admin=com.test.dpc/.Admin\n' : ''
      }
      if (command === 'pm list users') return 'Users:\n\tUserInfo{0:Owner:1} running\n'
      if (command === 'dumpsys account') return ''
      if (command === 'getprop ro.build.version.sdk') return '34'
      if (command.startsWith('cmd package query-receivers')) {
        return '2 receivers found:\n  Receiver #0:\n    com.test.dpc/.Admin\n    com.otro.app/.Admin\n'
      }
      return ''
    }

    async shell(command: string) {
      this.calls.push(command)
      if (command.startsWith('dpm set-device-owner')) {
        this.owner = true
        return { code: 0, stdout: 'Success: Device owner set to package com.test.dpc', stderr: '', durationMs: 1, timedOut: false }
      }
      if (command.startsWith('dpm set-profile-owner')) {
        return { code: 0, stdout: 'Success: Profile owner set', stderr: '', durationMs: 1, timedOut: false }
      }
      return { code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false }
    }

    async install() {
      return 'Performing Streamed Install\nSuccess'
    }
  }

  it('aprueba el preflight y filtra receivers por paquete', async () => {
    const client = new FakeClient()
    const service = new DpcService(client as unknown as AdbClient)

    const preflight = await service.preflight()
    expect(preflight.ready).toBe(true)

    const receivers = await service.receivers('com.test.dpc')
    expect(receivers).toEqual(['com.test.dpc/.Admin'])
  })

  it('usa set-device-owner con --user 0 y verifica la respuesta', async () => {
    const client = new FakeClient()
    const service = new DpcService(client as unknown as AdbClient)

    const result = await service.setOwner('com.test.dpc/.Admin', 'device')
    expect(result.ok).toBe(true)
    expect(client.calls).toContain('dpm set-device-owner --user 0 com.test.dpc/.Admin')
  })

  it('rechaza componentes con inyeccion sin ejecutar comandos', async () => {
    const client = new FakeClient()
    const service = new DpcService(client as unknown as AdbClient)

    await expect(
      service.setOwner('com.test.dpc/.Admin; reboot', 'device'),
    ).rejects.toThrow(/componente/)
    await expect(
      service.removeOwner('com.test.dpc/.Admin && reboot'),
    ).rejects.toThrow(/componente/)
    expect(client.calls).toHaveLength(0)
  })

  it('rechaza nombres de paquete invalidos al filtrar receivers', async () => {
    const client = new FakeClient()
    const service = new DpcService(client as unknown as AdbClient)

    await expect(service.receivers('com.test.dpc; reboot')).rejects.toThrow(/no es valido/)
    expect(client.calls).toHaveLength(0)
  })

  it('reporta fallo cuando el dispositivo rechaza el owner', async () => {
    const client = new FakeClient()
    client.shell = async () => ({
      code: 0,
      stdout: 'Error: Not allowed to set the device owner because there are already several users',
      stderr: '',
      durationMs: 1,
      timedOut: false,
    })
    const service = new DpcService(client as unknown as AdbClient)

    const result = await service.setOwner('com.test.dpc/.Admin', 'device')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('several users')
  })
})

describe('script de aprovisionamiento', () => {
  it('escapa comillas simples', () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'")
  })

  it('genera un script con el componente y el comando correcto', () => {
    const script = buildProvisionScript({
      serial: '192.168.1.10:5555',
      apkPath: '/tmp/dpc.apk',
      component: 'com.test.dpc/.Admin',
      mode: 'device',
    })

    expect(script).toContain('dpm set-device-owner --user 0')
    expect(script).toContain('com.test.dpc/.Admin')
    expect(script).toContain('192.168.1.10:5555')
    expect(script).toContain('install -r -g')
  })

  it('usa set-profile-owner en modo profile', () => {
    const script = buildProvisionScript({
      serial: 'x',
      apkPath: '/tmp/dpc.apk',
      component: 'com.test.dpc/.Admin',
      mode: 'profile',
    })
    expect(script).toContain('dpm set-profile-owner --user 0')
  })
})
