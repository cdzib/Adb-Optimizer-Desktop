import { useCallback, useEffect, useState } from 'react'
import type { DeviceInfo, JournalEntry } from '../../shared/types'
import { formatTime } from '../lib/format'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
}

export function HistoryScreen({ t, device }: Props): JSX.Element {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setEntries(await window.api.journal())
  }, [])

  useEffect(() => {
    if (device) void load()
  }, [device, load])

  const revert = async (id: string) => {
    setBusy(id)
    setError('')
    try {
      const result = await window.api.undo(id)
      if (!result.ok) {
        setError(result.steps.find((step) => step.status === 'failed')?.error ?? 'No se pudo revertir todo.')
      }
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  if (!device) {
    return (
      <div className="card">
        <div className="empty">{t('error.notConnected')}</div>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          <p>{t('history.empty')}</p>
          <p className="muted">
            Cada optimizacion queda registrada aqui con el valor anterior y su boton para deshacer.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      {error && <div className="alert error">{error}</div>}
      <section className="card">
        <h2>{t('history.title')}</h2>
        <ul className="list">
          {entries.map((entry) => {
            const expanded = open === entry.id
            const reversible = entry.steps.some((step) => step.reversible)
            return (
              <li key={entry.id} className="journal-entry">
                <div className="list-row">
                  <div className="grow">
                    <strong>{t(entry.titleKey)}</strong>
                    <span className="muted">
                      {formatTime(entry.appliedAt)} · {entry.steps.length}{' '}
                      {entry.steps.length === 1 ? 'cambio' : 'cambios'}
                      {entry.revertedAt ? ` · ${t('history.reverted')}` : ''}
                    </span>
                  </div>
                  <div className="row-actions">
                    <span className={`badge risk-${entry.risk}`}>{t(`optimize.risk.${entry.risk}`)}</span>
                    <button type="button" className="ghost small" onClick={() => setOpen(expanded ? null : entry.id)}>
                      {expanded ? '−' : '+'}
                    </button>
                    <button
                      type="button"
                      className="ghost small"
                      disabled={!reversible || Boolean(entry.revertedAt) || busy === entry.id}
                      onClick={() => void revert(entry.id)}
                    >
                      {entry.revertedAt
                        ? t('history.reverted')
                        : reversible
                          ? t('history.revert')
                          : t('history.irreversible')}
                    </button>
                  </div>
                </div>
                {expanded && (
                  <ul className="steps-list">
                    {entry.steps.map((step) => (
                      <li key={`${entry.id}-${step.index}`}>
                        <code>{step.run}</code>
                        {step.previousValue !== null && (
                          <span className="muted"> valor previo: {step.previousValue}</span>
                        )}
                        {!step.reversible && <span className="badge bad">{t('history.irreversible')}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
