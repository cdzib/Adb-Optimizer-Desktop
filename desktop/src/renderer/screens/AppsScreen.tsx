import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ActionSpec,
  ApkExtractResult,
  AppList,
  DeviceInfo,
  InstalledApp,
} from '../../shared/types'

type Filter = 'all' | 'system' | 'user' | 'hidden'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
}

const RISK_ORDER: Record<string, number> = { safe: 0, moderate: 1, advanced: 2 }

export function AppsScreen({ t, device }: Props): JSX.Element {
  const [list, setList] = useState<AppList | null>(null)
  const [actions, setActions] = useState<ActionSpec[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(120)
  const [filter, setFilter] = useState<Filter>('all')
  const [menu, setMenu] = useState<{ app: InstalledApp; top: number; left: number } | null>(null)
  const [pending, setPending] = useState<InstalledApp | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [extracted, setExtracted] = useState<ApkExtractResult | null>(null)

  const load = useCallback(async () => {
    if (!device) return
    setLoading(true)
    setError('')
    try {
      setList(await window.api.listApps())
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setLoading(false)
    }
  }, [device])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void window.api.actions().then(setActions).catch(() => {})
  }, [])

  useEffect(() => {
    if (!menu) return
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.menu')) return
      setMenu(null)
    }
    const close = () => setMenu(null)
    document.addEventListener('mousedown', closeOnOutside)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const user = list?.user ?? []
  const system = list?.system ?? []
  const hidden = list?.hidden ?? []

  const availableActions = useMemo(() => {
    const sdk = device?.sdk ?? 0
    return actions
      .filter((action) => action.paramKind === 'package')
      .filter((action) => action.minSdk == null || sdk >= action.minSdk)
      .sort((a, b) => (RISK_ORDER[a.risk] ?? 0) - (RISK_ORDER[b.risk] ?? 0))
  }, [actions, device?.sdk])

  const visible = useMemo(() => {
    const match = (app: InstalledApp) =>
      query.trim().length === 0 || app.packageName.toLowerCase().includes(query.trim().toLowerCase())

    const sections: Array<{ title: string; apps: InstalledApp[] }> = []
    if (filter === 'all' || filter === 'system') {
      sections.push({ title: `Sistema (${system.filter(match).length})`, apps: system.filter(match) })
    }
    if (filter === 'all' || filter === 'user') {
      sections.push({ title: `Usuario (${user.filter(match).length})`, apps: user.filter(match) })
    }
    if (filter === 'all' || filter === 'hidden') {
      if (hidden.length > 0 || filter === 'hidden') {
        sections.push({ title: `Ocultas (${hidden.filter(match).length})`, apps: hidden.filter(match) })
      }
    }
    return sections.filter((section) => section.apps.length > 0)
  }, [filter, hidden, query, system, user])

  const total = user.length + system.length

  const runAction = async (actionId: string, app: InstalledApp) => {
    setMenu(null)
    setBusy(app.packageName)
    setError('')
    setNotice('')
    try {
      const result = await window.api.runAppAction(actionId, app.packageName)
      const action = availableActions.find((item) => item.id === actionId)
      if (result.status === 'ok') {
        setNotice(`${t(action?.titleKey ?? actionId)} · ${app.packageName}`)
      } else {
        setError(result.error ?? 'La acción falló en el dispositivo.')
      }
      await load()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const extractApks = async (app: InstalledApp) => {
    setMenu(null)
    setBusy(app.packageName)
    setError('')
    setNotice('')
    setExtracted(null)
    try {
      const result = await window.api.extractApk(app.packageName)
      if (!result) return
      setExtracted(result)
      setNotice(
        result.files.length === 1
          ? 'APK extraido en 1 archivo.'
          : `APK extraidos: ${result.files.length} archivos (base + splits).`,
      )
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const installApks = async () => {
    setBusy('install')
    setError('')
    setNotice('')
    try {
      const paths = await window.api.pickApks()
      if (paths.length === 0) return
      const result = await window.api.installApks(paths)
      if (result.ok) {
        setNotice(
          paths.length > 1
            ? `Instalados ${paths.length} APK como un solo paquete (base + splits).`
            : 'APK instalado correctamente.',
        )
        await load()
      } else {
        setError(result.message || 'Android rechazo la instalacion.')
      }
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const confirmUninstall = async (app: InstalledApp) => {
    setMenu(null)
    setBusy(app.packageName)
    setError('')
    setNotice('')
    try {
      await window.api.uninstallApp(app)
      setNotice(
        app.system
          ? `${app.packageName} ocultada. Puedes restaurarla desde "Ocultas".`
          : `${app.packageName} desinstalada.`,
      )
      await load()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const restore = async (app: InstalledApp) => {
    setMenu(null)
    setBusy(app.packageName)
    setError('')
    try {
      await window.api.restoreApp(app)
      setNotice(`${app.packageName} restaurada.`)
      await load()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const enable = async (app: InstalledApp) => {
    setMenu(null)
    setBusy(app.packageName)
    setError('')
    try {
      await window.api.enableApp(app.packageName)
      setNotice(`${app.packageName} habilitada.`)
      await load()
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
            Conecta un dispositivo para ver sus apps de sistema y de usuario, y quitar las que no
            uses.
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
            <h2>Aplicaciones instaladas</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {total} instaladas · {system.length} de sistema · {user.length} de usuario
              {hidden.length > 0 ? ` · ${hidden.length} ocultas` : ''}
            </p>
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => void installApks()}
              disabled={busy !== null}
            >
              {busy === 'install' ? 'Instalando…' : 'Instalar APK'}
            </button>
            <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>
              {loading ? 'Leyendo…' : 'Recargar'}
            </button>
          </div>
        </div>

        <div className="apps-toolbar">
          <div className="segmented">
            {(
              [
                ['all', 'Todas'],
                ['system', 'Sistema'],
                ['user', 'Usuario'],
                ['hidden', 'Ocultas'],
              ] as Array<[Filter, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={filter === value ? 'active' : ''}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            className="search"
            value={query}
            placeholder="Buscar paquete… (ej. com.google)"
            onChange={(event) => {
              setQuery(event.target.value)
              setLimit(120)
            }}
          />
        </div>

        {error && <div className="alert error">{error}</div>}
        {notice && (
          <div className="alert ok with-action">
            <span>
              {notice}
              {extracted && <span className="mono"> · {extracted.directory}</span>}
            </span>
            {extracted && (
              <button
                type="button"
                className="ghost small"
                onClick={() => void window.api.openFolder(extracted.directory).catch(() => {})}
              >
                Abrir carpeta
              </button>
            )}
          </div>
        )}

        {loading && !list ? (
          <div className="empty">Leyendo paquetes del dispositivo…</div>
        ) : visible.length === 0 ? (
          <div className="empty">Sin resultados.</div>
        ) : (
          visible.map((section) => (
            <div key={section.title} className="apps-section">
              <h3 className="section-title">{section.title}</h3>
              <ul className="list">
                {section.apps.slice(0, limit).map((app) => (
                  <li key={app.packageName} className="list-row app-row">
                    <div className="grow">
                      <div className="device-line">
                        <strong className="mono">{app.packageName}</strong>
                        <span className={`badge plain ${app.system ? 'warn' : 'ok'}`}>
                          {app.system ? 'sistema' : 'usuario'}
                        </span>
                        {app.hidden && <span className="badge bad">oculta</span>}
                        {app.disabled && <span className="badge warn">deshabilitada</span>}
                        {app.protected && <span className="badge">protegida</span>}
                      </div>
                    </div>

                    <div className="row-actions">
                      {busy === app.packageName && <span className="scan-mini" aria-label="trabajando" />}

                      <button
                        type="button"
                        className="ghost small"
                        aria-haspopup="menu"
                        aria-expanded={menu?.app.packageName === app.packageName}
                        disabled={busy !== null}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (menu?.app.packageName === app.packageName) {
                            setMenu(null)
                            return
                          }
                          const rect = event.currentTarget.getBoundingClientRect()
                          const width = 300
                          const left = Math.max(
                            12,
                            Math.min(rect.right - width, window.innerWidth - width - 12),
                          )
                          const top = Math.min(rect.bottom + 6, window.innerHeight - 348)
                          setMenu({ app, top: Math.max(12, top), left })
                        }}
                      >
                        Acciones
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {section.apps.length > limit && (
                <button type="button" className="ghost small" onClick={() => setLimit(limit + 200)}>
                  Mostrar más ({section.apps.length - limit} restantes)
                </button>
              )}
            </div>
          ))
        )}
      </section>

      {menu &&
        createPortal(
          <div
            className="menu floating"
            role="menu"
            style={{ top: menu.top, left: menu.left }}
            onClick={(event) => event.stopPropagation()}
          >
            {availableActions.map((action) => {
              const blocked = menu.app.protected && action.id === 'disable-app'
              return (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  disabled={blocked}
                  onClick={() => void runAction(action.id, menu.app)}
                >
                  <span>{t(action.titleKey)}</span>
                  <span className={`badge risk-${action.risk}`}>
                    {t(`optimize.risk.${action.risk}`)}
                  </span>
                </button>
              )
            })}

            <div className="menu-sep" />

            <button type="button" role="menuitem" onClick={() => void extractApks(menu.app)}>
              <span>Extraer APK</span>
              <span className="badge plain">base + splits</span>
            </button>

            <div className="menu-sep" />

            {menu.app.hidden ? (
              <button type="button" role="menuitem" onClick={() => void restore(menu.app)}>
                Restaurar app
              </button>
            ) : menu.app.disabled ? (
              <button type="button" role="menuitem" onClick={() => void enable(menu.app)}>
                Habilitar app
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="danger-text"
                disabled={menu.app.protected}
                onClick={() => {
                  const app = menu.app
                  setMenu(null)
                  setPending(app)
                }}
              >
                {menu.app.protected
                  ? 'Paquete protegido'
                  : menu.app.system
                    ? 'Ocultar del usuario 0'
                    : 'Desinstalar app'}
              </button>
            )}
          </div>,
          document.body,
        )}

      <section className="card subtle">
        <h3>Qué hace cada acción</h3>
        <p className="muted">
          Las acciones salen del catálogo compartido con la app Android
          (<span className="mono">shared/recipes/actions.json</span>): cerrar, limpiar caché,
          compilar AOT, restringir en segundo plano, suspender o deshabilitar. Las de sistema solo
          se ocultan para el usuario 0 y se restauran con{' '}
          <span className="mono">cmd package install-existing</span>. <strong>Extraer APK</strong>{' '}
          usa <span className="mono">pm path</span> y <span className="mono">adb pull</span> para
          guardar el base y sus splits en una carpeta local, sin tocar el dispositivo.
        </p>
      </section>
      {pending && (
        <div className="modal-backdrop" onClick={() => setPending(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>{pending.system ? 'Ocultar app del sistema' : 'Desinstalar app'}</h3>
            <p className="mono">{pending.packageName}</p>
            <p className="muted">
              {pending.system
                ? 'Se ocultará para el usuario 0. El APK sigue en la partición de sistema y puedes restaurarla desde la pestaña "Ocultas".'
                : 'Se eliminará por completo del dispositivo. Esta acción no se puede deshacer.'}
            </p>
            {pending.protected && (
              <div className="alert error">
                Paquete protegido: desinstalarlo puede dejar el equipo inutilizable.
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setPending(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="danger"
                disabled={pending.protected || busy !== null}
                onClick={() => {
                  const app = pending
                  setPending(null)
                  void confirmUninstall(app)
                }}
              >
                {pending.system ? 'Ocultar' : 'Desinstalar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function cleanError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}
