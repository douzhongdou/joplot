import test from 'node:test'
import assert from 'node:assert/strict'
import { importMemory } from '../src/imagej/engine/importer.ts'
import { PureComputeEngine } from '../src/imagej/engine/compute/engine.ts'
import { ImageRuntime } from '../src/imagej/engine/runtime.ts'
import { blockToRgba, computeWindowLevel } from '../src/imagej/engine/render/rgba.ts'
import type { EngineClient, EngineResult } from '../src/imagej/engine/worker/client.ts'
import type { ImageBlock, PixelArray } from '../src/imagej/engine/types.ts'
import { ByteCache } from '../src/imagej/engine/scheduler/cache.ts'
import { analyzeBlock } from '../src/imagej/engine/analysis.ts'

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
    async importStack() { return imported.dataset },
    async analyze() { return undefined },
    async stackStats() { return undefined },
    async stackProfiles() { return undefined },
    async restructure() { return undefined },
    async combine() { return undefined },
    async label() { return undefined },
    async project3d() { return undefined },
    async remontage() { return undefined },
    async project() { return undefined },
    async montage() { return undefined },
    async montageToStack() { return undefined },
    async reslice() { return undefined },
    async orthogonal() { return [] },
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

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

test('请求合并期间选择同步失效旧帧，不出现新 selection 配旧图的 ready 状态', async () => {
  const imported = importMemory({ name: 'race', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [3, 1, 2], data: Uint8Array.from([10, 20, 30, 40, 50, 60]) })
  const base = inlineClientWith(imported)
  const started = deferred(), release = deferred()
  const client: EngineClient = { ...base, async run(options) {
    const result = await base.run(options)
    if (options.selection.z === 1) { started.resolve(); await release.promise }
    return result
  } }
  const runtime = new ImageRuntime({ client, prefetch: false })
  await runtime.openFile(new File([], 'race.tif'))
  const mismatches: number[] = []
  runtime.subscribe((state) => {
    if (state.selection.z === 2 && !state.imageStale && state.status === 'ready' && state.image?.data[0] !== 50) mismatches.push(state.image?.data[0] ?? -1)
  })
  runtime.setSelection({ z: 1 })
  await started.promise
  runtime.setSelection({ z: 2 })
  release.resolve()
  await runtime.run()
  assert.deepEqual(mismatches, [])
  assert.deepEqual([...runtime.getState().image!.data], [50, 60])
  runtime.dispose()
})

test('合并期间 Recipe 变更同步失效在途结果，restructure 传递当前 Recipe 和预览位置', async () => {
  const imported = importMemory({ name: 'recipe-race', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [2, 1, 2], data: Uint8Array.from([10, 20, 30, 40]) })
  const base = inlineClientWith(imported)
  const started = deferred(), release = deferred()
  let captured: Parameters<EngineClient['restructure']>[0] | undefined
  const client: EngineClient = { ...base, async run(options) {
    const result = await base.run(options)
    if (options.selection.z === 1 && options.recipe.steps.length === 0) { started.resolve(); await release.promise }
    return result
  }, async restructure(options) { captured = options; return undefined } }
  const runtime = new ImageRuntime({ client, prefetch: false })
  await runtime.openFile(new File([], 'race.tif'))
  const mismatches: number[] = []
  runtime.subscribe((state) => {
    if (state.recipe?.steps.length && !state.imageStale && state.status === 'ready' && state.image?.data[0] !== 225) mismatches.push(state.image?.data[0] ?? -1)
  })
  runtime.setSelection({ z: 1 })
  await started.promise
  const stepId = runtime.addStep('invert', {}, { kind: 'stack' })
  release.resolve()
  await runtime.run()
  assert.deepEqual(mismatches, [])
  assert.deepEqual([...runtime.getState().image!.data], [225, 215])
  await runtime.restructureStack({ op: 'reverse' })
  assert.equal(captured?.recipe?.steps[0]?.id, stepId)
  assert.equal(captured?.throughStepId, stepId)
  runtime.dispose()
})

