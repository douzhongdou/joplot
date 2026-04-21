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
    <div className="filter-shell">
      <div className="toolbar">
        <div>
          <h2 className="card-title">全局筛选</h2>
          <div className="card-subtitle">筛选会同步影响所有图卡，但图卡配置本身互不干扰。</div>
        </div>
        <div className="toolbar-actions">
          <button type="button" onClick={onAdd}>新增筛选条件</button>
        </div>
      </div>

      {filters.length === 0 && <div className="card-subtitle">当前没有筛选条件，所有图卡都会读取完整数据集。</div>}

      {filters.map((filter) => {
        const isBetween = filter.operator === 'between'

        return (
          <div
            key={filter.id}
            className={`filter-row ${isBetween ? 'filter-between' : ''}`}
          >
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
              placeholder="值"
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
            <button type="button" className="secondary" onClick={() => onRemove(filter.id)}>
              删除
            </button>
          </div>
        )
      })}
    </div>
  )
}
