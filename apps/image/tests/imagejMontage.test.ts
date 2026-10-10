import test from 'node:test'
import assert from 'node:assert/strict'
import { autoMontageLayout, makeMontage, splitMontage } from '../src/imagej/engine/montage.ts'
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

/** 2×2 像素的 uint16 多页 TIFF，每页值由调用方给。 */
async function stackFile(pages: number, values: (page: number) => number[]): Promise<File> {
  const blocks = Array.from({ length: pages }, (_, page) => frame('uint16', [2, 2], values(page)))
  return new File([await encodeTiffStack(toFrames(blocks), pages)], 'stack.tif')
}

function readPages(pages: readonly (readonly number[])[]): (index: number) => Promise<ImageBlock> {
  return async (index) => frame('uint8', [2, 2], pages[index]!)
}

/* ---------------- 自动布局 ---------------- */

test('autoMontageLayout 与 ImageJ 的默认行列、缩放规则一致', () => {
  assert.deepEqual(autoMontageLayout(100, 4), { columns: 2, rows: 2, scale: 1 })
  // int(sqrt(7))=2，余 3 张使列数加 ceil(3/2)=2。
  assert.deepEqual(autoMontageLayout(100, 7), { columns: 4, rows: 2, scale: 1 })
  assert.deepEqual(autoMontageLayout(1, 1), { columns: 1, rows: 1, scale: 1 })
  // 宽度 × 列数超过 800 降为 0.5 倍，超过 1600 降为 0.25 倍。
  assert.equal(autoMontageLayout(500, 4).scale, 0.5)
  assert.equal(autoMontageLayout(900, 1).scale, 0.5)
  assert.equal(autoMontageLayout(1700, 1).scale, 0.25)
  // 两页会排成 2 列 1 行，宽度翻倍后落进 0.25 倍档。
  assert.deepEqual(autoMontageLayout(900, 2), { columns: 2, rows: 1, scale: 0.25 })
})

/* ---------------- 拼接 ---------------- */

test('makeMontage 按行优先把各页铺成一张大图', async () => {
  const pages = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]
  const block = await makeMontage({ columns: 2, rows: 2, scale: 1, borderWidth: 0, frames: [0, 1, 2, 3], readFrame: readPages(pages) })
  assert.deepEqual([...block.shape], [4, 4])
  assert.deepEqual(Array.from(block.data as Uint8Array), [
    1, 2, 5, 6,
    3, 4, 7, 8,
    9, 10, 13, 14,
    11, 12, 15, 16,
  ])
})

test('makeMontage 的边框只出现在面板之间', async () => {
  const pages = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]
  const block = await makeMontage({ columns: 2, rows: 2, scale: 1, borderWidth: 1, frames: [0, 1, 2, 3], readFrame: readPages(pages) })
  // outW = 2*2 + 1*(2-1) = 5，外沿没有边框。
  assert.deepEqual([...block.shape], [5, 5])
  const data = Array.from(block.data as Uint8Array)
  // 第 2 列（索引 2）与第 2 行（索引 2 起 5 个）是边框，值为背景 0。
  assert.deepEqual(data.slice(2, 3), [0])
  assert.deepEqual(data.slice(7, 8), [0])
  assert.deepEqual(data.slice(10, 15), [0, 0, 0, 0, 0])
  // 面板本身没有被边框挤掉：5×5 布局的右下角是第 4 张面板的右下像素。
  assert.equal(data[0], 1)
  assert.equal(data[24], 16)
})

test('makeMontage 缩小时用双线性重采样', async () => {
  const pages = [[1, 2, 3, 4]]
  const block = await makeMontage({ columns: 1, rows: 1, scale: 0.5, borderWidth: 0, frames: [0], readFrame: readPages(pages) })
  assert.deepEqual([...block.shape], [1, 1])
  // 目标像素中心落在源的 (0.5, 0.5)，即四邻域平均 2.5，uint8 取整为 3。
  assert.deepEqual(Array.from(block.data as Uint8Array), [3])
})

test('makeMontage 面板数超过行列容量时忽略多余页', async () => {
  const pages = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]
  const block = await makeMontage({ columns: 2, rows: 1, scale: 1, borderWidth: 0, frames: [0, 1, 2], readFrame: readPages(pages) })
  assert.deepEqual([...block.shape], [2, 4])
  assert.deepEqual(Array.from(block.data as Uint8Array), [1, 2, 5, 6, 3, 4, 7, 8])
})

test('makeMontage 的 labelSlices 在面板底部写入序号', async () => {
  const block = await makeMontage({
    columns: 1,
    rows: 1,
    scale: 1,
    borderWidth: 0,
    frames: [0],
    readFrame: async () => frame('uint8', [8, 8], new Array(64).fill(1)),
    labelSlices: true,
    fontSize: 5,
  })
  assert.deepEqual([...block.shape], [8, 8])
  const data = Array.from(block.data as Uint8Array)
  // 字号 5 → 1 倍点阵（3×5）；标签居中偏左、贴着面板底部。
  // '1' 是第三列竖线：x = floor((8-3)/2) + 2 = 4，y 从 8-5 = 3 起。
  assert.equal(data[3 * 8 + 4], 255)
  assert.equal(data[7 * 8 + 4], 255)
  // 没被字形覆盖的地方保持原值。
  assert.equal(data[0], 1)
  assert.equal(data[3 * 8 + 3], 1)
})

/* ---------------- 引擎通路 ---------------- */

