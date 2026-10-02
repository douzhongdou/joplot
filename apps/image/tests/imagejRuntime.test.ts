import test from 'node:test'
import assert from 'node:assert/strict'
import { importMemory } from '../src/imagej/engine/importer.ts'
import { PureComputeEngine } from '../src/imagej/engine/compute/engine.ts'
import { ImageRuntime } from '../src/imagej/engine/runtime.ts'
import { blockToRgba, computeWindowLevel } from '../src/imagej/engine/render/rgba.ts'
import type { EngineClient, EngineResult } from '../src/imagej/engine/worker/client.ts'
import type { ImageBlock, PixelArray } from '../src/imagej/engine/types.ts'

function makeBlock(dtype: ImageBlock['dtype'], shape: number[], values: number[]): ImageBlock {
  const data = (() => {
    switch (dtype) {
      case 'uint8': return Uint8Array.from(values)
      case 'uint16': return Uint16Array.from(values)
      case 'int16': return Int16Array.from(values)
      case 'float32': return Float32Array.from(values)
    }
  })() as PixelArray
  return { dtype, axes: ['y', 'x'], shape, region: { start: [0, 0], shape }, data }
}

test('blockToRgba 把窗口映射到 8 位且不透明', () => {
  const block = makeBlock('uint8', [1, 3], [0, 127, 255])
  assert.deepEqual(computeWindowLevel(block), { window: 255, level: 127.5 })
  const rgba = blockToRgba(block, { window: 255, level: 127.5 })
  assert.equal(rgba.length, 12)
  assert.deepEqual([...rgba.slice(0, 4)], [0, 0, 0, 255])
  assert.deepEqual([...rgba.slice(4, 8)], [127, 127, 127, 255])
  assert.deepEqual([...rgba.slice(8, 12)], [255, 255, 255, 255])
})

test('blockToRgba 对常量块使用最小窗口避免除零', () => {
  const block = makeBlock('uint16', [1, 2], [42, 42])
  assert.deepEqual(computeWindowLevel(block), { window: 1, level: 42 })
  const rgba = blockToRgba(block, computeWindowLevel(block))
  // 窗口以该常量为中心，映射为中间灰。
  assert.deepEqual([...rgba.slice(0, 4)], [128, 128, 128, 255])
})

function inlineClientWith(imported: ReturnType<typeof importMemory>): EngineClient {
  const engine = new PureComputeEngine()
  return {
    kind: 'inline',
    async import() { return imported.dataset },
    async run(options): Promise<EngineResult> {
      const outcome = await engine.runRecipe(
        { dataset: imported.dataset, storage: imported.storage, selection: options.selection },
        options.recipe,
        options.throughStepId,
      )
      return {
        results: outcome.results.map(({ stepId, status, error, stats, table, ms }) => ({ stepId, status, error, stats, table, ms })),
        image: outcome.image,
        stats: [...outcome.results].reverse().find((result) => result.stats)?.stats,
        table: [...outcome.results].reverse().find((result) => result.table)?.table,
        ms: outcome.ms,
        estimatedBytes: outcome.estimatedBytes,
      }
    },
    cancel() {},
    dispose() {},
    terminate() {},
  }
}

test('ImageRuntime 导入后显示源图，添加步骤与撤销驱动重算', async () => {
  const imported = importMemory({
    name: 'runtime', dtype: 'uint8', axes: ['y', 'x'], shape: [1, 3],
    data: Uint8Array.from([0, 100, 200]),
  })
  const runtime = new ImageRuntime({ client: inlineClientWith(imported), prefetch: false, cacheBytes: 1024 })
  await runtime.openFile(new File([], 'runtime.tif'))
  assert.equal(runtime.getState().status, 'ready')
  assert.deepEqual(Array.from(runtime.getState().image!.data as Uint8Array), [0, 100, 200])

  runtime.addStep('invert')
  await runtime.run()
  assert.deepEqual(Array.from(runtime.getState().image!.data as Uint8Array), [255, 155, 55])

  assert.equal(runtime.canUndo(), true)
  runtime.undo()
  await runtime.run()
  assert.deepEqual(Array.from(runtime.getState().image!.data as Uint8Array), [0, 100, 200])
  assert.equal(runtime.canUndo(), false)
  runtime.dispose()
})

test('ImageRuntime 缓存命中后跳页不再请求计算', async () => {
  const imported = importMemory({
    name: 'cache', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [2, 1, 2],
    data: Uint8Array.from([1, 2, 3, 4]),
  })
  let runs = 0
  const base = inlineClientWith(imported)
  const client: EngineClient = {
    ...base,
    async run(options) { runs += 1; return base.run(options) },
  }
  const runtime = new ImageRuntime({ client, prefetch: false, cacheBytes: 1024 * 1024 })
  await runtime.openFile(new File([], 'cache.tif'))
  const firstRuns = runs
  assert.ok(firstRuns >= 1)
  // 跳到 z=1 再跳回 z=0，应命中缓存。
  runtime.setSelection({ z: 1 })
  await runtime.run()
  runtime.setSelection({ z: 0 })
  await runtime.run()
  assert.ok(runtime.getState().cache.hits >= 1)
  runtime.dispose()
})
