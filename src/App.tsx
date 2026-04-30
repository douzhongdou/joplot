'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SquarePen } from 'lucide-react'
import { useCsvData } from './hooks/useCsvData'
import { AppNavbar } from './components/AppNavbar'
import { CardInspector } from './components/CardInspector'
import { ChartCard } from './components/ChartCard'
import { DashboardCanvas } from './components/DashboardCanvas'
import { DataView } from './components/DataView'
import { HomeHero } from './components/HomeHero'
import { MobileBottomNav } from './components/MobileBottomNav'
import { MobileInspectorDrawer } from './components/MobileInspectorDrawer'
import { WorkbenchHeader } from './components/WorkbenchHeader'
import { useI18n } from './i18n'
import {
  buildLanguagePayload,
  buildParseSuccessPayload,
  buildUploadCsvPayload,
  mapParseErrorToReason,
  type TrackingInputMethod,
} from './lib/analytics'
import { track } from './lib/track'
import { getUploadCopy, pickCsvFiles } from './lib/upload'
import {
  isMobileViewport,
  shouldShowMobileInspector,
  toResponsiveCardLayout,
} from './lib/mobileLayout'
import { loadSampleDatasetFile, type SampleDatasetId } from './lib/sampleData'
import {
  appendCardSeries,
  appendCardWithLayout,
  buildFilteredRowsByDataset,
  buildFilterRevision,
  createCard,
  createCardSeries,
  createAutoSeriesForDatasets,
  findAvailableSeriesYColumn,
  moveCardToLayout,
  sanitizeCardsForDatasets,
} from './lib/workbench'
import { getChartColor } from './lib/theme'
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
  const { t, language } = useI18n()
  const { datasets, parseFiles, resetDatasets, hasRestoredDatasets } = useCsvData()
  const [cards, setCards] = useState<ChartCardConfig[]>([])
  const [workspaceFilters, setWorkspaceFilters] = useState<FilterRule[]>([])
  const [filterJoinOperator, setFilterJoinOperator] = useState<FilterJoinOperator>('and')
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [recentDatasetIds, setRecentDatasetIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'chart' | 'data'>('chart')
  const [dragActive, setDragActive] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false)
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false)
  const [viewportWidth, setViewportWidth] = useState<number | null>(null)
  const dragDepthRef = useRef(0)
  const hasTrackedPageLanguageRef = useRef(false)
  const previousDatasetCountRef = useRef(0)
  const uploadCopy = useMemo(() => getUploadCopy(language), [language])

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
  const filterRevision = useMemo(
    () => buildFilterRevision(workspaceFilters, filterJoinOperator),
    [filterJoinOperator, workspaceFilters],
  )
  const hasDatasets = hasRestoredDatasets && datasets.length > 0
  const mobile = viewportWidth !== null ? isMobileViewport(viewportWidth) : false

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedCardId) ?? null,
    [cards, selectedCardId],
  )
  const displayCards = useMemo(
    () => toResponsiveCardLayout(cards, mobile),
    [cards, mobile],
  )
  const showMobileInspectorTrigger = shouldShowMobileInspector(hasDatasets, selectedCardId, mobile)
  const showMobileBottomNav = mobile && hasDatasets

  function getLocalizedCardTitle(kind: ChartCardConfig['kind']) {
    switch (kind) {
      case 'line':
        return t('chartKinds.line')
      case 'scatter':
        return t('chartKinds.scatter')
      case 'bar':
        return t('chartKinds.bar')
      case 'stats':
        return t('chartKinds.stats')
      default:
        return t('chartKinds.fallback')
    }
  }

  useEffect(() => {
    if (hasTrackedPageLanguageRef.current) {
      return
    }

    track('page_language', buildLanguagePayload(language))
    hasTrackedPageLanguageRef.current = true
  }, [language])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const updateViewport = () => {
      setViewportWidth(window.innerWidth)
    }

    updateViewport()
    window.addEventListener('resize', updateViewport)

    return () => {
      window.removeEventListener('resize', updateViewport)
    }
  }, [])

  useEffect(() => {
    if (!hasRestoredDatasets) {
      return
    }

    if (datasets.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY)
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
        const defaultCard = createAutoBoundCard(datasets, datasets[0], 'line', t('cards.defaultLineTitle'))
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
          : [createAutoBoundCard(datasets, datasets[0], 'line', t('cards.defaultLineTitle'))]
        const restoredFilters = normalizeWorkspaceFilters(persisted, datasets)

        setCards(restoredCards)
        setWorkspaceFilters(restoredFilters)
        setFilterJoinOperator(persisted.filterJoinOperator ?? 'and')
        setActiveDatasetId(restoredActiveDatasetId)
        setSelectedCardId(restoredCards[0]?.id ?? null)
        setRecentDatasetIds(datasets.map((dataset) => dataset.id))
      } catch {
        const defaultCard = createAutoBoundCard(datasets, datasets[0], 'line', t('cards.defaultLineTitle'))
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
  }, [activeDatasetId, datasets, datasetsById, hasRestoredDatasets, t])

  useEffect(() => {
    if (!hasRestoredDatasets || datasets.length === 0) {
      return
    }

    const payload: PersistedState = {
      cards,
      workspaceFilters,
      filterJoinOperator,
      activeDatasetId,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [activeDatasetId, cards, datasets.length, filterJoinOperator, hasRestoredDatasets, workspaceFilters])

  useEffect(() => {
    if (cards.length === 0) {
      setSelectedCardId(null)
      return
    }

    if (!selectedCardId || !cards.some((card) => card.id === selectedCardId)) {
      setSelectedCardId(cards[0].id)
    }
  }, [cards, selectedCardId])

  useEffect(() => {
    if (!mobile || viewMode !== 'chart' || !selectedCardId) {
      setMobileInspectorOpen(false)
    }
  }, [mobile, selectedCardId, viewMode])

  useEffect(() => {
    if (!mobile || !hasDatasets) {
      setMobileActionsOpen(false)
    }
  }, [hasDatasets, mobile])

  const handleIncomingFiles = useCallback(async (
    files: File[],
    inputMethod: TrackingInputMethod = 'unknown',
  ) => {
    if (files.length === 0) {
      return []
    }

    setIsImporting(true)

    try {
      const result = await parseFiles(files)
      const { successes, parsed, failures } = result

      successes.forEach(({ dataset, file }) => {
        track('upload_csv', buildUploadCsvPayload(dataset, file, inputMethod))
        track('parse_success', buildParseSuccessPayload(dataset))
      })

      failures.forEach(({ error }) => {
        track('parse_fail', {
          reason: mapParseErrorToReason(error),
        })
      })

      if (parsed.length > 0) {
        setViewMode('chart')
        setActiveDatasetId(parsed[0].id)
        setRecentDatasetIds(parsed.map((dataset) => dataset.id))
      }

      return parsed
    } finally {
      setIsImporting(false)
    }
  }, [parseFiles])

  const handleLoadSample = useCallback(async (sampleId: SampleDatasetId) => {
    setIsImporting(true)

    try {
      const file = await loadSampleDatasetFile(sampleId)
      const parsed = await handleIncomingFiles([file], 'demo')

      if (parsed.length > 0) {
        track('load_demo_data', buildLanguagePayload(language))
      }
    } finally {
      setIsImporting(false)
    }
  }, [handleIncomingFiles, language])

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
        void handleIncomingFiles(files, 'drag_drop')
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
  }, [handleIncomingFiles])

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
      title: getLocalizedCardTitle(kind),
      xColumn: nextXColumn,
      series: autoSeries.length > 0 ? autoSeries : createCard(kind, activeDataset).series,
    })

    setCards((prev) => appendCardWithLayout(prev, nextCard))
    setSelectedCardId(nextCard.id)
    setViewMode('chart')
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
          const requestedYColumn = patch.datasetId && !patch.yColumn
            ? defaultY
            : (patch.yColumn ?? series.yColumn)
          const nextYColumn = nextDataset
            ? findAvailableSeriesYColumn(card, nextDataset, {
                preferredYColumn: requestedYColumn,
                excludeSeriesId: series.id,
              })
            : null

          if ((patch.datasetId !== undefined || patch.yColumn !== undefined) && nextDataset && nextYColumn === null) {
            return series
          }

          return {
            ...series,
            ...patch,
            label: patch.datasetId && nextDataset ? nextDataset.fileName : (patch.label ?? series.label),
            yColumn: nextDataset ? (nextYColumn ?? series.yColumn) : (patch.yColumn ?? series.yColumn),
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
      title: `${target.title} ${t('cards.copySuffix')}`,
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
      <AppNavbar hasDatasets={hasDatasets} mobile={mobile} viewMode={viewMode} onChangeViewMode={setViewMode} />

      <main className={hasDatasets && viewMode === 'chart' && !mobile
        ? 'grid min-h-0 grid-cols-[minmax(0,1fr)_var(--inspector-width)]'
        : 'grid min-h-0 grid-cols-1'}
      >
        <section className={`min-h-0 min-w-0 overflow-auto bg-base-100 ${showMobileBottomNav ? 'pb-16' : ''} ${showMobileInspectorTrigger && showMobileBottomNav ? 'pb-24' : ''}`}>
          {viewMode === 'data' && hasDatasets && (
            <DataView
              datasets={datasets}
              activeDatasetId={activeDatasetId}
              onSelectDataset={setActiveDatasetId}
            />
          )}

          {viewMode === 'chart' && hasDatasets && activeDataset && !mobile && (
            <WorkbenchHeader
              datasets={datasets}
              activeDatasetId={activeDataset.id}
              filters={workspaceFilters}
              filterJoinOperator={filterJoinOperator}
              onAddComponent={addCard}
              onUploadFiles={handleIncomingFiles}
              onResetDatasets={resetDatasets}
              onAddFilter={addFilter}
              onChangeFilterJoinOperator={setFilterJoinOperator}
              onChangeFilter={updateFilter}
              onRemoveFilter={removeFilter}
            />
          )}

          {!hasDatasets && (
            <HomeHero busy={isImporting} onLoadSample={handleLoadSample} onUploadFiles={handleIncomingFiles} />
          )}

          {viewMode === 'chart' && hasDatasets && cards.length > 0 && (
            <DashboardCanvas
              cards={displayCards}
              selectedCardId={selectedCardId}
              interactive={!mobile}
              compact={mobile}
              onSelectCard={setSelectedCardId}
              onLayoutChange={(cardId, layout) => {
                if (!mobile) {
                  setCards((prev) => moveCardToLayout(prev, cardId, layout))
                }
              }}
              renderCard={(card, controls) => (
                <ChartCard
                  key={card.id}
                  card={card}
                  datasetsById={datasetsById}
                  filteredRowsByDataset={filteredRowsByDataset}
                  filterRevision={filterRevision}
                  selected={controls.selected}
                  allowLayoutEditing={!mobile}
                  showCopyImage={!mobile}
                  mobileChrome={mobile}
                  onSelect={controls.onSelect}
                  onDragStart={controls.onDragStart}
                  onResizeStart={controls.onResizeStart}
                />
              )}
            />
          )}
        </section>
        {hasDatasets && viewMode === 'chart' && !mobile && (
          <aside className="min-h-0 overflow-auto border-l border-base-300 bg-base-100">
            {activeDataset && (
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
        )}
      </main>

      {showMobileInspectorTrigger && selectedCard && (
        <div className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom,0px)+4.25rem)] right-3 z-30 sm:hidden">
          <div className="pointer-events-auto">
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-primary-content shadow-[0_12px_28px_rgba(235,80,160,0.24)]"
              onClick={() => setMobileInspectorOpen(true)}
            >
              <SquarePen size={14} strokeWidth={2.1} />
              {t('inspector.mobileOpenButton')}
            </button>
          </div>
        </div>
      )}

      {showMobileBottomNav && (
        <MobileBottomNav
          activeView={viewMode}
          actionsOpen={mobileActionsOpen}
          onSelectView={(mode) => {
            setViewMode(mode)
            setMobileActionsOpen(false)
          }}
          onToggleActions={() => setMobileActionsOpen((current) => !current)}
        />
      )}

      <MobileInspectorDrawer
        open={mobileActionsOpen && showMobileBottomNav}
        eyebrow={t('mobileNav.actionsEyebrow')}
        title={t('mobileNav.actionsTitle')}
        closeLabel={t('mobileNav.closeActions')}
        onClose={() => setMobileActionsOpen(false)}
      >
        {activeDataset && (
          <WorkbenchHeader
            datasets={datasets}
            activeDatasetId={activeDataset.id}
            filters={workspaceFilters}
            filterJoinOperator={filterJoinOperator}
            mobileSheet
            onAddComponent={(kind) => {
              addCard(kind)
              setMobileActionsOpen(false)
            }}
            onUploadFiles={async (files, inputMethod) => {
              const parsed = await handleIncomingFiles(files, inputMethod)
              if (parsed.length > 0) {
                setMobileActionsOpen(false)
              }
              return parsed
            }}
            onResetDatasets={() => {
              resetDatasets()
              setMobileActionsOpen(false)
            }}
            onAddFilter={addFilter}
            onChangeFilterJoinOperator={setFilterJoinOperator}
            onChangeFilter={updateFilter}
            onRemoveFilter={removeFilter}
          />
        )}
      </MobileInspectorDrawer>

      <MobileInspectorDrawer
        open={mobileInspectorOpen && Boolean(selectedCard) && mobile && viewMode === 'chart'}
        eyebrow={t('inspector.mobileDrawerEyebrow')}
        title={selectedCard?.title ?? t('inspector.baseSectionTitle')}
        closeLabel={t('inspector.closeDrawer')}
        onClose={() => setMobileInspectorOpen(false)}
      >
        {activeDataset && selectedCard && (
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
      </MobileInspectorDrawer>

      {dragActive && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-neutral/10">
          <div className="grid min-w-[min(420px,calc(100vw-32px))] gap-3 rounded-[calc(var(--radius-box)+0.25rem)] border border-primary/35 bg-base-100/95 px-6 py-6 text-center backdrop-blur-md">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{uploadCopy.overlayBadge}</p>
            <strong className="text-lg font-semibold text-base-content">{uploadCopy.overlayTitle}</strong>
          </div>
        </div>
      )}
    </div>
  )
}
