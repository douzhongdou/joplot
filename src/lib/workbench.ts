import type {
  ChartCard,
  ChartKind,
  ColumnSummary,
  CsvData,
  DashboardLayout,
  FilterRule,
  NormalizedRow,
  RawCsvRow,
} from '../types'

const CARD_COLORS = ['#155eef', '#dd6b20', '#0f766e', '#b93815', '#3b3f98', '#7a3e9d']
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

function makeCardId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
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

export function buildDataset(headers: string[], rawRows: RawCsvRow[], fileName = ''): CsvData {
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
    fileName,
    headers,
    rows,
    numericColumns,
    rowCount: rows.length,
  }
}

export function createCard(
  kind: ChartKind,
  dataset: CsvData,
  overrides: Partial<ChartCard> = {},
): ChartCard {
  const xColumn = dataset.headers[0] ?? ''
  const defaultY =
    dataset.numericColumns.find((column) => column !== xColumn)
    ?? dataset.numericColumns[0]
    ?? null

  return {
    id: makeCardId(kind),
    kind,
    title: createCardTitle(kind),
    xColumn,
    yColumn: defaultY,
    color: CARD_COLORS[0],
    drawMode: kind === 'scatter' ? 'markers' : 'lines',
    lineWidth: 2,
    yMin: null,
    yMax: null,
    layout: createPresetLayout(0, kind),
    ...overrides,
  }
}

export function createDefaultCard(dataset: CsvData): ChartCard {
  const xColumn = dataset.headers[0] ?? ''
  const secondColumn = dataset.headers[1]
  const fallbackY =
    dataset.numericColumns.find((column) => column !== xColumn)
    ?? dataset.numericColumns[0]
    ?? null

  return createCard('line', dataset, {
    title: '默认折线图',
    xColumn,
    yColumn:
      secondColumn && dataset.numericColumns.includes(secondColumn)
        ? secondColumn
        : fallbackY,
    layout: createPresetLayout(0, 'line'),
  })
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

export function applyFilters(rows: NormalizedRow[], filters: FilterRule[]): NormalizedRow[] {
  return rows.filter((row) =>
    filters.every((filter) => {
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
    }),
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

export function sanitizeCardsForDataset(cards: ChartCard[], dataset: CsvData): ChartCard[] {
  return resolveCardLayouts(cards.map((card, index) => {
    const fallback = createCard(card.kind, dataset, {
      color: CARD_COLORS[index % CARD_COLORS.length],
      layout: createPresetLayout(index, card.kind),
    })
    const xColumn = dataset.headers.includes(card.xColumn) ? card.xColumn : fallback.xColumn
    const yColumn = card.yColumn && dataset.numericColumns.includes(card.yColumn)
      ? card.yColumn
      : fallback.yColumn

    return {
      ...fallback,
      ...card,
      xColumn,
      yColumn,
      color: card.color || fallback.color,
      layout: clampLayout(card.layout ?? fallback.layout),
    }
  }))
}