test('合并期间旧 analysis 不能写回当前选择', async () => {
  const imported = importMemory({ name: 'analysis-race', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [3, 1, 2], data: Uint8Array.from([10, 20, 30, 40, 50, 60]) })
  const base = inlineClientWith(imported), cache = new ByteCache<EngineResult>(100)
  const analysisStarted = deferred(), releaseAnalysis = deferred(), analysisFinished = deferred()
  const runStarted = deferred(), releaseRun = deferred()
  let delayRun = false, firstAnalysis = true
  const client: EngineClient = { ...base, async run(options) {
    const result = await base.run(options)
    if (delayRun && options.selection.z === 1) { runStarted.resolve(); await releaseRun.promise }
    return result
  }, async analyze(options) {
    const result = await base.run(options)
    if (options.selection.z === 1 && firstAnalysis) {
      firstAnalysis = false; analysisStarted.resolve(); await releaseAnalysis.promise; analysisFinished.resolve()
    }
    return analyzeBlock(result.image!)
  } }
  const runtime = new ImageRuntime({ client, cache, prefetch: false })
  await runtime.openFile(new File([], 'race.tif'))
  runtime.setSelection({ z: 1 }); await runtime.run(); await analysisStarted.promise
  cache.clear(); delayRun = true
  const drain = runtime.run()
  await runStarted.promise
  const mismatches: number[] = []
  runtime.subscribe((state) => { if (state.selection.z === 2 && state.analysis?.mean === 35) mismatches.push(state.analysis.mean) })
  runtime.setSelection({ z: 2 })
  releaseAnalysis.resolve(); await analysisFinished.promise
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(mismatches, [])
  releaseRun.resolve(); await drain
  assert.deepEqual([...runtime.getState().image!.data], [50, 60])
  runtime.dispose()
})

test('共享缓存关闭文档后取消 pin 并删除本数据集条目，保留其他文档', async () => {
  const cache = new ByteCache<EngineResult>(4)
  cache.set('other-document', {} as EngineResult, 2)
  const imported = importMemory({ name: 'close', dtype: 'uint8', axes: ['y', 'x'], shape: [1, 2], data: Uint8Array.of(1, 2) })
  const runtime = new ImageRuntime({ client: inlineClientWith(imported), cache, prefetch: false })
  await runtime.openFile(new File([], 'close.tif'))
  assert.equal(cache.stats().pinnedBytes, 2)
  runtime.dispose()
  assert.equal(cache.stats().pinnedBytes, 0)
  assert.equal(cache.stats().bytes, 2)
  assert.equal(cache.has('other-document'), true)
  cache.set('new-document', {} as EngineResult, 4)
  assert.equal(cache.has('new-document'), true)
  assert.equal(cache.stats().bytes, 4)
})

test('关闭后在途显示和预取都不能重新填入共享缓存', async () => {
  for (const prefetch of [false, true]) {
    const cache = new ByteCache<EngineResult>(4)
    const imported = importMemory({ name: 'inflight-close', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [2, 1, 2], data: Uint8Array.of(1, 2, 3, 4) })
    const base = inlineClientWith(imported), started = deferred(), release = deferred(), finished = deferred()
    const client: EngineClient = { ...base, async run(options) {
      const result = await base.run(options)
      if (options.selection.z === 1) { started.resolve(); await release.promise; finished.resolve() }
      return result
    } }
    const runtime = new ImageRuntime({ client, cache, prefetch })
    await runtime.openFile(new File([], 'close.tif'))
    if (!prefetch) runtime.setSelection({ z: 1 })
    await started.promise
    runtime.dispose(); release.resolve(); await finished.promise
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(cache.stats().bytes, 0)
    assert.equal(cache.stats().pinnedBytes, 0)
  }
})

test('缓存命中回调重入后 await run 仍等待新选择的在途请求', async () => {
  const imported = importMemory({ name: 'reentrant', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [2, 1, 2], data: Uint8Array.of(1, 2, 3, 4) })
  const base = inlineClientWith(imported), started = deferred(), release = deferred()
  const client: EngineClient = { ...base, async run(options) {
    const result = await base.run(options)
    if (options.selection.z === 1) { started.resolve(); await release.promise }
    return result
  } }
  const runtime = new ImageRuntime({ client, prefetch: false })
  await runtime.adoptDataset(imported.dataset)
  let redirect = true
  runtime.subscribe((state) => {
    if (redirect && state.status === 'ready' && !state.imageStale) { redirect = false; runtime.setSelection({ z: 1 }) }
  })
  let finished = false
  const drain = runtime.run().then(() => { finished = true })
  await started.promise
  await new Promise<void>((resolve) => setImmediate(resolve))
  const premature = finished
  release.resolve(); await drain
  assert.equal(premature, false)
  assert.deepEqual([...runtime.getState().image!.data], [3, 4])
  runtime.dispose()
})

