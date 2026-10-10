import type { PointPair, SuperColumn, SuperDataset, SuperNumericColumn } from '../types.ts'

export function getColumn(dataset: SuperDataset, name: string): SuperColumn | undefined {
  return dataset.columns.find((column) => column.name === name)
}

export function getNumericColumn(dataset: SuperDataset, name: string): SuperNumericColumn | null {
  const column = getColumn(dataset, name)
  return column && column.kind === 'number' ? column : null
}

export interface SeriesStats {
  count: number
  min: number
  max: number
  mean: number
  rms: number
  peakToPeak: number
  std: number
}

export function computeSeriesStats(values: Float64Array): SeriesStats {
  let count = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  let sumSquares = 0

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (Number.isNaN(value)) {
      continue
    }
    count += 1
    sum += value
    sumSquares += value * value
    if (value < min) {
      min = value
    }
    if (value > max) {
      max = value
    }
  }

  if (count === 0) {
    return { count: 0, min: Number.NaN, max: Number.NaN, mean: Number.NaN, rms: Number.NaN, peakToPeak: Number.NaN, std: Number.NaN }
  }

  const mean = sum / count
  const variance = Math.max(0, sumSquares / count - mean * mean)

  return {
    count,
    min,
    max,
    mean,
    rms: Math.sqrt(sumSquares / count),
    peakToPeak: max - min,
    std: Math.sqrt(variance),
  }
}

export function extractNumericValues(dataset: SuperDataset, yColumn: string): Float64Array {
  const column = getNumericColumn(dataset, yColumn)
  return column ? column.values : new Float64Array(0)
}

/**
 * 取出绘图用的 x/y。x 列缺失或为字符串列时回退为行下标，保证始终能出图。
 */
export function extractSeries(
  dataset: SuperDataset,
  xColumn: string | null,
  yColumn: string,
): PointPair {
  const y = getNumericColumn(dataset, yColumn)

  if (!y) {
    return { x: new Float64Array(0), y: new Float64Array(0) }
  }

  const x = xColumn ? getNumericColumn(dataset, xColumn) : null
  const count = Math.min(dataset.rowCount, y.values.length)

  if (x && x.values.length >= count) {
    return { x: x.values.slice(0, count), y: y.values.slice(0, count) }
  }

  const indexX = new Float64Array(count)
  for (let i = 0; i < count; i += 1) {
    indexX[i] = i
  }

  return { x: indexX, y: y.values.slice(0, count) }
}

function lowerBound(values: Float64Array, target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (values[mid] < target) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

function upperBound(values: Float64Array, target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (values[mid] <= target) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

/**
 * 只截取 [min, max] 窗口内的原始样本，避免为了局部重绘而复制整列。
 */
export function extractSeriesWindow(
  dataset: SuperDataset,
  xColumn: string | null,
  yColumn: string,
  range: { min: number; max: number } | null,
): PointPair {
  const y = getNumericColumn(dataset, yColumn)
  if (!y) {
    return { x: new Float64Array(0), y: new Float64Array(0) }
  }

  const count = Math.min(dataset.rowCount, y.values.length)
  const x = xColumn ? getNumericColumn(dataset, xColumn) : null

  if (x && x.values.length >= count) {
    if (!range) {
      return { x: x.values.slice(0, count), y: y.values.slice(0, count) }
    }
    const start = lowerBound(x.values, range.min)
    const end = Math.min(count, upperBound(x.values, range.max))
    if (end <= start) {
      return { x: new Float64Array(0), y: new Float64Array(0) }
    }
    return { x: x.values.slice(start, end), y: y.values.slice(start, end) }
  }

  if (!range) {
    const indices = new Float64Array(count)
    for (let i = 0; i < count; i += 1) {
      indices[i] = i
    }
    return { x: indices, y: y.values.slice(0, count) }
  }

  const start = Math.max(0, Math.min(count, Math.floor(range.min)))
  const end = Math.max(start, Math.min(count, Math.ceil(range.max) + 1))
  const indices = new Float64Array(end - start)
  for (let i = start; i < end; i += 1) {
    indices[i - start] = i
  }
  return { x: indices, y: y.values.slice(start, end) }
}

export function resolveSpectrumSampleRate(dataset: SuperDataset): number | null {
  if (dataset.sampleRate && dataset.sampleRate > 0) {
    return dataset.sampleRate
  }

  return null
}

export function resolveDefaultSignalColumn(dataset: SuperDataset, xColumn: string | null): string | null {
  const numeric = dataset.numericColumns.filter((name) => name !== xColumn)
  if (numeric.length > 0) {
    return numeric[0]
  }

  return dataset.numericColumns[0] ?? null
}
