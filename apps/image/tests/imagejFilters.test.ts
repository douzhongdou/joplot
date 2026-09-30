import test from 'node:test'
import assert from 'node:assert/strict'
import { gaussianBlur, maximum3x3, minimum3x3 } from '../src/imagej/lib/filters.ts'
import { ImagejError, type GrayImage } from '../src/imagej/lib/processor.ts'

const image = (width: number, values: number[]): GrayImage => ({ width, height: values.length / width, data: Uint8Array.from(values) })

test('高斯滤波保持常量图并让脉冲向邻域扩散', () => {
  const flat = image(3, new Array(9).fill(77))
  assert.deepEqual([...gaussianBlur(flat, 1).data], new Array(9).fill(77))
  const pulse = image(5, [0, 0, 255, 0, 0])
  const result = [...gaussianBlur(pulse, 1).data]
  assert.ok(result[2] < 255 && result[2] > result[1])
  assert.ok(result[1] > result[0] && result[0] > 0)
  assert.deepEqual(result, [...result].reverse())
  assert.deepEqual([...pulse.data], [0, 0, 255, 0, 0])
})

test('3×3 最小/最大秩滤波使用复制边界', () => {
  const source = image(3, [1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.deepEqual([...minimum3x3(source).data], [1, 1, 2, 1, 1, 2, 4, 4, 5])
  assert.deepEqual([...maximum3x3(source).data], [5, 6, 6, 8, 9, 9, 8, 9, 9])
})

test('高斯 sigma 范围校验', () => {
  const source = image(1, [1])
  assert.throws(() => gaussianBlur(source, 0), (error: unknown) => error instanceof ImagejError && error.code === 'invalid-value')
  assert.throws(() => gaussianBlur(source, 21), ImagejError)
})
