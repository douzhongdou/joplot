import test from 'node:test'
import assert from 'node:assert/strict'
import { gaussianBlur, minimum3x3, maximum3x3 } from '../src/imagej/lib/filters.ts'
import { gaussianBlurInto } from '../src/imagej/lib/processor.ts'
import { analyzeBlock } from '../src/imagej/engine/analysis.ts'
import { displayBlock } from '../src/imagej/engine/render/display.ts'
import { crop, dilate, fillHoles, invert, levels, otsu, sharpen3x3 } from '../src/imagej/engine/compute/pureOps.ts'
import { rasterizeViewport } from '../src/imagej/engine/render/raster.ts'
import { encodeTiffStack } from '../src/imagej/engine/tiff.ts'
import { decodeTiff } from '../src/imagej/lib/tiff.ts'
import { PureComputeEngine } from '../src/imagej/engine/compute/engine.ts'
import { importMemory } from '../src/imagej/engine/importer.ts'
import { createRecipe, makeStep, RecipeHistory, appendStep } from '../src/imagej/engine/recipe.ts'
import type { ImageBlock } from '../src/imagej/engine/types.ts'

function block(data: ImageBlock['data'], shape = [1, data.length], dtype: ImageBlock['dtype'] = 'uint8'): ImageBlock {
  return { data, shape, dtype, axes: ['y', 'x'], region: { start: [0, 0], shape } }
}

test('4K 和 8K 秩滤波不再拒绝超过 400 万像素的图像', () => {
  for (const [width, height] of [[4096, 2160], [7680, 4320]]) {
    const source = { width: width!, height: height!, data: new Uint8Array(width! * height!).fill(77) }
    const center = Math.floor(height! / 2) * width! + Math.floor(width! / 2)
    source.data[center] = 255
    const low = minimum3x3(source), high = maximum3x3(source)
    assert.equal(low.data.length, width! * height!)
    assert.equal(low.data[center], 77)
    assert.equal(high.data[center - width! - 1], 255)
    assert.equal(high.data[center - width! - 2], 77)
    assert.equal(source.data[center], 255)
  }
})

test('8K 高斯保持常量图，超过旧的滤波限额', () => {
  const image = { width: 7680, height: 4320, data: new Uint8Array(7680 * 4320).fill(73) }
  const result = gaussianBlur(image, 0.5)
  assert.equal(result.data.length, image.data.length)
  assert.ok(result.data.every((value) => value === 73))
})

test('高斯行缓存跨环形边界与整幅浮点参考一致，并支持 stride', () => {
  const width = 13, height = 31, sigma = 1.5, radius = Math.ceil(3 * sigma)
  const source = Uint8Array.from({ length: width * height * 3 }, (_, i) => (i * 97 + 31) % 256)
  const destination = new Uint8Array(source.length)
  gaussianBlurInto({ data: source, stride: 3, offset: 1 }, { data: destination, stride: 3, offset: 2 }, width, height, sigma)
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, k) => Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma)))
  const total = kernel.reduce((a, b) => a + b, 0)
  const temp = new Float32Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0
    for (let k = -radius; k <= radius; k++) sum += source[(y * width + Math.max(0, Math.min(width - 1, x + k))) * 3 + 1]! * kernel[k + radius]! / total
    temp[y * width + x] = sum
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0
    for (let k = -radius; k <= radius; k++) sum += temp[Math.max(0, Math.min(height - 1, y + k)) * width + x]! * kernel[k + radius]! / total
    assert.equal(destination[(y * width + x) * 3 + 2], Math.round(sum))
  }
})

test('视口缓冲只随屏幕尺寸增长，宽 65536 的图像可在 1:1 查看末端原始像素', () => {
  const image = block(new Uint16Array(65536).fill(0), [1, 65536], 'uint16')
  image.data[65535] = 65535
  const camera = { zoom: 1, panX: -65534, panY: 0, devicePixelRatio: 1, viewportWidth: 2, viewportHeight: 1 }
  const pixels = rasterizeViewport(image, camera, { window: 65535, level: 32767.5 })
  assert.deepEqual([...pixels], [0, 0, 0, 255, 255, 255, 255, 255])
  assert.equal(image.data[65535], 65535)
})

