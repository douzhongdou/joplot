import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDataset } from '../src/lib/workbench.ts'
import {
  deserializeDatasets,
  serializeDatasets,
} from '../src/lib/datasetPersistence.ts'

test('serializeDatasets stores enough raw csv data to rebuild datasets later', () => {
  const dataset = buildDataset(
    ['time', 'value', 'status'],
    [
      { time: '2026-01-01', value: '10', status: 'ok' },
      { time: '2026-01-02', value: '20', status: 'warn' },
    ],
    'metrics.csv',
    'metrics',
  )

  const serialized = serializeDatasets([dataset])
  const payload = JSON.parse(serialized) as Array<Record<string, unknown>>

  assert.deepEqual(payload, [
    {
      id: 'metrics',
      fileName: 'metrics.csv',
      headers: ['time', 'value', 'status'],
      rows: [
        { time: '2026-01-01', value: '10', status: 'ok' },
        { time: '2026-01-02', value: '20', status: 'warn' },
      ],
    },
  ])
})

test('deserializeDatasets rebuilds numeric columns and row counts from persisted raw rows', () => {
  const restored = deserializeDatasets(JSON.stringify([
    {
      id: 'metrics',
      fileName: 'metrics.csv',
      headers: ['time', 'value', 'status'],
      rows: [
        { time: '2026-01-01', value: '10', status: 'ok' },
        { time: '2026-01-02', value: '', status: 'warn' },
      ],
    },
  ]))

  assert.equal(restored.length, 1)
  assert.equal(restored[0].id, 'metrics')
  assert.equal(restored[0].fileName, 'metrics.csv')
  assert.deepEqual(restored[0].numericColumns, ['value'])
  assert.equal(restored[0].rowCount, 2)
  assert.equal(restored[0].rows[0].numeric.value, 10)
  assert.equal(restored[0].rows[1].numeric.value, null)
})

test('deserializeDatasets returns an empty list for malformed or invalid persisted payloads', () => {
  assert.deepEqual(deserializeDatasets('not-json'), [])
  assert.deepEqual(deserializeDatasets(JSON.stringify({ rows: [] })), [])
  assert.deepEqual(deserializeDatasets(JSON.stringify([
    {
      id: 'broken',
      fileName: 'broken.csv',
      headers: ['time'],
      rows: [null],
    },
  ])), [])
})
