/**
 * 预览下沉：大数组留在 Worker，主线程只拿降采样后的副本用于绘图。
 * 小数据（≤ target）原样返回，行为与之前完全一致。
 */

import type { ScienceValue } from '../types.ts'
import { createDense, values1d } from '../lib/dense.ts'
import { downsamplePoints, minMaxEnvelope, sliceByRange } from '../../superplot/lib/downsample.ts'

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

/** 保持相位与按幅度选出的频率点共用下标。频率数组单调递增。 */
function alignedPhase(frequency: Float64Array, phase: Float64Array, selectedFrequency: Float64Array): Float64Array {
  const result = new Float64Array(selectedFrequency.length)
  let index = 0
  for (let i = 0; i < selectedFrequency.length; i += 1) {
    while (index + 1 < frequency.length && frequency[index] < selectedFrequency[i]) index += 1
    result[i] = phase[index]
  }
  return result
}

/** 包络抽稀（保尖峰），用于波形/频谱。 */
function envelope(x: Float64Array, y: Float64Array, target: number): Float64Array[] {
  if (x.length <= target) {
    return [x, y]
  }
  const pair = minMaxEnvelope(x, y, Math.max(1, Math.ceil(target / 2)))
  return [pair.x, pair.y]
}

/** Preserve narrow spectral lines near both ends of a linear or logarithmic frequency axis. */
function spectrumEnvelope(x: Float64Array, y: Float64Array, target: number): Float64Array[] {
  const n = Math.min(x.length, y.length)
  if (n <= target) return [x, y]

  const buckets = Math.max(1, Math.floor(target / 4))
  const selected = new Set<number>([0, n - 1])
  const firstPositive = x.findIndex((frequency) => frequency > 0)
  const logMin = firstPositive >= 0 ? Math.log10(x[firstPositive]) : 0
  const logSpan = firstPositive >= 0 ? Math.log10(x[n - 1]) - logMin : 0

  for (const scale of ['linear', 'log'] as const) {
    if (scale === 'log' && !(logSpan > 0)) continue
    const minIndex = new Int32Array(buckets).fill(-1)
    const maxIndex = new Int32Array(buckets).fill(-1)
    for (let i = scale === 'log' ? firstPositive : 0; i < n; i += 1) {
      if (!Number.isFinite(y[i])) continue
      const position = scale === 'log'
        ? (Math.log10(x[i]) - logMin) / logSpan
        : (x[i] - x[0]) / (x[n - 1] - x[0])
      if (!Number.isFinite(position)) continue
      const bucket = Math.min(buckets - 1, Math.max(0, Math.floor(position * buckets)))
      if (minIndex[bucket] < 0 || y[i] < y[minIndex[bucket]]) minIndex[bucket] = i
      if (maxIndex[bucket] < 0 || y[i] > y[maxIndex[bucket]]) maxIndex[bucket] = i
    }
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      if (minIndex[bucket] >= 0) selected.add(minIndex[bucket])
      if (maxIndex[bucket] >= 0) selected.add(maxIndex[bucket])
    }
  }

  const indices = [...selected].sort((left, right) => left - right)
  return [take(x, indices), take(y, indices)]
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
    const [pf, pm] = spectrumEnvelope(frequency, magnitude, target)
    return {
      ...value,
      frequency: createDense(pf),
      magnitude: createDense(pm),
      phase: value.phase ? createDense(alignedPhase(frequency, values1d(value.phase), pf)) : null,
      pointCount: value.frequency.shape[0],
    }
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
    const frequency = values1d(value.frequency)
    const sliced = sliceByRange(frequency, values1d(value.magnitude), range.min, range.max)
    const [pf, pm] = spectrumEnvelope(sliced.x, sliced.y, target)
    return {
      ...value,
      frequency: createDense(pf),
      magnitude: createDense(pm),
      phase: value.phase ? createDense(alignedPhase(frequency, values1d(value.phase), pf)) : null,
      pointCount: value.frequency.shape[0],
    }
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
