import test from 'node:test'
import assert from 'node:assert/strict'
import { ImageRuntime } from '../src/imagej/engine/runtime.ts'
import { importMemory } from '../src/imagej/engine/importer.ts'
import { PureComputeEngine } from '../src/imagej/engine/compute/engine.ts'
import type { EngineClient, EngineResult } from '../src/imagej/engine/worker/client.ts'

/**
 * 整卷预热（`scheduleWarmup` / `scheduleWarmupSoon`）的回归。
 *
 * 这条路径此前没有任何测试覆盖：其它 runtime 测试一律 `prefetch: false`，
 * 于是「翻页把预热取消掉、且再也排不回来」这个缺陷一直没被发现。
 * 这里每页故意慢 10ms，让预热在观察窗口内仍在进行，才测得到「打断」。
 */
const PAGES = 40
const PAGE_MS = 10
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function makeRuntime(): ImageRuntime {
  const imported = importMemory({
    name: 'stack',
    dtype: 'uint8',
    axes: ['z', 'y', 'x'],
    shape: [PAGES, 1, 2],
    data: new Uint8Array(PAGES * 2),
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
      await delay(PAGE_MS)
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
  // prefetch 用默认值 true：这里测的就是预热/预取本身。
  return new ImageRuntime({ client, cacheBytes: 1024 * 1024 })
}

test('翻页不取消整卷预热，预热最终跑完整卷', async () => {
  const runtime = makeRuntime()
  await runtime.openFile(new File([], 'stack.tif'))
  // 首次铺开有 400ms 防抖（拖参数滑杆时不要反复重排）。
  await delay(500)
  const started = runtime.getState().preload
  assert.ok(started, '打开后整卷预热已经开始')
  assert.ok(started.done < started.total, '预热还没跑完，否则测不到打断')

  runtime.setSelection({ z: 1 })
  await delay(80)
  const during = runtime.getState().preload
  assert.ok(during, '翻页不应清空预热进度（旧实现会在这里 cancel 掉整卷任务）')
  assert.ok(during.done >= started.done, '预热进度不能倒退')

  await delay(1000)
  assert.equal(runtime.getState().preload, undefined, '预热应当跑完而不是停在翻页那一刻')
  assert.equal(runtime.getState().cache.entries, PAGES, '整卷每一页都进了缓存，翻页才有得命中')
})

test('改 Recipe 才会重排预热（版本变了要丢掉旧结果）', async () => {
  const runtime = makeRuntime()
  await runtime.openFile(new File([], 'stack.tif'))
  await delay(500)
  assert.ok(runtime.getState().preload, '预热已开始')

  // 加一个步骤会换 recipe 版本：旧预热结果作废，进度先收起、再按新版本重排。
  runtime.addStep('invert')
  await delay(60)
  assert.equal(runtime.getState().preload, undefined, '版本变化时旧预热被撤掉')

  // 防抖窗口过后重新铺开，并且仍然跑到完。
  await delay(1600)
  assert.equal(runtime.getState().preload, undefined, '重排后的预热也已跑完')
  // 新旧两个 recipe 版本各自留了一份缓存，所以是「至少整卷页数」。
  assert.ok(runtime.getState().cache.entries >= PAGES, '新版本也把整卷预热了')
})
