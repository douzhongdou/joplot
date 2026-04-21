import type { ChartCard, CsvData } from '../types'

interface Props {
  card: ChartCard | null
  csv: CsvData
  onChange: (patch: Partial<ChartCard>) => void
  onDuplicate: () => void
  onRemove: () => void
}

const KIND_OPTIONS: Array<{ value: ChartCard['kind']; label: string }> = [
  { value: 'line', label: '折线图' },
  { value: 'scatter', label: '散点图' },
  { value: 'bar', label: '柱状图' },
  { value: 'stats', label: '统计卡' },
]

export function CardInspector({ card, csv, onChange, onDuplicate, onRemove }: Props) {
  if (!card) {
    return (
      <section className="sidebar-panel">
        <div className="sidebar-panel-header">
          <div>
            <p className="sidebar-kicker">Inspector</p>
            <h2>图卡配置</h2>
          </div>
        </div>
        <div className="sidebar-empty">选择一张图卡后，在这里编辑标题、坐标字段和样式。</div>
      </section>
    )
  }

  const numericOptions = csv.numericColumns

  return (
    <section className="sidebar-panel">
      <div className="sidebar-panel-header">
        <div>
          <p className="sidebar-kicker">Inspector</p>
          <h2>图卡配置</h2>
        </div>
        <div className="sidebar-inline-actions">
          <button type="button" className="ghost-button" onClick={onDuplicate}>复制</button>
          <button type="button" className="ghost-button danger-button" onClick={onRemove}>删除</button>
        </div>
      </div>

      <div className="inspector-form">
        <label className="sidebar-field">
          <span>标题</span>
          <input
            type="text"
            value={card.title}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </label>

        <label className="sidebar-field">
          <span>类型</span>
          <select
            value={card.kind}
            onChange={(event) => onChange({ kind: event.target.value as ChartCard['kind'] })}
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="sidebar-field">
          <span>X 轴</span>
          <select
            value={card.xColumn}
            onChange={(event) => onChange({ xColumn: event.target.value })}
          >
            {csv.headers.map((header) => (
              <option key={header} value={header}>{header}</option>
            ))}
          </select>
        </label>

        <label className="sidebar-field">
          <span>Y 轴</span>
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
            <label className="sidebar-field">
              <span>颜色</span>
              <input
                type="color"
                value={card.color}
                onChange={(event) => onChange({ color: event.target.value })}
              />
            </label>

            <label className="sidebar-field">
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
              <label className="sidebar-field">
                <span>绘制方式</span>
                <select
                  value={card.drawMode}
                  onChange={(event) => onChange({ drawMode: event.target.value as ChartCard['drawMode'] })}
                >
                  <option value="lines">折线</option>
                  <option value="lines+markers">线 + 点</option>
                  <option value="markers">仅点</option>
                </select>
              </label>
            )}
          </>
        )}
      </div>
    </section>
  )
}
