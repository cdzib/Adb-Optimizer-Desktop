import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { ScrcpySession, registerMirrorIpc } from '../src'

function fixture() {
  const children: Array<EventEmitter & { kill: ReturnType<typeof vi.fn> }> = []
  const spawnFn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() })
    children.push(child)
    return child as unknown as ChildProcess
  })
  return { children, spawnFn, mirror: new ScrcpySession({ adbPath: 'adb', spawnFn }) }
}

describe('mirror lifecycle', () => {
  it('deduplicates concurrent starts and publishes start/stop', async () => {
    const { mirror, children, spawnFn } = fixture()
    const changed = vi.fn()
    mirror.subscribe(changed)
    const first = mirror.start('device')
    expect(mirror.start('device')).toBe(first)
    children[0].emit('spawn')
    await first
    mirror.stop()
    expect(spawnFn).toHaveBeenCalledTimes(1)
    expect(changed.mock.calls).toEqual([[{ running: true, serial: 'device' }], [{ running: false, serial: null }]])
    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('cancels pending start and ignores late spawn/exit', async () => {
    const { mirror, children } = fixture()
    const first = mirror.start('one')
    const rejected = expect(first).rejects.toThrow('cancelado')
    const second = mirror.start('two')
    children[0].emit('spawn')
    children[0].emit('exit', 0)
    children[1].emit('spawn')
    await Promise.all([rejected, second])
    expect(mirror.status()).toEqual({ running: true, serial: 'two' })
    mirror.dispose()
    await expect(mirror.start('three')).rejects.toThrow('destruido')
  })

  it('rejects early exit and supports retry after spawn error', async () => {
    const { mirror, children } = fixture()
    const first = mirror.start('one')
    children[0].emit('exit', 1)
    await expect(first).rejects.toThrow('antes de iniciar')
    const second = mirror.start('one')
    children[1].emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }))
    await expect(second).rejects.toThrow('scrcpy no está instalado')
    expect(mirror.status().running).toBe(false)
  })

  it('rejects invalid serial without executing commands', async () => {
    const { mirror, spawnFn } = fixture()
    await expect(mirror.start('--help')).rejects.toThrow('inválido')
    expect(spawnFn).not.toHaveBeenCalled()
  })
})

describe('optional IPC adapter', () => {
  it('authorizes calls, resolves device on the host and unregisters', async () => {
    const { mirror, children } = fixture()
    const handlers = new Map<string, (event: boolean) => unknown>()
    const cleanup = registerMirrorIpc({
      mirror,
      ipcMain: {
        handle: (name, handler) => { handlers.set(name, handler) },
        removeHandler: (name) => { handlers.delete(name) },
      },
      authorize: (event: boolean) => event,
      getDevice: () => ({ serial: 'trusted-device' }),
    })
    expect(() => handlers.get('scrcpy:start')!(false)).toThrow('no autorizado')
    const pending = handlers.get('scrcpy:start')!(true)
    await Promise.resolve()
    children[0].emit('spawn')
    await expect(pending).resolves.toEqual({ running: true, serial: 'trusted-device' })
    cleanup()
    expect(handlers.size).toBe(0)
    mirror.dispose()
  })
})
