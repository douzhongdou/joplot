import test from 'node:test'
import assert from 'node:assert/strict'
import { TiffPageSource, PHOTOMETRIC_RGB } from '../src/imagej/engine/tiff/source.ts'
import { encodeTiffStack } from '../src/imagej/engine/tiff.ts'
import type { ImageBlock } from '../src/imagej/engine/types.ts'
import { buildTiffBytes, uint16Pixels } from './helpers/tiffBuilder.ts'

const open = async (bytes: Uint8Array<ArrayBuffer>) => TiffPageSource.open(new Blob([bytes]))

async function* toFrames(blocks: ImageBlock[]) {
  for (const block of blocks) yield block
}

function grayBlock(values: readonly number[], width: number, height: number): ImageBlock {
  const data = new Uint16Array(values)
  return { dtype: 'uint16', axes: ['y', 'x'], shape: [height, width], region: { start: [0, 0], shape: [height, width] }, data }
}

test('与本项目写出器往返一致：灰度多页', async () => {
  const pages = [
    grayBlock([0, 1, 2, 3, 65535, 400, 500, 600], 4, 2),
    grayBlock([9, 8, 7, 6, 5, 4, 3, 2], 4, 2),
  ]
  const blob = await encodeTiffStack(toFrames(pages), pages.length)
  const reader = await TiffPageSource.open(blob)

  assert.equal(reader.pageCount, 2)
  for (const [i, page] of pages.entries()) {
    const frame = await reader.readPage(i)
    assert.equal(frame.block.dtype, 'uint16')
    assert.deepEqual(frame.block.axes, ['y', 'x'])
    assert.deepEqual(frame.block.shape, [2, 4])
    assert.deepEqual([...frame.block.data], [...page.data], `第 ${i} 页像素不一致`)
  }
})

test('与本项目写出器往返一致：RGB 的 c 轴为平面分离', async () => {
  const data = new Uint8Array([
    255, 0, 0, 0, 255, 0, 0, 0, 255, 128, 128, 128,
  ])
  const block: ImageBlock = {
    dtype: 'uint8', axes: ['c', 'y', 'x'], shape: [3, 1, 4],
    region: { start: [0, 0, 0], shape: [3, 1, 4] }, data,
  }
  const blob = await encodeTiffStack(toFrames([block]), 1)
  const frame = await (await TiffPageSource.open(blob)).readPage(0)

  assert.deepEqual(frame.block.axes, ['c', 'y', 'x'])
  assert.deepEqual(frame.block.shape, [3, 1, 4])
  // 写出的即是平面分离，读回应保持一致。
  assert.deepEqual([...frame.block.data], [...data])
})

test('多条带按各自行坐标放置，末条带不足整高时仍落在正确的行', async () => {
  // 4 行 × 2 列，每条带 2 行 => 第二条带只覆盖第 2、3 行。
  const values = [0, 1, 2, 3, 4, 5, 6, 7]
  const { bytes } = buildTiffBytes([
    { width: 2, height: 4, bits: 16, rowsPerStrip: 2, pixels: uint16Pixels(values) },
  ])
  const frame = await (await open(bytes)).readPage(0)

  assert.equal(frame.segmentCount, 2)
  assert.deepEqual([...frame.block.data], values)
  assert.deepEqual(frame.block.shape, [4, 2])
})

test('每行一条带时行序依然正确', async () => {
  const values = [10, 11, 20, 21, 30, 31]
  const { bytes } = buildTiffBytes([
    { width: 2, height: 3, bits: 16, rowsPerStrip: 1, pixels: uint16Pixels(values) },
  ])
  const frame = await (await open(bytes)).readPage(0)
  assert.equal(frame.segmentCount, 3)
  assert.deepEqual([...frame.block.data], values)
})

test('大端 TIFF 的 16 位样本被正确解释', async () => {
  const values = [1, 256, 65535, 42, 513, 1024]
  const { bytes } = buildTiffBytes(
    [{ width: 6, height: 1, bits: 16, pixels: uint16Pixels(values, false) }],
    { bigEndian: true },
  )
  // 文件头应标记为大端。
  assert.equal(String.fromCharCode(bytes[0]!, bytes[1]!), 'MM')
  const reader = await open(bytes)
  assert.equal(reader.index.littleEndian, false)
  const frame = await reader.readPage(0)
  assert.equal(frame.block.dtype, 'uint16')
  assert.deepEqual([...frame.block.data], values)
})

