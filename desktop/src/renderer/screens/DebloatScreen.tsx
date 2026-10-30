import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DebloatAction,
  DebloatCatalogState,
  DebloatRestoreItem,
  DebloatRisk,
  DebloatRun,
  DebloatSuggestion,
  DeviceInfo,
  ProfileAppState,
} from '../../shared/types'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
}

type RiskFilter = 'all' | DebloatRisk

const RISKS: DebloatRisk[] = ['recommended', 'advanced', 'expert']
const RISK_LABEL: Record<DebloatRisk, string> = {
  recommended: 'Recomendado',
  advanced: 'Avanzado',
  expert: 'Experto',
}
const RISK_CLASS: Record<DebloatRisk, string> = {
  recommended: 'risk-safe',
  advanced: 'risk-moderate',
  expert: 'risk-advanced',
}
const STATE_LABEL: Record<ProfileAppState, string> = {
  ENABLED: 'activa',
  DISABLED: 'congelada',
  UNINSTALLED: 'quitada',
}
const STATE_CLASS: Record<ProfileAppState, string> = {
  ENABLED: 'ok',
  DISABLED: 'warn',
  UNINSTALLED: 'bad',
}
const ACTION_LABEL: Record<DebloatAction, string> = {
  FREEZE: 'Congelar',
  UNFREEZE: 'Descongelar',
  UNINSTALL: 'Desinstalar',
  RESTORE: 'Restaurar',
}

