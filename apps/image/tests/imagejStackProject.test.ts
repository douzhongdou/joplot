import test from 'node:test'
import assert from 'node:assert/strict'
import { projectFrames, projectionDtype, type ProjectionMethod } from '../src/imagej/engine/stackProject.ts'
import { EngineHost } from '../src/imagej/engine/worker/host.ts'
import { encodeTiffStack } from '../src/imagej/engine/tiff.ts'
import { createRecipe } from '../src/imagej/engine/recipe.ts'
import { importMemory, type ImportResult } from '../src/imagej/engine/importer.ts'
import type { Dataset } from '../src/imagej/engine/dataset.ts'
import type { Storage } from '../src/imagej/engine/storage.ts'
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
  const blocks = Array.from({ length: pages }, (_, page) => frame('uint16', [2, 4], values(page)))
  const blob = await encodeTiffStack(toFrames(blocks), pages)
  return new File([blob], 'stack.tif')
}

async function project(dtype: Dtype, method: ProjectionMethod, pages: readonly (readonly number[])[]) {
  const blocks = pages.map((values) => frame(dtype, [1, values.length], values))
  const result = await projectFrames({ method, frames: pages.map((_, index) => index), readFrame: async (index) => blocks[index]! })
  return { dtype: result.dtype, values: Array.from(result.data) as number[] }
}

/**
 * 把内存数据集注册进 host。
 *
 * `EngineHost` 的公开导入入口只接受 File，而带 t 轴的数据集在测试里只能由内存构造；
 * 这里直接写它的数据集注册表，以覆盖「All time frames」这条分支。
 */
function registerDataset(host: EngineHost, imported: ImportResult): void {
  const entries = (host as unknown as {
    entries: Map<string, { dataset: Dataset; storage: Storage; controller: AbortController }>
  }).entries
  entries.set(imported.dataset.id, { dataset: imported.dataset, storage: imported.storage, controller: new AbortController() })
}

/** t=2、z=3、y=1、x=2 的时间序列：每个 t 一叠 z。 */
function timeSeries(): ImportResult {
  return importMemory({
    name: 'time',
    dtype: 'uint8',
    axes: ['t', 'z', 'y', 'x'],
    shape: [2, 3, 1, 2],
    data: Uint8Array.from([1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 60]),
  })
}

/* ---------------- 输出 dtype 规则 ---------------- */

test('projectionDtype 与 ImageJ 一致：Sum/SD 恒为 float32，Median 仅 uint8 保类型', () => {
  assert.equal(projectionDtype('average', 'uint16'), 'uint16')
  assert.equal(projectionDtype('max', 'int16'), 'int16')
  assert.equal(projectionDtype('min', 'uint8'), 'uint8')
  assert.equal(projectionDtype('sum', 'uint8'), 'float32')
  assert.equal(projectionDtype('sd', 'uint16'), 'float32')
  assert.equal(projectionDtype('median', 'uint8'), 'uint8')
  assert.equal(projectionDtype('median', 'uint16'), 'float32')
  assert.equal(projectionDtype('median', 'float32'), 'float32')
})

/* ---------------- 六种方法 ---------------- */

test('projectFrames 六种投影方法的数值与公式', async () => {
  const pages = [[1, 10], [2, 20], [3, 30]]
  assert.deepEqual(await project('uint8', 'average', pages), { dtype: 'uint8', values: [2, 20] })
  assert.deepEqual(await project('uint8', 'sum', pages), { dtype: 'float32', values: [6, 60] })
  assert.deepEqual(await project('uint8', 'max', pages), { dtype: 'uint8', values: [3, 30] })
  assert.deepEqual(await project('uint8', 'min', pages), { dtype: 'uint8', values: [1, 10] })
  // 样本标准差：sqrt(((1-2)²+(2-2)²+(3-2)²)/2) = 1。
  assert.deepEqual(await project('uint8', 'sd', pages), { dtype: 'float32', values: [1, 10] })
  assert.deepEqual(await project('uint8', 'median', pages), { dtype: 'uint8', values: [2, 20] })
})

test('projectFrames 的 median 对偶数页取中间两者平均，并对 uint16 输出 float32', async () => {
  assert.deepEqual(await project('uint8', 'median', [[1], [3]]), { dtype: 'uint8', values: [2] })
  assert.deepEqual(await project('uint16', 'median', [[1], [2], [4], [9]]), { dtype: 'float32', values: [3] })
})

test('projectFrames 跳过 NaN，且单页时标准差为 0', async () => {
  const nan = await project('float32', 'average', [[Number.NaN], [2]])
  assert.deepEqual(nan, { dtype: 'float32', values: [2] })
  const single = await project('uint8', 'sd', [[7]])
  assert.deepEqual(single, { dtype: 'float32', values: [0] })
})

