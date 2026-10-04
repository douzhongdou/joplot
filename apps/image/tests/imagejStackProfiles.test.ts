import test from 'node:test'
import assert from 'node:assert/strict'
import { computeStackProfiles } from '../src/imagej/engine/stackProfiles.ts'
import { EngineHost } from '../src/imagej/engine/worker/host.ts'
import { encodeTiffStack } from '../src/imagej/engine/tiff.ts'
import { createRecipe } from '../src/imagej/engine/recipe.ts'
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

async function stackFile(pages: number, values: (page: number) => number[]): Promise<File> {
  const blocks = Array.from({ length: pages }, (_, page) => frame('uint16', [2, 2], values(page)))
  return new File([await encodeTiffStack(toFrames(blocks), pages)], 'stack.tif')
}

/* ---------------- 内核 ---------------- */

test('computeStackProfiles 逐页采样并给出共用纵轴范围', async () => {
  const profiles = [
    [1, 2, 3],
    [5, 4, 6],
    [0, 9, 7],
  ]
  const result = await computeStackProfiles({
    frameCount: 3,
    readFrame: async (index) => frame('uint8', [1, 3], profiles[index]!),
    sample: (block) => Array.from(block.data as Uint8Array),
  })
  assert.deepEqual(result.profiles, profiles)
  assert.equal(result.length, 3)
  assert.equal(result.axis, 'z')
  // 纵轴范围覆盖全部曲线，而不是各自归一化。
  assert.equal(result.min, 0)
  assert.equal(result.max, 9)
})

test('computeStackProfiles 按最短剖面长度对齐', async () => {
  const result = await computeStackProfiles({
    frameCount: 2,
    readFrame: async (index) => frame('uint8', [1, 1], [index]),
    sample: (block) => (block.data[0] === 0 ? [1, 2, 3, 4] : [5, 6]),
  })
  assert.equal(result.length, 2)
  assert.deepEqual(result.profiles, [[1, 2], [5, 6]])
})

/* ---------------- 引擎通路 ---------------- */

test('EngineHost.stackProfiles 逐页取矩形中线剖面', async () => {
  const host = new EngineHost()
  const imported = await host.import(await stackFile(3, (page) => [page * 4 + 1, page * 4 + 2, page * 4 + 3, page * 4 + 4]))
  const result = await host.stackProfiles({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
  })
  assert.ok(result)
  // 2×2 图像的水平中线是第 1 行。
  assert.deepEqual(result.profiles, [[3, 4], [7, 8], [11, 12]])
  assert.equal(result.length, 2)
  assert.equal(result.min, 3)
  assert.equal(result.max, 12)
})

test('EngineHost.stackProfiles 支持线选区的采样点，并在没有多页轴时返回 undefined', async () => {
  const host = new EngineHost()
  const imported = await host.import(await stackFile(3, (page) => [page * 4 + 1, page * 4 + 2, page * 4 + 3, page * 4 + 4]))
  const line = await host.stackProfiles({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
    line: { points: [0, 0, 1, 1] },
  })
  assert.ok(line)
  assert.equal(line.frameCount, 3)
  assert.ok(line.length > 0)
  // 对角线的两端分别是左上 (0,0) 与右下 (1,1)，因此范围覆盖这两点。
  assert.equal(line.min, 1)
  assert.equal(line.max, 12)

  const blob = await encodeTiffStack(toFrames([frame('uint16', [2, 2], [1, 2, 3, 4])]), 1)
  const single = await host.import(new File([blob], 'single.tif'))
  assert.equal(await host.stackProfiles({
    datasetId: single.dataset.id,
    recipe: createRecipe(single.dataset.id, single.dataset.revision),
    selection: {},
  }), undefined)
})
