import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { Config, Data, Layout } from 'plotly.js/dist/plotly.min.js'
import { copyPngDataUrlToClipboard } from '../lib/clipboard'
import { buildChartExportOptions, CHART_EXPORT_BACKGROUND_COLOR } from '../lib/chartExport'
import { buildAutorangeUpdate, buildPlotLayout } from '../lib/plotViewport'
import { resolveThemeColor } from '../lib/theme'
import type { ChartKind } from '../types'

export type CopyImageResult = import('../lib/clipboard').ClipboardCopyMode | 'downloaded'

interface PlotCanvasApi {
  autorange: () => Promise<void>
  copyImage: () => Promise<CopyImageResult | null>
  downloadImage: () => Promise<void>
}

interface Props {
  data: Data[]
  layout: Partial<Layout>
  uirevision: string
  exportKind: ChartKind
  exportTitle: string
  config?: Partial<Config>
}

type PlotlyRuntime = {
  Plots: {
    resize: (element: HTMLDivElement) => void
  }
  react: (
    element: HTMLDivElement,
    data: Data[],
    layout: Partial<Layout>,
    config?: Partial<Config>,
  ) => Promise<void>
  purge: (element: HTMLDivElement) => void
  relayout: (element: HTMLDivElement, update: Record<string, unknown>) => Promise<void>
  toImage: (element: HTMLDivElement, options?: Record<string, unknown>) => Promise<string>
  downloadImage: (element: HTMLDivElement, options?: Record<string, unknown>) => Promise<void>
}

type PlotlyModule = typeof import('plotly.js/dist/plotly.min.js')

let plotlyRuntimePromise: Promise<PlotlyRuntime> | null = null

async function loadPlotlyRuntime(): Promise<PlotlyRuntime> {
  if (!plotlyRuntimePromise) {
    plotlyRuntimePromise = import('plotly.js/dist/plotly.min.js').then(
      (module) => (module as PlotlyModule).default as PlotlyRuntime,
    )
  }

  return plotlyRuntimePromise
}

async function createPlotImagePayload(
  graphDiv: HTMLDivElement,
  exportOptions: ReturnType<typeof buildChartExportOptions>,
) {
  const plotlyRuntime = await loadPlotlyRuntime()
  const dataUrl = await plotlyRuntime.toImage(graphDiv, exportOptions.image)

  const response = await fetch(dataUrl)
  const blob = await response.blob()

  return { dataUrl, blob }
}

