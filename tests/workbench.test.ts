import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyFilters,
  buildDataset,
  createDefaultCard,
  sampleRows,
  summarizeNumericColumn,
} from '../src/lib/workbench.ts'

function createDataset() {
  return buildDataset(
    ['time', 'value', 'status', 'score'],
    [
      { time: '2026-01-01', value: '10', status: 'ok', score: '1' },
      { time: '2026-01-02', value: 'oops', status: 'warn', score: '3' },
      { time: '2026-01-03', value: '30', status: 'ok', score: '' },
      { time: '2026-01-04', value: '', status: 'error', score: '9' },
    ],
  )
}

test('buildDataset treats invalid numeric values as null and keeps numeric columns usable', () => {
  const dataset = createDataset()

  assert.deepEqual(dataset.numericColumns, ['value', 'score'])
  assert.equal(dataset.rows[1].numeric.value, null)
  assert.equal(dataset.rows[3].numeric.value, null)
  assert.equal(dataset.rows[2].numeric.score, null)
})

test('createDefaultCard uses first column as x and falls back from second column to first numeric column', () => {
  const fallbackDataset = buildDataset(
    ['date', 'label', 'amount'],
    [
      { date: '2026-01-01', label: 'A', amount: '10' },
      { date: '2026-01-02', label: 'B', amount: '12' },
    ],
  )

  const defaultCard = createDefaultCard(fallbackDataset)

  assert.equal(defaultCard.kind, 'line')
  assert.equal(defaultCard.xColumn, 'date')
  assert.equal(defaultCard.yColumn, 'amount')
})

test('applyFilters supports text contains and numeric greater-than together', () => {
  const dataset = createDataset()

  const filtered = applyFilters(dataset.rows, [
    { id: '1', column: 'status', operator: 'contains', value: 'ok' },
    { id: '2', column: 'score', operator: 'gt', value: '0' },
  ])

  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].raw.time, '2026-01-01')
})

test('summarizeNumericColumn ignores null values', () => {
  const dataset = createDataset()

  const summary = summarizeNumericColumn(dataset.rows, 'value')

  assert.equal(summary.count, 2)
  assert.equal(summary.missing, 2)
  assert.equal(summary.min, 10)
  assert.equal(summary.max, 30)
  assert.equal(summary.mean, 20)
  assert.equal(summary.median, 20)
})

test('sampleRows keeps first and last row when downsampling', () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    raw: { x: String(index), y: String(index) },
    numeric: { x: index, y: index },
  }))

  const sampled = sampleRows(rows, 4)

  assert.equal(sampled.length, 4)
  assert.equal(sampled[0].raw.x, '0')
  assert.equal(sampled[sampled.length - 1].raw.x, '9')
})
