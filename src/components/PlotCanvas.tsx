import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Plotly from 'plotly.js/dist/plotly.min.js'
import type { Config, Data, Layout } from 'plotly.js/dist/plotly.min.js'
import { copyPngDataUrlToClipboard } from '../lib/clipboard'
import { buildAutorangeUpdate, buildPlotLayout } from '../lib/plotViewport'

interface PlotCanvasApi {
  autorange: () => Promise<void>
  copyImage: () => Promise<void>
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
        return
      }

      try {
        const { dataUrl, blob } = await createPlotImagePayload(graphDiv)

        await copyPngDataUrlToClipboard({
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
        margin: { l: 52, r: 18, t: 18, b: 44 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: '#ffffff',
        font: { family: 'Segoe UI, PingFang SC, Microsoft YaHei, sans-serif', size: 12, color: '#172b4d' },
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

  return <div ref={containerRef} className="plot-shell" />
})
