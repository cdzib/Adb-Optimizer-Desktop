import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DeviceInfo, LogcatEntry, LogcatLevel } from '../../shared/types'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
}

const LEVELS: LogcatLevel[] = ['V', 'D', 'I', 'W', 'E', 'F']
const LIMITS = [200, 500, 1000, 2000]
const LIVE_INTERVAL_MS = 2_000

export function LogcatScreen({ device }: Props): JSX.Element {
  const [entries, setEntries] = useState<LogcatEntry[]>([])
  const [limit, setLimit] = useState(500)
  const [minLevel, setMinLevel] = useState<LogcatLevel>('V')
  const [query, setQuery] = useState('')
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const entriesRef = useRef<LogcatEntry[]>([])
  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  const load = useCallback(
    async (since?: string) => {
      if (!device) return
      setLoading(true)
      setError('')
      try {
        const batch = await window.api.logcatRead(limit, since)
        setEntries((previous) => (since === undefined ? batch : mergeEntries(previous, batch)))
      } catch (cause) {
        setError(cleanError(cause))
      } finally {
        setLoading(false)
      }
    },
    [device, limit],
  )

  useEffect(() => {
    if (!device) {
      setEntries([])
      entriesRef.current = []
      return
    }
    setEntries([])
    entriesRef.current = []
    void load()
  }, [device, load])

  const poll = useCallback(async () => {
    if (!device) return
    const last = entriesRef.current[entriesRef.current.length - 1]
    try {
      const batch = await window.api.logcatRead(limit, last?.time)
      setEntries((previous) => mergeEntries(previous, batch))
    } catch (cause) {
      setError(cleanError(cause))
    }
  }, [device, limit])

  useEffect(() => {
    if (!live || !device) return
    const timer = window.setInterval(() => void poll(), LIVE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [device, live, poll])

  const clear = async () => {
    if (!device) return
    setError('')
    setNotice('')
    try {
      await window.api.logcatClear()
      setEntries([])
      entriesRef.current = []
      setNotice('Registro del dispositivo limpiado.')
    } catch (cause) {
      setError(cleanError(cause))
    }
  }

  const exportEntries = async () => {
    setError('')
    setNotice('')
    try {
      const target = await window.api.logcatExport(visibleEntries(entries, minLevel, query))
      if (target) setNotice(`Exportado en ${target}`)
    } catch (cause) {
      setError(cleanError(cause))
    }
  }

  const visible = useMemo(() => visibleEntries(entries, minLevel, query), [entries, minLevel, query])

  if (!device) {
    return (
      <div className="card">
        <div className="empty">
          <p>Conecta un dispositivo para leer su registro.</p>
          <p className="muted">
            El visor usa <span className="mono">logcat -v threadtime</span> y puede seguir el
            registro en vivo cada 2 segundos.
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
            <h2>Entradas</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {entries.length} entradas leidas · {visible.length} visibles ·{' '}
              <span className="mono">{device.id}</span>
            </p>
          </div>
          <div className="row-actions">
            <button type="button" className="ghost" disabled={loading} onClick={() => void load()}>
              {loading ? 'Leyendo…' : 'Recargar'}
            </button>
            <button
              type="button"
              className={live ? 'primary' : 'ghost'}
              onClick={() => setLive((value) => !value)}
            >
              {live ? 'Detener en vivo' : 'Modo en vivo'}
            </button>
            <button type="button" className="ghost" onClick={() => void exportEntries()}>
              Exportar
            </button>
            <button type="button" className="ghost" onClick={() => void clear()}>
              Limpiar
            </button>
          </div>
        </div>

        <div className="apps-toolbar">
          <div className="segmented">
            {LIMITS.map((value) => (
              <button
                key={value}
                type="button"
                className={limit === value ? 'active' : ''}
                onClick={() => setLimit(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="segmented" aria-label="Nivel minimo">
            {LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                className={minLevel === level ? 'active' : ''}
                onClick={() => setMinLevel(level)}
              >
                {level}
              </button>
            ))}
          </div>
          <input
            className="search"
            value={query}
            placeholder="Buscar en tag o mensaje…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert ok">{notice}</div>}

        {loading && entries.length === 0 ? (
          <div className="empty">Leyendo el registro del dispositivo…</div>
        ) : visible.length === 0 ? (
          <div className="empty">
            {entries.length === 0 ? 'Sin entradas en el registro.' : 'Sin resultados para el filtro.'}
          </div>
        ) : (
          <ul className="list">
            {visible.map((entry, index) => (
              <li key={`${entry.time}-${entry.pid}-${entry.tid}-${index}`} className="list-row">
                <div className="grow">
                  <div className="device-line">
                    <span className="mono muted">{entry.time}</span>
                    <span className={`badge plain ${levelClass(entry.level)}`}>{entry.level}</span>
                    <strong className="mono">{entry.tag}</strong>
                    <span className="muted mono">({entry.pid})</span>
                  </div>
                  <pre className="console-output mono">{entry.message}</pre>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function levelClass(level: LogcatLevel): string {
  if (level === 'E' || level === 'F') return 'bad'
  if (level === 'W') return 'warn'
  return 'ok'
}

function visibleEntries(
  entries: LogcatEntry[],
  minLevel: LogcatLevel,
  query: string,
): LogcatEntry[] {
  const threshold = Math.max(LEVELS.indexOf(minLevel), 0)
  const needle = query.trim().toLowerCase()
  return entries.filter((entry) => {
    if (LEVELS.indexOf(entry.level) < threshold) return false
    if (needle.length === 0) return true
    return (
      entry.tag.toLowerCase().includes(needle) ||
      entry.message.toLowerCase().includes(needle)
    )
  })
}

function mergeEntries(existing: LogcatEntry[], incoming: LogcatEntry[]): LogcatEntry[] {
  if (incoming.length === 0) return existing
  const last = existing[existing.length - 1]
  const duplicate = last !== undefined && sameEntry(last, incoming[0]!)
  const fresh = duplicate ? incoming.slice(1) : incoming
  if (fresh.length === 0) return existing
  return [...existing, ...fresh].slice(-2000)
}

function sameEntry(left: LogcatEntry, right: LogcatEntry): boolean {
  return (
    left.time === right.time &&
    left.pid === right.pid &&
    left.tid === right.tid &&
    left.level === right.level &&
    left.tag === right.tag &&
    left.message === right.message
  )
}

function cleanError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}
