import { useEffect, useMemo, useRef, useState } from 'react'
import { useCsvData } from './hooks/useCsvData'
import { AppNavbar } from './components/AppNavbar'
import { CardInspector } from './components/CardInspector'
import { ChartCard } from './components/ChartCard'
import { DashboardCanvas } from './components/DashboardCanvas'
import { WorkbenchHeader } from './components/WorkbenchHeader'
import {
  appendCardSeries,
  appendCardWithLayout,
  buildFilteredRowsByDataset,
  createCard,
  createCardSeries,
  createAutoSeriesForDatasets,
  moveCardToLayout,
  sanitizeCardsForDatasets,
} from './lib/workbench'
import { getChartColor } from './lib/theme'
import { pickCsvFiles } from './lib/upload'
import type { ChartCard as ChartCardConfig, ChartSeries, CsvData, FilterJoinOperator, FilterRule } from './types'

const STORAGE_KEY = 'csv-workbench-dashboard'

interface PersistedState {
  cards?: ChartCardConfig[]
  filters?: FilterRule[]
  filtersByDataset?: Record<string, FilterRule[]>
  workspaceFilters?: FilterRule[]
  filterJoinOperator?: FilterJoinOperator
  activeDatasetId?: string | null
}

function createFilterRule(dataset: CsvData | null): FilterRule {
  return {
    id: `filter-${Math.random().toString(36).slice(2, 10)}`,
    column: dataset?.headers[0] ?? '',
    operator: 'contains',
    value: '',
  }
}

function hasFilePayload(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return false
  }

  return Array.from(dataTransfer.items).some((item) => item.kind === 'file')
    || Array.from(dataTransfer.types).includes('Files')
}

function cloneSeries(series: ChartSeries): ChartSeries {
  return {
    ...series,
    id: `${series.datasetId}-series-${Math.random().toString(36).slice(2, 10)}`,
  }
}

function buildAutoBoundSeries(
  datasets: CsvData[],
  primaryDataset: CsvData,
  kind: ChartCardConfig['kind'],
): ChartSeries[] {
  const xColumn = pickBestSharedXColumn(datasets, primaryDataset)

  const autoSeries = createAutoSeriesForDatasets(
    datasets,
    xColumn,
    kind === 'stats' ? 1 : undefined,
  )

  if (autoSeries.length > 0) {
    return autoSeries.map((series, index) => ({
      ...series,
      color: getChartColor(index),
    }))
  }

  const fallbackSeries = createCardSeries(primaryDataset, xColumn, {
    color: getChartColor(0),
  })

  return fallbackSeries.yColumn ? [fallbackSeries] : []
}

function pickBestSharedXColumn(datasets: CsvData[], primaryDataset: CsvData) {
  const scoredHeaders = primaryDataset.headers.map((header) => ({
    header,
    count: datasets.filter((dataset) => dataset.headers.includes(header)).length,
  }))

  return scoredHeaders.sort((left, right) => right.count - left.count)[0]?.header
    ?? primaryDataset.headers[0]
    ?? ''
}

function createAutoBoundCard(
  datasets: CsvData[],
  primaryDataset: CsvData,
  kind: ChartCardConfig['kind'],
  title?: string,
): ChartCardConfig {
  const xColumn = primaryDataset.headers[0] ?? ''
  const series = buildAutoBoundSeries(datasets, primaryDataset, kind)
  const card = createCard(kind, primaryDataset, {
    title: title ?? createCard(kind, primaryDataset).title,
    xColumn,
    series,
  })

  if (series.length > 0) {
    card.series = series
  }

  return card
}

