import test from 'node:test'
import assert from 'node:assert/strict'

import { computeDirtySteps } from '../src/science/lib/dirty.ts'
import type { AnalysisStep } from '../src/science/lib/pipeline.ts'

function step(id: string, op: string, inputId: string, outputId: string): AnalysisStep {
  return { id, op, inputId, params: {}, outputId }
}

test('first run marks every step dirty', () => {
  const steps = [step('s1', 'smooth', 'signal', 'smooth1'), step('s2', 'fft', 'signal', 'fft1')]
  const dirty = computeDirtySteps(steps, [])
  assert.deepEqual([...dirty].sort(), ['s1', 's2'])
})

test('unchanged steps stay clean', () => {
  const steps = [step('s1', 'smooth', 'signal', 'smooth1'), step('s2', 'fft', 'signal', 'fft1')]
  const dirty = computeDirtySteps(steps, steps)
  assert.equal(dirty.size, 0)
})

test('dirty propagates only to consumers of the changed output', () => {
  const s1 = step('s1', 'smooth', 'signal', 'smooth1')
  const s2 = step('s2', 'fft', 'signal', 'fft1')
  const s3 = step('s3', 'fit', 'smooth1', 'fit1')
  const previous = [s1, s2, s3]

  const changed: AnalysisStep[] = [{ ...s1, params: { window: 15 } }, s2, s3]
  const dirty = computeDirtySteps(changed, previous)

  assert.deepEqual([...dirty].sort(), ['s1', 's3'])
  assert.ok(!dirty.has('s2'), 'fft1 reads signal, must stay clean')
})

test('editing a downstream step dirties only that step', () => {
  const s1 = step('s1', 'smooth', 'signal', 'smooth1')
  const s2 = step('s2', 'fft', 'signal', 'fft1')
  const s3 = step('s3', 'fit', 'signal', 'fit1')
  const previous = [s1, s2, s3]

  const changed: AnalysisStep[] = [s1, s2, { ...s3, params: { model: 'linear' } }]
  const dirty = computeDirtySteps(changed, previous)
  assert.deepEqual([...dirty], ['s3'])
})

test('a newly added step is dirty', () => {
  const s1 = step('s1', 'smooth', 'signal', 'smooth1')
  const previous = [s1]
  const steps = [s1, step('s2', 'stats', 'smooth1', 'stats1')]
  const dirty = computeDirtySteps(steps, previous)
  assert.deepEqual([...dirty], ['s2'])
})
