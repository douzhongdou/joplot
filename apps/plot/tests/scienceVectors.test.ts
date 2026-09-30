import test from 'node:test'
import assert from 'node:assert/strict'

import { computeValues } from '../src/science/compute/engine.ts'
import { toPreview } from '../src/science/compute/preview.ts'
import { createDense, values1d } from '../src/science/lib/dense.ts'
import { computeDirtySteps } from '../src/science/lib/dirty.ts'
import { valueToCsv } from '../src/science/lib/export.ts'
import { resolveValue, vectorFields, vectorId } from '../src/science/lib/vectors.ts'
import type { FitValue, ScienceValue } from '../src/science/types.ts'
import type { AnalysisStep } from '../src/science/lib/pipeline.ts'

function fit(): FitValue {
  return {
    id: 'fit1', name: 'fit1', kind: 'fit',
    x: createDense(Float64Array.from([10, 20, 30, 40])),
    y: createDense(Float64Array.from([3, 5, 7, 9])),
    fitted: createDense(Float64Array.from([2, 6, 6, 10])),
    residual: createDense(Float64Array.from([1, -1, 1, -1])),
    modelId: 'linear', modelName: 'linear', modelExpr: 'a*x+b',
    params: [], rSquared: 0.8, rmse: 1, iterations: 2,
    converged: true, stopReason: 'converged', provenance: 'test',
  }
}

test('fit vectors are addressable series with the original x axis', async () => {
  const parent = fit()
  assert.deepEqual(vectorFields(parent), ['x', 'y', 'fitted', 'residual'])
  const residual = resolveValue([parent], vectorId(parent.id, 'residual'))
  assert.ok(residual && residual.kind === 'series')
  assert.equal(residual.y, parent.residual)
  assert.deepEqual([...values1d(residual.x)], [10, 20, 30, 40])
  assert.deepEqual([...values1d(residual.y)], [1, -1, 1, -1])

  const preview = toPreview(residual, 3)
  assert.equal(preview.kind, 'series')
  assert.equal(preview.pointCount, 4)
  const csv = await valueToCsv(residual).text()
  assert.match(csv, /10,1\r\n20,-1\r\n/)
})

test('a later analysis step can consume residual and is dirtied when its fit changes', () => {
  const parent = fit()
  const fitStep: AnalysisStep = { id: 'step-fit', op: 'fit', inputId: 'signal', params: {}, outputId: 'fit1' }
  const statsStep: AnalysisStep = { id: 'step-stats', op: 'stats', inputId: 'fit1::residual', params: {}, outputId: 'stats1' }
  const outcome = computeValues({
    base: [parent], steps: [statsStep], dirtyIds: new Set(['step-stats']), cache: new Map<string, ScienceValue>(),
  })
  assert.deepEqual(outcome.errors, {})
  const stats = outcome.values[1]
  assert.equal(stats.kind, 'stats')
  if (stats.kind === 'stats') assert.equal(stats.sourceId, 'fit1::residual')

  assert.deepEqual([...computeDirtySteps([{ ...fitStep }, statsStep], [fitStep, statsStep])].sort(), ['step-fit', 'step-stats'])
})
