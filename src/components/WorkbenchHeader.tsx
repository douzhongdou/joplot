import { useMemo, useState } from 'react'
import type { ChartKind, CsvData, FilterOperator, FilterRule } from '../types'

interface Props {
  datasets: CsvData[]
  activeDatasetId: string | null
  filteredCount: number
  filters: FilterRule[]
  onSelectDataset: (datasetId: string) => void
  onAddComponent: (kind: ChartKind) => void
  onAddFilter: () => void
  onChangeFilter: (filterId: string, patch: Partial<FilterRule>) => void
  onRemoveFilter: (filterId: string) => void
}

const OPERATORS: Array<{ value: FilterOperator; label: string }> = [
  { value: 'contains', label: '包含' },
  { value: 'equals', label: '等于' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
  { value: 'between', label: '区间' },
]

const COMPONENT_OPTIONS: Array<{ kind: ChartKind; label: string; icon: string }> = [
  { kind: 'line', label: '折线图', icon: '折' },
  { kind: 'scatter', label: '散点图', icon: '散' },
  { kind: 'bar', label: '柱状图', icon: '柱' },
  { kind: 'stats', label: '统计卡', icon: '统' },
]

function formatFilter(filter: FilterRule) {
  switch (filter.operator) {
    case 'contains':
      return `${filter.column} 包含 ${filter.value || '…'}`
    case 'equals':
      return `${filter.column} = ${filter.value || '…'}`
    case 'gt':
      return `${filter.column} > ${filter.value || '…'}`
    case 'lt':
      return `${filter.column} < ${filter.value || '…'}`
    case 'between':
      return `${filter.column} ${filter.value || '…'} ~ ${filter.valueTo || '…'}`
    default:
      return filter.column
  }
}

export function WorkbenchHeader({
  datasets,
  activeDatasetId,
  filteredCount,
  filters,
  onSelectDataset,
  onAddComponent,
  onAddFilter,
  onChangeFilter,
  onRemoveFilter,
}: Props) {
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const activeDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === activeDatasetId) ?? datasets[0] ?? null,
    [activeDatasetId, datasets],
  )

  return (
    <section className="workspace-header">
      <div className="workspace-toolbar">
        <div className="workspace-toolbar-title">
          <span className="workspace-toolbar-badge">◔</span>
          <strong>仪表盘</strong>
        </div>

        <div className="workspace-toolbar-actions">
          <div className="toolbar-menu">
            <button
              type="button"
              className="workspace-primary-button"
              onClick={() => setShowAddMenu((value) => !value)}
            >
              + 添加组件
            </button>

            {showAddMenu && (
              <div className="toolbar-popover">
                {COMPONENT_OPTIONS.map((option) => (
                  <button
                    key={option.kind}
                    type="button"
                    className="toolbar-popover-item"
                    onClick={() => {
                      onAddComponent(option.kind)
                      setShowAddMenu(false)
                    }}
                  >
                    <span className="toolbar-popover-icon">{option.icon}</span>
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className={`workspace-secondary-button ${showFilters ? 'workspace-secondary-button-active' : ''}`}
            onClick={() => setShowFilters((value) => !value)}
          >
            筛选
          </button>

          <button type="button" className="workspace-secondary-button" disabled>
            主题
          </button>
        </div>
      </div>

      {activeDataset && (
        <div className="workspace-context">
          <label className="workspace-context-pill">
            <span>数据源</span>
            <select value={activeDataset.id} onChange={(event) => onSelectDataset(event.target.value)}>
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>{dataset.fileName}</option>
              ))}
            </select>
          </label>

          <div className="workspace-context-pill">
            <span>范围</span>
            <strong>{filteredCount.toLocaleString()} / {activeDataset.rowCount.toLocaleString()}</strong>
          </div>

          {filters.map((filter) => (
            <div key={filter.id} className="workspace-filter-chip">
              {formatFilter(filter)}
            </div>
          ))}

          <button type="button" className="workspace-chip-add" onClick={onAddFilter} aria-label="新增筛选条件">
            +
          </button>
        </div>
      )}

      {showFilters && activeDataset && (
        <div className="workspace-filter-panel">
          {filters.length === 0 && (
            <div className="workspace-filter-empty">当前没有筛选条件。</div>
          )}

          {filters.map((filter) => {
            const isBetween = filter.operator === 'between'

            return (
              <div key={filter.id} className="workspace-filter-row">
                <select
                  value={filter.column}
                  onChange={(event) => onChangeFilter(filter.id, { column: event.target.value })}
                >
                  {activeDataset.headers.map((header) => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </select>

                <select
                  value={filter.operator}
                  onChange={(event) => onChangeFilter(filter.id, { operator: event.target.value as FilterOperator })}
                >
                  {OPERATORS.map((operator) => (
                    <option key={operator.value} value={operator.value}>{operator.label}</option>
                  ))}
                </select>

                <input
                  type="text"
                  value={filter.value}
                  placeholder={isBetween ? '起始值' : '筛选值'}
                  onChange={(event) => onChangeFilter(filter.id, { value: event.target.value })}
                />

                {isBetween && (
                  <input
                    type="text"
                    value={filter.valueTo ?? ''}
                    placeholder="结束值"
                    onChange={(event) => onChangeFilter(filter.id, { valueTo: event.target.value })}
                  />
                )}

                <button type="button" className="workspace-filter-remove" onClick={() => onRemoveFilter(filter.id)}>
                  删除
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
