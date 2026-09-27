import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyWindow,
  clipValues,
  differentiate,
  gaussianSmooth,
  integrate,
  linearTransform,
  mapValues,
  movingStat,
  normalizeValues,
} from '../src/science/lib/transforms.ts'
import { OPERATORS, getOperator } from '../src/science/lib/operators.ts'
import { defaultParams, runPipeline, type AnalysisStep } from '../src/science/lib/pipeline.ts'
import { createSampleWorkspace } from '../src/science/lib/workspace.ts'
import { values1d } from '../src/science/lib/dense.ts'

test('mapValues applies the requested function', () => {
  const values = Float64Array.from([-2, -1, 0, 3])
  assert.deepEqual([...mapValues(values, 'abs')], [2, 1, 0, 3])
  assert.deepEqual([...mapValues(values, 'square')], [4, 1, 0, 9])
})

test('linearTransform scales and offsets', () => {
  const values = Float64Array.from([1, 2, 3])
  assert.deepEqual([...linearTransform(values, 2, 1)], [3, 5, 7])
})

test('normalizeValues z-score has zero mean and unit std', () => {
  const values = Float64Array.from([2, 4, 6, 8, 10])
  const normalized = normalizeValues(values, 'zscore')
  const mean = [...normalized].reduce((a, b) => a + b, 0) / normalized.length
  const variance = [...normalized].reduce((a, b) => a + (b - mean) ** 2, 0) / normalized.length
  assert.ok(Math.abs(mean) < 1e-12)
  assert.ok(Math.abs(Math.sqrt(variance) - 1) < 1e-12)
})

test('clipValues clamps to the range', () => {
  const values = Float64Array.from([-5, 0, 5])
  assert.deepEqual([...clipValues(values, -1, 1)], [-1, 0, 1])
})

test('differentiate approximates the derivative of x^2', () => {
  const count = 50
  const x = new Float64Array(count)
  const y = new Float64Array(count)
  for (let i = 0; i < count; i += 1) {
    x[i] = i * 0.1
    y[i] = x[i] * x[i]
  }
  const derivative = differentiate(x, y)
  for (let i = 1; i < count - 1; i += 1) {
    assert.ok(Math.abs(derivative[i] - 2 * x[i]) < 1e-6, `index ${i}`)
  }
})

test('integrate accumulates a trapezoid', () => {
  const x = Float64Array.from([0, 1, 2, 3])
  const y = new Float64Array(4).fill(2)
  assert.deepEqual([...integrate(x, y)], [0, 2, 4, 6])
})

test('movingStat std of a constant is zero', () => {
  const values = new Float64Array(30).fill(7)
  const result = movingStat(values, 5, 'std')
  for (const value of result) {
    assert.ok(Math.abs(value) < 1e-12)
  }
})

test('gaussianSmooth preserves a constant signal', () => {
  const values = new Float64Array(40).fill(3)
  const result = gaussianSmooth(values, 2)
  for (const value of result) {
    assert.ok(Math.abs(value - 3) < 1e-9)
  }
})

test('applyWindow tapers the endpoints with Hann', () => {
  const values = new Float64Array(21).fill(1)
  const result = applyWindow(values, 'hann')
  assert.ok(Math.abs(result[0]) < 1e-9)
  assert.ok(Math.abs(result[result.length - 1]) < 1e-9)
  assert.ok(result[10] > 0.99)
})

test('operator registry has unique kinds and default params', () => {
  const kinds = OPERATORS.map((operator) => operator.kind)
  assert.equal(new Set(kinds).size, kinds.length)
  for (const operator of OPERATORS) {
    const params = defaultParams(operator.kind)
    for (const spec of operator.params) {
      assert.ok(spec.key in params, `${operator.kind}.${spec.key} missing default`)
    }
  }
})

test('every series-producing operator runs on the sample signal', () => {
  const { base } = createSampleWorkspace()
  const signal = base[0]
  assert.ok(signal.kind === 'series')

  for (const kind of ['map', 'linear', 'normalize', 'clip', 'differentiate', 'integrate', 'movingStat', 'gaussian', 'window', 'smooth', 'detrend']) {
    const definition = getOperator(kind)
    assert.ok(definition, `missing operator ${kind}`)
    const output = definition.run(signal, undefined, defaultParams(kind), { id: 'out', name: 'out' })
    assert.equal(output.kind, 'series', `${kind} output kind`)
  }
})

test('expression operator evaluates a user formula with auto parameters', () => {
  const { base } = createSampleWorkspace()
  const signal = base[0]
  assert.ok(signal.kind === 'series')

  const definition = getOperator('expr')
  assert.ok(definition)
  const output = definition.run(
    signal,
    undefined,
    { expr: 'a*y + b', 'expr:a': 2, 'expr:b': 1 },
    { id: 'o', name: 'o' },
  )
  assert.equal(output.kind, 'series')
  if (output.kind !== 'series') return

  const source = values1d(signal.y)
  const result = values1d(output.y)
  for (let i = 0; i < 20; i += 1) {
    assert.ok(Math.abs(result[i] - (2 * source[i] + 1)) < 1e-9, `index ${i}`)
  }
})

test('expression operator can use x and reserved-variable scope', () => {
  const { base } = createSampleWorkspace()
  const signal = base[0]
  if (signal.kind !== 'series') return

  const definition = getOperator('expr')
  assert.ok(definition)
  const output = definition.run(signal, undefined, { expr: 'c*x', 'expr:c': 3 }, { id: 'o', name: 'o' })
  if (output.kind !== 'series') {
    throw new Error('expected series')
  }

  const x = values1d(signal.x)
  const result = values1d(output.y)
  for (let i = 0; i < 20; i += 1) {
    assert.ok(Math.abs(result[i] - 3 * x[i]) < 1e-9, `index ${i}`)
  }
})

test('a math chain runs end to end', () => {
  const { base } = createSampleWorkspace()
  const steps: AnalysisStep[] = [
    { id: 's1', op: 'normalize', inputId: 'signal', params: { mode: 'zscore' }, outputId: 'n1' },
    { id: 's2', op: 'differentiate', inputId: 'n1', params: {}, outputId: 'd1' },
    { id: 's3', op: 'movingStat', inputId: 'd1', params: { stat: 'rms', window: 11 }, outputId: 'm1' },
    { id: 's4', op: 'stats', inputId: 'm1', params: {}, outputId: 'st1' },
  ]
  const { values, errors } = runPipeline(base, steps)
  assert.deepEqual(Object.keys(errors), [], JSON.stringify(errors))
  assert.equal(values.length, base.length + 4)
})
