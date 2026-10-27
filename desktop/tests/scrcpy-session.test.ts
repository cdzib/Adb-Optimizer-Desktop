import { EventEmitter } from 'node:events'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { ScrcpySession, SCRCPY_INSTALL_HINT } from '../src/main/adb/scrcpy-session'

class FakeChild extends EventEmitter {
  killed: string[] = []
  stderr = new EventEmitter()

  kill(signal: string): boolean {
    this.killed.push(signal)
    return true
  }
}

function spawnOk() {
  const calls: Array<{ command: string; args: string[]; options: SpawnOptions }> = []
  const children: FakeChild[] = []
  const spawnFn = vi.fn((command: string, args: string[], options: SpawnOptions) => {
    calls.push({ command, args, options })
    const child = new FakeChild()
    children.push(child)
    queueMicrotask(() => child.emit('spawn'))
    return child as unknown as ChildProcess
  })
  return { spawnFn, calls, children }
}

describe('ScrcpySession', () => {
  it('lanza scrcpy con el serial y usa el adb de la app', async () => {
    const { spawnFn, calls } = spawnOk()
    const session = new ScrcpySession({ adbPath: '/opt/adb', binary: '/bin/scrcpy', spawnFn })

    await session.start('192.168.1.40:5555', 'ADB Optimizer · TV')

    expect(calls[0].command).toBe('/bin/scrcpy')
    expect(calls[0].args).toEqual(['-s', '192.168.1.40:5555', '--window-title', 'ADB Optimizer · TV'])
    expect(calls[0].options.env?.ADB).toBe('/opt/adb')
    expect(session.status()).toEqual({ running: true, serial: '192.168.1.40:5555' })
  })

  it('no abre una segunda ventana para el mismo dispositivo', async () => {
    const { spawnFn } = spawnOk()
    const session = new ScrcpySession({ adbPath: 'adb', binary: 'scrcpy', spawnFn })

    await session.start('serie-1', 'a')
    await session.start('serie-1', 'a')

    expect(spawnFn).toHaveBeenCalledTimes(1)
  })

  it('reemplaza la ventana anterior al cambiar de dispositivo', async () => {
    const { spawnFn, children } = spawnOk()
    const session = new ScrcpySession({ adbPath: 'adb', binary: 'scrcpy', spawnFn })

    await session.start('serie-1', 'a')
    await session.start('serie-2', 'a')

    expect(children[0].killed).toEqual(['SIGTERM'])
    expect(session.status().serial).toBe('serie-2')
  })

  it('explica cómo instalar scrcpy cuando el binario no existe', async () => {
    const spawnFn = vi.fn(() => {
      const child = new FakeChild()
      queueMicrotask(() => {
        const error = Object.assign(new Error('spawn scrcpy ENOENT'), { code: 'ENOENT' })
        child.emit('error', error)
      })
      return child as unknown as ChildProcess
    })
    const session = new ScrcpySession({ adbPath: 'adb', binary: 'scrcpy', spawnFn })

    await expect(session.start('serie-1', 'a')).rejects.toThrow(SCRCPY_INSTALL_HINT)
    expect(session.status().running).toBe(false)
  })

  it('stop mata el proceso y limpia el estado sin avisar como cierre inesperado', async () => {
    const { spawnFn, children } = spawnOk()
    const onExit = vi.fn()
    const session = new ScrcpySession({ adbPath: 'adb', binary: 'scrcpy', spawnFn, onExit })

    await session.start('serie-1', 'a')
    session.stop()
    children[0].emit('exit', 0)

    expect(children[0].killed).toEqual(['SIGTERM'])
    expect(session.status()).toEqual({ running: false, serial: null })
    expect(onExit).not.toHaveBeenCalled()
  })

  it('avisa cuando la ventana se cierra por su cuenta', async () => {
    const { spawnFn, children } = spawnOk()
    const onExit = vi.fn()
    const session = new ScrcpySession({ adbPath: 'adb', binary: 'scrcpy', spawnFn, onExit })

    await session.start('serie-1', 'a')
    children[0].emit('exit', 1)

    expect(onExit).toHaveBeenCalledWith({ running: false, serial: null })
    expect(session.status().running).toBe(false)
  })
})
