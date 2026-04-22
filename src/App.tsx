import { useEffect, useMemo, useRef, useState } from 'react'
import { useCsvData } from './hooks/useCsvData'
import { FileUploader } from './components/FileUploader'
import { FilterBar } from './components/FilterBar'
import { WorkbenchToolbar } from './components/WorkbenchToolbar'
import { CardInspector } from './components/CardInspector'
import { ChartCard } from './components/ChartCard'
import { DashboardCanvas } from './components/DashboardCanvas'
import { DatasetSidebar } from './components/DatasetSidebar'
import {
  appendCardSeries,
  appendCardWithLayout,
  buildFilteredRowsByDataset,
  createCard,
  createDefaultCard,
  moveCardToLayout,
  sanitizeCardsForDatasets,
} from './lib/workbench'
import { pickCsvFiles } from './lib/upload'
import type { ChartCard as ChartCardConfig, ChartSeries, CsvData, FilterRule, FiltersByDataset } from './types'

const STORAGE_KEY = 'csv-workbench-dashboard'
const CARD_ACCENTS = ['#155eef', '#dd6b20', '#0f766e', '#7a3e9d']

interface PersistedState {
  cards?: ChartCardConfig[]
  filters?: FilterRule[]
  filtersByDataset?: FiltersByDataset
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

function normalizeFiltersForDatasets(persisted: PersistedState, datasets: CsvData[]): FiltersByDataset {
  const result: FiltersByDataset = {}

  if (persisted.filtersByDataset) {
    for (const dataset of datasets) {
      const sourceFilters = persisted.filtersByDataset[dataset.id] ?? []
      result[dataset.id] = sourceFilters.map((filter) => ({
        ...filter,
        column: dataset.headers.includes(filter.column) ? filter.column : dataset.headers[0] ?? '',
      }))
    }

    return result
  }

  if (persisted.filters && datasets[0]) {
    result[datasets[0].id] = persisted.filters.map((filter) => ({
      ...filter,
      column: datasets[0].headers.includes(filter.column) ? filter.column : datasets[0].headers[0] ?? '',
    }))
  }

  return result
}

export default function App() {
  const { datasets, parseFiles } = useCsvData()
  const [cards, setCards] = useState<ChartCardConfig[]>([])
  const [filtersByDataset, setFiltersByDataset] = useState<FiltersByDataset>({})
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
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
    () => buildFilteredRowsByDataset(datasets, filtersByDataset),
    [datasets, filtersByDataset],
  )

