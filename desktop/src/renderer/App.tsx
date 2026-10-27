import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DeviceInfo } from '../shared/types'
import { AppsScreen } from './screens/AppsScreen'
import { DashboardScreen } from './screens/DashboardScreen'
import { DevicesScreen } from './screens/DevicesScreen'
import { DpcScreen } from './screens/DpcScreen'
import { HistoryScreen } from './screens/HistoryScreen'
import { LauncherScreen } from './screens/LauncherScreen'
import { OptimizeScreen } from './screens/OptimizeScreen'
import { RootScreen } from './screens/RootScreen'
import { FlashScreen } from './screens/FlashScreen'

export type Screen = 'devices' | 'dashboard' | 'optimize' | 'apps' | 'dpc' | 'launcher' | 'root' | 'flash' | 'history'

const NAV: Array<{ id: Screen; labelKey: string }> = [
  { id: 'devices', labelKey: 'nav.discovery' },
  { id: 'dashboard', labelKey: 'nav.dashboard' },
  { id: 'optimize', labelKey: 'nav.optimize' },
  { id: 'apps', labelKey: 'nav.apps' },
  { id: 'dpc', labelKey: 'nav.dpc' },
  { id: 'launcher', labelKey: 'nav.launcher' },
  { id: 'root', labelKey: 'nav.root' },
  { id: 'flash', labelKey: 'nav.flash' },
  { id: 'history', labelKey: 'nav.history' },
]

export function App(): JSX.Element {
  const [dict, setDict] = useState<Record<string, string>>({})
  const [screen, setScreen] = useState<Screen>('devices')
  const [device, setDevice] = useState<DeviceInfo | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [catalogVersion, setCatalogVersion] = useState('')
  const [adbPath, setAdbPath] = useState('')
  const [labMode, setLabMode] = useState(false)

  useEffect(() => {
    void window.api.i18n('es').then(setDict)
    void window.api.appState().then((state) => {
      setCatalogVersion(state.catalogVersion)
      setAdbPath(state.adbPath)
      setLabMode(state.labMode)
    })
  }, [])

  useEffect(() => {
    return window.api.onLog((line) => {
      setLog((previous) => [...previous.slice(-39), line])
    })
  }, [])

  const t = useCallback((key: string) => dict[key] ?? key, [dict])

  const handleConnected = useCallback((info: DeviceInfo) => {
    setDevice(info)
    setScreen('dashboard')
  }, [])

  const handleDisconnect = useCallback(async () => {
    await window.api.disconnect()
    setDevice(null)
    setScreen('devices')
  }, [])

  const title = useMemo(
    () => t(NAV.find((item) => item.id === screen)?.labelKey ?? 'app.name'),
    [screen, t],
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden />
          <div>
            <strong>{t('app.name')}</strong>
            <span>Consola de servicio</span>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item${screen === item.id ? ' active' : ''}`}
              aria-current={screen === item.id ? 'page' : undefined}
              onClick={() => {
                setScreen(item.id)
                if (item.id === 'history') void window.api.journal()
              }}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="status-text">
            <strong>{device ? `${device.manufacturer} ${device.model}` : 'Sin dispositivo'}</strong>
            <span>
              {device
                ? `Android ${device.androidVersion} · SDK ${device.sdk}`
                : 'Conecta por USB o Wi‑Fi'}
            </span>
          </div>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <h1>{title}</h1>
          <div className="topbar-meta">
            {labMode && <span className="pill">LAB</span>}
            {device && <span className="pill">{device.abi}</span>}
            <span className="pill">catálogo {catalogVersion || '—'}</span>
            {device && (
              <button type="button" className="ghost" onClick={() => void handleDisconnect()}>
                Desconectar
              </button>
            )}
          </div>
        </header>

        <section className="screen">
          {screen === 'devices' && <DevicesScreen t={t} onConnected={handleConnected} />}
          {screen === 'dashboard' && (
            <DashboardScreen t={t} device={device} onOptimize={() => setScreen('optimize')} />
          )}
          {screen === 'optimize' && <OptimizeScreen t={t} device={device} />}
          {screen === 'apps' && <AppsScreen t={t} device={device} />}
          {screen === 'dpc' && <DpcScreen t={t} device={device} />}
          {screen === 'launcher' && <LauncherScreen t={t} device={device} />}
          {screen === 'root' && <RootScreen t={t} device={device} />}
          {screen === 'flash' && <FlashScreen t={t} device={device} />}
          {screen === 'history' && <HistoryScreen t={t} device={device} />}
        </section>

        {log.length > 0 && (
          <footer className="console" aria-live="polite">
            {log.slice(-6).map((line, index) => (
              <div key={`${line}-${index}`} className="console-line">
                {line}
              </div>
            ))}
          </footer>
        )}

        <div className="footer-meta">
          <span>adb · {adbPath || 'no detectado'}</span>
          <span>cambios reversibles · historial local</span>
        </div>
      </main>
    </div>
  )
}
