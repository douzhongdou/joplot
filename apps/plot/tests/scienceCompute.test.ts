import test from 'node:test'
import assert from 'node:assert/strict'

import { computeValues } from '../src/science/compute/engine.ts'
import { createDense, values1d } from '../src/science/lib/dense.ts'
import type { ScienceValue } from '../src/science/types.ts'
import type { AnalysisStep } from '../src/science/lib/pipeline.ts'

function baseSeries(id: string): ScienceValue {
  return {
    id,
    name: id,
    kind: 'series',
    x: createDense(Float64Array.from([0, 1, 2, 3])),
    y: createDense(Float64Array.from([0, 1, 2, 3])),
    provenance: 'test',
  }
}

/** linear(x) = a*x + b → 2*x + 1 = [1, 3, 5, 7] */
const linearStep: AnalysisStep = {
  id: 's1',
  op: 'linear',
  inputId: 'signal',
  params: { a: 2, b: 1 },
  outputId: 'lin1',
}

function seriesValues(outcome: ReturnType<typeof computeValues>): number[] {
  const value = outcome.values.find((candidate) => candidate.id === 'lin1')
  assert.ok(value)
  assert.equal(value.kind, 'series')
  if (value.kind !== 'series') return []
  return [...values1d(value.y)]
}

test('computeValues produces base + step outputs and caches the output', () => {
  const cache = new Map<string, ScienceValue>()
  const outcome = computeValues({
    base: [baseSeries('signal')],
    steps: [linearStep],
    dirtyIds: new Set(['s1']),
    cache,
  })

  assert.deepEqual(outcome.values.map((value) => value.id), ['signal', 'lin1'])
  assert.deepEqual(seriesValues(outcome), [1, 3, 5, 7])
  assert.ok(cache.has('lin1'))
})

test('evicted outputs are removed from cache and from the reported values', () => {
  const cache = new Map<string, ScienceValue>()
  computeValues({ base: [baseSeries('signal')], steps: [linearStep], dirtyIds: new Set(['s1']), cache })
  assert.ok(cache.has('lin1'))

  // 模拟删除该步骤：steps 不再包含它，并要求驱逐其产出。
  const afterDelete = computeValues({
    base: [baseSeries('signal')],
    steps: [],
    dirtyIds: new Set(),
    cache,
    evictIds: ['lin1'],
  })

  assert.deepEqual(afterDelete.values.map((value) => value.id), ['signal'])
  assert.equal(cache.has('lin1'), false, 'ghost must not survive in cache for preview/export')
})

test('clean steps reuse the cached output object without recomputing', () => {
  const cache = new Map<string, ScienceValue>()
  const first = computeValues({ base: [baseSeries('signal')], steps: [linearStep], dirtyIds: new Set(['s1']), cache })
  const second = computeValues({ base: [baseSeries('signal')], steps: [linearStep], dirtyIds: new Set(), cache })

  assert.equal(second.values[1], first.values[1], 'the cached output is reused by reference')
  assert.deepEqual(second.timings, {}, 'no timing is recorded for a reused step')
})

test('re-adding a step after eviction recomputes instead of resurrecting a ghost', () => {
  const cache = new Map<string, ScienceValue>()
  computeValues({ base: [baseSeries('signal')], steps: [linearStep], dirtyIds: new Set(['s1']), cache })
  computeValues({ base: [baseSeries('signal')], steps: [], dirtyIds: new Set(), cache, evictIds: ['lin1'] })

  const again = computeValues({ base: [baseSeries('signal')], steps: [linearStep], dirtyIds: new Set(['s1']), cache })

  assert.deepEqual(again.values.map((value) => value.id), ['signal', 'lin1'])
  assert.ok(cache.has('lin1'))
})
