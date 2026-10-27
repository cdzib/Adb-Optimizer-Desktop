import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DeviceInfo, SystemAccessReport, SystemAppCandidate } from '../../shared/types'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
}

export function RootScreen({ t, device }: Props): JSX.Element {
  const [report, setReport] = useState<SystemAccessReport | null>(null)
  const [candidates, setCandidates] = useState<SystemAppCandidate[]>([])
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(80)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadReport = useCallback(async () => {
    if (!device) return
    setBusy('refresh')
    setError('')
    try {
      setReport(await window.api.rootDiagnostics())
      setCandidates(await window.api.systemApps())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }, [device])

  useEffect(() => { void loadReport() }, [loadReport])

  const run = async (action: string, work: () => Promise<void>) => {
    setBusy(action)
    setError('')
    setNotice('')
    try {
      await work()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const enableAdbRoot = () => run('adb-root', async () => {
    setReport(await window.api.rootEnableAdbRoot())
    setNotice(t('root.adbRootDone'))
  })

  const checkSu = () => run('su', async () => {
    setReport(await window.api.rootCheckSu())
    setNotice(t('root.suDone'))
  })

  const remount = () => run('remount', async () => {
    setReport(await window.api.rootRemount())
    setNotice(t('root.remountDone'))
  })

  const reboot = () => run('reboot', async () => {
    await window.api.rootReboot()
    setNotice(t('root.rebootDone'))
  })

  const convert = (candidate: SystemAppCandidate, privileged: boolean) => {
    const target = privileged ? '/system/priv-app' : '/system/app'
    if (!window.confirm(t('root.convertConfirm').replace('{pkg}', candidate.packageName).replace('{target}', target))) return
    void run(`convert:${candidate.packageName}`, async () => {
      await window.api.convertToSystemApp(candidate.packageName, privileged)
      setNotice(t('root.convertDone').replace('{pkg}', candidate.packageName).replace('{target}', target))
      await loadReport()
    })
  }

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    const filtered = term.length === 0
      ? candidates
      : candidates.filter((item) => item.packageName.toLowerCase().includes(term))
    return filtered.slice(0, limit)
  }, [candidates, limit, query])

  if (!device) return <div className="card"><div className="empty"><p>{t('error.notConnected')}</p></div></div>

  const strategy = report?.strategy ?? 'none'

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head"><h2>{t('root.title')}</h2></div>
        <p className="muted">{t('root.warning')}</p>
        <div className="list">
          <div className="list-row"><strong>{t('root.device')}</strong><span>{report ? `${report.manufacturer} ${report.model} · ${report.device}` : '—'}</span></div>
          <div className="list-row"><strong>{t('root.build')}</strong><span>{report ? `${report.buildType} · ${report.buildTags} · SDK ${report.sdk}` : '—'}</span></div>
          <div className="list-row"><strong>{t('root.strategy')}</strong><span>{strategy}</span></div>
          <div className="list-row"><strong>{t('root.adbRoot')}</strong><span>{report ? (report.adbRootSupported ? t('launcher.yes') : t('launcher.no')) : '—'}</span></div>
          <div className="list-row"><strong>{t('root.su')}</strong><span>{report ? (report.suUid === 0 ? t('root.suOk') : report.suAvailable ? t('root.suUnverified') : t('launcher.no')) : '—'}</span></div>
          <div className="list-row"><strong>{t('root.bootloader')}</strong><span>{report?.bootloaderLocked == null ? t('launcher.unknown') : report.bootloaderLocked ? t('root.locked') : t('root.unlocked')}</span></div>
          <div className="list-row"><strong>{t('root.verity')}</strong><span>{report?.verifiedBootState || t('launcher.unknown')}</span></div>
          <div className="list-row"><strong>{t('root.writable')}</strong><span>{report ? (report.systemWritable ? t('launcher.yes') : t('launcher.unknown')) : '—'}</span></div>
          <div className="list-row"><strong>{t('root.dynamic')}</strong><span>{report ? (report.dynamicPartitions ? t('launcher.yes') : t('launcher.no')) : '—'}</span></div>
        </div>
        {report && report.reasons.length > 0 && <ul className="list">
          {report.reasons.map((reason) => <li key={reason} className="list-row"><span className="muted">{reason}</span></li>)}
        </ul>}
        <div className="actions">
          <button type="button" className="ghost" disabled={busy !== null} onClick={() => void loadReport()}>{t('device.refresh')}</button>
          <button type="button" className="primary" disabled={busy !== null || !report?.adbRootSupported} onClick={() => void enableAdbRoot()}>{t('root.enableAdbRoot')}</button>
          <button type="button" className="primary" disabled={busy !== null || !report?.suAvailable} onClick={() => void checkSu()}>{t('root.checkSu')}</button>
          <button type="button" className="ghost" disabled={busy !== null || strategy === 'none'} onClick={() => void remount()}>{t('root.remount')}</button>
          <button type="button" className="ghost" disabled={busy !== null} onClick={() => void reboot()}>{t('root.reboot')}</button>
        </div>
        {strategy === 'none' && <div className="alert error">{t('root.noRoot')}</div>}
        {strategy === 'none' && <div className="card">
          <h3>{t('root.howTitle')}</h3>
          <ul className="list">
            <li className="list-row"><span className="muted">{t('root.howDebug')}</span></li>
            <li className="list-row"><span className="muted">{t('root.howMagisk')}</span></li>
            <li className="list-row"><span className="muted">{t('root.howRetail')}</span></li>
          </ul>
        </div>}
        {notice && <div className="alert">{notice}</div>}
        {error && <div className="alert error">{error}</div>}
      </section>

      <section className="card">
        <div className="card-head"><h2>{t('root.convertTitle')}</h2></div>
        <p className="muted">{t('root.convertWarning')}</p>
        <div className="actions">
          <input className="grow" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('root.search')} />
          <button type="button" className="ghost" disabled={busy !== null} onClick={() => void loadReport()}>{t('device.refresh')}</button>
        </div>
        {visible.length === 0 && <p className="muted">{busy ? t('launcher.working') : t('root.noApps')}</p>}
        <ul className="list">
          {visible.map((candidate) => <li key={candidate.packageName} className="list-row">
            <div className="grow"><strong>{candidate.packageName}</strong><span className="muted">{candidate.apkPath}</span></div>
            <button type="button" className="ghost small" disabled={busy !== null || strategy === 'none'} onClick={() => convert(candidate, true)}>{t('root.toPrivApp')}</button>
            <button type="button" className="ghost small" disabled={busy !== null || strategy === 'none'} onClick={() => convert(candidate, false)}>{t('root.toApp')}</button>
          </li>)}
        </ul>
        {candidates.length > limit && <div className="actions">
          <button type="button" className="ghost" onClick={() => setLimit((value) => value + 80)}>{t('root.showMore')}</button>
        </div>}
      </section>
    </div>
  )
}
