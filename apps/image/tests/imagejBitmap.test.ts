import test from 'node:test'
import assert from 'node:assert/strict'
import { rgbaToPlanarRgb, canDecodeNativeBitmap } from '../src/imagej/engine/bitmap.ts'

test('RGBA 交织缓冲被转换为平面分离 RGB', () => {
  const rgba = Uint8ClampedArray.from([
    255, 0, 0, 255, // 红
    0, 255, 0, 255, // 绿
    0, 0, 255, 255, // 蓝
    128, 128, 128, 255, // 灰
  ])
  const image = rgbaToPlanarRgb(rgba, 4, 1)

  assert.equal(image.dtype, 'uint8')
  assert.deepEqual(image.axes, ['c', 'y', 'x'])
  assert.deepEqual(image.shape, [3, 1, 4])
  assert.equal(image.componentKind, 'rgb')
  // 平面顺序：R=[255,0,0,128]、G=[0,255,0,128]、B=[0,0,255,128]。
  assert.deepEqual([...image.data], [255, 0, 0, 128, 0, 255, 0, 128, 0, 0, 255, 128])
})

test('多行图像按 x 最快排布各通道平面', () => {
  const rgba = Uint8ClampedArray.from([
    1, 2, 3, 255, 4, 5, 6, 255,
    7, 8, 9, 255, 10, 11, 12, 255,
  ])
  const image = rgbaToPlanarRgb(rgba, 2, 2)

  assert.deepEqual(image.shape, [3, 2, 2])
  assert.deepEqual([...image.data], [1, 4, 7, 10, 2, 5, 8, 11, 3, 6, 9, 12])
})

test('原生位图能力探测返回布尔值', () => {
  assert.equal(typeof canDecodeNativeBitmap(), 'boolean')
})
