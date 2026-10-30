import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AppProfile,
  DeviceInfo,
  ProfileApp,
  ProfileAppState,
  ProfilePlan,
  ProfileProgress,
  ProfileRun,
  ProfilesDocument,
} from '../../shared/types'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
}

type ConfirmAction = { kind: 'apply' | 'delete'; profile: AppProfile }

const STATES: ProfileAppState[] = ['ENABLED', 'DISABLED', 'UNINSTALLED']
const STATE_LABEL: Record<ProfileAppState, string> = {
  ENABLED: 'Activa',
  DISABLED: 'Desactivada',
  UNINSTALLED: 'Quitada',
}
const KIND_LABEL: Record<string, string> = {
  REINSTALL: 'Reinstalar',
  ENABLE: 'Habilitar',
  DISABLE: 'Deshabilitar',
  UNINSTALL: 'Desinstalar',
}

/** Apps del perfil que ya no coinciden con el dispositivo (drift). */
function driftCount(
  profile: AppProfile,
  states: Record<string, ProfileAppState>,
): number {
  return profile.apps.filter((app) => {
    const current = states[app.packageName]
    return current != null && current !== app.state
  }).length
}

export function ProfilesScreen({ t, device }: Props): JSX.Element {
  const [document, setDocument] = useState<ProfilesDocument | null>(null)
  const [states, setStates] = useState<Record<string, ProfileAppState>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [plan, setPlan] = useState<ProfilePlan | null>(null)
  const [planVersion, setPlanVersion] = useState(0)
  const [progress, setProgress] = useState<ProfileProgress | null>(null)
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)

  const [draftName, setDraftName] = useState('')
  const [draftApps, setDraftApps] = useState<ProfileApp[] | null>(null)
  const [draftQuery, setDraftQuery] = useState('')
  const [draftLimit, setDraftLimit] = useState(80)

  const load = useCallback(async () => {
    if (!device) return
    setLoading(true)
    setError('')
    try {
      const [nextDocument, nextStates] = await Promise.all([
        window.api.profilesDocument(),
        window.api.profilesStates(),
      ])
      setDocument(nextDocument)
      setStates(nextStates)
      setPlanVersion((current) => current + 1)
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
    return window.api.onProfileProgress((event) => setProgress(event))
  }, [])

  const profiles = document?.profiles ?? []
  const selected =
    profiles.find((profile) => profile.id === selectedId) ?? profiles[0] ?? null

  useEffect(() => {
    if (!device || !selected) {
      setPlan(null)
      return
    }
    let cancelled = false
    setPlan(null)
    window.api
      .profilesPlan(selected)
      .then((next) => {
        if (!cancelled) setPlan(next)
      })
      .catch(() => {
        if (!cancelled) setPlan(null)
      })
    return () => {
      cancelled = true
    }
    // El plan se recalcula al cambiar de perfil o tras aplicar/deshacer.
  }, [device, selected?.id, planVersion])

  const selectedRun: ProfileRun | null = useMemo(() => {
    if (!selected) return null
    return document?.runs.find((run) => run.profileId === selected.id) ?? null
  }, [document, selected])

  const draftVisible = useMemo(() => {
    if (!draftApps) return []
    const term = draftQuery.trim().toLowerCase()
    const filtered =
      term.length === 0
        ? draftApps
        : draftApps.filter(
            (app) =>
              app.packageName.toLowerCase().includes(term) ||
              app.label.toLowerCase().includes(term),
          )
    return filtered.slice(0, draftLimit)
  }, [draftApps, draftLimit, draftQuery])

  const beginCreate = async () => {
    setBusy('snapshot')
    setError('')
    setNotice('')
    try {
      const snapshot = await window.api.profilesSnapshot()
      setDraftApps(snapshot)
      setDraftName(`Perfil ${new Date().toLocaleDateString()}`)
      setDraftQuery('')
      setDraftLimit(80)
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const saveDraft = async () => {
    if (!draftApps) return
    const name = draftName.trim()
    if (name.length === 0) {
      setError('El perfil necesita un nombre.')
      return
    }
    setBusy('save')
    setError('')
    setNotice('')
    try {
      const profile: AppProfile = {
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now(),
        apps: draftApps,
        watched: false,
      }
      const saved = await window.api.profilesSave(profile)
      setDraftApps(null)
      setSelectedId(saved.id)
      setNotice(`Perfil "${saved.name}" guardado con ${saved.apps.length} apps.`)
      await load()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const toggleWatched = async (profile: AppProfile) => {
    setBusy(`watch:${profile.id}`)
    setError('')
    setNotice('')
    try {
      const ok = await window.api.profilesSetWatched(profile.id, !profile.watched)
      if (!ok) {
        setError('No se pudo actualizar el perfil en vigilancia.')
      } else {
        setNotice(
          profile.watched
            ? `"${profile.name}" ya no está en vigilancia.`
            : `"${profile.name}" queda en vigilancia.`,
        )
      }
      await load()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const applyProfile = async (profile: AppProfile) => {
    setBusy(`apply:${profile.id}`)
    setError('')
    setNotice('')
    setProgress(null)
    try {
      const run = await window.api.profilesApply(profile)
      setNotice(
        `${profile.name}: ${run.changes.length} app(s) aplicadas` +
          (run.failures.length > 0 ? ` · ${run.failures.length} fallo(s)` : ''),
      )
      await load()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setProgress(null)
      setBusy(null)
    }
  }

  const undoRun = async (run: ProfileRun) => {
    if (run.changes.length === 0) return
    setBusy(`undo:${run.id}`)
    setError('')
    setNotice('')
    try {
      const restored = await window.api.profilesUndo(run.changes)
      setNotice(`${restored} de ${run.changes.length} apps restauradas.`)
      await load()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const deleteProfile = async (profile: AppProfile) => {
    setBusy(`delete:${profile.id}`)
    setError('')
    setNotice('')
    try {
      const removed = await window.api.profilesDelete(profile.id)
      if (!removed) {
        setError('El perfil ya no existe.')
      } else {
        setNotice(`Perfil "${profile.name}" eliminado.`)
        if (selectedId === profile.id) setSelectedId(null)
      }
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
            Conecta un dispositivo para guardar el estado deseado de sus apps y detectar cuándo
            dejan de coincidir.
          </p>
        </div>
      </div>
    )
  }

  const watched = profiles.find((profile) => profile.watched) ?? null

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Perfiles guardados</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {profiles.length === 0
                ? 'Guarda un snapshot del estado de las apps y aplícalo cuando haga falta.'
                : `${profiles.length} perfiles guardados${document?.runs.length ? ` · ${document.runs.length} ejecuciones` : ''}`}
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
              onClick={() => void beginCreate()}
              disabled={busy !== null}
            >
              {busy === 'snapshot' ? 'Leyendo apps…' : 'Crear perfil'}
            </button>
          </div>
        </div>

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert ok">{notice}</div>}
        {progress && (
          <div className="alert warn">
            Aplicando {progress.done}/{progress.total}:{' '}
            <span className="mono">{progress.packageName}</span> ·{' '}
            {KIND_LABEL[progress.kind] ?? progress.kind}
          </div>
        )}
        {watched && driftCount(watched, states) > 0 && (
          <div className="alert warn">
            Aviso de drift en <strong>{watched.name}</strong>: {driftCount(watched, states)} app(s)
            ya no coinciden con el perfil.
          </div>
        )}

        {loading && !document ? (
          <div className="empty">Leyendo perfiles guardados…</div>
        ) : profiles.length === 0 ? (
          <div className="empty">
            Aún no hay perfiles. Crea uno a partir del estado actual de las apps y edita lo que
            quieras cambiar.
          </div>
        ) : (
          <ul className="list">
            {profiles.map((profile) => {
              const drift = driftCount(profile, states)
              const lastRun = document?.runs.find((run) => run.profileId === profile.id) ?? null
              return (
                <li key={profile.id} className="list-row">
                  <div className="grow">
                    <div className="device-line">
                      <strong>{profile.name}</strong>
                      <span className="badge plain">{profile.apps.length} apps</span>
                      {profile.watched && <span className="badge ok">en vigilancia</span>}
                      {drift > 0 && (
                        <span className="badge warn">{drift} con drift</span>
                      )}
                    </div>
                    <span className="muted">
                      Creado {new Date(profile.createdAt).toLocaleString()}
                      {lastRun
                        ? ` · última ejecución ${new Date(lastRun.appliedAt).toLocaleString()}`
                        : ''}
                    </span>
                  </div>

                  <div className="row-actions">
                    <button
                      type="button"
                      className="ghost small"
                      onClick={() => setSelectedId(profile.id)}
                    >
                      Detalle
                    </button>
                    <button
                      type="button"
                      className="ghost small"
                      disabled={busy !== null}
                      onClick={() => void toggleWatched(profile)}
                    >
                      {profile.watched ? 'Dejar de vigilar' : 'Vigilar'}
                    </button>
                    <button
                      type="button"
                      className="ghost small"
                      disabled={busy !== null || !lastRun || lastRun.changes.length === 0}
                      onClick={() => lastRun && void undoRun(lastRun)}
                    >
                      {lastRun && busy === `undo:${lastRun.id}` ? 'Restaurando…' : 'Deshacer'}
                    </button>
                    <button
                      type="button"
                      className="primary small"
                      disabled={busy !== null}
                      onClick={() => setConfirm({ kind: 'apply', profile })}
                    >
                      {busy === `apply:${profile.id}` ? 'Aplicando…' : 'Aplicar'}
                    </button>
                    <button
                      type="button"
                      className="ghost small danger-text"
                      disabled={busy !== null}
                      onClick={() => setConfirm({ kind: 'delete', profile })}
                    >
                      Eliminar
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {draftApps && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Nuevo perfil</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {draftApps.length} apps en el snapshot. Ajusta el estado deseado de las que quieras
                controlar.
              </p>
            </div>
            <div className="row-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setDraftApps(null)}
                disabled={busy !== null}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void saveDraft()}
                disabled={busy !== null}
              >
                {busy === 'save' ? 'Guardando…' : 'Guardar perfil'}
              </button>
            </div>
          </div>

          <div className="field-row">
            <label className="field grow">
              <span>Nombre</span>
              <input
                value={draftName}
                spellCheck={false}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </label>
            <label className="field grow">
              <span>Buscar app</span>
              <input
                className="search"
                value={draftQuery}
                placeholder="Paquete o nombre…"
                onChange={(event) => {
                  setDraftQuery(event.target.value)
                  setDraftLimit(80)
                }}
              />
            </label>
          </div>

          {draftVisible.length === 0 ? (
            <div className="empty">Ninguna app coincide con la búsqueda.</div>
          ) : (
            <ul className="list">
              {draftVisible.map((app) => (
                <li key={app.packageName} className="list-row">
                  <div className="grow">
                    <div className="device-line">
                      <strong>{app.label}</strong>
                      <span className="mono muted">{app.packageName}</span>
                    </div>
                  </div>
                  <div className="segmented">
                    {STATES.map((state) => (
                      <button
                        key={state}
                        type="button"
                        className={app.state === state ? 'active' : ''}
                        onClick={() =>
                          setDraftApps((current) =>
                            current
                              ? current.map((item) =>
                                  item.packageName === app.packageName
                                    ? { ...item, state }
                                    : item,
                                )
                              : current,
                          )
                        }
                      >
                        {STATE_LABEL[state]}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {draftApps.length > draftVisible.length && (
            <div className="actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setDraftLimit((current) => current + 100)}
              >
                Mostrar más ({draftApps.length - draftVisible.length} restantes)
              </button>
            </div>
          )}
        </section>
      )}

      {selected && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Detalle · {selected.name}</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Comparación con el dispositivo actual. Las apps que no existen en este equipo se
                omiten.
              </p>
            </div>
            {plan && (
              <span className="badge plain">
                {plan.steps.reduce((count, step) => count + step.packages.length, 0)} cambios
              </span>
            )}
          </div>

          {plan === null ? (
            <div className="empty">Calculando el plan del perfil…</div>
          ) : plan.steps.length === 0 ? (
            <div className="empty">
              El dispositivo ya coincide con el perfil · {plan.same} apps iguales
              {plan.missing > 0 ? ` · ${plan.missing} no instaladas` : ''}
              {plan.blocked > 0 ? ` · ${plan.blocked} protegidas` : ''}.
            </div>
          ) : (
            <>
              <div className="spec-table">
                {plan.steps.map((step) => (
                  <div key={step.kind} className="spec-row">
                    <span className="spec-label">{KIND_LABEL[step.kind] ?? step.kind}</span>
                    <div className="mono grow">
                      {step.packages.map((packageName) => (
                        <div key={packageName}>{packageName}</div>
                      ))}
                    </div>
                    <span className="spec-right">
                      <span className="pill">{step.packages.length}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="muted">
                {plan.same} apps ya coinciden
                {plan.missing > 0 ? ` · ${plan.missing} no instaladas` : ''}
                {plan.blocked > 0 ? ` · ${plan.blocked} protegidas (no se tocan)` : ''}.
              </p>
            </>
          )}

          {selectedRun ? (
            <div className="card subtle">
              <div className="card-head">
                <h3>Última ejecución</h3>
                <span className="badge plain">
                  {new Date(selectedRun.appliedAt).toLocaleString()}
                </span>
              </div>
              {selectedRun.changes.length === 0 ? (
                <div className="empty">No se aplicó ningún cambio.</div>
              ) : (
                <ul className="list">
                  {selectedRun.changes.map((change) => (
                    <li key={change.packageName} className="list-row">
                      <div className="grow">
                        <span className="mono">{change.packageName}</span>
                      </div>
                      <span className="muted">
                        {STATE_LABEL[change.from]} → {STATE_LABEL[change.to]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {selectedRun.failures.length > 0 && (
                <div className="alert error">
                  Fallos: <span className="mono">{selectedRun.failures.join(', ')}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="empty">Este perfil aún no se ha aplicado.</div>
          )}
        </section>
      )}

      {confirm && (
        <div className="modal-backdrop" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>
              {confirm.kind === 'apply' ? 'Aplicar perfil' : 'Eliminar perfil'}
            </h3>
            <p>{confirm.profile.name}</p>
            <p className="muted">
              {confirm.kind === 'apply'
                ? 'Se cambiará el estado de las apps que no coincidan. Cada cambio se confirma releyendo el dispositivo y podrás deshacerlo desde la última ejecución.'
                : 'Se quitará el perfil guardado. Las apps del dispositivo no cambian.'}
            </p>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setConfirm(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className={confirm.kind === 'delete' ? 'danger' : 'primary'}
                onClick={() => {
                  const action = confirm
                  setConfirm(null)
                  if (action.kind === 'apply') void applyProfile(action.profile)
                  else void deleteProfile(action.profile)
                }}
              >
                {confirm.kind === 'apply' ? 'Aplicar' : 'Eliminar'}
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
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
}
