import test from 'node:test'
import assert from 'node:assert/strict'
import { ImageRuntime } from '../src/imagej/engine/runtime.ts'
import { importMemory } from '../src/imagej/engine/importer.ts'
import { PureComputeEngine } from '../src/imagej/engine/compute/engine.ts'
import type { EngineClient, EngineResult } from '../src/imagej/engine/worker/client.ts'

/** 4×4 的 RGGB 图案，三帧内容相同；debayer 只要求单通道，像素值本身不参与判定。 */
const FRAME = Uint8Array.from([
  200, 40, 200, 40,
  40, 120, 40, 120,
  200, 40, 200, 40,
  40, 120, 40, 120,
])

function makeRuntime(): ImageRuntime {
  const data = new Uint8Array(FRAME.length * 3)
  for (let z = 0; z < 3; z += 1) data.set(FRAME, z * FRAME.length)
  const imported = importMemory({ name: 'cfa', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [3, 4, 4], data })
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
  return new ImageRuntime({ client, prefetch: false, cacheBytes: 1024 * 1024 })
}

test('debayer 的整栈作用域在每一帧都生效', async () => {
  const runtime = makeRuntime()
  await runtime.openFile(new File([], 'cfa.tif'))
  runtime.addStep('debayer', { pattern: 'rggb', algorithm: 'bilinear' }, { kind: 'stack' })
  for (const z of [0, 1, 2]) {
    runtime.setSelection({ z })
    await runtime.run()
    const state = runtime.getState()
    assert.equal(state.status, 'ready', `第 ${z} 帧不应失败：${state.error ?? ''}`)
    const image = state.image!
    assert.ok(image.axes.includes('c'), `第 ${z} 帧应已 debayer 成 RGB`)
    assert.equal(image.shape[image.axes.indexOf('c')], 3)
  }
  runtime.dispose()
})

test('整栈 debayer 会替换掉旧的逐帧 debayer，各帧行为一致', async () => {
  const runtime = makeRuntime()
  await runtime.openFile(new File([], 'cfa.tif'))
  // 旧行为遗留：当初只能「当前切片」，所以逐帧点出来的 debayer 各带自己的 selection。
  runtime.addStep('debayer', { pattern: 'rggb', algorithm: 'bilinear' }, { kind: 'frame', selection: { z: 0 } })
  // 新行为：想一次性覆盖整栈 —— 必须替换而不是叠加，否则第 0 帧会二次 debayer 而报错。
  runtime.replaceStep('debayer', { pattern: 'rggb', algorithm: 'bilinear' }, { kind: 'stack' })
  assert.equal(runtime.getState().recipe!.steps.filter((step) => step.op === 'debayer').length, 1, '链上只应剩一步 debayer')
  const statuses: string[] = []
  for (const z of [0, 1, 2]) {
    runtime.setSelection({ z })
    await runtime.run()
    const state = runtime.getState()
    statuses.push(`${z}:${state.status}${state.error ? `(${state.error})` : ''}`)
  }
  runtime.dispose()
  assert.deepEqual(
    statuses.map((entry) => entry.split(':')[1]!.split('(')[0]),
    ['ready', 'ready', 'ready'],
    `各帧应当一致，实际 ${statuses.join(' ')}`,
  )
})
