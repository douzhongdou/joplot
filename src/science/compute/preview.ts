/**
 * 预览下沉：大数组留在 Worker，主线程只拿降采样后的副本用于绘图。
 * 小数据（≤ target）原样返回，行为与之前完全一致。
 */

import type { ScienceValue } from '../types.ts'
import { createDense, values1d } from '../lib/dense.ts'
import { minMaxEnvelope } from '../../superplot/lib/downsample.ts'

import { DEFAULT_PREVIEW_TARGET } from './protocol.ts'

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
