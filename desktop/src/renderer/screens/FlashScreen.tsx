import { useCallback, useEffect, useState } from 'react'
import type { DeviceInfo, FlashDiagnostics, FlashImage } from '../../shared/types'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
}

type Slot = 'a' | 'b' | 'all' | 'none'
const PARTITIONS = ['boot', 'init_boot', 'vendor_boot', 'recovery', 'vbmeta']

export function FlashScreen({ t, device }: Props): JSX.Element {
  const [diagnostics, setDiagnostics] = useState<FlashDiagnostics | null>(null)
  const [images, setImages] = useState<FlashImage[]>([])
  const [selected, setSelected] = useState<{ path: string; name: string; size: number } | null>(null)
  const [backup, setBackup] = useState<{ path: string; size: number } | null>(null)
  const [magiskApk, setMagiskApk] = useState<{ path: string; name: string } | null>(null)
  const [partition, setPartition] = useState('boot')
  const [backupPartition, setBackupPartition] = useState('boot')
  const [slot, setSlot] = useState<Slot>('none')
  const [disableVerity, setDisableVerity] = useState(false)
  const [confirmDevice, setConfirmDevice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [output, setOutput] = useState('')

  const load = useCallback(async () => {
    if (!device) return
    setBusy('load')
    setError('')
    try {
      const next = await window.api.flashDiagnostics()
      setDiagnostics(next)
      setImages(next.images)
      setPartition(next.bootPartition)
      setBackupPartition(next.activeBootPartition)
      setSlot(next.slotSuffix === '_a' ? 'a' : next.slotSuffix === '_b' ? 'b' : 'none')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }, [device])

  useEffect(() => { void load() }, [load])

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

  const pickLocal = () => run('pick', async () => {
    const picked = await window.api.flashPickImage()
    if (picked) {
      setSelected(picked)
      setNotice(t('flash.selected').replace('{name}', picked.name))
    }
  })

  const useDownload = (image: FlashImage) => run(`pull:${image.name}`, async () => {
    const local = await window.api.flashPullImage(image.path)
    setSelected({ path: local, name: image.name, size: image.size })
    setNotice(t('flash.selected').replace('{name}', image.name))
  })

  const backupBoot = () => run('backup', async () => {
    const result = await window.api.flashBackup(backupPartition)
    setBackup(result)
    setNotice(t('flash.backupDone').replace('{path}', result.path))
  })

  const useBackup = () => {
    if (!backup) return
    setSelected({ path: backup.path, name: backup.path.split(/[\\/]/).pop() ?? 'backup.img', size: backup.size })
    setNotice(t('flash.selected').replace('{name}', backup.path))
  }

  const pickMagisk = () => run('pick-magisk', async () => {
    const picked = await window.api.flashPickMagisk()
    if (picked) setMagiskApk(picked)
  })

  const installMagisk = () => run('install-magisk', async () => {
    if (!magiskApk) return
    const message = await window.api.flashInstallMagisk(magiskApk.path)
    setNotice(message)
    await load()
  })

  const openMagisk = () => run('open-magisk', async () => {
    await window.api.flashOpenMagisk()
    setNotice(t('flash.magiskOpened'))
  })

  const refreshImages = () => run('images', async () => {
    setImages(await window.api.flashImages())
    setNotice(t('flash.imagesRefreshed'))
  })

  const verifyRoot = () => run('verify', async () => {
    const version = await window.api.flashVerifyRoot()
    setNotice(version ? t('flash.rootOk').replace('{version}', version) : t('flash.rootMissing'))
  })

  const flash = () => run('flash', async () => {
    if (!selected) return
    if (confirmDevice.trim() !== diagnostics?.device) {
      throw new Error(t('flash.confirmMismatch').replace('{device}', diagnostics?.device ?? '?'))
    }
    setOutput('')
    const result = await window.api.flashImage({
      imagePath: selected.path,
      partition,
      slot,
      disableVerity,
      confirmDevice: confirmDevice.trim(),
    })
    setOutput(result.output)
    setNotice(t('flash.flashDone').replace('{partition}', result.partition).replace('{version}', result.magiskVersion ?? '—'))
    await load()
  })

  if (!device) return <div className="card"><div className="empty"><p>{t('error.notConnected')}</p></div></div>

  const busyNow = busy !== null
  const canBackup = Boolean(diagnostics && (diagnostics.adbRoot || diagnostics.suAvailable))
  const canFlash = Boolean(selected && diagnostics?.usb && diagnostics.fastbootAvailable)

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head"><h2>{t('flash.title')}</h2></div>
        <p className="muted">{t('flash.warning')}</p>
        <div className="list">
          <div className="list-row"><strong>{t('flash.device')}</strong><span>{diagnostics ? `${diagnostics.manufacturer} ${diagnostics.model} · ${diagnostics.device}` : '—'}</span></div>
          <div className="list-row"><strong>{t('flash.sdk')}</strong><span>{diagnostics ? `SDK ${diagnostics.sdk} · slot ${diagnostics.slotSuffix || '—'}` : '—'}</span></div>
          <div className="list-row"><strong>{t('flash.bootPartition')}</strong><span>{diagnostics ? diagnostics.bootPartition : '—'}</span></div>
          <div className="list-row"><strong>{t('flash.fastboot')}</strong><span>{diagnostics ? (diagnostics.fastbootAvailable ? diagnostics.fastbootVersion ?? t('launcher.yes') : t('launcher.no')) : '—'}</span></div>
          <div className="list-row"><strong>{t('flash.usb')}</strong><span>{diagnostics ? (diagnostics.usb ? t('launcher.yes') : t('launcher.no')) : '—'}</span></div>
          <div className="list-row"><strong>{t('flash.bootloader')}</strong><span>{diagnostics?.bootloaderLocked == null ? t('launcher.unknown') : diagnostics.bootloaderLocked ? t('root.locked') : t('root.unlocked')}</span></div>
          <div className="list-row"><strong>{t('flash.magiskApp')}</strong><span>{diagnostics ? (diagnostics.magiskApp ? diagnostics.magiskAppVersion ?? t('launcher.present') : t('launcher.missing')) : '—'}</span></div>
          <div className="list-row"><strong>{t('flash.root')}</strong><span>{diagnostics ? (diagnostics.suAvailable || diagnostics.adbRoot ? t('launcher.yes') : t('launcher.no')) : '—'}</span></div>
        </div>
        {diagnostics && diagnostics.reasons.length > 0 && <ul className="list">
          {diagnostics.reasons.map((reason) => <li key={reason} className="list-row"><span className="muted">{reason}</span></li>)}
        </ul>}
        <div className="actions">
          <button type="button" className="ghost" disabled={busyNow} onClick={() => void load()}>{t('device.refresh')}</button>
          <button type="button" className="ghost" disabled={busyNow} onClick={() => void verifyRoot()}>{t('flash.verifyRoot')}</button>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>{t('flash.backupTitle')}</h2></div>
        <p className="muted">{t('flash.backupWarning')}</p>
        <div className="actions">
          <label className="grow"><span className="muted">{t('flash.partition')}</span>
            <select value={backupPartition} onChange={(event) => setBackupPartition(event.target.value)}>
              {(diagnostics?.partitions.filter((name) => /^(boot|init_boot|vendor_boot|recovery)(_[ab])?$/.test(name)) ?? [backupPartition])
                .map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <button type="button" className="primary" disabled={busyNow || !canBackup} onClick={() => void backupBoot()}>{t('flash.backup')}</button>
          {backup && <button type="button" className="ghost" disabled={busyNow} onClick={useBackup}>{t('flash.useBackup')}</button>}
        </div>
        {backup && <p className="muted">{backup.path} · {Math.round(backup.size / 1024 / 1024)} MB</p>}
      </section>

      <section className="card">
        <div className="card-head"><h2>{t('flash.magiskTitle')}</h2></div>
        <p className="muted">{t('flash.magiskSteps')}</p>
        <div className="actions">
          <button type="button" className="ghost" disabled={busyNow} onClick={() => void pickMagisk()}>{t('flash.pickMagisk')}</button>
          <button type="button" className="primary" disabled={busyNow || !magiskApk} onClick={() => void installMagisk()}>{t('flash.installMagisk')}</button>
          <button type="button" className="ghost" disabled={busyNow || !diagnostics?.magiskApp} onClick={() => void openMagisk()}>{t('flash.openMagisk')}</button>
          <button type="button" className="ghost" disabled={busyNow} onClick={() => void refreshImages()}>{t('flash.refreshImages')}</button>
        </div>
        {magiskApk && <p className="muted">{t('launcher.selected')}: {magiskApk.name}</p>}
        {images.length > 0 && <ul className="list">
          {images.map((image) => <li key={image.path} className="list-row">
            <div className="grow"><strong>{image.name}</strong><span className="muted">{image.path} · {Math.round(image.size / 1024 / 1024)} MB</span></div>
            <button type="button" className="ghost small" disabled={busyNow} onClick={() => void useDownload(image)}>{t('flash.useImage')}</button>
          </li>)}
        </ul>}
        {images.length === 0 && <p className="muted">{t('flash.noImages')}</p>}
      </section>

      <section className="card">
        <div className="card-head"><h2>{t('flash.flashTitle')}</h2></div>
        <p className="muted">{t('flash.flashWarning')}</p>
        <div className="actions">
          <button type="button" className="ghost" disabled={busyNow} onClick={() => void pickLocal()}>{t('flash.pickLocal')}</button>
        </div>
        {selected && <p className="muted">{t('launcher.selected')}: {selected.name}</p>}
        <div className="actions">
          <label><span className="muted">{t('flash.partition')}</span>
            <select value={partition} onChange={(event) => setPartition(event.target.value)}>
              {PARTITIONS.map((name) => <option key={name} value={name}>
                {name}{diagnostics && !diagnostics.partitions.includes(name) ? ` (${t('flash.notDetected')})` : ''}
              </option>)}
            </select>
          </label>
          <label><span className="muted">{t('flash.slot')}</span>
            <select value={slot} onChange={(event) => setSlot(event.target.value as Slot)}>
              <option value="none">{t('flash.slotNone')}</option>
              <option value="a">a</option>
              <option value="b">b</option>
              <option value="all">{t('flash.slotAll')}</option>
            </select>
          </label>
          <label className="list-row">
            <input type="checkbox" checked={disableVerity} onChange={(event) => setDisableVerity(event.target.checked)} />
            <span>{t('flash.disableVerity')}</span>
          </label>
        </div>
        <label className="grow">
          <span className="muted">{t('flash.confirmLabel').replace('{device}', diagnostics?.device ?? '')}</span>
          <input value={confirmDevice} onChange={(event) => setConfirmDevice(event.target.value)} placeholder={diagnostics?.device ?? ''} />
        </label>
        <div className="actions">
          <button type="button" className="danger" disabled={busyNow || !canFlash || !selected} onClick={() => void flash()}>
            {busy === 'flash' ? t('flash.flashing') : t('flash.flash')}
          </button>
        </div>
        {output && <pre className="console-output">{output}</pre>}
        {notice && <div className="alert">{notice}</div>}
        {error && <div className="alert error">{error}</div>}
      </section>
    </div>
  )
}
