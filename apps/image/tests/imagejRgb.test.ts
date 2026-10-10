import test from 'node:test'
import assert from 'node:assert/strict'
import { importFile, importMemory } from '../src/imagej/engine/importer.ts'
import { PureComputeEngine } from '../src/imagej/engine/compute/engine.ts'
import { createRecipe, makeStep } from '../src/imagej/engine/recipe.ts'
import { blockToRgba } from '../src/imagej/engine/render/rgba.ts'
import { levels } from '../src/imagej/engine/compute/pureOps.ts'
import { displayBlock } from '../src/imagej/engine/render/display.ts'
import { rasterizeViewport } from '../src/imagej/engine/render/raster.ts'
import type { Image as ItkImage } from 'itk-wasm'
import type { ImageBlock, PixelArray } from '../src/imagej/engine/types.ts'

function rgbBlock(): ImageBlock {
  // 2×2 像素，按 c 轴平面存放：R 平面、G 平面、B 平面。
  const data = Uint8Array.from([
    10, 20, 30, 40, // R
    50, 60, 70, 80, // G
    90, 100, 110, 120, // B
  ]) as PixelArray
  return { dtype: 'uint8', axes: ['c', 'y', 'x'], shape: [3, 2, 2], region: { start: [0, 0, 0], shape: [3, 2, 2] }, data }
}

test('blockToRgba 对三通道块直接输出 RGB（不做窗口映射）', () => {
  const rgba = blockToRgba(rgbBlock(), { window: 1, level: 0 })
  assert.equal(rgba.length, 16)
  assert.deepEqual([...rgba.slice(0, 4)], [10, 50, 90, 255])
  assert.deepEqual([...rgba.slice(4, 8)], [20, 60, 100, 255])
})

test('RGB Dataset 空 Recipe 返回合成三通道块', async () => {
  const imported = importMemory({
    name: 'rgb', dtype: 'uint8', axes: ['c', 'y', 'x'], shape: [3, 2, 2],
    data: Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]),
    componentKind: 'rgb',
  })
  const engine = new PureComputeEngine()
  const result = await engine.runRecipe(
    { dataset: imported.dataset, storage: imported.storage, selection: {} },
    createRecipe(imported.dataset.id, imported.dataset.revision),
  )
  assert.equal(imported.dataset.componentKind, 'rgb')
  assert.equal(result.image!.shape[result.image!.axes.indexOf('c')], 3)
  assert.deepEqual(Array.from(result.image!.data as Uint8Array), [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120])
})

test('RGB Dataset 的 grayscale 步骤产出单通道等权平均', async () => {
  const imported = importMemory({
    name: 'rgb', dtype: 'uint8', axes: ['c', 'y', 'x'], shape: [3, 2, 2],
    data: Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]),
    componentKind: 'rgb',
  })
  const engine = new PureComputeEngine()
  const result = await engine.runRecipe(
    { dataset: imported.dataset, storage: imported.storage, selection: {} },
    createRecipe(imported.dataset.id, imported.dataset.revision, [makeStep('grayscale', {})]),
  )
  assert.deepEqual(Array.from(result.image!.data as Uint8Array), [50, 60, 70, 80])
})

test('RGB Dataset 的二值阈值要求显式单通道输入', async () => {
  const imported = importMemory({
    name: 'rgb', dtype: 'uint8', axes: ['c', 'y', 'x'], shape: [3, 1, 1],
    data: Uint8Array.from([1, 2, 3]),
    componentKind: 'rgb',
  })
  const engine = new PureComputeEngine()
  const result = await engine.runRecipe(
    { dataset: imported.dataset, storage: imported.storage, selection: {} },
    createRecipe(imported.dataset.id, imported.dataset.revision, [makeStep('threshold', {})]),
  )
  assert.equal(result.results[0]!.status, 'error')
  assert.match(result.results[0]!.error ?? '', /单通道/)
})

