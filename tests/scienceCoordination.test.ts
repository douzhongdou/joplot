import test from 'node:test'
import assert from 'node:assert/strict'

import {
  forgetSentEvictions,
  novelEvictions,
  selectionAfterRemoval,
  snapshotStillCurrent,
} from '../src/science/lib/coordination.ts'
import type { AnalysisStep } from '../src/science/lib/pipeline.ts'

function step(id: string, op: string, inputId: string, outputId: string): AnalysisStep {
  return { id, op, inputId, params: {}, outputId }
}

const s1 = step('s1', 'smooth', 'signal', 'smooth1')
const s2 = step('s2', 'fft', 'signal', 'fft1')
const s3 = step('s3', 'fit', 'smooth1', 'fit1')

test('a run response is adopted while its snapshot is still current', () => {
  const steps = [s1, s2, s3]
  assert.equal(snapshotStillCurrent(steps, steps), true)
})

test('a run response computed before a deletion is NOT adopted', () => {
  // 请求在途时删除末步：响应仍满足 id 守卫，但快照已非当前步骤，必须拒绝采纳。
  const snapshot = [s1, s2]
  const current = [s1]
  assert.equal(snapshotStillCurrent(snapshot, current), false)
})

test('a prefix snapshot (run-to-here) is adopted only while it still matches', () => {
  const current = [s1, s2, s3]
  assert.equal(snapshotStillCurrent([s1, s2], current), true, 'unchanged prefix may be adopted')
  assert.equal(snapshotStillCurrent([s1, { ...s2 }], current), false, 'an edited prefix element invalidates it')
})

test('only the evictions actually sent are forgotten, newer ones survive', () => {
  // 请求发出时只带 a；在途期间又登记了 b（删除末步）。响应回来后必须保留 b。
  assert.deepEqual([...forgetSentEvictions(new Set(['a']), ['a'])], [])
  assert.deepEqual([...forgetSentEvictions(new Set(['a', 'b']), ['a'])], ['b'])
  assert.deepEqual([...forgetSentEvictions(new Set(['a']), [])], ['a'], 'sending nothing forgets nothing')
})

test('novelEvictions reports newly removed outputs and skips already-registered ones', () => {
  const previous = [s1, s2]
  const current = [s1]
  assert.deepEqual(novelEvictions(previous, current, new Set()), ['fft1'])
  assert.deepEqual(novelEvictions(previous, current, new Set(['fft1'])), [])
})

test('removing a non-selected step keeps the current selection', () => {
  assert.equal(selectionAfterRemoval('fit1', 'fft1', ['signal', 'smooth1', 'fit1'], 'smooth1'), 'fit1')
})

test('removing the selected step reselects the first surviving value', () => {
  assert.equal(selectionAfterRemoval('fft1', 'fft1', ['signal', 'smooth1', 'fit1'], 'smooth1'), 'signal')
})

test('removing the selected step with no surviving values falls back', () => {
  assert.equal(selectionAfterRemoval('fft1', 'fft1', [], 'smooth1'), 'smooth1')
})
