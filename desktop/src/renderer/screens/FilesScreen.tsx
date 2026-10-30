import { useCallback, useEffect, useState } from 'react'
import type { DeviceInfo, RemoteFileEntry } from '../../shared/types'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
}

const START_PATH = '/sdcard'

export function FilesScreen({ t, device }: Props): JSX.Element {
  const [path, setPath] = useState(START_PATH)
  const [entries, setEntries] = useState<RemoteFileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [viewer, setViewer] = useState<{ name: string; path: string; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!device) return
    setLoading(true)
    setError('')
    try {
      setEntries(await window.api.filesList(path))
    } catch (cause) {
      setEntries([])
      setError(cleanError(cause))
    } finally {
      setLoading(false)
    }
  }, [device, path])

  useEffect(() => {
    if (!device) {
      setEntries([])
      return
    }
    void load()
  }, [device, load])

  useEffect(() => {
    setPath(START_PATH)
  }, [device?.id])

  const viewText = async (entry: RemoteFileEntry) => {
    setBusy(`view:${entry.path}`)
    setError('')
    setNotice('')
    try {
      const text = await window.api.filesReadText(entry.path)
      setViewer({ name: entry.name, path: entry.path, text })
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const createFolder = async () => {
    const name = window.prompt('Nombre de la nueva carpeta')
    if (name === null) return
    setBusy('mkdir')
    setError('')
    setNotice('')
    try {
      await window.api.filesMkdir(path, name)
      setNotice(`Carpeta ${name.trim()} creada.`)
      await load()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const renameEntry = async (entry: RemoteFileEntry) => {
    const name = window.prompt(`Nuevo nombre para ${entry.name}`, entry.name)
    if (name === null || name.trim() === entry.name) return
    setBusy(`rename:${entry.path}`)
    setError('')
    setNotice('')
    try {
      await window.api.filesRename(entry.path, name)
      setNotice(`${entry.name} renombrado.`)
      await load()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const deleteEntry = async (entry: RemoteFileEntry) => {
    const kind = entry.isDirectory ? 'la carpeta' : 'el archivo'
    if (!window.confirm(`¿Borrar ${kind} ${entry.name}? Esta acción no se puede deshacer.`)) return
    setBusy(`delete:${entry.path}`)
    setError('')
    setNotice('')
    try {
      await window.api.filesDelete(entry.path)
      setNotice(`${entry.name} borrado.`)
      await load()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const installApk = async (entry: RemoteFileEntry) => {
    setBusy(`install:${entry.path}`)
    setError('')
    setNotice('')
    try {
      const result = await window.api.filesInstallApk(entry.path, {
        grantPermissions: true,
        allowDowngrade: false,
        allowTest: false,
      })
      if (result.ok) {
        setNotice(result.message || `${entry.name} instalado.`)
      } else {
        setError(result.message || 'Android rechazó la instalación.')
      }
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const pullEntry = async (entry: RemoteFileEntry) => {
    setBusy(`pull:${entry.path}`)
    setError('')
    setNotice('')
    try {
      const result = await window.api.filesPull(entry.path)
      if (!result) return
      setNotice(
        result.files.length === 0
          ? `Descargado en ${result.directory}.`
          : `Descargado en ${result.directory}: ${result.files.join(', ')}.`,
      )
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(null)
    }
  }

  const pushFiles = async () => {
    setBusy('push')
    setError('')
    setNotice('')
    try {
      const result = await window.api.filesPush(path)
      if (!result) return
      setNotice(`${result.files.length} archivo(s) subido(s) a ${path}.`)
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
            Conecta un dispositivo para explorar sus carpetas, leer archivos, instalar APK y
            descargar o subir contenido.
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
            <h2>Explorador</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {entries.length} entradas · <span className="mono">{device.model}</span>
            </p>
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="primary"
              disabled={busy !== null}
              onClick={() => void pushFiles()}
            >
              Subir archivos
            </button>
            <button type="button" className="ghost" disabled={loading} onClick={() => void load()}>
              {loading ? 'Leyendo…' : 'Recargar'}
            </button>
          </div>
        </div>

        <div className="field-row">
          <button
            type="button"
            className="ghost small"
            disabled={path === '/' || busy !== null}
            onClick={() => setPath(parentPath(path))}
          >
            Subir
          </button>
          <div className="row-actions grow">
            <button type="button" className="ghost small" onClick={() => setPath('/')}>
              /
            </button>
            {breadcrumbs(path).map((segment) => (
              <button
                key={segment.path}
                type="button"
                className="ghost small"
                disabled={segment.path === path}
                onClick={() => setPath(segment.path)}
              >
                {segment.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ghost"
            disabled={busy !== null}
            onClick={() => void createFolder()}
          >
            Nueva carpeta
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert ok">{notice}</div>}

        {loading && entries.length === 0 ? (
          <div className="empty">Leyendo {path}…</div>
        ) : entries.length === 0 ? (
          <div className="empty">Esta carpeta está vacía.</div>
        ) : (
          <ul className="list">
            {entries.map((entry) => (
              <li key={entry.path} className="list-row">
                <div className="grow">
                  <div className="device-line">
                    <span className="mono muted">{entry.isDirectory ? '▸' : '·'}</span>
                    <strong className={entry.isDirectory ? undefined : 'mono'}>{entry.name}</strong>
                    <span className="badge plain">
                      {entry.isDirectory ? 'carpeta' : entry.isLink ? 'enlace' : 'archivo'}
                    </span>
                    {entry.isApk && <span className="badge ok">apk</span>}
                    {busy === `view:${entry.path}` && <span className="muted">leyendo…</span>}
                  </div>
                  <span className="muted mono">
                    {entry.isDirectory ? '—' : formatSize(entry.sizeBytes)} · {entry.mode}
                  </span>
                </div>

                <div className="row-actions">
                  {entry.isDirectory && (
                    <button
                      type="button"
                      className="ghost small"
                      disabled={busy !== null}
                      onClick={() => setPath(entry.path)}
                    >
                      Abrir
                    </button>
                  )}
                  {!entry.isDirectory && (
                    <button
                      type="button"
                      className="ghost small"
                      disabled={busy !== null}
                      onClick={() => void viewText(entry)}
                    >
                      Ver
                    </button>
                  )}
                  {entry.isApk && (
                    <button
                      type="button"
                      className="ghost small"
                      disabled={busy !== null}
                      onClick={() => void installApk(entry)}
                    >
                      {busy === `install:${entry.path}` ? 'Instalando…' : 'Instalar'}
                    </button>
                  )}
                  {!entry.isDirectory && (
                    <button
                      type="button"
                      className="ghost small"
                      disabled={busy !== null}
                      onClick={() => void pullEntry(entry)}
                    >
                      {busy === `pull:${entry.path}` ? 'Descargando…' : 'Descargar'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost small"
                    disabled={busy !== null}
                    onClick={() => void renameEntry(entry)}
                  >
                    Renombrar
                  </button>
                  <button
                    type="button"
                    className="ghost small danger-text"
                    disabled={busy !== null}
                    onClick={() => void deleteEntry(entry)}
                  >
                    Borrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {viewer && (
        <div className="modal-backdrop" onClick={() => setViewer(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>{viewer.name}</h3>
            <p className="mono muted">{viewer.path}</p>
            <pre
              className="console-output mono"
              style={{ maxHeight: '52vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}
            >
              {viewer.text.length > 0 ? viewer.text : '(archivo vacío)'}
            </pre>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setViewer(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function parentPath(path: string): string {
  if (path === '/') return '/'
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
}

function breadcrumbs(path: string): Array<{ name: string; path: string }> {
  const parts = path.split('/').filter((part) => part.length > 0)
  let current = ''
  return parts.map((part) => {
    current += `/${part}`
    return { name: part, path: current }
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

function cleanError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}