export const PlotCanvas = forwardRef<PlotCanvasApi, Props>(function PlotCanvas(
  { data, layout, uirevision, exportKind, exportTitle, config },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    async autorange() {
      const graphDiv = containerRef.current
      if (!graphDiv) {
        return
      }

      const plotlyRuntime = await loadPlotlyRuntime()
      await plotlyRuntime.relayout(graphDiv, buildAutorangeUpdate())
    },
    async copyImage() {
      const graphDiv = containerRef.current
      if (!graphDiv) {
        return null
      }

      try {
        const exportOptions = buildChartExportOptions({
          kind: exportKind,
          title: exportTitle,
          width: graphDiv.clientWidth || undefined,
          height: graphDiv.clientHeight || undefined,
        })
        const { dataUrl, blob } = await createPlotImagePayload(graphDiv, exportOptions)

        return await copyPngDataUrlToClipboard({
          blob,
          dataUrl,
          clipboard: typeof navigator !== 'undefined'
            ? navigator.clipboard as unknown as import('../lib/clipboard').ClipboardPort
            : undefined,
          ClipboardItemCtor: typeof ClipboardItem !== 'undefined' ? ClipboardItem : null,
        })
      } catch (error) {
        console.error('Copy chart failed, falling back to download.', error)
        const exportOptions = buildChartExportOptions({
          kind: exportKind,
          title: exportTitle,
        })
        const plotlyRuntime = await loadPlotlyRuntime()
        await plotlyRuntime.downloadImage(graphDiv, {
          ...exportOptions.download,
        })
        return 'downloaded'
      }
    },
    async downloadImage() {
      const graphDiv = containerRef.current
      if (!graphDiv) {
        return
      }

      const exportOptions = buildChartExportOptions({
        kind: exportKind,
        title: exportTitle,
      })
      const plotlyRuntime = await loadPlotlyRuntime()
      await plotlyRuntime.downloadImage(graphDiv, {
        ...exportOptions.download,
      })
    },
  }), [exportKind, exportTitle])

  useEffect(() => {
    const graphDiv = containerRef.current

    if (!graphDiv) {
      return
    }

    void (async () => {
      const plotlyRuntime = await loadPlotlyRuntime()

      await plotlyRuntime.react(
        graphDiv,
        data,
        buildPlotLayout({
          margin: { l: 78, r: 18, t: 24, b: 88 },
          paper_bgcolor: CHART_EXPORT_BACKGROUND_COLOR,
          plot_bgcolor: CHART_EXPORT_BACKGROUND_COLOR,
          font: {
            family: 'Segoe UI, PingFang SC, Microsoft YaHei, sans-serif',
            size: 14,
            color: resolveThemeColor('--color-base-content', '#111827'),
          },
          ...layout,
        }, uirevision),
        {
          responsive: true,
          displayModeBar: false,
          scrollZoom: true,
          displaylogo: false,
          ...config,
        },
      )
    })()
  }, [config, data, layout, uirevision])

  useEffect(() => {
    const graphDiv = containerRef.current

    return () => {
      if (graphDiv) {
        void loadPlotlyRuntime().then((plotlyRuntime) => {
          plotlyRuntime.purge(graphDiv)
        })
      }
    }
  }, [])

  // Middle mouse button to pan
  useEffect(() => {
    const graphDiv = containerRef.current
    if (!graphDiv) return

    let isPanning = false
    let startX = 0
    let startY = 0

    function handleMiddleDown(event: MouseEvent) {
      if (event.button !== 1) return
      event.preventDefault()
      event.stopImmediatePropagation()
      isPanning = true
      startX = event.clientX
      startY = event.clientY
      document.addEventListener('mousemove', handleMiddleMove)
      document.addEventListener('mouseup', handleMiddleUp)
    }

    function handleMiddleMove(event: MouseEvent) {
      if (!isPanning || !graphDiv) return
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      startX = event.clientX
      startY = event.clientY

      const relayout: Record<string, unknown> = {}

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fullLayout = (graphDiv as any)._fullLayout
      if (!fullLayout) return

      if (fullLayout.xaxis && typeof fullLayout.xaxis.p2d === 'function') {
        const xStart = fullLayout.xaxis.p2d(0)
        const xEnd = fullLayout.xaxis.p2d(dx)
        if (typeof xStart === 'number' && typeof xEnd === 'number') {
          const xDelta = xStart - xEnd
          const [xRange0, xRange1] = fullLayout.xaxis.range
          relayout['xaxis.range[0]'] = xRange0 + xDelta
          relayout['xaxis.range[1]'] = xRange1 + xDelta
        }
      }

      if (fullLayout.yaxis && typeof fullLayout.yaxis.p2d === 'function') {
        const yStart = fullLayout.yaxis.p2d(0)
        const yEnd = fullLayout.yaxis.p2d(dy)
        if (typeof yStart === 'number' && typeof yEnd === 'number') {
          const yDelta = yStart - yEnd
          const [yRange0, yRange1] = fullLayout.yaxis.range
          relayout['yaxis.range[0]'] = yRange0 + yDelta
          relayout['yaxis.range[1]'] = yRange1 + yDelta
        }
      }

      if (Object.keys(relayout).length > 0) {
        void loadPlotlyRuntime().then((plotlyRuntime) => {
          void plotlyRuntime.relayout(graphDiv, relayout)
        })
      }
    }

    function handleMiddleUp(event: MouseEvent) {
      if (event.button !== 1) return
      isPanning = false
      document.removeEventListener('mousemove', handleMiddleMove)
      document.removeEventListener('mouseup', handleMiddleUp)
    }

    graphDiv.addEventListener('mousedown', handleMiddleDown, true)

    return () => {
      graphDiv.removeEventListener('mousedown', handleMiddleDown, true)
      document.removeEventListener('mousemove', handleMiddleMove)
      document.removeEventListener('mouseup', handleMiddleUp)
    }
  }, [])

  // Round hover tooltip corners (Plotly doesn't support this natively)
  useEffect(() => {
    const graphDiv = containerRef.current
    if (!graphDiv) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function handleHover() {
      if (!graphDiv) return
      const rect = graphDiv.querySelector<SVGRectElement>('.hoverlayer .hovertext rect')
      if (rect) {
        rect.setAttribute('rx', '8')
        rect.setAttribute('ry', '8')
      }
    }

    graphDiv.addEventListener('plotly_hover', handleHover)
    graphDiv.addEventListener('plotly_unhover', handleHover)
    return () => {
      graphDiv.removeEventListener('plotly_hover', handleHover)
      graphDiv.removeEventListener('plotly_unhover', handleHover)
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        void loadPlotlyRuntime().then((plotlyRuntime) => {
          plotlyRuntime.Plots.resize(containerRef.current!)
        })
      }
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  return <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden rounded-[var(--radius-box)] border border-base-300 bg-white" />
})
