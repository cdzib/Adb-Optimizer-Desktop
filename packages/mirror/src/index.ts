import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'

export interface ScrcpyStatus {
  running: boolean
  serial: string | null
}

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess

export interface ScrcpySessionOptions {
  adbPath: string
  binary?: string
  spawnFn?: SpawnFn
  onLog?: (line: string) => void
  onExit?: (status: ScrcpyStatus) => void
}

export const SCRCPY_INSTALL_HINT = 'scrcpy no está instalado. Instálalo con: brew install scrcpy (macOS), winget install Genymobile.scrcpy (Windows) o el gestor de paquetes de tu distribución (Linux).'

export function resolveScrcpyPath(): string {
  return [process.env.SCRCPY_PATH, '/opt/homebrew/bin/scrcpy', '/usr/local/bin/scrcpy']
    .find((candidate) => candidate && existsSync(candidate)) ?? 'scrcpy'
}

interface Session {
  child: ChildProcess
  serial: string
  started: boolean
  promise: Promise<void>
  reject: (error: Error) => void
}

/** One external scrcpy window per instance; no Electron or UI dependency. */
export class ScrcpySession {
  private current: Session | null = null
  private disposed = false
  private listeners = new Set<(status: ScrcpyStatus) => void>()

  constructor(private readonly options: ScrcpySessionOptions) {
    if (!options.adbPath?.trim()) throw new Error('adbPath es obligatorio.')
  }

  status(): ScrcpyStatus {
    return { running: Boolean(this.current?.started), serial: this.current?.started ? this.current.serial : null }
  }

  subscribe(listener: (status: ScrcpyStatus) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  start(serial: string, title = 'Android Mirror'): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('El plugin fue destruido.'))
    if (typeof serial !== 'string' || !serial.trim() || serial.startsWith('-') || /[\0\r\n]/.test(serial)) {
      return Promise.reject(new Error('Serial de dispositivo inválido.'))
    }
    if (typeof title !== 'string' || /[\0\r\n]/.test(title)) return Promise.reject(new Error('Título inválido.'))
    if (this.current?.serial === serial) return this.current.promise
    this.stop()

    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
    let child: ChildProcess
    try {
      child = (this.options.spawnFn ?? spawn)(this.options.binary ?? resolveScrcpyPath(),
        ['-s', serial, '--window-title', title], {
          env: { ...process.env, ADB: this.options.adbPath },
          stdio: ['ignore', 'ignore', 'pipe'],
          shell: false,
        })
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return promise
    }
    const session: Session = { child, serial, started: false, promise, reject }
    this.current = session
    child.once('spawn', () => {
      if (this.current !== session) return
      session.started = true
      resolve()
      this.notify()
      this.options.onLog?.(`scrcpy abierto para ${serial}`)
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(new Error(error.code === 'ENOENT' ? SCRCPY_INSTALL_HINT : `No se pudo abrir scrcpy: ${error.message}`))
      if (this.current !== session) return
      this.current = null
      this.notify()
      if (session.started) this.options.onExit?.(this.status())
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (this.current !== session) return
      const line = chunk.toString('utf8').trim()
      if (line) this.options.onLog?.(`scrcpy: ${line}`)
    })
    child.once('exit', (code) => {
      if (this.current !== session) return
      this.current = null
      if (!session.started) reject(new Error(`scrcpy terminó antes de iniciar (${code ?? 'sin código'}).`))
      this.notify()
      this.options.onExit?.(this.status())
    })
    return promise
  }

  stop(): void {
    const session = this.current
    if (!session) return
    this.current = null
    if (!session.started) session.reject(new Error('Inicio de espejo cancelado.'))
    session.child.kill('SIGTERM')
    this.notify()
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    this.listeners.clear()
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.status())
  }
}

/** Structural interfaces keep Electron an optional host dependency. */
export interface MirrorIpcMain<Event> {
  handle(channel: string, listener: (event: Event) => unknown): void
  removeHandler(channel: string): void
}

export interface MirrorDevice { serial: string; title?: string }

export function registerMirrorIpc<Event>(options: {
  ipcMain: MirrorIpcMain<Event>
  mirror: ScrcpySession
  getDevice: () => MirrorDevice | null | Promise<MirrorDevice | null>
  authorize: (event: Event) => boolean
  prefix?: string
}): () => void {
  const prefix = options.prefix ?? 'scrcpy'
  const registered: string[] = []
  const handlers = {
    status: () => options.mirror.status(),
    start: async () => {
      const device = await options.getDevice()
      if (!device) throw new Error('No hay dispositivo conectado.')
      await options.mirror.start(device.serial, device.title)
      return options.mirror.status()
    },
    stop: () => { options.mirror.stop(); return options.mirror.status() },
  }
  try {
    for (const [name, handler] of Object.entries(handlers)) {
      const channel = `${prefix}:${name}`
      options.ipcMain.handle(channel, (event) => {
        if (!options.authorize(event)) throw new Error('Acceso al espejo no autorizado.')
        return handler()
      })
      registered.push(channel)
    }
  } catch (error) {
    for (const channel of registered) options.ipcMain.removeHandler(channel)
    throw error
  }
  return () => { for (const channel of registered) options.ipcMain.removeHandler(channel) }
}
