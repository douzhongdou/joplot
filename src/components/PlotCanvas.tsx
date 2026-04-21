import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Plotly from 'plotly.js/dist/plotly-basic.min.js'
import type { Config, Data, Layout } from 'plotly.js/dist/plotly-basic.min.js'
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

async function createPlotBlob(graphDiv: HTMLDivElement) {
  const dataUrl = await plotlyRuntime.toImage(graphDiv, {
    format: 'png',
    width: graphDiv.clientWidth || undefined,
    height: graphDiv.clientHeight || undefined,
    scale: 2,
  })

  const response = await fetch(dataUrl)
  return response.blob()
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

      const supportsClipboardWrite =
        typeof window !== 'undefined'
        && 'ClipboardItem' in window
        && typeof navigator !== 'undefined'
        && !!navigator.clipboard?.write

      if (!supportsClipboardWrite) {
        await plotlyRuntime.downloadImage(graphDiv, {
          format: 'png',
          filename: 'plotnow-chart',
          scale: 2,
        })
        return
      }

      const blob = await createPlotBlob(graphDiv)
      const clipboardItem = new ClipboardItem({ [blob.type]: blob })
      await navigator.clipboard.write([clipboardItem])
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
    if (!containerRef.current) {
      return
    }

    void Plotly.react(
      containerRef.current,
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

    return () => {
      if (containerRef.current) {
        void Plotly.purge(containerRef.current)
      }
    }
  }, [config, data, layout, uirevision])

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
