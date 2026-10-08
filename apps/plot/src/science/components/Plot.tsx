'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { loadPlotly } from '../lib/plotly.ts'
import {
  SCIENCE_PLOT_KEYBOARD_STEP,
  SCIENCE_PLOT_MARGIN_TOP,
  clampPlotHeight,
  resolveLegendY,
  resolvePlotMarginBottom,
} from '../lib/plotLayout.ts'
import { resolveAxisColor, resolveFontFamily, resolveGridColor } from '../lib/plotTheme.ts'
import { buildChartExportOptions } from '../../lib/chartExport.ts'
import { copyPngDataUrlToClipboard, type ClipboardPort } from '../../lib/clipboard.ts'
import { CHART_HOVERLABEL } from '../../lib/tooltipStyle.ts'

export interface ScienceTrace {
  x: ArrayLike<number>
  y: ArrayLike<number>
  name: string
  color: string
  mode?: 'lines' | 'markers' | 'lines+markers'
  dash?: 'solid' | 'dot' | 'dash'
  width?: number
  opacity?: number
  fill?: 'tozeroy' | 'none'
  yAxis?: 'y' | 'y2'
}

export interface AxisRange {
  min: number
  max: number
}

export interface TraceUpdate {
  index: number
  x: ArrayLike<number>
  y: ArrayLike<number>
}

export type CopyImageResult = 'binary' | 'html' | 'text' | 'downloaded' | null

export interface PlotApi {
  autorange: () => Promise<void>
  copyImage: () => Promise<CopyImageResult>
  downloadImage: () => Promise<void>
  restyleTraces: (updates: TraceUpdate[]) => void
  getAxisRange: () => AxisRange | null
}

export interface PlotProps {
  traces: ScienceTrace[]
  xTitle: string
  yTitle: string
  y2Title?: string
  logX?: boolean
  logY?: boolean
  height?: number
  exportTitle?: string
  onRangeChange?: (range: AxisRange | null) => void
  /** 高度拖拽手柄的无障碍文案。 */
  resizeLabel?: string
}

/** 拖拽可调的高度范围与图例定位换算见 ../lib/plotLayout.ts。 */

