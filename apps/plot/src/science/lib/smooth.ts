/**
 * 平滑：移动平均与 Savitzky-Golay。
 *
 * SG 系数由正规方程 (AᵀA)⁻¹Aᵀ 的第 0 行推出（窗口内多项式拟合在中心点的取值），
 * 通过高斯-约当求逆实现，支持 order ≤ 4。
 */

import { invertMatrix } from './linalg.ts'

export function movingAverage(values: Float64Array, window: number): Float64Array {
  const length = values.length
  const size = Math.max(1, Math.floor(window))
  const out = new Float64Array(length)

  if (size <= 1) {
    out.set(values)
    return out
  }

  const half = Math.floor(size / 2)
  const prefix = new Float64Array(length + 1)
  for (let i = 0; i < length; i += 1) {
    prefix[i + 1] = prefix[i] + values[i]
  }

  for (let i = 0; i < length; i += 1) {
    const start = Math.max(0, i - half)
    const end = Math.min(length, i + half + 1)
    out[i] = (prefix[end] - prefix[start]) / (end - start)
  }

  return out
}

export function savitzkyGolayCoefficients(window: number, order: number): Float64Array {
  const size = Math.max(3, Math.floor(window) % 2 === 0 ? Math.floor(window) + 1 : Math.floor(window))
  const polynomial = Math.max(0, Math.min(Math.floor(order), size - 2, 4))
  const half = (size - 1) / 2

  const dimension = polynomial + 1
  const normal: number[][] = Array.from({ length: dimension }, () =>
    new Array<number>(dimension).fill(0),
  )

  for (let a = 0; a < dimension; a += 1) {
    for (let b = 0; b < dimension; b += 1) {
      let sum = 0
      for (let i = -half; i <= half; i += 1) {
        sum += i ** (a + b)
      }
      normal[a][b] = sum
    }
  }

  const inverse = invertMatrix(normal)
  const coefficients = new Float64Array(size)

  for (let i = -half; i <= half; i += 1) {
    let sum = 0
    for (let j = 0; j < dimension; j += 1) {
      sum += inverse[0][j] * i ** j
    }
    coefficients[i + half] = sum
  }

  return coefficients
}

export function savitzkyGolay(values: Float64Array, window: number, order: number): Float64Array {
  const length = values.length
  const coefficients = savitzkyGolayCoefficients(window, order)
  const half = (coefficients.length - 1) / 2
  const out = new Float64Array(length)

  for (let i = 0; i < length; i += 1) {
    let acc = 0
    for (let k = -half; k <= half; k += 1) {
      const index = Math.min(length - 1, Math.max(0, i + k))
      acc += coefficients[k + half] * values[index]
    }
    out[i] = acc
  }

  return out
}
