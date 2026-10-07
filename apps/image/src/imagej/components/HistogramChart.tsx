'use client'

/**
 * 图像直方图绘制组件。
 *
 * 替代原先散落在工作台卡片与亮度/对比度面板里的手绘实现：
 * - 视觉：阶梯面积 + 渐变填充（避免 1px 柱子在亚像素下的摩尔纹）、跟随主题令牌配色、DPR 正确。
 * - 交互：hover 十字准线读数、可拖动的阈值 / 显示范围标记、方向键微调、键盘可达。
 * - 性能：单 canvas、按显示宽度聚合（O(显示宽度) 而不是 O(桶数)）、rAF 合帧、主题色解析带缓存。
 *
 * 组件只负责「画」和「交互」，不持有桶的语义：调用方给出 counts 与其值域 [min, max]。
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

/* ------------------------------------------------------------------ *
 * 主题颜色解析
 * ------------------------------------------------------------------ */

/**
 * `--chart-grid` 等令牌的值是 `color-mix()` 表达式，canvas 消费不了；
 * 这里借 1×1 canvas 让浏览器渲染成 sRGB 再读回 rgba。
 * apps 之间不共享代码，因此与 apps/plot 各自保留一份同思路的实现。
 */
const GRID_FALLBACK = 'rgba(15, 23, 42, 0.1)'
const AXIS_FALLBACK = 'rgba(15, 23, 42, 0.6)'
const TEXT_FALLBACK = 'rgba(15, 23, 42, 0.55)'
const SERIES_FALLBACK = 'rgba(15, 23, 42, 0.9)'
const MARKER_FALLBACK = 'rgba(220, 38, 38, 0.9)'
const SELECTION_FALLBACK = 'rgba(21, 94, 239, 0.35)'

const resolvedColors = new Map<string, string>()

function toRgba(expression: string, fallback: string): string {
  if (typeof window === 'undefined' || !expression) return fallback
  const cached = resolvedColors.get(expression)
  if (cached) return cached
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return fallback
    // 非法颜色不会改变 fillStyle，据此判断表达式是否被浏览器接受。
    context.fillStyle = '#000000'
    context.fillStyle = expression
    const first = context.fillStyle
    context.fillStyle = '#ffffff'
    context.fillStyle = expression
    if (first !== context.fillStyle) return fallback
    context.fillRect(0, 0, 1, 1)
    const data = context.getImageData(0, 0, 1, 1).data
    const resolved = `rgba(${data[0]}, ${data[1]}, ${data[2]}, ${(data[3] ?? 255) / 255})`
    resolvedColors.set(expression, resolved)
    return resolved
  } catch {
    return fallback
  }
}

/** 接受 `var(--token)`、`--token` 与普通 CSS 颜色三种写法。 */
function resolveColor(expression: string | undefined, fallback: string): string {
  if (!expression) return fallback
  const token = /^(?:var\(\s*)?(--[\w-]+)\s*\)?$/.exec(expression.trim())
  if (token && typeof window !== 'undefined') {
    const value = getComputedStyle(document.documentElement).getPropertyValue(token[1]!).trim()
    return toRgba(value, fallback)
  }
  return toRgba(expression, fallback)
}

function withAlpha(color: string, alpha: number): string {
  const match = /^rgba?\(([^)]+)\)$/.exec(color.trim())
  if (!match) return color
  const parts = match[1]!.split(',').map((part) => Number(part.trim()))
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return color
  return `rgba(${Math.round(parts[0]!)}, ${Math.round(parts[1]!)}, ${Math.round(parts[2]!)}, ${alpha})`
}

/* ------------------------------------------------------------------ *
 * 数据与几何辅助
 * ------------------------------------------------------------------ */

const FONT = '9px ui-monospace, SFMono-Regular, Menlo, monospace'

/**
 * 把 counts 聚合到 ≤ columns 列：桶数多于列数时按区间求和，否则保持 1:1。
 * 求和（而不是取最大值）保证聚合后的高度仍然等于该区间的真实像素数。
 */
