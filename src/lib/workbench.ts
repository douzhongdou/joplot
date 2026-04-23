import type {
  AxisRange,
  ChartCard,
  ChartKind,
  ChartSeries,
  ColumnSummary,
  CsvData,
  DashboardLayout,
  FilterJoinOperator,
  FilterRule,
  NormalizedRow,
  RawCsvRow,
} from '../types'
import { getChartColor, isHexChartColor } from './theme.ts'

export const DASHBOARD_COLUMNS = 12
export const DASHBOARD_MIN_WIDTH = 3
export const DASHBOARD_MIN_HEIGHT = 4

function toNumber(value: string | undefined): number | null {
  if (value === undefined) {
    return null
  }

  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function slugify(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'dataset'
}

function makeCardId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function makeSeriesId(prefix: string): string {
  return `${prefix}-series-${Math.random().toString(36).slice(2, 10)}`
}

function createCardTitle(kind: ChartKind): string {
  switch (kind) {
    case 'line':
      return '折线图'
    case 'scatter':
      return '散点图'
    case 'bar':
      return '柱状图'
    case 'stats':
      return '统计卡'
    default:
      return '图卡'
  }
}

function createPresetLayout(index: number, kind: ChartKind): DashboardLayout {
  if (index === 0) {
    return { x: 0, y: 0, w: 12, h: 8 }
  }

  const slot = index - 1
  const baseY = 8 + Math.floor(slot / 2) * 7

  return {
    x: (slot % 2) * 6,
    y: baseY,
    w: 6,
    h: kind === 'stats' ? 5 : 7,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getDefaultYColumn(dataset: CsvData, xColumn: string) {
  return dataset.numericColumns.find((column) => column !== xColumn)
    ?? dataset.numericColumns[0]
    ?? null
}

function buildSeriesBindingKey(datasetId: string, yColumn: string | null) {
  return yColumn ? `${datasetId}:${yColumn}` : null
}

function listPreferredYColumns(dataset: CsvData, xColumn: string) {
  const nonXColumns = dataset.numericColumns.filter((column) => column !== xColumn)
  const xColumnFallback = dataset.numericColumns.includes(xColumn) ? [xColumn] : []

  return [...nonXColumns, ...xColumnFallback]
}

export function listAvailableSeriesYColumns(
  card: Pick<ChartCard, 'xColumn' | 'series'>,
  dataset: CsvData,
  options: {
    excludeSeriesId?: string | null
  } = {},
) {
  const usedBindings = new Set(
    card.series
      .filter((series) => series.id !== options.excludeSeriesId)
      .map((series) => buildSeriesBindingKey(series.datasetId, series.yColumn))
      .filter((binding): binding is string => binding !== null),
  )

  return listPreferredYColumns(dataset, card.xColumn)
    .filter((column) => !usedBindings.has(buildSeriesBindingKey(dataset.id, column)!))
}

function getSeriesLabel(dataset: CsvData, fallback: string) {
  return dataset.fileName || fallback
}

function buildDatasetMap(datasets: CsvData[]) {
  return Object.fromEntries(datasets.map((dataset) => [dataset.id, dataset]))
}

function createEmptyAxisRange(): AxisRange {
  return { min: '', max: '' }
}

function normalizeAxisRange(value: unknown, fallback: AxisRange = createEmptyAxisRange()): AxisRange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }

  const candidate = value as Partial<AxisRange>

  return {
    min: typeof candidate.min === 'string' ? candidate.min : fallback.min,
    max: typeof candidate.max === 'string' ? candidate.max : fallback.max,
  }
}

function axisRangeFromLegacyYBounds(card: ChartCard): AxisRange {
  if (card.yMin !== null && card.yMax !== null && card.yMin < card.yMax) {
    return {
      min: String(card.yMin),
      max: String(card.yMax),
    }
  }

  return createEmptyAxisRange()
}

export function clampLayout(layout: DashboardLayout): DashboardLayout {
  const w = clamp(Math.round(layout.w), DASHBOARD_MIN_WIDTH, DASHBOARD_COLUMNS)
  const h = Math.max(Math.round(layout.h), DASHBOARD_MIN_HEIGHT)
  const x = clamp(Math.round(layout.x), 0, DASHBOARD_COLUMNS - w)
  const y = Math.max(Math.round(layout.y), 0)

  return { x, y, w, h }
}

function layoutsOverlap(left: DashboardLayout, right: DashboardLayout) {
  return (
    left.x < right.x + right.w
    && left.x + left.w > right.x
    && left.y < right.y + right.h
    && left.y + left.h > right.y
  )
}

function resolveCardLayouts(cards: ChartCard[], pinnedId?: string): ChartCard[] {
  const pinnedCard = pinnedId ? cards.find((card) => card.id === pinnedId) ?? null : null
  const placed = new Map<string, ChartCard>()
  const occupied: ChartCard[] = []

  if (pinnedCard) {
    const clampedPinned = { ...pinnedCard, layout: clampLayout(pinnedCard.layout) }
    placed.set(clampedPinned.id, clampedPinned)
    occupied.push(clampedPinned)
  }

  for (const card of cards) {
    if (card.id === pinnedId) {
      continue
    }

    let nextLayout = clampLayout(card.layout)

    while (occupied.some((occupiedCard) => layoutsOverlap(nextLayout, occupiedCard.layout))) {
      const blockers = occupied.filter((occupiedCard) => layoutsOverlap(nextLayout, occupiedCard.layout))
      nextLayout = {
        ...nextLayout,
        y: Math.max(...blockers.map((occupiedCard) => occupiedCard.layout.y + occupiedCard.layout.h)),
      }
    }

    const nextCard = { ...card, layout: nextLayout }
    placed.set(nextCard.id, nextCard)
    occupied.push(nextCard)
  }

  return cards.map((card, index) => {
    const placedCard = placed.get(card.id)
    if (placedCard) {
      return placedCard
    }

    const fallback = { ...card, layout: createPresetLayout(index, card.kind) }
    return { ...fallback, layout: clampLayout(fallback.layout) }
  })
}

export function buildDataset(
  headers: string[],
  rawRows: RawCsvRow[],
  fileName = '',
  id = slugify(fileName || 'dataset'),
): CsvData {
  const rows = rawRows.map<NormalizedRow>((rawRow) => {
    const normalizedRaw = headers.reduce<RawCsvRow>((accumulator, header) => {
      accumulator[header] = rawRow[header] ?? ''
      return accumulator
    }, {})

    const numeric = headers.reduce<Record<string, number | null>>((accumulator, header) => {
      accumulator[header] = toNumber(normalizedRaw[header])
      return accumulator
    }, {})

    return { raw: normalizedRaw, numeric }
  })

  const numericColumns = headers.filter((header) =>
    rows.some((row) => row.numeric[header] !== null),
  )

  return {
    id,
    fileName,
    headers,
    rows,
    numericColumns,
    rowCount: rows.length,
  }
}

export function createCardSeries(
  dataset: CsvData,
  xColumn: string,
  overrides: Partial<ChartSeries> = {},
): ChartSeries {
  return {
    id: makeSeriesId(dataset.id),
    datasetId: dataset.id,
    label: getSeriesLabel(dataset, '数据系列'),
    yColumn: getDefaultYColumn(dataset, xColumn),
    color: getChartColor(0),
    ...overrides,
  }
}

export function findAvailableSeriesYColumn(
  card: Pick<ChartCard, 'xColumn' | 'series'>,
  dataset: CsvData,
  options: {
    preferredYColumn?: string | null
    excludeSeriesId?: string | null
  } = {},
) {
  if (!dataset.headers.includes(card.xColumn)) {
    return null
  }

  const usedBindings = new Set(
    card.series
      .filter((series) => series.id !== options.excludeSeriesId)
      .map((series) => buildSeriesBindingKey(series.datasetId, series.yColumn))
      .filter((binding): binding is string => binding !== null),
  )
  const candidateColumns = listAvailableSeriesYColumns(card, dataset, {
    excludeSeriesId: options.excludeSeriesId,
  })

  if (
    options.preferredYColumn
    && listPreferredYColumns(dataset, card.xColumn).includes(options.preferredYColumn)
    && !usedBindings.has(buildSeriesBindingKey(dataset.id, options.preferredYColumn)!)
  ) {
    return options.preferredYColumn
  }

  return candidateColumns.find((column) => !usedBindings.has(buildSeriesBindingKey(dataset.id, column)!))
    ?? null
}

export function createCard(
  kind: ChartKind,
  dataset: CsvData,
  overrides: Partial<ChartCard> = {},
): ChartCard {
  const xColumn = dataset.headers[0] ?? ''
  const initialSeries = createCardSeries(dataset, xColumn)

  return {
    id: makeCardId(kind),
    kind,
    title: createCardTitle(kind),
    dataConfig: { mode: 'raw' },
    xColumn,
    series: [initialSeries],
    drawMode: kind === 'scatter' ? 'markers' : 'lines',
    lineWidth: 2,
    showLegend: true,
    showGrid: true,
    showAxes: true,
    xRange: createEmptyAxisRange(),
    yRange: createEmptyAxisRange(),
    yMin: null,
    yMax: null,
    layout: createPresetLayout(0, kind),
    ...overrides,
  }
}

export function createDefaultCard(dataset: CsvData): ChartCard {
  const xColumn = dataset.headers[0] ?? ''
  const secondColumn = dataset.headers[1]
  const fallbackY = getDefaultYColumn(dataset, xColumn)

  return createCard('line', dataset, {
    title: '默认折线图',
    xColumn,
    series: [
      createCardSeries(dataset, xColumn, {
        yColumn:
          secondColumn && dataset.numericColumns.includes(secondColumn)
            ? secondColumn
            : fallbackY,
      }),
    ],
    layout: createPresetLayout(0, 'line'),
  })
}

export function appendCardSeries(
  card: ChartCard,
  dataset: CsvData,
  overrides: Partial<ChartSeries> = {},
): ChartCard {
  if (!dataset.headers.includes(card.xColumn)) {
    return card
  }

  const nextYColumn = findAvailableSeriesYColumn(card, dataset, {
    preferredYColumn: overrides.yColumn,
  })

  if (nextYColumn === null) {
    return card
  }

  const nextSeries = createCardSeries(dataset, card.xColumn, {
    color: getChartColor(card.series.length),
    yColumn: nextYColumn,
    ...overrides,
  })

  if (nextSeries.yColumn === null) {
    return card
  }

  return {
    ...card,
    series: [...card.series, nextSeries],
  }
}

export function createAutoSeriesForDatasets(
  datasets: CsvData[],
  xColumn: string,
  limit?: number,
): ChartSeries[] {
  const series: ChartSeries[] = []

  for (const dataset of datasets) {
    if (!dataset.headers.includes(xColumn)) {
      continue
    }

    const nextYColumn = findAvailableSeriesYColumn(
      { xColumn, series },
      dataset,
    )

    if (nextYColumn === null) {
      continue
    }

    series.push(createCardSeries(dataset, xColumn, {
      color: getChartColor(series.length),
      yColumn: nextYColumn,
    }))

    if (series.length >= (limit ?? datasets.length)) {
      break
    }
  }

  return series
}

export function appendCardWithLayout(cards: ChartCard[], card: ChartCard): ChartCard[] {
  const nextCard = {
    ...card,
    layout: clampLayout(card.layout ?? createPresetLayout(cards.length, card.kind)),
  }

  if (!card.layout) {
    nextCard.layout = createPresetLayout(cards.length, card.kind)
  } else if (cards.some((existingCard) => existingCard.id === card.id)) {
    nextCard.layout = createPresetLayout(cards.length, card.kind)
  } else if (nextCard.layout.x === 0 && nextCard.layout.y === 0 && cards.length > 0) {
    nextCard.layout = createPresetLayout(cards.length, card.kind)
  }

  return resolveCardLayouts([...cards, nextCard], nextCard.id)
}

export function moveCardToLayout(cards: ChartCard[], cardId: string, layout: DashboardLayout): ChartCard[] {
  return resolveCardLayouts(
    cards.map((card) => (card.id === cardId ? { ...card, layout } : card)),
    cardId,
  )
}

function evaluateFilter(row: NormalizedRow, filter: FilterRule): boolean {
  const rawValue = row.raw[filter.column] ?? ''
  const numericValue = row.numeric[filter.column]

  switch (filter.operator) {
    case 'contains':
      return rawValue.toLowerCase().includes(filter.value.toLowerCase())
    case 'equals':
      return rawValue === filter.value
    case 'gt':
      return numericValue !== null && numericValue > Number(filter.value)
    case 'lt':
      return numericValue !== null && numericValue < Number(filter.value)
    case 'between': {
      const lower = Number(filter.value)
      const upper = Number(filter.valueTo ?? filter.value)
      return numericValue !== null && numericValue >= lower && numericValue <= upper
    }
    default:
      return true
  }
}

export function buildFilteredRowsByDataset(
  datasets: CsvData[],
  filters: FilterRule[],
  joinOperator: FilterJoinOperator,
): Record<string, NormalizedRow[]> {
  return Object.fromEntries(
    datasets.map((dataset) => [
      dataset.id,
      dataset.rows.filter((row) => {
        const applicableFilters = filters.filter((filter) => dataset.headers.includes(filter.column))

        if (applicableFilters.length === 0) {
          return true
        }

        if (joinOperator === 'or') {
          return applicableFilters.some((filter) => evaluateFilter(row, filter))
        }

        return applicableFilters.every((filter) => evaluateFilter(row, filter))
      }),
    ]),
  )
}

export function summarizeNumericColumn(rows: NormalizedRow[], column: string): ColumnSummary {
  const values = rows
    .map((row) => row.numeric[column])
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)

  if (values.length === 0) {
    return {
      count: 0,
      missing: rows.length,
      min: null,
      max: null,
      mean: null,
      median: null,
    }
  }

  const middle = Math.floor(values.length / 2)
  const median = values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle]
  const total = values.reduce((sum, value) => sum + value, 0)

  return {
    count: values.length,
    missing: rows.length - values.length,
    min: values[0],
    max: values[values.length - 1],
    mean: total / values.length,
    median,
  }
}

