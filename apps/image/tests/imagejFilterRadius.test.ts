/**
 * Rank 滤波半径的两条契约。
 *
 * 1. **半径可以是小数**（ImageJ 的 RankFilters 半径本来就是 float）；
 * 2. **不设上限**——取多大是用户的选择，实现不能因为"太大"而崩溃或被悄悄夹掉。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { allocateBuffer, type ImageBlock } from '../src/imagej/engine/types.ts'
import { maximum3x3, mean3x3, minimum3x3 } from '../src/imagej/engine/compute/pureOps.ts'

function makeBlock(n: number): ImageBlock {
  const data = allocateBuffer('uint8', n * n) as Uint8Array
  for (let i = 0; i < data.length; i += 1) data[i] = (i * 7 + 3) % 256
  return {
    dtype: 'uint8',
    axes: ['y', 'x'],
    shape: [n, n],
    region: { start: [0, 0], shape: [n, n] },
    data,
  } as unknown as ImageBlock
}

const pixels = (block: ImageBlock) => Array.from(block.data as Uint8Array)

test('半径接受小数', () => {
  const block = makeBlock(12)
  for (const radius of [0.4, 1.5, 2.9, 3.25]) {
    assert.equal(pixels(mean3x3(block, { radius })).length, 144)
  }
})

test('半径不设上限：大窗口不爆栈，且确实覆盖整幅图', () => {
  const block = makeBlock(8)
  const source = pixels(block)
  // 半径远超图像时每个输出都应是整幅图的统计量。
  // 这里以前用 Math.min(...values) 展开实参，半径一大就 RangeError: Maximum call stack size exceeded。
  assert.deepEqual(pixels(minimum3x3(block, { radius: 500 })), new Array(64).fill(Math.min(...source)))
  assert.deepEqual(pixels(maximum3x3(block, { radius: 500 })), new Array(64).fill(Math.max(...source)))
  // 500 与 1000 都覆盖整幅图：结果一致，说明没有被夹到某个上限。
  assert.deepEqual(pixels(mean3x3(block, { radius: 1000 })), pixels(mean3x3(block, { radius: 500 })))
})
