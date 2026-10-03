import test from 'node:test'
import assert from 'node:assert/strict'
import { importFile, type ImportResult } from '../src/imagej/engine/importer.ts'
import { TiffStackStorage } from '../src/imagej/engine/storage-tiff.ts'
import { TiffPageSource } from '../src/imagej/engine/tiff/source.ts'
import { buildTiffIndex } from '../src/imagej/engine/tiff/indexer.ts'
import { encodeTiffStack } from '../src/imagej/engine/tiff.ts'
import { PureComputeEngine } from '../src/imagej/engine/compute/engine.ts'
import { ImageRuntime } from '../src/imagej/engine/runtime.ts'
import type { EngineClient, EngineResult } from '../src/imagej/engine/worker/client.ts'
import type { ImageBlock } from '../src/imagej/engine/types.ts'
import { buildTiffBytes, uint16Pixels } from './helpers/tiffBuilder.ts'

async function* toFrames(blocks: ImageBlock[]) {
  for (const block of blocks) yield block
}

function gray(values: readonly number[], width: number, height: number): ImageBlock {
  return {
    dtype: 'uint16',
    axes: ['y', 'x'],
    shape: [height, width],
    region: { start: [0, 0], shape: [height, width] },
    data: new Uint16Array(values),
  }
}

/** 真实链路用的 client：import 走 importFile，run 走纯 TS 引擎。 */
function fileClient(): EngineClient {
  const engine = new PureComputeEngine()
  let imported: ImportResult | null = null
  return {
    kind: 'inline',
    async import(file: File) {
      imported = await importFile(file)
      return imported.dataset
    },
    async importStack() { throw new Error('测试客户端不支持 importStack') },
    async run(options): Promise<EngineResult> {
      const source = imported!
      const outcome = await engine.runRecipe(
        { dataset: source.dataset, storage: source.storage, selection: options.selection },
        options.recipe,
        options.throughStepId,
      )
      return {
        results: outcome.results.map(({ stepId, status, error, stats, table, ms }) =>
          ({ stepId, status, error, stats, table, ms })),
        image: outcome.image,
        stats: [...outcome.results].reverse().find((r) => r.stats)?.stats,
        table: [...outcome.results].reverse().find((r) => r.table)?.table,
        ms: outcome.ms,
        estimatedBytes: outcome.estimatedBytes,
      }
    },
    cancel() {},
    dispose() {},
    terminate() {},
  }
}

async function stackFile(pages: number, values: (page: number) => number[]): Promise<File> {
  const blocks = Array.from({ length: pages }, (_, page) => gray(values(page), 4, 2))
  const blob = await encodeTiffStack(toFrames(blocks), pages)
  return new File([blob], 'stack.tif')
}

test('多页 TIFF 导入为惰性页栈', async () => {
  const file = await stackFile(3, (page) => [page * 10 + 1, page * 10 + 2, page * 10 + 3, page * 10 + 4, page * 10 + 5, page * 10 + 6, page * 10 + 7, page * 10 + 8])
  const { dataset, storage, warnings } = await importFile(file)

  assert.deepEqual(dataset.axes, ['z', 'y', 'x'])
  assert.deepEqual(dataset.shape, [3, 2, 4])
  assert.equal(dataset.dtype, 'uint16')
  assert.equal(dataset.componentKind, 'scalar')
  assert.equal(storage.capabilities().pageRead, true)
  assert.ok(storage instanceof TiffStackStorage)
  assert.match(warnings.join('\n'), /3 页/)
})

test('按页读取得到各自像素，且互不干扰', async () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8]
  const file = await stackFile(3, (page) => values.map((v) => v + page * 100))
  const { storage } = await importFile(file)

  for (const page of [0, 2, 1]) {
    const block = await storage.readRegion({ start: [page, 0, 0], shape: [1, 2, 4] })
    assert.deepEqual([...block.data], values.map((v) => v + page * 100), `第 ${page} 页`)
  }
})

test('返回块的 axes 与 region 与 dataset 对齐', async () => {
  const file = await stackFile(2, (page) => Array.from({ length: 8 }, (_, i) => page + i))
  const { dataset, storage } = await importFile(file)

  const block = await storage.readRegion({ start: [1, 0, 0], shape: [1, 2, 4] })
  assert.deepEqual(block.axes, dataset.axes, 'axes 必须与 dataset 一致，否则下游 region.start 会错位')
  assert.equal(block.region.start.length, dataset.axes.length)
  assert.equal(block.region.shape.length, dataset.axes.length)
  assert.deepEqual(block.shape, [1, 2, 4])
  assert.deepEqual(block.region, { start: [1, 0, 0], shape: [1, 2, 4] })
})

