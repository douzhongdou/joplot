import test from 'node:test'
import assert from 'node:assert/strict'
import { createDataset, datasetBytes, frameIndex, reviseDataset, totalPixels } from '../src/imagej/engine/dataset.ts'
import { MemoryStorage, clampRegion, fullRegion, regionBytes, validateRegion } from '../src/imagej/engine/storage.ts'
import { createRecipe, appendStep, makeStep, RecipeHistory, recipeVersionKey, removeStep, stepVersionKey, truncateAt, updateStepParams } from '../src/imagej/engine/recipe.ts'
import { StatsAccumulator, summarize } from '../src/imagej/engine/stats.ts'
import { ByteCache, cacheKey } from '../src/imagej/engine/scheduler/cache.ts'
import { TASK_PRIORITY, TaskQueue, VersionGuard } from '../src/imagej/engine/scheduler/queue.ts'
import { centerCamera, fitZoom, imageToScreen, oneToOneZoom, screenToImage, screenToPixel, zoomAt } from '../src/imagej/engine/render/geometry.ts'
import { defaultOperatorParams, getOperator, toUiRegistry, validateOperatorParams } from '../src/imagej/engine/operators.ts'
import { PureComputeEngine } from '../src/imagej/engine/compute/engine.ts'
import { importMemory } from '../src/imagej/engine/importer.ts'
import { uncalibratedSpatialTransform, type ImageBlock, type PixelArray } from '../src/imagej/engine/types.ts'

