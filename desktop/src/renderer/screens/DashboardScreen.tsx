import { useCallback, useEffect, useState } from 'react'
import type {
  DeviceDiagnostics,
  DeviceInfo,
  DeviceMetrics,
  JournalEntry,
  ScrcpyStatus,
} from '../../shared/types'
import { formatKb, formatPercent, formatUptime, healthScore } from '../lib/format'
import './dashboard.css'

type Level = 'ok' | 'warn' | 'bad'
type DashboardTarget = 'power' | 'logcat' | 'launcher' | 'history'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
  devices: DeviceInfo[]
  catalogVersion: string
  onOptimize: () => void
  onNavigate: (target: DashboardTarget) => void
  onSwitchDevice: (id: string) => void
  onAddDevice: () => void
}

export function DashboardScreen({
  t,
  device,
  devices,
  catalogVersion,
  onOptimize,
  onNavigate,
  onSwitchDevice,
  onAddDevice,
}: Props): JSX.Element {
  const [metrics, setMetrics] = useState<DeviceMetrics | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mirror, setMirror] = useState<ScrcpyStatus>({ running: false, serial: null })
  const [mirrorBusy, setMirrorBusy] = useState(false)
  const [mirrorError, setMirrorError] = useState('')
  const [diagnostics, setDiagnostics] = useState<DeviceDiagnostics | null>(null)
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false)
  const [diagnosticsError, setDiagnosticsError] = useState('')
  const [journal, setJournal] = useState<JournalEntry[]>([])
  const [journalError, setJournalError] = useState('')
  const [journalBusy, setJournalBusy] = useState<string | null>(null)

  useEffect(() => {
    void window.api.scrcpyStatus().then(setMirror).catch(() => undefined)
    return window.api.onScrcpyStatus(setMirror)
  }, [])

  const toggleMirror = async () => {
    setMirrorBusy(true)
    setMirrorError('')
    try {
      setMirror(mirror.running ? await window.api.scrcpyStop() : await window.api.scrcpyStart())
    } catch (cause) {
      setMirrorError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMirrorBusy(false)
    }
  }

  const refresh = useCallback(async () => {
    if (!device) return
    setLoading(true)
    try {
      setMetrics(await window.api.metrics())
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [device])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 8000)
    return () => clearInterval(timer)
  }, [refresh])

  const loadJournal = useCallback(async () => {
    if (!device) return
    try {
      const entries = await window.api.journal()
      setJournal(entries.filter((entry) => entry.deviceId === device.id).slice(0, 3))
      setJournalError('')
    } catch (cause) {
      setJournalError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [device])

  useEffect(() => {
    void loadJournal()
  }, [loadJournal])

  const undoChange = async (entry: JournalEntry) => {
    setJournalBusy(entry.id)
    setJournalError('')
    try {
      const result = await window.api.undo(entry.id)
      if (!result.ok) {
        setJournalError(
          result.steps.find((step) => step.status === 'failed')?.error ?? 'No se pudo deshacer.',
        )
      }
      await Promise.all([loadJournal(), refresh()])
    } catch (cause) {
      setJournalError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setJournalBusy(null)
    }
  }

  const readDiagnostics = async () => {
    if (!device) return
    setDiagnosticsBusy(true)
    setDiagnosticsError('')
    try {
      setDiagnostics(await window.api.deviceDiagnostics())
    } catch (cause) {
      setDiagnosticsError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDiagnosticsBusy(false)
    }
  }

  if (!device) {
    return (
      <div className="card">
        <div className="empty">
          <p>{t('error.notConnected')}</p>
          <p className="muted">{t('discovery.subtitle')}</p>
        </div>
      </div>
    )
  }

  const health = metrics ? healthScore(metrics) : { level: 'ok' as Level, score: 0 }
  const ramRatio =
    metrics && metrics.totalRamKb > 0 ? (metrics.usedRamKb / metrics.totalRamKb) * 100 : 0
  const storageRatio =
    metrics && metrics.storageTotalKb > 0
      ? (metrics.storageUsedKb / metrics.storageTotalKb) * 100
      : 0
  const others = devices.filter((item) => item.id !== device.id).slice(0, 3)

  return (
    <div className="dash-page">
      <section className={`dash-health ${health.level}`}>
        <div className="dash-health-main">
          <span className="dash-kicker">
            {metrics ? t(`device.health.${health.level}`) : 'Leyendo el dispositivo…'}
          </span>
          <div className="dash-score">
            <strong>{metrics ? health.score : '—'}</strong>
            <span>/100</span>
          </div>
          <p className="dash-device">
            {deviceName(device)} · Android {device.androidVersion} · {device.abi}
          </p>
          <HealthMeter value={metrics ? health.score : 0} level={health.level} />
        </div>

        <div className="dash-metrics">
          <Metric
            label={t('device.ram')}
            value={
              metrics
                ? `${formatKb(metrics.usedRamKb)} / ${formatKb(metrics.totalRamKb)}`
                : '—'
            }
            hint={metrics ? formatPercent(ramRatio) : ''}
            ratio={ramRatio}
          />
          <Metric
            label={t('device.cpu')}
            value={metrics ? formatPercent(metrics.cpuBusyPercent) : '—'}
            hint={metrics ? `carga ${metrics.load1.toFixed(2)}` : ''}
            ratio={metrics?.cpuBusyPercent ?? 0}
          />
          <Metric
            label={t('device.storage')}
            value={
              metrics
                ? `${formatKb(metrics.storageUsedKb)} / ${formatKb(metrics.storageTotalKb)}`
                : '—'
            }
            hint={metrics ? `${formatPercent(storageRatio)} · ${formatKb(metrics.storageAvailableKb)} libres` : ''}
            ratio={storageRatio}
          />
        </div>
      </section>

      <div className="dash-grid">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2>Ahora</h2>
              <span className="muted">{loading ? 'Leyendo…' : 'Se actualiza cada 8 s'}</span>
            </div>

            <div className="spec-table">
              <SpecRow
                label="Memoria usada"
                value={metrics ? formatKb(metrics.usedRamKb) : '—'}
                hint={metrics ? `de ${formatKb(metrics.totalRamKb)} · ${formatPercent(ramRatio)}` : ''}
                ratio={ramRatio}
              />
              <SpecRow
                label={t('device.cpu')}
                value={metrics ? formatPercent(metrics.cpuBusyPercent) : '—'}
                hint={metrics ? `· carga ${metrics.load1.toFixed(2)}` : ''}
                ratio={metrics?.cpuBusyPercent ?? 0}
              />
              <SpecRow
                label={t('device.storage')}
                value={metrics ? formatKb(metrics.storageUsedKb) : '—'}
                hint={metrics ? `de ${formatKb(metrics.storageTotalKb)} · ${formatPercent(storageRatio)}` : ''}
                ratio={storageRatio}
              />
              <SpecRow
                label={t('device.temperature')}
                value={metrics ? `${metrics.maxThermalStatus} de 6` : '—'}
                hint={metrics?.temperatureC != null ? `· ${metrics.temperatureC.toFixed(1)} °C` : ''}
                ratio={metrics ? (metrics.maxThermalStatus / 6) * 100 : 0}
              />
              <SpecRow
                label="Batería"
                value={
                  metrics && metrics.batteryPercent >= 0
                    ? `${metrics.batteryPercent}%`
                    : 'sin batería'
                }
                hint={device.isTv ? '· TV' : metrics ? '· nivel actual' : ''}
                ratio={metrics && metrics.batteryPercent >= 0 ? metrics.batteryPercent : 0}
              />
              <SpecRow
                label={t('device.uptime')}
                value={metrics ? formatUptime(metrics.uptimeSeconds) : '—'}
                hint="· encendido"
                ratio={0}
              />
            </div>

            {error && <div className="alert error">{error}</div>}
          </section>

          <section className="card">
            <div className="dash-action-head">
              <div>
                <h2>Diagnóstico ampliado</h2>
                <p className="muted">
                  hardware · batería · CPU por núcleo · pantalla · sensores · red
                </p>
              </div>
              <button
                type="button"
                className="ghost small"
                onClick={() => void readDiagnostics()}
                disabled={diagnosticsBusy}
              >
                {diagnosticsBusy ? 'Leyendo…' : diagnostics ? 'Actualizar' : 'Leer diagnóstico'}
              </button>
            </div>

            {diagnosticsError && <div className="alert error">{diagnosticsError}</div>}

            {diagnostics && (
              <>
                <div className="spec-table">
                  <InfoRow
                    label="Hardware"
                    value={
                      [diagnostics.hardware.brand, diagnostics.hardware.product, diagnostics.hardware.board]
                        .filter((value) => value !== null)
                        .join(' · ') || 'sin dato'
                    }
                    hint={diagnostics.hardware.abis ?? ''}
                  />
                  <InfoRow
                    label="Sistema"
                    value={diagnostics.system.build ?? 'sin dato'}
                    hint={diagnostics.system.patch ? `parche ${diagnostics.system.patch}` : ''}
                  />
                  <InfoRow
                    label="Batería"
                    value={
                      diagnostics.battery.level === null
                        ? 'sin dato'
                        : `${diagnostics.battery.level}% · ${diagnostics.battery.status ?? 'sin estado'}`
                    }
                    hint={[
                      diagnostics.battery.health,
                      diagnostics.battery.temperatureC === null
                        ? null
                        : `${diagnostics.battery.temperatureC} °C`,
                    ]
                      .filter((value) => value !== null)
                      .join(' · ')}
                  />
                  <InfoRow
                    label="Pantalla"
                    value={
                      diagnostics.screen.width === null || diagnostics.screen.height === null
                        ? 'sin dato'
                        : `${diagnostics.screen.width}×${diagnostics.screen.height}`
                    }
                    hint={
                      diagnostics.screen.refreshRateHz === null
                        ? ''
                        : `${diagnostics.screen.refreshRateHz} Hz`
                    }
                  />
                  <InfoRow label="GLES" value={diagnostics.gles ?? 'sin dato'} hint="" />
                  <InfoRow label="Vulkan" value={diagnostics.vulkan ?? 'sin dato'} hint="" />
                </div>

                <details className="disclose">
                  <summary>Ver detalle</summary>
                  <h3 className="section-title">CPU por núcleo</h3>
                  {diagnostics.cpuCores.length === 0 ? (
                    <p className="muted">El equipo no expone frecuencias por núcleo.</p>
                  ) : (
                    <div className="badges">
                      {diagnostics.cpuCores.map((core) => (
                        <span key={core.index} className="badge plain mono">
                          CPU{core.index}: {core.currentMhz === null ? '—' : `${core.currentMhz} MHz`}
                        </span>
                      ))}
                    </div>
                  )}
                  <h3 className="section-title">Sensores</h3>
                  {diagnostics.sensors.length === 0 ? (
                    <p className="muted">Sin sensores reportados.</p>
                  ) : (
                    <ul className="list">
                      {diagnostics.sensors.slice(0, 40).map((sensor) => (
                        <li key={`${sensor.name}-${sensor.type}`} className="list-row">
                          <span className="grow">{sensor.name}</span>
                          <span className="muted mono">{sensor.type}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <h3 className="section-title">Red</h3>
                  <div className="badges">
                    {diagnostics.network.map((item) => (
                      <span key={`${item.name}-${item.address}`} className="badge plain mono">
                        {item.name}: {item.address}
                        {item.prefix === null ? '' : `/${item.prefix}`}
                      </span>
                    ))}
                  </div>
                </details>
              </>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Cambios recientes</h2>
              <button type="button" className="ghost small" onClick={() => onNavigate('history')}>
                Ver historial
              </button>
            </div>
            {journal.length === 0 ? (
              <p className="muted">Sin cambios registrados para este equipo.</p>
            ) : (
              <ul className="list">
                {journal.map((entry) => (
                  <li key={entry.id} className="list-row">
                    <div className="grow">
                      <strong>{t(entry.titleKey)}</strong>
                      <span className="muted mono">
                        {entry.steps[0]?.run ?? entry.recipeId} · {relativeTime(entry.appliedAt)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="ghost small"
                      disabled={
                        Boolean(entry.revertedAt) ||
                        journalBusy === entry.id ||
                        !entry.steps.some((step) => step.reversible)
                      }
                      onClick={() => void undoChange(entry)}
                    >
                      {entry.revertedAt ? 'Deshecho' : journalBusy === entry.id ? 'Deshaciendo…' : 'Deshacer'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {journalError && <div className="alert error">{journalError}</div>}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <h2>Acciones</h2>
            <div className="dash-actions">
              <button type="button" className="primary" onClick={onOptimize}>
                Optimizar equipo
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => void toggleMirror()}
                disabled={mirrorBusy}
              >
                {mirror.running ? 'Cerrar espejo' : 'Abrir espejo'}
              </button>
              <button type="button" className="ghost" onClick={() => onNavigate('power')}>
                Doze y energía
              </button>
              <button type="button" className="ghost" onClick={() => onNavigate('logcat')}>
                Registrar el sistema
              </button>
            </div>
            {mirrorError && <div className="alert error">{mirrorError}</div>}
          </section>

          <section className="card">
            <h2>Equipo</h2>
            <div className="spec-table">
              <InfoRow label="Modelo" value={deviceName(device)} hint="" />
              <InfoRow
                label="Android"
                value={`${device.androidVersion} · SDK ${device.sdk}`}
                hint=""
              />
              <InfoRow label="Dirección" value={device.id} hint="" />
              <InfoRow label="Tipo" value={device.isTv ? 'TV' : 'Móvil'} hint="" />
              <InfoRow label="Catálogo" value={catalogVersion || '—'} hint="" />
              <InfoRow label="ABI" value={device.abi} hint="" />
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Otros equipos</h2>
              <button type="button" className="ghost small" onClick={onAddDevice}>
                + Conectar
              </button>
            </div>
            {others.length === 0 ? (
              <p className="muted">No hay otros equipos conectados en esta sesión.</p>
            ) : (
              <ul className="list">
                {others.map((item) => (
                  <li key={item.id} className="list-row">
                    <span className="device-chip-dot" aria-hidden />
                    <div className="grow">
                      <strong>{deviceName(item)}</strong>
                      <span className="muted mono">Android {item.androidVersion} · {item.id}</span>
                    </div>
                    <button
                      type="button"
                      className="ghost small"
                      onClick={() => onSwitchDevice(item.id)}
                    >
                      Usar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function deviceName(device: DeviceInfo): string {
  const model = device.model?.trim()
  return model ? model.replace(/_/g, ' ') : device.id
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000))
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'ayer' : `hace ${days} d`
}

function Metric(props: {
  label: string
  value: string
  hint: string
  ratio: number
}): JSX.Element {
  return (
    <div className="dash-metric">
      <span className="dash-metric-label">{props.label}</span>
      <strong className="dash-metric-value">{props.value}</strong>
      <span className="dash-metric-hint">{props.hint}</span>
      <div className="dash-metric-bar" aria-hidden>
        <span style={{ width: `${Math.min(Math.max(props.ratio, 0), 100)}%` }} />
      </div>
    </div>
  )
}

function HealthMeter({ value, level }: { value: number; level: Level }): JSX.Element {
  const segments = 22
  const filled = Math.round((Math.min(Math.max(value, 0), 100) / 100) * segments)

  return (
    <div className="health-meter">
      <div className="meter-track" role="img" aria-label={`Salud del dispositivo: ${value} de 100`}>
        {Array.from({ length: segments }).map((_, index) => (
          <span key={index} className={`meter-seg${index < filled ? ` on ${level}` : ''}`} />
        ))}
      </div>
      <div className="meter-scale" aria-hidden>
        <span>0</span>
        <span>100</span>
      </div>
    </div>
  )
}

function InfoRow(props: { label: string; value: string; hint: string }): JSX.Element {
  return (
    <div className="spec-row">
      <span className="spec-label">{props.label}</span>
      <span className="spec-value grow">{props.value}</span>
      <span className="spec-right">
        {props.hint && <span className="spec-hint">{props.hint}</span>}
      </span>
    </div>
  )
}

function SpecRow(props: {
  label: string
  value: string
  hint: string
  ratio: number
}): JSX.Element {
  const tone = props.ratio >= 85 ? 'bad' : props.ratio >= 65 ? 'warn' : ''

  return (
    <div className="spec-row">
      <span className="spec-label">{props.label}</span>
      <div className="spec-bar" aria-hidden>
        <span className={tone} style={{ width: `${Math.min(Math.max(props.ratio, 0), 100)}%` }} />
      </div>
      <span className="spec-right">
        <span className="spec-value">{props.value}</span>
        {props.hint && <span className="spec-hint">{props.hint}</span>}
      </span>
    </div>
  )
}
