/**
 * 主线程同步直方图。
 *
 * 契约：不抽样时必须与逐像素统计完全一致（它是 B&C 的 Auto 与显示范围的依据）；
 * 抽样只发生在超大图上，且只按行抽，行内保持连续访问。
 *
 * 性能：首次调用含 JIT 编译开销，所以这里取多轮最小值——那才是翻页时的稳态成本。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { allocateBuffer, type ImageBlock } from '../src/imagej/engine/types.ts'
import { fastHistogram } from '../src/imagej/lib/fastHistogram.ts'

function makeBlock(width: number, height: number, fill: (index: number) => number): ImageBlock {
  const data = allocateBuffer('uint8', width * height) as Uint8Array
  for (let i = 0; i < data.length; i += 1) data[i] = fill(i)
  return {
    dtype: 'uint8',
    axes: ['y', 'x'],
    shape: [height, width],
    region: { start: [0, 0], shape: [height, width] },
    data,
  } as unknown as ImageBlock
}

/** 多轮取最小值（毫秒）。 */
function bestMs(run: () => void, rounds = 8): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < rounds; i += 1) {
    const started = performance.now()
    run()
    best = Math.min(best, performance.now() - started)
  }
  return best
}

test('小图不抽样：计数与逐像素统计完全一致', () => {
  const block = makeBlock(32, 32, (i) => (i * 7 + 3) % 256)
  const histogram = fastHistogram(block, 'all')
  const expected = new Uint32Array(256)
  const data = block.data as Uint8Array
  let min = 255
  let max = 0
  for (const value of data) {
    expected[value] += 1
    if (value < min) min = value
    if (value > max) max = value
  }
  assert.equal(histogram.sampled, false)
  assert.equal(histogram.count, data.length)
  assert.deepEqual(Array.from(histogram.counts), Array.from(expected))
  assert.equal(histogram.min, min)
  assert.equal(histogram.max, max)
})

test('双峰结构保留，值域正确', () => {
  const block = makeBlock(2048, 2048, (i) => (i % 256 < 128 ? 10 : 200))
  const histogram = fastHistogram(block, 'all')
  assert.equal(histogram.counts.reduce((sum, value) => sum + value, 0), histogram.count)
  assert.equal(Array.from(histogram.counts).filter((count) => count > 0).length, 2)
  assert.deepEqual([histogram.min, histogram.max], [10, 200])
})

test('空块不会崩', () => {
  const block = makeBlock(0, 0, () => 0)
  const histogram = fastHistogram(block, 'all')
  assert.equal(histogram.count, 0)
  assert.equal(histogram.counts.length, 256)
})

test('性能：4M 与 12.6M 像素的稳态耗时必须在帧预算内', () => {
  const mid = makeBlock(2048, 2048, (i) => (i * 31) % 256)
  const large = makeBlock(4096, 3072, (i) => (i * 31) % 256)
  const midMs = bestMs(() => { fastHistogram(mid, 'all') })
  const largeMs = bestMs(() => { fastHistogram(large, 'all') })
  console.log(`    4M 像素 ${midMs.toFixed(2)}ms · 12.6M 像素 ${largeMs.toFixed(2)}ms`)
  // 60fps 预算是 16.7ms；直方图必须远低于它，否则翻页就掉帧。
  assert.ok(midMs < 6, `4M 像素太慢：${midMs.toFixed(2)}ms`)
  assert.ok(largeMs < 16, `12.6M 像素太慢：${largeMs.toFixed(2)}ms`)
})
