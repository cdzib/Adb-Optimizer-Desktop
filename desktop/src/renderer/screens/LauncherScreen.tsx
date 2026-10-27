import { useCallback, useEffect, useState } from 'react'
import type {
  DeviceInfo,
  JournalEntry,
  LauncherPackageState,
  SystemLauncherDiagnostics,
} from '../../shared/types'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
}

export function LauncherScreen({ t, device }: Props): JSX.Element {
  const [apkName, setApkName] = useState('')
  const [packageName, setPackageName] = useState('')
  const [packageState, setPackageState] = useState<LauncherPackageState | null>(null)
  const [privileged, setPrivileged] = useState(true)
  const [diagnostics, setDiagnostics] = useState<SystemLauncherDiagnostics | null>(null)
  const [launchers, setLaunchers] = useState<Array<{ packageName: string; componentName: string }>>([])
  const [currentHome, setCurrentHome] = useState<string | null>(null)
  const [entry, setEntry] = useState<JournalEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    if (!device) return
    setBusy(true)
    setError('')
    try {
      const [systemDiagnostics, availableLaunchers, activeHome] = await Promise.all([
        window.api.launcherDiagnostics(),
        window.api.launchers().catch(() => []),
        window.api.currentLauncher().catch(() => null),
      ])
      setDiagnostics(systemDiagnostics)
      setLaunchers(availableLaunchers)
      setCurrentHome(activeHome?.packageName ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [device])

  useEffect(() => { void refresh() }, [refresh])

  const pickApk = async () => {
    const selected = await window.api.pickWanboosApk()
    if (selected) {
      setApkName(selected.name)
      setPackageName('')
      setPackageState(null)
      setError('')
      setMessage('')
    }
  }

  const inspect = async () => {
    if (!packageName) return
    setBusy(true)
    setError('')
    try {
      setPackageState(await window.api.launcherInspect(packageName))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const install = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await window.api.installLauncherApk()
      if (!result.ok) throw new Error(result.message || t('launcher.installFailed'))
      if (result.packageName) {
        setPackageName(result.packageName)
        setPackageState(await window.api.launcherInspect(result.packageName).catch(() => null))
      }
      setMessage(t('launcher.installed'))
      setLaunchers(await window.api.launchers())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const installSystem = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const stored = await window.api.installSystemLauncher(packageName, privileged)
      setEntry(stored)
      setMessage(t('launcher.installCompleted'))
      setPackageState(await window.api.launcherInspect(packageName).catch(() => null))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      // El APK puede haber quedado en /system: ofrece el rollback de la bitácora.
      const entries = await window.api.journal().catch(() => [])
      setEntry(entries.find((item) => item.recipeId === 'wanboos-launcher') ?? null)
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const chooseHome = async (value: string) => {
    setBusy(true)
    setError('')
    try {
      const selected = await window.api.setLauncher(value)
      setCurrentHome(selected.packageName)
      setMessage(t('launcher.homeSelected'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const activate = async () => {
    setBusy(true)
    setError('')
    try {
      await window.api.activateSystemLauncher(packageName)
      setMessage(t('launcher.activated'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const undo = async () => {
    if (!entry) return
    setBusy(true)
    setError('')
    try {
      const result = await window.api.undo(entry.id)
      if (!result.ok) throw new Error(result.steps.find((step) => step.status === 'failed')?.error ?? 'Rollback incompleto.')
      setMessage(t('launcher.rollbackStarted'))
      setEntry(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!device) return <div className="card"><div className="empty"><p>{t('error.notConnected')}</p></div></div>

  const access = diagnostics?.access
  const systemReady = Boolean(diagnostics?.ready)
  const alreadySystem = packageState?.systemInstalled ?? false

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head"><h2>{t('launcher.title')}</h2></div>
        <p className="muted">{t('launcher.warning')}</p>
        <div className="list">
          <div className="list-row"><strong>{t('launcher.device')}</strong><span>{access ? `${access.manufacturer} ${access.model} · ${access.device}` : '—'}</span></div>
          <div className="list-row"><strong>{t('launcher.build')}</strong><span>{access ? `${access.buildType} · Android ${access.androidVersion} · SDK ${access.sdk}` : '—'}</span></div>
          <div className="list-row"><strong>{t('launcher.currentHome')}</strong><span>{currentHome ?? '—'}</span></div>
          <div className="list-row"><strong>{t('launcher.access')}</strong><span>{access ? access.strategy : '—'}</span></div>
          <div className="list-row"><strong>{t('launcher.systemWritable')}</strong><span>{access ? (access.systemWritable ? t('launcher.yes') : t('launcher.unknown')) : '—'}</span></div>
          <div className="list-row"><strong>{t('launcher.package')}</strong><span>{packageName || '—'}</span></div>
          <div className="list-row"><strong>{t('launcher.installedAt')}</strong><span>{packageState ? (packageState.systemInstalled ? t('launcher.locationSystem') : packageState.packageInstalled ? t('launcher.locationApp') : t('launcher.missing')) : '—'}</span></div>
        </div>
        {access && access.reasons.length > 0 && <ul className="list">
          {access.reasons.map((reason) => <li key={reason} className="list-row"><span className="muted">{reason}</span></li>)}
        </ul>}
        <div className="actions">
          <button type="button" className="ghost" onClick={() => void refresh()} disabled={busy}>{t('device.refresh')}</button>
          <button type="button" className="ghost" onClick={() => void pickApk()} disabled={busy}>{t('launcher.chooseApk')}</button>
          <button type="button" className="primary" onClick={() => void install()} disabled={busy || !apkName}>
            {busy ? t('launcher.working') : t('launcher.install')}
          </button>
        </div>
        {apkName && <p className="muted">{t('launcher.selected')}: {apkName}</p>}
        <div className="actions">
          <label className="grow">
            <span className="muted">{t('launcher.packageLabel')}</span>
            <input value={packageName} onChange={(event) => { setPackageName(event.target.value.trim()); setPackageState(null) }} placeholder="com.example.launcher" />
          </label>
          <button type="button" className="ghost" onClick={() => void inspect()} disabled={busy || !packageName}>{t('launcher.checkPackage')}</button>
        </div>
        {launchers.length > 0 && <>
          <h3 className="section-title">{t('launcher.availableHomes')}</h3>
          <ul className="list">
            {launchers.map((launcher) => <li key={launcher.componentName} className="list-row">
              <div className="grow"><strong>{launcher.packageName}</strong><span className="muted">{launcher.componentName}</span></div>
              <button type="button" className={currentHome === launcher.packageName ? 'ghost small' : 'primary'} disabled={busy || currentHome === launcher.packageName} onClick={() => void chooseHome(launcher.packageName)}>
                {currentHome === launcher.packageName ? t('launcher.current') : t('launcher.chooseHome')}
              </button>
            </li>)}
          </ul>
        </>}
        {launchers.length === 0 && !busy && <p className="muted">{t('launcher.noCompatibleHome')}</p>}
        {systemReady && <div className="card">
          <h3>{t('launcher.systemTitle')}</h3>
          <p className="muted">{t('launcher.systemWarning')}</p>
          <label className="list-row">
            <input type="checkbox" checked={privileged} onChange={(event) => setPrivileged(event.target.checked)} />
            <span>{t('launcher.privileged')}</span>
          </label>
          <div className="actions">
            <button type="button" className="primary" disabled={busy || !packageName || !packageState?.packageInstalled || alreadySystem} onClick={() => void installSystem()}>
              {busy ? t('launcher.working') : t('launcher.installSystem')}
            </button>
            {alreadySystem && currentHome !== packageName &&
              <button type="button" className="ghost" disabled={busy} onClick={() => void activate()}>
                {t('launcher.activateSystem')}
              </button>}
          </div>
        </div>}
        {!systemReady && <p className="muted">{t('launcher.noSystemAccess')}</p>}
        {entry && <div className="actions"><button type="button" className="danger" disabled={busy} onClick={() => void undo()}>{t('launcher.rollback')}</button></div>}
        {message && <div className="alert">{message}</div>}
        {error && <div className="alert error">{error}</div>}
      </section>
    </div>
  )
}
