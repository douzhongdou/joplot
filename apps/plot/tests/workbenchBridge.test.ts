import test from 'node:test'
import assert from 'node:assert/strict'

import {
  appendDatasetToSerialized,
  deserializeDatasets,
  takePendingChartDatasetIds,
  writePendingChartDatasetIds,
} from '../src/lib/datasetPersistence.ts'
import { parseExpression } from '../src/lib/expression.ts'
import { sampleCurve, sampledCurveToCsvRows } from '../src/lib/functionPlot.ts'
import { buildDataset, createCard } from '../src/lib/workbench.ts'
import { restoreWorkbench } from '../src/lib/workbenchRestore.ts'

function createMemoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  }
}

function buildCurveDataset(expression: string) {
  const curve = sampleCurve('curve', expression, '#155eef', parseExpression(expression), {
    xMin: 0,
    xMax: 2,
    samples: 3,
    params: {},
  })

  return buildDataset(['x', 'y'], sampledCurveToCsvRows(curve), expression)
}

test('appendDatasetToSerialized adds a sampled curve to an empty workbench store', () => {
  const dataset = buildCurveDataset('x^2')
  const { serialized, id } = appendDatasetToSerialized(null, dataset)
  const restored = deserializeDatasets(serialized)

  assert.equal(id, 'x-2')
  assert.equal(restored.length, 1)
  assert.equal(restored[0].fileName, 'x^2')
  assert.deepEqual(restored[0].numericColumns, ['x', 'y'])
  assert.deepEqual(restored[0].rows.map((row) => row.numeric.y), [0, 1, 4])
})

test('appendDatasetToSerialized keeps existing datasets and de-duplicates ids', () => {
  const first = appendDatasetToSerialized(null, buildCurveDataset('x^2'))
  const second = appendDatasetToSerialized(first.serialized, buildCurveDataset('x^2'))
  const third = appendDatasetToSerialized(second.serialized, buildCurveDataset('x^2'))
  const restored = deserializeDatasets(third.serialized)

  assert.equal(second.id, 'x-2-2')
  assert.equal(third.id, 'x-2-3')
  assert.deepEqual(restored.map((dataset) => dataset.id), ['x-2', 'x-2-2', 'x-2-3'])
})

test('appendDatasetToSerialized tolerates a corrupted existing store', () => {
  const { serialized } = appendDatasetToSerialized('not json', buildCurveDataset('2x'))

  assert.equal(deserializeDatasets(serialized).length, 1)
})

test('takePendingChartDatasetIds returns written ids exactly once', () => {
  const storage = createMemoryStorage()

  writePendingChartDatasetIds(storage, ['x-2', 'x-2-2'])
  assert.deepEqual(takePendingChartDatasetIds(storage), ['x-2', 'x-2-2'])
  assert.deepEqual(takePendingChartDatasetIds(storage), [])
})

test('takePendingChartDatasetIds tolerates missing or corrupted markers', () => {
  assert.deepEqual(takePendingChartDatasetIds(createMemoryStorage()), [])

  const corrupted = createMemoryStorage({ 'csv-workbench-pending-chart-datasets': 'not json' })
  assert.deepEqual(takePendingChartDatasetIds(corrupted), [])

  const wrongShape = createMemoryStorage({ 'csv-workbench-pending-chart-datasets': '{"id":"x"}' })
  assert.deepEqual(takePendingChartDatasetIds(wrongShape), [])

  const mixed = createMemoryStorage({ 'csv-workbench-pending-chart-datasets': '["ok", 1, null]' })
  assert.deepEqual(takePendingChartDatasetIds(mixed), ['ok'])
})

const defaultTitle = 'Default line chart'

test('first transfer creates exactly one selected chart for all sent curves', () => {
  const datasets = [buildCurveDataset('x^2'), buildCurveDataset('2x')]
  const restored = restoreWorkbench(null, datasets, datasets.map((dataset) => dataset.id), defaultTitle)

  assert.equal(restored.cards.length, 1)
  assert.deepEqual(restored.cards[0].series.map((series) => series.datasetId), datasets.map((dataset) => dataset.id))
  assert.equal(restored.selectedCardId, restored.cards[0].id)
  assert.equal(restored.activeDatasetId, datasets[0].id)
})

for (const serialized of [null, 'not json', 'null', '{"cards":[]}']) {
  test(`transfer preserves a dedicated function chart when dashboard is ${serialized}`, () => {
    const oldDataset = buildDataset(['date', 'value'], [{ date: '2026-09-01', value: '42' }], 'old.csv')
    const sentDataset = buildCurveDataset('x^2')
    const restored = restoreWorkbench(serialized, [oldDataset, sentDataset], [sentDataset.id], defaultTitle)

    assert.equal(restored.cards.length, 2)
    assert.deepEqual(restored.cards[0].series.map((series) => series.datasetId), [oldDataset.id])
    const sentCard = restored.cards.find((card) => card.id === restored.selectedCardId)!
    assert.equal(sentCard.title, 'x^2')
    assert.equal(sentCard.xColumn, 'x')
    assert.deepEqual(sentCard.series.map((series) => [series.datasetId, series.yColumn]), [[sentDataset.id, 'y']])
    assert.equal(restored.activeDatasetId, sentDataset.id)
  })
}

test('transfer appends to a restored dashboard once and retains filters and existing cards', () => {
  const oldDataset = buildDataset(['date', 'value'], [{ date: '2026-09-01', value: '42' }], 'old.csv')
  const sentDataset = buildCurveDataset('x^2')
  const datasets = [oldDataset, sentDataset]
  const card = createCard('bar', oldDataset, { title: 'Existing chart' })
  const filters = [{ id: 'filter', column: 'value', operator: 'gt' as const, value: '10' }]
  const storage = createMemoryStorage()
  writePendingChartDatasetIds(storage, [sentDataset.id])
  const restored = restoreWorkbench(JSON.stringify({ cards: [card], workspaceFilters: filters, filterJoinOperator: 'or' }),
    datasets, takePendingChartDatasetIds(storage), defaultTitle)

  assert.equal(restored.cards.length, 2)
  assert.deepEqual(restored.cards[0], card)
  assert.deepEqual(restored.workspaceFilters, filters)
  assert.equal(restored.filterJoinOperator, 'or')
  assert.equal(restored.selectedCardId, restored.cards[1].id)
  const reloaded = restoreWorkbench(JSON.stringify(restored), datasets, takePendingChartDatasetIds(storage), defaultTitle)
  assert.deepEqual(reloaded.cards, restored.cards)
})

test('missing and duplicate pending ids do not create empty or duplicate charts', () => {
  const dataset = buildCurveDataset('x^2')
  const restored = restoreWorkbench(null, [dataset], ['missing', dataset.id, dataset.id], defaultTitle)
  assert.equal(restored.cards.length, 1)
  assert.equal(restored.cards[0].series.length, 1)
  const stale = restoreWorkbench(null, [dataset], ['missing'], defaultTitle)
  assert.equal(stale.cards.length, 1)
  assert.equal(stale.cards[0].title, defaultTitle)
})
