import test from 'node:test'
import assert from 'node:assert/strict'

import { rawDatasetToCsv, readRawDatasetPage, readValuePage, readVectorPage, valueRowCount } from '../src/science/lib/dataTable.ts'
import { createDense } from '../src/science/lib/dense.ts'
import type { SuperDataset } from '../src/superplot/types.ts'

const dataset: SuperDataset = {
  id: 'measurements',
  fileName: 'measurements.csv',
  headers: ['时间', '读数', '备注'],
  columns: [
    {
      name: '时间', kind: 'number', values: Float64Array.from([0, 1, 2]), missing: null,
      validCount: 3, missingCount: 0, min: 0, max: 2, mean: 1,
    },
    {
      name: '读数', kind: 'number', values: Float64Array.from([2.5, Number.NaN, 4]),
      missing: Uint8Array.from([0, 1, 0]), validCount: 2, missingCount: 1,
      min: 2.5, max: 4, mean: 3.25,
    },
    { name: '备注', kind: 'string', values: ['普通', '包含,逗号', '一行\n"引号"'] },
  ],
  rowCount: 3,
  numericColumns: ['时间', '读数'],
  timeColumn: '时间',
  sampleRate: 1,
  fileSize: 10,
  createdAt: 1,
}

test('raw dataset pages retain all columns and missing rows', () => {
  assert.deepEqual(readRawDatasetPage(dataset, 1, 2), {
    offset: 1,
    total: 3,
    headers: ['时间', '读数', '备注'],
    rows: [['1', '', '包含,逗号'], ['2', '4', '一行\n"引号"']],
  })
  assert.deepEqual(readRawDatasetPage(dataset, 99, 100).rows, [])
})

test('full raw CSV keeps every row and quotes text cells', async () => {
  const blob = rawDatasetToCsv(dataset)
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)], [239, 187, 191])
  assert.equal(await blob.text(),
    '时间,读数,备注\r\n0,2.5,普通\r\n1,,"包含,逗号"\r\n2,4,"一行\n""引号"""\r\n')
})

test('result pages read full values instead of chart previews', () => {
  const value = {
    id: 'signal', name: 'signal', kind: 'series' as const,
    x: createDense(Float64Array.from([0, 1, 2])),
    y: createDense(Float64Array.from([5, Number.NaN, 7])),
    provenance: 'test',
  }
  assert.equal(valueRowCount(value), 3)
  assert.deepEqual(readValuePage(value, 1, 2), {
    offset: 1, total: 3, headers: ['x', 'y'], rows: [['1', ''], ['2', '7']],
  })
  assert.deepEqual(readVectorPage(value, 'x', 1, 2), {
    offset: 1, total: 3, headers: ['x', 'y'], rows: [['1', '1'], ['2', '2']],
  })
})
