import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DeviceInfo, PlanItem, Profile, RunResult } from '../../shared/types'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
}

const PROFILES: Profile[] = ['conservative', 'recommended', 'aggressive']

export function OptimizeScreen({ t, device }: Props): JSX.Element {
  const [profile, setProfile] = useState<Profile>('recommended')
  const [items, setItems] = useState<PlanItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<RunResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [riskPrompt, setRiskPrompt] = useState<PlanItem[] | null>(null)

  useEffect(() => {
    if (!device) return
    void window.api.plan(profile).then((plan) => {
      setItems(plan)
      setSelected(
        new Set(
          plan
            .filter((item) => item.supported && item.recipe.risk === 'safe')
            .map((item) => item.recipe.id),
        ),
      )
    })
  }, [device, profile])

  const supported = useMemo(() => items.filter((item) => item.supported), [items])
  const unsupported = useMemo(() => items.filter((item) => !item.supported), [items])

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const execute = useCallback(
    async (dryRun: boolean) => {
      if (!device || selected.size === 0) {
        setError(t('optimize.nothingSelected'))
        return
      }
      setBusy(true)
      setError('')
      try {
        const outcome = await window.api.run([...selected], dryRun)
        setResults(outcome)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusy(false)
      }
    },
    [device, selected, t],
  )

  const riskySelected = useMemo(
    () =>
      items.filter(
        (item) => selected.has(item.recipe.id) && item.recipe.risk !== 'safe',
      ),
    [items, selected],
  )

  const requestRun = () => {
    if (riskySelected.length === 0) {
      void execute(false)
      return
    }
    setRiskPrompt(riskySelected)
  }

  if (!device) {
    return (
      <div className="card">
        <div className="empty">
          <p>{t('error.notConnected')}</p>
          <p className="muted">Conecta un dispositivo para ver que ajustes admite.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>{t('optimize.profile')}</h2>
          <div className="segmented">
            {PROFILES.map((option) => (
              <button
                key={option}
                type="button"
                className={profile === option ? 'active' : ''}
                onClick={() => setProfile(option)}
              >
                {t(`optimize.profile.${option}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="selection-bar">
          <span className="mono">
            {selected.size}/{supported.length} seleccionadas
          </span>
          <span className="row-actions">
            <button
              type="button"
              className="ghost small"
              onClick={() => setSelected(new Set(supported.map((item) => item.recipe.id)))}
            >
              Todo
            </button>
            <button type="button" className="ghost small" onClick={() => setSelected(new Set())}>
              Nada
            </button>
          </span>
        </div>

        <ul className="list selectable">
          {supported.map((item) => {
            const active = selected.has(item.recipe.id)
            return (
              <li
                key={item.recipe.id}
                className={`list-row plan-row risk-${item.recipe.risk}${active ? ' selected' : ''}`}
                onClick={() => toggle(item.recipe.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') toggle(item.recipe.id)
                }}
              >
                <div className="checkbox" aria-hidden>
                  {active ? '✓' : ''}
                </div>
                <div className="grow">
                  <strong>{t(item.recipe.titleKey)}</strong>
                  <span className="muted">{t(item.recipe.summaryKey)}</span>
                </div>
                <div className="row-actions">
                  <span className={`badge risk-${item.recipe.risk}`}>
                    {t(`optimize.risk.${item.recipe.risk}`)}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>

        {unsupported.length > 0 && (
          <>
            <h3 className="section-title">{t('optimize.notSupported')}</h3>
            <ul className="list muted-list">
              {unsupported.map((item) => (
                <li key={item.recipe.id} className="list-row disabled">
                  <div className="grow">
                    <strong>{t(item.recipe.titleKey)}</strong>
                    <span className="muted">{describeReason(t, item.reason)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="actions">
          <button type="button" className="ghost" disabled={busy} onClick={() => void execute(true)}>
            {t('optimize.dryRun')}
          </button>
          <button type="button" className="primary" disabled={busy} onClick={requestRun}>
            {busy ? t('optimize.running') : t('optimize.run')}
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}
      </section>

      {riskPrompt && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="risk-title">
            <h2 id="risk-title">
              {riskPrompt.some((item) => item.recipe.risk === 'advanced')
                ? 'Ajustes avanzados'
                : 'Ajustes moderados'}
            </h2>
            <p>Vas a aplicar cambios que pueden alterar el dispositivo:</p>
            <ul className="list">
              {riskPrompt.map((item) => (
                <li key={item.recipe.id} className="list-row">
                  <div className="grow">
                    <strong>{t(item.recipe.titleKey)}</strong>
                    <span className="muted">{t(item.recipe.summaryKey)}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="alert warn">
              {riskPrompt.some((item) => item.recipe.risk === 'advanced')
                ? 'Los ajustes avanzados pueden cambiar la resolucion, la densidad o el refresco. Verifica que puedes revertirlos desde Historial o por ADB.'
                : 'Estos ajustes pueden afectar notificaciones, sincronizacion o el comportamiento en segundo plano.'}
            </div>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => setRiskPrompt(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setRiskPrompt(null)
                  void execute(false)
                }}
              >
                Entiendo, aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {results && (
        <section className="card">
          <h2>{results[0]?.dryRun ? t('optimize.dryRun') : t('optimize.done')}</h2>
          <p className="muted">
            {results.filter((result) => result.status === 'ok').length} de {results.length} recetas
            completadas. Los cambios quedaron registrados en {t('nav.history')}.
          </p>
          <ul className="list">
            {results.map((result) => (
              <li key={result.recipeId} className="list-row">
                <div className="grow">
                  <strong>{result.recipeId}</strong>
                  <span className="muted">
                    {result.steps.map((step) => step.status).join(' · ')}
                  </span>
                </div>
                <span
                  className={`badge ${
                    result.status === 'ok' ? 'ok' : result.status === 'partial' ? 'warn' : 'bad'
                  }`}
                >
                  {result.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function describeReason(t: (key: string) => string, reason?: string): string {
  switch (reason) {
    case 'requiresRoot':
      return t('optimize.requiresRoot')
    case 'profile':
      return t('optimize.profile.conservative')
    case 'minSdk':
    case 'maxSdk':
    case 'tvOnly':
    case 'phoneOnly':
    case 'manufacturer':
      return t('optimize.notSupported')
    case 'specializedFlow':
      return t('optimize.specializedFlow')
    default:
      return ''
  }
}
