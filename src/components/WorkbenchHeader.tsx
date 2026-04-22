import { useMemo, useState } from 'react'
import {
  BadgeInfo,
  ChartColumn,
  ChartLine,
  ChartScatter,
  ChevronDown,
  Filter,
  LayoutDashboard,
  ListFilter,
  Palette,
  Plus,
} from 'lucide-react'
import type { ChartKind, CsvData, FilterOperator, FilterRule } from '../types'

interface Props {
  datasets: CsvData[]
  activeDatasetId: string | null
  datasetGroupCount: number
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

const COMPONENT_OPTIONS: Array<{ kind: ChartKind; label: string; icon: typeof ChartLine }> = [
  { kind: 'line', label: '折线图', icon: ChartLine },
  { kind: 'scatter', label: '散点图', icon: ChartScatter },
  { kind: 'bar', label: '柱状图', icon: ChartColumn },
  { kind: 'stats', label: '统计卡', icon: BadgeInfo },
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
  datasetGroupCount,
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
          <span className="workspace-toolbar-badge" aria-hidden="true">
            <LayoutDashboard size={14} strokeWidth={2.2} />
          </span>
          <strong>仪表盘</strong>
        </div>

        <div className="workspace-toolbar-actions">
          <div className="toolbar-menu">
            <button
              type="button"
              className="workspace-primary-button"
              onClick={() => setShowAddMenu((value) => !value)}
            >
              <Plus size={16} strokeWidth={2.2} />
              添加组件
            </button>

            {showAddMenu && (
              <div className="toolbar-popover">
                {COMPONENT_OPTIONS.map((option) => {
                  const Icon = option.icon

                  return (
                    <button
                      key={option.kind}
                      type="button"
                      className="toolbar-popover-item"
                      onClick={() => {
                        onAddComponent(option.kind)
                        setShowAddMenu(false)
                      }}
                    >
                      <span className="toolbar-popover-icon" aria-hidden="true">
                        <Icon size={15} strokeWidth={2.1} />
                      </span>
                      {option.label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            className={`workspace-secondary-button ${showFilters ? 'workspace-secondary-button-active' : ''}`}
            onClick={() => setShowFilters((value) => !value)}
          >
            <Filter size={15} strokeWidth={2.1} />
            筛选
          </button>

          <button type="button" className="workspace-secondary-button" disabled>
            <Palette size={15} strokeWidth={2.1} />
            主题
          </button>
        </div>
      </div>

      {activeDataset && (
        <div className="workspace-context">
          <label className="workspace-context-pill workspace-context-pill-select h-12">           
            <div className="workspace-select-shell">
              <select value={activeDataset.id} onChange={(event) => onSelectDataset(event.target.value)}>
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>{dataset.fileName}</option>
                ))}
              </select>
              <ChevronDown size={14} strokeWidth={2.2} className="workspace-select-icon" />
            </div>
          </label>

          <div className="workspace-context-pill  h-12">
            <span>当前组</span>
            <strong>{datasetGroupCount} 份 CSV</strong>
          </div>

          <div className="workspace-context-pill  h-12">
            <span>范围</span>
            <strong>{filteredCount.toLocaleString()} / {activeDataset.rowCount.toLocaleString()}</strong>
          </div>

          {filters.map((filter) => (
            <div key={filter.id} className="workspace-filter-chip">
              {formatFilter(filter)}
            </div>
          ))}
        </div>
      )}

      {showFilters && activeDataset && (
        <div className="workspace-filter-panel">
          <div className="workspace-filter-panel-head">
            <strong>筛选条件</strong>
            <button type="button" className="workspace-primary-button workspace-primary-button-compact" onClick={onAddFilter}>
              <Plus size={15} strokeWidth={2.2} />
              新增条件
            </button>
          </div>

          {filters.length === 0 && (
            <div className="workspace-filter-empty">当前没有筛选条件。</div>
          )}

          {filters.map((filter) => {
            const isBetween = filter.operator === 'between'

            return (
              <div key={filter.id} className="workspace-filter-row">
                <div className="workspace-select-shell">
                  <select
                    value={filter.column}
                    onChange={(event) => onChangeFilter(filter.id, { column: event.target.value })}
                  >
                    {activeDataset.headers.map((header) => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} strokeWidth={2.2} className="workspace-select-icon" />
                </div>

                <div className="workspace-select-shell">
                  <select
                    value={filter.operator}
                    onChange={(event) => onChangeFilter(filter.id, { operator: event.target.value as FilterOperator })}
                  >
                    {OPERATORS.map((operator) => (
                      <option key={operator.value} value={operator.value}>{operator.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} strokeWidth={2.2} className="workspace-select-icon" />
                </div>

                <input
                  type="text"
                  value={filter.value}
                  placeholder={isBetween ? '起始值' : '筛选值'}
                  onChange={(event) => onChangeFilter(filter.id, { value: event.target.value })}
                />

                {isBetween ? (
                  <input
                    type="text"
                    value={filter.valueTo ?? ''}
                    placeholder="结束值"
                    onChange={(event) => onChangeFilter(filter.id, { valueTo: event.target.value })}
                  />
                ) : (
                  <div />
                )}

                <button type="button" className="workspace-filter-remove" onClick={() => onRemoveFilter(filter.id)}>
                  删除
                </button>
              </div>
            )
          })}
        </div>
      )}

      {!showFilters && filters.length > 0 && (
        <div className="workspace-filter-summary">
          <ListFilter size={14} strokeWidth={2.1} />
          <span>{filters.length} 条筛选条件已生效</span>
        </div>
      )}
    </section>
  )
}
