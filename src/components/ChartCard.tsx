import { useMemo, useRef } from 'react'
import type { PointerEvent } from 'react'
import { PlotCanvas } from './PlotCanvas'
import { sampleRows, summarizeNumericColumn } from '../lib/workbench'
import type { ChartCard as ChartCardConfig, CsvData, NormalizedRow } from '../types'

interface Props {
  card: ChartCardConfig
  csv: CsvData
  filteredRows: NormalizedRow[]
  selected: boolean
  onChange: (patch: Partial<ChartCardConfig>) => void
  onDuplicate: () => void
  onRemove: () => void
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
  csv,
  filteredRows,
  selected,
  onChange,
  onDuplicate,
  onRemove,
  onSelect,
  onDragStart,
  onResizeStart,
}: Props) {
  const sampledRows = useMemo(() => sampleRows(filteredRows, 3000), [filteredRows])
  const numericOptions = csv.numericColumns
  const canPlot = card.yColumn !== null && numericOptions.includes(card.yColumn)
  const plotRef = useRef<PlotCanvasApi>(null)

  const plotData = useMemo(() => {
    if (!canPlot || card.yColumn === null) {
      return []
    }

    const x = sampledRows.map((row) => row.raw[card.xColumn] ?? '')
    const y = sampledRows.map((row) => row.numeric[card.yColumn!])

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
      type: 'scatter' as const,
      mode: card.kind === 'scatter' ? 'markers' : card.drawMode,
      x,
      y,
      marker: { color: card.color, size: 7 },
      line: { color: card.color, width: card.lineWidth },
      name: card.title,
    }]
  }, [canPlot, card.color, card.drawMode, card.kind, card.lineWidth, card.title, card.xColumn, card.yColumn, sampledRows])

  const summary = useMemo(
    () => (card.yColumn ? summarizeNumericColumn(filteredRows, card.yColumn) : null),
    [card.yColumn, filteredRows],
  )

  return (
    <article className={`chart-card ${selected ? 'chart-card-selected' : ''}`} onMouseDown={onSelect}>
      <div className="card-toolbar">
        <div className="card-toolbar-main">
          <button type="button" className="drag-handle" onPointerDown={onDragStart} aria-label="拖动图卡">
            拖动
          </button>

          <label className="compact-field compact-field-title">
            <span>标题</span>
            <input
              type="text"
              value={card.title}
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </label>

          <label className="compact-field">
            <span>类型</span>
            <select
              value={card.kind}
              onChange={(event) => onChange({ kind: event.target.value as ChartCardConfig['kind'] })}
            >
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="compact-field">
            <span>X</span>
            <select
              value={card.xColumn}
              onChange={(event) => onChange({ xColumn: event.target.value })}
            >
              {csv.headers.map((header) => (
                <option key={header} value={header}>{header}</option>
              ))}
            </select>
          </label>

          <label className="compact-field">
            <span>Y</span>
            <select
              value={card.yColumn ?? ''}
              onChange={(event) => onChange({ yColumn: event.target.value || null })}
            >
              <option value="">选择数值列</option>
              {numericOptions.map((header) => (
                <option key={header} value={header}>{header}</option>
              ))}
            </select>
          </label>

          {card.kind !== 'stats' && (
            <>
              <label className="compact-field compact-field-color">
                <span>颜色</span>
                <input
                  type="color"
                  value={card.color}
                  onChange={(event) => onChange({ color: event.target.value })}
                />
              </label>

              <label className="compact-field compact-field-small">
                <span>线宽</span>
                <input
                  type="number"
                  min="1"
                  max="6"
                  value={card.lineWidth}
                  onChange={(event) => onChange({ lineWidth: Number(event.target.value) || 1 })}
                />
              </label>

              {card.kind === 'line' && (
                <label className="compact-field">
                  <span>绘制</span>
                  <select
                    value={card.drawMode}
                    onChange={(event) => onChange({ drawMode: event.target.value as ChartCardConfig['drawMode'] })}
                  >
                    <option value="lines">折线</option>
                    <option value="lines+markers">线+点</option>
                    <option value="markers">仅点</option>
                  </select>
                </label>
              )}
            </>
          )}
        </div>

        <div className="card-toolbar-actions">
          <button type="button" className="ghost-button" onClick={onDuplicate}>复制</button>
          <button type="button" className="ghost-button danger-button" onClick={onRemove}>删除</button>
        </div>
      </div>

      <div className="card-meta">
        <span>{KIND_LABELS[card.kind]}</span>
        <span>当前显示 {sampledRows.length.toLocaleString()} / {filteredRows.length.toLocaleString()} 行</span>
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
              layout={{
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
              }}
            />

            <div className="plot-toolbar" aria-label="图表工具栏">
              <div className="plot-toolbar-group">
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
          </div>
        )}

        {card.kind !== 'stats' && !canPlot && (
          <div className="placeholder">
            这张图卡还没有可绘制的数值列。
            <br />
            先为 Y 轴选择一个数值字段即可。
          </div>
        )}
      </div>

      <button type="button" className="resize-handle" onPointerDown={onResizeStart} aria-label="缩放图卡" />
    </article>
  )
}
