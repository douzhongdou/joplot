import test from 'node:test'
import assert from 'node:assert/strict'

import { computeDirtySteps } from '../src/science/lib/dirty.ts'
import { insertAnalysisStep, type AnalysisStep } from '../src/science/lib/pipeline.ts'

function step(op: string, inputId: string, outputId: string): AnalysisStep {
  return { id: `step-${outputId}`, op, inputId, outputId, params: {} }
}

test('insert before reconnects only the following step and dirties its dependent chain', () => {
  const original = [
    step('smooth', 'signal', 'smooth1'),
    step('fft', 'signal', 'fft1'),
    step('fit', 'signal', 'fit1'),
  ]
  const result = insertAnalysisStep(original, 'detrend', { type: 'before', stepId: 'step-fft1' }, 'signal')
  assert.ok(result)
  assert.deepEqual(result.steps.map((entry) => entry.outputId), ['smooth1', 'detrend1', 'fft1', 'fit1'])
  assert.equal(result.inserted.inputId, 'signal')
  assert.equal(result.steps[2].inputId, 'detrend1')
  assert.strictEqual(result.steps[0], original[0])
  assert.strictEqual(result.steps[3], original[2])
  assert.deepEqual([...computeDirtySteps(result.steps, original)].sort(), ['step-detrend1', 'step-fft1'])
})

test('insert after a series step reconnects its immediate consumer', () => {
  const original = [
    step('smooth', 'signal', 'smooth1'),
    step('fft', 'smooth1', 'fft1'),
    step('stats', 'smooth1', 'stats1'),
  ]
  const result = insertAnalysisStep(original, 'gaussian', { type: 'after', stepId: 'step-smooth1' }, 'signal')
  assert.ok(result)
  assert.equal(result.inserted.inputId, 'smooth1')
  assert.equal(result.steps[2].inputId, result.inserted.outputId)
  assert.equal(result.steps[3].inputId, 'smooth1', 'a separate branch keeps its chosen input')
})

test('insert after a non-series step uses its series input without reconnecting the next step', () => {
  const original = [step('fft', 'signal', 'fft1'), step('fit', 'signal', 'fit1')]
  const result = insertAnalysisStep(original, 'smooth', { type: 'after', stepId: 'step-fft1' }, 'signal')
  assert.ok(result)
  assert.equal(result.inserted.inputId, 'signal')
  assert.strictEqual(result.steps[2], original[1])
})

test('bottom add appends using the chosen series and a unique output id', () => {
  const original = [step('smooth', 'ds:a:y', 'smooth1')]
  const result = insertAnalysisStep(original, 'smooth', { type: 'end' }, 'ds:b:y')
  assert.ok(result)
  assert.equal(result.inserted.inputId, 'ds:b:y')
  assert.equal(result.inserted.outputId, 'smooth2')
  assert.deepEqual(result.steps.map((entry) => entry.outputId), ['smooth1', 'smooth2'])
})
