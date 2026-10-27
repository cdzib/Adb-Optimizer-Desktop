import { useCallback, useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type {
  DeviceInfo,
  DeviceRef,
  MdnsService,
  QrDiagnostics,
  QrStartResult,
  QrStatus,
} from '../../shared/types'
import {
  forgetRecentDevice,
  loadRecentDevices,
  rememberRecentDevice,
  type RecentDevice,
} from '../lib/recent-devices'

interface Props {
  t: (key: string) => string
  onConnected: (device: DeviceInfo) => void
}

type Mode = 'usb' | 'wifi'

export function DevicesScreen({ t, onConnected }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>('usb')

  const [devices, setDevices] = useState<DeviceRef[]>([])
  const [services, setServices] = useState<MdnsService[]>([])
  const [scanning, setScanning] = useState(false)
  const [lastScanAt, setLastScanAt] = useState<Date | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const [address, setAddress] = useState('')
  const [port, setPort] = useState('5555')
  const [pairAddress, setPairAddress] = useState('')
  const [pairCode, setPairCode] = useState('')

  const [wirelessPort, setWirelessPort] = useState('5555')
  const [wirelessAddress, setWirelessAddress] = useState<string | null>(null)

  const [qr, setQr] = useState<QrStartResult | null>(null)
  const [qrStartedAt, setQrStartedAt] = useState(0)
  const [qrStatus, setQrStatus] = useState<QrStatus | null>(null)
  const [qrBusy, setQrBusy] = useState(false)
  const [qrEvents, setQrEvents] = useState<Array<{ at: string; text: string }>>([])
  const [diag, setDiag] = useState<QrDiagnostics | null>(null)
  const [tick, setTick] = useState(() => Date.now())
  const [recent, setRecent] = useState<RecentDevice[]>([])
  const [copied, setCopied] = useState<string | null>(null)

  const manualTarget = useMemo(() => {
    const host = address.trim()
    if (!host) return ''
    return host.includes(':') ? host : `${host}:${port.trim() || '5555'}`
  }, [address, port])

  const scan = useCallback(async () => {
    setScanning(true)
    setError('')
    try {
      const [found, mdns] = await Promise.all([
        window.api.listDevices(),
        window.api.mdns().catch(() => []),
      ])
      setDevices(found)
      setServices(mdns)
      setLastScanAt(new Date())
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    void scan()
    const timer = setInterval(() => void scan(), 6000)
    return () => clearInterval(timer)
  }, [scan])

  useEffect(() => {
    setRecent(loadRecentDevices())
  }, [])

  useEffect(() => {
    return window.api.onQrStatus((status) => {
      setQrStatus(status)
      setQrEvents((previous) => [
        ...previous.slice(-5),
        {
          at: new Date().toLocaleTimeString([], { hour12: false }),
          text: `${qrStatusLabel(status)}${status.address ? ` · ${status.address}` : ''}${
            status.message ? ` · ${status.message}` : ''
          }`,
        },
      ])
      if (status.state === 'connected' && status.device) {
        setQr(null)
        onConnected(status.device)
      }
    })
  }, [onConnected])

  // Cuenta atrás del QR: el limite lo fija el main, aqui solo se refleja.
  useEffect(() => {
    if (!qr) return
    setTick(Date.now())
    const timer = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [qr])

  useEffect(() => {
    let alive = true
    const load = () => {
      window.api
        .qrDiagnostics()
        .then((result) => {
          if (alive) setDiag(result)
        })
        .catch(() => {})
    }
    void load()
    // Con la tarjeta QR cerrada no hace falta sondear adb cada 5 s.
    const timer = setInterval(load, qr ? 5000 : 15_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [qr])

  const usbDevices = useMemo(
    () => devices.filter((device) => device.transport === 'usb' || device.transport === 'emulator'),
    [devices],
  )
  const wifiDevices = useMemo(
    () =>
      mergeNetworkDevices(
        devices.filter((device) => device.transport === 'network'),
        services,
      ),
    [devices, services],
  )

  const connectTo = async (id: string) => {
    setBusy(id)
    setError('')
    setWirelessAddress(null)
    const known = devices.find((device) => device.id === id || device.address === id)
    try {
      const info = await window.api.connect(id)
      setRecent(
        rememberRecentDevice({
          address: info.id,
          model: info.model,
          transport: known?.transport ?? 'network',
        }),
      )
      onConnected(info)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const copyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(address)
      window.setTimeout(() => setCopied((current) => (current === address ? null : current)), 1500)
    } catch {
      setError('No se pudo copiar la dirección al portapapeles.')
    }
  }

  const forget = (address: string) => {
    setRecent(forgetRecentDevice(address))
  }

  const connectManual = () => {
    if (!manualTarget) {
      setError('Escribe la IP del dispositivo.')
      return
    }
    void connectTo(manualTarget)
  }

  const pair = async () => {
    setBusy('pair')
    setError('')
    try {
      const result = await window.api.pair(pairAddress.trim(), pairCode.trim())
      if (!result.ok) setError(result.message)
      else {
        setPairCode('')
        await scan()
      }
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const enableWireless = async (device: DeviceRef) => {
    setBusy(`wifi-${device.id}`)
    setError('')
    setWirelessAddress(null)
    try {
      await window.api.connect(device.id)
      const result = await window.api.enableWireless(Number.parseInt(wirelessPort, 10) || 5555)
      if (!result.ok) {
        setError(result.message || 'No se pudo activar el modo red.')
        return
      }
      setWirelessAddress(result.address)
      if (result.address) setAddress(result.address.split(':')[0] ?? '')
      await scan()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const startQr = async () => {
    setQrBusy(true)
    setError('')
    setQrStatus(null)
    setQrEvents([])
    try {
      const started = await window.api.startQr()
      setQr(started)
      setQrStartedAt(Date.now())
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setQrBusy(false)
    }
  }

  const cancelQr = async () => {
    await window.api.cancelQr()
    setQr(null)
    setQrStatus(null)
    setQrEvents([])
  }

  const usbCandidate = usbDevices.find((device) => device.state === 'device')
  const found = mode === 'usb' ? usbDevices : wifiDevices
  const qrRemainingMs = qr ? Math.max(0, qr.expiresInMs - (tick - qrStartedAt)) : 0
  const qrExpired = Boolean(qr) && (qrRemainingMs <= 0 || qrStatus?.state === 'timeout')

  return (
    <div className="stack">
      <div className="device-mode">
        <div className="segmented mode-switch">
          <button
            type="button"
            className={mode === 'usb' ? 'active' : ''}
            aria-pressed={mode === 'usb'}
            onClick={() => setMode('usb')}
          >
            Cable USB{usbDevices.length > 0 ? ` · ${usbDevices.length}` : ''}
          </button>
          <button
            type="button"
            className={mode === 'wifi' ? 'active' : ''}
            aria-pressed={mode === 'wifi'}
            onClick={() => setMode('wifi')}
          >
            Wi‑Fi{wifiDevices.length > 0 ? ` · ${wifiDevices.length}` : ''}
          </button>
        </div>
        <span className="muted">
          {mode === 'usb'
            ? 'Conexión directa por cable. La más estable y sin red.'
            : 'Misma red Wi‑Fi. Descubre por mDNS o usa la IP del equipo.'}
        </span>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="devices-grid">
        <section className="board">
          <div className="card-head">
            <div className="board-title">
              <h2>{mode === 'usb' ? 'Dispositivos por USB' : 'Dispositivos en la red'}</h2>
              <span className="scan-meta">
                {scanning
                  ? 'Buscando…'
                  : lastScanAt
                    ? `Última búsqueda ${formatTime(lastScanAt)} · ${found.length} ${
                        found.length === 1 ? 'equipo' : 'equipos'
                      }`
                    : 'Sin búsquedas todavía'}
              </span>
            </div>
            <button type="button" className="ghost small" onClick={() => void scan()} disabled={scanning}>
              {scanning ? 'Buscando…' : 'Buscar'}
            </button>
          </div>

          <ScanStrip active={scanning} />

          {found.length === 0 && !scanning ? (
            <div className="board-empty">
              <p>
                {mode === 'usb'
                  ? 'Ningún dispositivo conectado por cable.'
                  : 'No se encontraron equipos en la red.'}
              </p>
              <ul className="empty-hints">
                {mode === 'usb' ? (
                  <>
                    <li>Prueba otro cable y otro puerto USB directo (sin hub).</li>
                    <li>Acepta el diálogo “¿Permitir depuración USB?” en la pantalla del equipo.</li>
                    <li>Windows: instala el driver OEM del fabricante si no aparece.</li>
                    <li>Si el estado es “sin autorizar”, revisa la pantalla del dispositivo.</li>
                  </>
                ) : (
                  <>
                    <li>Ambos equipos en la misma red Wi‑Fi y depuración inalámbrica activa.</li>
                    <li>Si el router aísla clientes, usa la conexión manual por IP.</li>
                    <li>El QR exige abrir “Vincular con QR” en el teléfono antes de escanear.</li>
                    <li>Un TV sin cámara necesita código de 6 dígitos o cable USB.</li>
                  </>
                )}
              </ul>
              <button type="button" className="ghost small" onClick={() => void scan()}>
                Reintentar
              </button>
            </div>
          ) : (
            <ul className="list">
              {found.map((device) => (
                <li key={device.id} className="device-row">
                  <div className="device-identity">
                    <div className="device-line">
                      <strong>{displayModel(device)}</strong>
                      <span className="badge plain">{transportLabel(device.transport)}</span>
                    </div>
                    <span className="device-serial">{device.address || device.id}</span>
                  </div>
                  <StateBadge state={device.state} />
                  <div className="row-actions">
                    <button
                      type="button"
                      className="ghost small"
                      onClick={() => void copyAddress(device.address)}
                      aria-label={`Copiar la dirección de ${displayModel(device)}`}
                    >
                      {copied === device.address ? 'Copiada' : 'Copiar IP'}
                    </button>
                    <button
                      type="button"
                      className="primary small"
                      disabled={device.state !== 'device' || busy === device.id}
                      onClick={() => void connectTo(device.id)}
                    >
                      {busy === device.id ? 'Conectando…' : 'Conectar'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <RecentDevices
            recent={recent.filter(
              (item) => !found.some((device) => hostOf(device.address) === hostOf(item.address)),
            )}
            busy={busy}
            onConnect={(address) => void connectTo(address)}
            onForget={forget}
          />

          {found.some((device) => device.state === 'unauthorized') && (
            <div className="alert warn">
              Hay un dispositivo sin autorizar: desbloquéalo y acepta el diálogo
              “¿Permitir depuración USB?” en su pantalla.
            </div>
          )}

          {mode === 'wifi' && (
            <>
              <h3 className="section-title">Conexión manual</h3>
              <div className="manual-inline">
                <label className="field grow">
                  <span>Dirección IP</span>
                  <input
                    value={address}
                    placeholder="192.168.1.40"
                    inputMode="decimal"
                    onChange={(event) => setAddress(event.target.value)}
                  />
                </label>
                <label className="field port">
                  <span>Puerto (opcional)</span>
                  <input
                    value={port}
                    inputMode="numeric"
                    onChange={(event) => setPort(event.target.value)}
                  />
                </label>
                <div className="field field-action">
                  <span>&nbsp;</span>
                  <button
                    type="button"
                    className="primary"
                    onClick={connectManual}
                    disabled={busy !== null}
                  >
                    {busy !== null && busy === manualTarget ? 'Conectando…' : 'Conectar'}
                  </button>
                </div>
              </div>
              <p className="muted" style={{ marginTop: '8px' }}>
                El puerto <span className="mono">5555</span> corresponde a ADB clásico (
                <span className="mono">adb tcpip</span>). La depuración inalámbrica moderna muestra
                su propio puerto TLS en el dispositivo.
              </p>
            </>
          )}

          {mode === 'usb' && (
            <div className="board-foot">
              <span className="muted">¿Quieres usarlo sin cable?</span>
              <button type="button" className="ghost small" onClick={() => setMode('wifi')}>
                Ir a Wi‑Fi
              </button>
            </div>
          )}
        </section>

        <aside className="stack devices-aside">
          {mode === 'wifi' && (
            <section className={`card qr-card${qr ? ' qr-live' : ''}`}>
              <div className="card-head">
                <h2>Vincular con QR</h2>
                {qr && !qrExpired && <span className="badge warn">activo</span>}
              </div>

              {qr ? (
                <>
                  <QrSteps status={qrStatus} />

                  {qrExpired ? (
                    <div className="alert warn">
                      El QR caducó sin que el dispositivo se vinculara. Genera uno nuevo y escanéalo
                      desde Ajustes → Sistema → Depuración inalámbrica → Vincular con QR.
                    </div>
                  ) : (
                    <div className="qr-wrap">
                      <div className="qr-canvas">
                        <QRCodeSVG
                          value={qr.qrText}
                          size={208}
                          level="M"
                          marginSize={2}
                          bgColor="#ffffff"
                          fgColor="#000000"
                          aria-label="Código QR de vinculación"
                        />
                      </div>
                      <div className="qr-info">
                        <strong role="status" aria-live="polite">
                          {qrStatusLabel(qrStatus)}
                        </strong>
                        <span className="muted">{qr.name}</span>
                        <span className="qr-countdown" aria-hidden>
                          {formatCountdown(qrRemainingMs)}
                        </span>
                        <div className="row-actions">
                          <button type="button" className="ghost small" onClick={() => void cancelQr()}>
                            Cancelar
                          </button>
                          <button
                            type="button"
                            className="ghost small"
                            onClick={() => {
                              void (async () => {
                                await cancelQr()
                                await startQr()
                              })()
                            }}
                          >
                            Generar otro
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {qrStatus?.message && (
                    <div className={`alert ${qrStatus.state === 'error' ? 'error' : 'warn'}`}>
                      {qrStatus.message}
                    </div>
                  )}

                  {qrEvents.length > 0 && (
                    <div className="qr-trail">
                      {qrEvents.map((event) => (
                        <div key={`${event.at}-${event.text}`} className="qr-trail-line">
                          <span className="qr-trail-time">{event.at}</span>
                          <span>{event.text}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {qrStatus?.state === 'waiting' && !qrExpired && (
                    <p className="muted">
                      Si no aparece “Vinculando”, el teléfono no está publicando el servicio: abre
                      Ajustes → Sistema → Depuración inalámbrica → <strong>Vincular con QR</strong> y
                      escanea desde esa pantalla (no con la app de cámara).
                    </p>
                  )}
                  {qrStatus?.state === 'error' && (
                    <p className="muted">
                      El QR sigue válido hasta que caduque. Vuelve a escanearlo en el dispositivo; si
                      el error se repite, genera uno nuevo.
                    </p>
                  )}

                  {qrExpired && (
                    <button type="button" className="primary" onClick={() => void startQr()} disabled={qrBusy}>
                      {qrBusy ? 'Generando…' : 'Generar otro QR'}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="muted">
                    En el dispositivo: Ajustes → Sistema → Depuración inalámbrica → Vincular con QR.
                    Escanéalo y acepta la vinculación.
                  </p>
                  <button type="button" className="primary" onClick={() => void startQr()} disabled={qrBusy}>
                    {qrBusy ? 'Generando…' : 'Generar QR'}
                  </button>
                  {qrStatus?.state === 'error' && (
                    <div className="alert error">{qrStatus.message ?? 'No se pudo vincular.'}</div>
                  )}
                </>
              )}

              <div className="qr-diag">
                <span className="muted">
                  mDNS:{' '}
                  {diag
                    ? `${diag.discovered.filter((item) => item.kind === 'pairing').length} vinculación · ${
                        diag.discovered.filter((item) => item.kind === 'connect').length
                      } conexión`
                    : 'sin datos'}
                </span>
                <details>
                  <summary>Diagnóstico</summary>
                  <code>{diag?.backend || 'sin respuesta de adb mdns check'}</code>
                  <ul>
                    {(diag?.discovered ?? []).map((item) => (
                      <li key={`${item.kind}-${item.address}`}>
                        {item.kind} · {item.address}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </section>
          )}

          <section className="card">
            <h2>{mode === 'usb' ? 'Requisitos en el dispositivo' : 'Cómo activar la depuración'}</h2>
            <ol className="steps">
              {mode === 'usb' ? (
                <>
                  <li>Ajustes → Sistema → Información → tocar “Compilación” 7 veces</li>
                  <li>Opciones de desarrollador → Depuración USB</li>
                  <li>Conectar el cable y aceptar la huella RSA</li>
                  <li>Windows: instala el driver OEM si no aparece</li>
                </>
              ) : (
                <>
                  <li>Ajustes → Sistema → Información → tocar “Compilación” 7 veces</li>
                  <li>Depuración inalámbrica o depuración por red</li>
                  <li>Anota la IP y el puerto que muestra la pantalla</li>
                  <li>Misma red Wi‑Fi, sin aislamiento de clientes</li>
                </>
              )}
            </ol>
          </section>

          {mode === 'wifi' && (
          <details className="disclose">
            <summary>Vincular con código</summary>
            <p className="muted">
              La TV muestra IP, puerto y un código de 6 dígitos al elegir “Vincular dispositivo”.
            </p>
            <div className="field-row">
              <label className="field grow">
                <span>IP:puerto de vinculación</span>
                <input
                  value={pairAddress}
                  placeholder="192.168.1.40:41021"
                  onChange={(event) => setPairAddress(event.target.value)}
                />
              </label>
              <label className="field port">
                <span>Código</span>
                <input
                  value={pairCode}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  onChange={(event) => setPairCode(event.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="ghost small"
              onClick={() => void pair()}
              disabled={busy !== null || pairCode.length !== 6 || !pairAddress}
            >
              Vincular con código
            </button>
          </details>
          )}

          {mode === 'wifi' && (
          <details className="disclose">
            <summary>Activar Wi‑Fi desde USB</summary>
            <p className="muted">
              Si la TV no tiene depuración por red, conéctala una vez por cable y activa el modo
              red. Devuelve la IP para conectarte sin cable.
            </p>
            {usbCandidate ? (
              <>
                <div className="device-line" style={{ marginBottom: '8px' }}>
                  <strong>{usbCandidate.model ?? 'Dispositivo Android'}</strong>
                  <span className="badge ok">listo</span>
                </div>
                <div className="field-row">
                  <label className="field port">
                    <span>Puerto</span>
                    <input
                      value={wirelessPort}
                      inputMode="numeric"
                      onChange={(event) => setWirelessPort(event.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="ghost small"
                  disabled={busy !== null}
                  onClick={() => void enableWireless(usbCandidate)}
                >
                  {busy === `wifi-${usbCandidate.id}` ? 'Activando…' : 'Activar modo Wi‑Fi'}
                </button>
              </>
            ) : (
              <p className="muted">
                No hay un dispositivo conectado por USB. Conéctalo y autoriza la depuración primero.
              </p>
            )}
            {wirelessAddress && (
              <div className="alert ok">
                Listo. Conéctate a <strong>{wirelessAddress}</strong>.
              </div>
            )}
          </details>
          )}
        </aside>
      </div>
    </div>
  )
}

const QR_STEPS = ['Escanear', 'Vincular', 'Conectar', 'Listo'] as const

function qrStepIndex(status: QrStatus | null): number {
  switch (status?.state) {
    case 'pairing':
      return 1
    case 'connecting':
      return 2
    case 'connected':
      return 3
    default:
      return 0
  }
}

function QrSteps({ status }: { status: QrStatus | null }): JSX.Element {
  const current = qrStepIndex(status)
  return (
    <ol className="qr-steps" aria-label="Progreso de la vinculación">
      {QR_STEPS.map((label, index) => (
        <li
          key={label}
          className={index < current ? 'done' : index === current ? 'active' : ''}
          aria-current={index === current ? 'step' : undefined}
        >
          <span className="qr-step-index">{index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  )
}

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const minutes = Math.floor(total / 60)
  return `caduca en ${minutes}:${String(total % 60).padStart(2, '0')}`
}

function ScanStrip({ active }: { active: boolean }): JSX.Element {
  return (
    <div className={`scan-rule${active ? ' scanning' : ''}`} aria-hidden>
      <span />
    </div>
  )
}

function RecentDevices({
  recent,
  busy,
  onConnect,
  onForget,
}: {
  recent: RecentDevice[]
  busy: string | null
  onConnect: (address: string) => void
  onForget: (address: string) => void
}): JSX.Element {
  if (recent.length === 0) return <></>

  return (
    <div className="recent-block">
      <h3 className="section-title">Equipos recientes</h3>
      <ul className="list">
        {recent.map((device) => (
          <li key={device.address} className="device-row">
            <div className="device-identity">
              <div className="device-line">
                <strong>{displayModel(device)}</strong>
                <span className="badge plain">{transportLabel(device.transport)}</span>
              </div>
              <span className="device-serial">{device.address}</span>
            </div>
            <div className="row-actions">
              <button
                type="button"
                className="ghost small"
                onClick={() => onForget(device.address)}
                aria-label={`Olvidar ${displayModel(device)}`}
              >
                Olvidar
              </button>
              <button
                type="button"
                className="primary small"
                disabled={busy !== null}
                onClick={() => onConnect(device.address)}
              >
                {busy === device.address ? 'Conectando…' : 'Reconectar'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StateBadge({ state }: { state: DeviceRef['state'] }): JSX.Element {
  const tone = state === 'device' ? 'ok' : state === 'unauthorized' ? 'warn' : state === 'offline' ? 'bad' : 'plain'
  return <span className={`badge ${tone}`}>{stateLabel(state)}</span>
}

const STATE_LABELS: Record<DeviceRef['state'], string> = {
  device: 'listo',
  unauthorized: 'sin autorizar',
  offline: 'sin conexión',
  unknown: 'desconocido',
}

function stateLabel(state: DeviceRef['state']): string {
  return STATE_LABELS[state] ?? 'desconocido'
}

function transportLabel(transport: DeviceRef['transport']): string {
  if (transport === 'usb') return 'USB'
  if (transport === 'emulator') return 'emulador'
  return 'Wi‑Fi'
}

/**
 * `adb devices` puede listar el mismo equipo varias veces (IP:puerto y nombre mDNS).
 * Se agrupa por host y se prioriza la entrada con modelo real.
 */
export function dedupeByHost(devices: DeviceRef[]): DeviceRef[] {
  const byHost = new Map<string, DeviceRef>()
  const isMdnsName = (model: string | undefined) => Boolean(model && /^adb-[a-z0-9]/i.test(model))

  // 2 = modelo real, 1 = nombre mDNS, 0 = sin modelo
  const score = (device: DeviceRef) => {
    if (!device.model) return 0
    return isMdnsName(device.model) ? 1 : 2
  }

  for (const device of devices) {
    const host = hostOf(device.address)
    const current = byHost.get(host)
    if (!current) {
      byHost.set(host, device)
      continue
    }
    if (score(device) > score(current)) {
      byHost.set(host, device)
    } else if (!current.model && device.model) {
      byHost.set(host, { ...current, model: device.model })
    }
  }

  return [...byHost.values()]
}

function displayModel(device: { model?: string }): string {
  const model = device.model?.trim()
  if (!model) return 'Dispositivo Android'
  return model.replace(/_/g, ' ')
}

function hostOf(address: string): string {
  const index = address.lastIndexOf(':')
  return index > 0 ? address.slice(0, index) : address
}

function mergeNetworkDevices(devices: DeviceRef[], services: MdnsService[]): DeviceRef[] {
  const merged = dedupeByHost(devices)
  const hosts = new Set(merged.map((device) => hostOf(device.address)))

  for (const service of services) {
    if (service.kind !== 'connect') continue
    const host = hostOf(service.address)
    if (hosts.has(host)) continue
    hosts.add(host)
    merged.push({
      id: service.address,
      address: service.address,
      state: 'device',
      transport: 'network',
      model: 'Dispositivo Android',
    })
  }

  return merged
}

function qrStatusLabel(status: QrStatus | null): string {
  switch (status?.state) {
    case 'waiting':
      return 'Esperando que el dispositivo escanee…'
    case 'pairing':
      return 'Vinculando…'
    case 'connecting':
      return 'Conectando por TLS…'
    case 'connected':
      return 'Conectado'
    case 'timeout':
      return 'Tiempo agotado'
    case 'error':
      return 'Error de vinculación'
    default:
      return 'QR listo'
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function cleanError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}
