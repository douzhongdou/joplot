import test from 'node:test'
import assert from 'node:assert/strict'
import { importMemory } from '../src/imagej/engine/importer.ts'
import { PureComputeEngine } from '../src/imagej/engine/compute/engine.ts'
import { createRecipe, makeStep } from '../src/imagej/engine/recipe.ts'
import { blockToRgba } from '../src/imagej/engine/render/rgba.ts'
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

test('RGB Dataset 上的逐像素算子给出明确不支持错误', async () => {
  const imported = importMemory({
    name: 'rgb', dtype: 'uint8', axes: ['c', 'y', 'x'], shape: [3, 1, 1],
    data: Uint8Array.from([1, 2, 3]),
    componentKind: 'rgb',
  })
  const engine = new PureComputeEngine()
  const result = await engine.runRecipe(
    { dataset: imported.dataset, storage: imported.storage, selection: {} },
    createRecipe(imported.dataset.id, imported.dataset.revision, [makeStep('invert', {})]),
  )
  assert.equal(result.results[0]!.status, 'error')
  assert.match(result.results[0]!.error ?? '', /多通道/)
})