test('RGB 亮度和对比度的原值处理、彩色预览及 PNG 映射逐通道一致', () => {
  const source = rgbBlock()
  for (const [brightness, contrast] of [[20, 50], [-100, 50], [0, 100]]) {
    const min = 127.5 - 127.5 / (contrast! / 50) - brightness!, max = 127.5 + 127.5 / (contrast! / 50) - brightness!
    const settings = { window: max - min, level: (max + min) / 2 }
    const png = displayBlock(source, settings), applied = levels(source, brightness!, contrast!)
    const rgba = rasterizeViewport(source, { zoom: 1, panX: 0, panY: 0, devicePixelRatio: 1, viewportWidth: 2, viewportHeight: 2 }, settings)
    assert.deepEqual(applied.shape, [3, 2, 2])
    assert.deepEqual([...png.data], [...applied.data])
    for (let pixel = 0; pixel < 4; pixel++) for (let channel = 0; channel < 3; channel++) assert.equal(rgba[pixel * 4 + channel], applied.data[channel * 4 + pixel])
  }
  assert.deepEqual([...levels(source, 20, 50).data], [30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140])
  assert.equal(source.data[0], 10)
})

test('RGB 16 位亮度处理保留三个通道与数据类型', () => {
  const source: ImageBlock = { ...rgbBlock(), dtype: 'uint16', data: Uint16Array.from([1000, 2000, 3000, 4000, 10000, 20000, 30000, 40000, 50000, 55000, 60000, 65000]) }
  const result = levels(source, 20, 50)
  assert.equal(result.dtype, 'uint16')
  assert.deepEqual(result.shape, [3, 2, 2])
  assert.ok(result.data[0]! > 1000)
  assert.ok(result.data[4]! > result.data[0]!)
  assert.equal(result.data[11], 65535)
})

test('RGB 亮度后再灰度与阈值沿用已处理结果，不重新读取原图', async () => {
  const imported = importMemory({ name: 'rgb', dtype: 'uint8', axes: ['c', 'y', 'x'], shape: [3, 2, 2], data: rgbBlock().data, componentKind: 'rgb' })
  const result = await new PureComputeEngine().runRecipe({ dataset: imported.dataset, storage: imported.storage, selection: {} }, createRecipe(imported.dataset.id, 0, [makeStep('levels', { brightness: 20, contrast: 50 }), makeStep('grayscale'), makeStep('threshold', { level: 65 })]))
  assert.ok(result.results.every((outcome) => outcome.status === 'ok'))
  assert.deepEqual([...result.image!.data], [255, 255, 255, 255])
})

test('RGB ROI 反相仅写回选区的三个通道，滤波和旋转保持彩色形状', async () => {
  const imported = importMemory({ name: 'rgb', dtype: 'uint8', axes: ['c', 'y', 'x'], shape: [3, 2, 2], data: rgbBlock().data, componentKind: 'rgb' })
  const engine = new PureComputeEngine(), context = { dataset: imported.dataset, storage: imported.storage, selection: {} }
  const recipe = createRecipe(imported.dataset.id, 0, [makeStep('invert', {}, { kind: 'frame', selection: {}, region: { start: [0, 0, 1], shape: [3, 1, 1] } })])
  const result = await engine.runRecipe(context, recipe)
  assert.deepEqual([...result.image!.data], [10, 235, 30, 40, 50, 195, 70, 80, 90, 155, 110, 120])
  const filtered = await engine.runRecipe(context, createRecipe(imported.dataset.id, 0, [makeStep('minimum3x3'), makeStep('rotateCW')]))
  assert.deepEqual(filtered.image!.shape, [3, 2, 2])
  assert.deepEqual([...filtered.image!.data], [10, 10, 10, 10, 50, 50, 50, 50, 90, 90, 90, 90])
})

test('彩色 Stack 的单帧亮度与整栈反相可组合且不串页', async () => {
  const imported = importMemory({ name: 'rgb-stack', dtype: 'uint8', axes: ['c', 'z', 'y', 'x'], shape: [3, 2, 1, 2], data: Uint8Array.from([10, 20, 11, 21, 50, 60, 51, 61, 90, 100, 91, 101]), componentKind: 'rgb' })
  const recipe = createRecipe(imported.dataset.id, 0, [makeStep('levels', { brightness: 20, contrast: 50 }, { kind: 'frame', selection: { z: 1 } }), makeStep('invert', {}, { kind: 'stack' })])
  const engine = new PureComputeEngine()
  for (const z of [0, 1]) {
    const result = await engine.runRecipe({ dataset: imported.dataset, storage: imported.storage, selection: { z } }, recipe)
    assert.deepEqual(result.image!.shape, [3, 1, 1, 2])
    assert.deepEqual([...result.image!.data], z === 0 ? [245, 235, 205, 195, 165, 155] : [224, 214, 184, 174, 144, 134])
  }
})