test('TIFF 像素交织的 RGB 被转为平面分离', async () => {
  // 2 像素：红、绿（文件内为 R,G,B,R,G,B 交织）。
  const pixels = Uint8Array.from([255, 0, 0, 0, 255, 0])
  const { bytes } = buildTiffBytes([{ width: 2, height: 1, bits: 8, components: 3, pixels }])
  const frame = await (await open(bytes)).readPage(0)

  assert.equal(frame.photometric, PHOTOMETRIC_RGB)
  assert.deepEqual(frame.block.axes, ['c', 'y', 'x'])
  assert.deepEqual(frame.block.shape, [3, 1, 2])
  // 平面分离后依次为 R=[255,0]、G=[0,255]、B=[0,0]。
  assert.deepEqual([...frame.block.data], [255, 0, 0, 255, 0, 0])
})

test('8 位、有符号 16 位与浮点的 dtype 映射', async () => {
  const gray8 = Uint8Array.from([0, 128, 255, 7])
  const frame8 = await (await open(buildTiffBytes([{ width: 4, height: 1, bits: 8, pixels: gray8 }]).bytes)).readPage(0)
  assert.equal(frame8.block.dtype, 'uint8')
  assert.deepEqual([...frame8.block.data], [...gray8])

  const signed = new Uint8Array(8)   // 4 个 int16
  const signedView = new DataView(signed.buffer)
  ;[-32768, -1, 0, 32767].forEach((value, i) => signedView.setInt16(i * 2, value, true))
  const frame16 = await (await open(buildTiffBytes([
    { width: 4, height: 1, bits: 16, sampleFormat: 2, pixels: signed },
  ]).bytes)).readPage(0)
  assert.equal(frame16.block.dtype, 'int16')
  assert.deepEqual([...frame16.block.data], [-32768, -1, 0, 32767])

  const floats = new Uint8Array(16)  // 4 个 float32
  const floatView = new DataView(floats.buffer)
  ;[0, 1.5, -2.25, 1024].forEach((value, i) => floatView.setFloat32(i * 4, value, true))
  const frameF = await (await open(buildTiffBytes([
    { width: 4, height: 1, bits: 32, sampleFormat: 3, pixels: floats },
  ]).bytes)).readPage(0)
  assert.equal(frameF.block.dtype, 'float32')
  assert.deepEqual([...frameF.block.data], [0, 1.5, -2.25, 1024])
})

test('压缩页被明确拒绝，而不是产出错误像素', async () => {
  const { bytes } = buildTiffBytes([{ width: 2, height: 2, bits: 16, compression: 5 }])
  const reader = await open(bytes)

  assert.equal(reader.canRead(0), false)
  const problems = reader.unsupportedPages()
  assert.equal(problems.length, 1)
  assert.match(problems[0]!.reason, /Compression=5/)
  await assert.rejects(() => reader.readPage(0), /解压暂未实现/)
})

test('不受支持的位深被明确拒绝', async () => {
  // 12 位整数不在支持范围。
  const { bytes } = buildTiffBytes([{ width: 2, height: 2, bits: 8, sampleFormat: 2 }])
  const reader = await open(bytes)
  assert.equal(reader.canRead(0), false)
  assert.match(reader.unsupportedPages()[0]!.reason, /SampleFormat=2/)
})

test('页码越界与可读性判断', async () => {
  const { bytes } = buildTiffBytes([
    { width: 2, height: 2, bits: 16 },
    { width: 2, height: 2, bits: 16 },
  ])
  const reader = await open(bytes)
  assert.equal(reader.pageCount, 2)
  assert.equal(reader.canRead(0), true)
  assert.deepEqual(reader.unsupportedPages(), [])
  assert.equal(reader.maxPageByteLength, 2 * 2 * 2)
  await assert.rejects(() => reader.readPage(2), /out of range/)
  await assert.rejects(() => reader.readPage(-1), /out of range/)
})

test('BigTIFF 的页可读出且只触碰该页字节', async () => {
  const first = [1, 2, 3, 4]
  const second = [5, 6, 7, 8]
  const { bytes } = buildTiffBytes(
    [
      { width: 2, height: 2, bits: 16, pixels: uint16Pixels(first) },
      { width: 2, height: 2, bits: 16, pixels: uint16Pixels(second) },
    ],
    { big: true },
  )
  const reader = await open(bytes)
  assert.equal(reader.index.big, true)
  assert.deepEqual([...(await reader.readPage(0)).block.data], first)
  assert.deepEqual([...(await reader.readPage(1)).block.data], second)
})

test('页与页独立，不会互相污染', async () => {
  const pages = [
    grayBlock([1, 1, 1, 1], 2, 2),
    grayBlock([2, 2, 2, 2], 2, 2),
    grayBlock([3, 3, 3, 3], 2, 2),
  ]
  const reader = await TiffPageSource.open(await encodeTiffStack(toFrames(pages), pages.length))
  for (const [i, expected] of [1, 2, 3].entries()) {
    assert.deepEqual([...(await reader.readPage(i)).block.data], new Array(4).fill(expected))
  }
})