function normalizeWorkspaceFilters(persisted: PersistedState, datasets: CsvData[]): FilterRule[] {
  const availableHeaders = new Set(datasets.flatMap((dataset) => dataset.headers))

  const normalizeRule = (filter: FilterRule): FilterRule | null => {
    if (!availableHeaders.has(filter.column)) {
      return null
    }

    return {
      ...filter,
      column: filter.column,
    }
  }

  if (persisted.workspaceFilters) {
    return persisted.workspaceFilters
      .map(normalizeRule)
      .filter((filter): filter is FilterRule => filter !== null)
  }

  const activeDatasetId = persisted.activeDatasetId

  if (persisted.filtersByDataset) {
    const fallbackDatasetId = activeDatasetId && persisted.filtersByDataset[activeDatasetId]
      ? activeDatasetId
      : datasets[0]?.id
    const legacyFilters = fallbackDatasetId ? persisted.filtersByDataset[fallbackDatasetId] ?? [] : []

    return legacyFilters
      .map(normalizeRule)
      .filter((filter): filter is FilterRule => filter !== null)
  }

  if (persisted.filters) {
    return persisted.filters
      .map(normalizeRule)
      .filter((filter): filter is FilterRule => filter !== null)
  }

  return []
}

export default function App() {
  const { datasets, parseFiles } = useCsvData()
  const [cards, setCards] = useState<ChartCardConfig[]>([])
  const [workspaceFilters, setWorkspaceFilters] = useState<FilterRule[]>([])
  const [filterJoinOperator, setFilterJoinOperator] = useState<FilterJoinOperator>('and')
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [recentDatasetIds, setRecentDatasetIds] = useState<string[]>([])
  const [dragActive, setDragActive] = useState(false)
  const dragDepthRef = useRef(0)
  const previousDatasetCountRef = useRef(0)

  const datasetsById = useMemo(
    () => Object.fromEntries(datasets.map((dataset) => [dataset.id, dataset])),
    [datasets],
  )

  const activeDataset = useMemo(
    () => (activeDatasetId ? datasetsById[activeDatasetId] : undefined) ?? datasets[0] ?? null,
    [activeDatasetId, datasets, datasetsById],
  )

  const filteredRowsByDataset = useMemo(
    () => buildFilteredRowsByDataset(datasets, workspaceFilters, filterJoinOperator),
    [datasets, filterJoinOperator, workspaceFilters],
  )

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedCardId) ?? null,
    [cards, selectedCardId],
  )

  useEffect(() => {
    if (datasets.length === 0) {
      previousDatasetCountRef.current = 0
      setCards([])
      setWorkspaceFilters([])
      setFilterJoinOperator('and')
      setActiveDatasetId(null)
      setSelectedCardId(null)
      setRecentDatasetIds([])
      return
    }

    const previousCount = previousDatasetCountRef.current

    if (previousCount === 0) {
      const persistedRaw = window.localStorage.getItem(STORAGE_KEY)

      if (!persistedRaw) {
        const defaultCard = createAutoBoundCard(datasets, datasets[0], 'line', '默认折线图')
        setCards([defaultCard])
        setWorkspaceFilters([])
        setFilterJoinOperator('and')
        setActiveDatasetId(datasets[0].id)
        setSelectedCardId(defaultCard.id)
        setRecentDatasetIds(datasets.map((dataset) => dataset.id))
        previousDatasetCountRef.current = datasets.length
        return
      }

      try {
        const persisted = JSON.parse(persistedRaw) as PersistedState
        const restoredActiveDatasetId = persisted.activeDatasetId && datasetsById[persisted.activeDatasetId]
          ? persisted.activeDatasetId
          : datasets[0].id
        const restoredCards = persisted.cards && persisted.cards.length > 0
          ? sanitizeCardsForDatasets(persisted.cards, datasets, restoredActiveDatasetId)
          : [createAutoBoundCard(datasets, datasets[0], 'line', '默认折线图')]
        const restoredFilters = normalizeWorkspaceFilters(persisted, datasets)

        setCards(restoredCards)
        setWorkspaceFilters(restoredFilters)
        setFilterJoinOperator(persisted.filterJoinOperator ?? 'and')
        setActiveDatasetId(restoredActiveDatasetId)
        setSelectedCardId(restoredCards[0]?.id ?? null)
        setRecentDatasetIds(datasets.map((dataset) => dataset.id))
      } catch {
        const defaultCard = createAutoBoundCard(datasets, datasets[0], 'line', '默认折线图')
        setCards([defaultCard])
        setWorkspaceFilters([])
        setFilterJoinOperator('and')
        setActiveDatasetId(datasets[0].id)
        setSelectedCardId(defaultCard.id)
        setRecentDatasetIds(datasets.map((dataset) => dataset.id))
      }
    } else {
      setCards((prev) => sanitizeCardsForDatasets(prev, datasets, activeDatasetId))
      setWorkspaceFilters((prev) => prev.filter((filter) => datasets.some((dataset) => dataset.headers.includes(filter.column))))
      setActiveDatasetId((prev) => (prev && datasetsById[prev] ? prev : datasets[0].id))
    }

    previousDatasetCountRef.current = datasets.length
  }, [activeDatasetId, datasets, datasetsById])

  useEffect(() => {
    if (datasets.length === 0) {
      return
    }

    const payload: PersistedState = {
      cards,
      workspaceFilters,
      filterJoinOperator,
      activeDatasetId,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [activeDatasetId, cards, datasets.length, filterJoinOperator, workspaceFilters])

  useEffect(() => {
    if (cards.length === 0) {
      setSelectedCardId(null)
      return
    }

    if (!selectedCardId || !cards.some((card) => card.id === selectedCardId)) {
      setSelectedCardId(cards[0].id)
    }
  }, [cards, selectedCardId])

  async function handleIncomingFiles(files: File[]) {
    const parsed = await parseFiles(files)

    if (parsed.length > 0) {
      setActiveDatasetId(parsed[0].id)
      setRecentDatasetIds(parsed.map((dataset) => dataset.id))
    }
  }

  useEffect(() => {
    function handleDragEnter(event: DragEvent) {
      if (!hasFilePayload(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      dragDepthRef.current += 1
      setDragActive(true)
    }

    function handleDragOver(event: DragEvent) {
      if (!hasFilePayload(event.dataTransfer)) {
        return
      }

      event.preventDefault()

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
    }

    function handleDragLeave(event: DragEvent) {
      if (!hasFilePayload(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)

      if (dragDepthRef.current === 0) {
        setDragActive(false)
      }
    }

    function handleDrop(event: DragEvent) {
      if (!hasFilePayload(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      dragDepthRef.current = 0
      setDragActive(false)

      const files = pickCsvFiles(Array.from(event.dataTransfer?.files ?? []))

      if (files.length > 0) {
        void handleIncomingFiles(files)
      }
    }

    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)

    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
    }
  }, [parseFiles])

  function addCard(kind: ChartCardConfig['kind']) {
    if (!activeDataset) {
      return
    }

    const scopedDatasets = recentDatasetIds.length > 0
      ? datasets.filter((dataset) => recentDatasetIds.includes(dataset.id))
      : datasets
    const autoSeries = buildAutoBoundSeries(scopedDatasets, activeDataset, kind).map((series, index) => ({
      ...series,
      color: getChartColor(cards.length + index),
    }))
    const nextXColumn = pickBestSharedXColumn(scopedDatasets, activeDataset)
    const nextCard = createCard(kind, activeDataset, {
      xColumn: nextXColumn,
      series: autoSeries.length > 0 ? autoSeries : createCard(kind, activeDataset).series,
    })

    setCards((prev) => appendCardWithLayout(prev, nextCard))
    setSelectedCardId(nextCard.id)
  }

  function updateCard(cardId: string, patch: Partial<ChartCardConfig>) {
    setCards((prev) => prev.map((card) => {
      if (card.id !== cardId) {
        return card
      }

      const nextCard = { ...card, ...patch }

      if (nextCard.kind === 'stats' && nextCard.series.length > 1) {
        nextCard.series = [nextCard.series[0]]
      }

      return nextCard
    }))
  }

  function addSeries(cardId: string, datasetId?: string) {
    const targetCard = cards.find((card) => card.id === cardId)
    const scopedDatasets = recentDatasetIds.length > 0
      ? datasets.filter((dataset) => recentDatasetIds.includes(dataset.id))
      : datasets
    const boundDatasetIds = new Set(targetCard?.series.map((series) => series.datasetId) ?? [])
    const unboundDataset = targetCard
      ? scopedDatasets.find((dataset) => (
          !boundDatasetIds.has(dataset.id)
          && dataset.headers.includes(targetCard.xColumn)
          && createCardSeries(dataset, targetCard.xColumn).yColumn !== null
        ))
      : null
    const dataset = (datasetId ? datasetsById[datasetId] : undefined) ?? unboundDataset ?? activeDataset

    if (!dataset) {
      return
    }

    setCards((prev) => prev.map((card) => (
      card.id === cardId
        ? appendCardSeries(card, dataset, {
            color: getChartColor(card.series.length),
          })
        : card
    )))
  }

  function updateSeries(cardId: string, seriesId: string, patch: Partial<ChartSeries>) {
    setCards((prev) => prev.map((card) => {
      if (card.id !== cardId) {
        return card
      }

      return {
        ...card,
        series: card.series.map((series) => {
          if (series.id !== seriesId) {
            return series
          }

          const nextDatasetId = patch.datasetId ?? series.datasetId
          const nextDataset = datasetsById[nextDatasetId]
          const defaultY = nextDataset
            ? nextDataset.numericColumns.find((column) => column !== card.xColumn) ?? nextDataset.numericColumns[0] ?? null
            : null

          return {
            ...series,
            ...patch,
            label: patch.datasetId && nextDataset ? nextDataset.fileName : (patch.label ?? series.label),
            yColumn: patch.datasetId && !patch.yColumn ? defaultY : (patch.yColumn ?? series.yColumn),
          }
        }),
      }
    }))
  }

  function removeSeries(cardId: string, seriesId: string) {
    setCards((prev) => prev.map((card) => {
      if (card.id !== cardId || card.series.length <= 1) {
        return card
      }

      return {
        ...card,
        series: card.series.filter((series) => series.id !== seriesId),
      }
    }))
  }

  function duplicateCard(cardId: string) {
    const target = cards.find((card) => card.id === cardId)

    if (!target) {
      return
    }

    const nextCard = {
      ...target,
      id: `card-${Math.random().toString(36).slice(2, 10)}`,
      title: `${target.title} 副本`,
      series: target.series.map((series) => cloneSeries(series)),
      layout: {
        ...target.layout,
        x: target.layout.x + 1,
        y: target.layout.y + 1,
      },
    }

    setCards((prev) => appendCardWithLayout(prev, nextCard))
    setSelectedCardId(nextCard.id)
  }

  function removeCard(cardId: string) {
    setCards((prev) => prev.filter((card) => card.id !== cardId))
  }

  function addFilter() {
    if (datasets.length === 0) {
      return
    }

    setWorkspaceFilters((prev) => [...prev, createFilterRule(activeDataset)])
  }

  function updateFilter(filterId: string, patch: Partial<FilterRule>) {
    setWorkspaceFilters((prev) =>
      prev.map((filter) => (
        filter.id === filterId ? { ...filter, ...patch } : filter
      )),
    )
  }

  function removeFilter(filterId: string) {
    setWorkspaceFilters((prev) => prev.filter((filter) => filter.id !== filterId))
  }

  return (
    <div className="grid h-full grid-rows-[var(--navbar-height)_minmax(0,1fr)] bg-base-200 text-base-content">
      <AppNavbar
        activeFileName={activeDataset?.fileName ?? null}
        datasetCount={datasets.length}
        onFiles={handleIncomingFiles}
      />

      <main className="grid min-h-0 grid-cols-[minmax(0,1fr)_var(--inspector-width)] max-[920px]:block">
        <section className="min-h-0 min-w-0 overflow-auto bg-base-100">
          {datasets.length > 0 && activeDataset && (
            <WorkbenchHeader
              datasets={datasets}
              activeDatasetId={activeDataset.id}
              datasetGroupCount={recentDatasetIds.length || datasets.length}
              filteredCount={(filteredRowsByDataset[activeDataset.id] ?? activeDataset.rows).length}
              filters={workspaceFilters}
              filterJoinOperator={filterJoinOperator}
              onSelectDataset={setActiveDatasetId}
              onAddComponent={addCard}
              onAddFilter={addFilter}
              onChangeFilterJoinOperator={setFilterJoinOperator}
              onChangeFilter={updateFilter}
              onRemoveFilter={removeFilter}
            />
          )}

          {datasets.length === 0 && (
            <div className="grid min-h-full place-items-center px-6 py-12">
              <div className="grid w-full max-w-2xl gap-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Ready</p>
                <h2 className="text-4xl font-semibold leading-tight tracking-tight text-base-content">
                  拖拽一个或多个 CSV 到页面任意位置
                </h2>
                <p className="text-base leading-7 text-base-content/60">
                  加载后你可以分别查看，也可以把多个 CSV 叠到同一张图里。
                </p>
              </div>
            </div>
          )}

          {datasets.length > 0 && cards.length > 0 && (
            <DashboardCanvas
              cards={cards}
              selectedCardId={selectedCardId}
              onSelectCard={setSelectedCardId}
              onLayoutChange={(cardId, layout) => setCards((prev) => moveCardToLayout(prev, cardId, layout))}
              renderCard={(card, controls) => (
                <ChartCard
                  key={card.id}
                  card={card}
                  datasetsById={datasetsById}
                  filteredRowsByDataset={filteredRowsByDataset}
                  selected={controls.selected}
                  onSelect={controls.onSelect}
                  onDragStart={controls.onDragStart}
                  onResizeStart={controls.onResizeStart}
                />
              )}
            />
          )}
        </section>

        <aside className="min-h-0 overflow-auto border-l border-base-300 bg-base-100 max-[920px]:border-l-0 max-[920px]:border-t">
          {datasets.length === 0 && (
            <section className="grid gap-4 border-b border-base-300 px-6 py-6">
              <div className="grid gap-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Upload</p>
                <h2 className="text-2xl font-semibold tracking-tight text-base-content">准备上传</h2>
              </div>
              <div className="text-sm leading-6 text-base-content/60">
                拖拽一个或多个 CSV 到页面任意位置，或从顶部工具栏点击上传。
              </div>
            </section>
          )}

          {datasets.length > 0 && activeDataset && (
            <CardInspector
              card={selectedCard}
              datasets={datasets}
              activeDatasetId={activeDataset.id}
              onChangeCard={(patch) => selectedCard && updateCard(selectedCard.id, patch)}
              onAddSeries={(datasetId) => selectedCard && addSeries(selectedCard.id, datasetId)}
              onChangeSeries={(seriesId, patch) => selectedCard && updateSeries(selectedCard.id, seriesId, patch)}
              onRemoveSeries={(seriesId) => selectedCard && removeSeries(selectedCard.id, seriesId)}
              onDuplicate={() => selectedCard && duplicateCard(selectedCard.id)}
              onRemove={() => selectedCard && removeCard(selectedCard.id)}
            />
          )}
        </aside>
      </main>

      {dragActive && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-neutral/10">
          <div className="grid min-w-[min(420px,calc(100vw-32px))] gap-3 rounded-[calc(var(--radius-box)+0.25rem)] border border-primary/35 bg-base-100/95 px-6 py-6 text-center shadow-2xl backdrop-blur-md">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">CSV Upload</p>
            <strong className="text-lg font-semibold text-base-content">释放以上传一个或多个 CSV</strong>
          </div>
        </div>
      )}
    </div>
  )
}
