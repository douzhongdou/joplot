import type { ChartKind, CsvData } from '../types'

interface Props {
  csv: CsvData
  filteredCount: number
  onAdd: (kind: ChartKind) => void
}

const OPTIONS: Array<{ kind: ChartKind; label: string }> = [
  { kind: 'line', label: '新增折线图' },
  { kind: 'scatter', label: '新增散点图' },
  { kind: 'bar', label: '新增柱状图' },
  { kind: 'stats', label: '新增统计卡' },
]

export function WorkbenchToolbar({ csv, filteredCount, onAdd }: Props) {
  return (
    <section className="sidebar-panel">
      <div className="sidebar-panel-header">
        <div>
          <p className="sidebar-kicker">Workspace</p>
          <h2>工作台</h2>
        </div>
      </div>

      <div className="summary-grid">
        <div className="summary-card">
          <span>数据量</span>
          <strong>{csv.rowCount.toLocaleString()}</strong>
        </div>
        <div className="summary-card">
          <span>筛选后</span>
          <strong>{filteredCount.toLocaleString()}</strong>
        </div>
        <div className="summary-card">
          <span>字段</span>
          <strong>{csv.headers.length}</strong>
        </div>
        <div className="summary-card">
          <span>数值列</span>
          <strong>{csv.numericColumns.length}</strong>
        </div>
      </div>

      <div className="sidebar-actions">
        {OPTIONS.map((option) => (
          <button key={option.kind} type="button" className="ghost-button" onClick={() => onAdd(option.kind)}>
            {option.label}
          </button>
        ))}
      </div>
    </section>
  )
}
