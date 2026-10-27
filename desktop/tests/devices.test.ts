import { describe, expect, it } from 'vitest'
import type { DeviceRef } from '../src/shared/types'
import { dedupeByHost } from '../src/renderer/screens/DevicesScreen'

function device(partial: Partial<DeviceRef> & { id: string; address: string }): DeviceRef {
  return {
    state: 'device',
    transport: 'network',
    ...partial,
  }
}

describe('dedupeByHost', () => {
  it('colapsa la misma IP anunciada por adb y por mDNS', () => {
    const rows = dedupeByHost([
      device({ id: '192.168.1.121:35831', address: '192.168.1.121:35831', model: 'SM_S918B' }),
      device({
        id: 'adb-R5CW60KERKD-Xk2q7n',
        address: '192.168.1.121:39771',
        model: 'adb-R5CW60KERKD-Xk2q7n',
      }),
      device({
        id: 'adb-R5CW60KERKD-Xk2q7n (2)',
        address: '192.168.1.121:45103',
        model: 'adb-R5CW60KERKD-Xk2q7n (2)',
      }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]?.model).toBe('SM_S918B')
  })

  it('hereda el modelo de otra entrada del mismo host', () => {
    const rows = dedupeByHost([
      device({ id: '192.168.1.125:39945', address: '192.168.1.125:39945' }),
      device({ id: '192.168.1.125:45069', address: '192.168.1.125:45069', model: 'SM_A356E' }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]?.model).toBe('SM_A356E')
  })

  it('mantiene equipos distintos', () => {
    const rows = dedupeByHost([
      device({ id: '192.168.1.121:1', address: '192.168.1.121:1', model: 'A' }),
      device({ id: '192.168.1.125:2', address: '192.168.1.125:2', model: 'B' }),
    ])

    expect(rows.map((item) => item.model)).toEqual(['A', 'B'])
  })

  it('prefiere el serial USB cuando no hay host con puerto', () => {
    const rows = dedupeByHost([
      device({ id: 'R58M1234', address: 'R58M1234', transport: 'usb', model: 'SM_G991B' }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]?.transport).toBe('usb')
  })
})
