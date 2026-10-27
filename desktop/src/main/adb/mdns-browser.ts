import { Bonjour, type Service } from 'bonjour-service'
import type { MdnsService } from '../../shared/types'

const PAIRING = 'adb-tls-pairing'
const CONNECT = 'adb-tls-connect'
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/** Vista mínima de un navegador mDNS: lo justo para inventariar y detenerlo. */
export interface MdnsBrowserHandle {
  readonly services: Service[]
  stop(): void
}

/** Fuente inyectable para poder probar el inventario sin red. */
export interface MdnsSource {
  find(options: { type: string }): MdnsBrowserHandle
  destroy(): void
}

export interface MdnsBrowserOptions {
  createSource?: () => MdnsSource
}

interface Entry {
  kind: MdnsService['kind']
  browser: MdnsBrowserHandle
}

/**
 * Descubrimiento mDNS propio (Bonjour) en lugar de `adb mdns services`.
 *
 * Motivo: comprobado en macOS con platform-tools 37.0.1, `adb devices -l` muestra
 * servicios `_adb-tls-connect` descubiertos pero `adb mdns services` devuelve una
 * lista vacia. Eso hacia que el flujo QR nunca viera `_adb-tls-pairing`.
 */
export class MdnsBrowser {
  private source: MdnsSource | null = null
  private browsers: Entry[] = []

  constructor(private readonly options: MdnsBrowserOptions = {}) {}

  start(): void {
    if (this.source) return
    this.source = this.options.createSource ? this.options.createSource() : defaultSource()
    for (const [type, kind] of [
      [PAIRING, 'pairing'],
      [CONNECT, 'connect'],
    ] as const) {
      this.browsers.push({ kind, browser: this.source.find({ type }) })
    }
  }

  stop(): void {
    for (const { browser } of this.browsers) browser.stop()
    this.browsers = []
    this.source?.destroy()
    this.source = null
  }

  /**
   * Inventario en vivo derivado de lo que cada navegador mantiene ahora mismo.
   *
   * No hay caducidad propia a proposito: `bonjour-service` emite `up` una sola vez
   * por servicio y no lo repite en los anuncios siguientes, asi que un temporizador
   * local borraba el servicio para siempre a los 20 s aunque el dispositivo siguiera
   * anunciandose. La baja llega por el evento `down` (o el goodbye mDNS) del paquete.
   */
  list(): MdnsService[] {
    const unique = new Map<string, MdnsService>()
    for (const { kind, browser } of this.browsers) {
      for (const service of browser.services) {
        const normalized = normalizeService(service, kind)
        if (!normalized) continue
        const key = `${normalized.kind}:${normalized.address}`
        if (!unique.has(key)) unique.set(key, normalized)
      }
    }
    return [...unique.values()].sort((a, b) => a.address.localeCompare(b.address))
  }

  countByKind(kind: MdnsService['kind']): number {
    return this.list().filter((service) => service.kind === kind).length
  }
}

function defaultSource(): MdnsSource {
  const bonjour = new Bonjour()
  return {
    find: (options) => bonjour.find({ type: options.type }) as unknown as MdnsBrowserHandle,
    destroy: () => bonjour.destroy(),
  }
}

/**
 * Prefiere IPv4 para poder escribir `ip:puerto`. Si el paquete no trajo registro A
 * se usa el nombre del host (`.local`), que `adb` resuelve por mDNS y que
 * `assertHostPort` acepta como hostname.
 */
export function normalizeService(
  service: Pick<Service, 'name' | 'port' | 'addresses' | 'host'>,
  kind: MdnsService['kind'],
): MdnsService | null {
  if (!service.port) return null

  const ipv4 = (service.addresses ?? []).find((address) => IPV4.test(address))
  const host = ipv4 ?? cleanHost(service.host)
  if (!host) return null

  return {
    kind,
    name: service.name || host,
    address: `${host}:${service.port}`,
  }
}

/** El target mDNS suele venir con punto final (`Pixel.local.`); no es un hostname valido. */
function cleanHost(host: string | undefined): string | undefined {
  const trimmed = host?.trim().replace(/\.+$/, '')
  return trimmed ? trimmed : undefined
}
