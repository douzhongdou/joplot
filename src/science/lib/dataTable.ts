import type { SuperColumn, SuperDataset } from '../../superplot/types.ts'
import type { DenseArray, ScienceValue } from '../types.ts'
import { vectorData, type VectorField } from './vectors.ts'

export interface DataTablePage {
  offset: number
  total: number
  headers: string[]
  rows: string[][]
}

function cell(column: SuperColumn, index: number): string {
  if (column.kind === 'number') {
    const value = column.values[index]
    return Number.isFinite(value) ? String(value) : ''
  }
  return column.values[index] ?? ''
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function denseCell(array: DenseArray, index: number): string {
  const value = array.data[array.offset + index * (array.strides[0] ?? 1)]
  return Number.isFinite(value) ? String(value) : ''
}

function pageBounds(total: number, offset: number, limit: number): { start: number; end: number } {
  const start = Math.max(0, Math.min(total, Math.trunc(offset) || 0))
  return { start, end: Math.min(total, start + Math.max(1, Math.min(200, Math.trunc(limit) || 100))) }
}

export function readRawDatasetPage(dataset: SuperDataset, offset: number, limit = 100): DataTablePage {
  const { start, end } = pageBounds(dataset.rowCount, offset, limit)
  const rows: string[][] = []
  for (let index = start; index < end; index += 1) {
    rows.push(dataset.columns.map((column) => cell(column, index)))
  }
  return { offset: start, total: dataset.rowCount, headers: dataset.headers, rows }
}

export function valueRowCount(value: ScienceValue): number {
  if (value.kind === 'stats') return value.rows.length
  if (value.kind === 'series') return value.pointCount ?? value.y.shape[0]
  if (value.kind === 'spectrum') return value.pointCount ?? value.frequency.shape[0]
  return value.pointCount ?? value.x.shape[0]
}

export function readValuePage(value: ScienceValue, offset: number, limit = 100): DataTablePage {
  if (value.kind === 'stats') {
    const total = value.rows.length
    const { start, end } = pageBounds(total, offset, limit)
    return {
      offset: start, total, headers: ['metric', 'value'],
      rows: value.rows.slice(start, end).map((row) => [row.key, Number.isFinite(row.value) ? String(row.value) : '']),
    }
  }

  const arrays = value.kind === 'series'
    ? [value.x, value.y]
    : value.kind === 'spectrum'
      ? [value.frequency, value.magnitude, ...(value.phase ? [value.phase] : [])]
      : [value.x, value.y, value.fitted, value.residual]
  const headers = value.kind === 'series'
    ? ['x', 'y']
    : value.kind === 'spectrum'
      ? value.phase ? ['frequency', 'magnitude', 'phase'] : ['frequency', 'magnitude']
      : ['x', 'y', 'fitted', 'residual']
  const total = Math.min(...arrays.map((array) => array.shape[0]))
  const { start, end } = pageBounds(total, offset, limit)
  const rows: string[][] = []
  for (let index = start; index < end; index += 1) {
    rows.push(arrays.map((array) => denseCell(array, index)))
  }
  return { offset: start, total, headers, rows }
}

/** 派生向量直接读取父结果，避免为行号生成一整列数据。 */
export function readVectorPage(parent: ScienceValue, field: VectorField, offset: number, limit = 100): DataTablePage | null {
  const data = vectorData(parent, field)
  if (!data || parent.kind === 'stats') return null
  const useIndex = field === 'x' || field === 'frequency'
  const axis = useIndex ? null : parent.kind === 'spectrum' ? parent.frequency : parent.x
  const total = Math.min(data.shape[0], axis?.shape[0] ?? data.shape[0])
  const { start, end } = pageBounds(total, offset, limit)
  const rows: string[][] = []
  for (let index = start; index < end; index += 1) {
    rows.push([axis ? denseCell(axis, index) : String(index), denseCell(data, index)])
  }
  return { offset: start, total, headers: ['x', 'y'], rows }
}

/** 从 Worker 中的完整列数据导出，不使用绘图预览或分析后的过滤行。 */
export function rawDatasetToCsv(dataset: SuperDataset): Blob {
  const chunks: string[] = [`\uFEFF${dataset.headers.map(csvCell).join(',')}\r\n`]
  let lines: string[] = []
  for (let index = 0; index < dataset.rowCount; index += 1) {
    lines.push(`${dataset.columns.map((column) => csvCell(cell(column, index))).join(',')}\r\n`)
    if (lines.length === 10000) {
      chunks.push(lines.join(''))
      lines = []
    }
  }
  if (lines.length > 0) chunks.push(lines.join(''))
  return new Blob(chunks, { type: 'text/csv;charset=utf-8' })
}
