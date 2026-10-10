/**
 * 数值内核：算子的纯函数实现。全部只吃 Float64Array，便于 node --test 直接验证。
 */

import { buildWindow } from '../../superplot/lib/fft.ts'
import type { DetrendMode, WindowKind } from '../../superplot/types.ts'

export function detrendValues(values: Float64Array, mode: DetrendMode): Float64Array {
  const length = values.length
  const out = new Float64Array(length)

  if (mode === 'none' || length === 0) {
    out.set(values)
    return out
  }

  let sum = 0
  for (const value of values) sum += value
  const mean = sum / length

  if (mode === 'mean') {
    for (let i = 0; i < length; i += 1) out[i] = values[i] - mean
    return out
  }

  let sumX = 0
  let sumXY = 0
  for (let i = 0; i < length; i += 1) {
    sumX += i
    sumXY += i * values[i]
  }
  const meanX = sumX / length
  let numerator = 0
  let denominator = 0
  for (let i = 0; i < length; i += 1) {
    const dx = i - meanX
    numerator += dx * (values[i] - mean)
    denominator += dx * dx
  }
  const slope = denominator === 0 ? 0 : numerator / denominator
  const intercept = mean - slope * meanX

  for (let i = 0; i < length; i += 1) out[i] = values[i] - (intercept + slope * i)
  return out
}

export type MapFunction =
  | 'abs' | 'sqrt' | 'square' | 'ln' | 'log10' | 'exp' | 'negate' | 'reciprocal'

const MAP_FUNCTIONS: Record<MapFunction, (value: number) => number> = {
  abs: Math.abs,
  sqrt: (value) => Math.sqrt(value),
  square: (value) => value * value,
  ln: Math.log,
  log10: Math.log10,
  exp: Math.exp,
  negate: (value) => -value,
  reciprocal: (value) => 1 / value,
}

export const MAP_FUNCTION_NAMES = Object.keys(MAP_FUNCTIONS) as MapFunction[]

export function mapValues(values: Float64Array, fn: MapFunction): Float64Array {
  const transform = MAP_FUNCTIONS[fn] ?? ((value: number) => value)
  const out = new Float64Array(values.length)
  for (let i = 0; i < values.length; i += 1) out[i] = transform(values[i])
  return out
}

export function linearTransform(values: Float64Array, a: number, b: number): Float64Array {
  const out = new Float64Array(values.length)
  for (let i = 0; i < values.length; i += 1) out[i] = a * values[i] + b
  return out
}

export type NormalizeMode = 'zscore' | 'minmax' | 'peak'

export function normalizeValues(values: Float64Array, mode: NormalizeMode): Float64Array {
  const out = new Float64Array(values.length)
  let mean = 0
  let count = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let maxAbs = 0

  for (const value of values) {
    if (!Number.isFinite(value)) continue
    mean += value
    count += 1
    if (value < min) min = value
    if (value > max) max = value
    if (Math.abs(value) > maxAbs) maxAbs = Math.abs(value)
  }

  if (count === 0) {
    out.set(values)
    return out
  }

  mean /= count

  if (mode === 'zscore') {
    let variance = 0
    for (const value of values) {
      if (!Number.isFinite(value)) continue
      const delta = value - mean
      variance += delta * delta
    }
    const std = Math.sqrt(variance / count) || 1
    for (let i = 0; i < values.length; i += 1) out[i] = (values[i] - mean) / std
    return out
  }

  if (mode === 'minmax') {
    const span = max - min || 1
    for (let i = 0; i < values.length; i += 1) out[i] = (values[i] - min) / span
    return out
  }

  const reference = maxAbs || 1
  for (let i = 0; i < values.length; i += 1) out[i] = values[i] / reference
  return out
}

export function clipValues(values: Float64Array, min: number, max: number): Float64Array {
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  const out = new Float64Array(values.length)
  for (let i = 0; i < values.length; i += 1) {
    out[i] = Math.min(high, Math.max(low, values[i]))
  }
  return out
}