test('ROI 统计读取原始浮点值、忽略 NaN/Infinity，剖面和直方图一致', () => {
  const image = block(Float32Array.from([1000, 2000, NaN, Infinity, 3000, 4000]), [2, 3], 'float32')
  const stats = analyzeBlock(image, { x: 0, y: 0, width: 2, height: 2 })
  assert.equal(stats.count, 3)
  assert.equal(stats.mean, 2000)
  assert.equal(stats.stdDev, 1000)
  assert.equal(stats.histogram.reduce((sum, value) => sum + value, 0), 3)
  assert.deepEqual(stats.profile, [Infinity, 3000])
})

test('浮点亮度应用保持精度且不会产生整图 NaN，PNG 和视口采用同一阈值映射', () => {
  const source = block(Float32Array.from([-1.5, 0, 2.5, NaN]), [1, 4], 'float32')
  assert.deepEqual([...levels(source, 0, 50).data], [...source.data])
  assert.ok(Number.isFinite(levels(source, 10, 60).data[0]))
  const settings = { window: 4, level: 0.5 }, options = { threshold: 0 }
  const png = displayBlock(source, settings, options)
  const rgba = rasterizeViewport(source, { zoom: 1, panX: 0, panY: 0, viewportWidth: 4, viewportHeight: 1, devicePixelRatio: 1 }, settings, options)
  assert.deepEqual([...png.data], [0, 0, 255, 0])
  assert.deepEqual([...png.data], [rgba[0], rgba[4], rgba[8], rgba[12]])
})

test('当前切片处理、ROI 写回与整栈处理互不串页，测量基于结果', async () => {
  const imported = importMemory({ name: 'stack', dtype: 'uint8', axes: ['z', 'y', 'x'], shape: [2, 1, 3], data: Uint8Array.from([1, 2, 3, 10, 20, 30]) })
  const engine = new PureComputeEngine()
  const recipe = createRecipe(imported.dataset.id, 0, [
    makeStep('invert', {}, { kind: 'frame', selection: { z: 1 }, region: { start: [0, 0, 1], shape: [1, 1, 1] } }),
    makeStep('maximum3x3', {}, { kind: 'stack' }), makeStep('measure'),
  ])
  const context = { dataset: imported.dataset, storage: imported.storage }
  const first = await engine.runRecipe({ ...context, selection: { z: 0 } }, recipe)
  const second = await engine.runRecipe({ ...context, selection: { z: 1 } }, recipe)
  assert.deepEqual([...first.image!.data], [2, 3, 3])
  assert.deepEqual([...second.image!.data], [235, 235, 235])
  assert.equal(second.results[second.results.length - 1]!.stats![0]!.mean, 235)
})

test('Recipe 重做恢复完整范围与参数，撤销后新提交清除重做分支', () => {
  const initial = createRecipe('stack', 0), history = new RecipeHistory(initial)
  const first = appendStep(initial, makeStep('invert', {}, { kind: 'frame', selection: { z: 2 } }))
  history.commit(first); history.undo(); assert.equal(history.canRedo(), true)
  assert.equal(history.redo(), first)
  history.undo(); history.commit(appendStep(initial, makeStep('threshold', { level: 200 })))
  assert.equal(history.canRedo(), false)
})

test('浮点反相、负值膨胀、填孔和 Otsu 使用有限的原始值', () => {
  const image = block(Float32Array.from([-5, -3, -1]), [1, 3], 'float32')
  assert.deepEqual([...invert(image).data], [-1, -3, -5])
  assert.deepEqual([...dilate(image).data], [-3, -1, -1])
  const constant = block(new Uint16Array(9).fill(1000), [3, 3], 'uint16')
  assert.ok(sharpen3x3(constant).data.every((value) => value === 1000))
  const ring = block(Float32Array.from([1, 1, 1, 1, 0, 1, 1, 1, 1]), [3, 3], 'float32')
  assert.equal(fillHoles(ring).data[4], 255)
  const mask = otsu(block(Float32Array.from([0, 0, 10, 10, NaN, Infinity]), [1, 6], 'float32'))
  assert.deepEqual([...mask.data], [0, 0, 255, 255, 0, 0])
})

