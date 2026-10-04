import test from 'node:test'
import assert from 'node:assert/strict'
import { GLYPH_HEIGHT, GLYPH_WIDTH, drawText, glyphScale, textHeight, textWidth } from '../src/imagej/engine/textRaster.ts'
import { formatSliceLabel, padWidthFor } from '../src/imagej/engine/sliceLabel.ts'
import { EngineHost } from '../src/imagej/engine/worker/host.ts'
import { encodeTiffStack } from '../src/imagej/engine/tiff.ts'
import { createRecipe } from '../src/imagej/engine/recipe.ts'
import type { ImageBlock, PixelArray } from '../src/imagej/engine/types.ts'

function page(width: number, height: number, planes = 1): { data: PixelArray; width: number; height: number; planes: number } {
  return { data: new Uint8Array(width * height * planes), width, height, planes }
}

/* ---------------- 文本光栅 ---------------- */

test('glyphScale 把字号换算成整数放大倍数', () => {
  assert.equal(glyphScale(5), 1)
  assert.equal(glyphScale(10), 2)
  assert.equal(glyphScale(11), 2)
  assert.equal(glyphScale(0), 1)
  assert.equal(glyphScale(Number.NaN), 1)
  assert.equal(textHeight(10), GLYPH_HEIGHT * 2)
})

test('textWidth 按字符数与放大倍数计算，字符之间只有一个字间距', () => {
  // 3 个字符：3×(3+1) − 1 = 11 个点阵像素。
  assert.equal(textWidth('000', 5), 11)
  assert.equal(textWidth('00', 10), 14)
  assert.equal(textWidth('', 5), 0)
})

test('drawText 逐像素写入前景值，并把未知字符画成问号', () => {
  const target = page(8, 5)
  drawText(target, '1', 0, 0, { fontSize: 5, color: 255 })
  // 字形 '1' 是第三列整条竖线。
  const data = Array.from(target.data as Uint8Array)
  for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
    assert.equal(data[row * 8 + (GLYPH_WIDTH - 1)], 255, `第 ${row} 行的第 3 列应被填充`)
    assert.equal(data[row * 8 + 0], 0)
  }
  // 未知字符与 '?' 的位图一致（只要有一个像素被填充即可说明走了兜底分支）。
  const unknown = page(8, 5)
  drawText(unknown, '\u4e2d', 0, 0, { fontSize: 5, color: 7 })
  const question = page(8, 5)
  drawText(question, '?', 0, 0, { fontSize: 5, color: 7 })
  assert.deepEqual(Array.from(unknown.data as Uint8Array), Array.from(question.data as Uint8Array))
})

test('drawText 裁剪越界并支持多平面', () => {
  const target = page(4, 4, 3)
  // 从 (3, 3) 开始画：只可能落到右上角一格。
  drawText(target, '8', 3, 3, { fontSize: 5, color: 9 })
  const data = target.data as Uint8Array
  // 三个平面都写了同样的字形。
  assert.equal(data[3 * 4 + 3], 9)
  assert.equal(data[16 + 3 * 4 + 3], 9)
  assert.equal(data[32 + 3 * 4 + 3], 9)
  // 越界不会写到别的行。
  assert.equal(data[2 * 4 + 3], 0)
})

/* ---------------- 标签文本 ---------------- */

test('formatSliceLabel 的六种格式', () => {
  const base = { index: 2, start: 1, interval: 1 }
  assert.equal(formatSliceLabel({ ...base, format: 'number' }), '3')
  assert.equal(formatSliceLabel({ ...base, format: 'number', text: 'um' }), '3 um')
  assert.equal(formatSliceLabel({ ...base, format: 'zero-padded', pad: 4 }), '0003')
  assert.equal(formatSliceLabel({ ...base, format: 'zero-padded', pad: 4, text: 'frame' }), 'frame 0003')
  assert.equal(formatSliceLabel({ ...base, format: 'mm:ss' }), '00:03')
  assert.equal(formatSliceLabel({ index: 61, start: 0, interval: 1, format: 'mm:ss' }), '01:01')
  assert.equal(formatSliceLabel({ index: 3661, start: 0, interval: 1, format: 'hh:mm:ss' }), '01:01:01')
  assert.equal(formatSliceLabel({ ...base, format: 'text', text: 'hello' }), 'hello')
  assert.equal(formatSliceLabel({ ...base, format: 'label', sliceLabel: 'z=3' }), 'z=3')
  assert.equal(formatSliceLabel({ ...base, format: 'label' }), '')
})

