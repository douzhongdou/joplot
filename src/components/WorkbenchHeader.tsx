import { useMemo, useState } from 'react'
import {
  BadgeInfo,
  ChartColumn,
  ChartLine,
  ChartScatter,
  ChevronDown,
  Filter,
  LayoutDashboard,
  Palette,
  Plus,
} from 'lucide-react'
import type { ChartKind, CsvData, FilterJoinOperator, FilterOperator, FilterRule } from '../types'

interface Props {
  datasets: CsvData[]
  activeDatasetId: string | null
  datasetGroupCount: number
  filteredCount: number
  filters: FilterRule[]
  filterJoinOperator: FilterJoinOperator
  onSelectDataset: (datasetId: string) => void
  onAddComponent: (kind: ChartKind) => void
  onAddFilter: () => void
  onChangeFilterJoinOperator: (operator: FilterJoinOperator) => void
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

const actionButtonClass = 'inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-4 text-sm font-semibold text-base-content transition hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:pointer-events-none disabled:border-base-300 disabled:bg-base-200 disabled:text-base-content/40'
const primaryActionButtonClass = 'inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-box)] border border-primary/15 bg-primary/10 px-4 text-sm font-semibold text-primary transition hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25'
const shellClass = 'flex h-12 min-w-0 items-center rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-4 text-sm text-base-content shadow-sm'
const selectClass = 'w-full min-w-0 appearance-none bg-transparent pr-8 text-base font-medium outline-none'
const selectIconClass = 'pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-base-content/55'
const inputClass = 'h-12 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-4 text-sm text-base-content outline-none transition placeholder:text-base-content/40 focus:border-primary/35 focus:ring-2 focus:ring-primary/20'

export function WorkbenchHeader({
  datasets,
  activeDatasetId,
  datasetGroupCount,
  filteredCount,
  filters,
  filterJoinOperator,
  onSelectDataset,
  onAddComponent,
  onAddFilter,
  onChangeFilterJoinOperator,
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
    <section className="sticky top-0 z-10 grid gap-5 border-b border-base-300 bg-base-100/95 px-5 py-4 backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="inline-grid size-10 place-items-center rounded-[var(--radius-box)] bg-neutral text-neutral-content shadow-sm">
            <LayoutDashboard size={18} strokeWidth={2.1} />
          </span>
          <div className="grid gap-0.5">
            <strong className="text-xl font-semibold tracking-tight text-base-content">仪表盘</strong>
            <span className="text-sm text-base-content/60">当前工作台的图表与筛选配置</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <button
              type="button"
              className={primaryActionButtonClass}
              onClick={() => setShowAddMenu((value) => !value)}
            >
              <Plus size={16} strokeWidth={2.2} />
              添加组件
            </button>

            {showAddMenu && (
              <div className="absolute right-0 top-[calc(100%+0.625rem)] z-20 grid min-w-40 gap-1 rounded-[calc(var(--radius-box)+0.25rem)] border border-base-300 bg-base-100 p-2 shadow-xl">
                {COMPONENT_OPTIONS.map((option) => {
                  const Icon = option.icon

                  return (
                    <button
                      key={option.kind}
                      type="button"
                      className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-field)] px-3 text-left text-sm text-base-content transition hover:bg-base-200"
                      onClick={() => {
                        onAddComponent(option.kind)
                        setShowAddMenu(false)
                      }}
                    >
                      <span className="inline-grid size-7 place-items-center rounded-[var(--radius-field)] bg-base-200 text-base-content/65">
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
            className={showFilters ? primaryActionButtonClass : actionButtonClass}
            onClick={() => setShowFilters((value) => !value)}
          >
            <Filter size={16} strokeWidth={2.1} />
            筛选
          </button>

          <button type="button" className={actionButtonClass} disabled>
            <Palette size={16} strokeWidth={2.1} />
            主题
          </button>
        </div>
      </div>

      {activeDataset && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_180px_180px]">
          <label className="grid gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-base-content/55">焦点数据集</span>
            <div className={shellClass}>
              <div className="relative w-full min-w-0">
                <select value={activeDataset.id} onChange={(event) => onSelectDataset(event.target.value)} className={selectClass}>
                  {datasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>{dataset.fileName}</option>
                  ))}
                </select>
                <ChevronDown size={16} strokeWidth={2.1} className={selectIconClass} />
              </div>
            </div>
          </label>

          <div className="grid gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-base-content/55">当前组</span>
            <div className={shellClass}>
              <strong className="text-base font-semibold text-base-content">{datasetGroupCount} 份 CSV</strong>
            </div>
          </div>

          <div className="grid gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-base-content/55">范围</span>
            <div className={shellClass}>
              <strong className="text-base font-semibold text-base-content">
                {filteredCount.toLocaleString()} / {activeDataset.rowCount.toLocaleString()}
              </strong>
            </div>
          </div>
        </div>
      )}

      {showFilters && activeDataset && (
        <div className="grid gap-4 rounded-[calc(var(--radius-box)+0.25rem)] border border-base-300 bg-base-200/65 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <strong className="text-lg font-semibold text-base-content">筛选条件</strong>
              <span className="text-sm text-base-content/60">当前工作台中的所有 CSV 共享这一组筛选逻辑</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-1 shadow-sm">
                <button
                  type="button"
                  className={`inline-flex h-9 items-center rounded-[calc(var(--radius-field)-2px)] px-3 text-sm font-medium transition ${
                    filterJoinOperator === 'and'
                      ? 'bg-primary text-primary-content shadow-sm'
                      : 'text-base-content/65 hover:bg-base-200'
                  }`}
                  onClick={() => onChangeFilterJoinOperator('and')}
                >
                  全与
                </button>
                <button
                  type="button"
                  className={`inline-flex h-9 items-center rounded-[calc(var(--radius-field)-2px)] px-3 text-sm font-medium transition ${
                    filterJoinOperator === 'or'
                      ? 'bg-primary text-primary-content shadow-sm'
                      : 'text-base-content/65 hover:bg-base-200'
                  }`}
                  onClick={() => onChangeFilterJoinOperator('or')}
                >
                  全或
                </button>
              </div>

              <button type="button" className={primaryActionButtonClass} onClick={onAddFilter}>
                <Plus size={16} strokeWidth={2.2} />
                新增条件
              </button>
            </div>
          </div>

          {filters.length === 0 && (
            <div className="rounded-[var(--radius-box)] border border-dashed border-base-300 bg-base-100/80 px-4 py-5 text-sm text-base-content/55">
              当前没有筛选条件。
            </div>
          )}

          {filters.length > 0 && (
            <div className="grid gap-3">
              {filters.map((filter) => {
                const isBetween = filter.operator === 'between'

                return (
                  <div
                    key={filter.id}
                    className="grid gap-3 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-3 shadow-sm lg:grid-cols-[minmax(180px,1fr)_150px_minmax(200px,1fr)_minmax(200px,1fr)_92px]"
                  >
                    <div className={shellClass}>
                      <div className="relative w-full min-w-0">
                        <select
                          value={filter.column}
                          onChange={(event) => onChangeFilter(filter.id, { column: event.target.value })}
                          className={selectClass}
                        >
                          {activeDataset.headers.map((header) => (
                            <option key={header} value={header}>{header}</option>
                          ))}
                        </select>
                        <ChevronDown size={16} strokeWidth={2.1} className={selectIconClass} />
                      </div>
                    </div>

                    <div className={shellClass}>
                      <div className="relative w-full min-w-0">
                        <select
                          value={filter.operator}
                          onChange={(event) => onChangeFilter(filter.id, { operator: event.target.value as FilterOperator })}
                          className={selectClass}
                        >
                          {OPERATORS.map((operator) => (
                            <option key={operator.value} value={operator.value}>{operator.label}</option>
                          ))}
                        </select>
                        <ChevronDown size={16} strokeWidth={2.1} className={selectIconClass} />
                      </div>
                    </div>

                    <input
                      type="text"
                      value={filter.value}
                      placeholder={isBetween ? '起始值' : '筛选值'}
                      onChange={(event) => onChangeFilter(filter.id, { value: event.target.value })}
                      className={inputClass}
                    />

                    {isBetween ? (
                      <input
                        type="text"
                        value={filter.valueTo ?? ''}
                        placeholder="结束值"
                        onChange={(event) => onChangeFilter(filter.id, { valueTo: event.target.value })}
                        className={inputClass}
                      />
                    ) : (
                      <div className="hidden lg:block" />
                    )}

                    <button
                      type="button"
                      className="inline-flex h-12 items-center justify-center rounded-[var(--radius-box)] border border-error/20 bg-error/10 px-4 text-sm font-medium text-error transition hover:bg-error/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/20"
                      onClick={() => onRemoveFilter(filter.id)}
                    >
                      删除
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
