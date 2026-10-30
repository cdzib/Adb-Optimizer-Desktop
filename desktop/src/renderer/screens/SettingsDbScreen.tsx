import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DeviceInfo,
  QuickSettings,
  SettingEntry,
  SettingsChange,
  SettingsNamespace,
} from '../../shared/types'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
}

const TABS: Array<[SettingsNamespace, string]> = [
  ['global', 'global'],
  ['secure', 'secure'],
  ['system', 'system'],
]

const TIMEOUTS: Array<[string, number]> = [
  ['15 s', 15_000],
  ['30 s', 30_000],
  ['1 min', 60_000],
  ['5 min', 300_000],
  ['10 min', 600_000],
]

export function SettingsDbScreen({ t, device }: Props): JSX.Element {
  const [namespace, setNamespace] = useState<SettingsNamespace>('global')
  const [entries, setEntries] = useState<SettingEntry[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(200)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [quick, setQuick] = useState<QuickSettings | null>(null)
  const [history, setHistory] = useState<SettingsChange[]>([])

  const loadList = useCallback(async () => {
    if (!device) return
    setLoading(true)
    setError('')
    try {
      setEntries(await window.api.settingsList(namespace))
      setDrafts({})
    } catch (cause) {
      setEntries([])
      setError(cleanError(cause))
    } finally {
      setLoading(false)
    }
  }, [device, namespace])

  const loadExtras = useCallback(async () => {
    if (!device) return
    const [quickResult, historyResult] = await Promise.allSettled([
      window.api.settingsQuick(),
      window.api.settingsHistory(),
    ])
    if (quickResult.status === 'fulfilled') setQuick(quickResult.value)
    if (historyResult.status === 'fulfilled') setHistory(historyResult.value)
  }, [device])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    void loadExtras()
  }, [loadExtras])

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    const filtered =
      term.length === 0
        ? entries
        : entries.filter(
            (entry) =>
              entry.key.toLowerCase().includes(term) || entry.value.toLowerCase().includes(term),
          )
    return filtered.slice(0, limit)
  }, [entries, limit, query])

  const refresh = async () => {
    await Promise.all([loadList(), loadExtras()])
  }

  const saveEntry = async (entry: SettingEntry) => {
    const value = drafts[entry.key] ?? entry.value
    setBusy(`save:${entry.key}`)
    setError('')
    setNotice('')
    try {
      const result = await window.api.settingsSave(namespace, entry.key, value)
      if (result.ok) {
        setNotice(`${namespace}/${entry.key} = ${result.value || '(vacio)'}`)
      } else {
        setError(
          `Android no conservo el valor de ${entry.key}. La clave puede estar protegida por el fabricante.`,
        )
      }
      await refresh()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const writeSetting = async (
    action: string,
    table: SettingsNamespace,
    key: string,
    value: string,
  ) => {
    setBusy(action)
    setError('')
    setNotice('')
    try {
      const result = await window.api.settingsSave(table, key, value)
      if (result.ok) {
        setNotice(`${table}/${key} = ${result.value || '(vacio)'}`)
      } else {
        setError(`Android no conservo ${table}/${key}.`)
      }
      await refresh()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const setNight = async (mode: 'yes' | 'no' | 'auto') => {
    setBusy('night')
    setError('')
    setNotice('')
    try {
      const result = await window.api.settingsSetNightMode(mode)
      if (result.ok) {
        setNotice(`Modo noche: ${mode}`)
      } else {
        setError('Android no confirmo el modo noche.')
      }
      await loadExtras()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const undo = async (change: SettingsChange) => {
    setBusy(`undo:${change.id}`)
    setError('')
    setNotice('')
    try {
      const result = await window.api.settingsUndo(change.id)
      if (result.ok) {
        setNotice(`${change.namespace}/${change.key} restaurado a ${change.previousValue || '(vacio)'}`)
      } else {
        setError(`No se pudo restaurar ${change.namespace}/${change.key}.`)
      }
      await refresh()
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
            Conecta un dispositivo para leer y editar las tablas de ajustes global, secure y system.
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
            <h2>Tablas</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {entries.length} claves en <span className="mono">{namespace}</span> · cada escritura se
              confirma releyendo el valor.
            </p>
          </div>
          <button
            type="button"
            className="ghost"
            disabled={loading || busy !== null}
            onClick={() => void refresh()}
          >
            {loading ? 'Leyendo…' : 'Recargar'}
          </button>
        </div>

        <div className="field-row">
          <div className="segmented">
            {TABS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={namespace === value ? 'active' : ''}
                onClick={() => {
                  setNamespace(value)
                  setLimit(200)
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            className="search grow"
            value={query}
            placeholder="Buscar clave o valor…"
            onChange={(event) => {
              setQuery(event.target.value)
              setLimit(200)
            }}
          />
        </div>

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert ok">{notice}</div>}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Ajustes rapidos</h2>
          {quick === null && <span className="badge plain">sin datos</span>}
        </div>

        <div className="spec-table">
          <div className="spec-row">
            <span className="spec-label">Modo noche</span>
            <div className="segmented">
              {(['yes', 'no', 'auto'] as Array<'yes' | 'no' | 'auto'>).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={quick?.nightMode === mode ? 'active' : ''}
                  disabled={busy !== null}
                  onClick={() => void setNight(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <span className="spec-right mono">{quick?.nightMode ?? '—'}</span>
          </div>

          <div className="spec-row">
            <span className="spec-label">Tiempo de pantalla</span>
            <span className="mono">{formatTimeout(quick?.screenOffTimeoutMs ?? null)}</span>
            <span className="spec-right mono">
              {quick?.screenOffTimeoutMs != null ? `${quick.screenOffTimeoutMs} ms` : '—'}
            </span>
          </div>

          <div className="spec-row">
            <span className="spec-label">Brillo</span>
            <span className="mono">{quick?.brightness ?? '—'}</span>
            <span className="spec-right muted">0–255</span>
          </div>

          <div className="spec-row">
            <span className="spec-label">Ahorro de bateria</span>
            <span className="mono">
              {quick?.batterySaver == null ? '—' : quick.batterySaver ? 'activo' : 'inactivo'}
            </span>
            <span className="spec-right">
              <button
                type="button"
                className="ghost small"
                disabled={busy !== null || quick?.batterySaver == null}
                onClick={() =>
                  void writeSetting(
                    'battery',
                    'global',
                    'low_power',
                    quick?.batterySaver ? '0' : '1',
                  )
                }
              >
                {quick?.batterySaver ? 'Desactivar' : 'Activar'}
              </button>
            </span>
          </div>
        </div>

        <div className="actions">
          {TIMEOUTS.map(([label, milliseconds]) => (
            <button
              key={milliseconds}
              type="button"
              className="ghost small"
              disabled={busy !== null}
              onClick={() =>
                void writeSetting('timeout', 'system', 'screen_off_timeout', String(milliseconds))
              }
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Tabla {namespace}</h2>
          <span className="badge plain">{entryCountLabel(entries.length, visible.length)}</span>
        </div>

        {loading && entries.length === 0 ? (
          <div className="empty">Leyendo ajustes del dispositivo…</div>
        ) : visible.length === 0 ? (
          <div className="empty">
            {query ? 'Sin claves que coincidan con la busqueda.' : 'La tabla esta vacia.'}
          </div>
        ) : (
          <ul className="list">
            {visible.map((entry) => {
              const value = drafts[entry.key] ?? entry.value
              const dirty = value !== entry.value
              return (
                <li key={entry.key} className="list-row">
                  <div className="grow">
                    <strong className="mono">{entry.key}</strong>
                    <span className="muted mono">{entry.value || '(vacio)'}</span>
                  </div>
                  <input
                    className="search"
                    value={value}
                    spellCheck={false}
                    aria-label={`Valor de ${entry.key}`}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [entry.key]: event.target.value }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void saveEntry(entry)
                    }}
                  />
                  <button
                    type="button"
                    className="ghost small"
                    disabled={busy !== null || !dirty}
                    onClick={() => void saveEntry(entry)}
                  >
                    {busy === `save:${entry.key}` ? 'Guardando…' : 'Guardar'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {entries.length > visible.length && (
          <div className="actions">
            <button type="button" className="ghost" onClick={() => setLimit((current) => current + 200)}>
              Mostrar mas ({entries.length - visible.length} restantes)
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Historial de cambios</h2>
          <span className="badge plain">{history.length}</span>
        </div>

        {history.length === 0 ? (
          <div className="empty">
            Aun no hay cambios. Cada escritura confirmada queda aqui con su valor anterior para
            deshacerla.
          </div>
        ) : (
          <ul className="list">
            {history.map((change) => (
              <li key={change.id} className="list-row">
                <div className="grow">
                  <div className="device-line">
                    <strong className="mono">
                      {change.namespace}/{change.key}
                    </strong>
                    <span className="badge plain">{new Date(change.appliedAt).toLocaleString()}</span>
                  </div>
                  <span className="muted mono">
                    {change.previousValue || '(vacio)'} → {change.newValue || '(vacio)'}
                  </span>
                </div>
                <button
                  type="button"
                  className="ghost small"
                  disabled={busy !== null}
                  onClick={() => void undo(change)}
                >
                  {busy === `undo:${change.id}` ? 'Restaurando…' : 'Deshacer'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function entryCountLabel(total: number, shown: number): string {
  return total === shown ? String(total) : `${shown} de ${total}`
}

function formatTimeout(milliseconds: number | null): string {
  if (milliseconds == null) return '—'
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1000)} s`
  return `${Math.round(milliseconds / 60_000)} min`
}

function cleanError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}
