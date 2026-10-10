import test from 'node:test'
import assert from 'node:assert/strict'

import { buildBaseValues, defaultMapping, inferBaseIds, reconcileSteps, remapStepInputs, sanitizeMapping } from '../src/science/lib/base.ts'
import { createDense } from '../src/science/lib/dense.ts'
import type { DatasetSummary, ScienceValue } from '../src/science/types.ts'
import type { AnalysisStep } from '../src/science/lib/pipeline.ts'
import type { SuperDataset, SuperNumericColumn } from '../src/superplot/types.ts'

function series(id: string): ScienceValue {
  return {
    id,
    name: id,
    kind: 'series',
    x: createDense(Float64Array.from([0, 1])),
    y: createDense(Float64Array.from([0, 1])),
    provenance: 'test',
  }
}

function numericColumn(name: string, values: number[]): SuperNumericColumn {
  const data = Float64Array.from(values)
  return {
    name,
    kind: 'number',
    values: data,
    missing: null,
    validCount: data.length,
    missingCount: 0,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  }
}

function dataset(id: string, headers: string[], columns: SuperNumericColumn[], timeColumn: string | null = null): SuperDataset {
  return {
    id,
    fileName: `${id}.csv`,
    headers,
    columns,
    rowCount: columns[0]?.values.length ?? 0,
    numericColumns: columns.map((column) => column.name),
    timeColumn,
    sampleRate: null,
    fileSize: 100,
    createdAt: 1,
  }
}

function summary(overrides: Partial<DatasetSummary>): DatasetSummary {
  return {
    id: 'ds1',
    fileName: 'ds1.csv',
    headers: ['time', 'voltage'],
    numericColumns: ['time', 'voltage'],
    rowCount: 3,
    timeColumn: null,
    createdAt: 1,
    fileSize: 100,
    ...overrides,
  }
}

test('buildBaseValues produces ds: series from dataset + mapping', () => {
  const ds = dataset('scope', ['time', 'voltage'], [
    numericColumn('time', [0, 1, 2]),
    numericColumn('voltage', [1, 2, 3]),
  ])
  const values = buildBaseValues([ds], { scope: { xColumn: 'time', yColumns: ['voltage'] } })
  assert.deepEqual(values.map((value) => value.id), ['ds:scope:voltage'])
  assert.equal(values[0].kind, 'series')
})

test('buildBaseValues skips datasets without a mapping', () => {
  const ds = dataset('scope', ['voltage'], [numericColumn('voltage', [1, 2, 3])])
  assert.deepEqual(buildBaseValues([ds], {}), [])
})

test('remapStepInputs keeps references to other step outputs', () => {
  const steps: AnalysisStep[] = [
    { id: 's1', op: 'smooth', inputId: 'signal', params: {}, outputId: 'smooth1' },
    { id: 's2', op: 'fit', inputId: 'smooth1', params: {}, outputId: 'fit1' },
  ]
  // base 只有 signal；但 smooth1 是步骤产出，必须保留，不能重指向。
  const remapped = remapStepInputs(steps, new Set(['signal', 'smooth1', 'fit1']), 'signal')
  assert.equal(remapped[1].inputId, 'smooth1')
})

test('remapStepInputs redirects missing inputs to the fallback', () => {
  const steps: AnalysisStep[] = [
    { id: 's1', op: 'stats', inputId: 'ds:gone:col', params: {}, outputId: 'stats1' },
  ]
  const remapped = remapStepInputs(steps, new Set(['signal']), 'signal')
  assert.equal(remapped[0].inputId, 'signal')
})

test('sanitizeMapping excludes the X column and keeps at least one Y', () => {
  const s = summary({ numericColumns: ['time', 'voltage', 'current'] })
  assert.deepEqual(sanitizeMapping(s, 'time', ['voltage', 'time', 'voltage']), {
    xColumn: 'time',
    yColumns: ['voltage'],
  })
  assert.deepEqual(sanitizeMapping(s, 'voltage', ['voltage']), {
    xColumn: 'voltage',
    yColumns: ['time'],
  })
})

test('defaultMapping prefers the inferred time column', () => {
  const withTime = summary({ numericColumns: ['t', 'v'], timeColumn: 't' })
  assert.deepEqual(defaultMapping(withTime), { xColumn: 't', yColumns: ['v'] })
  const withoutTime = summary({ numericColumns: ['a', 'b'], timeColumn: null })
  assert.deepEqual(defaultMapping(withoutTime), { xColumn: '', yColumns: ['a'] })
})

test('inferBaseIds drops values produced by steps', () => {
  const values = [series('ds:a:v'), series('smooth1')]
  const produced: AnalysisStep[] = [
    { id: 's1', op: 'smooth', inputId: 'ds:a:v', params: {}, outputId: 'smooth1' },
  ]
  assert.deepEqual(inferBaseIds(values, produced), ['ds:a:v'])
})

test('reconcileSteps remaps stale inputs onto the new base and keeps chains', () => {
  // 新数据集的 base 是 ds:b:v；旧步骤还引用示例信号 signal，且下游链式引用 smooth1。
  const values = [series('ds:b:v'), series('smooth1')]
  const produced: AnalysisStep[] = [
    { id: 's1', op: 'smooth', inputId: 'ds:b:v', params: {}, outputId: 'smooth1' },
  ]
  const current: AnalysisStep[] = [
    { id: 's1', op: 'smooth', inputId: 'signal', params: {}, outputId: 'smooth1' },
    { id: 's2', op: 'fit', inputId: 'smooth1', params: {}, outputId: 'fit1' },
  ]

  const remapped = reconcileSteps(values, produced, current)

  assert.equal(remapped[0].inputId, 'ds:b:v', 'stale base reference moves to the new base')
  assert.equal(remapped[1].inputId, 'smooth1', 'step-to-step chaining is preserved')
})
