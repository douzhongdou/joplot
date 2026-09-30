import test from 'node:test'
import assert from 'node:assert/strict'

import {
  dedupeDatasetId,
  removeDatasetById,
  resolveDatasetMutationBase,
} from '../src/science/lib/datasets.ts'
import type { SuperDataset } from '../src/superplot/types.ts'

function dataset(id: string): SuperDataset {
  const values = Float64Array.from([0, 1])
  return {
    id,
    fileName: `${id}.csv`,
    headers: ['v'],
    columns: [{
      name: 'v',
      kind: 'number',
      values,
      missing: null,
      validCount: values.length,
      missingCount: 0,
      min: 0,
      max: 1,
      mean: 0.5,
    }],
    rowCount: values.length,
    numericColumns: ['v'],
    timeColumn: null,
    sampleRate: null,
    fileSize: 1,
    createdAt: 1,
  }
}

test('import hydrates the durable dataset list when memory is empty', async () => {
  const durable = [dataset('a')]
  let loads = 0

  const baseline = await resolveDatasetMutationBase('import', [], async () => {
    loads += 1
    return durable
  })

  assert.equal(loads, 1, 'must read durable storage before importing')
  assert.deepEqual(baseline.map((entry) => entry.id), ['a'])
})

test('remove-dataset hydrates so it cannot wipe unrelated persisted data', async () => {
  const durable = [dataset('a'), dataset('b')]

  const baseline = await resolveDatasetMutationBase('remove-dataset', [], async () => durable)
  const remaining = removeDatasetById(baseline, 'a')

  assert.deepEqual(remaining.map((entry) => entry.id), ['b'])
})

test('reset-sample clears without reading storage', async () => {
  let loads = 0

  const baseline = await resolveDatasetMutationBase('reset-sample', [dataset('a')], async () => {
    loads += 1
    return [dataset('a')]
  })

  assert.deepEqual(baseline, [])
  assert.equal(loads, 0, 'reset-sample is an intentional clear and must not rehydrate')
})

test('a worker that already holds datasets does not re-read storage', async () => {
  const inMemory = [dataset('a')]
  let loads = 0

  const baseline = await resolveDatasetMutationBase('import', inMemory, async () => {
    loads += 1
    return [dataset('b')]
  })

  assert.equal(loads, 0)
  assert.equal(baseline, inMemory)
})

test('dedupeDatasetId suffixes colliding ids', () => {
  assert.equal(dedupeDatasetId([], dataset('a')).id, 'a')
  assert.equal(dedupeDatasetId([dataset('a')], dataset('a')).id, 'a-2')
  assert.equal(dedupeDatasetId([dataset('a'), dataset('a-2')], dataset('a')).id, 'a-3')
})

test('removeDatasetById drops only the requested dataset', () => {
  const remaining = removeDatasetById([dataset('a'), dataset('b'), dataset('c')], 'b')
  assert.deepEqual(remaining.map((entry) => entry.id), ['a', 'c'])
})
