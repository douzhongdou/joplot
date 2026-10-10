import test from 'node:test'
import assert from 'node:assert/strict'
import { PageMapStorage } from '../src/imagej/engine/storage-pages.ts'
import { MemoryStorage, fullRegion } from '../src/imagej/engine/storage.ts'
import { EngineHost } from '../src/imagej/engine/worker/host.ts'
import { encodeTiffStack } from '../src/imagej/engine/tiff.ts'
import { createRecipe } from '../src/imagej/engine/recipe.ts'
import { uncalibratedSpatialTransform, type Dtype, type ImageBlock, type PixelArray } from '../src/imagej/engine/types.ts'

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

/** 每页 [page*10+1 … page*10+4] 的三页或四页 uint16 栈。 */
async function stackFile(pages: number): Promise<File> {
  const blocks = Array.from({ length: pages }, (_, page) => frame('uint16', [2, 2], [1, 2, 3, 4].map((value) => page * 10 + value)))
  return new File([await encodeTiffStack(toFrames(blocks), pages)], 'stack.tif')
}

async function readPage(host: EngineHost, datasetId: string, revision: number, page: number): Promise<number[]> {
  const result = await host.run({ datasetId, recipe: createRecipe(datasetId, revision), selection: { z: page } })
  return Array.from(result.image!.data as Uint16Array)
}

async function restructured(pages: number, op: 'reverse' | 'reduce' | 'substack' | 'delete' | 'add', options: Record<string, unknown> = {}) {
  const host = new EngineHost()
  const imported = await host.import(await stackFile(pages))
  const dataset = await host.restructure({
    datasetId: imported.dataset.id,
    op,
    ...options,
  } as never)
  assert.ok(dataset)
  return { host, dataset }
}

/* ---------------- 页映射存储 ---------------- */

test('PageMapStorage 按映射取页，blank 返回全 0', async () => {
  const meta = {
    dtype: 'uint8' as const,
    axes: ['z', 'y', 'x'] as const,
    shape: [3, 1, 2],
    spatialTransform: uncalibratedSpatialTransform(),
    source: { kind: 'memory' as const, name: 'src', format: 'memory' as const, fingerprint: 'src' },
  }
  const source = new MemoryStorage('src', meta, Uint8Array.from([1, 2, 3, 4, 5, 6]))
  const mapped = new PageMapStorage('map', { ...meta, shape: [3, 1, 2] }, source, [2, 'blank', 0], 0)
  const page0 = await mapped.readRegion(fullRegion([1, 1, 2]))
  assert.deepEqual(Array.from(page0.data as Uint8Array), [5, 6])
  // blank 页整体填 0。
  const page1 = await mapped.readRegion({ start: [1, 0, 0], shape: [1, 1, 2] })
  assert.deepEqual(Array.from(page1.data as Uint8Array), [0, 0])
  const page2 = await mapped.readRegion({ start: [2, 0, 0], shape: [1, 1, 2] })
  assert.deepEqual(Array.from(page2.data as Uint8Array), [1, 2])
})

/* ---------------- 结构编辑 ---------------- */

test('Reverse 反转页顺序', async () => {
  const { host, dataset } = await restructured(3, 'reverse')
  assert.deepEqual([...dataset.shape], [3, 2, 2])
  assert.deepEqual(await readPage(host, dataset.id, dataset.revision, 0), [21, 22, 23, 24])
  assert.deepEqual(await readPage(host, dataset.id, dataset.revision, 2), [1, 2, 3, 4])
})

test('Reduce 从第 1 页起按步长抽取', async () => {
  const { host, dataset } = await restructured(4, 'reduce', { factor: 2 })
  assert.deepEqual([...dataset.shape], [2, 2, 2])
  assert.deepEqual(await readPage(host, dataset.id, dataset.revision, 0), [1, 2, 3, 4])
  assert.deepEqual(await readPage(host, dataset.id, dataset.revision, 1), [21, 22, 23, 24])
})

test('Make Substack 按给定页列表取子栈，保持给定顺序', async () => {
  const { host, dataset } = await restructured(4, 'substack', { pages: [2, 0] })
  assert.deepEqual([...dataset.shape], [2, 2, 2])
  assert.deepEqual(await readPage(host, dataset.id, dataset.revision, 0), [21, 22, 23, 24])
  assert.deepEqual(await readPage(host, dataset.id, dataset.revision, 1), [1, 2, 3, 4])
})

test('Delete Slice 移除指定页并拒绝删空', async () => {
  const { host, dataset } = await restructured(3, 'delete', { pages: [1] })
  assert.deepEqual([...dataset.shape], [2, 2, 2])
  assert.deepEqual(await readPage(host, dataset.id, dataset.revision, 1), [21, 22, 23, 24])

  const engine = new EngineHost()
  const imported = await engine.import(await stackFile(3))
  await assert.rejects(() => engine.restructure({
    datasetId: imported.dataset.id,
    op: 'delete',
    pages: [0, 1, 2],
  }), /不能删除全部切片/)
})

test('Add Slice 在指定位置插入空白页', async () => {
  const { host, dataset } = await restructured(3, 'add', { at: 1, count: 2 })
  assert.deepEqual([...dataset.shape], [5, 2, 2])
  assert.deepEqual(await readPage(host, dataset.id, dataset.revision, 0), [1, 2, 3, 4])
  // 插入的两页是全 0 的空白页。
  assert.deepEqual(await readPage(host, dataset.id, dataset.revision, 1), [0, 0, 0, 0])
  assert.deepEqual(await readPage(host, dataset.id, dataset.revision, 2), [0, 0, 0, 0])
  assert.deepEqual(await readPage(host, dataset.id, dataset.revision, 3), [11, 12, 13, 14])
})

test('结构编辑在无切片轴时返回 undefined', async () => {
  const host = new EngineHost()
  const blob = await encodeTiffStack(toFrames([frame('uint16', [2, 2], [1, 2, 3, 4])]), 1)
  const single = await host.import(new File([blob], 'single.tif'))
  assert.equal(await host.restructure({ datasetId: single.dataset.id, op: 'reverse' }), undefined)
})
