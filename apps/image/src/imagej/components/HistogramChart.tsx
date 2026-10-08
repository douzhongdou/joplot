'use client'

/**
 * 图像直方图绘制组件（Plotly 实现）。
 *
 * 为什么交给 Plotly：缩放/平移/框选/双击复位/modebar 全是现成的，而且 `relayout` 只改
 * shapes 时不会动 `axis.range`，用户的缩放状态能保住。原先那套手写 canvas 交互（约 80 行）
 * 因此删掉。
 *
 * 桶数与聚合：8 位数据是 256 桶，面板宽度通常 ≥ 256px，所以**一桶一列**、hover 能读到单个
 * 灰度级；16 位是 65536 桶，按显示宽度聚合（否则 SVG 撑不住），此时 hover 读到的是区间。
 *
 * 组件只负责「画」和「交互」，不持有桶的语义：调用方给出 counts 与其值域 [min, max]。
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { loadPlotly, type PlotlyRuntime } from '../lib/plotly'

/* ------------------------------------------------------------------ *
 * 主题颜色解析
 * ------------------------------------------------------------------ */

/** `--chart-grid` 等令牌的值是 `color-mix()` 表达式，Plotly 消费不了，借 DOM 解析成 sRGB。 */
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

/* ------------------------------------------------------------------ *
 * 数据辅助
 * ------------------------------------------------------------------ */

/** 刻度与读数用的数值格式化：整数原样，浮点按量级收敛小数位。 */
export function formatHistogramValue(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Number.isInteger(value)) return String(value)
  const magnitude = Math.abs(value)
  if (magnitude >= 100) return value.toFixed(0)
  if (magnitude >= 1) return value.toFixed(1)
  return Number(value.toPrecision(3)).toString()
}

/** y 轴峰值这类大数字用紧凑写法，避免撑爆窄面板。 */
function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  return String(Math.round(value))
}

