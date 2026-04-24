import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  MoreHorizontal,
  Palette,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { ChartCard, ChartSeries, CsvData } from '../types'
import { listAvailableSeriesYColumns, updateAggregationConfig } from '../lib/workbench'
import { SelectMenu } from './SelectMenu'
import { Switch } from './Switch'
import { useI18n } from '../i18n'
import type {
  AggregationConfig,
  AggregationGroupMode,
  AggregationKind,
  AxisValueKind,
  ChartDataMode,
  TimeBucket,
} from '../types'

interface Props {
  card: ChartCard | null
  datasets: CsvData[]
  activeDatasetId: string | null
  onChangeCard: (patch: Partial<ChartCard>) => void
  onAddSeries: (datasetId?: string) => void
  onChangeSeries: (seriesId: string, patch: Partial<ChartSeries>) => void
  onRemoveSeries: (seriesId: string) => void
  onDuplicate: () => void
  onRemove: () => void
}

type InspectorTab = 'base' | 'display'

const fieldLabelClass = 'text-xs font-medium uppercase tracking-[0.12em] text-base-content/55'
const inputClass = 'h-12 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-4 text-sm text-base-content outline-none transition placeholder:text-base-content/40 focus:border-primary/35 focus:ring-2 focus:ring-primary/20'
const iconButtonClass = 'inline-grid size-10 place-items-center rounded-[var(--radius-box)] border-0 bg-transparent text-base-content/60 transition hover:bg-transparent hover:text-primary focus-visible:outline-none focus-visible:ring-0'

const aggregationOptions: AggregationKind[] = [
  'sum',
  'mean',
  'count',
  'max',
  'min',
  'median',
  'distinctCount',
  'missingCount',
  'stddev',
  'variance',
]
const timeBucketOptions: TimeBucket[] = ['day', 'week', 'month', 'quarter', 'year']
const xKindOptions: AxisValueKind[] = ['category', 'number', 'time']
const groupModeOptions: AggregationGroupMode[] = ['file', 'field']

