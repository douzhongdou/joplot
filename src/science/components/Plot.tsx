'use client'

import { useEffect, useRef } from 'react'
import { loadPlotly } from '../lib/plotly.ts'
import { resolveAxisColor, resolveFontFamily, resolveGridColor } from '../lib/plotTheme.ts'

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

export interface PlotProps {
  traces: ScienceTrace[]
  xTitle: string
  yTitle: string
  y2Title?: string
  logY?: boolean
  height?: number
}

export function Plot({ traces, xTitle, yTitle, y2Title, logY = false, height = 260 }: PlotProps) {
  const containerRef = useRef<HTMLDivElement>(null)

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

      const layout: Record<string, unknown> = {
        height,
        margin: { l: 52, r: y2Title ? 48 : 16, t: 14, b: 34 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { family: resolveFontFamily(), size: 11, color: axis },
        showlegend: traces.length > 1,
        legend: { orientation: 'h', y: 1.12, x: 0, font: { size: 10 } },
        hovermode: 'x unified',
        xaxis: {
          title: { text: xTitle, font: { size: 11 } },
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
  }, [traces, xTitle, yTitle, y2Title, logY, height])

  return <div ref={containerRef} className="w-full" />
}
