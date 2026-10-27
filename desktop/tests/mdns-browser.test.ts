import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Service } from 'bonjour-service'
import {
  MdnsBrowser,
  normalizeService,
  type MdnsBrowserHandle,
  type MdnsSource,
} from '../src/main/adb/mdns-browser'
import { isHostPort } from '../src/main/validation'

class FakeBrowser implements MdnsBrowserHandle {
  services: Service[] = []
  stop = vi.fn()
}

class FakeSource implements MdnsSource {
  readonly browsers = new Map<string, FakeBrowser>()
  destroy = vi.fn()

  find(options: { type: string }): FakeBrowser {
    const existing = this.browsers.get(options.type)
    if (existing) return existing
    const browser = new FakeBrowser()
    this.browsers.set(options.type, browser)
    return browser
  }
}

function service(partial: {
  name?: string
  port?: number
  addresses?: string[]
  host?: string
}): Service {
  return {
    name: partial.name ?? 'adb-1234',
    port: partial.port ?? 40000,
    addresses: partial.addresses ?? ['192.168.1.40'],
    host: partial.host ?? 'Pixel.local.',
  } as unknown as Service
}

function setup() {
  const source = new FakeSource()
  const browser = new MdnsBrowser({ createSource: () => source })
  browser.start()
  const pairing = source.find({ type: 'adb-tls-pairing' })
  const connect = source.find({ type: 'adb-tls-connect' })
  return { source, browser, pairing, connect }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MdnsBrowser', () => {
  it('mantiene un servicio vivo sin expirar por inactividad', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const { browser, pairing } = setup()

    pairing.services = [service({ port: 41021 })]

    expect(browser.list()).toHaveLength(1)
    vi.advanceTimersByTime(60_000)
    expect(browser.list()).toHaveLength(1)
    expect(browser.countByKind('pairing')).toBe(1)
  })

  it('quita el servicio cuando el navegador lo da de baja', () => {
    const { browser, pairing, connect } = setup()
    pairing.services = [service({ port: 41021 })]
    connect.services = [service({ port: 37211 })]

    expect(browser.list()).toHaveLength(2)

    pairing.services = []
    expect(browser.list().map((item) => item.kind)).toEqual(['connect'])
  })

  it('no descarta un servicio sin registro A: usa el host mDNS', () => {
    const { browser, pairing } = setup()
    pairing.services = [service({ port: 41021, addresses: [], host: 'Pixel-7.local.' })]

    const [entry] = browser.list()
    expect(entry?.address).toBe('Pixel-7.local:41021')
    expect(isHostPort(entry?.address)).toBe(true)
  })

  it('descarta un servicio sin puerto', () => {
    const { browser, pairing } = setup()
    pairing.services = [{ ...service({}), port: 0 } as unknown as Service]

    expect(browser.list()).toHaveLength(0)
  })

  it('no duplica la misma direccion del mismo tipo', () => {
    const { browser, pairing } = setup()
    pairing.services = [service({ port: 41021 }), service({ port: 41021, name: 'copia' })]

    expect(browser.list()).toHaveLength(1)
  })

  it('detiene los navegadores y destruye la fuente', () => {
    const { browser, source, pairing } = setup()
    pairing.services = [service({ port: 41021 })]

    browser.stop()

    expect(pairing.stop).toHaveBeenCalledTimes(1)
    expect(source.destroy).toHaveBeenCalledTimes(1)
    expect(browser.list()).toHaveLength(0)
  })
})

describe('normalizeService', () => {
  it('prefiere IPv4 y normaliza el punto final del host', () => {
    expect(
      normalizeService(
        { name: 'adb', port: 40000, addresses: ['fe80::1', '192.168.1.40'], host: 'Pixel.local.' },
        'pairing',
      ),
    ).toEqual({ kind: 'pairing', name: 'adb', address: '192.168.1.40:40000' })
  })

  it('descarta cuando no hay ni IPv4 ni host', () => {
    expect(
      normalizeService({ name: 'adb', port: 40000, addresses: [], host: '' }, 'connect'),
    ).toBeNull()
  })
})
