import { useCallback, useEffect, useState } from 'react'
import type { ConsoleResult, DeviceInfo } from '../../shared/types'

interface Props {
  t: (key: string) => string
  device: DeviceInfo | null
}

export function ConsoleScreen({ t, device }: Props): JSX.Element {
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [result, setResult] = useState<ConsoleResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await window.api.consoleHistory())
    } catch {
      // El historial es una comodidad: si falla, la consola sigue operativa.
      setHistory([])
    }
  }, [])

  useEffect(() => {
    if (device) void loadHistory()
  }, [device, loadHistory])

  const execute = async (value = command) => {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      setError('Escribe un comando para ejecutarlo.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const output = await window.api.consoleRun(trimmed)
      setResult(output)
      setCommand(trimmed)
      await loadHistory()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(false)
    }
  }

  const clearHistory = async () => {
    setError('')
    try {
      await window.api.consoleClearHistory()
      setHistory([])
    } catch (cause) {
      setError(cleanError(cause))
    }
  }

  if (!device) {
    return (
      <div className="card">
        <div className="empty">
          <p>{t('error.notConnected')}</p>
          <p className="muted">
            Conecta un dispositivo para ejecutar comandos de shell desde el escritorio.
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
            <h2>Comandos</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Ejecuta comandos en <span className="mono">{device.id}</span> con un tiempo limite de
              60 s.
            </p>
          </div>
          <span className="badge plain">adb shell</span>
        </div>

        <div className="apps-toolbar">
          <input
            className="search mono grow"
            value={command}
            placeholder="getprop ro.product.model"
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !busy) {
                event.preventDefault()
                void execute()
              }
            }}
          />
          <button
            type="button"
            className="primary"
            disabled={busy || command.trim().length === 0}
            onClick={() => void execute()}
          >
            {busy ? 'Ejecutando…' : 'Ejecutar'}
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}

        {result && (
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            <div className="row-actions">
              <span className={`badge plain ${result.exitCode === 0 ? 'ok' : 'bad'}`}>
                salida {result.exitCode}
              </span>
              <span className="badge plain">{result.durationMs} ms</span>
              {result.timedOut && <span className="badge warn">tiempo agotado</span>}
            </div>

            {result.stdout.length > 0 && (
              <pre className="console-output mono">{result.stdout}</pre>
            )}
            {result.stderr.length > 0 && (
              <div>
                <div className="badge bad">stderr</div>
                <pre className="console-output mono">{result.stderr}</pre>
              </div>
            )}
            {result.stdout.length === 0 && result.stderr.length === 0 && (
              <div className="empty">El comando termino sin salida.</div>
            )}
          </div>
        )}
      </section>

      <section className="card subtle">
        <div className="card-head">
          <h3>Historial</h3>
          <button
            type="button"
            className="ghost small"
            disabled={history.length === 0}
            onClick={() => void clearHistory()}
          >
            Limpiar historial
          </button>
        </div>
        {history.length === 0 ? (
          <p className="muted">Aun no has ejecutado comandos.</p>
        ) : (
          <div className="row-actions">
            {history.map((item) => (
              <button
                key={item}
                type="button"
                className="ghost small mono"
                title={item}
                disabled={busy}
                onClick={() => {
                  setCommand(item)
                  void execute(item)
                }}
              >
                {item.length > 48 ? `${item.slice(0, 48)}…` : item}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function cleanError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}
