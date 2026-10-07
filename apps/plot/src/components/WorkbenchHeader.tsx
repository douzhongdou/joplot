import { useMemo, useState } from 'react'
import {
  BadgeInfo,
  ChartArea,
  ChartColumn,
  ChartLine,
  ChartPie,
  ChartScatter,
  Filter,
  Grid3X3,
  Plus,
  Radar,
  RotateCcw,
} from 'lucide-react'
import type { TrackingInputMethod } from '../lib/analytics'
import type { ChartKind, CsvData, FilterJoinOperator, FilterOperator, FilterRule } from '../types'
import { FileUploader } from './FileUploader'
import { SelectMenu } from './SelectMenu'
import { Button } from '@joplot/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@joplot/ui/dropdown-menu'
import { useI18n } from '../i18n'

interface Props {
  datasets: CsvData[]
  activeDatasetId: string | null
  filters: FilterRule[]
  filterJoinOperator: FilterJoinOperator
  mobileSheet?: boolean
  onAddComponent: (kind: ChartKind) => void
  onUploadFiles: (files: File[], inputMethod?: TrackingInputMethod) => void | Promise<unknown>
  onResetDatasets: () => void
  onAddFilter: () => void
  onChangeFilterJoinOperator: (operator: FilterJoinOperator) => void
  onChangeFilter: (filterId: string, patch: Partial<FilterRule>) => void
  onRemoveFilter: (filterId: string) => void
}

const shellClass = 'flex h-12 min-w-0 items-center rounded-[var(--radius-box)] bg-muted px-3 text-sm text-base-content'
const inputClass = 'h-12 w-full rounded-[var(--radius-field)] border-0 bg-muted px-4 text-sm text-base-content outline-none transition placeholder:text-muted-foreground'
const ghostSelectTriggerClass = 'border-0 bg-transparent px-0 py-0 shadow-none hover:bg-transparent'

export function WorkbenchHeader({
  datasets,
  activeDatasetId,
  filters,
  filterJoinOperator,
  mobileSheet = false,
  onAddComponent,
  onUploadFiles,
  onResetDatasets,
  onAddFilter,
  onChangeFilterJoinOperator,
  onChangeFilter,
  onRemoveFilter,
}: Props) {
  const { t } = useI18n()
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
    { kind: 'area', label: t('chartKinds.area'), icon: ChartArea },
    { kind: 'scatter', label: t('chartKinds.scatter'), icon: ChartScatter },
    { kind: 'bar', label: t('chartKinds.bar'), icon: ChartColumn },
    { kind: 'pie', label: t('chartKinds.pie'), icon: ChartPie },
    { kind: 'radar', label: t('chartKinds.radar'), icon: Radar },
    { kind: 'heatmap', label: t('chartKinds.heatmap'), icon: Grid3X3 },
    { kind: 'stats', label: t('chartKinds.stats'), icon: BadgeInfo },
  ]

  return (
    <section className={mobileSheet
      ? 'grid gap-4 bg-base-100 px-5 py-5'
      : 'sticky top-0 z-10 grid gap-5 border-b border-base-300 bg-base-100/95 px-5 py-4 backdrop-blur-xl'}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full flex-wrap items-center gap-2 sm:gap-3">
          <FileUploader
            hasDatasets
            onFiles={onUploadFiles}
            containerClassName={mobileSheet ? 'w-full sm:w-auto' : ''}
            buttonClassName={mobileSheet ? 'w-full sm:w-auto' : 'max-sm:flex-1'}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className={`h-11 rounded-[var(--radius-box)] font-semibold ${mobileSheet ? 'w-full sm:w-auto' : 'max-sm:flex-1'}`}
              >
                <Plus size={16} strokeWidth={2.2} />
                {t('workbench.addComponent')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={mobileSheet ? 'start' : 'end'} className="min-w-44">
              {componentOptions.map((option) => {
                const Icon = option.icon

                return (
                  <DropdownMenuItem key={option.kind} onSelect={() => onAddComponent(option.kind)}>
                    <Icon size={15} strokeWidth={2.1} />
                    {option.label}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant={showFilters ? 'secondary' : 'ghost'}
            aria-expanded={showFilters}
            className={`h-11 rounded-[var(--radius-box)] font-semibold ${mobileSheet ? 'w-full sm:w-auto' : 'max-sm:flex-1'}`}
            onClick={() => setShowFilters((value) => !value)}
          >
            <Filter size={16} strokeWidth={2.1} />
            {t('workbench.filters')}
          </Button>

          <Button
            variant="ghost"
            className={`h-11 rounded-[var(--radius-box)] font-semibold ${mobileSheet ? 'w-full sm:w-auto' : 'max-sm:flex-1'}`}
            onClick={onResetDatasets}
          >
            <RotateCcw size={16} strokeWidth={2.1} />
            {t('workbench.resetData')}
          </Button>
        </div>
      </div>

      {showFilters && activeDataset && (
        <div className="grid gap-4 rounded-[calc(var(--radius-box)+0.25rem)] bg-muted/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <strong className="text-lg font-semibold text-base-content">{t('workbench.filtersTitle')}</strong>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div role="group" aria-label={`${t('workbench.joinAnd')} / ${t('workbench.joinOr')}`} className="inline-flex rounded-[var(--radius-box)] bg-muted p-1">
                <button
                  type="button"
                  aria-pressed={filterJoinOperator === 'and'}
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
                  aria-pressed={filterJoinOperator === 'or'}
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

              <Button className="h-11 rounded-[var(--radius-box)] font-semibold" onClick={onAddFilter}>
                <Plus size={16} strokeWidth={2.2} />
                {t('workbench.addCondition')}
              </Button>
            </div>
          </div>

          {filters.length === 0 && (
            <div className="rounded-[var(--radius-box)] bg-muted/50 px-4 py-5 text-sm text-base-content/55">
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
                    className="grid gap-3 rounded-[var(--radius-box)] bg-background p-3 lg:grid-cols-[minmax(180px,1fr)_150px_minmax(200px,1fr)_minmax(200px,1fr)_92px]"
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
                      aria-label={`${filter.column} ${isBetween ? t('workbench.startValuePlaceholder') : t('workbench.valuePlaceholder')}`}
                      onChange={(event) => onChangeFilter(filter.id, { value: event.target.value })}
                      className={inputClass}
                    />

                    {isBetween ? (
                      <input
                        type="text"
                        value={filter.valueTo ?? ''}
                        placeholder={t('workbench.endValuePlaceholder')}
                        aria-label={`${filter.column} ${t('workbench.endValuePlaceholder')}`}
                        onChange={(event) => onChangeFilter(filter.id, { valueTo: event.target.value })}
                        className={inputClass}
                      />
                    ) : (
                      <div className="hidden lg:block" />
                    )}

                    <Button
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive h-12 rounded-[var(--radius-box)]"
                      onClick={() => onRemoveFilter(filter.id)}
                    >
                      {t('workbench.removeFilter')}
                    </Button>
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
