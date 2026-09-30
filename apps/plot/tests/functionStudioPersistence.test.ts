import test from 'node:test'
import assert from 'node:assert/strict'

import { MAX_SAMPLES } from '../src/lib/functionPlot.ts'
import {
  DEFAULT_FUNCTION_STUDIO_STATE,
  MAX_CURVES,
  deserializeFunctionStudioState,
  serializeFunctionStudioState,
  type FunctionStudioState,
} from '../src/lib/functionStudioPersistence.ts'
import { getChartColor } from '../src/lib/theme.ts'

test('function studio state survives a serialize/deserialize round trip', () => {
  const state: FunctionStudioState = {
    curves: [
      { id: 'curve-a', expression: 'sin(x)', color: '#123456', visible: false },
      { id: 'curve-b', expression: 'a * x', color: '#abcdef', visible: true },
    ],
    xMin: -3,
    xMax: 3,
    yMin: '-2',
    yMax: '',
    samples: 500,
    params: [{ name: 'a', value: 2, min: 0, max: 4, step: 0.5 }],
  }

  assert.deepEqual(deserializeFunctionStudioState(serializeFunctionStudioState(state)), state)
})

test('deserializeFunctionStudioState restores empty y range strings for legacy payloads', () => {
  const restored = deserializeFunctionStudioState(JSON.stringify({
    curves: [{ id: 'curve-a', expression: 'sin(x)', color: '#123456', visible: true }],
    xMin: -3,
    xMax: 3,
    samples: 500,
    params: [],
    yMin: 5,
  }))

  assert.equal(restored.yMin, '')
  assert.equal(restored.yMax, '')
})

test('deserializeFunctionStudioState falls back to defaults for malformed payloads', () => {
  assert.deepEqual(deserializeFunctionStudioState(null), DEFAULT_FUNCTION_STUDIO_STATE)
  assert.deepEqual(deserializeFunctionStudioState('not json'), DEFAULT_FUNCTION_STUDIO_STATE)
  assert.deepEqual(deserializeFunctionStudioState('[]'), DEFAULT_FUNCTION_STUDIO_STATE)
  assert.deepEqual(deserializeFunctionStudioState('{"curves": []}'), DEFAULT_FUNCTION_STUDIO_STATE)
})

test('deserializeFunctionStudioState repairs invalid numbers, colors and ranges', () => {
  const restored = deserializeFunctionStudioState(JSON.stringify({
    curves: [{ expression: 'x', color: 'red' }, { expression: '   ' }, null],
    xMin: 5,
    xMax: -5,
    samples: 999999,
    params: [{ name: 'k', value: 100, min: 0, max: 1, step: -1 }, { name: '' }],
  }))

  assert.equal(restored.xMin, -5)
  assert.equal(restored.xMax, 5)
  assert.equal(restored.samples, MAX_SAMPLES)
  assert.equal(restored.curves.length, 1)
  assert.equal(restored.curves[0].color, getChartColor(0))
  assert.equal(restored.curves[0].visible, true)
  assert.ok(restored.curves[0].id.startsWith('curve-'))
  assert.deepEqual(restored.params, [{ name: 'k', value: 1, min: 0, max: 1, step: 0.1 }])
})

test('deserializeFunctionStudioState caps the number of curves', () => {
  const curves = Array.from({ length: MAX_CURVES + 5 }, (_, index) => ({
    id: `curve-${index}`,
    expression: `x + ${index}`,
    color: '#155eef',
    visible: true,
  }))

  const restored = deserializeFunctionStudioState(JSON.stringify({ curves }))

  assert.equal(restored.curves.length, MAX_CURVES)
})