function block(dtype: ImageBlock['dtype'], shape: number[], values: number[]): ImageBlock {
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

const uid = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`

/* ---------------- Dataset ---------------- */

test('createDataset 派生轴信息并校验轴顺序', () => {
  const dataset = createDataset({
    id: uid('ds'),
    dtype: 'uint16',
    axes: ['z', 'y', 'x'],
    shape: [3, 4, 5],
    spatialTransform: uncalibratedSpatialTransform(),
    source: { kind: 'memory', name: 'x', format: 'memory', fingerprint: 'x' },
  })
  assert.equal(totalPixels(dataset), 60)
  assert.equal(datasetBytes(dataset), 120)
  assert.equal(dataset.axesInfo.find((axis) => axis.name === 'z')?.length, 3)
  assert.throws(() => createDataset({
    dtype: 'uint8', axes: ['x', 'y'], shape: [2, 2],
    spatialTransform: uncalibratedSpatialTransform(),
    source: { kind: 'memory', name: 'x', format: 'memory', fingerprint: 'x' },
  }), /y 在 x 之前/)
})

test('frameIndex 定位切片并拒绝越界', () => {
  const dataset = createDataset({
    id: uid('ds'), dtype: 'uint8', axes: ['t', 'z', 'y', 'x'], shape: [2, 3, 4, 5],
    spatialTransform: uncalibratedSpatialTransform(),
    source: { kind: 'memory', name: 'x', format: 'memory', fingerprint: 'x' },
  })
  assert.equal(frameIndex(dataset, { t: 1, z: 2 }), 1 * 3 + 2)
  assert.throws(() => frameIndex(dataset, { t: 2 }), /超出/)
})

test('reviseDataset 递增 revision 并保留 id', () => {
  const dataset = createDataset({
    id: uid('ds'), dtype: 'uint8', axes: ['y', 'x'], shape: [1, 1],
    spatialTransform: uncalibratedSpatialTransform(),
    source: { kind: 'memory', name: 'x', format: 'memory', fingerprint: 'x' },
  })
  const revised = reviseDataset(dataset)
  assert.equal(revised.id, dataset.id)
  assert.equal(revised.revision, dataset.revision + 1)
})

/* ---------------- Storage ---------------- */

test('MemoryStorage 按区域切片（行优先、x 最快）', async () => {
  const meta = {
    dtype: 'uint8' as const, axes: ['y', 'x'] as const, shape: [2, 3],
    source: { kind: 'memory' as const, name: 'x', format: 'memory' as const, fingerprint: 'x' },
  }
  const storage = new MemoryStorage(uid('s'), meta, Uint8Array.from([1, 2, 3, 4, 5, 6]))
  const all = await storage.readRegion(fullRegion([2, 3]))
  assert.deepEqual(Array.from(all.data as Uint8Array), [1, 2, 3, 4, 5, 6])
  const sub = await storage.readRegion({ start: [1, 1], shape: [1, 2] })
  assert.deepEqual(Array.from(sub.data as Uint8Array), [5, 6])
  assert.equal(regionBytes({ start: [0, 0], shape: [1, 2] }, 'uint8'), 2)
})

test('区域校验与夹取', () => {
  assert.throws(() => validateRegion({ start: [0, 0], shape: [3, 1] }, ['y', 'x'], [2, 3]), /越界/)
  assert.deepEqual(clampRegion({ start: [1, 2], shape: [5, 5] }, [2, 3]), { start: [1, 2], shape: [1, 1] })
})

/* ---------------- Recipe / 撤销 ---------------- */

test('Recipe 线性链编辑与版本键', () => {
  let recipe = createRecipe('ds', 0)
  const a = makeStep('invert', {})
  const b = makeStep('gaussian', { sigma: 2 })
  recipe = appendStep(appendStep(recipe, a), b)
  assert.equal(recipe.steps.length, 2)
  assert.match(stepVersionKey(a), /invert@v1/)
  const keyBefore = recipeVersionKey(recipe, a.id)
  recipe = updateStepParams(recipe, b.id, { sigma: 3 })
  assert.notEqual(recipeVersionKey(recipe, b.id), keyBefore)
  assert.equal(truncateAt(recipe, b.id).steps.length, 1)
  assert.equal(removeStep(recipe, a.id).steps.length, 1)
})

test('RecipeHistory 提交、等价去重与撤销', () => {
  const initial = createRecipe('ds', 0)
  const history = new RecipeHistory(initial)
  const once = appendStep(initial, makeStep('invert', {}))
  history.commit(once)
  history.commit(appendStep(initial, makeStep('invert', {})))
  assert.equal(history.size(), 1)
  assert.equal(history.undo().steps.length, 0)
  assert.equal(history.canUndo(), false)
})

/* ---------------- Stats ---------------- */

test('统计累加器可合并且样本标准差正确', () => {
  const a = new StatsAccumulator('uint8')
  a.add(block('uint8', [1, 2], [2, 4]))
  const b = new StatsAccumulator('uint8')
  b.add(block('uint8', [1, 2], [6, 8]))
  a.merge(b)
  const merged = a.merged()
  assert.equal(merged.count, 4)
  assert.equal(merged.mean, 5)
  assert.equal(merged.min, 2)
  assert.equal(merged.max, 8)
  assert.ok(Math.abs(merged.sampleStdDev - Math.sqrt(20 / 3)) < 1e-9)
  assert.equal(summarize(block('uint8', [1, 1], [7])).mean, 7)
})

/* ---------------- Scheduler ---------------- */

test('ByteCache 按字节淘汰且尊重 pin', () => {
  const cache = new ByteCache<number>(10)
  cache.set('a', 1, 4)
  cache.set('b', 2, 4, true)
  cache.set('c', 3, 4)
  const stats = cache.stats()
  assert.ok(stats.bytes <= 10)
  assert.equal(cache.has('b'), true)
  assert.equal(cache.has('a'), false)
  cache.unpin('b')
  assert.ok(cacheKey({ sourceId: 's', sourceRevision: 1, recipeKey: 'r', slice: 'z0', output: 'result' }).length > 0)
})

test('TaskQueue 优先最高者并合并同键任务', () => {
  const queue = new TaskQueue<number>()
  const discarded: string[] = []
  queue.push({ id: 'low', priority: TASK_PRIORITY.background, isStale: () => false, run: async () => 0 })
  queue.push({ id: 'a', priority: TASK_PRIORITY.prefetchForward, coalesceKey: 'page', isStale: () => false, run: async () => 1, onDiscard: (reason) => discarded.push(reason) })
  queue.push({ id: 'b', priority: TASK_PRIORITY.critical, coalesceKey: 'page', isStale: () => false, run: async () => 2 })
  assert.deepEqual(discarded, ['coalesced'])
  assert.equal(queue.next()?.id, 'b')
  assert.equal(queue.next()?.id, 'low')
})

test('VersionGuard 标记过期快照', () => {
  const guard = new VersionGuard('v1')
  const snapshot = guard.snapshot()
  assert.equal(snapshot.isStale(), false)
  guard.update('v2')
  assert.equal(snapshot.isStale(), true)
})

/* ---------------- Render geometry ---------------- */

test('坐标换算、1:1 与缩放锚点', () => {
  const camera = { zoom: 2, panX: 10, panY: 20, devicePixelRatio: 2, viewportWidth: 100, viewportHeight: 100 }
  assert.deepEqual(imageToScreen(1, 1, camera), { x: 12, y: 22 })
  assert.deepEqual(screenToImage(12, 22, camera), { x: 1, y: 1 })
  assert.deepEqual(screenToPixel(12, 22, camera, 10, 10), { x: 1, y: 1 })
  assert.equal(screenToPixel(-1, -1, camera, 10, 10), undefined)
  assert.equal(oneToOneZoom(2), 0.5)
  assert.equal(fitZoom(200, 100, 100, 100), 0.5)
  const zoomed = zoomAt(camera, 2, 12, 22)
  assert.equal(zoomed.zoom, 4)
  assert.deepEqual(screenToImage(12, 22, zoomed), { x: 1, y: 1 })
  assert.equal(centerCamera(10, 10, { ...camera, zoom: 1 }).panX, 45)
})

/* ---------------- Operators ---------------- */

test('算子注册表桥接与参数校验', () => {
  const registry = toUiRegistry()
  assert.ok(registry.operators.some((operator) => operator.kind === 'gaussian'))
  const gaussian = getOperator('gaussian')!
  assert.deepEqual(defaultOperatorParams(gaussian), { sigma: 1.5 })
  const ok = validateOperatorParams(gaussian, { sigma: 3 })
  assert.equal(ok.ok, true)
  assert.equal(ok.values.sigma, 3)
  // 滤镜参数不设上限：取多大是用户的选择（大值只是慢，不该被悄悄砍掉）。
  const large = validateOperatorParams(gaussian, { sigma: 999 })
  assert.equal(large.ok, true)
  assert.equal(large.values.sigma, 999)
  // 下限仍然兜住：sigma 必须为正。
  const tooSmall = validateOperatorParams(gaussian, { sigma: -1 })
  assert.equal(tooSmall.ok, false)
  assert.equal(tooSmall.values.sigma, 0.1)
})

/* ---------------- Pure compute engine ---------------- */

test('纯 TS 引擎按 Recipe 顺序执行并产出统计', async () => {
  const imported = importMemory({
    name: 'sample', dtype: 'uint8', axes: ['y', 'x'], shape: [2, 2],
    data: Uint8Array.from([0, 100, 200, 255]),
  })
  const engine = new PureComputeEngine()
  const recipe = createRecipe(imported.dataset.id, imported.dataset.revision, [makeStep('invert', {})])
  const result = await engine.runRecipe(
    { dataset: imported.dataset, storage: imported.storage, selection: {} },
    recipe,
  )
  assert.deepEqual(Array.from(result.image!.data as Uint8Array), [255, 155, 55, 0])
  assert.equal(result.results[0]!.status, 'ok')

  const statsRecipe = createRecipe(imported.dataset.id, imported.dataset.revision, [makeStep('measure', {})])
  const statsResult = await engine.runRecipe(
    { dataset: imported.dataset, storage: imported.storage, selection: {} },
    statsRecipe,
  )
  assert.equal(statsResult.results[0]!.stats?.[0]!.mean, 138.75)
})

test('纯 TS 引擎支持 16 位阈值与 ROI 阅读', async () => {
  const imported = importMemory({
    name: 'u16', dtype: 'uint16', axes: ['y', 'x'], shape: [1, 4],
    data: Uint16Array.from([0, 40000, 50000, 65535]),
  })
  const engine = new PureComputeEngine()
  const recipe = createRecipe(imported.dataset.id, imported.dataset.revision, [makeStep('threshold', { level: 45000 })])
  const result = await engine.runRecipe(
    { dataset: imported.dataset, storage: imported.storage, selection: {} },
    recipe,
  )
  assert.deepEqual(Array.from(result.image!.data as Uint8Array), [0, 0, 255, 255])
})

test('纯 TS 引擎对整卷执行 measure 并合并', async () => {
  const imported = importMemory({
    name: 'stack', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [2, 1, 2],
    data: Uint8Array.from([2, 4, 6, 8]),
  })
  const engine = new PureComputeEngine()
  const step = makeStep('measure', {}, { kind: 'stack' })
  const result = await engine.runRecipe(
    { dataset: imported.dataset, storage: imported.storage, selection: {} },
    createRecipe(imported.dataset.id, imported.dataset.revision, [step]),
  )
  assert.equal(result.results[0]!.stats?.[0]!.count, 4)
  assert.equal(result.results[0]!.stats?.[0]!.mean, 5)
})

test('纯 TS 引擎对未知算子返回错误状态而不抛出', async () => {
  const imported = importMemory({
    name: 'e', dtype: 'uint8', axes: ['y', 'x'], shape: [1, 1], data: Uint8Array.from([1]),
  })
  const engine = new PureComputeEngine()
  const result = await engine.runRecipe(
    { dataset: imported.dataset, storage: imported.storage, selection: {} },
    createRecipe(imported.dataset.id, imported.dataset.revision, [makeStep('nope', {})]),
  )
  assert.equal(result.results[0]!.status, 'error')
})
