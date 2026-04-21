import type { ChartKind, CsvData } from '../types'

interface Props {
  csv: CsvData
  filteredCount: number
  filterCount: number
  filtersOpen: boolean
  onAdd: (kind: ChartKind) => void
  onToggleFilters: () => void
}

const OPTIONS: Array<{ kind: ChartKind; label: string }> = [
  { kind: 'line', label: '折线图' },
  { kind: 'scatter', label: '散点图' },
  { kind: 'bar', label: '柱状图' },
  { kind: 'stats', label: '统计卡' },
]

export function WorkbenchToolbar({
  csv,
  filteredCount,
  filterCount,
  filtersOpen,
  onAdd,
  onToggleFilters,
}: Props) {
  return (
    <section className="workbench-toolbar">
      <div className="workbench-summary">
        <div className="summary-chip">
          <span className="summary-chip-label">数据量</span>
          <strong>{csv.rowCount.toLocaleString()}</strong>
        </div>
        <div className="summary-chip">
          <span className="summary-chip-label">筛选后</span>
          <strong>{filteredCount.toLocaleString()}</strong>
        </div>
        <div className="summary-chip">
          <span className="summary-chip-label">字段</span>
          <strong>{csv.headers.length}</strong>
        </div>
        <div className="summary-chip">
          <span className="summary-chip-label">数值列</span>
          <strong>{csv.numericColumns.length}</strong>
        </div>
      </div>

      <div className="toolbar-actions">
        <button type="button" className="secondary-button" onClick={onToggleFilters}>
          {filtersOpen ? '收起筛选' : `筛选${filterCount > 0 ? ` (${filterCount})` : ''}`}
        </button>
        {OPTIONS.map((option) => (
          <button key={option.kind} type="button" className="ghost-button" onClick={() => onAdd(option.kind)}>
            新增{option.label}
          </button>
        ))}
      </div>
    </section>
  )
}