test('重采纳同一数据集时不累积共享缓存 pin', async () => {
  const imported = importMemory({ name: 'readopt', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [2, 1, 2], data: Uint8Array.of(1, 2, 3, 4) })
  const cache = new ByteCache<EngineResult>(100)
  const runtime = new ImageRuntime({ client: inlineClientWith(imported), cache, prefetch: false })
  await runtime.adoptDataset(imported.dataset)
  await runtime.adoptDataset(imported.dataset)
  runtime.setSelection({ z: 1 }); await runtime.run()
  assert.equal(cache.stats().pinnedBytes, 2)
  runtime.dispose()
})

test('各派生操作在源文档关闭后返回时，释放未交给调用方的数据集', async () => {
  const operations: Array<(runtime: ImageRuntime) => Promise<unknown>> = [
    (runtime) => runtime.restructureStack({ op: 'reverse' }),
    (runtime) => runtime.projectStack({ method: 'average' }),
    (runtime) => runtime.montageStack({}),
    (runtime) => runtime.montageToStack({}),
    (runtime) => runtime.resliceStack({}),
    (runtime) => runtime.combineStacks({ op: 'concatenate' }),
    (runtime) => runtime.labelStack({ format: 'label' }),
    (runtime) => runtime.project3dStack({ method: 'mean', axis: 'z' }),
    (runtime) => runtime.remontageStack({ columns: 1, rows: 1 }),
  ]
  for (const operation of operations) {
    const imported = importMemory({ name: 'late-derived', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [2, 1, 2], data: Uint8Array.of(1, 2, 3, 4) })
    const derived = importMemory({ name: 'derived', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [2, 1, 2], data: Uint8Array.of(3, 4, 1, 2) })
    const base = inlineClientWith(imported), started = deferred(), release = deferred()
    const disposed: string[] = []
    const create = async () => { started.resolve(); await release.promise; return derived.dataset }
    const client: EngineClient = { ...base, restructure: create, project: create, montage: create, montageToStack: create, reslice: create, combine: create, label: create, project3d: create, remontage: create, dispose(id) { if (id) disposed.push(id) } }
    const runtime = new ImageRuntime({ client, ownsClient: false, prefetch: false })
    await runtime.adoptDataset(imported.dataset)
    const pending = operation(runtime)
    await started.promise; runtime.dispose(); release.resolve()
    assert.equal(await pending, undefined)
    assert.deepEqual(disposed, [imported.dataset.id, derived.dataset.id])
  }
})

test('栈重排的迟到成功和错误均不覆盖切换后的文档状态', async () => {
  for (const fails of [false, true]) {
    const imported = importMemory({ name: 'stale-restructure', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [2, 1, 2], data: Uint8Array.of(1, 2, 3, 4) })
    const base = inlineClientWith(imported), started = deferred(), release = deferred()
    const client: EngineClient = { ...base, async restructure() {
      started.resolve(); await release.promise
      if (fails) throw new DOMException('已取消', 'AbortError')
      return undefined
    } }
    const runtime = new ImageRuntime({ client, prefetch: false })
    await runtime.adoptDataset(imported.dataset)
    const pending = runtime.restructureStack({ op: 'reverse' })
    await started.promise
    runtime.setSelection({ z: 1 }); await runtime.run()
    let notifications = 0
    const unsubscribe = runtime.subscribe(() => { notifications++ })
    const before = notifications
    release.resolve(); await pending
    assert.equal(notifications, before)
    assert.equal(runtime.getState().status, 'ready')
    assert.equal(runtime.getState().error, undefined)
    unsubscribe(); runtime.dispose()
  }
})

