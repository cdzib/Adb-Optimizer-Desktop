import { describe, expect, it, vi } from 'vitest'
import type { AdbClient } from '../src/main/adb/adb-client'
import { buildQrPayload, generateCredentials, QrPairingSession } from '../src/main/adb/qr-pairing'
import type { DeviceInfo, MdnsService, QrStatus } from '../src/shared/types'

const DEVICE: DeviceInfo = {
  id: '192.168.1.40:37211',
  model: 'Pixel 7',
  manufacturer: 'Google',
  sdk: 34,
  androidVersion: '14',
  isTv: false,
  hasRoot: false,
  abi: 'arm64-v8a',
}

class FakeClient {
  services: MdnsService[] = []
  readonly paired: Array<{ address: string; password: string }> = []
  readonly connected: string[] = []
  selected: string | null = null
  pairResult = { ok: true, message: 'Successfully paired to 192.168.1.40:41021' }

  async mdnsServices(): Promise<MdnsService[]> {
    return this.services
  }
  async pair(address: string, password: string) {
    this.paired.push({ address, password })
    return this.pairResult
  }

  async connect(address: string) {
    this.connected.push(address)
    return { ok: true, message: `connected to ${address}` }
  }

  useDevice(serial: string) {
    this.selected = serial
  }

  async getInfo(): Promise<DeviceInfo> {
    return DEVICE
  }
}

function setup(
  options: {
    timeoutMs?: number
    initialServices?: MdnsService[]
    fallback?: () => Promise<MdnsService[]>
    connectFallbackMs?: number
    now?: () => number
  } = {},
) {
  const client = new FakeClient()
  client.services = options.initialServices ?? []
  const statuses: QrStatus[] = []
  const state = { discoverCalls: 0 }

  const session = new QrPairingSession({
    client: client as unknown as AdbClient,
    discover: () => {
      state.discoverCalls += 1
      return client.services
    },
    fallbackDiscover: options.fallback,
    connectFallbackMs: options.connectFallbackMs,
    now: options.now,
    onStatus: (status) => statuses.push(status),
    autoLoop: false,
    timeoutMs: options.timeoutMs,
    pollMs: 1,
  })

  return { client, session, statuses, state }
}

