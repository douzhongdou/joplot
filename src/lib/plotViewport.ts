import type { Layout } from 'plotly.js/dist/plotly-basic.min.js'

export function buildAutorangeUpdate() {
  return {
    'xaxis.autorange': true,
    'yaxis.autorange': true,
  }
}

export function buildPlotLayout(layout: Partial<Layout>, uirevision: string): Partial<Layout> {
  return {
    ...layout,
    uirevision,
  }
}
