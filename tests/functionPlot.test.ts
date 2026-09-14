import test from 'node:test'
import assert from 'node:assert/strict'

import { parseExpression } from '../src/lib/expression.ts'
import {
  computeAdaptiveYRange,
  formatPlotNumber,
  listFreeParameters,
  sampleCurve,
  sampledCurveToCsvRows,
} from '../src/lib/functionPlot.ts'

function sample(expression: string, options: { xMin: number; xMax: number; samples: number; params?: Record<string, number> }) {
  return sampleCurve('curve', expression, '#155eef', parseExpression(expression), {
    params: {},
    ...options,
  })
}

test('sampleCurve evaluates evenly spaced points using parameters', () => {
  const curve = sample('a * x', { xMin: 0, xMax: 1, samples: 5, params: { a: 2 } })

  assert.deepEqual(curve.xs, [0, 0.25, 0.5, 0.75, 1])
  assert.deepEqual(curve.ys, [0, 0.5, 1, 1.5, 2])
  assert.equal(curve.id, 'curve')
  assert.equal(curve.color, '#155eef')
})

test('sampleCurve turns non-finite values into gaps', () => {
  const curve = sample('sqrt(x)', { xMin: -1, xMax: 1, samples: 3 })

  assert.deepEqual(curve.ys, [null, 0, 1])
})

test('sampleCurve inserts a gap across a vertical asymptote', () => {
  const curve = sample('1 / x', { xMin: -1, xMax: 1, samples: 200 })
  const gapIndex = curve.ys.indexOf(null)

  assert.equal(curve.ys.filter((value) => value === null).length, 1)
  assert.equal(curve.xs.length, 201)
  assert.ok(Math.abs(curve.xs[gapIndex]) < 0.01)
})

test('sampleCurve keeps ordinary jumps connected', () => {
  const curve = sample('sign(x)', { xMin: -1, xMax: 1, samples: 200 })

  assert.equal(curve.ys.includes(null), false)
})

test('sampleCurve does not mistake a plain zero crossing for an asymptote', () => {
  const curve = sample('sin(x)', { xMin: 0, xMax: 2 * Math.PI, samples: 5 })
  const coarseLine = sample('x', { xMin: -10, xMax: 10, samples: 4 })

  assert.equal(curve.ys.filter((value) => value === null).length, 0)
  assert.equal(curve.xs.length, 5)
  assert.equal(coarseLine.ys.filter((value) => value === null).length, 0)
})

test('sampleCurve drops values that would wreck the plot scale', () => {
  const curve = sample('exp(x)', { xMin: 0, xMax: 20, samples: 21 })

  assert.equal(curve.ys[0], 1)
  assert.equal(curve.ys[curve.ys.length - 1], null)
})

test('listFreeParameters excludes the plot variable', () => {
  assert.deepEqual(listFreeParameters(parseExpression('a * sin(b * x)')), ['a', 'b'])
  assert.deepEqual(listFreeParameters(parseExpression('x^2')), [])
})

test('sampledCurveToCsvRows writes compact numeric strings and blanks for gaps', () => {
  const curve = sample('1 / x', { xMin: -1, xMax: 1, samples: 3 })
  const rows = sampledCurveToCsvRows(curve)

  assert.deepEqual(rows, [
    { x: '-1', y: '-1' },
    { x: '0', y: '' },
    { x: '1', y: '1' },
  ])
})

test('formatPlotNumber trims floating point noise', () => {
  assert.equal(formatPlotNumber(0.1 + 0.2), '0.3')
  assert.equal(formatPlotNumber(3), '3')
  assert.equal(formatPlotNumber(-2.5), '-2.5')
})

test('computeAdaptiveYRange returns null without finite samples', () => {
  assert.equal(computeAdaptiveYRange([]), null)
  assert.equal(computeAdaptiveYRange([sample('sqrt(-1 + 0*x)', { xMin: -1, xMax: 1, samples: 3 })]), null)
})

test('computeAdaptiveYRange keeps the exact padded range for ordinary curves', () => {
  const line = sample('x', { xMin: -10, xMax: 10, samples: 21 })
  const sine = sample('sin(x)', { xMin: 0, xMax: 2 * Math.PI, samples: 5 })
  const sineRange = computeAdaptiveYRange([sine]) ?? [NaN, NaN]

  assert.deepEqual(computeAdaptiveYRange([line]), [-11, 11])
  assert.ok(Math.abs(sineRange[0] + 1.1) < 1e-6 && Math.abs(sineRange[1] - 1.1) < 1e-6)
})

test('computeAdaptiveYRange clips asymptote spikes around the bulk of the data', () => {
  const tanCurve = sample('tan(x)', { xMin: -10, xMax: 10, samples: 800 })
  const [low, high] = computeAdaptiveYRange([tanCurve]) ?? [NaN, NaN]

  assert.ok(high < 30, `expected the clipped upper bound below 30, got ${high}`)
  assert.ok(low > -30, `expected the clipped lower bound above -30, got ${low}`)
  assert.ok(low < -3 && high > 3, `expected the range to still show a couple of branches, got [${low}, ${high}]`)
})

test('computeAdaptiveYRange keeps the honest range for curves that genuinely grow', () => {
  const expCurve = sample('exp(x)', { xMin: -10, xMax: 10, samples: 400 })
  const [low, high] = computeAdaptiveYRange([expCurve]) ?? [NaN, NaN]

  assert.ok(low >= 0, `expected low bound >= 0, got ${low}`)
  assert.ok(high > 20000, `expected exp growth to stay visible, got ${high}`)
})

test('computeAdaptiveYRange expands a constant curve', () => {
  const constant = sample('5', { xMin: 0, xMax: 1, samples: 5 })

  assert.deepEqual(computeAdaptiveYRange([constant]), [4, 6])
})