/* ---------------- 引擎通路 ---------------- */

test('EngineHost.project 单组投影输出二维数据集（被投影的轴被移除）', async () => {
  const host = new EngineHost()
  const imported = await host.import(await stackFile(3, (page) => Array.from({ length: 8 }, (_, i) => page * 4 + i + 1)))
  const projected = await host.project({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
    method: 'average',
  })
  assert.ok(projected)
  assert.deepEqual(projected.axes, ['y', 'x'])
  assert.deepEqual([...projected.shape], [2, 4])
  assert.equal(projected.source.name, `AVG_${imported.dataset.source.name}`)

  const read = await host.run({
    datasetId: projected.id,
    recipe: createRecipe(projected.id, projected.revision),
    selection: {},
  })
  assert.ok(read.image)
  assert.deepEqual(Array.from(read.image.data as Uint16Array), [5, 6, 7, 8, 9, 10, 11, 12])
})

test('EngineHost.project 分组投影保留切片轴、长度等于组数', async () => {
  const host = new EngineHost()
  const imported = await host.import(await stackFile(4, (page) => Array.from({ length: 8 }, (_, i) => page + i)))
  const grouped = await host.project({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
    method: 'max',
    groupSize: 2,
  })
  assert.ok(grouped)
  assert.deepEqual(grouped.axes, ['z', 'y', 'x'])
  assert.deepEqual([...grouped.shape], [2, 2, 4])

  const single = await host.project({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
    method: 'max',
    groupSize: 1,
  })
  assert.ok(single)
  // 每组一页 → 4 组，等于逐页恒等投影。
  assert.deepEqual([...single.shape], [4, 2, 4])
})

test('EngineHost.project 夹取越界区间，并在没有多页轴时返回 undefined', async () => {
  const host = new EngineHost()
  const imported = await host.import(await stackFile(3, (page) => Array.from({ length: 8 }, (_, i) => page * 10 + i)))
  const clipped = await host.project({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
    method: 'min',
    from: 1,
    to: 99,
  })
  assert.ok(clipped)
  // 第 2、3 页取最小：逐像素取 page1 与 page2 的较小者。
  const read = await host.run({ datasetId: clipped.id, recipe: createRecipe(clipped.id, clipped.revision), selection: {} })
  assert.deepEqual(Array.from(read.image!.data as Uint16Array), Array.from({ length: 8 }, (_, i) => 10 + i))

  const blob = await encodeTiffStack(toFrames([frame('uint16', [1, 2], [1, 2])]), 1)
  const single = await host.import(new File([blob], 'single.tif'))
  const none = await host.project({
    datasetId: single.dataset.id,
    recipe: createRecipe(single.dataset.id, single.dataset.revision),
    selection: {},
    method: 'average',
  })
  assert.equal(none, undefined)
})

/* ---------------- All time frames ---------------- */

test('EngineHost.project 勾选 All time frames 时对每条时间帧各投影一次', async () => {
  const imported = timeSeries()
  const host = new EngineHost()
  registerDataset(host, imported)
  const projected = await host.project({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
    axis: 'z',
    method: 'average',
    allTimeFrames: true,
  })
  assert.ok(projected)
  // t 轴保留、z 轴被投影掉。
  assert.deepEqual(projected.axes, ['t', 'y', 'x'])
  assert.deepEqual([...projected.shape], [2, 1, 2])
  // 逐条时间帧读回，确认布局没有把两个 t 叠在一起。
  const empty = createRecipe(projected.id, projected.revision)
  const first = await host.run({ datasetId: projected.id, recipe: empty, selection: { t: 0 } })
  const second = await host.run({ datasetId: projected.id, recipe: empty, selection: { t: 1 } })
  assert.deepEqual(Array.from(first.image!.data as Uint8Array), [3, 4])
  assert.deepEqual(Array.from(second.image!.data as Uint8Array), [30, 40])
})

test('EngineHost.project 未勾选 All time frames 时只投影当前时间帧', async () => {
  const imported = timeSeries()
  const host = new EngineHost()
  registerDataset(host, imported)
  const projected = await host.project({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: { t: 1 },
    axis: 'z',
    method: 'average',
  })
  assert.ok(projected)
  assert.deepEqual(projected.axes, ['y', 'x'])
  const read = await host.run({ datasetId: projected.id, recipe: createRecipe(projected.id, projected.revision), selection: {} })
  assert.deepEqual(Array.from(read.image!.data as Uint8Array), [30, 40])
})

test('EngineHost.project 拒绝不能整除页数的组大小', async () => {
  const host = new EngineHost()
  const imported = await host.import(await stackFile(4, (page) => Array.from({ length: 8 }, (_, i) => page + i)))
  await assert.rejects(() => host.project({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
    method: 'average',
    groupSize: 3,
  }), /不能整除/)
})
