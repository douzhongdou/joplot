import test from 'node:test'
import assert from 'node:assert/strict'

import { buildAggregatedSeries, toPlotSeries } from '../src/lib/aggregation.ts'
import { buildDataset } from '../src/lib/workbench.ts'
import type { CsvData, NormalizedRow } from '../src/types.ts'

function rowsByDataset(datasets: CsvData[]): Record<string, NormalizedRow[]> {
  return Object.fromEntries(datasets.map((dataset) => [dataset.id, dataset.rows]))
}

function createNorthDataset() {
  return buildDataset(
    ['date', 'month', 'region', 'sales', 'orderId'],
    [
      { date: '2026-01-02', month: '2026-01', region: 'North', sales: '10', orderId: 'A-1' },
      { date: '2026-01-20', month: '2026-01', region: 'North', sales: '20', orderId: 'A-2' },
      { date: '2026-02-05', month: '2026-02', region: 'North', sales: '30', orderId: 'A-2' },
      { date: 'not a date', month: 'bad', region: 'North', sales: '40', orderId: 'A-3' },
    ],
    'north.csv',
    'north',
  )
}

function createSouthDataset() {
  return buildDataset(
    ['date', 'month', 'region', 'sales', 'orderId'],
    [
      { date: '2026/01/10', month: '2026-01', region: 'South', sales: '5', orderId: 'B-1' },
      { date: '2026/02/10', month: '2026-02', region: 'South', sales: '15', orderId: 'B-2' },
      { date: '2026/02/20', month: '2026-02', region: 'South', sales: '', orderId: 'B-3' },
    ],
    'south.csv',
    'south',
  )
}

function createMissingMetricDataset() {
  return buildDataset(
    ['date', 'month', 'region', 'orders'],
    [
      { date: '2026-01-01', month: '2026-01', region: 'East', orders: '2' },
    ],
    'missing.csv',
    'missing',
  )
}

test('aggregates multiple datasets by file', () => {
  const north = createNorthDataset()
  const south = createSouthDataset()

  const result = buildAggregatedSeries(
    [north, south],
    {
      datasetIds: [north.id, south.id],
      xColumn: 'month',
      xKind: 'category',
      timeBucket: 'month',
      groupMode: 'file',
      groupColumn: null,
      metricColumn: 'sales',
      aggregation: 'sum',
    },
    rowsByDataset([north, south]),
  )

  assert.deepEqual(result.skippedDatasets, [])
  assert.deepEqual(result.series.map((series) => series.name), ['north.csv', 'south.csv'])
  assert.deepEqual(result.series[0].points, [
    { x: '2026-01', y: 30 },
    { x: '2026-02', y: 30 },
    { x: 'bad', y: 40 },
  ])
  assert.deepEqual(result.series[1].points, [
    { x: '2026-01', y: 5 },
    { x: '2026-02', y: 15 },
  ])
})

test('aggregates multiple datasets by field after merging compatible rows', () => {
  const north = createNorthDataset()
  const south = createSouthDataset()

  const result = buildAggregatedSeries(
    [north, south],
    {
      datasetIds: [north.id, south.id],
      xColumn: 'month',
      xKind: 'category',
      timeBucket: 'month',
      groupMode: 'field',
      groupColumn: 'region',
      metricColumn: 'sales',
      aggregation: 'sum',
    },
    rowsByDataset([north, south]),
  )

  assert.deepEqual(result.series.map((series) => series.name), ['North', 'South'])
  assert.deepEqual(result.series[0].points, [
    { x: '2026-01', y: 30 },
    { x: '2026-02', y: 30 },
    { x: 'bad', y: 40 },
  ])
  assert.deepEqual(result.series[1].points, [
    { x: '2026-01', y: 5 },
    { x: '2026-02', y: 15 },
  ])
})

test('skips datasets that do not contain required aggregation fields', () => {
  const north = createNorthDataset()
  const missing = createMissingMetricDataset()

  const result = buildAggregatedSeries(
    [north, missing],
    {
      datasetIds: [north.id, missing.id],
      xColumn: 'month',
      xKind: 'category',
      timeBucket: 'month',
      groupMode: 'file',
      groupColumn: null,
      metricColumn: 'sales',
      aggregation: 'sum',
    },
    rowsByDataset([north, missing]),
  )

  assert.equal(result.series.length, 1)
  assert.deepEqual(result.skippedDatasets, [
    {
      datasetId: missing.id,
      fileName: 'missing.csv',
      reason: 'missing-metric-column',
    },
  ])
})

test('buckets common date strings by month and skips invalid dates', () => {
  const north = createNorthDataset()
  const south = createSouthDataset()

  const result = buildAggregatedSeries(
    [north, south],
    {
      datasetIds: [north.id, south.id],
      xColumn: 'date',
      xKind: 'time',
      timeBucket: 'month',
      groupMode: 'field',
      groupColumn: 'region',
      metricColumn: 'sales',
      aggregation: 'sum',
    },
    rowsByDataset([north, south]),
  )

  assert.equal(result.skippedRows, 1)
  assert.deepEqual(result.series[0].points, [
    { x: '2026-01', y: 30 },
    { x: '2026-02', y: 30 },
  ])
  assert.deepEqual(result.series[1].points, [
    { x: '2026-01', y: 5 },
    { x: '2026-02', y: 15 },
  ])
})

test('supports statistical aggregation functions', () => {
  const dataset = buildDataset(
    ['bucket', 'value'],
    [
      { bucket: 'A', value: '1' },
      { bucket: 'A', value: '2' },
      { bucket: 'A', value: '2' },
      { bucket: 'A', value: '5' },
      { bucket: 'A', value: '' },
    ],
    'stats.csv',
    'stats',
  )
  const baseConfig = {
    datasetIds: [dataset.id],
    xColumn: 'bucket',
    xKind: 'category' as const,
    timeBucket: 'month' as const,
    groupMode: 'file' as const,
    groupColumn: null,
    metricColumn: 'value',
  }

  const aggregate = (aggregation: typeof baseConfig['groupMode'] extends never ? never : Parameters<typeof buildAggregatedSeries>[1]['aggregation']) =>
    buildAggregatedSeries(
      [dataset],
      { ...baseConfig, aggregation },
      rowsByDataset([dataset]),
    ).series[0].points[0].y

  assert.equal(aggregate('mean'), 2.5)
  assert.equal(aggregate('count'), 5)
  assert.equal(aggregate('max'), 5)
  assert.equal(aggregate('min'), 1)
  assert.equal(aggregate('median'), 2)
  assert.equal(aggregate('distinctCount'), 4)
  assert.equal(aggregate('missingCount'), 1)
  assert.equal(aggregate('variance'), 2.25)
  assert.equal(aggregate('stddev'), 1.5)
})

test('converts aggregated results into plot-ready series', () => {
  const north = createNorthDataset()
  const result = buildAggregatedSeries(
    [north],
    {
      datasetIds: [north.id],
      xColumn: 'month',
      xKind: 'category',
      timeBucket: 'month',
      groupMode: 'file',
      groupColumn: null,
      metricColumn: 'sales',
      aggregation: 'sum',
    },
    rowsByDataset([north]),
  )

  assert.deepEqual(toPlotSeries(result), [
    {
      key: 'north',
      name: 'north.csv',
      x: ['2026-01', '2026-02', 'bad'],
      y: [30, 30, 40],
    },
  ])
})
