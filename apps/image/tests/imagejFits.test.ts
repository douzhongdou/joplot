import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeFitsFile, fitsDecodePlan, fitsLayout } from '../src/imagej/engine/fits/source.ts'
import { indexFits, isImageHdu } from '../src/imagej/engine/fits/index.ts'
import { FitsHeader, parseFitsCard } from '../src/imagej/engine/fits/header.ts'
import { importFile } from '../src/imagej/engine/importer.ts'
import { fullRegion } from '../src/imagej/engine/storage.ts'
import { buildFitsBytes, beInt16, beInt32, beFloat32, fitsCard } from './helpers/fitsBuilder.ts'

const blobOf = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes])

test('BITPIX=16 + BZERO=32768 按无符号 uint16 读出大端样本', async () => {
  const bytes = buildFitsBytes([
    { bitpix: 16, naxis: [4, 1], data: beInt16([-32768, -1, 0, 32767]), cards: [fitsCard('BZERO', 32768)] },
  ])
  const decoded = await decodeFitsFile(blobOf(bytes))

  assert.equal(decoded.dtype, 'uint16')
  assert.deepEqual(decoded.axes, ['y', 'x'])
  assert.deepEqual(decoded.shape, [1, 4])
  assert.deepEqual([...decoded.data], [0, 32767, 32768, 65535])
})

test('BITPIX=16 默认按有符号 int16 读出', async () => {
  const bytes = buildFitsBytes([{ bitpix: 16, naxis: [4, 1], data: beInt16([-32768, -1, 0, 32767]) }])
  const decoded = await decodeFitsFile(blobOf(bytes))

  assert.equal(decoded.dtype, 'int16')
  assert.deepEqual([...decoded.data], [-32768, -1, 0, 32767])
})

test('BITPIX=-32 保留 float32 且不产生精度警告', async () => {
  const bytes = buildFitsBytes([{ bitpix: -32, naxis: [3, 1], data: beFloat32([0, 1.5, -2.25]) }])
  const decoded = await decodeFitsFile(blobOf(bytes))

  assert.equal(decoded.dtype, 'float32')
  assert.deepEqual([...decoded.data], [0, 1.5, -2.25])
  assert.equal(decoded.warnings.some((warning) => /精度/.test(warning)), false)
})

test('BITPIX=32 转为 float32 并提示', async () => {
  const bytes = buildFitsBytes([{ bitpix: 32, naxis: [3, 1], data: beInt32([0, -1, 2147483647]) }])
  const decoded = await decodeFitsFile(blobOf(bytes))

  assert.equal(decoded.dtype, 'float32')
  // 2147483647 在 float32 下舍入为 2147483648。
  assert.deepEqual([...decoded.data].slice(0, 2), [0, -1])
  assert.match(decoded.warnings.join('\n'), /BITPIX=32/)
})

test('BSCALE / BZERO 应用到浮点，物理值 = offset + scale × raw', async () => {
  const bytes = buildFitsBytes([
    { bitpix: 16, naxis: [3, 1], data: beInt16([0, 1, 2]), cards: [fitsCard('BSCALE', 2), fitsCard('BZERO', 1)] },
  ])
  const decoded = await decodeFitsFile(blobOf(bytes))

  assert.equal(decoded.dtype, 'float32')
  assert.deepEqual([...decoded.data], [1, 3, 5])
  assert.match(decoded.warnings.join('\n'), /BZERO=1、BSCALE=2/)
})

test('BITPIX=8 + BZERO=128 按无符号 uint8 读出（有符号字节存储）', async () => {
  const raw = Uint8Array.from([0x80, 0xff, 0x00, 0x7f].map((v) => v & 0xff))
  const bytes = buildFitsBytes([{ bitpix: 8, naxis: [4, 1], data: raw, cards: [fitsCard('BZERO', 128)] }])
  const decoded = await decodeFitsFile(blobOf(bytes))

  assert.equal(decoded.dtype, 'uint8')
  assert.deepEqual([...decoded.data], [0, 127, 128, 255])
})

test('NAXIS=3 的立方体映射到 z 轴', async () => {
  const data = beInt16(Array.from({ length: 12 }, (_, i) => i))
  const bytes = buildFitsBytes([{ bitpix: 16, naxis: [2, 2, 3], data }])
  const decoded = await decodeFitsFile(blobOf(bytes))

  assert.deepEqual(decoded.axes, ['z', 'y', 'x'])
  assert.deepEqual(decoded.shape, [3, 2, 2])
  assert.deepEqual([...decoded.data], Array.from({ length: 12 }, (_, i) => i))
  assert.match(decoded.warnings.join('\n'), /z 轴/)
})

