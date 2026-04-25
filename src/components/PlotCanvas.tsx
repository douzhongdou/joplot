import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Plotly from 'plotly.js/dist/plotly.min.js'
import type { Config, Data, Layout } from 'plotly.js/dist/plotly.min.js'
import { copyPngDataUrlToClipboard } from '../lib/clipboard'
import { buildAutorangeUpdate, buildPlotLayout } from '../lib/plotViewport'
import { resolveThemeColor } from '../lib/theme'

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
  config?: Partial<Config>
}

type PlotlyRuntime = typeof Plotly & {
  Plots: {
    resize: (element: HTMLDivElement) => void
  }
  relayout: (element: HTMLDivElement, update: Record<string, unknown>) => Promise<void>
  toImage: (element: HTMLDivElement, options?: Record<string, unknown>) => Promise<string>
  downloadImage: (element: HTMLDivElement, options?: Record<string, unknown>) => Promise<void>
}

const plotlyRuntime = Plotly as PlotlyRuntime

async function createPlotImagePayload(graphDiv: HTMLDivElement) {
  const dataUrl = await plotlyRuntime.toImage(graphDiv, {
    format: 'png',
    width: graphDiv.clientWidth || undefined,
    height: graphDiv.clientHeight || undefined,
    scale: 2,
  })

  const response = await fetch(dataUrl)
  const blob = await response.blob()

  return { dataUrl, blob }
}

export const PlotCanvas = forwardRef<PlotCanvasApi, Props>(function PlotCanvas(
  { data, layout, uirevision, config },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    async autorange() {
      const graphDiv = containerRef.current
      if (!graphDiv) {
        return
      }

      await plotlyRuntime.relayout(graphDiv, buildAutorangeUpdate())
    },
    async copyImage() {
      const graphDiv = containerRef.current
      if (!graphDiv) {
        return null
      }

      try {
        const { dataUrl, blob } = await createPlotImagePayload(graphDiv)

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
        await plotlyRuntime.downloadImage(graphDiv, {
          format: 'png',
          filename: 'plotnow-chart',
          scale: 2,
        })
        return 'downloaded'
      }
    },
    async downloadImage() {
      const graphDiv = containerRef.current
      if (!graphDiv) {
        return
      }

      await plotlyRuntime.downloadImage(graphDiv, {
        format: 'png',
        filename: 'plotnow-chart',
        scale: 2,
      })
    },
  }), [])

  useEffect(() => {
    const graphDiv = containerRef.current

    if (!graphDiv) {
      return
    }

    void Plotly.react(
      graphDiv,
      data,
      buildPlotLayout({
        margin: { l: 78, r: 18, t: 24, b: 88 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: resolveThemeColor('--color-base-100', '#ffffff'),
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
  }, [config, data, layout, uirevision])

  useEffect(() => {
    const graphDiv = containerRef.current

    return () => {
      if (graphDiv) {
        Plotly.purge(graphDiv)
      }
    }
  }, [])

  // Middle mouse button to pan
  useEffect(() => {
    const graphDiv = containerRef.current
    if (!graphDiv) return
    const plotDiv = graphDiv

    function handleMouseDown(event: MouseEvent) {
      if (event.button !== 1) return
      event.preventDefault()
      plotlyRuntime.relayout(plotDiv, { dragmode: 'pan' })
    }

    function handleMouseUp(event: MouseEvent) {
      if (event.button !== 1) return
      plotlyRuntime.relayout(plotDiv, { dragmode: 'zoom' })
    }

    plotDiv.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      plotDiv.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mouseup', handleMouseUp)
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
        plotlyRuntime.Plots.resize(containerRef.current)
      }
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  return <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden rounded-[var(--radius-box)] border border-base-300 bg-white" />
})