export function sampleRows(rows: NormalizedRow[], maxPoints: number): NormalizedRow[] {
  if (rows.length <= maxPoints || maxPoints <= 1) {
    return rows
  }

  const lastIndex = rows.length - 1
  const result: NormalizedRow[] = []

  for (let index = 0; index < maxPoints; index += 1) {
    const targetIndex = Math.round((index / (maxPoints - 1)) * lastIndex)
    result.push(rows[targetIndex])
  }

  return result
}

export function sanitizeCardsForDatasets(
  cards: ChartCard[],
  datasets: CsvData[],
  activeDatasetId?: string | null,
): ChartCard[] {
  if (datasets.length === 0) {
    return []
  }

  const datasetMap = buildDatasetMap(datasets)
  const fallbackDataset =
    (activeDatasetId ? datasetMap[activeDatasetId] : undefined)
    ?? datasets[0]

  return resolveCardLayouts(cards.map((card, index) => {
    const legacyCard = card as ChartCard & { yColumn?: string | null; color?: string }
    const rawSeries = Array.isArray(legacyCard.series) && legacyCard.series.length > 0
      ? legacyCard.series
      : [createCardSeries(fallbackDataset, legacyCard.xColumn ?? fallbackDataset.headers[0] ?? '', {
          yColumn: legacyCard.yColumn ?? getDefaultYColumn(fallbackDataset, legacyCard.xColumn ?? fallbackDataset.headers[0] ?? ''),
          color: legacyCard.color ?? getChartColor(0),
        })]
    const primaryDataset =
      rawSeries
        .map((series) => datasetMap[series.datasetId])
        .find((dataset): dataset is CsvData => Boolean(dataset))
      ?? fallbackDataset

    const fallbackXColumn = primaryDataset.headers[0] ?? ''
    const xColumn = primaryDataset.headers.includes(card.xColumn) ? card.xColumn : fallbackXColumn
    const seenBindings = new Set<string>()
    const validSeries = rawSeries
      .map<ChartSeries | null>((series, seriesIndex) => {
        const dataset = datasetMap[series.datasetId]

        if (!dataset || !dataset.headers.includes(xColumn)) {
          return null
        }

        const yColumn = series.yColumn && dataset.numericColumns.includes(series.yColumn)
          ? series.yColumn
          : getDefaultYColumn(dataset, xColumn)

        if (yColumn === null) {
          return null
        }

        const bindingKey = buildSeriesBindingKey(dataset.id, yColumn)

        if (!bindingKey || seenBindings.has(bindingKey)) {
          return null
        }

        seenBindings.add(bindingKey)

        return {
          ...createCardSeries(dataset, xColumn, {
            color: getChartColor(seriesIndex),
          }),
          ...series,
          yColumn,
          label: series.label || getSeriesLabel(dataset, `数据系列 ${seriesIndex + 1}`),
          color: isHexChartColor(series.color) ? series.color : getChartColor(seriesIndex),
        }
      })
      .filter((series): series is ChartSeries => series !== null)

    const cardWithLegacyFields = card as ChartCard & {
      dataConfig?: ChartCard['dataConfig']
      xRange?: AxisRange
      yRange?: AxisRange
    }

    return {
      ...createCard(card.kind, fallbackDataset, {
        layout: createPresetLayout(index, card.kind),
      }),
      ...card,
      dataConfig: cardWithLegacyFields.dataConfig ?? { mode: 'raw' },
      xColumn,
      series: validSeries.length > 0 ? validSeries : [createCardSeries(fallbackDataset, xColumn)],
      xRange: normalizeAxisRange(cardWithLegacyFields.xRange),
      yRange: normalizeAxisRange(cardWithLegacyFields.yRange, axisRangeFromLegacyYBounds(card)),
      layout: clampLayout(card.layout ?? createPresetLayout(index, card.kind)),
    }
  }))
}
