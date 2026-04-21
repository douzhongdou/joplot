import type {
  ChartCard,
  ChartKind,
  ColumnSummary,
  CsvData,
  FilterRule,
  NormalizedRow,
  RawCsvRow,
} from '../types'

const CARD_COLORS = ['#1f77b4', '#ff7f0e', '#2a9d8f', '#e76f51', '#264653', '#8ab17d']

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

export function buildDataset(headers: string[], rawRows: RawCsvRow[]): CsvData {
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
    title: kind === 'stats' ? '统计指标卡' : `${kind.toUpperCase()} 图表`,
    xColumn,
    yColumn: defaultY,
    color: CARD_COLORS[0],
    drawMode: kind === 'scatter' ? 'markers' : 'lines',
    lineWidth: 2,
    yMin: null,
    yMax: null,
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
  })
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
  return cards.map((card, index) => {
    const fallback = createCard(card.kind, dataset, { color: CARD_COLORS[index % CARD_COLORS.length] })
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
    }
  })
}
