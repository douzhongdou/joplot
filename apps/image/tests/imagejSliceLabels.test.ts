import test from 'node:test'
import assert from 'node:assert/strict'
import { ImageRuntime } from '../src/imagej/engine/runtime.ts'
import { importMemory } from '../src/imagej/engine/importer.ts'
import { PureComputeEngine } from '../src/imagej/engine/compute/engine.ts'
import type { EngineClient, EngineResult } from '../src/imagej/engine/worker/client.ts'

/** 三页 1×2 的内存栈；client 只实现 import / run，其余命令返回空。 */
function makeRuntime(): ImageRuntime {
  const imported = importMemory({
    name: 'stack',
    dtype: 'uint8',
    axes: ['z', 'y', 'x'],
    shape: [3, 1, 2],
    data: Uint8Array.from([1, 2, 3, 4, 5, 6]),
  })
  const engine = new PureComputeEngine()
  const client: EngineClient = {
    kind: 'inline',
    async import() { return imported.dataset },
    async importStack() { return imported.dataset },
    async analyze() { return undefined },
    async stackStats() { return undefined },
    async stackProfiles() { return undefined },
    async project() { return undefined },
    async montage() { return undefined },
    async montageToStack() { return undefined },
    async reslice() { return undefined },
    async orthogonal() { return [] },
    async restructure() { return undefined },
    async combine() { return undefined },
    async label() { return undefined },
    async project3d() { return undefined },
    async remontage() { return undefined },
    async run(options): Promise<EngineResult> {
      const outcome = await engine.runRecipe(
        { dataset: imported.dataset, storage: imported.storage, selection: options.selection },
        options.recipe,
        options.throughStepId,
      )
      return {
        results: outcome.results.map(({ stepId, status, error, stats, table, ms }) => ({ stepId, status, error, stats, table, ms })),
        image: outcome.image,
        ms: outcome.ms,
        estimatedBytes: outcome.estimatedBytes,
      }
    },
    cancel() {},
    dispose() {},
    terminate() {},
  }
  return new ImageRuntime({ client, prefetch: false })
}

test('setSliceLabel 写入指定页，并把数组补齐到页数', async () => {
  const runtime = makeRuntime()
  await runtime.openFile(new File([], 'stack.tif'))
  runtime.setSliceLabel(1, 'middle')
  assert.equal(runtime.sliceLabel(1), 'middle')
  assert.equal(runtime.sliceLabel(0), '')
  // 数组长度补齐到整卷页数，便于导出时按页写标签。
  assert.equal(runtime.getState().sliceLabels?.length, 3)
  runtime.setSliceLabel(2, 'last')
  assert.deepEqual(runtime.getState().sliceLabels, ['', 'middle', 'last'])
})

test('setSliceLabel 忽略越界与非法下标', async () => {
  const runtime = makeRuntime()
  await runtime.openFile(new File([], 'stack.tif'))
  runtime.setSliceLabel(5, 'oops')
  runtime.setSliceLabel(-1, 'oops')
  runtime.setSliceLabel(1.5, 'oops')
  assert.deepEqual(runtime.getState().sliceLabels?.[1] ?? '', '')
})

test('clearSliceLabels 清空全部标签', async () => {
  const runtime = makeRuntime()
  await runtime.openFile(new File([], 'stack.tif'))
  runtime.setSliceLabel(0, 'first')
  assert.equal(runtime.sliceLabel(0), 'first')
  runtime.clearSliceLabels()
  assert.equal(runtime.getState().sliceLabels, undefined)
  assert.equal(runtime.sliceLabel(0), '')
})

test('改标签不改变数据集版本，因此不会让像素缓存失效', async () => {
  const runtime = makeRuntime()
  await runtime.openFile(new File([], 'stack.tif'))
  const before = runtime.getState().dataset
  const missesBefore = runtime.getState().cache.misses
  runtime.setSliceLabel(0, 'first')
  const after = runtime.getState().dataset
  assert.equal(after?.revision, before?.revision)
  assert.equal(after?.id, before?.id)
  // 标签不触发重算：缓存未命中计数不变。
  assert.equal(runtime.getState().cache.misses, missesBefore)
})

test('重新打开数据集会清空标签', async () => {
  const runtime = makeRuntime()
  await runtime.openFile(new File([], 'stack.tif'))
  runtime.setSliceLabel(0, 'first')
  await runtime.openFile(new File([], 'stack.tif'))
  assert.equal(runtime.getState().sliceLabels, undefined)
})
