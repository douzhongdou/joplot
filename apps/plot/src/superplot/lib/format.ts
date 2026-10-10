const SI_PREFIXES: Array<{ threshold: number; symbol: string }> = [
  { threshold: 1e12, symbol: 'T' },
  { threshold: 1e9, symbol: 'G' },
  { threshold: 1e6, symbol: 'M' },
  { threshold: 1e3, symbol: 'k' },
  { threshold: 1, symbol: '' },
  { threshold: 1e-3, symbol: 'm' },
  { threshold: 1e-6, symbol: 'µ' },
  { threshold: 1e-9, symbol: 'n' },
  { threshold: 1e-12, symbol: 'p' },
]

function trimNumber(value: number, digits: number): string {
  const fixed = value.toFixed(digits)
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent

  return `${trimNumber(value, exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

export function formatCount(value: number, locale = 'en'): string {
  return new Intl.NumberFormat(locale).format(Math.round(value))
}

/** 工程计数法，例如 50 MHz / 1.23 mV。 */
export function formatEngineering(value: number, unit = '', digits = 3): string {
  if (!Number.isFinite(value)) {
    return '—'
  }

  if (value === 0) {
    return `0 ${unit}`.trim()
  }

  const absolute = Math.abs(value)
  const prefix = SI_PREFIXES.find((entry) => absolute >= entry.threshold) ?? SI_PREFIXES[SI_PREFIXES.length - 1]
  const scaled = value / prefix.threshold

  return `${trimNumber(scaled, digits)} ${prefix.symbol}${unit}`.trim()
}

export function formatFrequency(hz: number): string {
  return formatEngineering(hz, 'Hz')
}

export function formatDuration(seconds: number): string {
  return formatEngineering(seconds, 's')
}

export function formatAmplitude(value: number, unit = 'V'): string {
  return formatEngineering(value, unit)
}

export function formatPercentage(value: number): string {
  return `${trimNumber(value * 100, 1)}%`
}
