import test from 'node:test'
import assert from 'node:assert/strict'

import { computeDirtySteps, removedOutputIds } from '../src/science/lib/dirty.ts'
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

test('removing the last step leaves nothing dirty but reports the removed output', () => {
  const s1 = step('s1', 'smooth', 'signal', 'smooth1')
  const s2 = step('s2', 'fft', 'signal', 'fft1')
  const previous = [s1, s2]
  const next = [s1]

  assert.equal(computeDirtySteps(next, previous).size, 0, 'no surviving step needs recomputing')
  assert.deepEqual(removedOutputIds(previous, next), ['fft1'], 'the removed output must be evicted')
})

test('removing a middle step dirties its remapped consumer, not an unrelated sibling', () => {
  const s1 = step('s1', 'smooth', 'signal', 'smooth1')
  const s2 = step('s2', 'fit', 'smooth1', 'fit1')     // consumes smooth1
  const s3 = step('s3', 'stats', 'signal', 'stats1')  // independent of s1
  const previous = [s1, s2, s3]

  // removeStep 行为：删 s1 后 s2 的 inputId 重指向 s1.inputId('signal') 成为新对象；s3 对象不变。
  const next: AnalysisStep[] = [{ ...s2, inputId: 'signal' }, s3]
  const dirty = computeDirtySteps(next, previous)

  assert.deepEqual([...dirty], ['s2'])
  assert.ok(!dirty.has('s3'), 'index-based diff would have wrongly dirtied the shifted tail')
  assert.deepEqual(removedOutputIds(previous, next), ['smooth1'])
})
