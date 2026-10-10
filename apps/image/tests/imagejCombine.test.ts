import test from 'node:test'
import assert from 'node:assert/strict'
import { blitPage, emptyBuffer, pageGeometry } from '../src/imagej/engine/stackCombine.ts'
import { EngineHost } from '../src/imagej/engine/worker/host.ts'
import { encodeTiffStack } from '../src/imagej/engine/tiff.ts'
import type { Dtype, ImageBlock, PixelArray } from '../src/imagej/engine/types.ts'

function frame(dtype: Dtype, shape: readonly number[], values: readonly number[]): ImageBlock {
  const data = ({
    uint8: () => Uint8Array.from(values),
    uint16: () => Uint16Array.from(values),
    int16: () => Int16Array.from(values),
    float32: () => Float32Array.from(values),
  }[dtype]()) as PixelArray
  return { dtype, axes: ['y', 'x'] as const, shape, region: { start: [0, 0], shape: [...shape] }, data }
}

async function* toFrames(blocks: readonly ImageBlock[]) {
  for (const block of blocks) yield block
}

/** 每页 2×2、值为 [page*10+1 … page*10+4] 的 uint16 栈。 */
async function stackFile(pages: number, width = 2, height = 2): Promise<File> {
  const blocks = Array.from({ length: pages }, (_, page) => {
    const values = Array.from({ length: width * height }, (_, i) => page * 10 + i + 1)
    return frame('uint16', [height, width], values)
  })
  return new File([await encodeTiffStack(toFrames(blocks), pages)], 'stack.tif')
}

async function readPage(host: EngineHost, datasetId: string, revision: number, page: number): Promise<number[]> {
  const recipe = { sourceId: datasetId, sourceRevision: revision, revision: 0, steps: [] }
  const result = await host.run({ datasetId, recipe, selection: { z: page } })
  return Array.from(result.image!.data as Uint16Array)
}

/* ---------------- 页级内核 ---------------- */

test('pageGeometry 与 blitPage 把源页贴到目标页并裁剪越界', () => {
  const target = frame('uint8', [2, 2], [1, 2, 3, 4])
  const source = frame('uint8', [2, 2], [10, 20, 30, 40])
  const geometry = pageGeometry(target)
  assert.deepEqual(geometry, { width: 2, height: 2, planes: 1 })
  const buffer = target.data.slice()
  blitPage(buffer, geometry, source.data, pageGeometry(source), 1, 0)
  // 源的第 0 列落到目标的第 1 列，第 1 列越界被裁掉。
  assert.deepEqual(Array.from(buffer), [1, 10, 3, 30])
})

test('emptyBuffer 分配全 0 缓冲', () => {
  const buffer = emptyBuffer('uint16', { width: 2, height: 2, planes: 1 })
  assert.equal(buffer.length, 4)
  assert.deepEqual(Array.from(buffer as Uint16Array), [0, 0, 0, 0])
})

/* ---------------- Insert ---------------- */

test('Insert 把源栈的页贴到目标栈上，页数不变', async () => {
  const host = new EngineHost()
  const target = await host.import(await stackFile(2))
  const source = await host.import(await stackFile(2, 1, 1))
  const result = await host.combine({
    op: 'insert',
    datasetId: target.dataset.id,
    otherDatasetId: source.dataset.id,
    x: 1,
    y: 0,
  })
  assert.ok(result)
  assert.deepEqual([...result.shape], [2, 2, 2])
  // 源页是 1×1，贴到 (1, 0)：只覆盖目标的右上角。
  assert.deepEqual(await readPage(host, result.id, result.revision, 0), [1, 1, 3, 4])
  assert.deepEqual(await readPage(host, result.id, result.revision, 1), [11, 11, 13, 14])
})

/* ---------------- Combine ---------------- */

test('Combine 水平拼接两栈的页，页数取较大者', async () => {
  const host = new EngineHost()
  const first = await host.import(await stackFile(2, 2, 1))
  const second = await host.import(await stackFile(1, 2, 1))
  const result = await host.combine({
    op: 'combine',
    datasetId: first.dataset.id,
    otherDatasetId: second.dataset.id,
  })
  assert.ok(result)
  assert.deepEqual([...result.shape], [2, 1, 4])
  // 第 1 页 = 左页 [1,2] + 右页 [1,2]；第 2 页只有左侧有页，右侧留 0。
  assert.deepEqual(await readPage(host, result.id, result.revision, 0), [1, 2, 1, 2])
  assert.deepEqual(await readPage(host, result.id, result.revision, 1), [11, 12, 0, 0])
  assert.equal(result.source.name, 'Combined Stacks')
})

test('Combine 垂直拼接时下侧接在上侧之后', async () => {
  const host = new EngineHost()
  const first = await host.import(await stackFile(1, 2, 1))
  const second = await host.import(await stackFile(1, 2, 1))
  const result = await host.combine({
    op: 'combine',
    datasetId: first.dataset.id,
    otherDatasetId: second.dataset.id,
    vertical: true,
  })
  assert.ok(result)
  assert.deepEqual([...result.shape], [1, 2, 2])
  assert.deepEqual(await readPage(host, result.id, result.revision, 0), [1, 2, 1, 2])
})

/* ---------------- Concatenate ---------------- */

test('Concatenate 把多个栈首尾相接，尺寸小的页居中放到最大画布', async () => {
  const host = new EngineHost()
  const small = await host.import(await stackFile(2, 2, 2))
  const wide = await host.import(await stackFile(2, 4, 2))
  const result = await host.combine({
    op: 'concatenate',
    datasetId: small.dataset.id,
    datasetIds: [small.dataset.id, wide.dataset.id],
  })
  assert.ok(result)
  // 4 页 × 2 行 × 4 列（画布取最大宽高）。
  assert.deepEqual([...result.shape], [4, 2, 4])
  // 2×2 的页居中：左右各留一列 0。
  assert.deepEqual(await readPage(host, result.id, result.revision, 0), [0, 1, 2, 0, 0, 3, 4, 0])
  // 4×2 的页本身就等于画布。
  assert.deepEqual(await readPage(host, result.id, result.revision, 2), [1, 2, 3, 4, 5, 6, 7, 8])
  assert.equal(result.source.name, 'Concatenated Stacks')
})

test('页合成在数据集不存在或数量不足时报错', async () => {
  const host = new EngineHost()
  const single = await host.import(await stackFile(2))
  await assert.rejects(() => host.combine({
    op: 'insert',
    datasetId: single.dataset.id,
    otherDatasetId: 'missing',
  }), /未知数据集/)
  await assert.rejects(() => host.combine({
    op: 'concatenate',
    datasetId: single.dataset.id,
    datasetIds: [single.dataset.id],
  }), /至少需要两个数据集/)
})