test('16 位 ROI 阈值不截断选区外像素，显式灰度转换可撤销', async () => {
  const imported = importMemory({ name: 'u16', dtype: 'uint16', axes: ['y', 'x'], shape: [1, 3], data: Uint16Array.from([1000, 50000, 65535]) })
  const context = { dataset: imported.dataset, storage: imported.storage, selection: {} }
  const engine = new PureComputeEngine()
  const result = await engine.runRecipe(context, createRecipe(imported.dataset.id, 0, [makeStep('threshold', { level: 40000 }, { kind: 'frame', selection: {}, region: { start: [0, 1], shape: [1, 1] } })]))
  assert.equal(result.image!.dtype, 'uint16')
  assert.deepEqual([...result.image!.data], [1000, 255, 65535])
  const converted = await engine.runRecipe(context, createRecipe(imported.dataset.id, 0, [makeStep('grayscale')]))
  assert.equal(converted.image!.dtype, 'uint8')
  assert.deepEqual([...converted.image!.data], [0, 194, 255])
  assert.deepEqual([...(await engine.runRecipe(context, createRecipe(imported.dataset.id, 0))).image!.data], [1000, 50000, 65535])
})

test('彩色 ROI 裁剪保留三个通道平面供分析使用', () => {
  const rgb: ImageBlock = { dtype: 'uint8', axes: ['c', 'y', 'x'], shape: [3, 1, 3], region: { start: [0, 0, 0], shape: [3, 1, 3] }, data: Uint8Array.from([1, 2, 3, 10, 20, 30, 100, 200, 255]) }
  const result = crop(rgb, { x: 1, y: 0, width: 1, height: 1 })
  assert.deepEqual(result.shape, [3, 1, 1])
  assert.deepEqual([...result.data], [2, 20, 200])
})

test('奇数像素的 TIFF 页面以偶数字节对齐且可读取下一页', async () => {
  const frames = async function* () { yield block(Uint8Array.from([1, 2, 3])); yield block(Uint8Array.from([4, 5, 6])) }
  const bytes = await (await encodeTiffStack(frames(), 2)).arrayBuffer()
  const view = new DataView(bytes)
  assert.equal(view.getUint32(10 + view.getUint16(8, true) * 12, true) % 2, 0)
  assert.deepEqual(decodeTiff(bytes).map((image) => [...image.data]), [[1, 2, 3], [4, 5, 6]])
})

test('TIFF 栈逐页写出可往返 8 位像素，并保留 16 位/浮点/RGB 的标签和像素字节', async () => {
  const frames = [block(Uint8Array.from([1, 2])), block(Uint8Array.from([3, 4]))]
  const iterable = async function* (images: ImageBlock[]) { yield* images }
  const blob = await encodeTiffStack(iterable(frames), 2)
  assert.deepEqual(decodeTiff(await blob.arrayBuffer()).map((image) => [...image.data]), [[1, 2], [3, 4]])
  for (const image of [block(Uint16Array.from([1000, 65535]), [1, 2], 'uint16'), block(Float32Array.from([-1.25, 2.5]), [1, 2], 'float32')]) {
    const bytes = new Uint8Array(await (await encodeTiffStack(iterable([image]), 1)).arrayBuffer())
    assert.deepEqual([...bytes.slice(-image.data.byteLength)], [...new Uint8Array(image.data.buffer)])
    const view = new DataView(bytes.buffer), tagCount = view.getUint16(8, true)
    const sampleTag = Array.from({ length: tagCount }, (_, i) => 10 + i * 12).find((at) => view.getUint16(at, true) === 339)!
    assert.equal(view.getUint16(sampleTag + 8, true), image.dtype === 'float32' ? 3 : 1)
  }
  const rgb: ImageBlock = { dtype: 'uint8', axes: ['c', 'y', 'x'], shape: [3, 1, 2], region: { start: [0, 0, 0], shape: [3, 1, 2] }, data: Uint8Array.from([1, 2, 10, 20, 100, 200]) }
  const rgbBytes = new Uint8Array(await (await encodeTiffStack(iterable([rgb]), 1)).arrayBuffer())
  assert.deepEqual([...rgbBytes.slice(-6)], [1, 10, 100, 2, 20, 200])
})
