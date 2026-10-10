import test from 'node:test'
import assert from 'node:assert/strict'

import { ExpressionError, parseExpression, type ExpressionErrorCode } from '../src/lib/expression.ts'

function evaluate(source: string, scope: Record<string, number> = {}) {
  return parseExpression(source).evaluate(scope)
}

function assertClose(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  )
}

test('parseExpression respects operator precedence and associativity', () => {
  assert.equal(evaluate('1 + 2 * 3'), 7)
  assert.equal(evaluate('(1 + 2) * 3'), 9)
  assert.equal(evaluate('2 ^ 3 ^ 2'), 512)
  assert.equal(evaluate('-2 ^ 2'), -4)
  assert.equal(evaluate('2 ^ -1'), 0.5)
  assert.equal(evaluate('8 / 2 / 2'), 2)
  assert.equal(evaluate('10 - 4 - 3'), 3)
  assert.equal(evaluate('10 % 3'), 1)
  assert.equal(evaluate('-7 % 3'), 2)
  assert.equal(evaluate('--3'), 3)
  assert.equal(evaluate('+4'), 4)
})

test('parseExpression supports implicit multiplication', () => {
  assert.equal(evaluate('2x', { x: 3 }), 6)
  assert.equal(evaluate('2x^2', { x: 3 }), 18)
  assert.equal(evaluate('2x*3', { x: 2 }), 12)
  assert.equal(evaluate('x(x + 1)', { x: 3 }), 12)
  assert.equal(evaluate('(x + 1)(x - 1)', { x: 3 }), 8)
  assertClose(evaluate('2sin(x)', { x: Math.PI / 2 }), 2)
  assert.equal(evaluate('a b', { a: 2, b: 5 }), 10)
  assertClose(evaluate('2pi'), 2 * Math.PI)
})

test('parseExpression evaluates built-in functions and constants', () => {
  assertClose(evaluate('sin(pi / 2)'), 1)
  assertClose(evaluate('cos(0)'), 1)
  assertClose(evaluate('ln(e)'), 1)
  assertClose(evaluate('log(1000)'), 3)
  assertClose(evaluate('log(8, 2)'), 3)
  assertClose(evaluate('log2(8)'), 3)
  assert.equal(evaluate('sqrt(16)'), 4)
  assert.equal(evaluate('cbrt(27)'), 3)
  assert.equal(evaluate('abs(-3)'), 3)
  assert.equal(evaluate('max(1, 5, 3)'), 5)
  assert.equal(evaluate('min(4, 2)'), 2)
  assert.equal(evaluate('floor(2.7) + ceil(2.1)'), 5)
  assert.equal(evaluate('round(2.5)'), 3)
  assert.equal(evaluate('sign(-8)'), -1)
  assert.equal(evaluate('exp(0)'), 1)
  assert.equal(evaluate('mod(-1, 3)'), 2)
  assert.equal(evaluate('pow(2, 10)'), 1024)
  assertClose(evaluate('atan2(1, 1)'), Math.PI / 4)
  assertClose(evaluate('tau'), Math.PI * 2)
})

test('parseExpression disambiguates scientific notation from the e constant', () => {
  assert.equal(evaluate('1.5e2'), 150)
  assert.equal(evaluate('1e-3'), 0.001)
  assertClose(evaluate('2e'), 2 * Math.E)
  assertClose(evaluate('e^1'), Math.E)
  assert.equal(evaluate('.5 + 1'), 1.5)
  assert.equal(evaluate('3.'), 3)
})

test('parseExpression accepts unicode math symbols and full-width punctuation', () => {
  assertClose(evaluate('2×π'), 2 * Math.PI)
  assert.equal(evaluate('x²', { x: 3 }), 9)
  assert.equal(evaluate('x³', { x: 2 }), 8)
  assert.equal(evaluate('6÷3'), 2)
  assert.equal(evaluate('5−2'), 3)
  assert.equal(evaluate('2·3'), 6)
  assert.equal(evaluate('max（1，2）'), 2)
})

test('parseExpression lists free variables without constants', () => {
  assert.deepEqual(parseExpression('a * sin(b*x) + pi').variables, ['a', 'b', 'x'])
  assert.deepEqual(parseExpression('e^x').variables, ['x'])
  assert.deepEqual(parseExpression('42').variables, [])
})

test('parseExpression returns non-finite values instead of throwing at runtime', () => {
  assert.equal(evaluate('1 / x', { x: 0 }), Infinity)
  assert.ok(Number.isNaN(evaluate('sqrt(x)', { x: -1 })))
  assert.ok(Number.isNaN(evaluate('y', {})))
})

test('parseExpression throws positioned errors with stable codes', () => {
  const cases: Array<[string, ExpressionErrorCode, number]> = [
    ['', 'empty', 0],
    ['   ', 'empty', 0],
    ['sin x', 'function-needs-parentheses', 0],
    ['sin(1, 2)', 'wrong-argument-count', 0],
    ['max(1)', 'wrong-argument-count', 0],
    ['1 +', 'unexpected-end', 3],
    ['(1 + 2', 'unexpected-end', 6],
    ['1 + 2)', 'unbalanced-parenthesis', 5],
    ['1.2.3', 'invalid-number', 3],
    ['x = 2', 'unexpected-character', 2],
    ['1 + * 2', 'unexpected-token', 4],
  ]

  for (const [source, code, position] of cases) {
    assert.throws(
      () => parseExpression(source),
      (error: unknown) => error instanceof ExpressionError
        && error.code === code
        && error.position === position,
      `expected "${source}" to fail with ${code} at ${position}`,
    )
  }
})

test('ExpressionError exposes parameters for localized messages', () => {
  try {
    parseExpression('sin(1, 2)')
    assert.fail('expected an error')
  } catch (error) {
    assert.ok(error instanceof ExpressionError)
    assert.deepEqual(error.params, { name: 'sin', expected: '1', actual: '2', position: 0 })
  }
})
