import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppInspection, DeviceInfo, InstalledApp } from '../../shared/types'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
  initialPackage?: string
}

const KIND_LABEL: Record<string, string> = {
  activity: 'activity',
  service: 'service',
  receiver: 'receiver',
  provider: 'provider',
}

export function InspectorScreen({ t, device, initialPackage }: Props): JSX.Element {
  const [apps, setApps] = useState<InstalledApp[]>([])
  const [packageName, setPackageName] = useState(initialPackage ?? '')
  const [inspection, setInspection] = useState<AppInspection | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!device) {
      setApps([])
      return
    }
    let active = true
    void window.api
      .listApps()
      .then((list) => {
        if (!active) return
        setApps([...list.user, ...list.system])
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [device])

  const inspect = useCallback(async (target: string) => {
    const pkg = target.trim()
    if (pkg.length === 0) {
      setError('Escribe el paquete que quieres inspeccionar.')
      return
    }
    setLoading(true)
    setError('')
    setInspection(null)
    try {
      setInspection(await window.api.inspectApp(pkg))
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initialPackage) void inspect(initialPackage)
  }, [initialPackage, inspect])

  const suggestions = useMemo(() => {
    const term = packageName.trim().toLowerCase()
    const filtered =
      term.length === 0
        ? apps
        : apps.filter((app) => app.packageName.toLowerCase().includes(term))
    return filtered.slice(0, 400)
  }, [apps, packageName])

  const permissions = useMemo(() => {
    const term = query.trim().toLowerCase()
    const list = inspection?.permissions ?? []
    return term.length === 0
      ? list
      : list.filter((permission) => permission.name.toLowerCase().includes(term))
  }, [inspection?.permissions, query])

  const components = useMemo(() => {
    const term = query.trim().toLowerCase()
    const list = inspection?.components ?? []
    return term.length === 0
      ? list
      : list.filter((component) => component.className.toLowerCase().includes(term))
  }, [inspection?.components, query])

  const appOps = useMemo(() => {
    const term = query.trim().toLowerCase()
    const list = inspection?.appOps ?? []
    return term.length === 0
      ? list
      : list.filter((op) => op.name.toLowerCase().includes(term))
  }, [inspection?.appOps, query])

  if (!device) {
    return (
      <div className="card">
        <div className="empty">
          <p>{t('error.notConnected')}</p>
          <p className="muted">
            Conecta un dispositivo para revisar permisos, AppOps, componentes y firma de una app.
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
            <h2>Detalle de la app</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Solo lectura: <span className="mono">dumpsys package</span> y{' '}
              <span className="mono">appops get</span> sobre la app elegida.
            </p>
          </div>
        </div>

        <div className="field-row">
          <label className="field grow">
            <span>Paquete</span>
            <input
              list="inspector-packages"
              value={packageName}
              placeholder="com.example.app"
              spellCheck={false}
              onChange={(event) => setPackageName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void inspect(packageName)
              }}
            />
          </label>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <span>&nbsp;</span>
            <button
              type="button"
              className="primary"
              disabled={loading || packageName.trim().length === 0}
              onClick={() => void inspect(packageName)}
            >
              {loading ? 'Inspeccionando…' : 'Inspeccionar'}
            </button>
          </div>
        </div>

        <datalist id="inspector-packages">
          {suggestions.map((app) => (
            <option key={app.packageName} value={app.packageName} />
          ))}
        </datalist>

        {error && <div className="alert error">{error}</div>}

        {loading && <div className="empty">Leyendo el paquete del dispositivo…</div>}

        {!loading && !inspection && !error && (
          <div className="empty">
            <p>Sin inspeccion todavia.</p>
            <p className="muted">
              Escribe un paquete o elige una app instalada: los permisos pedidos aparecen como
              desconocidos porque el volcado no siempre indica si se concedieron.
            </p>
          </div>
        )}
      </section>

      {inspection && (
        <>
          <section className="card">
            <div className="card-head">
              <div>
                <h2 className="mono">{inspection.packageName}</h2>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {inspection.permissions.length} permisos · {inspection.appOps.length} AppOps ·{' '}
                  {inspection.components.length} componentes
                </p>
              </div>
            </div>

            <div className="spec-table">
              <div className="spec-row">
                <span className="spec-label">Firma</span>
                <span className="mono">{inspection.signature ?? 'no disponible'}</span>
                <span className="spec-right">
                  <span className={`badge plain ${inspection.signature ? 'ok' : 'warn'}`}>
                    {inspection.signature ? 'leida' : 'sin dato'}
                  </span>
                </span>
              </div>
              <div className="spec-row">
                <span className="spec-label">SHA-256 del APK</span>
                <span className="mono">{inspection.apkSha256 ?? 'no disponible'}</span>
                <span className="spec-right">
                  <span className={`badge plain ${inspection.apkSha256 ? 'ok' : 'warn'}`}>
                    {inspection.apkSha256 ? 'base.apk' : 'sin dato'}
                  </span>
                </span>
              </div>
            </div>

            <div className="field-row">
              <input
                className="search grow"
                value={query}
                placeholder="Filtrar permisos, componentes y AppOps…"
                onChange={(event) => setQuery(event.target.value)}
              />
              <button type="button" className="ghost" onClick={() => setQuery('')}>
                Limpiar
              </button>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Permisos</h2>
              <span className="badge plain">{permissions.length}</span>
            </div>
            {permissions.length === 0 ? (
              <div className="empty">
                {query ? 'Ningun permiso coincide con el filtro.' : 'El volcado no declara permisos.'}
              </div>
            ) : (
              <ul className="list">
                {permissions.map((permission) => (
                  <li key={permission.name} className="list-row">
                    <span className="grow mono">{permission.name}</span>
                    <span
                      className={`badge ${
                        permission.granted === null ? 'plain' : permission.granted ? 'ok' : 'bad'
                      }`}
                    >
                      {permission.granted === null
                        ? 'desconocido'
                        : permission.granted
                          ? 'concedido'
                          : 'denegado'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>AppOps</h2>
              <span className="badge plain">{appOps.length}</span>
            </div>
            {appOps.length === 0 ? (
              <div className="empty">
                {query ? 'Ningun AppOp coincide con el filtro.' : 'Sin AppOps reportados.'}
              </div>
            ) : (
              <ul className="list">
                {appOps.map((op) => (
                  <li key={op.name} className="list-row">
                    <span className="grow mono">{op.name}</span>
                    <span className={`badge ${modeTone(op.mode)}`}>{op.mode}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Componentes</h2>
              <span className="badge plain">{components.length}</span>
            </div>
            {components.length === 0 ? (
              <div className="empty">
                {query
                  ? 'Ningun componente coincide con el filtro.'
                  : 'El volcado no lista componentes resolver.'}
              </div>
            ) : (
              <ul className="list">
                {components.map((component) => (
                  <li key={`${component.kind}:${component.className}`} className="list-row">
                    <span className="badge plain">{KIND_LABEL[component.kind] ?? component.kind}</span>
                    <span className="grow mono">{component.className}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function modeTone(mode: string): string {
  const value = mode.toLowerCase()
  if (value === 'allow') return 'ok'
  if (value === 'deny' || value === 'ignore') return 'bad'
  if (value === 'default' || value === 'ask') return 'warn'
  return 'plain'
}

function cleanError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}
