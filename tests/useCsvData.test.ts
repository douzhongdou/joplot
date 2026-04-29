import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getInitialDatasetHydrationState,
  parseImportedFiles,
  restoreDatasetsAfterHydration,
} from '../src/hooks/useCsvData.ts'
import { serializeDatasets } from '../src/lib/datasetPersistence.ts'
import { buildDataset } from '../src/lib/workbench.ts'

test('dataset hydration starts empty so server and first client render stay aligned', () => {
  assert.deepEqual(getInitialDatasetHydrationState(), {
    datasets: [],
    hasRestored: false,
  })
})

test('dataset hydration restores persisted datasets after the first render pass', () => {
  const dataset = buildDataset(
    ['time', 'value'],
    [
      { time: '2026-04-29', value: '10' },
      { time: '2026-04-30', value: '12' },
    ],
    'demo.csv',
  )

  const restored = restoreDatasetsAfterHydration(serializeDatasets([dataset]))

  assert.equal(restored.length, 1)
  assert.equal(restored[0].fileName, 'demo.csv')
  assert.deepEqual(restored[0].headers, ['time', 'value'])
})

test('parseImportedFiles keeps valid datasets and reports invalid uploads separately', async () => {
  const result = await parseImportedFiles([
    new File(
      ['month,value\nJan,10\nFeb,12\n'],
      'good.csv',
      { type: 'text/csv' },
    ),
    new File(
      ['PK\u0003\u0004word/document.xml'],
      'bad.csv',
      { type: 'text/csv' },
    ),
  ], [])

  assert.equal(result.parsed.length, 1)
  assert.equal(result.parsed[0].fileName, 'good.csv')
  assert.equal(result.failures.length, 1)
  assert.equal(result.failures[0].file.name, 'bad.csv')
})