describe('QR de vinculacion (flujo del proyecto de referencia)', () => {
  it('genera el payload WIFI:T:ADB con nombre y password', () => {
    expect(buildQrPayload('ADB_WIFI_ABC123', 'K7H2M9PQ')).toBe(
      'WIFI:T:ADB;S:ADB_WIFI_ABC123;P:K7H2M9PQ;;',
    )
  })

  it('genera credenciales con el formato esperado', () => {
    const { name, password } = generateCredentials(() => 0)
    expect(name).toMatch(/^ADB_WIFI_[A-Z2-9]{6}$/)
    expect(password).toMatch(/^[A-Z2-9]{8}$/)
  })

  it('vincula con el servicio de pairing y luego conecta por TLS', async () => {
    const { client, session, statuses } = setup()
    const started = await session.start()

    expect(started.qrText).toBe(`WIFI:T:ADB;S:${started.name};P:${started.password};;`)
    expect(statuses.at(0)?.state).toBe('waiting')

    client.services = [
      { kind: 'pairing', name: 'adb-1234', address: '192.168.1.40:41021' },
    ]
    await session.pollOnce()

    expect(client.paired).toEqual([
      { address: '192.168.1.40:41021', password: started.password },
    ])
    expect(statuses.some((status) => status.state === 'connecting')).toBe(true)

    client.services = [
      { kind: 'connect', name: 'adb-1234', address: '192.168.1.40:37211' },
    ]
    await session.pollOnce()

    expect(client.connected).toEqual(['192.168.1.40:37211'])
    expect(client.selected).toBe('192.168.1.40:37211')
    expect(statuses.at(-1)?.state).toBe('connected')
    expect(statuses.at(-1)?.device?.model).toBe('Pixel 7')
  })

  it('intenta un servicio que ya existia antes del QR: el password decide', async () => {
    // Caso real: el dispositivo ya estaba en "Vincular con QR" cuando se genero el codigo.
    const existing: MdnsService = {
      kind: 'pairing',
      name: 'ADB_WIFI_VIEJO',
      address: '192.168.1.99:40000',
    }
    const { client, session } = setup({ initialServices: [existing] })

    await session.start()
    client.services = [existing]
    await session.pollOnce()

    expect(client.paired).toHaveLength(1)
    expect(client.paired[0]?.address).toBe('192.168.1.99:40000')
  })

  it('no conecta a un host distinto del vinculado', async () => {
    const { client, session } = setup()
    await session.start()

    client.services = [{ kind: 'pairing', name: 'adb', address: '192.168.1.40:41021' }]
    await session.pollOnce()

    client.services = [{ kind: 'connect', name: 'otro', address: '192.168.1.77:37211' }]
    await session.pollOnce()

    expect(client.connected).toHaveLength(0)
  })

  it('reporta error si el dispositivo rechaza la vinculacion', async () => {
    const { client, session, statuses } = setup()
    client.pairResult = { ok: false, message: 'Failed to authenticate' }
    await session.start()

    client.services = [{ kind: 'pairing', name: 'adb', address: '192.168.1.40:41021' }]
    await session.pollOnce()

    const last = statuses.at(-1)
    expect(last?.state).toBe('error')
    expect(last?.message).toContain('Failed to authenticate')
    expect(client.connected).toHaveLength(0)
  })

  it('reintenta la misma direccion despues del cooldown', async () => {
    let now = 1_000
    const client = new FakeClient()
    const statuses: QrStatus[] = []
    const session = new QrPairingSession({
      client: client as unknown as AdbClient,
      discover: () => client.services,
      onStatus: (status) => statuses.push(status),
      autoLoop: false,
      pollMs: 1,
      retryAfterMs: 5_000,
      now: () => now,
      timeoutMs: 60_000,
    })

    await session.start()
    client.services = [{ kind: 'pairing', name: 'adb', address: '10.0.0.5:40000' }]
    client.pairResult = { ok: false, message: 'rechazado' }
    await session.pollOnce()
    expect(client.paired).toHaveLength(1)

    client.pairResult = { ok: true, message: 'Successfully paired' }
    now = 3_000
    await session.pollOnce()
    expect(client.paired).toHaveLength(1)

    now = 8_000
    await session.pollOnce()
    expect(client.paired).toHaveLength(2)
    expect(statuses.some((status) => status.state === 'connecting')).toBe(true)
  })

  it('expira cuando nadie escanea el QR', async () => {
    const { session, statuses } = setup({ timeoutMs: 0 })
    await session.start()
    await session.pollOnce()

    expect(statuses.at(-1)?.state).toBe('timeout')
  })

  it('consulta el respaldo cuando el puerto TLS no aparece en Bonjour', async () => {
    const CONNECT_SERVICE: MdnsService = {
      kind: 'connect',
      name: 'adb-1234',
      address: '192.168.1.40:37211',
    }
    const { client, session } = setup({ fallback: async () => [CONNECT_SERVICE] })
    await session.start()

    client.services = [{ kind: 'pairing', name: 'adb', address: '192.168.1.40:41021' }]
    await session.pollOnce()
    client.services = []

    await session.pollOnce()

    expect(client.connected).toEqual(['192.168.1.40:37211'])
  })

  it('no repite el respaldo antes del enfriamiento', async () => {
    let now = 1_000
    let calls = 0
    const { client, session } = setup({
      now: () => now,
      connectFallbackMs: 5_000,
      fallback: async () => {
        calls += 1
        return []
      },
    })
    await session.start()
    client.services = [{ kind: 'pairing', name: 'adb', address: '10.0.0.5:40000' }]
    await session.pollOnce()

    await session.pollOnce()
    expect(calls).toBe(1)

    now = 3_000
    await session.pollOnce()
    expect(calls).toBe(1)

    now = 8_000
    await session.pollOnce()
    expect(calls).toBe(2)
  })

  it('sondea cada 300 ms por defecto', async () => {
    vi.useFakeTimers()
    const client = new FakeClient()
    let calls = 0
    const session = new QrPairingSession({
      client: client as unknown as AdbClient,
      discover: () => {
        calls += 1
        return []
      },
      onStatus: () => {},
      timeoutMs: 60_000,
    })

    await session.start()
    await vi.advanceTimersByTimeAsync(299)
    expect(calls).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toBe(1)
    session.cancel()
    vi.useRealTimers()
  })

  it('cancelar detiene el sondeo y no emite estados nuevos', async () => {
    const { session, statuses } = setup()
    await session.start()
    const before = statuses.length

    session.cancel()
    await session.pollOnce()

    expect(statuses).toHaveLength(before)
  })
})
