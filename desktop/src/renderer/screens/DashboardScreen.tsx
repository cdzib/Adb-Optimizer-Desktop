import { useCallback, useEffect, useState } from 'react'
import type { DeviceInfo, DeviceMetrics, RemoteLauncher, ScrcpyStatus } from '../../shared/types'
import { formatKb, formatPercent, formatUptime, healthScore } from '../lib/format'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
  onOptimize: () => void
}

type Level = 'ok' | 'warn' | 'bad'

export function DashboardScreen({ t, device, onOptimize }: Props): JSX.Element {
  const [metrics, setMetrics] = useState<DeviceMetrics | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [launchers, setLaunchers] = useState<RemoteLauncher[]>([])
  const [currentLauncher, setCurrentLauncher] = useState<RemoteLauncher | null>(null)
  const [launcherBusy, setLauncherBusy] = useState('')
  const [launcherError, setLauncherError] = useState('')
  const [mirror, setMirror] = useState<ScrcpyStatus>({ running: false, serial: null })
  const [mirrorBusy, setMirrorBusy] = useState(false)
  const [mirrorError, setMirrorError] = useState('')

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

  const loadLaunchers = useCallback(async () => {
    if (!device?.isTv) return
    try {
      const [available, current] = await Promise.all([
        window.api.launchers(),
        window.api.currentLauncher(),
      ])
      setLaunchers(available)
      setCurrentLauncher(current)
      setLauncherError('')
    } catch (cause) {
      setLauncherError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [device])

  useEffect(() => {
    void loadLaunchers()
  }, [loadLaunchers])

  const applyLauncher = async (launcher: RemoteLauncher) => {
    if (launcher.packageName === currentLauncher?.packageName) return
    const confirmed = window.confirm(
      `Cambiar el launcher de inicio a ${launcher.packageName}?\n\nSolo se activa una activity HOME ya instalada; no garantiza mejorar el rendimiento.`,
    )
    if (!confirmed) return
    setLauncherBusy(launcher.packageName)
    setLauncherError('')
    try {
      const updated = await window.api.setLauncher(launcher.packageName)
      setCurrentLauncher(updated)
    } catch (cause) {
      setLauncherError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLauncherBusy('')
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

  const health = metrics ? healthScore(metrics) : null
  const ramRatio = metrics && metrics.totalRamKb > 0 ? (metrics.usedRamKb / metrics.totalRamKb) * 100 : 0
  const storageRatio =
    metrics && metrics.storageTotalKb > 0 ? (metrics.storageUsedKb / metrics.storageTotalKb) * 100 : 0

  return (
    <div className="stack">
      <section className={`banner ${health?.level ?? 'ok'}`}>
        <div>
          <strong>{health ? t(`device.health.${health.level}`) : 'Leyendo el dispositivo…'}</strong>
          <span>
            {device.manufacturer} {device.model} · Android {device.androidVersion} · {device.abi}
          </span>
          <span>
            {device.hasRoot ? 'root detectado' : 'sin root · comandos con permisos de shell'}
          </span>
        </div>
        <div className="banner-actions">
          {health && <HealthMeter value={health.score} level={health.level} />}
          <button type="button" className="primary" onClick={onOptimize}>
            Optimizar
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Espejo de pantalla</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {mirror.running
                ? `Abierto para ${mirror.serial}.`
                : 'Muestra y controla el dispositivo en una ventana con scrcpy.'}
            </p>
          </div>
          <button
            type="button"
            className={mirror.running ? 'ghost small' : 'primary'}
            onClick={() => void toggleMirror()}
            disabled={mirrorBusy}
          >
            {mirror.running ? 'Cerrar espejo' : 'Abrir espejo'}
          </button>
        </div>
        {mirrorError && <div className="alert error">{mirrorError}</div>}
      </section>

      {device.isTv && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Launcher de TV</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Activa uno de los launchers HOME instalados.
              </p>
            </div>
            <button type="button" className="ghost small" onClick={() => void loadLaunchers()}>
              Recargar
            </button>
          </div>
          {launchers.length === 0 ? (
            <p className="muted">No se encontraron launchers HOME disponibles.</p>
          ) : (
            <ul className="list">
              {launchers.map((launcher) => {
                const active = launcher.packageName === currentLauncher?.packageName
                return (
                  <li key={launcher.packageName} className="list-row">
                    <div className="grow">
                      <strong>{launcher.packageName}</strong>
                      <span className="mono muted">{launcher.componentName}</span>
                    </div>
                    {active ? (
                      <span className="badge ok">Actual</span>
                    ) : (
                      <button
                        type="button"
                        className="ghost small"
                        disabled={launcherBusy !== ''}
                        onClick={() => void applyLauncher(launcher)}
                      >
                        {launcherBusy === launcher.packageName ? 'Cambiando…' : 'Usar'}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {launcherError && <div className="alert error">{launcherError}</div>}
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Mediciones</h2>
          <button type="button" className="ghost small" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Leyendo…' : t('device.refresh')}
          </button>
        </div>

        <div className="spec-table">
          <SpecRow
            label={t('device.ram')}
            value={metrics ? formatKb(metrics.usedRamKb) : '—'}
            hint={metrics ? formatPercent(ramRatio) : ''}
            ratio={ramRatio}
          />
          <SpecRow
            label={t('device.cpu')}
            value={metrics ? formatPercent(metrics.cpuBusyPercent) : '—'}
            hint={metrics ? `load ${metrics.load1.toFixed(2)}` : ''}
            ratio={metrics?.cpuBusyPercent ?? 0}
          />
          <SpecRow
            label={t('device.storage')}
            value={metrics ? formatKb(metrics.storageUsedKb) : '—'}
            hint={metrics ? `${formatKb(metrics.storageAvailableKb)} libres` : ''}
            ratio={storageRatio}
          />
          <SpecRow
            label="Batería"
            value={
              metrics && metrics.batteryPercent >= 0 ? `${metrics.batteryPercent}%` : 'No disponible'
            }
            hint={metrics && metrics.batteryPercent >= 0 ? 'nivel actual' : ''}
            ratio={metrics && metrics.batteryPercent >= 0 ? metrics.batteryPercent : 0}
          />
          <SpecRow
            label={t('device.temperature')}
            value={metrics?.temperatureC != null ? `${metrics.temperatureC.toFixed(1)} °C` : 'sin dato'}
            hint={metrics ? `nivel ${metrics.maxThermalStatus}/6` : ''}
            ratio={metrics ? (metrics.maxThermalStatus / 6) * 100 : 0}
          />
          <SpecRow
            label={t('device.uptime')}
            value={metrics ? formatUptime(metrics.uptimeSeconds) : '—'}
            hint=""
            ratio={0}
          />
          <SpecRow
            label={t('device.processes')}
            value={metrics ? String(metrics.backgroundProcesses) : '—'}
            hint="en segundo plano"
            ratio={0}
          />
        </div>

        {error && <div className="alert error">{error}</div>}
      </section>

      <section className="card">
        <h2>Cómo se mide</h2>
        <p className="muted">
          Todo sale de <code className="mono">dumpsys</code> en el dispositivo. La memoria libre
          no mide velocidad: se leen carga de CPU, presión térmica, procesos en segundo plano y
          espacio disponible. Cuando aplicas un perfil, vuelve aquí para comparar.
        </p>
      </section>
    </div>
  )
}

function HealthMeter({ value, level }: { value: number; level: Level }): JSX.Element {
  const segments = 22
  const filled = Math.round((Math.min(Math.max(value, 0), 100) / 100) * segments)

  return (
    <div className="health-meter">
      <div className="health-figure">
        <span className="score">{value}</span>
        <span className="health-denom">/100</span>
      </div>
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
