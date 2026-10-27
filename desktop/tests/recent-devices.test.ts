import { describe, expect, it } from 'vitest'
import {
  forgetRecentDevice,
  loadRecentDevices,
  rememberRecentDevice,
} from '../src/renderer/lib/recent-devices'

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

describe('equipos recientes', () => {
  it('guarda la direccion y el modelo del equipo', () => {
    const store = new MemoryStorage()
    rememberRecentDevice({ address: '192.168.1.40:37211', model: 'Pixel 7' }, store)

    const [entry] = loadRecentDevices(store)
    expect(entry?.address).toBe('192.168.1.40:37211')
    expect(entry?.model).toBe('Pixel 7')
    expect(entry?.transport).toBe('network')
  })

  it('no duplica una direccion: la mueve al principio con la fecha nueva', () => {
    const store = new MemoryStorage()
    rememberRecentDevice({ address: '10.0.0.5:5555', model: 'TV' }, store)
    rememberRecentDevice({ address: '10.0.0.6:5555', model: 'Movil' }, store)
    rememberRecentDevice({ address: '10.0.0.5:5555', model: 'TV Box' }, store)

    const list = loadRecentDevices(store)
    expect(list.map((item) => item.address)).toEqual(['10.0.0.5:5555', '10.0.0.6:5555'])
    expect(list[0]?.model).toBe('TV Box')
  })

  it('conserva como maximo ocho equipos', () => {
    const store = new MemoryStorage()
    for (let index = 0; index < 12; index += 1) {
      rememberRecentDevice({ address: `10.0.0.${index}:5555`, model: `Equipo ${index}` }, store)
    }

    expect(loadRecentDevices(store)).toHaveLength(8)
  })

  it('olvida un equipo concreto', () => {
    const store = new MemoryStorage()
    rememberRecentDevice({ address: '10.0.0.5:5555' }, store)
    rememberRecentDevice({ address: '10.0.0.6:5555' }, store)

    expect(forgetRecentDevice('10.0.0.5:5555', store).map((item) => item.address)).toEqual([
      '10.0.0.6:5555',
    ])
  })

  it('ignora almacenamiento corrupto o con datos invalidos', () => {
    const store = new MemoryStorage()
    store.setItem('adb-optimizer.recent-devices.v1', 'no-json')
    expect(loadRecentDevices(store)).toEqual([])

    store.setItem(
      'adb-optimizer.recent-devices.v1',
      JSON.stringify([{ address: '' }, { address: '10.0.0.5:5555', model: 'X', seenAt: 1, transport: 'usb' }]),
    )
    expect(loadRecentDevices(store)).toHaveLength(1)
  })

  it('solo persiste direccion, modelo, transporte y fecha', () => {
    const store = new MemoryStorage()
    rememberRecentDevice({ address: '10.0.0.5:5555', model: 'X' }, store)

    const raw = store.getItem('adb-optimizer.recent-devices.v1') ?? ''
    expect(raw).not.toContain('password')
    expect(Object.keys(JSON.parse(raw)[0])).toEqual(['address', 'model', 'transport', 'seenAt'])
  })

  it('funciona sin localStorage disponible', () => {
    expect(loadRecentDevices(null)).toEqual([])
    expect(rememberRecentDevice({ address: '10.0.0.5:5555' }, null)).toHaveLength(1)
  })
})