export function DebloatScreen({ t, device }: Props): JSX.Element {
  const [catalog, setCatalog] = useState<DebloatCatalogState | null>(null)
  const [suggestions, setSuggestions] = useState<DebloatSuggestion[]>([])
  const [restorable, setRestorable] = useState<DebloatRestoreItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [risk, setRisk] = useState<RiskFilter>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [restoreSelected, setRestoreSelected] = useState<Set<string>>(new Set())
  const [run, setRun] = useState<DebloatRun | null>(null)

  const load = useCallback(async () => {
    if (!device) return
    setLoading(true)
    setError('')
    try {
      const [nextCatalog, nextSuggestions, nextRestorable] = await Promise.all([
        window.api.debloatCatalog(),
        window.api.debloatSuggestions(),
        window.api.debloatRestorable(),
      ])
      setCatalog(nextCatalog)
      setSuggestions(nextSuggestions)
      setRestorable(nextRestorable)
      setSelected((current) => {
        const available = new Set(nextSuggestions.map((item) => item.packageName))
        return new Set([...current].filter((item) => available.has(item)))
      })
      setRestoreSelected((current) => {
        const available = new Set(nextRestorable.map((item) => item.packageName))
        return new Set([...current].filter((item) => available.has(item)))
      })
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setLoading(false)
    }
  }, [device])

  useEffect(() => {
    void load()
  }, [load])

  const download = async () => {
    setBusy('catalog')
    setError('')
    setNotice('')
    try {
      const state = await window.api.debloatDownload()
      setCatalog(state)
      setNotice(`Lista UAD-NG descargada: ${state.entries.length} paquetes curados.`)
      await load()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const applyAction = async (action: DebloatAction, targets: string[]) => {
    if (targets.length === 0) return
    setBusy(action)
    setError('')
    setNotice('')
    try {
      const next = await window.api.debloatApply(action, targets)
      setRun(next)
      setSelected(new Set())
      if (next.changes.length > 0) {
        setNotice(`${ACTION_LABEL[action]}: ${next.changes.length} paquete(s) confirmados.`)
      }
      await load()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const uninstall = (targets: string[]) => {
    if (targets.length === 0) return
    const confirmed = window.confirm(
      `Se desinstalaran ${targets.length} paquete(s) del usuario 0:\n\n${targets.join('\n')}\n\n` +
        'Podras reinstalarlos desde la seccion Restaurar mientras la app conserve su bitacora.',
    )
    if (confirmed) void applyAction('UNINSTALL', targets)
  }

  const restoreSelectedPackages = async () => {
    const targets = [...restoreSelected]
    if (targets.length === 0) return
    setBusy('RESTORE')
    setError('')
    setNotice('')
    try {
      const next = await window.api.debloatRestore(targets)
      setRun(next)
      setRestoreSelected(new Set())
      if (next.changes.length > 0) {
        setNotice(`Restaurados ${next.changes.length} paquete(s).`)
      }
      await load()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const undo = async () => {
    if (!run) return
    setBusy('undo')
    setError('')
    setNotice('')
    try {
      const restored = await window.api.debloatUndo(run)
      setNotice(`Deshechos ${restored} de ${run.changes.length} cambio(s).`)
      setRun(null)
      await load()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return suggestions.filter((item) => {
      if (risk !== 'all' && item.risk !== risk) return false
      if (term.length === 0) return true
      return (
        item.packageName.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term)
      )
    })
  }, [query, risk, suggestions])

  const toggle = (packageName: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(packageName)) next.delete(packageName)
      else next.add(packageName)
      return next
    })
  }

  const toggleRestore = (packageName: string) => {
    setRestoreSelected((current) => {
      const next = new Set(current)
      if (next.has(packageName)) next.delete(packageName)
      else next.add(packageName)
      return next
    })
  }

  if (!device) {
    return (
      <div className="card">
        <div className="empty">
          <p>{t('error.notConnected')}</p>
          <p className="muted">
            Conecta un dispositivo para descargar la lista curada de paquetes y decidir cuales
            congelar o quitar.
          </p>
        </div>
      </div>
    )
  }

  const selectedTargets = [...selected]
  const entries = catalog?.entries.length ?? 0

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Sugerencias</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {catalog?.updatedAt
                ? `Lista actualizada ${new Date(catalog.updatedAt).toLocaleString()} · ${entries} paquetes`
                : 'Lista UAD-NG sin descargar'}
              {suggestions.length > 0 ? ` · ${suggestions.length} sugerencias en este equipo` : ''}
            </p>
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => void load()}
              disabled={loading || busy !== null}
            >
              {loading ? 'Leyendo…' : 'Recargar'}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void download()}
              disabled={busy !== null}
            >
              {busy === 'catalog'
                ? 'Descargando…'
                : entries > 0
                  ? 'Actualizar lista'
                  : 'Descargar lista'}
            </button>
          </div>
        </div>

        <div className="field-row">
          <label className="field grow">
            <span>Buscar</span>
            <input
              className="search"
              value={query}
              spellCheck={false}
              placeholder="Paquete o descripción…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="segmented" role="group" aria-label="Filtrar por riesgo">
            <button
              type="button"
              className={risk === 'all' ? 'active' : ''}
              onClick={() => setRisk('all')}
            >
              Todos
            </button>
            {RISKS.map((value) => (
              <button
                key={value}
                type="button"
                className={risk === value ? 'active' : ''}
                onClick={() => setRisk(value)}
              >
                {RISK_LABEL[value]}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert ok">{notice}</div>}
        {busy === 'catalog' && (
          <div className="alert warn">
            <span className="scan-mini" aria-hidden /> Descargando la lista UAD-NG…
          </div>
        )}
        {run && (
          <div className={`alert ${run.failures.length > 0 ? 'error' : 'ok'} with-action`}>
            <span>
              {ACTION_LABEL[run.action]}: {run.changes.length} confirmado(s)
              {run.failures.length > 0
                ? ` · ${run.failures.length} fallo(s): ${run.failures.join(', ')}`
                : ''}
            </span>
            <button
              type="button"
              className="ghost small"
              disabled={busy !== null || run.changes.length === 0}
              onClick={() => void undo()}
            >
              {busy === 'undo' ? 'Deshaciendo…' : 'Deshacer'}
            </button>
          </div>
        )}

        {suggestions.length === 0 ? (
          <div className="empty">
            {loading
              ? 'Leyendo paquetes del dispositivo…'
              : entries === 0
                ? 'Descarga la lista UAD-NG para ver que paquetes puedes congelar o quitar de forma segura.'
                : 'Ninguno de los paquetes de la lista está instalado en este equipo.'}
          </div>
        ) : (
          <>
            <div className="selection-bar">
              <span className="mono">
                {selected.size} de {suggestions.length} seleccionados
              </span>
              <span className="row-actions">
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => setSelected(new Set(suggestions.map((item) => item.packageName)))}
                >
                  Todo
                </button>
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => setSelected(new Set())}
                >
                  Nada
                </button>
              </span>
            </div>

            {visible.length === 0 ? (
              <div className="empty">Ningún paquete coincide con el filtro.</div>
            ) : (
              <ul className="list selectable">
                {visible.map((item) => {
                  const active = selected.has(item.packageName)
                  return (
                    <li
                      key={item.packageName}
                      className={`list-row plan-row ${RISK_CLASS[item.risk]}${active ? ' selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggle(item.packageName)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          toggle(item.packageName)
                        }
                      }}
                    >
                      <div className="checkbox" aria-hidden>
                        {active ? '✓' : ''}
                      </div>
                      <div className="grow">
                        <div className="device-line">
                          <strong className="mono">{item.packageName}</strong>
                          <span className={`badge risk-${item.risk}`}>{RISK_LABEL[item.risk]}</span>
                          <span className={`badge ${STATE_CLASS[item.state]}`}>
                            {STATE_LABEL[item.state]}
                          </span>
                          {item.source && <span className="badge plain">{item.source}</span>}
                        </div>
                        {item.description && <span className="muted">{item.description}</span>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="actions">
              <button
                type="button"
                className="ghost"
                disabled={busy !== null || selectedTargets.length === 0}
                onClick={() => void applyAction('FREEZE', selectedTargets)}
              >
                {busy === 'FREEZE' ? 'Congelando…' : 'Congelar'}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy !== null || selectedTargets.length === 0}
                onClick={() => void applyAction('UNFREEZE', selectedTargets)}
              >
                {busy === 'UNFREEZE' ? 'Descongelando…' : 'Descongelar'}
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy !== null || selectedTargets.length === 0}
                onClick={() => uninstall(selectedTargets)}
              >
                {busy === 'UNINSTALL' ? 'Desinstalando…' : 'Desinstalar'}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Restaurar</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Apps congeladas ahora mismo y paquetes que este debloater desinstaló para el usuario 0.
            </p>
          </div>
          <span className="pill">{restorable.length}</span>
        </div>

        {restorable.length === 0 ? (
          <div className="empty">No hay apps congeladas ni desinstaladas por el debloater.</div>
        ) : (
          <>
            <ul className="list selectable">
              {restorable.map((item) => {
                const active = restoreSelected.has(item.packageName)
                return (
                  <li
                    key={item.packageName}
                    className={`list-row${active ? ' selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleRestore(item.packageName)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        toggleRestore(item.packageName)
                      }
                    }}
                  >
                    <div className="checkbox" aria-hidden>
                      {active ? '✓' : ''}
                    </div>
                    <div className="grow">
                      <div className="device-line">
                        <strong className="mono">{item.packageName}</strong>
                        <span className={`badge ${STATE_CLASS[item.state]}`}>
                          {STATE_LABEL[item.state]}
                        </span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={busy !== null || restoreSelected.size === 0}
                onClick={() => void restoreSelectedPackages()}
              >
                {busy === 'RESTORE' ? 'Restaurando…' : 'Restaurar seleccionadas'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function cleanError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}
