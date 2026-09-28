/**
 * 预览下沉：大数组留在 Worker，主线程只拿降采样后的副本用于绘图。
 * 小数据（≤ target）原样返回，行为与之前完全一致。
 */

import type { ScienceValue } from '../types.ts'
import { createDense, values1d } from '../lib/dense.ts'
import { downsamplePoints, minMaxEnvelope } from '../../superplot/lib/downsample.ts'

import { DEFAULT_PREVIEW_TARGET } from './protocol.ts'

export interface PreviewRange {
  min: number
  max: number
}

function strideIndices(length: number, target: number): number[] {
  if (length <= target) {
    return Array.from({ length }, (_, index) => index)
  }
  const step = (length - 1) / (target - 1)
  const indices = new Array<number>(target)
  for (let i = 0; i < target; i += 1) {
    indices[i] = Math.round(i * step)
  }
  return indices
}

function take(values: Float64Array, indices: number[]): Float64Array {
  const out = new Float64Array(indices.length)
  for (let i = 0; i < indices.length; i += 1) {
    out[i] = values[indices[i]]
  }
  return out
}

/** 包络抽稀（保尖峰），用于波形/频谱。 */
function envelope(x: Float64Array, y: Float64Array, target: number): Float64Array[] {
  if (x.length <= target) {
    return [x, y]
  }
  const pair = minMaxEnvelope(x, y, Math.max(1, Math.ceil(target / 2)))
  return [pair.x, pair.y]
}

export function toPreview(value: ScienceValue, target = DEFAULT_PREVIEW_TARGET): ScienceValue {
  if (value.kind === 'series') {
    const x = values1d(value.x)
    const y = values1d(value.y)
    const [px, py] = envelope(x, y, target)
    return { ...value, x: createDense(px), y: createDense(py), pointCount: value.y.shape[0] }
  }

  if (value.kind === 'spectrum') {
    const frequency = values1d(value.frequency)
    const magnitude = values1d(value.magnitude)
    const [pf, pm] = envelope(frequency, magnitude, target)
    return { ...value, frequency: createDense(pf), magnitude: createDense(pm), pointCount: value.frequency.shape[0] }
  }

  if (value.kind === 'fit') {
    // 共享索引，保证数据/拟合线/残差在同一组 x 上对齐。
    const x = values1d(value.x)
    const indices = strideIndices(x.length, target)
    return {
      ...value,
      x: createDense(take(x, indices)),
      y: createDense(take(values1d(value.y), indices)),
      fitted: createDense(take(values1d(value.fitted), indices)),
      residual: createDense(take(values1d(value.residual), indices)),
      pointCount: value.x.shape[0],
    }
  }

  return value
}

/** 二分查找 x 落在 [min, max] 内的下标区间 [start, end)。 */
function rangeIndices(x: Float64Array, min: number, max: number): { start: number; end: number } {
  const n = x.length
  if (n === 0 || !(max > min)) {
    return { start: 0, end: n }
  }

  let low = 0
  let high = n
  while (low < high) {
    const mid = (low + high) >> 1
    if (x[mid] < min) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  const start = low

  low = start
  high = n
  while (low < high) {
    const mid = (low + high) >> 1
    if (x[mid] <= max) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  return { start, end: low }
}

/**
 * 视野联动预览：只对可见范围降采样。数据仍驻留 Worker，
 * 主线程在用户缩放后拿这个更密的副本就地刷新 trace。
 */
export function toPreviewInRange(
  value: ScienceValue,
  range: PreviewRange | null,
  target = DEFAULT_PREVIEW_TARGET,
): ScienceValue {
  if (!range) {
    return toPreview(value, target)
  }

  if (value.kind === 'series') {
    const sampled = downsamplePoints(values1d(value.x), values1d(value.y), 'envelope', target, range)
    return { ...value, x: createDense(sampled.x), y: createDense(sampled.y), pointCount: value.y.shape[0] }
  }

  if (value.kind === 'spectrum') {
    const sampled = downsamplePoints(values1d(value.frequency), values1d(value.magnitude), 'envelope', target, range)
    return { ...value, frequency: createDense(sampled.x), magnitude: createDense(sampled.y), pointCount: value.frequency.shape[0] }
  }

  if (value.kind === 'fit') {
    const x = values1d(value.x)
    const { start, end } = rangeIndices(x, range.min, range.max)
    const windowLength = end - start
    if (windowLength <= 0) {
      return toPreview(value, target)
    }
    // 共享索引，保证数据/拟合线/残差在同一组 x 上对齐。
    const indices = strideIndices(windowLength, target).map((index) => index + start)
    return {
      ...value,
      x: createDense(take(x, indices)),
      y: createDense(take(values1d(value.y), indices)),
      fitted: createDense(take(values1d(value.fitted), indices)),
      residual: createDense(take(values1d(value.residual), indices)),
      pointCount: value.x.shape[0],
    }
  }

  return value
}
