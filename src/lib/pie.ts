import type { Data, Layout } from 'plotly.js/dist/plotly.min.js'
import { getChartColor } from './theme.ts'

export interface PieSeriesInput {
  name: string
  labels: Array<string | number>
  values: Array<number | null>
}

export const PIE_LEGEND_SLICE_LIMIT = 12

function getPieGridDimensions(seriesCount: number) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(seriesCount)))

  return {
    columns,
    rows: Math.ceil(seriesCount / columns),
  }
}

export function buildPieTraces(seriesInputs: PieSeriesInput[]): Data[] {
  const renderableSeries = seriesInputs.flatMap((series) => {
    const points = series.labels.flatMap((label, pointIndex) => {
      const value = series.values[pointIndex]

      return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? [{ label, value }]
        : []
    })

    if (points.length === 0 || points.every((point) => point.value === 0)) {
      return []
    }

    return [{ series, points }]
  })
  const { columns } = getPieGridDimensions(renderableSeries.length)

  return renderableSeries.map(({ series, points }, seriesIndex) => ({
    type: 'pie' as const,
    labels: points.map((point) => point.label),
    values: points.map((point) => point.value),
    name: series.name,
    sort: false,
    textinfo: points.length <= 8 ? 'label+percent' as const : 'percent' as const,
    textposition: 'inside' as const,
    insidetextorientation: 'auto' as const,
    marker: {
      colors: points.map((_, pointIndex) => getChartColor(pointIndex)),
    },
    domain: renderableSeries.length > 1
      ? {
          row: Math.floor(seriesIndex / columns),
          column: seriesIndex % columns,
        }
      : undefined,
    title: renderableSeries.length > 1 ? { text: series.name } : undefined,
    hovertemplate: '%{label}: %{value}<br>%{percent}<extra>%{fullData.name}</extra>',
  }))
}

export function shouldShowPieLegend(requested: boolean, traces: Data[]) {
  if (!requested) {
    return false
  }

  const sliceCount = traces.reduce((count, trace) => {
    if (trace.type !== 'pie' || !Array.isArray(trace.labels)) {
      return count
    }

    return count + trace.labels.length
  }, 0)

  return sliceCount > 0 && sliceCount <= PIE_LEGEND_SLICE_LIMIT
}

export function buildPieGrid(seriesCount: number): Layout['grid'] | undefined {
  if (seriesCount <= 1) {
    return undefined
  }

  const { columns, rows } = getPieGridDimensions(seriesCount)

  return {
    columns,
    rows,
    pattern: 'independent',
  }
}
