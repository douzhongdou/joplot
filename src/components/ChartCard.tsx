import { useMemo, useRef } from 'react'
import type { PointerEvent } from 'react'
import { PlotCanvas } from './PlotCanvas'
import { summarizeNumericColumn } from '../lib/workbench'
import type { ChartCard as ChartCardConfig, NormalizedRow } from '../types'

interface Props {
  card: ChartCardConfig
  filteredRows: NormalizedRow[]
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

export function ChartCard({ card, filteredRows, selected, onSelect, onDragStart, onResizeStart }: Props) {
  const canPlot = card.yColumn !== null
  const plotRef = useRef<PlotCanvasApi>(null)

  const plotData = useMemo(() => {
    if (!canPlot || card.yColumn === null) {
      return []
    }

    const yColumn = card.yColumn
    const x = filteredRows.map((row) => row.raw[card.xColumn] ?? '')
    const y = filteredRows.map((row) => row.numeric[yColumn])

    if (card.kind === 'bar') {
      return [{
        type: 'bar' as const,
        x,
        y,
        marker: { color: card.color },
        name: card.title,
      }]
    }

    return [{
      type: 'scattergl' as const,
      mode: card.kind === 'scatter' ? 'markers' : card.drawMode,
      x,
      y,
      marker: { color: card.color, size: 6 },
      line: { color: card.color, width: card.lineWidth },
      name: card.title,
      connectgaps: false,
    }]
  }, [canPlot, card.color, card.drawMode, card.kind, card.lineWidth, card.title, card.xColumn, card.yColumn, filteredRows])

  const plotLayout = useMemo(() => ({
    xaxis: { title: { text: card.xColumn }, automargin: true, gridcolor: '#e9edf5' },
    yaxis: {
      title: { text: card.yColumn ?? '' },
      automargin: true,
      gridcolor: '#e9edf5',
      range:
        card.yMin !== null && card.yMax !== null && card.yMin < card.yMax
          ? [card.yMin, card.yMax]
          : undefined,
    },
    showlegend: false,
    hovermode: 'x unified',
  }), [card.xColumn, card.yColumn, card.yMin, card.yMax])

  const summary = useMemo(
    () => (card.yColumn ? summarizeNumericColumn(filteredRows, card.yColumn) : null),
    [card.yColumn, filteredRows],
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
            <span>{filteredRows.length.toLocaleString()} 行</span>
          </div>
        </div>
      </div>

      <div className="card-visual-area">
        {card.kind === 'stats' && summary && (
          <div className="stats-grid">
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
            <div className="stat-tile">
              <div className="stat-label">中位数</div>
              <div className="stat-value">{formatValue(summary.median)}</div>
            </div>
          </div>
        )}

        {card.kind !== 'stats' && canPlot && (
          <div className="plot-panel">
            <PlotCanvas
              ref={plotRef}
              data={plotData}
              uirevision={`${card.id}:${card.xColumn}:${card.yColumn ?? 'none'}`}
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

        {card.kind !== 'stats' && !canPlot && (
          <div className="placeholder">
            这张图卡还没有可绘制的数值列。
            <br />
            先在右侧边栏里为 Y 轴选择一个数值字段。
          </div>
        )}
      </div>

      <button type="button" className="resize-handle" onPointerDown={onResizeStart} aria-label="缩放图卡" />
    </article>
  )
}
