import type {
  AggregationConfig,
  AggregationKind,
  CsvData,
  NormalizedRow,
  TimeBucket,
} from '../types'

export interface AggregatedPoint {
  x: string | number
  y: number | null
}

export interface AggregatedSeries {
  key: string
  name: string
  points: AggregatedPoint[]
  sourceDatasetIds: string[]
}

export interface SkippedDataset {
  datasetId: string
  fileName: string
  reason: 'missing-x-column' | 'missing-metric-column' | 'missing-group-column'
}

export interface AggregationResult {
  series: AggregatedSeries[]
  skippedDatasets: SkippedDataset[]
  skippedRows: number
}

interface BucketAccumulator {
  x: string | number
  sortValue: string | number
  numericValues: number[]
  rawValues: string[]
  rowCount: number
  missingCount: number
}

interface SeriesAccumulator {
  key: string
  name: string
  sourceDatasetIds: Set<string>
  buckets: Map<string, BucketAccumulator>
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function formatDate(date: Date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

function parseCommonDate(value: string): Date | null {
  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  const normalizedChinese = trimmed
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
  const normalizedSlash = normalizedChinese.replace(/\//g, '-')
  const isoLike = normalizedSlash.includes('T')
    ? normalizedSlash
    : normalizedSlash.replace(' ', 'T')
  const parsed = new Date(isoLike)

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed
}

function startOfUtcWeek(date: Date) {
  const day = date.getUTCDay() || 7
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - day + 1,
  ))
}

export function bucketDate(value: string, bucket: TimeBucket): string | null {
  const date = parseCommonDate(value)

  if (!date) {
    return null
  }

  switch (bucket) {
    case 'day':
      return formatDate(date)
    case 'week':
      return formatDate(startOfUtcWeek(date))
    case 'month':
      return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`
    case 'quarter':
      return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`
    case 'year':
      return String(date.getUTCFullYear())
    default:
      return formatDate(date)
  }
}

function validateDataset(dataset: CsvData, config: AggregationConfig): SkippedDataset | null {
  if (!dataset.headers.includes(config.xColumn)) {
    return {
      datasetId: dataset.id,
      fileName: dataset.fileName,
      reason: 'missing-x-column',
    }
  }

  if (!dataset.headers.includes(config.metricColumn)) {
    return {
      datasetId: dataset.id,
      fileName: dataset.fileName,
      reason: 'missing-metric-column',
    }
  }

  if (
    config.groupMode === 'field'
    && (!config.groupColumn || !dataset.headers.includes(config.groupColumn))
  ) {
    return {
      datasetId: dataset.id,
      fileName: dataset.fileName,
      reason: 'missing-group-column',
    }
  }

  return null
}

function resolveXValue(row: NormalizedRow, config: AggregationConfig) {
  if (config.xKind === 'time') {
    return bucketDate(row.raw[config.xColumn] ?? '', config.timeBucket)
  }

  if (config.xKind === 'number') {
    return row.numeric[config.xColumn]
  }

  return row.raw[config.xColumn] ?? ''
}

function getSeriesIdentity(dataset: CsvData, row: NormalizedRow, config: AggregationConfig) {
  if (config.groupMode === 'file') {
    return {
      key: dataset.id,
      name: dataset.fileName || dataset.id,
    }
  }

  const groupValue = config.groupColumn ? row.raw[config.groupColumn] ?? '' : ''
  const name = groupValue || '(empty)'

  return {
    key: name,
    name,
  }
}

function getOrCreateSeries(seriesMap: Map<string, SeriesAccumulator>, key: string, name: string) {
  const existing = seriesMap.get(key)

  if (existing) {
    return existing
  }

  const created: SeriesAccumulator = {
    key,
    name,
    sourceDatasetIds: new Set(),
    buckets: new Map(),
  }

  seriesMap.set(key, created)
  return created
}

function getOrCreateBucket(series: SeriesAccumulator, xValue: string | number) {
  const key = String(xValue)
  const existing = series.buckets.get(key)

  if (existing) {
    return existing
  }

  const created: BucketAccumulator = {
    x: xValue,
    sortValue: xValue,
    numericValues: [],
    rawValues: [],
    rowCount: 0,
    missingCount: 0,
  }

  series.buckets.set(key, created)
  return created
}

function median(values: number[]) {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function aggregateValues(bucket: BucketAccumulator, kind: AggregationKind): number | null {
  const values = bucket.numericValues

  switch (kind) {
    case 'sum':
      return values.reduce((sum, value) => sum + value, 0)
    case 'mean':
      return values.length === 0
        ? null
        : values.reduce((sum, value) => sum + value, 0) / values.length
    case 'count':
      return bucket.rowCount
    case 'max':
      return values.length === 0 ? null : Math.max(...values)
    case 'min':
      return values.length === 0 ? null : Math.min(...values)
    case 'median':
      return median(values)
    case 'distinctCount':
      return new Set(bucket.rawValues).size
    case 'missingCount':
      return bucket.missingCount
    case 'variance': {
      if (values.length === 0) {
        return null
      }

      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      return values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length
    }
    case 'stddev': {
      const variance = aggregateValues(bucket, 'variance')
      return variance === null ? null : Math.sqrt(variance)
    }
    default:
      return null
  }
}

function comparePoints(left: AggregatedPoint, right: AggregatedPoint) {
  if (typeof left.x === 'number' && typeof right.x === 'number') {
    return left.x - right.x
  }

  return String(left.x).localeCompare(String(right.x), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

export function buildAggregatedSeries(
  datasets: CsvData[],
  config: AggregationConfig,
  rowsByDataset: Record<string, NormalizedRow[]>,
): AggregationResult {
  const datasetMap = new Map(datasets.map((dataset) => [dataset.id, dataset]))
  const selectedDatasets = config.datasetIds
    .map((datasetId) => datasetMap.get(datasetId))
    .filter((dataset): dataset is CsvData => Boolean(dataset))
  const skippedDatasets: SkippedDataset[] = []
  const seriesMap = new Map<string, SeriesAccumulator>()
  let skippedRows = 0

  for (const dataset of selectedDatasets) {
    const invalid = validateDataset(dataset, config)

    if (invalid) {
      skippedDatasets.push(invalid)
      continue
    }

    for (const row of rowsByDataset[dataset.id] ?? dataset.rows) {
      const xValue = resolveXValue(row, config)

      if (xValue === null || xValue === '') {
        skippedRows += 1
        continue
      }

      const identity = getSeriesIdentity(dataset, row, config)
      const series = getOrCreateSeries(seriesMap, identity.key, identity.name)
      const bucket = getOrCreateBucket(series, xValue)
      const rawMetric = row.raw[config.metricColumn] ?? ''
      const numericMetric = row.numeric[config.metricColumn]

      series.sourceDatasetIds.add(dataset.id)
      bucket.rowCount += 1
      bucket.rawValues.push(rawMetric)

      if (numericMetric === null) {
        bucket.missingCount += 1
      } else {
        bucket.numericValues.push(numericMetric)
      }
    }
  }

  return {
    series: Array.from(seriesMap.values()).map((series) => ({
      key: series.key,
      name: series.name,
      sourceDatasetIds: Array.from(series.sourceDatasetIds),
      points: Array.from(series.buckets.values())
        .map((bucket) => ({
          x: bucket.x,
          y: aggregateValues(bucket, config.aggregation),
        }))
        .sort(comparePoints),
    })),
    skippedDatasets,
    skippedRows,
  }
}

export function toPlotSeries(result: AggregationResult) {
  return result.series.map((series) => ({
    key: series.key,
    name: series.name,
    x: series.points.map((point) => point.x),
    y: series.points.map((point) => point.y),
  }))
}
