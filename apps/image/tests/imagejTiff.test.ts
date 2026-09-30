import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeTiff, encodeTiff } from '../src/imagej/lib/tiff.ts'
import { ImagejError, type GrayImage } from '../src/imagej/lib/processor.ts'

const first: GrayImage = { width: 2, height: 2, data: Uint8Array.from([0, 80, 160, 255]) }
const second: GrayImage = { width: 2, height: 2, data: Uint8Array.from([1, 2, 3, 4]) }

test('经典 TIFF 多页往返保持灰度像素和页顺序', () => {
  const encoded = encodeTiff([first, second])
  assert.equal(String.fromCharCode(encoded[0], encoded[1]), 'II')
  const pages = decodeTiff(encoded.buffer)
  assert.equal(pages.length, 2)
  assert.deepEqual(pages.map((page) => [...page.data]), [[0, 80, 160, 255], [1, 2, 3, 4]])
  assert.deepEqual(pages.map((page) => [page.width, page.height]), [[2, 2], [2, 2]])
})

test('拒绝错误头、压缩格式和不同尺寸的栈', () => {
  const encoded = encodeTiff([first])
  const corrupt = encoded.slice()
  corrupt[0] = 0
  assert.throws(() => decodeTiff(corrupt.buffer), ImagejError)
  const compression = encoded.slice()
  // 第 4 个 IFD 标签是 Compression，SHORT 值位于 entry + 8。
  new DataView(compression.buffer).setUint16(8 + 2 + 3 * 12 + 8, 5, true)
  assert.throws(() => decodeTiff(compression.buffer), /无压缩/)
  assert.throws(() => encodeTiff([first, { width: 1, height: 1, data: Uint8Array.of(1) }]), /尺寸一致/)
})

test('WhiteIsZero 灰度反转为内部 BlackIsZero 语义', () => {
  const encoded = encodeTiff([first]).slice()
  new DataView(encoded.buffer).setUint16(8 + 2 + 4 * 12 + 8, 0, true)
  assert.deepEqual([...decodeTiff(encoded.buffer)[0].data], [255, 175, 95, 0])
})
