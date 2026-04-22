import { useMemo, useRef } from 'react'
import type { PointerEvent } from 'react'
import { PlotCanvas } from './PlotCanvas'
import { summarizeNumericColumn } from '../lib/workbench'
import type { ChartCard as ChartCardConfig, CsvData, NormalizedRow } from '../types'

interface Props {
  card: ChartCardConfig
  datasetsById: Record<string, CsvData>
  filteredRowsByDataset: Record<string, NormalizedRow[]>
  selected: boolean
  onSelect: () => void
  onDragStart: (event: PointerEvent<HTMLElement>) => void
  onResizeStart: (event: PointerEvent<HTMLButtonElement>) => void
}

interface PlotCanvasApi {
  autorange: () => Promise<void>
  copyImage: () => Promise<void>
  downloadImage: () => Promise<void>
}

const KIND_LABELS: Record<ChartCardConfig['kind'], string> = {
  line: '折线图',
  scatter: '散点图',
  bar: '柱状图',
  stats: '统计卡',
}

function formatValue(value: number | null) {
  return value === null ? '—' : Number(value.toFixed(3)).toString()
}

export function ChartCard({
  card,
  datasetsById,
  filteredRowsByDataset,
  selected,
  onSelect,
  onDragStart,
  onResizeStart,
}: Props) {
  const plotRef = useRef<PlotCanvasApi>(null)

  const validSeries = useMemo(() => (
    card.series
      .map((series) => {
        const dataset = datasetsById[series.datasetId]

        if (!dataset || !dataset.headers.includes(card.xColumn) || !series.yColumn) {
          return null
        }

        if (!dataset.numericColumns.includes(series.yColumn)) {
          return null
        }

        return {
          series,
          dataset,
          rows: filteredRowsByDataset[series.datasetId] ?? dataset.rows,
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  ), [card.series, card.xColumn, datasetsById, filteredRowsByDataset])

  const plotData = useMemo(() => {
    if (card.kind === 'stats') {
      return []
    }

    return validSeries.map(({ series, rows }) => {
      const x = rows.map((row) => row.raw[card.xColumn] ?? '')
      const y = rows.map((row) => row.numeric[series.yColumn!])

      if (card.kind === 'bar') {
        return {
          type: 'bar' as const,
          x,
          y,
          marker: { color: series.color },
          name: series.label,
        }
      }

      return {
        type: 'scattergl' as const,
        mode: card.kind === 'scatter' ? 'markers' : card.drawMode,
        x,
        y,
        marker: { color: series.color, size: 6 },
        line: { color: series.color, width: card.lineWidth },
        name: series.label,
        connectgaps: false,
      }
    })
  }, [card.drawMode, card.kind, card.lineWidth, card.xColumn, validSeries])

  const plotLayout = useMemo(() => ({
    xaxis: { title: { text: card.xColumn }, automargin: true, gridcolor: '#e9edf5' },
    yaxis: {
      title: { text: validSeries[0]?.series.yColumn ?? '' },
      automargin: true,
      gridcolor: '#e9edf5',
      range:
        card.yMin !== null && card.yMax !== null && card.yMin < card.yMax
          ? [card.yMin, card.yMax]
          : undefined,
    },
    showlegend: validSeries.length > 1,
    hovermode: 'x unified',
  }), [card.xColumn, card.yMax, card.yMin, validSeries])

  const primarySeries = validSeries[0] ?? null
  const summary = useMemo(
    () => (
      primarySeries?.series.yColumn
        ? summarizeNumericColumn(primarySeries.rows, primarySeries.series.yColumn)
        : null
    ),
    [primarySeries],
  )

  return (
    <article className={`chart-card ${selected ? 'chart-card-selected' : ''}`} onMouseDown={onSelect}>
      <div className="chart-card-head">
        <button type="button" className="drag-handle" onPointerDown={onDragStart} aria-label="拖动画布卡片">
          拖动
        </button>

        <div className="chart-card-titleblock">
          <h3>{card.title}</h3>
          <div className="card-meta">
            <span>{KIND_LABELS[card.kind]}</span>
            <span>{validSeries.length} 个系列</span>
          </div>
        </div>
      </div>

      <div className="card-visual-area">
        {card.kind === 'stats' && summary && primarySeries && (
          <div className="stats-grid">
            <div className="stat-tile">
              <div className="stat-label">数据集</div>
              <div className="stat-value">{primarySeries.dataset.fileName}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">有效值</div>
              <div className="stat-value">{summary.count}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">空值</div>
              <div className="stat-value">{summary.missing}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">最小值</div>
              <div className="stat-value">{formatValue(summary.min)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">最大值</div>
              <div className="stat-value">{formatValue(summary.max)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">均值</div>
              <div className="stat-value">{formatValue(summary.mean)}</div>
            </div>
          </div>
        )}

        {card.kind !== 'stats' && validSeries.length > 0 && (
          <div className="plot-panel">
            <PlotCanvas
              ref={plotRef}
              data={plotData}
              uirevision={`${card.id}:${card.xColumn}:${card.series.map((series) => series.id).join('|')}`}
              layout={plotLayout}
            />

            <div className="plot-toolbar" aria-label="图表工具栏">
              <button type="button" className="plot-tool-button" onClick={() => void plotRef.current?.autorange()}>
                Auto Scale
              </button>
              <button type="button" className="plot-tool-button" onClick={() => void plotRef.current?.copyImage()}>
                Copy
              </button>
              <button type="button" className="plot-tool-button" onClick={() => void plotRef.current?.downloadImage()}>
                Save
              </button>
            </div>
          </div>
        )}

        {((card.kind === 'stats' && !summary) || (card.kind !== 'stats' && validSeries.length === 0)) && (
          <div className="placeholder">
            当前图卡没有可绘制的有效数据系列。
            <br />
            请在右侧为它选择可用的数据集和字段。
          </div>
        )}
      </div>

      <button type="button" className="resize-handle" onPointerDown={onResizeStart} aria-label="缩放图卡" />
    </article>
  )
}
