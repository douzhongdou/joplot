/**
 * P0：可合并统计（对应架构方案第 6 节「统计可逐块累加再合并」）。
 *
 * 逐块计算 count/sum/sumSq/min/max，最后合并即可得到整图或整卷统计，
 * 不需要一次读入全部像素。直方图可选，按 dtype 的位宽决定桶数（uint8 为 256）。
 */
import type { Dtype, ImageBlock } from './types.ts'

export interface StatSummary {
  count: number
  mean: number
  min: number
  max: number
  /** 总体标准差（除以 n）。样本标准差可在调用方换算。 */
  stdDev: number
  sum: number
  sumSquares: number
}

export interface MergedStats extends StatSummary {
  /** 样本标准差（除以 n-1），与既有 8 位实现口径一致。 */
  sampleStdDev: number
}

export const HISTOGRAM_BINS: Partial<Record<Dtype, number>> = {
  uint8: 256,
  uint16: 65536,
  int16: 65536,
}

/**
 * 统计累加器。对空数据 count=0，最终值定义为 min=+Inf、max=-Inf。
 * 累加器可序列化（toJSON / fromJSON），支持跨 Worker 合并。
 */
export class StatsAccumulator {
  count = 0
  sum = 0
  sumSquares = 0
  min = Number.POSITIVE_INFINITY
  max = Number.NEGATIVE_INFINITY
  readonly histogram?: Uint32Array
  private readonly dtype?: Dtype

  constructor(dtype?: Dtype) {
    this.dtype = dtype
    const bins = dtype ? HISTOGRAM_BINS[dtype] : undefined
    if (bins) this.histogram = new Uint32Array(bins)
  }

  /** 累加一个块；忽略 NaN（浮点特殊值按架构方案要求显式处理）。 */
  add(block: ImageBlock): void {
    const values = block.data
    const histogram = this.histogram
    for (let i = 0; i < values.length; i += 1) {
      const value = (values as unknown as { [index: number]: number })[i]!
      if (Number.isNaN(value)) continue
      this.count += 1
      this.sum += value
      this.sumSquares += value * value
      if (value < this.min) this.min = value
      if (value > this.max) this.max = value
      if (histogram) {
        const bin = value
        if (bin >= 0 && bin < histogram.length) histogram[bin] = (histogram[bin] ?? 0) + 1
      }
    }
  }

  /** 合并另一个累加器（block-mergeable）。 */
  merge(other: StatsAccumulator): void {
    this.count += other.count
    this.sum += other.sum
    this.sumSquares += other.sumSquares
    if (other.min < this.min) this.min = other.min
    if (other.max > this.max) this.max = other.max
    if (this.histogram && other.histogram && this.histogram.length === other.histogram.length) {
      for (let i = 0; i < this.histogram.length; i += 1) {
        this.histogram[i] = (this.histogram[i] ?? 0) + (other.histogram[i] ?? 0)
      }
    } else if (other.histogram && !this.histogram) {
      // 允许把直方图信息带过来（只读共享长度一致时）。
      Object.assign(this, { histogram: other.histogram })
    }
  }

  summary(): StatSummary {
    if (this.count === 0) {
      return { count: 0, mean: 0, min: 0, max: 0, stdDev: 0, sum: 0, sumSquares: 0 }
    }
    const mean = this.sum / this.count
    const variance = Math.max(0, this.sumSquares / this.count - mean * mean)
    return {
      count: this.count,
      mean,
      min: this.min,
      max: this.max,
      stdDev: Math.sqrt(variance),
      sum: this.sum,
      sumSquares: this.sumSquares,
    }
  }

  merged(): MergedStats {
    const base = this.summary()
    const sampleStdDev = this.count > 1
      ? Math.sqrt(Math.max(0, (base.sumSquares - base.count * base.mean * base.mean) / (this.count - 1)))
      : 0
    return { ...base, sampleStdDev }
  }

  toJSON(): { dtype?: Dtype; count: number; sum: number; sumSquares: number; min: number; max: number } {
    return {
      dtype: this.dtype,
      count: this.count,
      sum: this.sum,
      sumSquares: this.sumSquares,
      min: this.min,
      max: this.max,
    }
  }

  static fromJSON(payload: { dtype?: Dtype; count: number; sum: number; sumSquares: number; min: number; max: number }): StatsAccumulator {
    const accumulator = new StatsAccumulator(payload.dtype)
    accumulator.count = payload.count
    accumulator.sum = payload.sum
    accumulator.sumSquares = payload.sumSquares
    accumulator.min = payload.min
    accumulator.max = payload.max
    return accumulator
  }
}

/** 便捷函数：一次统计单个块。 */
export function summarize(block: ImageBlock): MergedStats {
  const accumulator = new StatsAccumulator(block.dtype)
  accumulator.add(block)
  return accumulator.merged()
}
