import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DeviceInfo } from '../shared/types'
import { AppsScreen } from './screens/AppsScreen'
import { ConsoleScreen } from './screens/ConsoleScreen'
import { DashboardScreen } from './screens/DashboardScreen'
import { DebloatScreen } from './screens/DebloatScreen'
import { DpcScreen } from './screens/DpcScreen'
import { FilesScreen } from './screens/FilesScreen'
import { HistoryScreen } from './screens/HistoryScreen'
import { InspectorScreen } from './screens/InspectorScreen'
import { LauncherScreen } from './screens/LauncherScreen'
import { LogcatScreen } from './screens/LogcatScreen'
import { OptimizeScreen } from './screens/OptimizeScreen'
import { PowerScreen } from './screens/PowerScreen'
import { ProfilesScreen } from './screens/ProfilesScreen'
import { RootScreen } from './screens/RootScreen'
import { SettingsDbScreen } from './screens/SettingsDbScreen'
import { FlashScreen } from './screens/FlashScreen'
import { ConnectionWorkspace } from './components/ConnectionWorkspace'
import { DeviceSwitcher } from './components/DeviceSwitcher'
import { ThemeToggle } from './components/ThemeToggle'
import {
  applyTheme,
  readThemePreference,
  saveThemePreference,
  watchSystemTheme,
  type ThemePreference,
} from './lib/theme'
import {
  GROUPS,
  NAV_ENTRIES,
  groupLabel,
  groupScreens,
  type Screen,
} from './lib/sections'
import './navigation.css'

function upsertDevice(list: DeviceInfo[], info: DeviceInfo): DeviceInfo[] {
  const index = list.findIndex((item) => item.id === info.id)
  if (index === -1) return [...list, info]
  const copy = [...list]
  copy[index] = info
  return copy
}

function cleanError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}

function deviceName(device: DeviceInfo): string {
  const model = device.model?.trim()
  return model ? model.replace(/_/g, ' ') : device.id
}

