import { useEffect, useRef } from 'react'
import type { DeviceInfo } from '../../shared/types'

interface Props {
  devices: DeviceInfo[]
  activeId: string | null
  onSwitch: (id: string) => void
  onDisconnect: (id: string) => void
  onAdd: () => void
  onClose: () => void
}

function deviceLabel(device: DeviceInfo): string {
  const model = device.model?.trim()
  return model ? model.replace(/_/g, ' ') : device.id
}

function confirmDisconnect(device: DeviceInfo): boolean {
  return window.confirm(
    `¿Desconectar ${deviceLabel(device)}? El equipo seguirá disponible si vuelve a anunciarse.`,
  )
}

export function DeviceSwitcher({
  devices,
  activeId,
  onSwitch,
  onDisconnect,
  onAdd,
  onClose,
}: Props): JSX.Element {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panel.current?.focus()
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <>
      <div className="switcher-layer" onClick={onClose}>
        <div className="switcher-scrim" aria-hidden />
      </div>
      <div
        ref={panel}
        className="device-switcher"
        role="dialog"
        aria-modal="true"
        aria-label="Equipos"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="switcher-head">
          <strong>Equipos</strong>
          <span className="muted">
            {devices.length} {devices.length === 1 ? 'equipo' : 'equipos'}
          </span>
        </div>

        <ul className="list">
          {devices.map((device) => {
            const active = device.id === activeId
            return (
              <li key={device.id} className={`switcher-row${active ? ' is-active' : ''}`}>
                <span className={`device-chip-dot${active ? ' ok' : ''}`} aria-hidden />
                <div className="device-identity">
                  <div className="device-line">
                    <strong>{deviceLabel(device)}</strong>
                    <span className={`badge ${active ? 'ok' : 'plain'}`}>
                      {active ? 'Activo' : 'Conectado'}
                    </span>
                  </div>
                  <span className="device-serial">
                    Android {device.androidVersion} · {device.id}
                  </span>
                </div>
                <div className="switcher-actions">
                  {!active && (
                    <button
                      type="button"
                      className="primary small"
                      onClick={() => onSwitch(device.id)}
                    >
                      Usar
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost small"
                    onClick={() => {
                      if (confirmDisconnect(device)) onDisconnect(device.id)
                    }}
                  >
                    Desconectar
                  </button>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="switcher-foot">
          <button type="button" className="primary" onClick={onAdd}>
            + Conectar otro equipo
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </>
  )
}