function aggregateColumns(counts: ArrayLike<number>, columns: number): Float64Array {
  const result = new Float64Array(columns)
  const length = counts.length
  if (length === 0 || columns <= 0) return result
  if (length <= columns) {
    for (let i = 0; i < length; i += 1) result[i] = counts[i] ?? 0
    return result
  }
  const scale = length / columns
  for (let column = 0; column < columns; column += 1) {
    const start = Math.floor(column * scale)
    const end = Math.min(length, Math.max(start + 1, Math.floor((column + 1) * scale)))
    let sum = 0
    for (let i = start; i < end; i += 1) sum += counts[i] ?? 0
    result[column] = sum
  }
  return result
}

/** 刻度与读数用的数值格式化：整数原样，浮点按量级收敛小数位。 */
export function formatHistogramValue(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Number.isInteger(value)) return String(value)
  const magnitude = Math.abs(value)
  if (magnitude >= 100) return value.toFixed(0)
  if (magnitude >= 1) return value.toFixed(1)
  return Number(value.toPrecision(3)).toString()
}

/** y 轴峰值这类大数字用紧凑写法，避免撑爆 112px 宽的图。 */
function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  return String(Math.round(value))
}

function snapValue(value: number, step?: number): number {
  if (!step || step <= 0) return value
  return Math.round(value / step) * step
}

const PAD_LEFT = 8
const PAD_RIGHT = 8
const PAD_TOP = 16
const PAD_BOTTOM = 16

/* ------------------------------------------------------------------ *
 * 组件
 * ------------------------------------------------------------------ */

export interface HistogramData {
  /** 桶计数，按值升序。 */
  counts: ArrayLike<number>
  /** 首个桶的左边界与末个桶的右边界。 */
  min: number
  max: number
}

export interface HistogramMarker {
  value: number
  /** 拖动吸附步长；省略表示连续取值（浮点数据）。 */
  step?: number
  /** 提供后该标记可拖动。 */
  onChange?: (value: number) => void
  /** threshold 用警示色，range 用主色。 */
  tone?: 'threshold' | 'range'
}

export interface HistogramLabels {
  /** tooltip 中计数的单位，例如「像素」。 */
  count: string
  /** tooltip 中累积占比的标签。 */
  cumulative: string
  /** tooltip 中灰度级 / 数值的标签。 */
  level: string
  /** tooltip 中频率（占比）的标签。 */
  frequency: string
  /** 无数据时的占位文案。 */
  empty: string
}

export interface HistogramChartProps {
  data: HistogramData | null
  /** CSS 高度（px）。 */
  height?: number
  /** 序列颜色：CSS 颜色或 `var(--token)`。 */
  color?: string
  /** Y 轴对数刻度。 */
  logScale?: boolean
  /** 高亮区间；区间外淡出。 */
  highlight?: { min: number; max: number } | null
  markers?: readonly HistogramMarker[]
  formatValue?: (value: number) => string
  labels?: Partial<HistogramLabels>
  ariaLabel?: string
  className?: string
}

const DEFAULT_LABELS: HistogramLabels = { count: 'px', cumulative: 'cumulative', level: 'Level', frequency: 'Frequency', empty: 'No data yet' }

