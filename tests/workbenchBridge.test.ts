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
import { buildDataset } from '../src/lib/workbench.ts'

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