test('空间子区域读取在读出后裁剪', async () => {
  // 4 列 × 2 行：行 0 为 1..4，行 1 为 5..8。
  const values = [1, 2, 3, 4, 5, 6, 7, 8]
  const file = await stackFile(2, () => values)
  const { storage } = await importFile(file)

  // 取 z=0、第 1 行（y=1）、后 2 列（x=2 起，宽 2）=> 值 7、8。
  const block = await storage.readRegion({ start: [0, 1, 2], shape: [1, 1, 2] })
  assert.deepEqual([...block.data], [7, 8])
  assert.deepEqual(block.shape, [1, 1, 2])
  assert.deepEqual(block.region, { start: [0, 1, 2], shape: [1, 1, 2] })

  // 只取整行也应对齐。
  const row = await storage.readRegion({ start: [0, 1, 0], shape: [1, 1, 4] })
  assert.deepEqual([...row.data], [5, 6, 7, 8])
})

test('RGB 多页 TIFF 映射为 c/z/y/x 四轴', async () => {
  // 每页以 c 通道的标记值区分：c 轴按平面分离存放。
  const pages: ImageBlock[] = [0, 1].map((page) => ({
    dtype: 'uint8',
    axes: ['c', 'y', 'x'],
    shape: [3, 2, 2],
    region: { start: [0, 0, 0], shape: [3, 2, 2] },
    data: Uint8Array.from([
      page * 10, page * 10, page * 10, page * 10,
      1, 1, 1, 1,
      2, 2, 2, 2,
    ]),
  }))
  const blob = await encodeTiffStack(toFrames(pages), pages.length)
  const { dataset, storage } = await importFile(new File([blob], 'rgb.tif'))

  assert.deepEqual(dataset.axes, ['c', 'z', 'y', 'x'])
  assert.deepEqual(dataset.shape, [3, 2, 2, 2])
  assert.equal(dataset.componentKind, 'rgb')

  const block = await storage.readRegion({ start: [0, 1, 0, 0], shape: [3, 1, 2, 2] })
  assert.deepEqual(block.axes, ['c', 'z', 'y', 'x'])
  assert.deepEqual(block.shape, [3, 1, 2, 2])
  // 平面分离：通道 0 是第 1 页的标记值，随后依次是通道 1、2。
  assert.deepEqual([...(block.data as Uint8Array)], [10, 10, 10, 10, 1, 1, 1, 1, 2, 2, 2, 2])
})

test('单页 TIFF 不产生可翻页的轴', async () => {
  const file = await stackFile(1, () => [1, 2, 3, 4, 5, 6, 7, 8])
  const { dataset, storage, warnings } = await importFile(file)

  assert.deepEqual(dataset.axes, ['y', 'x'])
  assert.deepEqual(dataset.shape, [2, 4])
  assert.equal(storage.capabilities().pageRead, true)
  assert.match(warnings.join('\n'), /只有 1 页/)
  const block = await storage.readRegion({ start: [0, 0], shape: [2, 4] })
  assert.deepEqual([...block.data], [1, 2, 3, 4, 5, 6, 7, 8])
})

test('每次只读取一页所需的字节，不触碰其他页', async () => {
  // 用可观测的 reader 直接构造 storage，断言读第 N 页不会读第 M 页的字节。
  const { bytes, pixelStart } = buildTiffBytes([
    { width: 4, height: 2, bits: 16, pixels: uint16Pixels([1, 2, 3, 4, 5, 6, 7, 8]) },
    { width: 4, height: 2, bits: 16, pixels: uint16Pixels([11, 12, 13, 14, 15, 16, 17, 18]) },
  ])
  const reads: Array<[number, number]> = []
  const read = async (offset: number, length: number): Promise<Uint8Array> => {
    reads.push([offset, offset + length])
    return bytes.slice(offset, offset + length)
  }
  const index = await buildTiffIndex(read, bytes.length)
  const source = TiffPageSource.fromIndex({ read, index })

  const page1Bytes = index.pages[1]!.segments[0]!
  reads.length = 0
  const storage = new TiffStackStorage(
    'spy',
    {
      dtype: 'uint16',
      axes: ['z', 'y', 'x'],
      shape: [2, 2, 4],
      source: { kind: 'file', name: 'spy.tif', format: 'tiff', fingerprint: 'spy' },
    },
    source,
  )
  await storage.readRegion({ start: [1, 0, 0], shape: [1, 2, 4] })

  assert.equal(reads.length, 1, `读一页应只发一次读取，实际 ${JSON.stringify(reads)}`)
  assert.deepEqual(reads[0], [page1Bytes.offset, page1Bytes.offset + page1Bytes.byteLength])
  assert.ok(reads[0]![0] > pixelStart)
})

test('切片轴长度不为 1 时明确拒绝', async () => {
  const file = await stackFile(3, () => [1, 2, 3, 4, 5, 6, 7, 8])
  const { storage } = await importFile(file)
  await assert.rejects(
    () => storage.readRegion({ start: [0, 0, 0], shape: [2, 2, 4] }),
    /每次只能读取一页/,
  )
})

