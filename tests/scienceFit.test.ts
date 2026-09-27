import test from 'node:test'
import assert from 'node:assert/strict'

import { collectFitParameters, fitModel, FIT_MODELS } from '../src/science/lib/fit.ts'

function parameter(outcome: ReturnType<typeof fitModel>, name: string): number {
  const found = outcome.params.find((entry) => entry.name === name)
  assert.ok(found, `missing parameter ${name}`)
  return found.value
}

test('collectFitParameters lists model variables except x', () => {
  const names = collectFitParameters('a*exp(b*x) + c')
  assert.deepEqual(names, ['a', 'b', 'c'])
})

test('linear fit recovers slope and intercept exactly', () => {
  const x = new Float64Array(60)
  const y = new Float64Array(60)
  for (let i = 0; i < 60; i += 1) {
    x[i] = i / 10
    y[i] = 2.5 * x[i] + 0.7
  }

  const outcome = fitModel({ x, y, expr: 'a*x + b', initial: { a: 1, b: 0 } })

  assert.ok(Math.abs(parameter(outcome, 'a') - 2.5) < 1e-6)
  assert.ok(Math.abs(parameter(outcome, 'b') - 0.7) < 1e-6)
  assert.ok(outcome.rSquared > 0.999999)
  assert.ok(outcome.rmse < 1e-6)
})

test('gaussian fit recovers center, width and amplitude', () => {
  const count = 240
  const x = new Float64Array(count)
  const y = new Float64Array(count)
  const mu = 1.3
  const sigma = 0.4
  const amplitude = 2.2
  const offset = 0.3

  for (let i = 0; i < count; i += 1) {
    x[i] = -2 + (4 * i) / (count - 1)
    const delta = x[i] - mu
    y[i] = amplitude * Math.exp(-(delta * delta) / (2 * sigma * sigma)) + offset
  }

  const outcome = fitModel({
    x,
    y,
    expr: 'a*exp(-((x-mu)^2)/(2*sigma^2)) + c',
    initial: { a: 2, c: 0.2, mu: 1.2, sigma: 0.7 },
  })

  assert.ok(Math.abs(parameter(outcome, 'a') - amplitude) < 1e-3)
  assert.ok(Math.abs(parameter(outcome, 'mu') - mu) < 1e-3)
  assert.ok(Math.abs(parameter(outcome, 'sigma') - sigma) < 1e-3)
  assert.ok(outcome.rSquared > 0.999)
})

test('fit reports standard errors for well-conditioned data', () => {
  const count = 80
  const x = new Float64Array(count)
  const y = new Float64Array(count)
  for (let i = 0; i < count; i += 1) {
    x[i] = i
    y[i] = 3 * x[i] + 5
  }

  const outcome = fitModel({ x, y, expr: 'a*x + b' })
  const slope = outcome.params.find((entry) => entry.name === 'a')

  assert.ok(slope)
  assert.ok(Number.isFinite(slope.stderr))
  assert.ok(slope.stderr < 1e-6)
})

test('large-N fit subsamples for speed but reports on the full data', () => {
  const count = 100_000
  const x = new Float64Array(count)
  const y = new Float64Array(count)
  for (let i = 0; i < count; i += 1) {
    x[i] = i / 1000
    y[i] = 1.25 * x[i] + 3
  }

  const outcome = fitModel({ x, y, expr: 'a*x + b', initial: { a: 0, b: 0 } })

  assert.ok(Math.abs(parameter(outcome, 'a') - 1.25) < 1e-6)
  assert.ok(Math.abs(parameter(outcome, 'b') - 3) < 1e-4)
  assert.equal(outcome.fitted.length, count)
  assert.equal(outcome.residual.length, count)
  assert.ok(outcome.rSquared > 0.999999)
})

test('power model recovers a quadratic law', () => {
  const count = 120
  const x = new Float64Array(count)
  const y = new Float64Array(count)
  for (let i = 0; i < count; i += 1) {
    x[i] = 1 + (4 * i) / (count - 1)
    y[i] = 1.5 * x[i] ** 2 + 0.4
  }

  const model = FIT_MODELS.find((candidate) => candidate.id === 'power')
  assert.ok(model)
  const outcome = fitModel({ x, y, expr: model.expr, initial: model.guess(x, y) })

  assert.ok(Math.abs(parameter(outcome, 'a') - 1.5) < 1e-2)
  assert.ok(Math.abs(parameter(outcome, 'b') - 2) < 1e-2)
  assert.ok(Math.abs(parameter(outcome, 'c') - 0.4) < 1e-2)
  assert.ok(outcome.rSquared > 0.999)
})

test('lorentzian model recovers a peak', () => {
  const count = 200
  const x = new Float64Array(count)
  const y = new Float64Array(count)
  for (let i = 0; i < count; i += 1) {
    x[i] = -2 + (8 * i) / (count - 1)
    y[i] = 3 / (1 + ((x[i] - 2) / 0.5) ** 2) + 0.2
  }

  const model = FIT_MODELS.find((candidate) => candidate.id === 'lorentzian')
  assert.ok(model)
  const outcome = fitModel({ x, y, expr: model.expr, initial: model.guess(x, y) })

  assert.ok(Math.abs(parameter(outcome, 'a') - 3) < 1e-2)
  assert.ok(Math.abs(parameter(outcome, 'mu') - 2) < 1e-2)
  assert.ok(Math.abs(parameter(outcome, 'w') - 0.5) < 1e-2)
  assert.ok(outcome.rSquared > 0.999)
})
