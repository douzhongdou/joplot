import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getInitialDatasetHydrationState,
  parseImportedFiles,
  persistDatasetsToStorage,
  restoreDatasetsAfterHydration,
} from '../src/hooks/useCsvData.ts'
import { serializeDatasets } from '../src/lib/datasetPersistence.ts'
import { buildDataset } from '../src/lib/workbench.ts'

test('dataset hydration starts empty so server and first client render stay aligned', () => {
  assert.deepEqual(getInitialDatasetHydrationState(), {
    datasets: [],
    hasRestored: false,
    persistenceFailed: false,
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

function createStorageStub(overrides: Partial<Pick<Storage, 'setItem' | 'removeItem'>> = {}) {
  const writes = new Map<string, string>()
  const removals: string[] = []

  return {
    writes,
    removals,
    setItem: overrides.setItem ?? ((key: string, value: string) => { writes.set(key, value) }),
    removeItem: overrides.removeItem ?? ((key: string) => { removals.push(key) }),
  }
}

test('persistDatasetsToStorage writes the serialized payload and reports success', () => {
  const dataset = buildDataset(['time', 'value'], [{ time: 'a', value: '1' }], 'demo.csv')
  const storage = createStorageStub()

  const persisted = persistDatasetsToStorage(storage, [dataset])

  assert.equal(persisted, true)
  assert.deepEqual([...storage.writes.keys()], ['csv-workbench-datasets'])
  assert.equal(storage.writes.get('csv-workbench-datasets'), serializeDatasets([dataset]))
})

test('persistDatasetsToStorage clears the storage key when the last dataset is removed', () => {
  const storage = createStorageStub()

  const persisted = persistDatasetsToStorage(storage, [])

  assert.equal(persisted, true)
  assert.deepEqual(storage.removals, ['csv-workbench-datasets'])
  assert.equal(storage.writes.size, 0)
})

test('persistDatasetsToStorage reports failure when the storage quota is exceeded', () => {
  const dataset = buildDataset(['time', 'value'], [{ time: 'a', value: '1' }], 'demo.csv')
  const storage = createStorageStub({
    setItem: () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    },
  })

  const persisted = persistDatasetsToStorage(storage, [dataset])

  assert.equal(persisted, false)
})
