import type { DeviceInfo } from '../shared/types'

/**
 * Equipos vinculados en esta sesion. Vive solo en memoria del proceso main:
 * no se persiste ni sustituye al journal, que guarda los cambios por serial.
 *
 * Es una lista sin duplicados por `id`: `upsert` reemplaza conservando la
 * posicion y `prune` descarta los que ADB ya no reporta, salvo el activo.
 */
export class SessionDevices {
  private readonly devices: DeviceInfo[] = []

  list(): DeviceInfo[] {
    return this.devices.map((device) => ({ ...device }))
  }

  upsert(info: DeviceInfo): void {
    const index = this.devices.findIndex((device) => device.id === info.id)
    if (index === -1) {
      this.devices.push({ ...info })
      return
    }
    this.devices[index] = { ...info }
  }

  remove(id: string): void {
    const index = this.devices.findIndex((device) => device.id === id)
    if (index !== -1) this.devices.splice(index, 1)
  }

  prune(visibleIds: string[], activeId?: string): void {
    const visible = new Set(visibleIds)
    for (let index = this.devices.length - 1; index >= 0; index -= 1) {
      const device = this.devices[index]
      if (!device) continue
      if (device.id === activeId) continue
      if (!visible.has(device.id)) this.devices.splice(index, 1)
    }
  }
}