test('EngineHost.montage 产出单页数据集并按自动布局拼接', async () => {
  const host = new EngineHost()
  const imported = await host.import(await stackFile(4, (page) => [page * 4 + 1, page * 4 + 2, page * 4 + 3, page * 4 + 4]))
  const montaged = await host.montage({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
    columns: 2,
    rows: 2,
  })
  assert.ok(montaged)
  // 蒙太奇是单页图：切片轴被投影掉。
  assert.deepEqual(montaged.axes, ['y', 'x'])
  assert.deepEqual([...montaged.shape], [4, 4])
  const read = await host.run({ datasetId: montaged.id, recipe: createRecipe(montaged.id, montaged.revision), selection: {} })
  assert.deepEqual(Array.from(read.image!.data as Uint16Array), [
    1, 2, 5, 6,
    3, 4, 7, 8,
    9, 10, 13, 14,
    11, 12, 15, 16,
  ])
})

test('EngineHost.montage 支持步长，并在没有多页轴时返回 undefined', async () => {
  const host = new EngineHost()
  const imported = await host.import(await stackFile(4, (page) => [page, page, page, page]))
  const skipped = await host.montage({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
    columns: 2,
    rows: 1,
    increment: 2,
  })
  assert.ok(skipped)
  const read = await host.run({ datasetId: skipped.id, recipe: createRecipe(skipped.id, skipped.revision), selection: {} })
  assert.deepEqual(Array.from(read.image!.data as Uint16Array), [0, 0, 2, 2, 0, 0, 2, 2])

  const blob = await encodeTiffStack(toFrames([frame('uint16', [1, 2], [1, 2])]), 1)
  const single = await host.import(new File([blob], 'single.tif'))
  assert.equal(await host.montage({
    datasetId: single.dataset.id,
    recipe: createRecipe(single.dataset.id, single.dataset.revision),
    selection: {},
  }), undefined)
})

/* ---------------- Montage to Stack ---------------- */

test('splitMontage 是 makeMontage 的逆运算（行优先）', async () => {
  const pages = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]
  const block = await makeMontage({ columns: 2, rows: 2, scale: 1, borderWidth: 0, frames: [0, 1, 2, 3], readFrame: readPages(pages) })
  const split = splitMontage(block, { columns: 2, rows: 2, borderWidth: 0 })
  assert.equal(split.length, 4)
  assert.deepEqual(split.map((page) => Array.from(page.data as Uint8Array)), pages)
})

test('splitMontage 按 ImageJ 的公式裁掉边框（左 1、右 border/2）', async () => {
  const pages = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]
  // 2×2 面板 + 1 像素边框 → 5×5；每页裁到 1×1，取面板内偏移 (1,1) 的像素。
  const block = await makeMontage({ columns: 2, rows: 2, scale: 1, borderWidth: 1, frames: [0, 1, 2, 3], readFrame: readPages(pages) })
  const split = splitMontage(block, { columns: 2, rows: 2, borderWidth: 1 })
  assert.deepEqual([...split[0]!.shape], [1, 1])
  assert.deepEqual(split.map((page) => Array.from(page.data as Uint8Array)), [[4], [8], [12], [16]])
})

test('EngineHost.montageToStack 沿用元数据行列，把蒙太奇切回等长的栈', async () => {  const host = new EngineHost()
  const imported = await host.import(await stackFile(4, (page) => [page * 4 + 1, page * 4 + 2, page * 4 + 3, page * 4 + 4]))
  const empty = createRecipe(imported.dataset.id, imported.dataset.revision)
  const montaged = await host.montage({ datasetId: imported.dataset.id, recipe: empty, selection: {}, columns: 2, rows: 2 })
  assert.ok(montaged)
  assert.equal(montaged.metadata.montageColumns, 2)

  // 不传行列：沿用 montage 写进元数据的 2×2。
  const stacked = await host.montageToStack({
    datasetId: montaged.id,
    recipe: createRecipe(montaged.id, montaged.revision),
    selection: {},
  })
  assert.ok(stacked)
  assert.deepEqual(stacked.axes, ['z', 'y', 'x'])
  assert.deepEqual([...stacked.shape], [4, 2, 2])
  const roundTrip = createRecipe(stacked.id, stacked.revision)
  for (let page = 0; page < 4; page += 1) {
    const read = await host.run({ datasetId: stacked.id, recipe: roundTrip, selection: { z: page } })
    assert.deepEqual(Array.from(read.image!.data as Uint16Array), [page * 4 + 1, page * 4 + 2, page * 4 + 3, page * 4 + 4])
  }
})

test('EngineHost.remontage 按新行列重排蒙太奇并写回元数据', async () => {
  const host = new EngineHost()
  const imported = await host.import(await stackFile(4, (page) => [1, 2, 3, 4].map((value) => page * 10 + value)))
  const montaged = await host.montage({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
    columns: 2,
    rows: 2,
  })
  assert.ok(montaged)
  assert.deepEqual([...montaged.shape], [4, 4])

  // 2×2 → 4×1：拆成 4 页 2×2 再横向排成一行。
  const remontaged = await host.remontage({
    datasetId: montaged.id,
    recipe: createRecipe(montaged.id, montaged.revision),
    selection: {},
    columns: 4,
    rows: 1,
  })
  assert.ok(remontaged)
  assert.deepEqual([...remontaged.shape], [2, 8])
  // 新行列写进元数据，供后续 Montage to Stack 沿用。
  assert.equal(remontaged.metadata.montageColumns, 4)
  assert.equal(remontaged.metadata.montageRows, 1)

  // 第 1 页是原第 1 张（值 1..4），重排后仍在左上角。
  const read = await host.run({ datasetId: remontaged.id, recipe: createRecipe(remontaged.id, remontaged.revision), selection: {} })
  assert.deepEqual(Array.from(read.image!.data as Uint16Array).slice(0, 2), [1, 2])
})
