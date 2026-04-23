export type ChartKind = 'line' | 'scatter' | 'bar' | 'stats'
export type FilterOperator = 'contains' | 'equals' | 'gt' | 'lt' | 'between'
export type FilterJoinOperator = 'and' | 'or'
export type DrawMode = 'lines' | 'lines+markers' | 'markers'

export type RawCsvRow = Record<string, string>
export type NumericRow = Record<string, number | null>

export interface DashboardLayout {
  x: number
  y: number
  w: number
  h: number
}

export interface NormalizedRow {
  raw: RawCsvRow
  numeric: NumericRow
}

export interface CsvData {
  id: string
  fileName: string
  headers: string[]
  rows: NormalizedRow[]
  numericColumns: string[]
  rowCount: number
}

export interface FilterRule {
  id: string
  column: string
  operator: FilterOperator
  value: string
  valueTo?: string
}

export interface ChartSeries {
  id: string
  datasetId: string
  label: string
  yColumn: string | null
  color: string
}

export interface ChartCard {
  id: string
  kind: ChartKind
  title: string
  xColumn: string
  series: ChartSeries[]
  drawMode: DrawMode
  lineWidth: number
  showLegend: boolean
  showGrid: boolean
  showAxes: boolean
  yMin: number | null
  yMax: number | null
  layout: DashboardLayout
}

export interface ColumnSummary {
  count: number
  missing: number
  min: number | null
  max: number | null
  mean: number | null
  median: number | null
}
