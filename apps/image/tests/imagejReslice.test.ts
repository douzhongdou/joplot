import test from 'node:test'
import assert from 'node:assert/strict'
import { reslice, reslicePageCount } from '../src/imagej/engine/reslice.ts'
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

/** 三页、每页 2×2 的剖面源：页 n 的值是 [4n+1, 4n+2, 4n+3, 4n+4]。 */
function resliceSource() {
  const pages = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]
  return {
    frames: [0, 1, 2],
    readFrame: async (index: number) => frame('uint8', [2, 2], pages[index]!),
  }
}

/* ---------------- 页数 ---------------- */

test('reslicePageCount 按 ImageJ 的 (int)(span/d) 计算', () => {
  const bounds = { x: 0, y: 0, width: 6, height: 8 }
  assert.equal(reslicePageCount(bounds, 1, 'top'), 8)
  assert.equal(reslicePageCount(bounds, 2, 'bottom'), 4)
  assert.equal(reslicePageCount(bounds, 1, 'left'), 6)
  assert.equal(reslicePageCount(bounds, 3, 'right'), 2)
  // 间距大过跨度时至少保留一页。
  assert.equal(reslicePageCount(bounds, 32, 'top'), 1)
})

/* ---------------- 内核 ---------------- */

test('reslice 沿水平线逐条采样，每页高 = 源切片数', async () => {
  const source = resliceSource()
  const pages = await reslice({
    bounds: { x: 0, y: 0, width: 2, height: 2 },
    spacing: 1,
    startAt: 'top',
    flip: false,
    rotate: false,
    ...source,
  })
  assert.equal(pages.length, 2)
  assert.deepEqual([...pages[0]!.shape], [3, 2])
  assert.deepEqual(Array.from(pages[0]!.data as Uint8Array), [1, 2, 5, 6, 9, 10])
  assert.deepEqual(Array.from(pages[1]!.data as Uint8Array), [3, 4, 7, 8, 11, 12])
})

test('reslice 的 Bottom 从选区末端往回采样', async () => {
  const pages = await reslice({
    bounds: { x: 0, y: 0, width: 2, height: 2 },
    spacing: 1,
    startAt: 'bottom',
    flip: false,
    rotate: false,
    ...resliceSource(),
  })
  assert.deepEqual(Array.from(pages[0]!.data as Uint8Array), [3, 4, 7, 8, 11, 12])
  assert.deepEqual(Array.from(pages[1]!.data as Uint8Array), [1, 2, 5, 6, 9, 10])
})

test('reslice 的 Flip vertically 把源切片逆序读出', async () => {
  const pages = await reslice({
    bounds: { x: 0, y: 0, width: 2, height: 2 },
    spacing: 1,
    startAt: 'top',
    flip: true,
    rotate: false,
    ...resliceSource(),
  })
  assert.deepEqual(Array.from(pages[0]!.data as Uint8Array), [9, 10, 5, 6, 1, 2])
})

test('reslice 的 Rotate 90 degrees 转置每一页', async () => {
  const pages = await reslice({
    bounds: { x: 0, y: 0, width: 2, height: 2 },
    spacing: 1,
    startAt: 'top',
    flip: false,
    rotate: true,
    ...resliceSource(),
  })
  assert.deepEqual([...pages[0]!.shape], [2, 3])
  assert.deepEqual(Array.from(pages[0]!.data as Uint8Array), [1, 5, 9, 2, 6, 10])
})

test('reslice 的 Left 沿竖直线采样', async () => {
  const pages = await reslice({
    bounds: { x: 0, y: 0, width: 2, height: 2 },
    spacing: 1,
    startAt: 'left',
    flip: false,
    rotate: false,
    ...resliceSource(),
  })
  // 竖线长 = roiH = 2，页数 = roiW = 2。
  assert.equal(pages.length, 2)
  assert.deepEqual([...pages[0]!.shape], [3, 2])
  assert.deepEqual(Array.from(pages[0]!.data as Uint8Array), [1, 3, 5, 7, 9, 11])
  assert.deepEqual(Array.from(pages[1]!.data as Uint8Array), [2, 4, 6, 8, 10, 12])
})

/* ---------------- 引擎通路 ---------------- */

test('EngineHost.reslice 产出新的 z 栈并按选区采样', async () => {
  const host = new EngineHost()
  const imported = await host.import(await stackFile(3, (page) => [page * 4 + 1, page * 4 + 2, page * 4 + 3, page * 4 + 4]))
  const sliced = await host.reslice({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
    bounds: { x: 0, y: 0, width: 2, height: 2 },
    spacing: 1,
    startAt: 'top',
  })
  assert.ok(sliced)
  assert.deepEqual(sliced.axes, ['z', 'y', 'x'])
  // 2 条水平线 → 2 页；每页 3 行（源切片数）× 2 列。
  assert.deepEqual([...sliced.shape], [2, 3, 2])
  assert.equal(sliced.source.name, `Reslice of ${imported.dataset.source.name}`)

  const read = await host.run({ datasetId: sliced.id, recipe: createRecipe(sliced.id, sliced.revision), selection: { z: 0 } })
  assert.deepEqual(Array.from(read.image!.data as Uint16Array), [1, 2, 5, 6, 9, 10])
})

test('EngineHost.reslice 支持部分切片区间；没有可遍历轴时返回 undefined', async () => {
  const host = new EngineHost()
  const imported = await host.import(await stackFile(3, (page) => [page * 4 + 1, page * 4 + 2, page * 4 + 3, page * 4 + 4]))
  const sliced = await host.reslice({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
    bounds: { x: 0, y: 0, width: 2, height: 2 },
    from: 1,
    to: 2,
    startAt: 'top',
  })
  assert.ok(sliced)
  assert.deepEqual([...sliced.shape], [2, 2, 2])
  const read = await host.run({ datasetId: sliced.id, recipe: createRecipe(sliced.id, sliced.revision), selection: { z: 1 } })
  assert.deepEqual(Array.from(read.image!.data as Uint16Array), [7, 8, 11, 12])

  const blob = await encodeTiffStack(toFrames([frame('uint16', [2, 2], [1, 2, 3, 4])]), 1)
  const single = await host.import(new File([blob], 'single.tif'))
  assert.equal(await host.reslice({
    datasetId: single.dataset.id,
    recipe: createRecipe(single.dataset.id, single.dataset.revision),
    selection: {},
  }), undefined)
})