/** 中心差分，端点用单侧差分；按 x 的实际间距换算。 */
export function differentiate(x: Float64Array, y: Float64Array): Float64Array {
  const length = y.length
  const out = new Float64Array(length)
  if (length < 2) {
    return out
  }

  for (let i = 0; i < length; i += 1) {
    const left = Math.max(0, i - 1)
    const right = Math.min(length - 1, i + 1)
    const dx = x[right] - x[left]
    out[i] = dx === 0 ? 0 : (y[right] - y[left]) / dx
  }

  return out
}

/** 累积梯形积分，起点为 0。 */
export function integrate(x: Float64Array, y: Float64Array): Float64Array {
  const length = y.length
  const out = new Float64Array(length)
  for (let i = 1; i < length; i += 1) {
    out[i] = out[i - 1] + 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1])
  }
  return out
}

export type MovingStat = 'mean' | 'std' | 'rms' | 'min' | 'max' | 'median'

export function movingStat(values: Float64Array, window: number, stat: MovingStat): Float64Array {
  const length = values.length
  const size = Math.max(1, Math.floor(window))
  const half = Math.floor(size / 2)
  const out = new Float64Array(length)

  if (size <= 1) {
    out.set(values)
    return out
  }

  for (let i = 0; i < length; i += 1) {
    const start = Math.max(0, i - half)
    const end = Math.min(length, i + half + 1)
    const count = end - start

    if (stat === 'median') {
      const buffer = Array.from(values.subarray(start, end)).sort((a, b) => a - b)
      const middle = Math.floor(buffer.length / 2)
      out[i] = buffer.length % 2 === 0 ? (buffer[middle - 1] + buffer[middle]) / 2 : buffer[middle]
      continue
    }

    if (stat === 'min') {
      let result = Number.POSITIVE_INFINITY
      for (let k = start; k < end; k += 1) result = Math.min(result, values[k])
      out[i] = result
      continue
    }

    if (stat === 'max') {
      let result = Number.NEGATIVE_INFINITY
      for (let k = start; k < end; k += 1) result = Math.max(result, values[k])
      out[i] = result
      continue
    }

    let sum = 0
    for (let k = start; k < end; k += 1) sum += values[k]
    const mean = sum / count

    if (stat === 'mean') {
      out[i] = mean
      continue
    }

    if (stat === 'rms') {
      let squares = 0
      for (let k = start; k < end; k += 1) squares += values[k] * values[k]
      out[i] = Math.sqrt(squares / count)
      continue
    }

    let variance = 0
    for (let k = start; k < end; k += 1) {
      const delta = values[k] - mean
      variance += delta * delta
    }
    out[i] = Math.sqrt(variance / count)
  }

  return out
}

export function gaussianSmooth(values: Float64Array, sigma: number): Float64Array {
  const length = values.length
  const out = new Float64Array(length)
  const spread = Math.max(0.1, sigma)
  const radius = Math.max(1, Math.ceil(3 * spread))
  const kernel = new Float64Array(2 * radius + 1)
  let sum = 0

  for (let k = -radius; k <= radius; k += 1) {
    const weight = Math.exp(-(k * k) / (2 * spread * spread))
    kernel[k + radius] = weight
    sum += weight
  }
  for (let k = 0; k < kernel.length; k += 1) kernel[k] /= sum

  for (let i = 0; i < length; i += 1) {
    let acc = 0
    for (let k = -radius; k <= radius; k += 1) {
      const index = Math.min(length - 1, Math.max(0, i + k))
      acc += kernel[k + radius] * values[index]
    }
    out[i] = acc
  }

  return out
}

export function applyWindow(values: Float64Array, kind: WindowKind): Float64Array {
  const window = buildWindow(kind, values.length)
  const out = new Float64Array(values.length)
  for (let i = 0; i < values.length; i += 1) out[i] = values[i] * window[i]
  return out
}
