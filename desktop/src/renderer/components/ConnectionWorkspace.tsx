import type { DeviceInfo } from '../../shared/types'
import { DevicesScreen } from '../screens/DevicesScreen'
import { GROUPS, groupLabel, groupScreens } from '../lib/sections'

interface Props {
  t: (key: string) => string
  onConnected: (device: DeviceInfo) => void
  hasDevices: boolean
}

export function ConnectionWorkspace({ t, onConnected, hasDevices }: Props): JSX.Element {
  const grouped = groupScreens()
  const deviceGroups = GROUPS.filter((group) => group.id !== 'conexion')

  return (
    <div className="connection-workspace">
      <header className="connection-hero">
        <h2>{hasDevices ? 'Conectar otro equipo' : 'Conecta un equipo para empezar'}</h2>
        <p className="muted">
          {hasDevices
            ? 'El equipo actual sigue activo. Al conectar otro se abre su Estado sin perder los demás.'
            : 'Diagnostica, optimiza y respalda por ADB. La primera sección se abre al confirmar la conexión.'}
        </p>
      </header>

      <div className="connection-grid">
        <div className="connection-devices">
          <DevicesScreen t={t} onConnected={onConnected} />
        </div>

        <aside className="sections-preview">
          <h3>Lo que se habilita</h3>
          {deviceGroups.map((group) => {
            const entries = grouped[group.id]
            return (
              <div key={group.id} className="preview-group">
                <div className="preview-group-head">
                  <strong>{groupLabel(t, group.id)}</strong>
                  <span className="pill">{entries.length}</span>
                </div>
                {entries.map((entry) => (
                  <div key={entry.id} className="preview-row">
                    {t(entry.labelKey)}
                  </div>
                ))}
              </div>
            )
          })}
          <p className="preview-note">La primera sección es Estado.</p>
        </aside>
      </div>
    </div>
  )
}
