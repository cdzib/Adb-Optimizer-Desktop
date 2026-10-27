export function formatKb(value: number): string {
  if (value <= 0) return '—'
  const gb = value / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(value / 1024)} MB`
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

export function formatUptime(seconds: number): string {
  if (seconds <= 0) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function riskLabel(t: (key: string) => string, risk: string): string {
  return t(`optimize.risk.${risk}`)
}

/**
 * Salud en escala 0–100 donde 100 es mejor. Se calcula como 100 - presion:
 * memoria ocupada, CPU y nivel termico. Asi el numero y la etiqueta no se contradicen.
 */
export function healthScore(metrics: {
  usedRamKb: number
  totalRamKb: number
  cpuBusyPercent: number
  maxThermalStatus: number
}): { level: 'ok' | 'warn' | 'bad'; score: number } {
  const ramRatio = metrics.totalRamKb > 0 ? metrics.usedRamKb / metrics.totalRamKb : 0
  const pressure =
    ramRatio * 40 + Math.min(metrics.cpuBusyPercent, 100) * 0.45 + metrics.maxThermalStatus * 3
  const score = Math.round(100 - Math.min(pressure, 100))

  if (metrics.maxThermalStatus >= 4 || score < 45) return { level: 'bad', score }
  if (score < 70) return { level: 'warn', score }
  return { level: 'ok', score }
}
