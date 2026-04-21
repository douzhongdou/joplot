import { useEffect, useRef } from 'react'
import Plotly from 'plotly.js/dist/plotly-basic.min.js'
import type { Config, Data, Layout } from 'plotly.js/dist/plotly-basic.min.js'

interface Props {
  data: Data[]
  layout: Partial<Layout>
  config?: Partial<Config>
}

export function PlotCanvas({ data, layout, config }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    void Plotly.react(
      containerRef.current,
      data,
      {
        margin: { l: 48, r: 20, t: 24, b: 48 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: '#f8faf8',
        font: { family: 'Segoe UI, PingFang SC, Microsoft YaHei, sans-serif', size: 12 },
        ...layout,
      },
      {
        responsive: true,
        displayModeBar: true,
        scrollZoom: true,
        ...config,
      },
    )

    return () => {
      if (containerRef.current) {
        void Plotly.purge(containerRef.current)
      }
    }
  }, [config, data, layout])

  return <div ref={containerRef} className="plot-shell" />
}
