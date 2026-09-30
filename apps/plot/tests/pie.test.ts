import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPieGrid,
  buildPieTraces,
  shouldShowPieLegend,
} from '../src/lib/pie.ts'

test('buildPieTraces maps labels and non-negative numeric values to a pie trace', () => {
  const traces = buildPieTraces([{
    name: 'Revenue',
    labels: ['North', 'South', 'West', 'Unknown'],
    values: [12, 8, -2, null],
  }])

  assert.equal(traces.length, 1)
  assert.equal(traces[0].type, 'pie')
  assert.deepEqual('labels' in traces[0] ? traces[0].labels : [], ['North', 'South'])
  assert.deepEqual('values' in traces[0] ? traces[0].values : [], [12, 8])
  assert.equal('textposition' in traces[0] ? traces[0].textposition : null, 'inside')
})

test('buildPieTraces places multiple series in an independent grid', () => {
  const traces = buildPieTraces([
    { name: '2025', labels: ['A'], values: [1] },
    { name: 'empty', labels: ['A'], values: [null] },
    { name: '2026', labels: ['A'], values: [2] },
    { name: '2027', labels: ['A'], values: [3] },
  ])

  assert.deepEqual('domain' in traces[0] ? traces[0].domain : undefined, { row: 0, column: 0 })
  assert.deepEqual('domain' in traces[1] ? traces[1].domain : undefined, { row: 0, column: 1 })
  assert.deepEqual('domain' in traces[2] ? traces[2].domain : undefined, { row: 1, column: 0 })
  assert.deepEqual(buildPieGrid(traces.length), { columns: 2, rows: 2, pattern: 'independent' })
})

test('shouldShowPieLegend hides high-cardinality legends that would squeeze the chart', () => {
  const compact = buildPieTraces([{
    name: 'compact',
    labels: ['A', 'B', 'C'],
    values: [3, 2, 1],
  }])
  const crowded = buildPieTraces([{
    name: 'crowded',
    labels: Array.from({ length: 13 }, (_, index) => `Item ${index + 1}`),
    values: Array.from({ length: 13 }, () => 1),
  }])

  assert.equal(shouldShowPieLegend(true, compact), true)
  assert.equal(shouldShowPieLegend(false, compact), false)
  assert.equal(shouldShowPieLegend(true, crowded), false)
})
