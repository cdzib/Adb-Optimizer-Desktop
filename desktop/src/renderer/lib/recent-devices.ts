import type { DeviceRef } from '../../shared/types'

const STORAGE_KEY = 'adb-optimizer.recent-devices.v1'
const MAX_RECENT = 8

export interface RecentDevice {
  address: string
  model: string
  transport: DeviceRef['transport']
  seenAt: number
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Solo direcciones: nunca se guardan credenciales ni el password del QR. */
export function loadRecentDevices(store: Storage | null = defaultStorage()): RecentDevice[] {
  if (!store) return []
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(isRecentDevice)
      .sort((a, b) => b.seenAt - a.seenAt)
      .slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

export function rememberRecentDevice(
  entry: { address: string; model?: string; transport?: DeviceRef['transport'] },
  store: Storage | null = defaultStorage(),
): RecentDevice[] {
  const device: RecentDevice = {
    address: entry.address,
    model: entry.model?.trim() || 'Dispositivo Android',
    transport: entry.transport ?? 'network',
    seenAt: Date.now(),
  }
  const next = [device, ...loadRecentDevices(store).filter((item) => item.address !== device.address)]
    .slice(0, MAX_RECENT)
  write(next, store)
  return next
}

export function forgetRecentDevice(
  address: string,
  store: Storage | null = defaultStorage(),
): RecentDevice[] {
  const next = loadRecentDevices(store).filter((item) => item.address !== address)
  write(next, store)
  return next
}

function write(list: RecentDevice[], store: Storage | null): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Cuota llena o almacenamiento bloqueado: los recientes son una comodidad, no un requisito.
  }
}

function isRecentDevice(value: unknown): value is RecentDevice {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<RecentDevice>
  return (
    typeof entry.address === 'string' &&
    entry.address.length > 0 &&
    typeof entry.model === 'string' &&
    typeof entry.seenAt === 'number' &&
    (entry.transport === 'usb' || entry.transport === 'network' || entry.transport === 'emulator')
  )
}
