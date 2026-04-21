import { useMemo } from 'react'
import { PlotCanvas } from './PlotCanvas'
import { sampleRows, summarizeNumericColumn } from '../lib/workbench'
import type { ChartCard as ChartCardConfig, CsvData, NormalizedRow } from '../types'

interface Props {
  card: ChartCardConfig
  csv: CsvData
  filteredRows: NormalizedRow[]
  onChange: (patch: Partial<ChartCardConfig>) => void
  onDuplicate: () => void
  onRemove: () => void
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

export function ChartCard({ card, csv, filteredRows, onChange, onDuplicate, onRemove }: Props) {
  const sampledRows = useMemo(() => sampleRows(filteredRows, 3000), [filteredRows])
  const numericOptions = csv.numericColumns
  const canPlot = card.yColumn !== null && numericOptions.includes(card.yColumn)

  const plotData = useMemo(() => {
    if (!canPlot || card.yColumn === null) {
      return []
    }

    const x = sampledRows.map((row) => row.raw[card.xColumn] ?? '')
    const y = sampledRows
      .map((row) => row.numeric[card.yColumn!])
      .map((value) => (value === null ? null : value))

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
    <article className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title">{card.title}</h3>
          <div className="card-subtitle">
            {KIND_LABELS[card.kind]} · 当前显示 {sampledRows.length.toLocaleString()} / {filteredRows.length.toLocaleString()} 条记录
          </div>
        </div>
        <div className="card-actions">
          <button type="button" className="secondary" onClick={onDuplicate}>复制</button>
          <button type="button" className="secondary" onClick={onRemove}>删除</button>
        </div>
      </div>

      <div className="card-body">
        <div className={`card-form ${card.kind !== 'stats' ? 'card-form-advanced' : ''}`}>
          <label className="field">
            <span className="field-label">标题</span>
            <input
              type="text"
              value={card.title}
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </label>

          <label className="field">
            <span className="field-label">图卡类型</span>
            <select
              value={card.kind}
              onChange={(event) => onChange({ kind: event.target.value as ChartCardConfig['kind'] })}
            >
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">X 轴</span>
            <select
              value={card.xColumn}
              onChange={(event) => onChange({ xColumn: event.target.value })}
            >
              {csv.headers.map((header) => (
                <option key={header} value={header}>{header}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Y 轴</span>
            <select
              value={card.yColumn ?? ''}
              onChange={(event) => onChange({ yColumn: event.target.value || null })}
            >
              <option value="">请选择数值列</option>
              {numericOptions.map((header) => (
                <option key={header} value={header}>{header}</option>
              ))}
            </select>
          </label>

          {card.kind !== 'stats' && (
            <>
              <label className="field">
                <span className="field-label">颜色</span>
                <input
                  type="color"
                  value={card.color}
                  onChange={(event) => onChange({ color: event.target.value })}
                />
              </label>

              <label className="field">
                <span className="field-label">线宽</span>
                <input
                  type="number"
                  min="1"
                  max="6"
                  value={card.lineWidth}
                  onChange={(event) => onChange({ lineWidth: Number(event.target.value) || 1 })}
                />
              </label>

              {card.kind === 'line' && (
                <label className="field">
                  <span className="field-label">折线模式</span>
                  <select
                    value={card.drawMode}
                    onChange={(event) => onChange({ drawMode: event.target.value as ChartCardConfig['drawMode'] })}
                  >
                    <option value="lines">折线</option>
                    <option value="lines+markers">折线+点</option>
                    <option value="markers">仅点</option>
                  </select>
                </label>
              )}
            </>
          )}
        </div>

        {card.kind === 'stats' && summary && (
          <div className="stats-grid">
            <div className="stat-tile">
              <div className="stat-label">非空值</div>
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
          <PlotCanvas
            data={plotData}
            layout={{
              xaxis: { title: { text: card.xColumn }, automargin: true },
              yaxis: {
                title: { text: card.yColumn ?? '' },
                automargin: true,
                range:
                  card.yMin !== null && card.yMax !== null && card.yMin < card.yMax
                    ? [card.yMin, card.yMax]
                    : undefined,
              },
              showlegend: false,
            }}
          />
        )}

        {card.kind !== 'stats' && !canPlot && (
          <div className="placeholder">
            当前图卡还没有可绘制的数值列。
            <br />
            请先选择一个数值型 Y 轴字段。
          </div>
        )}
      </div>
    </article>
  )
}
