import test from 'node:test'
import assert from 'node:assert/strict'

import { createSampleWorkspace } from '../src/science/lib/workspace.ts'
import { runPipeline } from '../src/science/lib/pipeline.ts'
import { resolveValue, vectorFields } from '../src/science/lib/vectors.ts'

test('sample pipeline runs without errors and fits the damped signal', () => {
  const { base, steps } = createSampleWorkspace()
  const { values, errors } = runPipeline(base, steps)

  assert.deepEqual(Object.keys(errors), [], `pipeline errors: ${JSON.stringify(errors)}`)
  assert.deepEqual(values.map((value) => value.id), ['signal', 'smooth1', 'fft1', 'fit1'])

  const fit = values.find((value) => value.id === 'fit1')
  assert.ok(fit && fit.kind === 'fit')
  assert.ok(fit.rSquared > 0.8, `damped fit r2=${fit.rSquared}`)

  const spectrum = values.find((value) => value.id === 'fft1')
  assert.ok(spectrum && spectrum.kind === 'spectrum')
  assert.ok(spectrum.phase)
  assert.deepEqual(vectorFields(spectrum), ['frequency', 'magnitude', 'phase'])
  assert.equal(resolveValue(values, 'fft1::phase')?.kind, 'series')
})
