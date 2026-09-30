import test from 'node:test'
import assert from 'node:assert/strict'

import { downsamplePoints, lttb, minMaxEnvelope, sliceByRange } from '../src/superplot/lib/downsample.ts'

function buildSeries(length: number) {
  const x = new Float64Array(length)
  const y = new Float64Array(length)
  for (let i = 0; i < length; i += 1) {
    x[i] = i
    y[i] = Math.sin(i / 10)
  }
  return { x, y }
}

test('minMaxEnvelope keeps spikes that plain striding would drop', () => {
  const { x, y } = buildSeries(10000)
  y[1234] = 999
  y[8500] = -999

  const result = minMaxEnvelope(x, y, 500)

  assert.ok(result.y.length <= 500 * 2 + 2)
  assert.ok(result.y.includes(999))
  assert.ok(result.y.includes(-999))
  assert.equal(result.x[0], 0)
  assert.equal(result.x[result.x.length - 1], 9999)
})

test('lttb returns exactly the requested number of points and keeps the ends', () => {
  const { x, y } = buildSeries(5000)
  const result = lttb(x, y, 300)

  assert.equal(result.x.length, 300)
  assert.equal(result.y.length, 300)
  assert.equal(result.x[0], 0)
  assert.equal(result.x[299], 4999)
})

test('downsamplePoints with none returns the original series', () => {
  const { x, y } = buildSeries(500)
  const result = downsamplePoints(x, y, 'none', 50)

  assert.equal(result.x.length, 500)
  assert.deepEqual(Array.from(result.x.slice(0, 3)), [0, 1, 2])
})

test('downsamplePoints honours a zoom range', () => {
  const { x, y } = buildSeries(10000)
  const result = downsamplePoints(x, y, 'auto', 100, { min: 2000, max: 3000 })

  assert.ok(result.x.length > 0)
  assert.ok(result.x[0] >= 2000)
  assert.ok(result.x[result.x.length - 1] <= 3000)
})

test('sliceByRange binary-searches a monotonically increasing axis', () => {
  const { x, y } = buildSeries(1000)
  const result = sliceByRange(x, y, 100, 199)

  assert.equal(result.x.length, 100)
  assert.equal(result.x[0], 100)
  assert.equal(result.x[99], 199)
})
