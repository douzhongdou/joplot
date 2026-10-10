import test from 'node:test'
import assert from 'node:assert/strict'
import { computeStackStats, histogramMedian, histogramMode } from '../src/imagej/engine/stackStats.ts'
import { EngineHost } from '../src/imagej/engine/worker/host.ts'
import { encodeTiffStack } from '../src/imagej/engine/tiff.ts'
import { createRecipe, makeStep } from '../src/imagej/engine/recipe.ts'
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

/** 多页 uint16 TIFF：每页 2×4、值由调用方给。 */
async function stackFile(pages: number, values: (page: number) => number[]): Promise<File> {
  const blocks = Array.from({ length: pages }, (_, page) => frame('uint16', [2, 4], values(page)))
  const blob = await encodeTiffStack(toFrames(blocks), pages)
  return new File([blob], 'stack.tif')
}

/* ---------------- 直方图取值 ---------------- */

test('histogramMedian 累计到一半计数即取该桶，histogramMode 取计数最大的桶', () => {
  const histogram = new Uint32Array(300)
  histogram[10] = 5
  histogram[20] = 9
  histogram[30] = 2
  assert.equal(histogramMode(histogram), 20)
  // count=16 → half=8：累计到 bin20 才达到 14 ≥ 8。
  assert.equal(histogramMedian(histogram, 16), 20)
  assert.ok(Number.isNaN(histogramMode(new Uint32Array(4))))
  assert.ok(Number.isNaN(histogramMedian(new Uint32Array(4), 0)))
})

/* ---------------- 内核 ---------------- */

test('computeStackStats 逐页统计、逐页均值曲线与整栈汇总', async () => {
  const frames = [
    frame('uint8', [1, 4], [1, 2, 3, 4]),
    frame('uint8', [1, 4], [5, 6, 7, 8]),
  ]
  const result = await computeStackStats({ frameCount: 2, readFrame: async (index) => frames[index]! })

  assert.equal(result.axis, 'z')
  assert.equal(result.frameCount, 2)
  assert.equal(result.frames[0]!.slice, 1)
  assert.equal(result.frames[0]!.count, 4)
  assert.equal(result.frames[0]!.mean, 2.5)
  assert.equal(result.frames[1]!.mean, 6.5)
  assert.deepEqual(result.profile, [2.5, 6.5])
  // 样本标准差（除以 n-1）：[1,2,3,4] → sqrt(5/3)。
  assert.ok(Math.abs(result.frames[0]!.stdDev - Math.sqrt(5 / 3)) < 1e-12)

  assert.equal(result.summary.voxels, 8)
  assert.equal(result.summary.mean, 4.5)
  assert.equal(result.summary.min, 1)
  assert.equal(result.summary.max, 8)
  // 中位数与众数取自直方图（桶宽 1）：8 个各出现一次 → 中位 bin 4、众数取最小满桶 1。
  assert.equal(result.summary.median, 4)
  assert.equal(result.summary.mode, 1)

  // 未标定：横轴从 1 开始、间距 1（ImageJ 的 origin=-1）。
  assert.deepEqual(result.x, [1, 2])
  assert.equal(result.xUnit, '')
  assert.equal(result.xLabel, 'z')
})

test('computeStackStats 对 float32 再读一遍建桶，给出中位数与众数', async () => {
  let reads = 0
  const result = await computeStackStats({
    frameCount: 1,
    readFrame: async () => {
      reads += 1
      return frame('float32', [1, 2], [1.5, 2.5])
    },
  })
  assert.equal(result.frames[0]!.mean, 2)
  // 桶宽 = 1/256，取值取桶中心，因此误差不超过一个桶宽。
  assert.ok(Math.abs(result.frames[0]!.median - 1.5) <= 1 / 256)
  assert.ok(Math.abs(result.frames[0]!.mode - 1.5) <= 1 / 256)
  assert.ok(Math.abs(result.summary.median - 1.5) <= 1 / 256)
  assert.ok(Math.abs(result.summary.mode - 1.5) <= 1 / 256)
  // 第一遍统计 + 第二遍建桶。
  assert.equal(reads, 2)
})

test('computeStackStats 按标定换算横轴，时间轴从 0 开始', async () => {
  const spatial = await computeStackStats({
    frameCount: 3,
    readFrame: async () => frame('uint8', [1, 1], [7]),
    calibration: { spacing: 0.5, origin: 0, unit: 'um' },
  })
  assert.deepEqual(spatial.x, [0, 0.5, 1])
  assert.equal(spatial.xUnit, 'um')

  const temporal = await computeStackStats({
    frameCount: 2,
    axis: 't',
    readFrame: async () => frame('uint8', [1, 1], [7]),
    calibration: { spacing: 2, origin: 0, unit: 's' },
  })
  assert.deepEqual(temporal.x, [0, 2])
  assert.equal(temporal.xLabel, 't')
})

test('computeStackStats 优先使用第一页的 dtype 建直方图，且逐页取各自中位数', async () => {
  const frames = [
    frame('uint8', [1, 4], [0, 0, 0, 0]),
    frame('uint8', [1, 4], [1, 2, 3, 4]),
  ]
  const result = await computeStackStats({ frameCount: 2, readFrame: async (index) => frames[index]! })
  assert.equal(result.frames[0]!.median, 0)
  assert.equal(result.frames[1]!.median, 2)
  assert.equal(result.summary.median, 0)
})

/* ---------------- 引擎通路 ---------------- */

test('EngineHost.stackStats 逐页执行当前 Recipe 后统计', async () => {
  const host = new EngineHost()
  const file = await stackFile(3, (page) => Array.from({ length: 8 }, (_, i) => page * 4 + i + 1))
  const imported = await host.import(file)
  const dataset = imported.dataset

  const plain = await host.stackStats({
    datasetId: dataset.id,
    recipe: createRecipe(dataset.id, dataset.revision),
    selection: {},
  })
  assert.ok(plain)
  assert.equal(plain.frameCount, 3)
  assert.deepEqual(plain.profile, [4.5, 8.5, 12.5])
  assert.equal(plain.summary.voxels, 24)
  assert.equal(plain.summary.mean, 8.5)
  // 24 个值：1-4 各 1 次、5-12 各 2 次、13-16 各 1 次 → 累计到 bin8 达到一半计数 12，
  // 众数是出现 2 次的最小值 5。
  assert.equal(plain.summary.median, 8)
  assert.equal(plain.summary.mode, 5)

  // Recipe 参与统计：uint16 的反相是 65535 - v，因此逐页均值也被镜像。
  const inverted = await host.stackStats({
    datasetId: dataset.id,
    recipe: createRecipe(dataset.id, dataset.revision, [makeStep('invert')]),
    selection: {},
  })
  assert.ok(inverted)
  assert.deepEqual(inverted.profile, [65535 - 4.5, 65535 - 8.5, 65535 - 12.5])
  assert.equal(inverted.frames[0]!.min, 65535 - 8)
  assert.equal(inverted.frames[0]!.max, 65535 - 1)
})

test('EngineHost.stackStats 在无多页轴时返回 undefined', async () => {
  const host = new EngineHost()
  const blob = await encodeTiffStack(toFrames([frame('uint16', [1, 2], [3, 4])]), 1)
  const imported = await host.import(new File([blob], 'single.tif'))
  const result = await host.stackStats({
    datasetId: imported.dataset.id,
    recipe: createRecipe(imported.dataset.id, imported.dataset.revision),
    selection: {},
  })
  assert.equal(result, undefined)
})