  const activeFilters = activeDataset ? (filtersByDataset[activeDataset.id] ?? []) : []

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedCardId) ?? null,
    [cards, selectedCardId],
  )

  useEffect(() => {
    if (datasets.length === 0) {
      previousDatasetCountRef.current = 0
      setCards([])
      setFiltersByDataset({})
      setActiveDatasetId(null)
      setSelectedCardId(null)
      return
    }

    const previousCount = previousDatasetCountRef.current

    if (previousCount === 0) {
      const persistedRaw = window.localStorage.getItem(STORAGE_KEY)

      if (!persistedRaw) {
        const defaultCard = createDefaultCard(datasets[0])
        setCards([defaultCard])
        setFiltersByDataset({})
        setActiveDatasetId(datasets[0].id)
        setSelectedCardId(defaultCard.id)
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
          : [createDefaultCard(datasets[0])]
        const restoredFilters = normalizeFiltersForDatasets(persisted, datasets)

        setCards(restoredCards)
        setFiltersByDataset(restoredFilters)
        setActiveDatasetId(restoredActiveDatasetId)
        setSelectedCardId(restoredCards[0]?.id ?? null)
      } catch {
        const defaultCard = createDefaultCard(datasets[0])
        setCards([defaultCard])
        setFiltersByDataset({})
        setActiveDatasetId(datasets[0].id)
        setSelectedCardId(defaultCard.id)
      }
    } else {
      setCards((prev) => sanitizeCardsForDatasets(prev, datasets, activeDatasetId))
      setFiltersByDataset((prev) => {
        const nextEntries = datasets.map((dataset) => [dataset.id, prev[dataset.id] ?? []] as const)
        return Object.fromEntries(nextEntries)
      })
      setActiveDatasetId((prev) => (prev && datasetsById[prev] ? prev : datasets[0].id))
    }

    previousDatasetCountRef.current = datasets.length
  }, [activeDatasetId, datasets, datasetsById])

  useEffect(() => {
    if (datasets.length === 0) {
      return
    }

    const payload: PersistedState = { cards, filtersByDataset, activeDatasetId }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [activeDatasetId, cards, datasets.length, filtersByDataset])

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

    const nextCard = createCard(kind, activeDataset, {
      series: createCard(kind, activeDataset).series.map((series, index) => ({
        ...series,
        color: CARD_ACCENTS[(cards.length + index) % CARD_ACCENTS.length],
      })),
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
    const dataset = (datasetId ? datasetsById[datasetId] : undefined) ?? activeDataset

    if (!dataset) {
      return
    }

    setCards((prev) => prev.map((card) => (
      card.id === cardId
        ? appendCardSeries(card, dataset, {
            color: CARD_ACCENTS[card.series.length % CARD_ACCENTS.length],
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
    if (!activeDataset) {
      return
    }

    setFiltersByDataset((prev) => ({
      ...prev,
      [activeDataset.id]: [...(prev[activeDataset.id] ?? []), createFilterRule(activeDataset)],
    }))
  }

  function updateFilter(filterId: string, patch: Partial<FilterRule>) {
    if (!activeDataset) {
      return
    }

    setFiltersByDataset((prev) => ({
      ...prev,
      [activeDataset.id]: (prev[activeDataset.id] ?? []).map((filter) => (
        filter.id === filterId ? { ...filter, ...patch } : filter
      )),
    }))
  }

  function removeFilter(filterId: string) {
    if (!activeDataset) {
      return
    }

    setFiltersByDataset((prev) => ({
      ...prev,
      [activeDataset.id]: (prev[activeDataset.id] ?? []).filter((filter) => filter.id !== filterId),
    }))
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">PN</div>
          <div className="brand-copy">
            <h1>CSV 分析工作台</h1>
            <p className="brand-file">
              {activeDataset ? `${activeDataset.fileName} · 已加载 ${datasets.length} 份 CSV` : '未加载数据集'}
            </p>
          </div>
        </div>
        <FileUploader hasDatasets={datasets.length > 0} onFiles={handleIncomingFiles} />
      </header>

      <main className="workspace-shell workspace-shell-sidebar">
        <section className="canvas-column">
          {datasets.length === 0 && (
            <div className="canvas-empty-state">
              <div className="canvas-empty-state-panel">
                <p className="canvas-empty-kicker">Ready</p>
                <h2>拖拽一个或多个 CSV 到页面任意位置</h2>
                <p>加载后你可以分别查看，也可以把多个 CSV 叠到同一张图里。</p>
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

        <aside className="sidebar-column">
          {datasets.length === 0 && (
            <section className="sidebar-panel">
              <div className="sidebar-panel-header">
                <div>
                  <p className="sidebar-kicker">Upload</p>
                  <h2>准备上传</h2>
                </div>
              </div>
              <div className="sidebar-empty">拖拽一个或多个 CSV 到页面任意位置，或从顶部工具栏点击上传。</div>
            </section>
          )}

          {datasets.length > 0 && activeDataset && (
            <>
              <DatasetSidebar
                datasets={datasets}
                activeDatasetId={activeDataset.id}
                onSelect={setActiveDatasetId}
              />

              <WorkbenchToolbar
                dataset={activeDataset}
                datasetCount={datasets.length}
                filteredCount={(filteredRowsByDataset[activeDataset.id] ?? activeDataset.rows).length}
                onAdd={addCard}
              />

              <FilterBar
                datasetName={activeDataset.fileName}
                headers={activeDataset.headers}
                filters={activeFilters}
                onAdd={addFilter}
                onChange={updateFilter}
                onRemove={removeFilter}
              />

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
            </>
          )}
        </aside>
      </main>

      {dragActive && (
        <div className="drag-overlay" aria-hidden="true">
          <div className="drag-overlay-panel">
            <p className="drag-overlay-kicker">CSV Upload</p>
            <strong>释放以上传一个或多个 CSV</strong>
          </div>
        </div>
      )}
    </div>
  )
}
