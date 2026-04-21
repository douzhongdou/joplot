import type { FilterOperator, FilterRule } from '../types'

interface Props {
  headers: string[]
  filters: FilterRule[]
  onAdd: () => void
  onChange: (filterId: string, patch: Partial<FilterRule>) => void
  onRemove: (filterId: string) => void
}

const OPERATORS: Array<{ value: FilterOperator; label: string }> = [
  { value: 'contains', label: '包含' },
  { value: 'equals', label: '等于' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
  { value: 'between', label: '区间' },
]

export function FilterBar({ headers, filters, onAdd, onChange, onRemove }: Props) {
  return (
    <section className="sidebar-panel">
      <div className="sidebar-panel-header">
        <div>
          <p className="sidebar-kicker">Filter</p>
          <h2>全局筛选</h2>
        </div>
        <button type="button" className="secondary-button" onClick={onAdd}>
          新增条件
        </button>
      </div>

      {filters.length === 0 && (
        <div className="sidebar-empty">当前没有筛选条件，所有图卡都读取完整数据集。</div>
      )}

      <div className="sidebar-filter-list">
        {filters.map((filter) => {
          const isBetween = filter.operator === 'between'

          return (
            <div key={filter.id} className="sidebar-filter-card">
              <select
                value={filter.column}
                onChange={(event) => onChange(filter.id, { column: event.target.value })}
              >
                {headers.map((header) => (
                  <option key={header} value={header}>{header}</option>
                ))}
              </select>

              <select
                value={filter.operator}
                onChange={(event) => onChange(filter.id, { operator: event.target.value as FilterOperator })}
              >
                {OPERATORS.map((operator) => (
                  <option key={operator.value} value={operator.value}>{operator.label}</option>
                ))}
              </select>

              <input
                type="text"
                value={filter.value}
                placeholder={isBetween ? '起始值' : '筛选值'}
                onChange={(event) => onChange(filter.id, { value: event.target.value })}
              />

              {isBetween && (
                <input
                  type="text"
                  value={filter.valueTo ?? ''}
                  placeholder="结束值"
                  onChange={(event) => onChange(filter.id, { valueTo: event.target.value })}
                />
              )}

              <button type="button" className="ghost-button" onClick={() => onRemove(filter.id)}>
                删除
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
