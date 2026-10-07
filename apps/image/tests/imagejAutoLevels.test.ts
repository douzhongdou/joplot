/**
 * 自动亮度/对比度的算法契约（移植 ij/plugin/frame/ContrastAdjuster.autoAdjust）。
 *
 * 三条性质：
 * 1. 忽略占比超过 10% 的直方图桶（`limit = pixelCount/10`，超过则视为 0）；
 * 2. 从两端找第一个计数超过 `pixelCount/autoThreshold` 的桶（`autoThreshold` 初值 5000）；
 * 3. 连续调用时 `autoThreshold` 减半 → 门限提高 → 裁剪更多、范围更窄（ImageJ 的"越点越激进"）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { imagejAutoRange } from '../src/imagej/engine/colorAdjustments.ts'

/** 主体在中段、两端各有一个弱信号的直方图。 */
function sampleHistogram() {
  const histogram = new Uint32Array(256)
  histogram[10] = 15
  histogram[200] = 15
  for (let i = 100; i < 150; i += 1) histogram[i] = 1000
  const count = 15 * 2 + 50 * 1000
  return { histogram, count }
}

test('第一次调用用 5000 作为 autoThreshold，切掉两端的弱信号', () => {
  const { histogram, count } = sampleHistogram()
  const first = imagejAutoRange(histogram, count, 0, 255, 0, 0, 255)
  assert.equal(first.autoThreshold, 5000)
  // 门限 = count/5000 ≈ 10，两端的 15 刚好过线，于是范围被收到 10..200。
  assert.equal(first.min, 10)
  assert.equal(first.max, 200)
})

test('连续调用越点越激进：autoThreshold 减半，弱信号被切掉', () => {
  const { histogram, count } = sampleHistogram()
  const first = imagejAutoRange(histogram, count, 0, 255, 0, 0, 255)
  const second = imagejAutoRange(histogram, count, 0, 255, first.autoThreshold, 0, 255)
  assert.equal(second.autoThreshold, 2500)
  // 门限翻倍到 ≈20，两端 15 不再过线 → 只认中段主体，范围明显变窄。
  assert.ok(second.min > first.min, `期望更窄的左端，得到 ${second.min} vs ${first.min}`)
  assert.ok(second.max < first.max, `期望更窄的右端，得到 ${second.max} vs ${first.max}`)
  assert.equal(second.min, 100)
  assert.equal(second.max, 149)
})

test('占比超过 10% 的桶不参与判断', () => {
  const histogram = new Uint32Array(256)
  // 一个巨大的背景峰：占 90%，远超 limit，必须被忽略。
  histogram[0] = 9000
  histogram[120] = 900
  histogram[130] = 900
  const count = 9000 + 1800
  const next = imagejAutoRange(histogram, count, 0, 255, 0, 0, 255)
  // 若 0 号桶参与，min 会是 0；被忽略后应落在背景峰之外。
  assert.ok(next.min > 0, `背景峰应被忽略，得到 min=${next.min}`)
  assert.equal(next.min, 120)
})
