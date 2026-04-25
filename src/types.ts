export type ChartKind = 'line' | 'scatter' | 'bar' | 'stats' | 'area' | 'radar' | 'heatmap'
export type FilterOperator = 'contains' | 'equals' | 'gt' | 'lt' | 'between'
export type FilterJoinOperator = 'and' | 'or'
export type DrawMode = 'lines' | 'spline' | 'lines+markers' | 'markers'
export type ChartDataMode = 'raw' | 'aggregate'
export type AxisValueKind = 'category' | 'number' | 'time'
export type TimeBucket = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type AggregationKind =
  | 'sum'
  | 'mean'
  | 'count'
  | 'max'
  | 'min'
  | 'median'
  | 'distinctCount'
  | 'missingCount'
  | 'stddev'
  | 'variance'
export type AggregationGroupMode = 'file' | 'field'

export type RawCsvRow = Record<string, string>
export type NumericRow = Record<string, number | null>

export interface DashboardLayout {
  x: number
  y: number
  w: number
  h: number
}

export interface AxisRange {
  min: string
  max: string
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

export interface AggregationConfig {
  datasetIds: string[]
  xColumn: string
  xKind: AxisValueKind
  timeBucket: TimeBucket
  groupMode: AggregationGroupMode
  groupColumn: string | null
  metricColumn: string
  aggregation: AggregationKind
}

export type ChartDataConfig =
  | { mode: 'raw' }
  | { mode: 'aggregate'; aggregation: AggregationConfig }

export interface ChartCard {
  id: string
  kind: ChartKind
  title: string
  dataConfig: ChartDataConfig
  xColumn: string
  series: ChartSeries[]
  drawMode: DrawMode
  lineWidth: number
  showLegend: boolean
  showGrid: boolean
  showAxes: boolean
  xRange: AxisRange
  yRange: AxisRange
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
