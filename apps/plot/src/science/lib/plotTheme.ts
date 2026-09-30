/** 把 CSS 主题变量解析成 Plotly 能识别的 rgba。 */

const cache = new Map<string, string>()

function readVariable(name: string): string {
  if (typeof window === 'undefined') {
    return ''
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function toPlotlyColor(value: string, fallback: string): string {
  if (!value) {
    return fallback
  }

  const cached = cache.get(value)
  if (cached) {
    return cached
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      return fallback
    }
    context.fillStyle = value
    const first = context.fillStyle
    if (!first || first === '#000000') {
      return fallback
    }
    context.fillRect(0, 0, 1, 1)
    const data = context.getImageData(0, 0, 1, 1).data
    const resolved = `rgba(${data[0]}, ${data[1]}, ${data[2]}, ${data[3] / 255})`
    cache.set(value, resolved)
    return resolved
  } catch {
    return fallback
  }
}

export function resolveGridColor(): string {
  return toPlotlyColor(readVariable('--chart-grid'), 'rgba(120, 130, 150, 0.18)')
}

export function resolveAxisColor(): string {
  return toPlotlyColor(readVariable('--chart-axis'), 'rgba(120, 130, 150, 0.7)')
}

export function resolveFontFamily(): string {
  return 'Segoe UI, PingFang SC, Microsoft YaHei, sans-serif'
}
