import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import {
  Copy,
  CopyCheck,
  Download,
  GripVertical,
  MoveDiagonal2,
  ScanSearch,
} from 'lucide-react'
import { PlotCanvas } from './PlotCanvas'
import { summarizeNumericColumn } from '../lib/workbench'
import type { ChartCard as ChartCardConfig, CsvData, NormalizedRow } from '../types'
import type { CopyImageResult } from './PlotCanvas'

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
  copyImage: () => Promise<CopyImageResult | null>
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

function getCopyToastLabel(mode: CopyImageResult | null) {
  switch (mode) {
    case 'binary':
    case 'html':
    case 'text':
      return '已复制'
    case 'downloaded':
      return '剪贴板不可用，已下载'
    default:
      return ''
  }
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
  const [copyToast, setCopyToast] = useState('')

  useEffect(() => {
    if (!copyToast) {
      return
    }

    const timeoutId = window.setTimeout(() => setCopyToast(''), 1600)

    return () => window.clearTimeout(timeoutId)
  }, [copyToast])

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
    xaxis: {
      title: { text: card.showAxes ? card.xColumn : '' },
      automargin: true,
      showgrid: card.showGrid,
      gridcolor: '#e9edf5',
      visible: card.showAxes,
    },
    yaxis: {
      title: { text: card.showAxes ? (validSeries[0]?.series.yColumn ?? '') : '' },
      automargin: true,
      showgrid: card.showGrid,
      gridcolor: '#e9edf5',
      visible: card.showAxes,
      range:
        card.yMin !== null && card.yMax !== null && card.yMin < card.yMax
          ? [card.yMin, card.yMax]
          : undefined,
    },
    showlegend: card.showLegend && validSeries.length > 1,
    hovermode: 'x unified',
  }), [card.showAxes, card.showGrid, card.showLegend, card.xColumn, card.yMax, card.yMin, validSeries])

  const primarySeries = validSeries[0] ?? null
  const summary = useMemo(
    () => (
      primarySeries?.series.yColumn
        ? summarizeNumericColumn(primarySeries.rows, primarySeries.series.yColumn)
        : null
    ),
    [primarySeries],
  )

  async function handleCopyImage() {
    const mode = await plotRef.current?.copyImage()
    const label = getCopyToastLabel(mode ?? null)

    if (label) {
      setCopyToast(label)
    }
  }

  return (
    <article className={`chart-card ${selected ? 'chart-card-selected' : ''}`} onMouseDown={onSelect}>
      <div className="chart-card-head">
        <button
          type="button"
          className="drag-handle"
          onPointerDown={onDragStart}
          aria-label="拖动画布卡片"
          title="拖动画布卡片"
        >
          <GripVertical size={16} strokeWidth={2.2} />
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
              <button
                type="button"
                className="plot-tool-button"
                onClick={() => void plotRef.current?.autorange()}
                aria-label="自动缩放"
                title="自动缩放"
              >
                <ScanSearch size={15} strokeWidth={2.1} />
              </button>
              <button
                type="button"
                className="plot-tool-button"
                onClick={() => void handleCopyImage()}
                aria-label="复制图像"
                title="复制图像"
              >
                {copyToast ? <CopyCheck size={15} strokeWidth={2.1} /> : <Copy size={15} strokeWidth={2.1} />}
              </button>
              <button
                type="button"
                className="plot-tool-button"
                onClick={() => void plotRef.current?.downloadImage()}
                aria-label="下载图像"
                title="下载图像"
              >
                <Download size={15} strokeWidth={2.1} />
              </button>
            </div>

            {copyToast && (
              <div className="plot-toolbar-feedback" role="status">
                {copyToast}
              </div>
            )}
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

      <button
        type="button"
        className="resize-handle"
        onPointerDown={onResizeStart}
        aria-label="缩放图卡"
        title="缩放图卡"
      >
        <MoveDiagonal2 size={15} strokeWidth={2.1} />
      </button>
    </article>
  )
}
