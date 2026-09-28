import type { ScienceValue } from '../types.ts'
import { values1d } from './dense.ts'

function cell(value: number): string {
  return Number.isFinite(value) ? String(value) : ''
}

/** Export the full Worker resident value. Preview arrays must never be used here. */
export function valueToCsv(value: ScienceValue): Blob {
  if (value.kind === 'stats') {
    return new Blob([
      'metric,value\r\n',
      ...value.rows.map((row) => `${row.key},${cell(row.value)}\r\n`),
    ], { type: 'text/csv;charset=utf-8' })
  }

  const arrays = value.kind === 'series'
    ? [values1d(value.x), values1d(value.y)]
    : value.kind === 'spectrum'
      ? [values1d(value.frequency), values1d(value.magnitude)]
      : [values1d(value.x), values1d(value.y), values1d(value.fitted), values1d(value.residual)]
  const header = value.kind === 'series'
    ? 'x,y'
    : value.kind === 'spectrum'
      ? 'frequency,magnitude'
      : 'x,y,fitted,residual'
  const length = Math.min(...arrays.map((array) => array.length))
  const chunks: string[] = [`${header}\r\n`]
  let lines: string[] = []
  for (let index = 0; index < length; index += 1) {
    lines.push(`${arrays.map((array) => cell(array[index])).join(',')}\r\n`)
    if (lines.length === 10000) {
      chunks.push(lines.join(''))
      lines = []
    }
  }
  if (lines.length) chunks.push(lines.join(''))
  return new Blob(chunks, { type: 'text/csv;charset=utf-8' })
}
