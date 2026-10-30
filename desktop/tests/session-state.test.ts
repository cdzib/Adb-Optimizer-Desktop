import { describe, expect, it } from 'vitest'
import type { DeviceInfo } from '../src/shared/types'
import { SessionDevices } from '../src/main/session-state'

function device(id: string, model = 'Android'): DeviceInfo {
  return {
    id,
    model,
    manufacturer: 'Test',
    sdk: 34,
    androidVersion: '14',
    isTv: false,
    hasRoot: false,
    abi: 'arm64-v8a',
  }
}

describe('SessionDevices', () => {
  it('agrega equipos y reemplaza el mismo id sin duplicar ni cambiar el orden', () => {
    const devices = new SessionDevices()
    devices.upsert(device('usb-1', 'Pixel 7'))
    devices.upsert(device('10.0.0.5:5555', 'TV Box'))
    devices.upsert(device('usb-1', 'Pixel 8'))

    expect(devices.list().map((item) => item.id)).toEqual(['usb-1', '10.0.0.5:5555'])
    expect(devices.list()[0]?.model).toBe('Pixel 8')
  })

  it('elimina solo el id indicado', () => {
    const devices = new SessionDevices()
    devices.upsert(device('usb-1'))
    devices.upsert(device('usb-2'))

    devices.remove('usb-1')

    expect(devices.list().map((item) => item.id)).toEqual(['usb-2'])
    devices.remove('no-existe')
    expect(devices.list()).toHaveLength(1)
  })

  it('prune quita los ausentes pero conserva el activo', () => {
    const devices = new SessionDevices()
    devices.upsert(device('usb-1'))
    devices.upsert(device('usb-2'))
    devices.upsert(device('usb-3'))

    devices.prune(['usb-1', 'usb-3'], 'usb-2')

    expect(devices.list().map((item) => item.id)).toEqual(['usb-1', 'usb-2', 'usb-3'])

    devices.prune(['usb-1'], 'usb-2')
    expect(devices.list().map((item) => item.id)).toEqual(['usb-1', 'usb-2'])
  })

  it('list devuelve una copia que no altera el estado', () => {
    const devices = new SessionDevices()
    devices.upsert(device('usb-1', 'Pixel 7'))

    const copy = devices.list()
    copy.push(device('usb-2'))
    copy[0]!.model = 'mutado'

    expect(devices.list()).toHaveLength(1)
    expect(devices.list()[0]?.model).toBe('Pixel 7')
  })
})
