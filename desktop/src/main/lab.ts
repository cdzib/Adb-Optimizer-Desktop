/**
 * Modo laboratorio: evita escribir/flashear por accidente en dispositivos reales
 * mientras se prueba con emuladores. Se activa con ADB_OPTIMIZER_LAB=1.
 *
 * Por defecto solo permite seriales `emulator-*`. Los dispositivos físicos de
 * prueba se habilitan explícitamente con ADB_OPTIMIZER_LAB_SERIALS.
 */
export function isLabMode(): boolean {
  return process.env.ADB_OPTIMIZER_LAB === '1'
}

export function labAllowedSerials(): string[] {
  return (process.env.ADB_OPTIMIZER_LAB_SERIALS ?? '')
    .split(',')
    .map((serial) => serial.trim())
    .filter((serial) => serial.length > 0)
}

export function assertLabAllowed(serial: string | undefined, operation: string): void {
  if (!isLabMode()) return
  if (!serial) {
    throw new Error(`Modo laboratorio: no hay dispositivo conectado para ${operation}.`)
  }
  if (serial.startsWith('emulator-') || labAllowedSerials().includes(serial)) return
  throw new Error(
    `Modo laboratorio activo: ${serial} no está permitido para ${operation}. ` +
      'Usa un emulador o añade el serial a ADB_OPTIMIZER_LAB_SERIALS.',
  )
}