function Chevron(): JSX.Element {
  return (
    <svg className="chevron" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.5 4.5 6 8l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function App(): JSX.Element {
  const [dict, setDict] = useState<Record<string, string>>({})
  const [screen, setScreen] = useState<Screen>('devices')
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [device, setDevice] = useState<DeviceInfo | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [shellError, setShellError] = useState('')
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readThemePreference(),
  )
  const [inspectPackage, setInspectPackage] = useState<string | undefined>(undefined)
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

  useEffect(() => {
    applyTheme(themePreference)
    saveThemePreference(themePreference)
    if (themePreference !== 'system') return
    return watchSystemTheme(() => applyTheme('system'))
  }, [themePreference])

  useEffect(() => {
    let alive = true
    void window.api
      .sessionDevices()
      .then((list) => {
        if (alive) setDevices(list)
      })
      .catch((cause) => {
        if (alive) setShellError(cleanError(cause))
      })
    void window.api
      .deviceInfo()
      .then((info) => {
        if (!alive) return
        if (info) {
          setDevices((previous) => upsertDevice(previous, info))
          setDevice(info)
          setScreen('dashboard')
        } else {
          setScreen('devices')
        }
      })
      .catch(() => {
        if (alive) setScreen('devices')
      })
    return () => {
      alive = false
    }
  }, [])

  const t = useCallback((key: string) => dict[key] ?? key, [dict])

  const handleConnected = useCallback((info: DeviceInfo) => {
    setDevices((previous) => upsertDevice(previous, info))
    setDevice(info)
    setScreen('dashboard')
    setSwitcherOpen(false)
    setShellError('')
  }, [])

  const handleSwitch = useCallback(
    async (id: string) => {
      if (device?.id === id) {
        setSwitcherOpen(false)
        return
      }
      try {
        const info = await window.api.switchDevice(id)
        setDevices((previous) => upsertDevice(previous, info))
        setDevice(info)
        setScreen('dashboard')
        setSwitcherOpen(false)
        setShellError('')
      } catch (cause) {
        setShellError(cleanError(cause))
      }
    },
    [device?.id],
  )

  const handleDisconnect = useCallback(
    async (id?: string) => {
      const target = id ?? device?.id
      if (!target) return
      try {
        await window.api.disconnectDevice(target)
        const rest = devices.filter((item) => item.id !== target)
        setDevices(rest)
        if (device?.id === target) {
          const next = rest[0]
          setDevice(null)
          setScreen('devices')
          if (next) {
            const info = await window.api.switchDevice(next.id)
            setDevices((previous) => upsertDevice(previous, info))
            setDevice(info)
            setScreen('dashboard')
          } else {
            setSwitcherOpen(false)
          }
        }
        setShellError('')
      } catch (cause) {
        setShellError(cleanError(cause))
      }
    },
    [device, devices],
  )

  const handleAdd = useCallback(() => {
    setScreen('devices')
    setSwitcherOpen(false)
  }, [])

  // Al abrir el selector se reconcilia la lista con adb devices: un equipo
  // desenchufado no debe seguir ofreciéndose.
  useEffect(() => {
    if (!switcherOpen) return
    let alive = true
    void window.api
      .sessionDevices()
      .then((list) => {
        if (alive) setDevices(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [switcherOpen])

  const grouped = useMemo(() => groupScreens(), [])

  const effectiveScreen: Screen = device
    ? screen
    : screen === 'history'
      ? 'history'
      : 'devices'

  const title = useMemo(
    () => t(NAV_ENTRIES.find((item) => item.id === effectiveScreen)?.labelKey ?? 'app.name'),
    [effectiveScreen, t],
  )

  const previewGroups = GROUPS.filter((group) => group.id !== 'conexion')

  const navButton = (entryId: Screen): JSX.Element => {
    const entry = NAV_ENTRIES.find((item) => item.id === entryId)
    if (!entry) throw new Error(`Seccion desconocida: ${entryId}`)
    const active = effectiveScreen === entryId
    return (
      <button
        type="button"
        key={entry.id}
        className={`nav-item${active ? ' active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          setScreen(entry.id)
          setShellError('')
        }}
      >
        {t(entry.labelKey)}
      </button>
    )
  }

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

        {device ? (
          <>
            <button
              type="button"
              className="device-card"
              aria-haspopup="dialog"
              aria-expanded={switcherOpen}
              onClick={() => setSwitcherOpen((open) => !open)}
            >
              <span className="device-chip-dot" aria-hidden />
              <span className="device-card-text">
                <strong>{deviceName(device)}</strong>
                <span>
                  Android {device.androidVersion} · <span className="mono">{device.id}</span>
                </span>
              </span>
              <span className="device-card-chevron" aria-hidden>
                <Chevron />
              </span>
            </button>

            <nav className="nav nav-sections">
              {previewGroups.map((group) => (
                <div key={group.id} className="nav-group">
                  <div className="nav-group-label">
                    <span>{groupLabel(t, group.id)}</span>
                    <span className="nav-group-count">{grouped[group.id].length}</span>
                  </div>
                  {grouped[group.id].map((entry) => navButton(entry.id))}
                </div>
              ))}
              <div className="nav-rule" aria-hidden />
              {navButton('history')}
            </nav>

            <div className="sidebar-footer">
              <button type="button" className="ghost" onClick={handleAdd}>
                + Añadir equipo
              </button>
              <div className="status-text">
                <strong>
                  {devices.length} {devices.length === 1 ? 'equipo' : 'equipos'} · 1 activo
                </strong>
                <span>
                  Android {device.androidVersion} · SDK {device.sdk}
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <nav className="nav">
              {navButton('devices')}
              {navButton('history')}
            </nav>

            <div className="nav-preview">
              {previewGroups.map((group) => (
                <div key={group.id} className="nav-preview-row">
                  <span>{groupLabel(t, group.id)}</span>
                  <span className="nav-preview-count">{grouped[group.id].length}</span>
                </div>
              ))}
              <p className="nav-preview-note">Se crean al conectar</p>
            </div>

            <div className="sidebar-footer">
              <div className="status-text">
                <strong>Sin dispositivo</strong>
                <span>0 equipos conectados</span>
              </div>
            </div>
          </>
        )}
      </aside>

      <main className="content">
        <header className="topbar">
          <h1>{title}</h1>
          <div className="topbar-meta">
            <ThemeToggle preference={themePreference} onChange={setThemePreference} />
            {labMode && <span className="pill">LAB</span>}
            {device && <span className="pill meta-secondary">{device.abi}</span>}
            <span className="pill meta-secondary">catálogo {catalogVersion || '—'}</span>
            {device ? (
              <>
                <button
                  type="button"
                  className="device-chip"
                  aria-haspopup="dialog"
                  aria-expanded={switcherOpen}
                  onClick={() => setSwitcherOpen((open) => !open)}
                >
                  <span className="device-chip-dot" aria-hidden />
                  <strong>{deviceName(device)}</strong>
                  <Chevron />
                </button>
                <button type="button" className="primary" onClick={handleAdd}>
                  + Añadir equipo
                </button>
              </>
            ) : (
              <span className="pill">Sin conexión</span>
            )}

            {switcherOpen && (
              <DeviceSwitcher
                devices={devices}
                activeId={device?.id ?? null}
                onSwitch={(id) => void handleSwitch(id)}
                onDisconnect={(id) => void handleDisconnect(id)}
                onAdd={handleAdd}
                onClose={() => setSwitcherOpen(false)}
              />
            )}
          </div>
        </header>

        {shellError && (
          <div className="shell-error" role="alert">
            {shellError}
          </div>
        )}

        <section className="screen" key={`${device?.id ?? 'none'}:${effectiveScreen}`}>
          {effectiveScreen === 'devices' && (
            <ConnectionWorkspace
              t={t}
              onConnected={handleConnected}
              hasDevices={devices.length > 0}
            />
          )}
          {effectiveScreen === 'history' && <HistoryScreen t={t} device={device} />}
          {device && effectiveScreen === 'dashboard' && (
            <DashboardScreen
              t={t}
              device={device}
              devices={devices}
              catalogVersion={catalogVersion}
              onOptimize={() => setScreen('optimize')}
              onNavigate={(target) => setScreen(target)}
              onSwitchDevice={(id) => void handleSwitch(id)}
              onAddDevice={handleAdd}
            />
          )}
          {device && effectiveScreen === 'optimize' && <OptimizeScreen t={t} device={device} />}
          {device && effectiveScreen === 'apps' && (
            <AppsScreen
              t={t}
              device={device}
              onInspect={(packageName) => {
                setInspectPackage(packageName)
                setScreen('inspector')
              }}
            />
          )}
          {device && effectiveScreen === 'profiles' && <ProfilesScreen t={t} device={device} />}
          {device && effectiveScreen === 'debloat' && <DebloatScreen t={t} device={device} />}
          {device && effectiveScreen === 'files' && <FilesScreen t={t} device={device} />}
          {device && effectiveScreen === 'console' && <ConsoleScreen t={t} device={device} />}
          {device && effectiveScreen === 'logcat' && <LogcatScreen t={t} device={device} />}
          {device && effectiveScreen === 'inspector' && (
            <InspectorScreen t={t} device={device} initialPackage={inspectPackage} />
          )}
          {device && effectiveScreen === 'settingsdb' && <SettingsDbScreen t={t} device={device} />}
          {device && effectiveScreen === 'power' && <PowerScreen t={t} device={device} />}
          {device && effectiveScreen === 'dpc' && <DpcScreen t={t} device={device} />}
          {device && effectiveScreen === 'launcher' && <LauncherScreen t={t} device={device} />}
          {device && effectiveScreen === 'root' && <RootScreen t={t} device={device} />}
          {device && effectiveScreen === 'flash' && <FlashScreen t={t} device={device} />}
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
