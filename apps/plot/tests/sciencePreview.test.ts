import test from 'node:test'
import assert from 'node:assert/strict'

import { toPreview, toPreviewInRange } from '../src/science/compute/preview.ts'
import { createDense, values1d } from '../src/science/lib/dense.ts'
import type { FitValue, Series, SpectrumValue } from '../src/science/types.ts'

function makeSeries(length: number): Series {
  const x = new Float64Array(length)
  const y = new Float64Array(length)
  for (let index = 0; index < length; index += 1) {
    x[index] = index
    y[index] = Math.sin(index / 10)
  }
  return { id: 's', name: 's', kind: 'series', x: createDense(x), y: createDense(y), provenance: 'test' }
}

function makeFit(length: number): FitValue {
  const x = new Float64Array(length)
  const y = new Float64Array(length)
  const fitted = new Float64Array(length)
  const residual = new Float64Array(length)
  for (let index = 0; index < length; index += 1) {
    x[index] = index
    y[index] = index * 2 + 1
    fitted[index] = index * 2
    residual[index] = 1
  }
  return {
    id: 'fit1',
    name: 'fit1',
    kind: 'fit',
    x: createDense(x),
    y: createDense(y),
    fitted: createDense(fitted),
    residual: createDense(residual),
    modelId: 'linear',
    modelName: 'linear',
    modelExpr: 'a*x + b',
    params: [],
    rSquared: 1,
    rmse: 0,
    iterations: 1,
    converged: true,
    stopReason: 'converged',
    provenance: 'test',
  }
}

test('toPreviewInRange slices series to the visible window and respects the target', () => {
  const series = makeSeries(100_000)
  const preview = toPreviewInRange(series, { min: 10_000, max: 20_000 }, 500)
  assert.equal(preview.kind, 'series')
  if (preview.kind !== 'series') return
  const x = values1d(preview.x)
  assert.ok(x.length <= 1000, `envelope output should be bounded, got ${x.length}`)
  assert.ok(x[0] >= 10_000 && x[x.length - 1] <= 20_000, 'preview stays inside the visible range')
  assert.equal(preview.pointCount, 100_000, 'pointCount keeps the full-resolution length')
})

test('toPreviewInRange falls back to the plain preview when range is null', () => {
  const series = makeSeries(10_000)
  const ranged = toPreviewInRange(series, null, 256)
  const plain = toPreview(series, 256)
  assert.deepEqual([...values1d(ranged.kind === 'series' ? ranged.x : createDense(new Float64Array()))],
    [...values1d(plain.kind === 'series' ? plain.x : createDense(new Float64Array()))])
})

test('toPreviewInRange keeps fit traces aligned on shared x indices', () => {
  const fit = makeFit(50_000)
  const preview = toPreviewInRange(fit, { min: 5_000, max: 8_000 }, 300)
  assert.equal(preview.kind, 'fit')
  if (preview.kind !== 'fit') return
  const x = values1d(preview.x)
  const y = values1d(preview.y)
  const fitted = values1d(preview.fitted)
  const residual = values1d(preview.residual)
  assert.equal(y.length, x.length)
  assert.equal(fitted.length, x.length)
  assert.equal(residual.length, x.length)
  assert.ok(x[0] >= 5_000 && x[x.length - 1] <= 8_000, 'fit preview stays inside the visible range')
  // y = 2x + 1 & fitted = 2x ⇒ residual ≡ 1，对齐错位会立刻破坏这个恒等式
  for (let index = 0; index < x.length; index += 1) {
    assert.equal(y[index] - fitted[index], residual[index])
  }
})

test('spectrum previews keep phase paired with selected magnitude bins', () => {
  const frequency = Float64Array.from({ length: 2000 }, (_, index) => index)
  const magnitude = Float64Array.from({ length: 2000 }, (_, index) => index % 17 === 0 ? 10 : 1)
  const phase = Float64Array.from({ length: 2000 }, (_, index) => index / 100)
  const spectrum: SpectrumValue = {
    id: 'fft1', name: 'fft1', kind: 'spectrum',
    frequency: createDense(frequency), magnitude: createDense(magnitude), phase: createDense(phase),
    sampleRate: 4000, provenance: 'test',
  }
  for (const preview of [toPreview(spectrum, 100), toPreviewInRange(spectrum, { min: 400, max: 800 }, 100)]) {
    assert.equal(preview.kind, 'spectrum')
    if (preview.kind !== 'spectrum' || !preview.phase) continue
    const x = values1d(preview.frequency)
    const y = values1d(preview.phase)
    assert.equal(x.length, y.length)
    for (let index = 0; index < x.length; index += 1) assert.equal(y[index], x[index] / 100)
  }
})

test('spectrum preview retains a narrow low-frequency line beside a strong DC bin', () => {
  const frequency = Float64Array.from({ length: 100_000 }, (_, index) => index)
  const magnitude = new Float64Array(frequency.length).fill(1)
  magnitude[0] = 1000
  magnitude[12] = 100
  magnitude[89_123] = 50
  const spectrum: SpectrumValue = {
    id: 'fft1', name: 'fft1', kind: 'spectrum',
    frequency: createDense(frequency), magnitude: createDense(magnitude), phase: null,
    sampleRate: 200_000, provenance: 'test',
  }
  for (const preview of [toPreview(spectrum, 400), toPreviewInRange(spectrum, { min: 0, max: 100_000 }, 400)]) {
    assert.equal(preview.kind, 'spectrum')
    if (preview.kind !== 'spectrum') continue
    const x = values1d(preview.frequency)
    assert.ok(x.includes(12), 'the logarithmic low-frequency buckets retain the line')
    assert.ok(x.includes(89_123), 'the linear buckets retain the high-frequency line')
    assert.ok(x.length <= 402)
  }
})
