import { randomInt } from 'node:crypto'
import type { MdnsService, QrStartResult, QrStatus } from '../../shared/types'
import type { AdbClient } from './adb-client'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function buildQrPayload(name: string, password: string): string {
  return `WIFI:T:ADB;S:${name};P:${password};;`
}

export function generateCredentials(
  random: (max: number) => number = (max) => randomInt(max),
): { name: string; password: string } {
  const token = (length: number) =>
    Array.from({ length }, () => ALPHABET[random(ALPHABET.length)]).join('')

  return {
    name: `ADB_WIFI_${token(6)}`,
    password: token(8),
  }
}

export interface QrPairingOptions {
  client: AdbClient
  /** Descubrimiento mDNS (Bonjour). Se inyecta para poder probarlo. */
  discover: () => MdnsService[] | Promise<MdnsService[]>
  onStatus: (status: QrStatus) => void
  pollMs?: number
  timeoutMs?: number
  /** Tiempo antes de reintentar una direccion que ya fallo. */
  retryAfterMs?: number
  /**
   * Respaldo para el puerto TLS cuando el descubrimiento principal no lo ve
   * (por ejemplo `adb mdns services`). Se consulta con enfriamiento.
   */
  fallbackDiscover?: () => Promise<MdnsService[]>
  /** Tiempo minimo entre consultas al descubrimiento de respaldo. */
  connectFallbackMs?: number
  now?: () => number
  /** Desactivado en tests para controlar `pollOnce()` manualmente. */
  autoLoop?: boolean
}

/**
 * Mismo flujo que el proyecto web de referencia:
 * 1. La app muestra un QR `WIFI:T:ADB;S:<nombre>;P:<password>;;`.
 * 2. El dispositivo lo escanea desde Depuracion inalambrica > Vincular con QR.
 * 3. Aparece `_adb-tls-pairing`; se vincula con `adb pair ip:puerto password`.
 * 4. Aparece `_adb-tls-connect` en el mismo host; se conecta con `adb connect`.
 */
export class QrPairingSession {
  private readonly pollMs: number
  private readonly timeoutMs: number
  private readonly retryAfterMs: number
  private readonly connectFallbackMs: number
  private readonly autoLoop: boolean
  private readonly now: () => number

  private timer: NodeJS.Timeout | null = null
  private deadline = 0
  private password = ''
  private pairedHost: string | null = null
  private failed = new Map<string, number>()
  private lastFallbackAt = Number.NEGATIVE_INFINITY
  private busy = false
  private finished = true

  constructor(private readonly options: QrPairingOptions) {
    this.pollMs = options.pollMs ?? 300
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.retryAfterMs = options.retryAfterMs ?? 8000
    this.connectFallbackMs = options.connectFallbackMs ?? 5000
    this.autoLoop = options.autoLoop ?? true
    this.now = options.now ?? Date.now
  }

  async start(): Promise<QrStartResult> {
    this.cancel()

    const { name, password } = generateCredentials()
    this.password = password
    this.pairedHost = null
    this.failed.clear()
    this.lastFallbackAt = Number.NEGATIVE_INFINITY
    this.finished = false
    this.deadline = this.now() + this.timeoutMs

    // No se descartan servicios previos a proposito: si el dispositivo ya estaba en
    // modo "Vincular con QR" al generar el codigo, su servicio existe desde antes.
    // El password es lo que decide: un servicio viejo falla y se reintenta con backoff,
    // y en cuanto el dispositivo escanea el QR nuevo vuelve a aceptar.
    this.emit({ state: 'waiting' })
    if (this.autoLoop) this.schedule()

    return {
      name,
      password,
      qrText: buildQrPayload(name, password),
      expiresInMs: this.timeoutMs,
    }
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.finished = true
  }

  /** Un ciclo del flujo. Publico para poder probarlo sin temporizadores. */
  async pollOnce(): Promise<void> {
    if (this.finished || this.busy) return
    if (this.now() >= this.deadline) {
      this.finish({ state: 'timeout' })
      return
    }

    this.busy = true
    try {
      const services = await this.discover()

      if (!this.pairedHost) {
        const candidate = services.find((service) => {
          if (service.kind !== 'pairing') return false
          const failedAt = this.failed.get(service.address)
          return failedAt === undefined || this.now() - failedAt >= this.retryAfterMs
        })
        if (!candidate) return

        this.emit({ state: 'pairing', address: candidate.address })
        const result = await this.options.client.pair(candidate.address, this.password)

        if (result.ok) {
          this.pairedHost = hostOf(candidate.address)
          this.failed.delete(candidate.address)
          this.emit({ state: 'connecting', address: candidate.address })
        } else {
          this.failed.set(candidate.address, this.now())
          this.emit({
            state: 'error',
            message: `${result.message || 'El dispositivo rechazo la vinculacion.'} · vuelve a escanear el QR`,
            address: candidate.address,
          })
        }
        return
      }

      let connectService = services.find(
        (service) => service.kind === 'connect' && hostOf(service.address) === this.pairedHost,
      )
      if (!connectService) {
        // Bonjour puede perder el anuncio TLS; `adb mdns services` sirve de respaldo.
        const fallback = await this.fallbackServices()
        connectService = fallback.find(
          (service) => service.kind === 'connect' && hostOf(service.address) === this.pairedHost,
        )
      }
      if (!connectService) {
        this.emit({
          state: 'connecting',
          message: 'Vinculado. Esperando el puerto TLS del dispositivo…',
          address: this.pairedHost,
        })
        return
      }

      const result = await this.options.client.connect(connectService.address)
      if (!result.ok) {
        this.emit({ state: 'error', message: result.message, address: connectService.address })
        return
      }

      this.options.client.useDevice(connectService.address)
      const device = await this.options.client.getInfo()
      this.finish({ state: 'connected', address: connectService.address, device })
    } catch (error) {
      this.emit({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      this.busy = false
    }
  }

  private async discover(): Promise<MdnsService[]> {
    try {
      return await Promise.resolve(this.options.discover())
    } catch {
      return []
    }
  }

  /** Consulta el respaldo con enfriamiento para no martillar `adb` en cada ciclo. */
  private async fallbackServices(): Promise<MdnsService[]> {
    const discover = this.options.fallbackDiscover
    if (!discover) return []
    if (this.now() - this.lastFallbackAt < this.connectFallbackMs) return []

    this.lastFallbackAt = this.now()
    try {
      return await discover()
    } catch {
      return []
    }
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      void this.pollOnce().finally(() => {
        if (!this.finished) this.schedule()
      })
    }, this.pollMs)
  }

  private finish(status: QrStatus): void {
    this.cancel()
    this.options.onStatus(status)
  }

  private emit(status: QrStatus): void {
    if (!this.finished || status.state === 'connected' || status.state === 'timeout') {
      this.options.onStatus(status)
    }
  }
}

function hostOf(address: string): string {
  const index = address.lastIndexOf(':')
  return index > 0 ? address.slice(0, index) : address
}
