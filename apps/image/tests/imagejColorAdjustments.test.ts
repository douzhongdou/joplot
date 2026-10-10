import test from 'node:test'
import assert from 'node:assert/strict'
import { adjustContrastRange, contrastSliderValues, imagejColorValue, imagejAutoRange, applyColorAdjustments, type ColorAdjustment } from '../src/imagej/engine/colorAdjustments.ts'
import { importMemory } from '../src/imagej/engine/importer.ts'
import { PureComputeEngine } from '../src/imagej/engine/compute/engine.ts'
import { createRecipe, makeStep } from '../src/imagej/engine/recipe.ts'
import { displayBlock } from '../src/imagej/engine/render/display.ts'
import { rasterizeViewport } from '../src/imagej/engine/render/raster.ts'
import type { ImageBlock } from '../src/imagej/engine/types.ts'

const source = (): ImageBlock => ({ dtype: 'uint8', axes: ['c', 'y', 'x'], shape: [3, 1, 2], region: { start: [0, 0, 0], shape: [3, 1, 2] }, data: Uint8Array.from([30, 60, 90, 100, 150, 140]) })

test('ImageJ RGB LUT 使用 256 倍缩放、最小值向零取整与截断，覆盖相等范围', () => {
  assert.deepEqual([30, 90, 150].map((value) => imagejColorValue(value, -19.921875, 235.078125)), [49, 109, 169])
  assert.deepEqual([30, 90, 150].map((value) => imagejColorValue(value, 63.75, 191.25)), [0, 54, 174])
  assert.deepEqual([127, 128, 129].map((value) => imagejColorValue(value, 128, 128)), [0, 0, 255])
  for (let i = 0; i < 256; i++) assert.equal(imagejColorValue(i, 0, 255), i)
})

test('ImageJ 四滑杆移动中心、保持窗口宽度、分段改变斜率并处理范围交叉', () => {
  const initial = { min: 0, max: 255 }
  assert.deepEqual(contrastSliderValues(initial), { minimum: 0, maximum: 255, brightness: 128, contrast: 128 })
  const bright = adjustContrastRange(initial, 'brightness', 148)
  assert.deepEqual(bright, { min: -19.921875, max: 235.078125 })
  assert.deepEqual(adjustContrastRange(bright, 'contrast', 192), { min: 43.828125, max: 171.328125 })
  assert.deepEqual(adjustContrastRange(initial, 'contrast', 64), { min: -127.5, max: 382.5 })
  assert.deepEqual(adjustContrastRange({ min: 0, max: 50 }, 'minimum', 100), { min: 100, max: 100 })
  assert.deepEqual(adjustContrastRange({ min: 100, max: 200 }, 'maximum', 50), { min: 50, max: 50 })
})

test('All 和单通道映射、切换后的累积快照、ROI 与 PNG/视口保持一致', () => {
  const image = source(), adjustments: ColorAdjustment[] = [{ min: 0, max: 128, channel: 'red' }, { min: 0, max: 200, channel: 'green', roi: { x: 1, y: 0, width: 1, height: 1 } }]
  const applied = applyColorAdjustments(image, adjustments)
  assert.deepEqual([...applied.data], [60, 120, 90, 128, 150, 140])
  const settings = { window: 255, level: 127.5 }, options = { colorAdjustments: adjustments }
  const png = displayBlock(image, settings, options), viewport = rasterizeViewport(image, { zoom: 1, panX: 0, panY: 0, devicePixelRatio: 1, viewportWidth: 2, viewportHeight: 1 }, settings, options)
  assert.deepEqual([...png.data], [...applied.data])
  assert.deepEqual([...viewport], [60, 90, 150, 255, 120, 128, 140, 255])
  assert.deepEqual([...applyColorAdjustments(image, [{ min: 0, max: 128, channel: 'all' }]).data], [60, 120, 180, 200, 255, 255])
  assert.equal(image.data[0], 30)
})

test('ImageJ Auto 忽略占比超过 10% 的峰，重复点击降低阈值，无有效范围时复位', () => {
  const bins = new Uint32Array(256); bins[0] = 500; bins[20] = 5; bins[80] = 25; bins[180] = 25; bins[255] = 500
  const first = imagejAutoRange(bins, 10000, 0, 255)
  assert.deepEqual(first, { min: 0, max: 255, autoThreshold: 5000 })
  const peak = new Uint32Array(256); peak[0] = 2000; peak[20] = 5; peak[80] = 25; peak[180] = 25; peak[255] = 2000
  const second = imagejAutoRange(peak, 10000, 0, 255)
  assert.deepEqual(second, { min: 20, max: 180, autoThreshold: 5000 })
  assert.deepEqual(imagejAutoRange(peak, 10000, 0, 255, 500), { min: 0, max: 255, autoThreshold: 0 })
})

test('Recipe 保存 ImageJ RGB 范围和通道，ROI 不修改其他分量', async () => {
  const imported = importMemory({ name: 'color', dtype: 'uint8', axes: ['c', 'y', 'x'], shape: [3, 1, 2], componentKind: 'rgb', data: source().data })
  const recipe = createRecipe(imported.dataset.id, 0, [makeStep('levels', { mode: 'rgb-range', minimum: 0, maximum: 128, channel: 'green' }, { kind: 'frame', selection: {}, region: { start: [0, 0, 1], shape: [3, 1, 1] } })])
  const result = await new PureComputeEngine().runRecipe({ dataset: imported.dataset, storage: imported.storage, selection: {} }, recipe)
  assert.equal(result.results[0]!.status, 'ok')
  assert.deepEqual(result.image!.shape, [3, 1, 2])
  assert.deepEqual([...result.image!.data], [30, 60, 90, 200, 150, 140])
})

test('4K RGB 分通道调整保留完整分辨率，不受旧 400 万像素限额约束', () => {
  const width = 4096, height = 2160, pixels = width * height
  const data = new Uint8Array(pixels * 3); data.fill(30, 0, pixels); data.fill(90, pixels, 2 * pixels); data.fill(150, 2 * pixels)
  const image: ImageBlock = { dtype: 'uint8', axes: ['c', 'y', 'x'], shape: [3, height, width], region: { start: [0, 0, 0], shape: [3, height, width] }, data }
  const result = applyColorAdjustments(image, [{ min: 0, max: 128, channel: 'red' }])
  assert.deepEqual(result.shape, [3, height, width])
  assert.ok(result.data.subarray(0, pixels).every((value) => value === 60))
  assert.ok(result.data.subarray(pixels, 2 * pixels).every((value) => value === 90))
  assert.ok(result.data.subarray(2 * pixels).every((value) => value === 150))
  assert.equal(image.data[0], 30)
})
