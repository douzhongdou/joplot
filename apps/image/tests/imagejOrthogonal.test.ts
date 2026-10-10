import test from 'node:test'
import assert from 'node:assert/strict'
import { orthogonalViews } from '../src/imagej/engine/orthogonal.ts'
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

/** 三页 2×2：页 n 的值是 [4n+1 … 4n+4]（行优先）。 */
function views(zScale = 1) {
  const pages = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]
  return orthogonalViews({
    point: { x: 1, y: 0 },
    frames: [0, 1, 2],
    zScale,
    readFrame: async (index) => frame('uint8', [2, 2], pages[index]!),
  })
}

/* ---------------- 内核 ---------------- */

test('orthogonalViews 的 XZ 取交叉点所在行、YZ 取所在列', async () => {
  const { xz, yz } = await views()
  // XZ：横 x、纵 z → 3 行（z）× 2 列（x）。
  assert.deepEqual([...xz.shape], [3, 2])
  assert.deepEqual(Array.from(xz.data as Uint8Array), [1, 2, 5, 6, 9, 10])
  // YZ：横 z、纵 y → 2 行（y）× 3 列（z）。
  assert.deepEqual([...yz.shape], [2, 3])
  assert.deepEqual(Array.from(yz.data as Uint8Array), [2, 6, 10, 4, 8, 12])
})

test('orthogonalViews 按 zScale 沿 z 方向重采样', async () => {
  const { xz, yz } = await views(2)
  // z 方向长度翻倍：XZ 6 行、YZ 6 列。
  assert.deepEqual([...xz.shape], [6, 2])
  assert.deepEqual([...yz.shape], [2, 6])
  // x=0 这条 z 序列是 [1,5,9]，双线性插到 6 个采样点。
  const firstColumn = [0, 1, 2, 3, 4, 5].map((row) => (xz.data as Uint8Array)[row * 2]!)
  assert.deepEqual(firstColumn, [1, 2, 4, 6, 8, 9])
})

test('orthogonalViews 夹取越界的交叉点', async () => {
  const pages = [[1, 2, 3, 4], [5, 6, 7, 8]]
  const { xz } = await orthogonalViews({
    point: { x: 99, y: -5 },
    frames: [0, 1],
    readFrame: async (index) => frame('uint8', [2, 2], pages[index]!),
  })
  // 夹到 (1, 0)：XZ 的第一行仍是第 0 行，第二列是 x=1。
  assert.deepEqual(Array.from(xz.data as Uint8Array), [1, 2, 5, 6])
})

/* ---------------- 引擎通路 ---------------- */

test('EngineHost.orthogonal 产出 XZ 与 YZ 两个新数据集', async () => {
  const host = new EngineHost()
  const imported = await host.import(await stackFile(3, (page) => [page * 4 + 1, page * 4 + 2, page * 4 + 3, page * 4 + 4]))
  const viewsResult = await host.orthogonal({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
    point: { x: 1, y: 0 },
  })
  assert.equal(viewsResult.length, 2)
  const [xz, yz] = viewsResult as [typeof viewsResult[0], typeof viewsResult[0]]
  assert.deepEqual(xz.axes, ['y', 'x'])
  assert.deepEqual([...xz.shape], [3, 2])
  assert.equal(xz.source.name, 'XZ 0')
  assert.deepEqual([...yz.shape], [2, 3])
  assert.equal(yz.source.name, 'YZ 1')

  const readXz = await host.run({ datasetId: xz.id, recipe: createRecipe(xz.id, xz.revision), selection: {} })
  assert.deepEqual(Array.from(readXz.image!.data as Uint16Array), [1, 2, 5, 6, 9, 10])
})

test('EngineHost.orthogonal 交叉点缺省取图像中心，无多页轴时返回空', async () => {
  const host = new EngineHost()
  const imported = await host.import(await stackFile(3, (page) => [page * 4 + 1, page * 4 + 2, page * 4 + 3, page * 4 + 4]))
  const centered = await host.orthogonal({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
  })
  // 2×2 图像的中心是 (1, 1)：XZ 取第 1 行、YZ 取第 1 列。
  assert.deepEqual(Array.from((await host.run({ datasetId: centered[0]!.id, recipe: createRecipe(centered[0]!.id, centered[0]!.revision), selection: {} })).image!.data as Uint16Array), [3, 4, 7, 8, 11, 12])

  const blob = await encodeTiffStack(toFrames([frame('uint16', [2, 2], [1, 2, 3, 4])]), 1)
  const single = await host.import(new File([blob], 'single.tif'))
  assert.deepEqual(await host.orthogonal({
    datasetId: single.dataset.id,
    recipe: createRecipe(single.dataset.id, single.dataset.revision),
    selection: {},
  }), [])
})