test('RGB 转灰度后连续滤波保持轴、尺寸与可导出的像素数一致', async () => {
  const imported = importMemory({
    name: 'rgb', dtype: 'uint8', axes: ['c', 'y', 'x'], shape: [3, 2, 2],
    data: rgbBlock().data, componentKind: 'rgb',
  })
  const result = await new PureComputeEngine().runRecipe(
    { dataset: imported.dataset, storage: imported.storage, selection: {} },
    createRecipe(imported.dataset.id, imported.dataset.revision, [
      makeStep('grayscale', {}), makeStep('minimum3x3', {}), makeStep('invert', {}),
    ]),
  )
  assert.ok(result.results.every((step) => step.status === 'ok'))
  assert.deepEqual(result.image!.axes, ['c', 'y', 'x'])
  assert.deepEqual(result.image!.shape, [1, 2, 2])
  assert.deepEqual([...result.image!.data], [205, 205, 205, 205])
  assert.equal(blockToRgba(result.image!, { window: 255, level: 127.5 }).length, 16)
})

test('RGB 栈转灰度、旋转后只保留当前切片的尺寸', async () => {
  const imported = importMemory({
    name: 'rgb-stack', dtype: 'uint8', axes: ['c', 'z', 'y', 'x'], shape: [3, 2, 1, 2],
    data: Uint8Array.from([10, 20, 11, 21, 50, 60, 51, 61, 90, 100, 91, 101]),
    componentKind: 'rgb',
  })
  const result = await new PureComputeEngine().runRecipe(
    { dataset: imported.dataset, storage: imported.storage, selection: { z: 1 } },
    createRecipe(imported.dataset.id, imported.dataset.revision, [
      makeStep('grayscale', {}), makeStep('rotateCW', {}), makeStep('invert', {}),
    ]),
  )
  assert.ok(result.results.every((step) => step.status === 'ok'))
  assert.deepEqual(result.image!.axes, ['c', 'z', 'y', 'x'])
  assert.deepEqual(result.image!.shape, [1, 1, 2, 1])
  assert.deepEqual([...result.image!.data], [204, 194])
})

/**
 * 16 位彩色（相机 / 天文导出的 16-bit RGB PNG）必须按原精度导入。
 *
 * 回归的是真实故障：ITK 报 `componentType: 'uint16'`、`components: 3`、数据为交织的
 * Uint16Array 时，导入层曾固定分配 Uint8Array，把每个样本截成低 8 位 —— 画面成为纯噪声，
 * 直方图也退化成 0..255 的均匀分布。
 */
test('16 位彩色按原精度导入为平面三通道，且显示映射不再截成低 8 位', async () => {
  // ITK 的 RGB 数据逐像素交织：第 1 行 (0,0)、(1,0)，第 2 行 (0,1)、(1,1)。
  const interleaved = Uint16Array.from([
    1000, 2000, 3000, 4000, 5000, 6000,
    7000, 8000, 9000, 10000, 11000, 12000,
  ])
  const image = {
    imageType: { dimension: 2, componentType: 'uint16', pixelType: 'RGB', components: 3 },
    size: [2, 2], spacing: [1, 1], origin: [0, 0], direction: new Float64Array([1, 0, 0, 1]),
    data: interleaved,
  } as unknown as ItkImage
  const imported = await importFile(
    new File([new Uint8Array(8)], 'stacked-16.png', { type: 'image/png' }),
    async () => image,
  )
  assert.equal(imported.dataset.dtype, 'uint16')
  assert.equal(imported.dataset.componentKind, 'rgb')
  assert.deepEqual(imported.dataset.axes, ['c', 'y', 'x'])
  assert.deepEqual([...imported.dataset.shape], [3, 2, 2])
  // 不得再出现「彩色图像按 uint8 载入」这类降位提示。
  assert.deepEqual(imported.warnings, [])

  const block = await imported.storage.readRegion({ start: [0, 0, 0], shape: [3, 2, 2] })
  assert.equal(block.dtype, 'uint16')
  // 交织 → 平面（R 平面、G 平面、B 平面）。
  assert.deepEqual([...block.data], [1000, 4000, 7000, 10000, 2000, 5000, 8000, 11000, 3000, 6000, 9000, 12000])

  const settings = { window: 65535, level: 32767.5 }
  const rgba = rasterizeViewport(block, { zoom: 1, panX: 0, panY: 0, devicePixelRatio: 1, viewportWidth: 2, viewportHeight: 2 }, settings)
  assert.deepEqual([...rgba.slice(0, 4)], [4, 8, 12, 255])
})