/** 聚合到 ≤ columns 列；桶数不超过列数时保持一桶一列（逐桶读数）。 */
function aggregate(counts: ArrayLike<number>, columns: number): { values: Float64Array; stride: number } {
  const length = counts.length
  if (length === 0 || columns <= 0) return { values: new Float64Array(0), stride: 1 }
  if (length <= columns) {
    const values = new Float64Array(length)
    for (let i = 0; i < length; i += 1) values[i] = counts[i] ?? 0
    return { values, stride: 1 }
  }
  const values = new Float64Array(columns)
  const scale = length / columns
  for (let column = 0; column < columns; column += 1) {
    const start = Math.floor(column * scale)
    const end = Math.min(length, Math.max(start + 1, Math.floor((column + 1) * scale)))
    let sum = 0
    for (let i = start; i < end; i += 1) sum += counts[i] ?? 0
    values[column] = sum
  }
  return { values, stride: scale }
}

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
  count: string
  cumulative: string
  level: string
  frequency: string
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
/** 拖动手柄的命中宽度（px）：只在竖线附近接管指针，其余区域留给 Plotly 缩放。 */
const HANDLE_WIDTH = 12
/** 与下面 layout.margin 一致：手柄要落在绘图区内，不能按整个容器宽度算。 */
const PLOT_MARGIN_LEFT = 30
const PLOT_MARGIN_RIGHT = 8

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
  const hostRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<PlotlyRuntime | null>(null)
  const plottedRef = useRef(false)
  const [width, setWidth] = useState(0)
  const [themeVersion, setThemeVersion] = useState(0)
  const [dragValue, setDragValue] = useState<number | null>(null)

  const copy = { ...DEFAULT_LABELS, ...labels }
  const counts = data?.counts ?? null
  const dataMin = data?.min ?? 0
  const dataMax = data?.max ?? 1

  useLayoutEffect(() => {
    const measured = hostRef.current?.clientWidth ?? 0
    if (measured > 0) setWidth((previous) => (Math.abs(previous - measured) < 0.5 ? previous : measured))
  }, [height])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0
      setWidth((previous) => (Math.abs(previous - measured) < 0.5 ? previous : measured))
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion((value) => value + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => observer.disconnect()
  }, [])

  const palette = useMemo(() => {
    void themeVersion
    return {
      grid: resolveColor('--chart-grid', GRID_FALLBACK),
      axis: resolveColor('--chart-axis', AXIS_FALLBACK),
      text: resolveColor('--muted-foreground', TEXT_FALLBACK),
      selection: resolveColor('--chart-selection', SELECTION_FALLBACK),
      series: resolveColor(color ?? '--primary', SERIES_FALLBACK),
      marker: resolveColor('--destructive', MARKER_FALLBACK),
    }
  }, [color, themeVersion])

  /* 一桶一列，直到桶数超过可用像素；16 位数据此时才聚合。 */
  const { values, stride, total } = useMemo(() => {
    const columns = Math.max(1, Math.floor(width) || 256)
    const aggregated = counts ? aggregate(counts, columns) : { values: new Float64Array(0), stride: 1 }
    let sum = 0
    for (let i = 0; i < aggregated.values.length; i += 1) sum += aggregated.values[i]!
    return { values: aggregated.values, stride: aggregated.stride, total: sum }
  }, [counts, width])

  const binWidth = (dataMax - dataMin) / Math.max(1, counts?.length ?? 1)
  const xValues = useMemo(
    () => Array.from({ length: values.length }, (_, i) => dataMin + (i + 0.5) * binWidth * stride),
    [values.length, dataMin, binWidth, stride],
  )
  /** hover 里显示累积占比：预计算，避免每次悬停都扫一遍。 */
  const cumulative = useMemo(() => {
    const result = new Float64Array(values.length)
    let running = 0
    for (let i = 0; i < values.length; i += 1) {
      running += values[i]!
      result[i] = total > 0 ? (running / total) * 100 : 0
    }
    return result
  }, [values, total])

  const barColors = useMemo(() => {
    if (!highlight || highlight.max <= highlight.min) return palette.series
    return Array.from({ length: values.length }, (_, i) => {
      const x = xValues[i]!
      return x >= highlight.min && x <= highlight.max ? palette.series : `${palette.series}33`
    })
  }, [highlight, palette.series, values.length, xValues])

  /* ---------------- 首次绘制 ---------------- */

  useEffect(() => {
    const host = hostRef.current
    if (!host || width <= 0 || !counts || counts.length === 0) return
    let cancelled = false
    void loadPlotly().then((runtime) => {
      if (cancelled || !hostRef.current) return
      runtimeRef.current = runtime
      if (plottedRef.current) return
      plottedRef.current = true
      void runtime.react(hostRef.current, [{
        type: 'bar',
        x: xValues,
        y: Array.from(values),
        customdata: Array.from(cumulative),
        marker: { color: barColors, line: { width: 0 } },
        hovertemplate: `${copy.level} %{x:.6~g}<br>%{y:,} ${copy.count} · ${copy.frequency} %{customdata:.2f}%<br>${copy.cumulative} %{customdata:.1f}%<extra></extra>`,
      }], {
        margin: { l: PLOT_MARGIN_LEFT, r: PLOT_MARGIN_RIGHT, t: 4, b: 20 },
        bargap: 0,
        showlegend: false,
        dragmode: 'pan',
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { size: 9, color: palette.text },
        xaxis: { range: [dataMin, dataMax], gridcolor: palette.grid, zeroline: false, tickfont: { size: 9 } },
        yaxis: { gridcolor: palette.grid, zeroline: false, tickfont: { size: 9 }, tickformat: '~s' },
      }, {
        displaylogo: false,
        responsive: true,
        scrollZoom: true,
        doubleClick: 'reset',
        displayModeBar: true,
        modeBarButtonsToRemove: ['select2d', 'lasso2d', 'toImage', 'sendDataToCloud'],
      })
    })
    return () => { cancelled = true }
    // 只在数据/尺寸首次可用时建图；后续增量走下面的 restyle/relayout。
  }, [counts, width, xValues, values, cumulative, barColors, dataMin, dataMax, palette.text, palette.grid, copy.count, copy.cumulative, copy.frequency, copy.level])

  /* 卸载时让 Plotly 释放 DOM 与监听器。 */
  useEffect(() => () => {
    const host = hostRef.current
    const runtime = runtimeRef.current
    if (host && runtime) runtime.purge(host)
    plottedRef.current = false
  }, [])

  /* ---------------- 增量更新 ---------------- */

  const previousRef = useRef({ barColors, logScale, markers, highlight, xValues, values, cumulative })
  useEffect(() => {
    const host = hostRef.current
    const runtime = runtimeRef.current
    const previous = previousRef.current
    if (!host || !runtime || !plottedRef.current) { previousRef.current = { barColors, logScale, markers, highlight, xValues, values, cumulative }; return }

    if (previous.xValues !== xValues || previous.values !== values) {
      void runtime.restyle(host, { x: [xValues], y: [Array.from(values)], customdata: [Array.from(cumulative)] })
    }
    if (previous.barColors !== barColors) void runtime.restyle(host, { 'marker.color': [barColors] })
    if (previous.logScale !== logScale) void runtime.relayout(host, { 'yaxis.type': logScale ? 'log' : 'linear' })
    // shapes 变化不影响 axis.range，所以用户的缩放会保留。
    if (previous.markers !== markers || previous.highlight !== highlight) {
      void runtime.relayout(host, { shapes: markerShapes() })
    }
    previousRef.current = { barColors, logScale, markers, highlight, xValues, values, cumulative }
  }, [barColors, logScale, markers, highlight, xValues, values, cumulative])

  /** 标记线画成 shape：axis 坐标，缩放时会跟着走。 */
  function markerShapes(): Record<string, unknown>[] {
    const shapes: Record<string, unknown>[] = []
    if (highlight && highlight.max > highlight.min) {
      shapes.push({
        type: 'rect', xref: 'x', yref: 'paper',
        x0: highlight.min, x1: highlight.max, y0: 0, y1: 1,
        fillcolor: `${palette.selection}`, line: { width: 0 }, layer: 'below',
      })
    }
    for (const marker of markers ?? []) {
      shapes.push({
        type: 'line', xref: 'x', yref: 'paper',
        x0: marker.value, x1: marker.value, y0: 0, y1: 1,
        line: { color: marker.tone === 'range' ? palette.series : palette.marker, width: 1.5, dash: marker.tone === 'range' ? 'solid' : 'dot' },
      })
    }
    return shapes
  }

  /* ---------------- 可拖标记线的命中层 ---------------- */

  const dragRef = useRef<{ index: number; startX: number; startValue: number; perPixel: number } | null>(null)
  const startDrag = (index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    const marker = markers?.[index]
    if (!marker?.onChange) return
    const host = hostRef.current
    if (!host) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { index, startX: event.clientX, startValue: marker.value, perPixel: (dataMax - dataMin) / host.clientWidth }
    setDragValue(marker.value)
  }
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const marker = markers?.[drag.index]
    if (!marker?.onChange) return
    const raw = drag.startValue + (event.clientX - drag.startX) * drag.perPixel
    const snapped = marker.step ? Math.round(raw / marker.step) * marker.step : raw
    const next = Math.max(dataMin, Math.min(dataMax, snapped))
    setDragValue(next)
    marker.onChange(next)
  }
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
    setDragValue(null)
  }

  /** 绘图区宽度（扣除 Plotly 的左右内边距），手柄定位用它。 */
  const plotWidth = Math.max(1, width - PLOT_MARGIN_LEFT - PLOT_MARGIN_RIGHT)
  const handleLeft = (value: number) => PLOT_MARGIN_LEFT + ((value - dataMin) / ((dataMax - dataMin) || 1)) * plotWidth

  const empty = !counts || counts.length === 0

  return (
    <div ref={hostRef} className={`relative w-full ${className ?? ''}`} style={{ height }} aria-label={ariaLabel}>
      {empty ? <p className="flex h-full items-center justify-center text-xs text-base-content/50">{copy.empty}</p> : null}
      {/* 竖线附近的窄条：接管指针用于拖动，其余区域留给 Plotly 的缩放/平移。 */}
      {markers?.map((marker, index) => marker.onChange ? (
        <div
          key={`handle-${index}`}
          role="slider"
          tabIndex={0}
          aria-label={`${copy.level} ${formatValue(marker.value)}`}
          aria-valuenow={marker.value}
          aria-valuemin={dataMin}
          aria-valuemax={dataMax}
          onPointerDown={startDrag(index)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(event) => {
            const step = marker.step ?? (dataMax - dataMin) / 100
            const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : 0
            if (!delta) return
            event.preventDefault()
            const snapped = marker.step ? Math.round((marker.value + delta) / marker.step) * marker.step : marker.value + delta
            marker.onChange?.(Math.max(dataMin, Math.min(dataMax, snapped)))
          }}
          className="absolute top-0 z-10 -translate-x-1/2 cursor-ew-resize touch-none"
          style={{
            left: handleLeft(marker.value),
            width: HANDLE_WIDTH,
            height: '100%',
            background: 'transparent',
          }}
        />
      ) : null)}
      {dragValue !== null ? (
        <div className="pointer-events-none absolute -top-0.5 z-20 -translate-x-1/2 rounded-[var(--radius-field)] border border-base-300 bg-base-100/95 px-1.5 py-0.5 font-mono text-xs tabular-nums shadow-sm"
          style={{ left: handleLeft(dragValue) }}>
          {formatValue(dragValue)}
        </div>
      ) : null}
    </div>
  )
}

/** 峰值标注（保留导出，供调用方复用在读数里）。 */
export { formatCount }




