import { useCallback, useEffect, useState } from 'react'
import type { DeviceInfo, DpcPreflight, DpcResult } from '../../shared/types'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
}

type Mode = 'device' | 'profile'

export function DpcScreen({ t, device }: Props): JSX.Element {
  const [preflight, setPreflight] = useState<DpcPreflight | null>(null)
  const [checking, setChecking] = useState(false)
  const [apkPath, setApkPath] = useState('')
  const [component, setComponent] = useState('')
  const [receivers, setReceivers] = useState<string[]>([])
  const [mode, setMode] = useState<Mode>('device')
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<DpcResult | null>(null)
  const [error, setError] = useState('')
  const [script, setScript] = useState('')

  const check = useCallback(async () => {
    if (!device) return
    setChecking(true)
    setError('')
    try {
      setPreflight(await window.api.dpcPreflight(mode))
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setChecking(false)
    }
  }, [device, mode])

  useEffect(() => {
    void check()
  }, [check])

  if (!device) {
    return (
      <div className="card">
        <div className="empty">
          <p>{t('error.notConnected')}</p>
          <p className="muted">Conecta el dispositivo que vas a aprovisionar como DPC.</p>
        </div>
      </div>
    )
  }

  const pickApk = async () => {
    const path = await window.api.dpcPickApk()
    if (path) {
      setApkPath(path)
      setResult(null)
    }
  }

  const install = async () => {
    if (!apkPath) return
    setBusy('install')
    setResult(null)
    setError('')
    try {
      const outcome = await window.api.dpcInstall(apkPath)
      setResult(outcome)
      if (outcome.ok) {
        setReceivers(await window.api.dpcReceivers())
      }
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const detect = async () => {
    setBusy('detect')
    setError('')
    try {
      const found = await window.api.dpcReceivers()
      setReceivers(found)
      if (found.length === 1 && !component) setComponent(found[0] ?? '')
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const setOwner = async () => {
    if (!component) return
    setBusy('owner')
    setResult(null)
    setError('')
    try {
      setResult(await window.api.dpcSetOwner(component, mode))
      await check()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const removeOwner = async () => {
    if (!component) return
    setBusy('remove')
    setResult(null)
    setError('')
    try {
      setResult(await window.api.dpcRemoveOwner(component))
      await check()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const generateScript = async () => {
    setScript(await window.api.dpcScript(apkPath || '<ruta-al.apk>', component || '<paquete/.Receiver>', mode))
  }

  const ready = preflight?.ready ?? false

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Requisitos de aprovisionamiento</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Android exige un dispositivo sin propietario, con un solo usuario y sin cuentas.
            </p>
          </div>
          <button type="button" className="ghost small" onClick={() => void check()} disabled={checking}>
            {checking ? 'Revisando…' : 'Volver a revisar'}
          </button>
        </div>

        {preflight && (
          <>
            <div className="check-table">
              {preflight.checks.map((item) => (
                <div key={item.id} className="check-row">
                  <span className={`check-dot ${item.status}`} aria-hidden />
                  <span className="check-label">{item.label}</span>
                  <span className="check-detail">{item.detail}</span>
                </div>
              ))}
            </div>

            {!ready && (
              <div className="alert error">
                El dispositivo no cumple los requisitos. Restaura de fábrica o elimina los usuarios
                y cuentas sobrantes antes de aprovisionar.
              </div>
            )}
            {ready && <div className="alert ok">Listo para aprovisionar como {mode === 'device' ? 'Device Owner' : 'Profile Owner'}.</div>}
          </>
        )}

        {error && <div className="alert error">{error}</div>}
      </section>

      <section className="card">
        <h2>APK del DPC</h2>
        <p className="muted">
          Elige el APK que declara un <span className="mono">DeviceAdminReceiver</span>. Se instala
          con <span className="mono">-r -g</span> (reemplaza y concede permisos en tiempo de
          ejecución).
        </p>

        <div className="field-row">
          <label className="field grow">
            <span>Archivo</span>
            <input readOnly value={apkPath} placeholder="Sin archivo seleccionado" />
          </label>
          <div className="field field-action">
            <span>&nbsp;</span>
            <button type="button" className="ghost" onClick={() => void pickApk()}>
              Elegir APK
            </button>
          </div>
        </div>

        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={!apkPath || busy !== null}
            onClick={() => void install()}
          >
            {busy === 'install' ? 'Instalando…' : 'Instalar APK'}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Componente administrador</h2>
        <p className="muted">
          Receiver con <span className="mono">android.app.action.DEVICE_ADMIN_ENABLED</span>. Puedes
          detectarlo después de instalar el APK.
        </p>

        <div className="field">
          <span>Componente</span>
          <input
            value={component}
            placeholder="com.empresa.dpc/.AdminReceiver"
            onChange={(event) => {
              setComponent(event.target.value)
              setScript('')
            }}
          />
        </div>

        <div className="actions">
          <button type="button" className="ghost" onClick={() => void detect()} disabled={busy !== null}>
            {busy === 'detect' ? 'Buscando…' : 'Detectar en el dispositivo'}
          </button>
        </div>

        {receivers.length > 0 && (
          <ul className="list receivers">
            {receivers.slice(0, 20).map((receiver) => (
              <li key={receiver} className="list-row">
                <span className="mono grow">{receiver}</span>
                <button type="button" className="ghost small" onClick={() => setComponent(receiver)}>
                  Usar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Aprovisionar</h2>

        <div className="segmented owner-mode">
          <button
            type="button"
            className={mode === 'device' ? 'active' : ''}
            onClick={() => setMode('device')}
          >
            Device Owner
          </button>
          <button
            type="button"
            className={mode === 'profile' ? 'active' : ''}
            onClick={() => setMode('profile')}
          >
            Profile Owner
          </button>
        </div>

        <p className="muted" style={{ marginTop: '10px' }}>
          {mode === 'device'
            ? 'Device Owner controla el equipo completo. Debe ejecutarse en un dispositivo recién restaurado, sin cuentas ni usuarios extra.'
            : 'Profile Owner administra un perfil de trabajo; requiere un usuario de perfil ya creado.'}
        </p>

        <div className="actions">
          <button
            type="button"
            className="ghost danger-text"
            disabled={!component || busy !== null}
            onClick={() => void removeOwner()}
            title="Solo funciona si el DPC lo permite (android:testOnly). Para un owner real hay que restaurar de fábrica."
          >
            {busy === 'remove' ? 'Quitando…' : 'Quitar owner'}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!component || !ready || busy !== null}
            onClick={() => void setOwner()}
          >
            {busy === 'owner' ? 'Aprovisionando…' : `Establecer ${mode === 'device' ? 'Device' : 'Profile'} Owner`}
          </button>
        </div>

        {result && (
          <div className={`alert ${result.ok ? 'ok' : 'error'}`}>
            <strong>{result.ok ? 'Listo' : 'Falló'}</strong>
            <pre className="output">{result.message}</pre>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Script ADB</h2>
          <button type="button" className="ghost small" onClick={() => void generateScript()}>
            Generar
          </button>
        </div>
        <p className="muted">
          Mismo flujo para integrarlo en tu pipeline. También está en{' '}
          <span className="mono">scripts/provision-dpc.sh</span>.
        </p>

        {script ? (
          <>
            <pre className="output script">{script}</pre>
            <div className="actions">
              <button
                type="button"
                className="ghost small"
                onClick={() => void navigator.clipboard.writeText(script)}
              >
                Copiar al portapapeles
              </button>
            </div>
          </>
        ) : (
          <div className="empty">Genera el script con el APK y el componente actuales.</div>
        )}
      </section>
    </div>
  )
}

function cleanError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}