export function CardInspector({
  card,
  datasets,
  activeDatasetId,
  onChangeCard,
  onAddSeries,
  onChangeSeries,
  onRemoveSeries,
  onDuplicate,
  onRemove,
}: Props) {
  const { t, formatNumber } = useI18n()
  const shellRef = useRef<HTMLElement>(null)
  const [activeTab, setActiveTab] = useState<InspectorTab>('base')
  const [openMenuSeriesId, setOpenMenuSeriesId] = useState<string | null>(null)

  const kindOptions: Array<{ value: ChartCard['kind']; label: string }> = [
    { value: 'line', label: t('chartKinds.line') },
    { value: 'scatter', label: t('chartKinds.scatter') },
    { value: 'bar', label: t('chartKinds.bar') },
    { value: 'stats', label: t('chartKinds.stats') },
  ]

  const drawModeOptions: Array<{ value: NonNullable<ChartCard['drawMode']>; label: string }> = [
    { value: 'lines', label: t('drawModes.lines') },
    { value: 'lines+markers', label: t('drawModes.lines+markers') },
    { value: 'markers', label: t('drawModes.markers') },
  ]
  const dataModeOptions: Array<{ value: ChartDataMode; label: string }> = [
    { value: 'raw', label: t('inspector.dataModes.raw') },
    { value: 'aggregate', label: t('inspector.dataModes.aggregate') },
  ]

  const allHeaders = useMemo(
    () => Array.from(new Set(datasets.flatMap((dataset) => dataset.headers))),
    [datasets],
  )
  const datasetsById = useMemo(
    () => Object.fromEntries(datasets.map((dataset) => [dataset.id, dataset])),
    [datasets],
  )
  const selectedDatasetIds = card?.dataConfig.mode === 'aggregate'
    ? card.dataConfig.aggregation.datasetIds
    : []
  const selectedDatasets = useMemo(
    () => selectedDatasetIds
      .map((datasetId) => datasetsById[datasetId])
      .filter((dataset): dataset is CsvData => Boolean(dataset)),
    [datasetsById, selectedDatasetIds],
  )
  const selectedHeaders = useMemo(
    () => Array.from(new Set(selectedDatasets.flatMap((dataset) => dataset.headers))),
    [selectedDatasets],
  )
  const selectedNumericColumns = useMemo(
    () => Array.from(new Set(selectedDatasets.flatMap((dataset) => dataset.numericColumns))),
    [selectedDatasets],
  )

  function createDefaultAggregationConfig(): AggregationConfig {
    const fallbackDataset = (activeDatasetId ? datasetsById[activeDatasetId] : undefined) ?? datasets[0]
    const xColumn = card?.xColumn || fallbackDataset?.headers[0] || ''
    const metricColumn =
      fallbackDataset?.numericColumns.find((column) => column !== xColumn)
      ?? fallbackDataset?.numericColumns[0]
      ?? ''

    return {
      datasetIds: fallbackDataset ? [fallbackDataset.id] : [],
      xColumn,
      xKind: 'category',
      timeBucket: 'month',
      groupMode: 'file',
      groupColumn: null,
      metricColumn,
      aggregation: 'sum',
    }
  }

  function changeDataMode(mode: ChartDataMode) {
    if (mode === 'raw') {
      onChangeCard({ dataConfig: { mode: 'raw' } })
      return
    }

    onChangeCard({
      dataConfig: {
        mode: 'aggregate',
        aggregation: card?.dataConfig.mode === 'aggregate'
          ? card.dataConfig.aggregation
          : createDefaultAggregationConfig(),
      },
    })
  }

  function changeAggregation(patch: Partial<AggregationConfig>) {
    const current = card?.dataConfig.mode === 'aggregate'
      ? card.dataConfig.aggregation
      : createDefaultAggregationConfig()
    const next = updateAggregationConfig(current, patch)

    onChangeCard({
      dataConfig: {
        mode: 'aggregate',
        aggregation: next,
      },
      xColumn: next.xColumn,
    })
  }

  function toggleAggregationDataset(datasetId: string) {
    const current = card?.dataConfig.mode === 'aggregate'
      ? card.dataConfig.aggregation
      : createDefaultAggregationConfig()
    const datasetIds = current.datasetIds.includes(datasetId)
      ? current.datasetIds.filter((id) => id !== datasetId)
      : [...current.datasetIds, datasetId]

    changeAggregation({ datasetIds: datasetIds.length > 0 ? datasetIds : current.datasetIds })
  }

  useEffect(() => {
    if (!openMenuSeriesId) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null
      if (!target) {
        return
      }

      if (target.closest('.inspector-series-actions')) {
        return
      }

      if (shellRef.current?.contains(target)) {
        setOpenMenuSeriesId(null)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenMenuSeriesId(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenuSeriesId])

  if (!card) {
    return (
      <section className="grid min-h-full place-items-center bg-base-100 px-6 py-16 text-center">
        <div className="grid max-w-xs justify-items-center gap-3">
          <div className="inline-grid size-14 place-items-center rounded-[calc(var(--radius-box)+0.25rem)] bg-primary/10 text-primary">
            <Sparkles size={22} strokeWidth={2.2} />
          </div>
          <strong className="text-lg font-semibold text-base-content">{t('inspector.emptyTitle')}</strong>
          <p className="text-sm leading-6 text-base-content/60">{t('inspector.emptyDescription')}</p>
        </div>
      </section>
    )
  }

  const currentKindLabel = kindOptions.find((option) => option.value === card.kind)?.label ?? t('chartKinds.fallback')

  return (
    <section ref={shellRef} className="grid min-h-full content-start bg-base-100">
      <div className="flex items-start justify-between gap-3 border-base-300 px-6 py-5">
        <div className="grid gap-1">
          <h2 className="text-4xl font-semibold tracking-tight text-base-content">{currentKindLabel}</h2>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" className={iconButtonClass} onClick={onDuplicate} aria-label={t('inspector.duplicateCard')} title={t('inspector.duplicateCard')}>
            <Copy size={16} strokeWidth={2.1} />
          </button>
          <button type="button" className={iconButtonClass} onClick={onRemove} aria-label={t('inspector.deleteCard')} title={t('inspector.deleteCard')}>
            <Trash2 size={16} strokeWidth={2.1} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-6 border-b border-base-300 px-6">
        <button
          type="button"
          className={`inline-flex h-14 items-center border-b-2 text-base font-semibold transition ${
            activeTab === 'base'
              ? 'border-primary text-primary'
              : 'border-transparent text-base-content/70 hover:text-base-content'
          }`}
          onClick={() => setActiveTab('base')}
        >
          {t('inspector.baseTab')}
        </button>
        <button
          type="button"
          className={`inline-flex h-14 items-center border-b-2 text-base font-semibold transition ${
            activeTab === 'display'
              ? 'border-primary text-primary'
              : 'border-transparent text-base-content/70 hover:text-base-content'
          }`}
          onClick={() => setActiveTab('display')}
        >
          {t('inspector.displayTab')}
        </button>
      </div>

      <div className="px-6 pb-8">
        {activeTab === 'base' && (
          <>
            <section className="border-b border-base-300 py-6">
              <div className="mb-4 text-lg font-semibold text-base-content">{t('inspector.baseSectionTitle')}</div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 md:col-span-2">
                  <span className={fieldLabelClass}>{t('inspector.title')}</span>
                  <input
                    type="text"
                    value={card.title}
                    onChange={(event) => onChangeCard({ title: event.target.value })}
                    className={inputClass}
                  />
                </label>

                <label className="grid gap-2">
                  <span className={fieldLabelClass}>{t('inspector.chartKind')}</span>
                  <SelectMenu
                    value={card.kind}
                    options={kindOptions}
                    onChange={(value) => onChangeCard({ kind: value })}
                    buttonClassName="shadow-none"
                  />
                </label>

                <label className="grid gap-2">
                  <span className={fieldLabelClass}>{t('inspector.dataMode')}</span>
                  <SelectMenu
                    value={card.dataConfig.mode}
                    options={dataModeOptions}
                    onChange={changeDataMode}
                    buttonClassName="shadow-none"
                  />
                </label>

                {card.dataConfig.mode === 'raw' && (
                <label className="grid gap-2">
                  <span className={fieldLabelClass}>{t('inspector.sharedXAxis')}</span>
                  <SelectMenu
                    value={card.xColumn}
                    options={allHeaders.map((header) => ({
                      value: header,
                      label: header,
                    }))}
                    onChange={(value) => onChangeCard({ xColumn: value })}
                    buttonClassName="shadow-none"
                  />
                </label>
                )}

                {card.dataConfig.mode === 'raw' && card.kind !== 'stats' && (
                  <>
                    <label className="grid gap-2">
                      <span className={fieldLabelClass}>{t('inspector.drawMode')}</span>
                      <SelectMenu
                        value={card.drawMode}
                        options={drawModeOptions}
                        onChange={(value) => onChangeCard({ drawMode: value })}
                        buttonClassName="shadow-none"
                      />
                    </label>

                    <label className="grid gap-2">
                      <span className={fieldLabelClass}>{t('inspector.lineWidth')}</span>
                      <input
                        type="number"
                        min="1"
                        max="6"
                        value={card.lineWidth}
                        onChange={(event) => onChangeCard({ lineWidth: Number(event.target.value) || 1 })}
                        className={inputClass}
                      />
                    </label>
                  </>
                )}

                {card.dataConfig.mode === 'aggregate' && (
                  <div className="grid gap-4 md:col-span-2">
                    <div className="grid gap-2">
                      <span className={fieldLabelClass}>{t('inspector.aggregate.dataSources')}</span>
                      <div className="grid gap-2">
                        {datasets.map((dataset) => {
                          const selected = card.dataConfig.mode === 'aggregate'
                            && card.dataConfig.aggregation.datasetIds.includes(dataset.id)

                          return (
                            <button
                              key={dataset.id}
                              type="button"
                              className={`flex min-h-12 items-center justify-between rounded-[var(--radius-field)] border px-4 text-left text-sm transition ${
                                selected
                                  ? 'border-primary/20 bg-primary/10 text-primary'
                                  : 'border-base-300 bg-base-100 text-base-content/70 hover:border-primary/20 hover:text-base-content'
                              }`}
                              onClick={() => toggleAggregationDataset(dataset.id)}
                            >
                              <span className="min-w-0 flex-1 truncate font-medium">{dataset.fileName}</span>
                              <span className="text-xs">{t('common.rowCount', { count: formatNumber(dataset.rowCount) })}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="grid gap-2">
                        <span className={fieldLabelClass}>{t('inspector.aggregate.xColumn')}</span>
                        <SelectMenu
                          value={card.dataConfig.aggregation.xColumn}
                          options={(selectedHeaders.length > 0 ? selectedHeaders : allHeaders).map((header) => ({
                            value: header,
                            label: header,
                          }))}
                          onChange={(value) => changeAggregation({ xColumn: value })}
                          buttonClassName="shadow-none"
                        />
                      </label>

                      <label className="grid gap-2">
                        <span className={fieldLabelClass}>{t('inspector.aggregate.xKind')}</span>
                        <SelectMenu
                          value={card.dataConfig.aggregation.xKind}
                          options={xKindOptions.map((option) => ({
                            value: option,
                            label: t(`inspector.xKinds.${option}`),
                          }))}
                          onChange={(value) => changeAggregation({ xKind: value })}
                          buttonClassName="shadow-none"
                        />
                      </label>

                      {card.dataConfig.aggregation.xKind === 'time' && (
                        <label className="grid gap-2">
                          <span className={fieldLabelClass}>{t('inspector.aggregate.timeBucket')}</span>
                          <SelectMenu
                            value={card.dataConfig.aggregation.timeBucket}
                            options={timeBucketOptions.map((option) => ({
                              value: option,
                              label: t(`inspector.timeBuckets.${option}`),
                            }))}
                            onChange={(value) => changeAggregation({ timeBucket: value })}
                            buttonClassName="shadow-none"
                          />
                        </label>
                      )}

                      <label className="grid gap-2">
                        <span className={fieldLabelClass}>{t('inspector.aggregate.metricColumn')}</span>
                        <SelectMenu
                          value={card.dataConfig.aggregation.metricColumn}
                          options={(selectedNumericColumns.length > 0 ? selectedNumericColumns : allHeaders).map((header) => ({
                            value: header,
                            label: header,
                          }))}
                          onChange={(value) => changeAggregation({ metricColumn: value })}
                          buttonClassName="shadow-none"
                        />
                      </label>

                      <label className="grid gap-2">
                        <span className={fieldLabelClass}>{t('inspector.aggregate.aggregation')}</span>
                        <SelectMenu
                          value={card.dataConfig.aggregation.aggregation}
                          options={aggregationOptions.map((option) => ({
                            value: option,
                            label: t(`inspector.aggregations.${option}`),
                          }))}
                          onChange={(value) => changeAggregation({ aggregation: value })}
                          buttonClassName="shadow-none"
                        />
                      </label>

                      <label className="grid gap-2">
                        <span className={fieldLabelClass}>{t('inspector.aggregate.groupMode')}</span>
                        <SelectMenu
                          value={card.dataConfig.aggregation.groupMode}
                          options={groupModeOptions.map((option) => ({
                            value: option,
                            label: t(`inspector.groupModes.${option}`),
                          }))}
                          onChange={(value) => changeAggregation({
                            groupMode: value,
                          })}
                          buttonClassName="shadow-none"
                        />
                      </label>

                      {card.dataConfig.aggregation.groupMode === 'field' && (
                        <label className="grid gap-2">
                          <span className={fieldLabelClass}>{t('inspector.aggregate.groupColumn')}</span>
                          <SelectMenu
                            value={card.dataConfig.aggregation.groupColumn}
                            options={(selectedHeaders.length > 0 ? selectedHeaders : allHeaders).map((header) => ({
                              value: header,
                              label: header,
                            }))}
                            onChange={(value) => changeAggregation({ groupColumn: value })}
                            placeholder={t('inspector.chooseField')}
                            buttonClassName="shadow-none"
                          />
                        </label>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {card.dataConfig.mode === 'raw' && (
            <section className="py-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-lg font-semibold text-base-content">{t('inspector.seriesSectionTitle')}</div>
                {card.kind !== 'stats' && (
                  <button
                    type="button"
                    className="inline-grid size-11 place-items-center rounded-[var(--radius-box)] border-0 bg-transparent text-primary transition hover:bg-transparent hover:text-primary/80 focus-visible:outline-none focus-visible:ring-0"
                    onClick={() => onAddSeries(activeDatasetId ?? undefined)}
                    aria-label={t('inspector.addSeries')}
                    title={t('inspector.addSeries')}
                  >
                    <Plus size={18} strokeWidth={2.2} />
                  </button>
                )}
              </div>

              <div className="grid">
                {card.series.map((series) => {
                  const dataset = datasetsById[series.datasetId]
                  const numericOptions = dataset
                    ? listAvailableSeriesYColumns(card, dataset, { excludeSeriesId: series.id })
                    : []
                  const supportsX = dataset ? dataset.headers.includes(card.xColumn) : false
                  const datasetOptions = datasets
                    .filter((option) => (
                      option.id === series.datasetId
                      || (
                        option.headers.includes(card.xColumn)
                        && listAvailableSeriesYColumns(card, option, { excludeSeriesId: series.id }).length > 0
                      )
                    ))
                    .map((option) => ({
                      value: option.id,
                      label: option.fileName,
                      description: t('common.rowCount', { count: formatNumber(option.rowCount) }),
                    }))

                  return (
                    <div key={series.id} className="grid gap-3 border-b border-base-300 py-4 last:border-b-0">
                      <div className="flex items-center justify-between gap-3">
                        <strong className="truncate text-sm font-semibold text-base-content">
                          {series.label || dataset?.fileName || t('cards.unnamedSeries')}
                        </strong>
                        <div className="relative inspector-series-actions">
                          <button
                            type="button"
                            className={iconButtonClass}
                            onClick={() => setOpenMenuSeriesId((value) => value === series.id ? null : series.id)}
                            aria-label={t('inspector.seriesMenu')}
                            title={t('inspector.seriesMenu')}
                          >
                            <MoreHorizontal size={16} strokeWidth={2.1} />
                          </button>

                          {openMenuSeriesId === series.id && (
                            <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 grid min-w-36 gap-1 rounded-[calc(var(--radius-box)+0.25rem)] border border-base-300 bg-base-100 p-2">
                              <button
                                type="button"
                                className="inline-flex h-10 items-center rounded-[var(--radius-field)] px-3 text-left text-sm text-base-content transition hover:bg-base-200"
                                onClick={() => {
                                  setActiveTab('display')
                                  setOpenMenuSeriesId(null)
                                }}
                              >
                                {t('inspector.openDisplaySettings')}
                              </button>
                              {card.series.length > 1 && (
                                <button
                                  type="button"
                                  className="inline-flex h-10 items-center rounded-[var(--radius-field)] px-3 text-left text-sm text-error transition hover:bg-error/10"
                                  onClick={() => {
                                    onRemoveSeries(series.id)
                                    setOpenMenuSeriesId(null)
                                  }}
                                >
                                  {t('inspector.removeSeries')}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-3">
                        <SelectMenu
                          value={series.datasetId}
                          options={datasetOptions}
                          onChange={(value) => onChangeSeries(series.id, { datasetId: value })}
                          buttonClassName="shadow-none"
                        />

                        <SelectMenu
                          value={series.yColumn}
                          options={numericOptions.map((header) => ({
                            value: header,
                            label: header,
                          }))}
                          onChange={(value) => onChangeSeries(series.id, { yColumn: value })}
                          placeholder={t('inspector.chooseField')}
                          buttonClassName="shadow-none"
                        />
                      </div>

                      {!supportsX && (
                        <div className="rounded-[var(--radius-box)] bg-error/10 px-3 py-2 text-sm leading-6 text-error">
                          {t('inspector.incompatibleSeries', { xColumn: card.xColumn })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
            )}
          </>
        )}

        {activeTab === 'display' && (
          <>
            <section className="border-b border-base-300 py-6">
              <div className="mb-4 text-lg font-semibold text-base-content">{t('inspector.seriesDisplaySectionTitle')}</div>
              <div className="grid">
                {card.series.map((series) => (
                  <div key={series.id} className="grid gap-3 border-b border-base-300 py-4 last:border-b-0">
                    <div className="grid gap-1">
                      <span className="text-xs font-medium uppercase tracking-[0.12em] text-base-content/55">{t('inspector.dataSource')}</span>
                      <strong className="text-sm font-semibold text-base-content">
                        {datasetsById[series.datasetId]?.fileName || t('cards.unnamedSeries')}
                      </strong>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                      <label className="grid gap-2">
                        <span className={fieldLabelClass}>{t('inspector.displayName')}</span>
                        <input
                          type="text"
                          value={series.label}
                          placeholder={datasetsById[series.datasetId]?.fileName || t('inspector.displayNamePlaceholder')}
                          onChange={(event) => onChangeSeries(series.id, { label: event.target.value })}
                          className={inputClass}
                        />
                      </label>

                      <div className="grid gap-2">
                        <span className={fieldLabelClass}>{t('inspector.seriesColor')}</span>
                        <label className="relative flex h-12 items-center gap-3 rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-4 text-sm text-base-content">
                          <span className="size-5 rounded-md border border-base-300" style={{ background: series.color }} />
                          <span className="font-medium">{series.color.toUpperCase()}</span>
                          <span className="ml-auto text-base-content/55">
                            <Palette size={15} strokeWidth={2.1} />
                          </span>
                          <input
                            type="color"
                            value={series.color}
                            onChange={(event) => onChangeSeries(series.id, { color: event.target.value })}
                            className="absolute inset-0 cursor-pointer opacity-0"
                            aria-label={t('inspector.seriesColor')}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="py-6">
              <div className="mb-4 text-lg font-semibold text-base-content">{t('inspector.chartDisplaySectionTitle')}</div>
              <div className="grid gap-3 md:grid-cols-2">
                <Switch
                  checked={card.showLegend}
                  label={t('inspector.legend')}
                  onChange={(checked) => onChangeCard({ showLegend: checked })}
                />
                <Switch
                  checked={card.showGrid}
                  label={t('inspector.gridLines')}
                  onChange={(checked) => onChangeCard({ showGrid: checked })}
                />
                <Switch
                  checked={card.showAxes}
                  label={t('inspector.axes')}
                  onChange={(checked) => onChangeCard({ showAxes: checked })}
                />
              </div>
            </section>

            <section className="py-6">
              <div className="mb-4 text-lg font-semibold text-base-content">{t('inspector.axisRangeSectionTitle')}</div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className={fieldLabelClass}>{t('inspector.xRangeMin')}</span>
                  <input
                    type="text"
                    value={card.xRange.min}
                    placeholder={t('inspector.autoRangePlaceholder')}
                    onChange={(event) => onChangeCard({ xRange: { ...card.xRange, min: event.target.value } })}
                    className={inputClass}
                  />
                </label>

                <label className="grid gap-2">
                  <span className={fieldLabelClass}>{t('inspector.xRangeMax')}</span>
                  <input
                    type="text"
                    value={card.xRange.max}
                    placeholder={t('inspector.autoRangePlaceholder')}
                    onChange={(event) => onChangeCard({ xRange: { ...card.xRange, max: event.target.value } })}
                    className={inputClass}
                  />
                </label>

                <label className="grid gap-2">
                  <span className={fieldLabelClass}>{t('inspector.yRangeMin')}</span>
                  <input
                    type="number"
                    value={card.yRange.min}
                    placeholder={t('inspector.autoRangePlaceholder')}
                    onChange={(event) => onChangeCard({ yRange: { ...card.yRange, min: event.target.value } })}
                    className={inputClass}
                  />
                </label>

                <label className="grid gap-2">
                  <span className={fieldLabelClass}>{t('inspector.yRangeMax')}</span>
                  <input
                    type="number"
                    value={card.yRange.max}
                    placeholder={t('inspector.autoRangePlaceholder')}
                    onChange={(event) => onChangeCard({ yRange: { ...card.yRange, max: event.target.value } })}
                    className={inputClass}
                  />
                </label>
              </div>
            </section>
          </>
        )}
      </div>
    </section>
  )
}
