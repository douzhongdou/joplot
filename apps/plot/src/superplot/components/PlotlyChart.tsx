'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { loadPlotly } from '../lib/plotly'

export type SuperPlotTrace = Record<string, unknown>

export interface AxisRange {
  min: number
  max: number
}

export interface PlotlyChartHandle {
  restyleTraces: (updates: Array<{ index: number; x: Float64Array; y: Float64Array }>) => void
  relayout: (update: Record<string, unknown>) => void
  getAxisRange: () => AxisRange | null
  resetZoom: () => void
  exportPng: (filename: string) => Promise<void>
}

interface Props {
  data: SuperPlotTrace[]
  layout: Record<string, unknown>
  config?: Record<string, unknown>
  /** 只有 revision 变化时才重新 react，其余更新走 restyle，避免打断用户缩放。 */
  revision: string
  onRangeChange?: (range: AxisRange | null) => void
  onAfterRender?: () => void
  className?: string
}

export const PlotlyChart = forwardRef<PlotlyChartHandle, Props>(function PlotlyChart(
  { data, layout, config, revision, onRangeChange, onAfterRender, className },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rangeHandlerRef = useRef(onRangeChange)
  const afterRenderRef = useRef(onAfterRender)
  const dataRef = useRef(data)
  const layoutRef = useRef(layout)
  const configRef = useRef(config)

  rangeHandlerRef.current = onRangeChange
  afterRenderRef.current = onAfterRender
  dataRef.current = data
  layoutRef.current = layout
  configRef.current = config

  function readAxisRange(): AxisRange | null {
    const element = containerRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fullLayout = (element as any)?._fullLayout
    const range = fullLayout?.xaxis?.range as [number, number] | undefined

    if (!range || !Number.isFinite(range[0]) || !Number.isFinite(range[1])) {
      return null
    }

    return { min: Math.min(range[0], range[1]), max: Math.max(range[0], range[1]) }
  }

  useImperativeHandle(ref, () => ({
    restyleTraces(updates) {
      const element = containerRef.current
      if (!element || updates.length === 0) {
        return
      }

      void loadPlotly().then((runtime) => {
        const traceIndices = updates.map((update) => update.index)
        void runtime.restyle(
          element,
          {
            x: updates.map((update) => update.x),
            y: updates.map((update) => update.y),
          },
          traceIndices,
        )
      })
    },
    relayout(update) {
      const element = containerRef.current
      if (!element) {
        return
      }

      void loadPlotly().then((runtime) => runtime.relayout(element, update))
    },
    getAxisRange() {
      return readAxisRange()
    },
    resetZoom() {
      const element = containerRef.current
      if (!element) {
        return
      }
      void loadPlotly().then((runtime) => runtime.relayout(element, {
        'xaxis.autorange': true,
        'yaxis.autorange': true,
      }))
    },
    async exportPng(filename) {
      const element = containerRef.current
      if (!element) {
        return
      }

      const runtime = await loadPlotly()
      const dataUrl = await runtime.toImage(element, {
        format: 'png',
        scale: 2,
        width: element.clientWidth || undefined,
        height: element.clientHeight || undefined,
      })

      const link = document.createElement('a')
      link.href = dataUrl
      link.download = filename.endsWith('.png') ? filename : `${filename}.png`
      link.click()
    },
  }), [])

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    let disposed = false

    void loadPlotly().then(async (runtime) => {
      if (disposed) {
        return
      }
      await runtime.react(
        element,
        dataRef.current,
        { ...layoutRef.current, uirevision: revision },
        { responsive: true, displayModeBar: false, displaylogo: false, ...configRef.current },
      )
      if (!disposed) {
        afterRenderRef.current?.()
      }
    })

    return () => {
      disposed = true
    }
  }, [revision])

  useEffect(() => {
    const element = containerRef.current
    return () => {
      const target = element
      if (target) {
        void loadPlotly().then((runtime) => runtime.purge(target))
      }
    }
  }, [])

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    function handleRelayout() {
      rangeHandlerRef.current?.(readAxisRange())
    }

    // 有些 plotly 构建在滚轮缩放时并不派发 `plotly_relayout`，所以同时监听原生交互事件，
    // 保证视野变化后一定能触发按窗口重新抽稀。
    element.addEventListener('plotly_relayout', handleRelayout)
    element.addEventListener('plotly_relayouting', handleRelayout)
    element.addEventListener('wheel', handleRelayout, { passive: true })
    element.addEventListener('dblclick', handleRelayout)
    document.addEventListener('mouseup', handleRelayout)

    return () => {
      element.removeEventListener('plotly_relayout', handleRelayout)
      element.removeEventListener('plotly_relayouting', handleRelayout)
      element.removeEventListener('wheel', handleRelayout)
      element.removeEventListener('dblclick', handleRelayout)
      document.removeEventListener('mouseup', handleRelayout)
    }
  }, [])

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const observer = new ResizeObserver(() => {
      void loadPlotly().then((runtime) => runtime.Plots.resize(element))
    })
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      className={className ?? 'h-full w-full'}
    />
  )
})