test('压缩 TIFF 不被惰性路径接管，交回既有解码链路', async () => {
  const { bytes } = buildTiffBytes([{ width: 2, height: 2, bits: 16, compression: 5 }])
  const file = new File([bytes], 'lzw.tif')
  // decoder 返回 null 表示 ITK 不可用，内置解码器同样拒绝压缩格式。
  await assert.rejects(() => importFile(file, async () => null), /压缩/)
})

test('可读性在导入期即被判定，不可读的文件不会静默变成空栈', async () => {
  const { bytes } = buildTiffBytes([{ width: 2, height: 2, bits: 16, compression: 1 }])
  const file = new File([bytes], 'plain.tif')
  const { storage } = await importFile(file, async () => null)
  assert.equal(storage.capabilities().pageRead, true)
})

test('运行时翻页得到不同像素，且缓存命中不再读文件', async () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8]
  const file = await stackFile(3, (page) => values.map((v) => v + page * 100))
  const runtime = new ImageRuntime({ client: fileClient(), prefetch: false, cacheBytes: 4 * 1024 * 1024 })

  await runtime.openFile(file)
  assert.equal(runtime.getState().status, 'ready')
  assert.deepEqual([...(runtime.getState().image!.data as Uint16Array)], values)

  runtime.setSelection({ z: 2 })
  await runtime.run()
  assert.deepEqual([...(runtime.getState().image!.data as Uint16Array)], values.map((v) => v + 200))

  // 翻回已访问过的页应命中缓存。
  const hitsBefore = runtime.getState().cache.hits
  runtime.setSelection({ z: 0 })
  await runtime.run()
  assert.deepEqual([...(runtime.getState().image!.data as Uint16Array)], values)
  assert.ok(runtime.getState().cache.hits > hitsBefore)
  runtime.dispose()
})

test('运行时对栈整体导出时逐页读取', async () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8]
  const file = await stackFile(3, (page) => values.map((v) => v + page * 1000))
  const runtime = new ImageRuntime({ client: fileClient(), prefetch: false, cacheBytes: 4 * 1024 * 1024 })
  await runtime.openFile(file)

  const frames: number[][] = []
  for await (const frame of runtime.exportFrames()) frames.push([...(frame.data as Uint16Array)])
  assert.equal(frames.length, 3)
  assert.deepEqual(frames[0], values)
  assert.deepEqual(frames[2], values.map((v) => v + 2000))
  runtime.dispose()
})

test('释放后拒绝继续读取', async () => {
  const file = await stackFile(2, () => [1, 2, 3, 4, 5, 6, 7, 8])
  const { storage } = await importFile(file)
  storage.release()
  await assert.rejects(() => storage.readRegion({ start: [0, 0, 0], shape: [1, 2, 4] }), /已释放/)
})

test('切片切换期间图像被标记为过期，避免新页码配旧像素', async () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8]
  const file = await stackFile(3, (page) => values.map((v) => v + page * 100))
  const runtime = new ImageRuntime({ client: fileClient(), prefetch: false, cacheBytes: 4 * 1024 * 1024 })
  await runtime.openFile(file)

  assert.equal(runtime.getState().imageStale, false, '导入完成时图像不应过期')

  // setSelection 先改 selection、再异步产出 image，因此此刻图像已与选择失配。
  runtime.setSelection({ z: 1 })
  assert.equal(runtime.getState().imageStale, true)
  // 失配期间画面仍是上一帧，正是 UI 必须区别对待的状态。
  assert.deepEqual([...(runtime.getState().image!.data as Uint16Array)], values)

  await runtime.run()
  assert.equal(runtime.getState().imageStale, false)
  assert.deepEqual([...(runtime.getState().image!.data as Uint16Array)], values.map((v) => v + 100))
  runtime.dispose()
})

test('重复设置同一页不会把画面标记为过期', async () => {
  const file = await stackFile(3, (page) => Array.from({ length: 8 }, (_, i) => page * 100 + i))
  const runtime = new ImageRuntime({ client: fileClient(), prefetch: false, cacheBytes: 4 * 1024 * 1024 })
  await runtime.openFile(file)
  await runtime.run()

  runtime.setSelection({ z: 0 })
  assert.equal(runtime.getState().imageStale, false, '切到当前已在显示的页不产生过期态')
  runtime.dispose()
})

test('命中缓存的翻页不产生过期态', async () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8]
  const file = await stackFile(3, (page) => values.map((v) => v + page * 100))
  const runtime = new ImageRuntime({ client: fileClient(), prefetch: false, cacheBytes: 4 * 1024 * 1024 })
  await runtime.openFile(file)
  runtime.setSelection({ z: 1 }); await runtime.run()
  runtime.setSelection({ z: 0 }); await runtime.run()

  // 该页已在缓存中：run 在同步块内即命中并推送图像，因此不存在「新页码配旧像素」的中间态。
  runtime.setSelection({ z: 1 })
  assert.equal(runtime.getState().imageStale, false)
  assert.deepEqual([...(runtime.getState().image!.data as Uint16Array)], values.map((v) => v + 100))
  assert.ok(runtime.getState().cache.hits > 0)
  runtime.dispose()
})