test('NAXIS=1 的光谱映射为 1×N 的 y/x', async () => {
  const bytes = buildFitsBytes([{ bitpix: 16, naxis: [5], data: beInt16([1, 2, 3, 4, 5]) }])
  const decoded = await decodeFitsFile(blobOf(bytes))

  assert.deepEqual(decoded.axes, ['y', 'x'])
  assert.deepEqual(decoded.shape, [1, 5])
  assert.deepEqual([...decoded.data], [1, 2, 3, 4, 5])
})

test('跳过无数据的 primary HDU，载入扩展图像 HDU', async () => {
  const bytes = buildFitsBytes([
    { bitpix: 8, naxis: [] },
    { bitpix: 16, naxis: [2, 2], data: beInt16([10, 20, 30, 40]), xtension: 'IMAGE', simple: false },
  ])
  const index = await indexFits(blobOf(bytes))
  assert.equal(index.hdus.length, 2)
  assert.equal(isImageHdu(index.hdus[0]!), false)
  assert.equal(index.imageHdus.length, 1)

  const decoded = await decodeFitsFile(blobOf(bytes))
  assert.deepEqual([...decoded.data], [10, 20, 30, 40])
})

test('多个图像 HDU 时载入第一个并给出提示', async () => {
  const bytes = buildFitsBytes([
    { bitpix: 16, naxis: [1, 1], data: beInt16([7]) },
    { bitpix: 16, naxis: [1, 1], data: beInt16([8]), xtension: 'IMAGE', simple: false },
  ])
  const decoded = await decodeFitsFile(blobOf(bytes))

  assert.deepEqual([...decoded.data], [7])
  assert.match(decoded.warnings.join('\n'), /2 个图像 HDU/)
})

test('头部解析：字符串、转义单引号、数字、逻辑与注释', () => {
  const text = parseFitsCard(fitsCard('OBJECT', "M 31's core", 'target'))!
  assert.equal(text.keyword, 'OBJECT')
  assert.equal(text.value, "M 31's core")
  assert.equal(text.comment, 'target')

  assert.equal(parseFitsCard(fitsCard('EXPTIME', 12.5))!.value, 12.5)
  assert.equal(parseFitsCard(fitsCard('EXTEND', true))!.value, true)
  assert.equal(parseFitsCard(fitsCard('COMMENT', undefined, 'hello world'))!.comment, 'hello world')
})

test('截断的数据段被明确拒绝', async () => {
  const bytes = buildFitsBytes([{ bitpix: 16, naxis: [4, 1], data: beInt16([1, 2, 3, 4]) }])
  // 只保留头部与 2 字节数据。
  const truncated = bytes.slice(0, 2880 + 2)
  await assert.rejects(() => decodeFitsFile(blobOf(truncated)), /不完整|截断/)
})

test('缺少 END 的头部被拒绝', async () => {
  const bytes = new Uint8Array(2880).fill(0x20)
  await assert.rejects(() => indexFits(blobOf(bytes)), /不完整|过长|有效/)
})

test('经 importFile 导入后 dataset 标注为 fits 且像素正确', async () => {
  const bytes = buildFitsBytes([{ bitpix: 16, naxis: [2, 2], data: beInt16([1, 2, 3, 4]), cards: [fitsCard('BZERO', 32768)] }])
  const file = new File([bytes], 'galaxy.fits')
  const { dataset, storage } = await importFile(file)

  assert.equal(dataset.source.format, 'fits')
  assert.equal(dataset.dtype, 'uint16')
  assert.deepEqual(dataset.axes, ['y', 'x'])
  assert.deepEqual(dataset.shape, [2, 2])

  const block = await storage.readRegion(fullRegion(dataset.shape))
  assert.deepEqual([...block.data], [32769, 32770, 32771, 32772])
})

test('fitsLayout / fitsDecodePlan 的映射可独立断言', () => {
  const plan = fitsDecodePlan({ bitpix: 16, axes: [2, 2], header: headerOf([fitsCard('BSCALE', 1), fitsCard('BZERO', 0)]) } as never)
  assert.equal(plan.dtype, 'int16')
  assert.equal(plan.kind, 'i16')

  const layout = fitsLayout({ axes: [4, 3] } as never)
  assert.deepEqual(layout, { axes: ['y', 'x'], shape: [3, 4] })
})

/** 供底层断言构造最小 header。 */
function headerOf(cards: readonly string[]) {
  return new FitsHeader(cards.map((card) => parseFitsCard(card)!))
}
