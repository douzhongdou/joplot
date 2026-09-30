import test from 'node:test'
import assert from 'node:assert/strict'

import { parseExpression, parseExpressionWithGradient } from '../src/lib/expression.ts'

function centralDifference(expr: string, params: Record<string, number>, index: number, at: number): number {
  const parsed = parseExpression(expr)
  const names = parsed.parameterNames
  const step = 1e-6 * Math.max(1, Math.abs(params[names[index]]))
  const build = (delta: number) => {
    const scope: Record<string, number> = { x: at }
    names.forEach((name, i) => {
      scope[name] = params[name] + (i === index ? delta : 0)
    })
    return parsed.evaluate(scope)
  }
  return (build(step) - build(-step)) / (2 * step)
}

test('analytic gradient matches central differences', () => {
  const cases: Array<{ expr: string; params: Record<string, number> }> = [
    { expr: 'a*exp(-b*x)*sin(c*x + d) + o', params: { a: 2.4, b: 0.5, c: 20.1, d: 0.3, o: 0.25 } },
    { expr: 'a*exp(-((x-mu)^2)/(2*sigma^2)) + c', params: { a: 2.2, c: 0.3, mu: 1.3, sigma: 0.4 } },
    { expr: 'a*x^b + c', params: { a: 1.5, b: 2, c: 0.4 } },
    { expr: 'a/(1+exp(-b*(x-c))) + d', params: { a: 5, b: 2, c: 3, d: 1 } },
    { expr: 'a/(1+((x-mu)/w)^2) + c', params: { a: 3, c: 0.2, mu: 2, w: 0.5 } },
    { expr: 'a*ln(x) + b', params: { a: 1.5, b: 0.2 } },
  ]

  for (const { expr, params } of cases) {
    const gradient = parseExpressionWithGradient(expr)
    const names = gradient.parameterNames
    const buffer = new Float64Array(names.length)

    for (const at of [0.4, 1.2, 2.0]) {
      names.forEach((name, i) => {
        buffer[i] = params[name]
      })
      for (let j = 0; j < names.length; j += 1) {
        const out = new Float64Array(1)
        gradient.gradientInto(j, Float64Array.from([at]), null, buffer, out, 1)
        const expected = centralDifference(expr, params, j, at)
        const tolerance = 1e-4 * Math.max(1, Math.abs(expected))
        assert.ok(
          Math.abs(out[0] - expected) <= tolerance,
          `${expr} d/d${names[j]} at ${at}: analytic ${out[0]} vs numeric ${expected}`,
        )
      }
    }
  }
})

test('gradient falls back to finite differences for unsupported functions', () => {
  const expr = 'a*gamma(x) + b'
  const gradient = parseExpressionWithGradient(expr)
  const names = gradient.parameterNames
  const params: Record<string, number> = { a: 1.7, b: 0.3 }
  const buffer = new Float64Array(names.length)
  names.forEach((name, i) => {
    buffer[i] = params[name]
  })
  for (let j = 0; j < names.length; j += 1) {
    const out = new Float64Array(1)
    gradient.gradientInto(j, Float64Array.from([3.2]), null, buffer, out, 1)
    const expected = centralDifference(expr, params, j, 3.2)
    assert.ok(Math.abs(out[0] - expected) <= 1e-4 * Math.max(1, Math.abs(expected)))
  }
})
