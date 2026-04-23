import { useMemo, useState } from 'react'
import {
  BadgeInfo,
  ChartColumn,
  ChartLine,
  ChartScatter,
  Filter,
  Palette,
  Plus,
  RotateCcw,
} from 'lucide-react'
import type { ChartKind, CsvData, FilterJoinOperator, FilterOperator, FilterRule } from '../types'
import { FileUploader } from './FileUploader'
import { SelectMenu } from './SelectMenu'
import { useI18n } from '../i18n'

interface Props {
  datasets: CsvData[]
  activeDatasetId: string | null
  filters: FilterRule[]
  filterJoinOperator: FilterJoinOperator
  onAddComponent: (kind: ChartKind) => void
  onUploadFiles: (files: File[]) => void | Promise<void>
  onResetDatasets: () => void
  onAddFilter: () => void
  onChangeFilterJoinOperator: (operator: FilterJoinOperator) => void
  onChangeFilter: (filterId: string, patch: Partial<FilterRule>) => void
  onRemoveFilter: (filterId: string) => void
}

const actionButtonClass = 'inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-box)] border-0 bg-transparent px-4 text-sm font-semibold text-base-content transition hover:bg-primary/8 hover:text-primary focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:text-base-content/40'
const primaryActionButtonClass = 'inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-box)] border-0 bg-transparent px-4 text-sm font-semibold text-primary transition hover:bg-primary/8 focus-visible:outline-none focus-visible:ring-0'
const shellClass = 'flex h-12 min-w-0 items-center rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-4 text-sm text-base-content'
const inputClass = 'h-12 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-4 text-sm text-base-content outline-none transition placeholder:text-base-content/40 focus:border-primary/35 focus:ring-2 focus:ring-primary/20'
const ghostSelectTriggerClass = 'h-auto border-0 bg-transparent px-0 py-0 shadow-none hover:bg-transparent focus-visible:ring-0'

export function WorkbenchHeader({
  datasets,
  activeDatasetId,
  filters,
  filterJoinOperator,
  onAddComponent,
  onUploadFiles,
  onResetDatasets,
  onAddFilter,
  onChangeFilterJoinOperator,
  onChangeFilter,
  onRemoveFilter,
}: Props) {
  const { t } = useI18n()
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const activeDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === activeDatasetId) ?? datasets[0] ?? null,
    [activeDatasetId, datasets],
  )

  const operators: Array<{ value: FilterOperator; label: string }> = [
    { value: 'contains', label: t('filterOperators.contains') },
    { value: 'equals', label: t('filterOperators.equals') },
    { value: 'gt', label: t('filterOperators.gt') },
    { value: 'lt', label: t('filterOperators.lt') },
    { value: 'between', label: t('filterOperators.between') },
  ]

  const componentOptions: Array<{ kind: ChartKind; label: string; icon: typeof ChartLine }> = [
    { kind: 'line', label: t('chartKinds.line'), icon: ChartLine },
    { kind: 'scatter', label: t('chartKinds.scatter'), icon: ChartScatter },
    { kind: 'bar', label: t('chartKinds.bar'), icon: ChartColumn },
    { kind: 'stats', label: t('chartKinds.stats'), icon: BadgeInfo },
  ]

  return (
    <section className="sticky top-0 z-10 grid gap-5 border-b border-base-300 bg-base-100/95 px-5 py-4 backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <FileUploader
            hasDatasets
            onFiles={onUploadFiles}
            buttonClassName={actionButtonClass}
          />

          <div className="relative">
            <button
              type="button"
              className={primaryActionButtonClass}
              onClick={() => setShowAddMenu((value) => !value)}
            >
              <Plus size={16} strokeWidth={2.2} />
              {t('workbench.addComponent')}
            </button>

            {showAddMenu && (
              <div className="absolute right-0 top-[calc(100%+0.625rem)] z-20 grid min-w-40 gap-1 rounded-[calc(var(--radius-box)+0.25rem)] border border-base-300 bg-base-100 p-2">
                {componentOptions.map((option) => {
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
            {t('workbench.filters')}
          </button>

          <button type="button" className={actionButtonClass} disabled>
            <Palette size={16} strokeWidth={2.1} />
            {t('workbench.theme')}
          </button>

          <button type="button" className={actionButtonClass} onClick={onResetDatasets}>
            <RotateCcw size={16} strokeWidth={2.1} />
            {t('workbench.resetData')}
          </button>
        </div>
      </div>

      {showFilters && activeDataset && (
        <div className="grid gap-4 rounded-[calc(var(--radius-box)+0.25rem)] border border-base-300 bg-base-200/65 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <strong className="text-lg font-semibold text-base-content">{t('workbench.filtersTitle')}</strong>
              <span className="text-sm text-base-content/60">{t('workbench.filtersDescription')}</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-1">
                <button
                  type="button"
                  className={`inline-flex h-9 items-center rounded-[calc(var(--radius-field)-2px)] px-3 text-sm font-medium transition ${
                    filterJoinOperator === 'and'
                      ? 'bg-primary text-primary-content'
                      : 'text-base-content/65 hover:bg-base-200'
                  }`}
                  onClick={() => onChangeFilterJoinOperator('and')}
                >
                  {t('workbench.joinAnd')}
                </button>
                <button
                  type="button"
                  className={`inline-flex h-9 items-center rounded-[calc(var(--radius-field)-2px)] px-3 text-sm font-medium transition ${
                    filterJoinOperator === 'or'
                      ? 'bg-primary text-primary-content'
                      : 'text-base-content/65 hover:bg-base-200'
                  }`}
                  onClick={() => onChangeFilterJoinOperator('or')}
                >
                  {t('workbench.joinOr')}
                </button>
              </div>

              <button type="button" className={primaryActionButtonClass} onClick={onAddFilter}>
                <Plus size={16} strokeWidth={2.2} />
                {t('workbench.addCondition')}
              </button>
            </div>
          </div>

          {filters.length === 0 && (
            <div className="rounded-[var(--radius-box)] border border-dashed border-base-300 bg-base-100/80 px-4 py-5 text-sm text-base-content/55">
              {t('workbench.noFilters')}
            </div>
          )}

          {filters.length > 0 && (
            <div className="grid gap-3">
              {filters.map((filter) => {
                const isBetween = filter.operator === 'between'

                return (
                  <div
                    key={filter.id}
                    className="grid gap-3 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-3 lg:grid-cols-[minmax(180px,1fr)_150px_minmax(200px,1fr)_minmax(200px,1fr)_92px]"
                  >
                    <div className={shellClass}>
                      <SelectMenu
                        value={filter.column}
                        options={activeDataset.headers.map((header) => ({
                          value: header,
                          label: header,
                        }))}
                        onChange={(value) => onChangeFilter(filter.id, { column: value })}
                        buttonClassName={ghostSelectTriggerClass}
                      />
                    </div>

                    <div className={shellClass}>
                      <SelectMenu
                        value={filter.operator}
                        options={operators}
                        onChange={(value) => onChangeFilter(filter.id, { operator: value })}
                        buttonClassName={ghostSelectTriggerClass}
                      />
                    </div>

                    <input
                      type="text"
                      value={filter.value}
                      placeholder={isBetween ? t('workbench.startValuePlaceholder') : t('workbench.valuePlaceholder')}
                      onChange={(event) => onChangeFilter(filter.id, { value: event.target.value })}
                      className={inputClass}
                    />

                    {isBetween ? (
                      <input
                        type="text"
                        value={filter.valueTo ?? ''}
                        placeholder={t('workbench.endValuePlaceholder')}
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
                      {t('workbench.removeFilter')}
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