test('formatSliceLabel 按起始值与步长换算时间', () => {
  assert.equal(formatSliceLabel({ index: 0, start: 5, interval: 0.5, format: 'number', decimalPlaces: 1 }), '5.0')
  assert.equal(formatSliceLabel({ index: 3, start: 5, interval: 0.5, format: 'number', decimalPlaces: 1 }), '6.5')
  assert.equal(formatSliceLabel({ index: 4, start: 10, interval: 2, format: 'mm:ss' }), '00:18')
})

test('padWidthFor 取末帧序号的位数', () => {
  assert.equal(padWidthFor(9), 1)
  assert.equal(padWidthFor(12), 2)
  assert.equal(padWidthFor(120), 3)
  assert.equal(padWidthFor(0), 1)
})

/* ---------------- 引擎通路 ---------------- */

async function blankStackFile(pages: number, width: number, height: number): Promise<File> {
  const block = (): ImageBlock => ({
    dtype: 'uint8',
    axes: ['y', 'x'] as const,
    shape: [height, width],
    region: { start: [0, 0], shape: [height, width] },
    data: new Uint8Array(width * height),
  })
  const blocks = Array.from({ length: pages }, () => block())
  async function* frames() { for (const entry of blocks) yield entry }
  return new File([await encodeTiffStack(frames(), pages)], 'blank.tif')
}

async function readPage(host: EngineHost, datasetId: string, revision: number, page: number): Promise<number[]> {
  const result = await host.run({ datasetId, recipe: createRecipe(datasetId, revision), selection: { z: page } })
  return Array.from(result.image!.data as Uint8Array)
}

test('EngineHost.labelStack 把序号画进每页，范围外的页原样保留', async () => {
  const host = new EngineHost()
  const imported = await host.import(await blankStackFile(3, 8, 8))
  const labelled = await host.labelStack({
    datasetId: imported.dataset.id,
    format: 'number',
    start: 1,
    interval: 1,
    x: 0,
    y: 0,
    fontSize: 5,
    // 只标注第 1、2 页。
    from: 0,
    to: 1,
  })
  assert.ok(labelled)
  assert.deepEqual([...labelled.shape], [3, 8, 8])

  // '1' 是第三列整条竖线。
  const first = await readPage(host, labelled.id, labelled.revision, 0)
  assert.deepEqual(first.slice(0, 3), [0, 0, 255])
  assert.equal(first[8 + 0], 0)
  // '2' 的第一行是三条横线。
  const second = await readPage(host, labelled.id, labelled.revision, 1)
  assert.deepEqual(second.slice(0, 3), [255, 255, 255])
  // 范围外的第 3 页保持全 0。
  const third = await readPage(host, labelled.id, labelled.revision, 2)
  assert.deepEqual(third, new Array(64).fill(0))
})

test('EngineHost.labelStack 的 format=label 使用传入的页标签', async () => {
  const host = new EngineHost()
  const imported = await host.import(await blankStackFile(2, 16, 8))
  const labelled = await host.labelStack({
    datasetId: imported.dataset.id,
    format: 'label',
    x: 0,
    y: 0,
    fontSize: 5,
    sliceLabels: ['1', '2'],
  })
  assert.ok(labelled)
  const first = await readPage(host, labelled.id, labelled.revision, 0)
  assert.deepEqual(first.slice(0, 3), [0, 0, 255])
  const second = await readPage(host, labelled.id, labelled.revision, 1)
  assert.deepEqual(second.slice(0, 3), [255, 255, 255])
})
