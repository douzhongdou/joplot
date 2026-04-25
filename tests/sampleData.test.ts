import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getSampleDatasetCopy,
  loadSampleDatasetFile,
  SAMPLE_DATASETS,
} from '../src/lib/sampleData.ts'

test('sample datasets expose the four curated quick-start entries in stable order', () => {
  assert.deepEqual(
    SAMPLE_DATASETS.map((item) => item.id),
    ['sales', 'stock', 'traffic', 'sensor'],
  )
})

test('getSampleDatasetCopy localizes sample labels for english', () => {
  assert.deepEqual(
    getSampleDatasetCopy('en').map((item) => item.label),
    ['Sales', 'Stock', 'Traffic', 'Sensor'],
  )
})

test('loadSampleDatasetFile loads a sample csv as a browser File', async () => {
  const file = await loadSampleDatasetFile('sales', async (input) => ({
    ok: true,
    async text() {
      assert.equal(input, '/samples/sales.csv')
      return 'month,revenue\nJan,1200'
    },
  }))

  assert.equal(file.name, 'sales.csv')
  assert.equal(file.type, 'text/csv')
  assert.equal(await file.text(), 'month,revenue\nJan,1200')
})
