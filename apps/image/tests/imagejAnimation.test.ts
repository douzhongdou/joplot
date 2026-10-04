import test from 'node:test'
import assert from 'node:assert/strict'
import { animationInterval, nextAnimationStep } from '../src/imagej/lib/animation.ts'

/* ---------------- 帧率 ---------------- */

test('animationInterval 把帧率夹到 [0.1, 1000] 并换算成毫秒', () => {
  assert.equal(animationInterval(7), 1000 / 7)
  assert.equal(animationInterval(1), 1000)
  // 非法 / 非正的帧率回落到 ImageJ 的默认 7 fps。
  assert.equal(animationInterval(0), 1000 / 7)
  assert.equal(animationInterval(Number.NaN), 1000 / 7)
  assert.equal(animationInterval(0.01), 1000 / 0.1)
  assert.equal(animationInterval(10_000), 1000 / 1000)
})

/* ---------------- 步进 ---------------- */

test('nextAnimationStep 顺序推进到末页', () => {
  const base = { first: 1, last: 5, forward: true, loop: false }
  assert.deepEqual(nextAnimationStep({ ...base, current: 0 }, 5), { index: 1, forward: true })
  assert.deepEqual(nextAnimationStep({ ...base, current: 3 }, 5), { index: 4, forward: true })
})

test('不折返时从末页回到起点，从首页跳到末页', () => {
  assert.deepEqual(
    nextAnimationStep({ current: 4, first: 1, last: 5, forward: true, loop: false }, 5),
    { index: 0, forward: true },
  )
  assert.deepEqual(
    nextAnimationStep({ current: 0, first: 1, last: 5, forward: false, loop: false }, 5),
    { index: 4, forward: false },
  )
})

test('折返时不跳帧：末页播完再反向', () => {
  assert.deepEqual(
    nextAnimationStep({ current: 4, first: 1, last: 5, forward: true, loop: true }, 5),
    { index: 3, forward: false },
  )
  assert.deepEqual(
    nextAnimationStep({ current: 0, first: 1, last: 5, forward: false, loop: true }, 5),
    { index: 1, forward: true },
  )
})

test('nextAnimationStep 只在给定区间内游走', () => {
  // 区间 3-5（1-based）→ 下标 2..4。
  const base = { first: 3, last: 5, forward: true, loop: false }
  assert.deepEqual(nextAnimationStep({ ...base, current: 4 }, 8), { index: 2, forward: true })
  assert.deepEqual(nextAnimationStep({ ...base, current: 2, forward: false }, 8), { index: 4, forward: false })
})

test('nextAnimationStep 夹取越界参数，单页区间原地不动', () => {
  // last 夹到 4、current 夹到末页，不折返时因此回到起点。
  assert.deepEqual(
    nextAnimationStep({ current: 99, first: 1, last: 99, forward: true, loop: false }, 4),
    { index: 0, forward: true },
  )
  assert.deepEqual(
    nextAnimationStep({ current: 0, first: 3, last: 3, forward: true, loop: true }, 4),
    { index: 2, forward: true },
  )
})
