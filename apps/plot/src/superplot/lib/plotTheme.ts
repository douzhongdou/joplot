/**
 * super-plot 自有的 Plotly 主题解析。
 * Plotly 无法直接消费 CSS 变量（`--chart-grid` 等是 `color-mix()` 表达式），
 * 因此在这里把变量解析为 Plotly 可识别的 rgba 字符串。
 * 刻意不引用 `src/lib/theme`，保持与主工作台的解耦。
 */

export const SUPER_PLOT_GRID_FALLBACK = 'rgba(15, 23, 42, 0.12)'
export const SUPER_PLOT_AXIS_FALLBACK = 'rgba(15, 23, 42, 0.65)'
export const SUPER_PLOT_FONT_FAMILY = 'Segoe UI, PingFang SC, Microsoft YaHei, sans-serif'

const resolvedCache = new Map<string, string>()

function readCssVariable(name: string): string {
  if (typeof window === 'undefined') {
    return ''
  }

  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function toPlotlyColor(value: string, fallback: string): string {
  if (!value) {
    return fallback
  }

  const cached = resolvedCache.get(value)
  if (cached) {
    return cached
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      return fallback
    }

    context.fillStyle = '#000000'
    context.fillStyle = value
    const first = context.fillStyle
    context.fillStyle = '#ffffff'
    context.fillStyle = value
    if (first !== context.fillStyle) {
      return fallback
    }

    context.fillRect(0, 0, 1, 1)
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
    const resolved = `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`
    resolvedCache.set(value, resolved)
    return resolved
  } catch {
    return fallback
  }
}

export function resolveSuperPlotGridColor(): string {
  return toPlotlyColor(readCssVariable('--chart-grid'), SUPER_PLOT_GRID_FALLBACK)
}

export function resolveSuperPlotAxisColor(): string {
  return toPlotlyColor(readCssVariable('--chart-axis'), SUPER_PLOT_AXIS_FALLBACK)
}