export const Plot = forwardRef<PlotApi, PlotProps>(function Plot(
  {
    traces,
    xTitle,
    yTitle,
    y2Title,
    logX = false,
    logY = false,
    height = 260,
    exportTitle,
    onRangeChange,
    resizeLabel,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rangeHandlerRef = useRef(onRangeChange)
  const tracesRef = useRef(traces)
  const [plotHeight, setPlotHeight] = useState(height)
  const [resizingHeight, setResizingHeight] = useState(false)

  rangeHandlerRef.current = onRangeChange
  tracesRef.current = traces

  function readAxisRange(): AxisRange | null {
    const element = containerRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fullLayout = (element as any)?._fullLayout
    const range = fullLayout?.xaxis?.range as [number, number] | undefined

    if (!range || !Number.isFinite(range[0]) || !Number.isFinite(range[1])) {
      return null
    }

    const lower = Math.min(range[0], range[1])
    const upper = Math.max(range[0], range[1])
    return fullLayout.xaxis.type === 'log'
      ? { min: 10 ** lower, max: 10 ** upper }
      : { min: lower, max: upper }
  }

  /**
   * 图表下方分隔条的拖拽调高：拖动过程直接 relayout，避免每帧重跑整份 react；
   * 高度先留在闭包局部变量里，抬手时才提交到 state。
   */
  function beginHeightDrag(event: ReactPointerEvent<HTMLElement>) {
    const element = containerRef.current
    if (!element || event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const startY = event.clientY
    const startHeight = plotHeight
    let nextHeight = startHeight

    setResizingHeight(true)

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const candidate = clampPlotHeight(startHeight + (moveEvent.clientY - startY))

      if (candidate === nextHeight) {
        return
      }

      nextHeight = candidate
      void loadPlotly().then((plotly) => plotly.relayout(element, { height: candidate }))
    }

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      setResizingHeight(false)
      setPlotHeight(nextHeight)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    // 触屏上指针可能被系统取消（手势被打断），不收尾的话手柄会一直停在拖拽态。
    window.addEventListener('pointercancel', handlePointerUp)
  }

  /** 分隔条聚焦后可以用上下方向键微调高度。 */
  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return
    }

    event.preventDefault()
    const step = event.key === 'ArrowDown' ? SCIENCE_PLOT_KEYBOARD_STEP : -SCIENCE_PLOT_KEYBOARD_STEP
    setPlotHeight((current) => clampPlotHeight(current + step))
  }

  /** 把 trace 数据恢复为 props 里的全量预览（refine 后图上只有窗口切片），再 autorange。 */
  async function restoreFullAndAutorange() {
    const element = containerRef.current
    if (!element) {
      return
    }

    const plotly = await loadPlotly()
    const full = tracesRef.current
    if (full.length > 0) {
      await plotly.restyle(
        element,
        { x: full.map((trace) => trace.x), y: full.map((trace) => trace.y) },
        full.map((_, index) => index),
      )
    }
    await plotly.relayout(element, {
      'xaxis.autorange': true,
      'yaxis.autorange': true,
      'yaxis2.autorange': true,
    })
  }

  useImperativeHandle(ref, () => ({
    autorange: restoreFullAndAutorange,
    async copyImage() {
      const element = containerRef.current
      if (!element) {
        return null
      }

      const title = exportTitle ?? yTitle
      try {
        const exportOptions = buildChartExportOptions({
          kind: 'line',
          title,
          width: element.clientWidth || undefined,
          height: element.clientHeight || undefined,
        })
        const plotly = await loadPlotly()
        const dataUrl = await plotly.toImage(element, exportOptions.image)
        const response = await fetch(dataUrl)
        const blob = await response.blob()

        return await copyPngDataUrlToClipboard({
          blob,
          dataUrl,
          clipboard: typeof navigator !== 'undefined'
            ? navigator.clipboard as unknown as ClipboardPort
            : undefined,
          ClipboardItemCtor: typeof ClipboardItem !== 'undefined' ? ClipboardItem : null,
          allowTextFallback: false,
        })
      } catch (error) {
        console.error('Copy chart failed, falling back to download.', error)
        const exportOptions = buildChartExportOptions({ kind: 'line', title })
        const plotly = await loadPlotly()
        await plotly.downloadImage(element, { ...exportOptions.download })
        return 'downloaded'
      }
    },
    async downloadImage() {
      const element = containerRef.current
      if (!element) {
        return
      }

      const exportOptions = buildChartExportOptions({ kind: 'line', title: exportTitle ?? yTitle })
      const plotly = await loadPlotly()
      await plotly.downloadImage(element, { ...exportOptions.download })
    },
    restyleTraces(updates) {
      const element = containerRef.current
      if (!element || updates.length === 0) {
        return
      }

      void loadPlotly().then((plotly) => {
        void plotly.restyle(
          element,
          {
            x: updates.map((update) => update.x),
            y: updates.map((update) => update.y),
          },
          updates.map((update) => update.index),
        )
      })
    },
    getAxisRange() {
      return readAxisRange()
    },
  }), [exportTitle, yTitle])

  useEffect(() => {
    const element = containerRef.current
    return () => {
      if (element) {
        void loadPlotly()
          .then((plotly) => plotly.purge(element))
          .catch(() => undefined)
      }
    }
  }, [])

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    let cancelled = false
    void loadPlotly().then((plotly) => {
      if (cancelled) {
        return
      }

      const grid = resolveGridColor()
      const axis = resolveAxisColor()

      const data = traces.map((trace) => ({
        type: 'scatter',
        x: trace.x,
        y: trace.y,
        name: trace.name,
        mode: trace.mode ?? 'lines',
        yaxis: trace.yAxis ?? 'y',
        line: { color: trace.color, width: trace.width ?? 1.6, dash: trace.dash ?? 'solid' },
        marker: { color: trace.color, size: 6 },
        opacity: trace.opacity ?? 1,
        fill: trace.fill ?? 'none',
        hovertemplate: '%{y:.4g}<extra>%{fullData.name}</extra>',
      }))

      const showLegend = traces.length > 1
      const marginBottom = resolvePlotMarginBottom(showLegend)

      const layout: Record<string, unknown> = {
        height: plotHeight,
        // b 要给 x 轴标题留出位置：标题行高约 14px，34 会把它压到容器底边被裁掉。
        // 图例移到绘图区下方后，这段留白还要再容纳一行图例。
        margin: { l: 52, r: y2Title ? 48 : 16, t: SCIENCE_PLOT_MARGIN_TOP, b: marginBottom },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { family: resolveFontFamily(), size: 11, color: axis },
        showlegend: showLegend,
        legend: {
          orientation: 'h',
          x: 0,
          xanchor: 'left',
          y: resolveLegendY(plotHeight, showLegend),
          yanchor: 'top',
          font: { size: 10 },
        },
        hovermode: 'x unified',
        hoverlabel: CHART_HOVERLABEL,
        // Keep the user's viewport across data updates (restyle/refine).
        uirevision: `science-plot|${xTitle}|${yTitle}|${logX}`,
        xaxis: {
          title: { text: xTitle, font: { size: 11 } },
          type: logX ? 'log' : 'linear',
          gridcolor: grid,
          zerolinecolor: grid,
          linecolor: grid,
          tickfont: { size: 10 },
        },
        yaxis: {
          title: { text: yTitle, font: { size: 11 } },
          gridcolor: grid,
          zerolinecolor: grid,
          linecolor: grid,
          tickfont: { size: 10 },
          type: logY ? 'log' : 'linear',
        },
      }

      if (y2Title) {
        layout.yaxis2 = {
          title: { text: y2Title, font: { size: 11 } },
          overlaying: 'y',
          side: 'right',
          zerolinecolor: grid,
          linecolor: grid,
          tickfont: { size: 10 },
        }
      }

      void plotly.react(element, data, layout, { displayModeBar: false, responsive: true })
    })

    return () => {
      cancelled = true
    }
  }, [traces, xTitle, yTitle, y2Title, logX, logY, plotHeight])

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    function handleRelayout() {
      rangeHandlerRef.current?.(readAxisRange())
    }

    function handleDoubleClick() {
      // Plotly 自带的双击复位只会对「当前窗口切片数据」取范围；先恢复全量预览再复位。
      setTimeout(() => {
        void restoreFullAndAutorange()
      }, 0)
    }

    // 有些 plotly 构建在滚轮缩放时不派发 `plotly_relayout`，所以同时监听原生交互事件，
    // 保证视野变化后一定能触发按窗口重新抽稀。
    element.addEventListener('plotly_relayout', handleRelayout)
    element.addEventListener('plotly_relayouting', handleRelayout)
    element.addEventListener('wheel', handleRelayout, { passive: true })
    element.addEventListener('dblclick', handleDoubleClick)
    document.addEventListener('mouseup', handleRelayout)

    return () => {
      element.removeEventListener('plotly_relayout', handleRelayout)
      element.removeEventListener('plotly_relayouting', handleRelayout)
      element.removeEventListener('wheel', handleRelayout)
      element.removeEventListener('dblclick', handleDoubleClick)
      document.removeEventListener('mouseup', handleRelayout)
    }
  }, [])

  return (
    <div className="w-full">
      <div ref={containerRef} className="w-full" />
      {/* 通栏分隔条：拖动它改图表高度。静止是一条细线，悬停/聚焦/拖拽中变粗并染成主色。 */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={resizeLabel ?? 'Resize plot height'}
        title={resizeLabel ?? 'Resize plot height'}
        tabIndex={0}
        className="group flex h-3 w-full cursor-ns-resize touch-none select-none items-center focus-visible:outline-none"
        onPointerDown={beginHeightDrag}
        onKeyDown={handleResizeKeyDown}
      >
        <span
          className={`w-full rounded-full transition-all ${
            resizingHeight
              ? 'h-[3px] bg-primary'
              : 'h-px bg-base-300 group-hover:h-[3px] group-hover:bg-primary/60 group-focus-visible:h-[3px] group-focus-visible:bg-primary/60'
          }`}
        />
      </div>
    </div>
  )
})