export function HistogramChart({
  data,
  height = 112,
  color,
  logScale = false,
  highlight = null,
  markers,
  formatValue = formatHistogramValue,
  labels,
  ariaLabel,
  className,
}: HistogramChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [themeVersion, setThemeVersion] = useState(0)
  const dragRef = useRef<number | null>(null)
  const hoverFrame = useRef<number | null>(null)
  const pendingHover = useRef<number | null>(null)

  const copy = { ...DEFAULT_LABELS, ...labels }
  /* 下面只依赖具体值：调用方每次渲染都会新建 data 字面量，按引用比对会白白重绘。 */
  const counts = data?.counts ?? null
  const dataMin = data?.min ?? 0
  const dataMax = data?.max ?? 1

  /* 尺寸：ResizeObserver 只更新 state，绘制交给渲染后的 effect，避免回调里同步重绘。 */
  useLayoutEffect(() => {
    const measured = containerRef.current?.clientWidth ?? 0
    if (measured > 0) setWidth((previous) => (Math.abs(previous - measured) < 0.5 ? previous : measured))
  }, [height])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0
      setWidth((previous) => (Math.abs(previous - measured) < 0.5 ? previous : measured))
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  /* 主题切换时重新解析令牌颜色。 */
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion((value) => value + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => observer.disconnect()
  }, [])

  const palette = useMemo(() => {
    void themeVersion // 主题变化时强制重新解析
    return {
      grid: resolveColor('--chart-grid', GRID_FALLBACK),
      axis: resolveColor('--chart-axis', AXIS_FALLBACK),
      text: resolveColor('--muted-foreground', TEXT_FALLBACK),
      selection: resolveColor('--chart-selection', SELECTION_FALLBACK),
      series: resolveColor(color ?? '--primary', SERIES_FALLBACK),
      marker: resolveColor('--destructive', MARKER_FALLBACK),
    }
  }, [color, themeVersion])

  /* 每桶一列（不按面板宽度聚合）：保证每个灰度值都能单独取到读数。 */
  const layout = useMemo(() => {
    const plotWidth = Math.max(1, width - PAD_LEFT - PAD_RIGHT)
    const plotHeight = Math.max(1, height - PAD_TOP - PAD_BOTTOM)
    const binCount = counts?.length ?? 0
    /* 每个桶一列，绝不与相邻灰度合并：读数始终对应单一灰度级，不出现区间。 */
    const columnCount = Math.max(1, binCount)
    const columns = counts ? aggregateColumns(counts, columnCount) : new Float64Array(0)
    let total = 0
    let peak = 0
    for (let i = 0; i < columns.length; i += 1) {
      const value = columns[i]!
      total += value
      if (value > peak) peak = value
    }
    return { plotWidth, plotHeight, baseY: PAD_TOP + plotHeight, columnCount, columns, total, peak }
  }, [counts, height, width])

  const span = (dataMax - dataMin) || 1

  const valueToX = useMemo(
    () => (value: number) => PAD_LEFT + ((value - dataMin) / span) * layout.plotWidth,
    [dataMin, layout.plotWidth, span],
  )

  const xToValue = useMemo(
    () => (x: number) => dataMin + ((x - PAD_LEFT) / layout.plotWidth) * span,
    [dataMin, layout.plotWidth, span],
  )

  /* ---------------- 绘制 ---------------- */

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) return
    const context = canvas.getContext('2d')
    if (!context) return

    const dpr = Math.max(1, window.devicePixelRatio || 1)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)

    const { plotWidth, plotHeight, baseY, columnCount, columns, peak } = layout
    const plotLeft = PAD_LEFT
    const plotRight = PAD_LEFT + plotWidth
    const plotTop = PAD_TOP

    /* 水平网格 */
    context.strokeStyle = palette.grid
    context.lineWidth = 1
    for (const fraction of [0, 0.5, 1]) {
      const y = Math.round(plotTop + plotHeight * fraction) + 0.5
      context.beginPath()
      context.moveTo(plotLeft, y)
      context.lineTo(plotRight, y)
      context.stroke()
    }

    /* 基线 */
    context.strokeStyle = palette.axis
    context.globalAlpha = 0.45
    context.lineWidth = 0.75
    context.beginPath()
    context.moveTo(plotLeft, Math.round(baseY) + 0.5)
    context.lineTo(plotRight, Math.round(baseY) + 0.5)
    context.stroke()
    context.globalAlpha = 1

    /* x 轴刻度：min / mid / max */
    context.font = FONT
    context.fillStyle = palette.text
    const min = dataMin
    const max = dataMax
    context.textAlign = 'left'
    context.fillText(formatValue(min), plotLeft, height - 4)
    context.textAlign = 'center'
    context.fillText(formatValue((min + max) / 2), plotLeft + plotWidth / 2, height - 4)
    context.textAlign = 'right'
    context.fillText(formatValue(max), plotRight, height - 4)

    if (!counts || peak <= 0) {
      if (copy.empty) {
        context.textAlign = 'center'
        context.fillText(copy.empty, plotLeft + plotWidth / 2, plotTop + plotHeight / 2)
      }
      return
    }

    /* 峰值标注 */
    context.textAlign = 'left'
    context.fillText(formatCount(peak), plotLeft + 1, plotTop - 5)

    const heightAt = (count: number) => {
      if (count <= 0) return 0
      if (logScale) return (Math.log1p(count) / Math.log1p(peak)) * plotHeight
      return (count / peak) * plotHeight
    }

    const traceArea = () => {
      context.beginPath()
      context.moveTo(plotLeft, baseY)
      for (let i = 0; i < columnCount; i += 1) {
        const x0 = plotLeft + i * (plotWidth / columnCount)
        const x1 = x0 + plotWidth / columnCount
        const y = baseY - heightAt(columns[i]!)
        context.lineTo(x0, y)
        context.lineTo(x1, y)
      }
      context.lineTo(plotRight, baseY)
      context.closePath()
    }

    /* 高亮区间底纹 */
    if (highlight) {
      const left = Math.max(plotLeft, valueToX(highlight.min))
      const right = Math.min(plotRight, valueToX(highlight.max))
      if (right > left) {
        context.fillStyle = withAlpha(palette.selection, 0.22)
        context.fillRect(left, plotTop, right - left, plotHeight)
      }
    }

    /* 纯灰阶平铺填充：不用渐变，避免看起来花哨。 */
    const fill = withAlpha(palette.series, 0.35)

    /* 区间外淡出：先铺一层低透明度，再在区间内以完整强度重画。 */
    const paintSeries = (alphaScale: number, stroked: boolean) => {
      context.save()
      context.globalAlpha = alphaScale
      traceArea()
      context.fillStyle = fill
      context.fill()
      if (stroked) {
        context.beginPath()
        for (let i = 0; i < columnCount; i += 1) {
          const x0 = plotLeft + i * (plotWidth / columnCount)
          const x1 = x0 + plotWidth / columnCount
          const y = Math.round(baseY - heightAt(columns[i]!)) + 0.5
          if (i === 0) context.moveTo(x0, y)
          else context.lineTo(x0, y)
          context.lineTo(x1, y)
        }
        context.strokeStyle = withAlpha(palette.series, 0.75)
        context.lineWidth = 0.75
        context.lineJoin = 'round'
        context.stroke()
      }
      context.restore()
    }

    if (highlight && highlight.max > highlight.min) {
      paintSeries(0.32, false)
      const left = Math.max(plotLeft, valueToX(highlight.min))
      const right = Math.min(plotRight, valueToX(highlight.max))
      context.save()
      context.beginPath()
      context.rect(left, plotTop - PAD_TOP, Math.max(0, right - left), height)
      context.clip()
      paintSeries(1, true)
      context.restore()
    } else {
      paintSeries(1, true)
    }

    /* 标记线（阈值 / 显示范围） */
    for (let index = 0; index < (markers?.length ?? 0); index += 1) {
      const marker = markers![index]!
      const x = valueToX(marker.value)
      if (x < plotLeft - 0.5 || x > plotRight + 0.5) continue
      const active = dragging === index
      const markerColor = marker.tone === 'range' ? palette.series : palette.marker
      context.strokeStyle = markerColor
      context.globalAlpha = active || marker.onChange ? 0.95 : 0.6
      context.lineWidth = active ? 2 : 1.5
      context.setLineDash(marker.tone === 'range' ? [] : [4, 3])
      context.beginPath()
      context.moveTo(Math.round(x) + 0.5, plotTop - 4)
      context.lineTo(Math.round(x) + 0.5, baseY)
      context.stroke()
      context.setLineDash([])
      if (marker.onChange) {
        // 顶部把手：提示这条线可以直接拖。
        context.fillStyle = markerColor
        const handleX = Math.round(x) - 2.5
        if (typeof context.roundRect === 'function') {
          context.beginPath()
          context.roundRect(handleX, plotTop - 9, 5, 6, 1.5)
          context.fill()
        } else {
          context.fillRect(handleX, plotTop - 9, 5, 6)
        }
      }
      context.globalAlpha = 1
    }

    /* hover 十字准线 */
    if (hover !== null && dragging === null && hover >= 0 && hover < columnCount) {
      const x = Math.round(plotLeft + (hover + 0.5) * (plotWidth / columnCount)) + 0.5
      context.strokeStyle = palette.axis
      context.globalAlpha = 0.5
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(x, plotTop)
      context.lineTo(x, baseY)
      context.stroke()
      context.globalAlpha = 1
    }
  }, [copy.empty, counts, dataMax, dataMin, dragging, formatValue, height, highlight, hover, layout, logScale, markers, palette, valueToX, width])

  /* ---------------- 交互 ---------------- */

  const nearestMarker = useMemo(() => {
    if (!markers?.length) return null
    return (x: number): number => {
      let best = -1
      let bestDistance = 10
      for (let index = 0; index < markers.length; index += 1) {
        const marker = markers[index]!
        if (!marker.onChange) continue
        const distance = Math.abs(valueToX(marker.value) - x)
        if (distance <= bestDistance) {
          bestDistance = distance
          best = index
        }
      }
      return best
    }
  }, [markers, valueToX])

  const localX = (event: ReactPointerEvent<HTMLCanvasElement>) => event.clientX - event.currentTarget.getBoundingClientRect().left

  const columnAt = (x: number) => {
    if (layout.columnCount <= 0) return -1
    const column = Math.floor((x - PAD_LEFT) / (layout.plotWidth / layout.columnCount))
    return column >= 0 && column < layout.columnCount ? column : -1
  }

  const scheduleHover = (column: number) => {
    pendingHover.current = column
    if (hoverFrame.current !== null) return
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = null
      setHover(pendingHover.current)
    })
  }

  useEffect(() => () => {
    if (hoverFrame.current !== null) cancelAnimationFrame(hoverFrame.current)
  }, [])

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!nearestMarker || !counts) return
    const index = nearestMarker(localX(event))
    if (index < 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = index
    setDragging(index)
    setHover(null)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!counts) return
    const x = localX(event)
    const index = dragRef.current
    if (index !== null) {
      const marker = markers?.[index]
      if (!marker?.onChange) return
      const value = Math.max(dataMin, Math.min(dataMax, snapValue(xToValue(x), marker.step)))
      marker.onChange(value)
      return
    }
    scheduleHover(columnAt(x))
  }

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current === null) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
    setDragging(null)
  }

  const handlePointerLeave = () => {
    if (dragRef.current !== null) return
    scheduleHover(-1)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (!counts) return
    const index = markers?.findIndex((marker) => marker.onChange) ?? -1
    if (index < 0) return
    const marker = markers![index]!
    const step = marker.step ?? span / 100
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : 0
    if (!delta) return
    event.preventDefault()
    marker.onChange!(Math.max(dataMin, Math.min(dataMax, snapValue(marker.value + delta, marker.step))))
  }

  /* ---------------- 读数浮层 ---------------- */

  const readout = useMemo(() => {
    const binCount = counts?.length ?? 0
    if (hover === null || hover < 0 || hover >= binCount || !counts) return null
    /* uint8：一桶 = 一个灰度值；16 位 / 浮点：按值域给出该桶的代表值。 */
    const binWidth = binCount > 1 ? span / (binCount - 1) : span
    const discrete = Number.isInteger(dataMin) && Number.isInteger(dataMax) && Math.abs(binWidth - Math.round(binWidth)) < 1e-6
    const raw = dataMin + hover * binWidth
    let cumulative = 0
    for (let index = 0; index <= hover; index += 1) cumulative += counts[index] ?? 0
    return { level: discrete ? String(Math.round(raw)) : formatValue(raw), count: Math.round(counts[hover] ?? 0), cumulative, total: layout.total }
  }, [counts, dataMin, dataMax, hover, layout.total, span, formatValue])

  const readoutLeft = readout ? Math.max(64, Math.min(width - 64, PAD_LEFT + (hover! + 0.5) * (layout.plotWidth / layout.columnCount))) : 0

  return (
    <div ref={containerRef} className={`relative w-full ${className ?? ''}`} style={{ height }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        tabIndex={markers?.some((marker) => marker.onChange) ? 0 : -1}
        className="block w-full touch-none outline-none"
        style={{ height, cursor: dragging !== null ? 'ew-resize' : markers?.some((marker) => marker.onChange) ? 'crosshair' : 'default' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={handlePointerLeave}
        onKeyDown={handleKeyDown}
      />
      {readout ? (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-[var(--radius-field)] border border-base-300 bg-base-100/95 px-1.5 py-1 font-mono text-xs leading-tight tabular-nums text-base-content shadow-sm"
          style={{ left: readoutLeft }}
        >
          <div className="font-medium text-base-content">{copy.level} {readout.level}</div>
          <div className="text-base-content/70">
            {readout.count.toLocaleString()} {copy.count}
            {readout.total > 0 ? ` · ${copy.frequency} ${((readout.count / readout.total) * 100).toFixed(2)}%` : ''}
          </div>
          <div className="text-base-content/55">
            {copy.cumulative} {readout.total > 0 ? `${((readout.cumulative / readout.total) * 100).toFixed(1)}%` : '—'}
          </div>
        </div>
      ) : null}
    </div>
  )
}
