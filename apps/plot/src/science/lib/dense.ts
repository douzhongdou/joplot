import type { DenseArray, NumericDType } from '../types.ts'

/** 从连续 Float64Array 构造一个 C-order 的 DenseArray。 */
export function createDense(data: Float64Array, shape?: readonly number[], dtype: NumericDType = 'float64'): DenseArray {
  const finalShape = shape ?? [data.length]
  const strides = new Array<number>(finalShape.length)
  let acc = 1
  for (let i = finalShape.length - 1; i >= 0; i -= 1) {
    strides[i] = acc
    acc *= finalShape[i]
  }

  return { dtype, shape: finalShape, strides, offset: 0, data }
}

export function denseLength(array: DenseArray): number {
  return array.shape.reduce((total, size) => total * size, 1)
}

export function isDenseContiguous(array: DenseArray): boolean {
  if (array.offset !== 0) {
    return false
  }

  let expected = 1
  for (let i = array.shape.length - 1; i >= 0; i -= 1) {
    if (array.strides[i] !== expected) {
      return false
    }
    expected *= array.shape[i]
  }

  return true
}

/** 一维零拷贝切片：共享同一 `data`，只改 shape/strides/offset。 */
export function slice1d(array: DenseArray, start: number, end: number): DenseArray {
  const length = array.shape[0] ?? 0
  const from = Math.max(0, Math.min(start, length))
  const to = Math.max(from, Math.min(end, length))
  const stride = array.strides[0] ?? 1

  return {
    ...array,
    shape: [to - from],
    strides: [stride],
    offset: array.offset + from * stride,
  }
}

/**
 * 把任意一维 view 取成可直接计算的 Float64Array。
 * stride 为 1 时返回零拷贝 subarray；否则显式 materialize（copy 是显式操作，不是失败）。
 */
export function values1d(array: DenseArray): Float64Array {
  const length = denseLength(array)
  const stride = array.strides[0] ?? 1

  if (stride === 1) {
    return array.data.subarray(array.offset, array.offset + length)
  }

  const out = new Float64Array(length)
  for (let i = 0; i < length; i += 1) {
    out[i] = array.data[array.offset + i * stride] ?? Number.NaN
  }
  return out
}
