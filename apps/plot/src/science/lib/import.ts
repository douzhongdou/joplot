import type { SuperColumn, SuperDataset, SuperNumericColumn } from '../../superplot/types.ts'
import type { Series } from '../types.ts'
import { createDense } from './dense.ts'

export function numericColumn(dataset: SuperDataset, name: string): SuperNumericColumn | undefined {
  const column = dataset.columns.find((candidate) => candidate.name === name)
  return column?.kind === 'number' ? column : undefined
}

function inferUniformSampleRate(x: Float64Array): number | undefined {
  if (x.length < 2) return undefined
  const step = x[1] - x[0]
  if (!Number.isFinite(step) || step <= 0) return undefined
  for (let index = 2; index < x.length; index += 1) {
    const next = x[index] - x[index - 1]
    if (!Number.isFinite(next) || Math.abs(next - step) > Math.abs(step) * 0.01) return undefined
  }
  const rate = 1 / step
  return Number.isFinite(rate) ? rate : undefined
}

function axisUnit(name: string): string {
  if (!name) return 'sample'
  if (/(?:^|[_\s(])(?:ms|millisecond|毫秒)(?:$|[_\s)])/i.test(name)) return 'ms'
  if (/(?:^|[_\s(])(?:s|sec|second|seconds|秒)(?:$|[_\s)])/i.test(name)) return 's'
  return name
}

/** 读取分组列在某一行的取值；数值列按原值字符串化。 */
function groupValueAt(column: SuperColumn, index: number): string {
  if (column.kind === 'string') return column.values[index] ?? ''
  const value = column.values[index]
  return Number.isFinite(value) ? String(value) : ''
}

/** 一段连续（同组）的数据。无分组时只有一段，key 为空串。 */
interface SeriesSegment {
  key: string
  x: Float64Array
  y: Float64Array
}

/**
 * 把 Y 列按行拆成若干段：给了分组列就按它的取值分段（首次出现顺序稳定），
 * 否则整列一段。缺失 X/Y 的行会被剔除。
 */
function buildSegments(
  dataset: SuperDataset,
  xName: string,
  yName: string,
  groupColumn: string,
): SeriesSegment[] {
  const yColumn = numericColumn(dataset, yName)
  if (!yColumn) throw new Error(`Numeric Y column "${yName}" is unavailable`)
  const xColumn = xName ? numericColumn(dataset, xName) : undefined
  if (xName && !xColumn) throw new Error(`Numeric X column "${xName}" is unavailable`)
  if (xName === yName) throw new Error('X and Y must be different columns')

  const group = groupColumn ? dataset.columns.find((candidate) => candidate.name === groupColumn) : undefined
  const buckets = new Map<string, { x: number[]; y: number[] }>()

  for (let index = 0; index < dataset.rowCount; index += 1) {
    const x = xColumn ? xColumn.values[index] : index
    const y = yColumn.values[index]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const key = group ? groupValueAt(group, index) : ''
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { x: [], y: [] }
      buckets.set(key, bucket)
    }
    bucket.x.push(x)
    bucket.y.push(y)
  }

  return [...buckets.entries()].map(([key, bucket]) => ({
    key,
    x: Float64Array.from(bucket.x),
    y: Float64Array.from(bucket.y),
  }))
}

function segmentToSeries(
  dataset: SuperDataset,
  xName: string,
  yName: string,
  id: string,
  name: string,
  segment: SeriesSegment,
): Series {
  return {
    id,
    name,
    kind: 'series',
    x: createDense(segment.x),
    y: createDense(segment.y),
    sampleRate: inferUniformSampleRate(segment.x),
    xUnit: axisUnit(xName),
    provenance: `${dataset.fileName}: ${xName || 'row'} → ${yName}${segment.key ? ` [${segment.key}]` : ''} (${segment.x.length}/${dataset.rowCount} rows)`,
  }
}

/** 从单个 Y 列构建一条分析序列（不做分组）。 */
export function seriesFromDataset(dataset: SuperDataset, xName: string, yName: string, id = 'signal'): Series {
  const segments = buildSegments(dataset, xName, yName, '')
  const segment = segments[0]
  if (!segment || segment.x.length < 2) {
    throw new Error('At least two rows with finite X and Y values are required')
  }
  return segmentToSeries(dataset, xName, yName, id, yName, segment)
}

/**
 * 从若干 Y 列构建分析序列。给了 groupColumn 时，每个 Y 列按该列的取值拆成多条，
 * id 以 `@序号` 结尾、name 形如「列名 · 组值」，供界面区分与图例显示。
 */
export function seriesListFromDataset(
  dataset: SuperDataset,
  xName: string,
  yNames: string[],
  groupColumn?: string,
): Series[] {
  const unique = [...new Set(yNames)]
  if (unique.length === 0) throw new Error('Select at least one Y column')
  const group = groupColumn ?? ''

  return unique.flatMap((name) => {
    if (!dataset.numericColumns.includes(name)) throw new Error(`Numeric Y column "${name}" is unavailable`)
    const segments = buildSegments(dataset, xName, name, group)
    if (segments.length === 0) return []
    const total = segments.reduce((sum, segment) => sum + segment.x.length, 0)
    if (total < 2) throw new Error('At least two rows with finite X and Y values are required')
    if (!group) {
      return [segmentToSeries(dataset, xName, name, `ds:${dataset.id}:${name}`, name, segments[0])]
    }
    return segments.map((segment, index) => segmentToSeries(
      dataset,
      xName,
      name,
      `ds:${dataset.id}:${name}@${index}`,
      `${name} · ${segment.key || '(empty)'}`,
      segment,
    ))
  })
}
