import { useCallback, useEffect, useState } from 'react'
import type {
  DeviceInfo,
  DevicePowerAction,
  DozeAction,
  DozePhase,
  DozeStatus,
} from '../../shared/types'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
}

const PHASE_LABELS: Record<DozePhase, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
  pending: 'Pendiente',
  idle: 'En reposo (IDLE)',
  maintenance: 'Mantenimiento',
  unknown: 'Desconocido',
}

const DOZE_ACTIONS: Array<{ action: DozeAction; label: string }> = [
  { action: 'force', label: 'Forzar Doze' },
  { action: 'step', label: 'Avanzar paso' },
  { action: 'unforce', label: 'Quitar forzado' },
  { action: 'motion', label: 'Simular movimiento' },
]

const POWER_ACTIONS: Array<{
  action: DevicePowerAction
  label: string
  detail: string
  danger: boolean
}> = [
  {
    action: 'reboot',
    label: 'Reiniciar',
    detail: 'El equipo se reiniciará y la conexión puede caerse.',
    danger: true,
  },
  {
    action: 'shutdown',
    label: 'Apagar',
    detail: 'El equipo se apagará y quedará desconectado.',
    danger: true,
  },
  {
    action: 'recovery',
    label: 'Recovery',
    detail: 'El equipo arrancará en recovery.',
    danger: true,
  },
  {
    action: 'bootloader',
    label: 'Bootloader',
    detail: 'El equipo arrancará en bootloader.',
    danger: true,
  },
  {
    action: 'restart-system-ui',
    label: 'Reiniciar SystemUI',
    detail: 'Se reiniciará la interfaz; no se reinicia el equipo.',
    danger: false,
  },
]

export function PowerScreen({ t, device }: Props): JSX.Element {
  const [status, setStatus] = useState<DozeStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!device) return
    setLoading(true)
    setError('')
    try {
      setStatus(await window.api.dozeStatus())
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setLoading(false)
    }
  }, [device])

  useEffect(() => {
    if (!device) {
      setStatus(null)
      return
    }
    void load()
  }, [device, load])

  const runDoze = async (action: DozeAction) => {
    setBusy(`doze:${action}`)
    setError('')
    setNotice('')
    try {
      const next = await window.api.dozeRun(action)
      setStatus(next)
      setNotice(`Acción Doze aplicada: ${action}.`)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const runPower = async (action: DevicePowerAction, label: string, detail: string) => {
    const model = device?.model || device?.id || 'el equipo'
    if (!window.confirm(`¿${label} ${model}?\n\n${detail}`)) return
    setBusy(`power:${action}`)
    setError('')
    setNotice('')
    try {
      const result = await window.api.devicePower(action)
      if (result.ok) {
        setNotice(result.message)
      } else {
        setError(result.message || 'El dispositivo rechazó la solicitud.')
      }
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  if (!device) {
    return (
      <div className="card">
        <div className="empty">
          <p>{t('error.notConnected')}</p>
          <p className="muted">
            Conecta un dispositivo para leer el estado de Doze y enviar acciones de energía.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Estado de Doze</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Estado del controlador de reposo en <span className="mono">{device.model}</span>
            </p>
          </div>
          <button type="button" className="ghost" disabled={loading} onClick={() => void load()}>
            {loading ? 'Leyendo…' : 'Refrescar'}
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert ok">{notice}</div>}

        <div className="spec-table">
          <div className="spec-row">
            <span className="spec-label">Fase</span>
            <span className="spec-value mono">
              {status ? PHASE_LABELS[status.phase] : '—'}
            </span>
          </div>
          <div className="spec-row">
            <span className="spec-label">Deep</span>
            <span className="spec-value mono">{status?.deep ?? '—'}</span>
          </div>
          <div className="spec-row">
            <span className="spec-label">Light</span>
            <span className="spec-value mono">{status?.light ?? '—'}</span>
          </div>
          <div className="spec-row">
            <span className="spec-label">Forzado</span>
            <span className="spec-value">
              {status?.forced == null ? (
                <span className="muted">—</span>
              ) : (
                <span className={`badge ${status.forced ? 'warn' : 'plain'}`}>
                  {status.forced ? 'sí' : 'no'}
                </span>
              )}
            </span>
          </div>
        </div>

        <div className="row-actions">
          {DOZE_ACTIONS.map(({ action, label }) => (
            <button
              key={action}
              type="button"
              className="ghost small"
              disabled={busy !== null}
              onClick={() => void runDoze(action)}
            >
              {busy === `doze:${action}` ? 'Aplicando…' : label}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Acciones de energía</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Se envía una sola solicitud, sin reintentos. Si el transporte se cierra, el equipo
              puede seguir reiniciándose.
            </p>
          </div>
        </div>

        <ul className="list">
          {POWER_ACTIONS.map(({ action, label, detail, danger }) => (
            <li key={action} className="list-row">
              <div className="grow">
                <strong>{label}</strong>
                <span className="muted">{detail}</span>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className={danger ? 'danger small' : 'ghost small'}
                  disabled={busy !== null}
                  onClick={() => void runPower(action, label, detail)}
                >
                  {busy === `power:${action}` ? 'Enviando…' : label}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function cleanError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}
