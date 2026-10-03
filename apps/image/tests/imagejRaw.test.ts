import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { decodeRawFile } from '../src/imagej/engine/raw/index.ts'
import { demosaic, demosaicToDtype, cfaColorAt, patternName } from '../src/imagej/engine/debayer.ts'
import { importFile } from '../src/imagej/engine/importer.ts'
import { writeTiff, cfaEntries, imageEntries, int16LE } from './helpers/dngBuilder.ts'

const blobOf = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes])

test('主 IFD 即 CFA 的 DNG：读出 uint16 马赛克灰度与图案', async () => {
  const values = Array.from({ length: 16 }, (_, i) => 100 + i)
  const entries = [...imageEntries(4, 4, 16), ...cfaEntries([0, 1, 1, 2])]
  const bytes = writeTiff([{ entries, pixels: int16LE(values) }])

  const { decoded, metadata } = await decodeRawFile(blobOf(bytes))
  assert.equal(decoded.dtype, 'uint16')
  assert.deepEqual(decoded.axes, ['y', 'x'])
  assert.deepEqual(decoded.shape, [4, 4])
  assert.equal(decoded.componentKind, 'scalar')
  assert.equal(metadata.cfaPattern, 'rggb')
  assert.deepEqual([...decoded.data], values)
})

test('存在预览页与 SubIFD 时优先选 CFA 数据页', async () => {
  const cfaValues = Array.from({ length: 16 }, (_, i) => i)
  // IFD0：1×1 8 位预览；SubIFD[0]：4×4 16 位 CFA（BGGR）。
  const preview = imageEntries(1, 1, 8)
  const bytes = writeTiff([
    { entries: preview, pixels: Uint8Array.from([128]), subIfds: [1] },
    { entries: [...imageEntries(4, 4, 16), ...cfaEntries([2, 1, 1, 0])], pixels: int16LE(cfaValues) },
  ])

  const { decoded, metadata } = await decodeRawFile(blobOf(bytes))
  assert.equal(metadata.cfaPattern, 'bggr')
  assert.deepEqual(decoded.shape, [4, 4])
  assert.deepEqual([...decoded.data], cfaValues)
})

test('Deflate 压缩 + Predictor=2 的 CFA 数据被正确解压与反预测', async () => {
  const width = 4
  const height = 2
  const values = [10, 20, 30, 40, 50, 60, 70, 80]
  // 水平差分：每行首样本保持，其余为与前一样本之差。
  const diff: number[] = []
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col
      diff.push(col === 0 ? values[index]! : (values[index]! - values[index - 1]!) & 0xffff)
    }
  }
  const compressed = new Uint8Array(deflateSync(Buffer.from(int16LE(diff))))
  const entries = [
    ...imageEntries(width, height, 16, 8),
    { tag: 317, type: 3, values: [2] },
    ...cfaEntries([0, 1, 1, 2]),
  ]
  const bytes = writeTiff([{ entries, pixels: compressed }])

  const { decoded } = await decodeRawFile(blobOf(bytes))
  assert.equal(decoded.dtype, 'uint16')
  assert.deepEqual([...decoded.data], values)
})

test('非 TIFF 数据被明确拒绝', async () => {
  await assert.rejects(() => decodeRawFile(blobOf(Uint8Array.from([1, 2, 3, 4]))), /TIFF|文件/)
})

test('经 importFile 导入后 dataset 标注为 raw 并携带 CFA 图案', async () => {
  const values = Array.from({ length: 16 }, (_, i) => 200 + i)
  const entries = [...imageEntries(4, 4, 16), ...cfaEntries([0, 1, 1, 2])]
  const file = new File([writeTiff([{ entries, pixels: int16LE(values) }])], 'shot.dng')

  const { dataset } = await importFile(file)
  assert.equal(dataset.source.format, 'raw')
  assert.equal(dataset.dtype, 'uint16')
  assert.deepEqual(dataset.shape, [4, 4])
  assert.equal(dataset.channels[0]?.name, 'CFA')
  assert.equal(dataset.metadata?.cfaPattern, 'rggb')
})

test('双线性去马赛克对恒定颜色精确还原', () => {
  const width = 6
  const height = 6
  const [r, g, b] = [100, 150, 200]
  const cfa = new Uint16Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = cfaColorAt('rggb', y, x)
      cfa[y * width + x] = color === 0 ? r : color === 1 ? g : b
    }
  }
  const out = demosaic(cfa, width, height, { pattern: 'rggb', algorithm: 'bilinear' })
  const pixels = width * height
  for (let i = 0; i < pixels; i += 1) {
    assert.equal(out[i], r, `R @${i}`)
    assert.equal(out[pixels + i], g, `G @${i}`)
    assert.equal(out[2 * pixels + i], b, `B @${i}`)
  }
})

test('Malvar 去马赛克对恒定灰度精确还原', () => {
  const width = 6
  const height = 6
  const cfa = new Uint16Array(width * height).fill(120)
  const out = demosaic(cfa, width, height, { pattern: 'bggr', algorithm: 'malvar' })
  const pixels = width * height
  for (let i = 0; i < out.length; i += 1) assert.equal(out[i], 120)
  assert.equal(out.length, pixels * 3)
})

test('demosaicToDtype 按目标 dtype 夹取', () => {
  const cfa = new Uint16Array(8 * 8).fill(300)
  const out = demosaicToDtype(cfa, 8, 8, 'uint16', { pattern: 'rggb', algorithm: 'bilinear' })
  assert.equal(out.length, 8 * 8 * 3)
  assert.equal([...out].every((value) => value === 300), true)

  const clamped = demosaicToDtype(new Uint16Array(8 * 8).fill(300), 8, 8, 'uint8', { pattern: 'rggb', algorithm: 'bilinear' })
  assert.equal([...clamped].every((value) => value === 255), true)
})

test('滤镜序列名与图案编码互相对应', () => {
  assert.equal(patternName([0, 1, 1, 2]), 'rggb')
  assert.equal(patternName([2, 1, 1, 0]), 'bggr')
  assert.equal(patternName([1, 0, 2, 1]), 'grbg')
  assert.equal(patternName([1, 2, 0, 1]), 'gbrg')
  assert.equal(patternName([0, 1, 1, 3]), undefined)
  assert.equal(cfaColorAt('rggb', 0, 0), 0)
  assert.equal(cfaColorAt('rggb', 0, 1), 1)
  assert.equal(cfaColorAt('rggb', 1, 1), 2)
})
