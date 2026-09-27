import test from 'node:test'
import assert from 'node:assert/strict'

import { createDense, isDenseContiguous, slice1d, values1d } from '../src/science/lib/dense.ts'
import { describe } from '../src/science/lib/stats.ts'
import { movingAverage, savitzkyGolay } from '../src/science/lib/smooth.ts'
import { detrendValues } from '../src/science/lib/pipeline.ts'

test('dense slice1d is a zero-copy view over the same buffer', () => {
  const data = Float64Array.from([0, 1, 2, 3, 4, 5])
  const dense = createDense(data)
  const view = slice1d(dense, 2, 5)

  assert.equal(view.data, dense.data)
  assert.equal(view.offset, 2)
  assert.deepEqual([...values1d(view)], [2, 3, 4])
  assert.equal(isDenseContiguous(view), false)
  assert.equal(isDenseContiguous(dense), true)
})

test('movingAverage flattens a constant signal', () => {
  const values = new Float64Array(20).fill(4)
  const smoothed = movingAverage(values, 5)
  for (const value of smoothed) {
    assert.ok(Math.abs(value - 4) < 1e-12)
  }
})

test('savitzkyGolay reproduces a straight line (interior)', () => {
  const count = 40
  const values = new Float64Array(count)
  for (let i = 0; i < count; i += 1) {
    values[i] = 3 * i + 1
  }

  const window = 11
  const half = (window - 1) / 2
  const smoothed = savitzkyGolay(values, window, 2)
  for (let i = half; i < count - half; i += 1) {
    assert.ok(Math.abs(smoothed[i] - values[i]) < 1e-6, `index ${i}`)
  }
})

test('describe computes stable moments on a known array', () => {
  const values = Float64Array.from([2, 4, 4, 4, 5, 5, 7, 9])
  const result = describe(values)

  assert.equal(result.count, 8)
  assert.equal(result.mean, 5)
  assert.equal(result.min, 2)
  assert.equal(result.max, 9)
  assert.ok(Math.abs(result.std - 2) < 1e-12)
  assert.equal(result.median, 4.5)
})

test('detrendValues removes a linear trend', () => {
  const values = new Float64Array(50)
  for (let i = 0; i < 50; i += 1) {
    values[i] = 0.8 * i - 12
  }

  const detrended = detrendValues(values, 'linear')
  let maxAbs = 0
  for (const value of detrended) {
    maxAbs = Math.max(maxAbs, Math.abs(value))
  }
  assert.ok(maxAbs < 1e-9)
})
