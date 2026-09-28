import type { SuperDataset, SuperNumericColumn } from '../../superplot/types.ts'
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

/** Build one analysis series from a selected numeric Y column and an optional numeric X column. */
export function seriesFromDataset(dataset: SuperDataset, xName: string, yName: string, id = 'signal'): Series {
  const yColumn = numericColumn(dataset, yName)
  if (!yColumn) throw new Error(`Numeric Y column "${yName}" is unavailable`)
  const xColumn = xName ? numericColumn(dataset, xName) : undefined
  if (xName && !xColumn) throw new Error(`Numeric X column "${xName}" is unavailable`)
  if (xName === yName) throw new Error('X and Y must be different columns')

  let valid = 0
  for (let index = 0; index < dataset.rowCount; index += 1) {
    const x = xColumn ? xColumn.values[index] : index
    const y = yColumn.values[index]
    if (Number.isFinite(x) && Number.isFinite(y)) valid += 1
  }
  if (valid < 2) throw new Error('At least two rows with finite X and Y values are required')

  const x = new Float64Array(valid)
  const y = new Float64Array(valid)
  let output = 0
  for (let index = 0; index < dataset.rowCount; index += 1) {
    const nextX = xColumn ? xColumn.values[index] : index
    const nextY = yColumn.values[index]
    if (Number.isFinite(nextX) && Number.isFinite(nextY)) {
      x[output] = nextX
      y[output] = nextY
      output += 1
    }
  }
  return {
    id,
    name: yName,
    kind: 'series',
    x: createDense(x),
    y: createDense(y),
    sampleRate: inferUniformSampleRate(x),
    xUnit: axisUnit(xName),
    provenance: `${dataset.fileName}: ${xName || 'row'} → ${yName} (${x.length}/${dataset.rowCount} rows)`,
  }
}

export function seriesListFromDataset(dataset: SuperDataset, xName: string, yNames: string[]): Series[] {
  const unique = [...new Set(yNames)]
  if (unique.length === 0) throw new Error('Select at least one Y column')
  return unique.map((name) => {
    if (!dataset.numericColumns.includes(name)) throw new Error(`Numeric Y column "${name}" is unavailable`)
    // id 带数据集标识，多数据集并存时不会互相覆盖；name 保持列名，图例干净。
    return seriesFromDataset(dataset, xName, name, `ds:${dataset.id}:${name}`)
  })
}
