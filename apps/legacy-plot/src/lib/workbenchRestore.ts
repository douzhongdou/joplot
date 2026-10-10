import type { ChartCard as ChartCardConfig, ChartSeries, CsvData, FilterJoinOperator, FilterRule } from '../types'
import { appendCardWithLayout, createCard, createCardSeries, createAutoSeriesForDatasets, sanitizeCardsForDatasets } from './workbench.ts'
import { getChartColor } from './theme.ts'

export interface PersistedState {
  cards?: ChartCardConfig[]
  filters?: FilterRule[]
  filtersByDataset?: Record<string, FilterRule[]>
  workspaceFilters?: FilterRule[]
  filterJoinOperator?: FilterJoinOperator
  activeDatasetId?: string | null
}

export function buildAutoBoundSeries(
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

export function pickBestSharedXColumn(datasets: CsvData[], primaryDataset: CsvData) {
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


/** Restore the dashboard before adding a chart for a function-studio transfer. */
export function restoreWorkbench(
  serialized: string | null,
  datasets: CsvData[],
  pendingDatasetIds: string[],
  defaultTitle: string,
) {
  const datasetsById = new Map(datasets.map((dataset) => [dataset.id, dataset]))
  const pendingDatasets = [...new Set(pendingDatasetIds)]
    .map((id) => datasetsById.get(id))
    .filter((dataset): dataset is CsvData => Boolean(dataset))
  const pendingIds = new Set(pendingDatasets.map((dataset) => dataset.id))
  const existingDatasets = datasets.filter((dataset) => !pendingIds.has(dataset.id))

  let cards: ChartCardConfig[] = []
  let workspaceFilters: FilterRule[] = []
  let filterJoinOperator: FilterJoinOperator = 'and'
  let activeDatasetId = datasets[0]?.id ?? null

  try {
    const persisted = JSON.parse(serialized ?? '{}') as PersistedState
    activeDatasetId = persisted.activeDatasetId && datasetsById.has(persisted.activeDatasetId)
      ? persisted.activeDatasetId
      : activeDatasetId
    workspaceFilters = normalizeWorkspaceFilters(persisted, datasets)
    filterJoinOperator = persisted.filterJoinOperator ?? 'and'
    if (persisted.cards?.length) {
      cards = sanitizeCardsForDatasets(persisted.cards, datasets, activeDatasetId)
    }
  } catch {
    workspaceFilters = []
    filterJoinOperator = 'and'
    activeDatasetId = datasets[0]?.id ?? null
  }

  // A new workspace needs just the sent chart. On recovery, keep a default
  // chart for older datasets as well, without mixing in the sent curves.
  if (cards.length === 0 && existingDatasets.length > 0) {
    cards = [createAutoBoundCard(existingDatasets, existingDatasets[0], 'line', defaultTitle)]
  }

  const sentCard = pendingDatasets.length > 0
    ? createAutoBoundCard(
        pendingDatasets,
        pendingDatasets[0],
        'line',
        pendingDatasets.length === 1 ? pendingDatasets[0].fileName : defaultTitle,
      )
    : null
  if (sentCard) {
    cards = appendCardWithLayout(cards, sentCard)
    activeDatasetId = pendingDatasets[0].id
  }

  return {
    cards,
    workspaceFilters,
    filterJoinOperator,
    activeDatasetId,
    selectedCardId: sentCard?.id ?? cards[0]?.id ?? null,
  }
}