test('正交视图在关闭后返回时，两个派生数据集均释放', async () => {
  const imported = importMemory({ name: 'late-views', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [2, 1, 2], data: Uint8Array.of(1, 2, 3, 4) })
  const first = importMemory({ name: 'xz', dtype: 'uint8', axes: ['y', 'x'], shape: [1, 2], data: Uint8Array.of(1, 2) })
  const second = importMemory({ name: 'yz', dtype: 'uint8', axes: ['y', 'x'], shape: [1, 2], data: Uint8Array.of(3, 4) })
  const base = inlineClientWith(imported), started = deferred(), release = deferred(), disposed: string[] = []
  const client: EngineClient = { ...base, async orthogonal() { started.resolve(); await release.promise; return [first.dataset, second.dataset] }, dispose(id) { if (id) disposed.push(id) } }
  const runtime = new ImageRuntime({ client, ownsClient: false, prefetch: false })
  await runtime.adoptDataset(imported.dataset)
  const pending = runtime.orthogonalViews()
  await started.promise; runtime.dispose(); release.resolve()
  assert.deepEqual(await pending, [])
  assert.deepEqual(disposed, [imported.dataset.id, first.dataset.id, second.dataset.id])
})

test('显示请求先等待同页结果、预取后等待时，预取回填不取消当前页 pin', async () => {
  const imported = importMemory({ name: 'prefetch-pin', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [3, 1, 2], data: Uint8Array.of(1, 2, 3, 4, 5, 6) })
  const base = inlineClientWith(imported), firstStarted = deferred(), secondStarted = deferred(), releaseFirst = deferred(), releaseSecond = deferred()
  const cache = new ByteCache<EngineResult>(100)
  const client: EngineClient = { ...base, async run(options) {
    const result = await base.run(options)
    if (options.selection.z === 1) { firstStarted.resolve(); await releaseFirst.promise }
    if (options.selection.z === 2) { secondStarted.resolve(); await releaseSecond.promise }
    return result
  } }
  const runtime = new ImageRuntime({ client, cache, prefetch: true })
  await runtime.adoptDataset(imported.dataset); await firstStarted.promise
  runtime.setSelection({ z: 2 })
  const drain = runtime.run()
  await secondStarted.promise
  releaseFirst.resolve()
  await new Promise<void>((resolve) => setImmediate(resolve))
  releaseSecond.resolve(); await drain
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual([...runtime.getState().image!.data], [5, 6])
  assert.equal(cache.stats().pinnedBytes, 2)
  runtime.dispose()
})

test('导入在文档关闭后返回时，不采纳且释放迟到的数据集', async () => {
  const imported = importMemory({ name: 'late-import', dtype: 'uint8', axes: ['y', 'x'], shape: [1, 2], data: Uint8Array.of(1, 2) })
  const base = inlineClientWith(imported), started = deferred(), release = deferred()
  const disposed: string[] = []
  const client: EngineClient = { ...base, async import() { started.resolve(); await release.promise; return imported.dataset }, dispose(id) { if (id) disposed.push(id) } }
  const runtime = new ImageRuntime({ client, ownsClient: false, prefetch: false })
  const pending = runtime.openFile(new File([], 'late.tif'))
  await started.promise; runtime.dispose(); release.resolve(); await pending
  assert.equal(runtime.getState().dataset, null)
  assert.deepEqual(disposed, [imported.dataset.id])
})

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

test('大图旧缓存可淘汰，当前切片历史保留且导出按页执行 Recipe', async () => {
  const imported = importMemory({ name: 'stack', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [2, 1, 4], data: Uint8Array.from([1, 2, 3, 4, 10, 20, 30, 40]) })
  const runtime = new ImageRuntime({ client: inlineClientWith(imported), prefetch: false, cacheBytes: 8 })
  await runtime.openFile(new File([], 'stack.tif'))
  runtime.addStep('invert', {}, { kind: 'frame', selection: { z: 0 } }); await runtime.run()
  runtime.setSelection({ z: 1 }); await runtime.run()
  assert.deepEqual([...runtime.getState().image!.data], [10, 20, 30, 40])
  runtime.addStep('invert', {}, { kind: 'frame', selection: { z: 1 } }); await runtime.run()
  assert.ok(runtime.getState().cache.bytes <= 8)
  runtime.undo(); await runtime.run()
  assert.deepEqual([...runtime.getState().image!.data], [10, 20, 30, 40])
  runtime.redo(); await runtime.run()
  const frames = []
  for await (const frame of runtime.exportFrames()) frames.push([...frame.data])
  assert.deepEqual(frames, [[254, 253, 252, 251], [245, 235, 225, 215]])
  assert.equal(runtime.getState().selection.z, 1)
  runtime.dispose()
})
