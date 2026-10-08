/**
 * 调色算子：白平衡、自动色阶、直方图均衡化。
 *
 * 与 `colorAdjustments.ts`（按通道设显示区间 → range 重映射）不同，这里的每一步都有明确的
 * 摄影/信号含义，是真正的「调色」：
 *
 * | 方法 | 依据 | 效果 |
 * | --- | --- | --- |
 * | Gray World | 场景平均色应为中性灰 | 按通道均值求增益，校正整体偏色 |
 * | White Patch (Max-RGB) | 最亮处应为白 | 按通道高分位点求增益，校正高光色偏 |
 * | Auto Levels | 按分位裁剪 | 每通道各自拉伸到满量程，去掉两端无效值 |
 * | Equalize | 累积分布 | 直方图均衡化，可带强度混合 |
 * | Manual | 用户给定 | 直接乘每通道增益 |
 *
 * 全部是纯函数，不依赖 Canvas / DOM，因此可以直接断言像素。
 * 数据布局沿用引擎约定：多通道时按平面分离，`data[c * pixels + i]`。
 */
import { allocateBuffer, type Dtype, type ImageBlock } from './types.ts'

export type ColorGradingMethod = 'grayWorld' | 'whitePatch' | 'autoLevels' | 'equalize' | 'manual'

export const COLOR_GRADING_METHODS: readonly ColorGradingMethod[] = ['grayWorld', 'whitePatch', 'autoLevels', 'equalize', 'manual']

export interface ColorGradingOptions {
  method: ColorGradingMethod
  /** `manual`：每通道增益（顺序 R、G、B；灰度只取第一个）。 */
  gains?: readonly number[]
  /** `autoLevels`：两端各裁掉的像素比例（百分数，0-10）。 */
  clipPercent?: number
  /** `equalize`：与原图的混合强度 0-100（100 = 完全均衡）。 */
  strength?: number
  /** `equalize` / 直方图的桶数；缺省用 dtype 满量程 + 1。 */
  levels?: number
}

export interface BlockLayout {
  width: number
  height: number
  /** 通道数（灰度 = 1，RGB = 3）。 */
  channels: number
  pixels: number
}

export function blockLayout(block: ImageBlock): BlockLayout {
  const width = block.shape[block.axes.indexOf('x')] ?? 0
  const height = block.shape[block.axes.indexOf('y')] ?? 0
  return { width, height, channels: block.shape[block.axes.indexOf('c')] ?? 1, pixels: width * height }
}

/** dtype 的满量程；float32 没有固定量程，按数据自身范围处理（见 `gradeColors`）。 */
export function gradingCeiling(dtype: Dtype): number {
  switch (dtype) {
    case 'uint8': return 255
    case 'uint16': return 65535
    case 'int16': return 32767
    case 'float32': return 1
  }
}

function clampToDtype(dtype: Dtype, value: number): number {
  if (!Number.isFinite(value)) return 0
  switch (dtype) {
    case 'uint8': return Math.max(0, Math.min(255, Math.round(value)))
    case 'uint16': return Math.max(0, Math.min(65535, Math.round(value)))
    case 'int16': return Math.max(-32768, Math.min(32767, Math.round(value)))
    case 'float32': return value
  }
}

/** 每通道的均值与最大值（白平衡的依据）。 */
export function channelStatistics(block: ImageBlock): { means: number[]; maxima: number[] } {
  const { channels, pixels } = blockLayout(block)
  const means: number[] = []
  const maxima: number[] = []
  for (let channel = 0; channel < channels; channel += 1) {
    let sum = 0
    let max = 0
    for (let i = 0; i < pixels; i += 1) {
      const value = block.data[channel * pixels + i]!
      sum += value
      if (value > max) max = value
    }
    means.push(pixels > 0 ? sum / pixels : 0)
    maxima.push(max)
  }
  return { means, maxima }
}

/**
 * 白平衡增益。
 *
 * 灰度世界：`g_i = 平均亮度 / 该通道均值`；白点：`g_i = 全局最大 / 该通道最大`。
 * 两种情况都以「所有通道的公共参考值」归一化，所以校正后不会整体提亮或压暗。
 */
export function whiteBalanceGains(
  means: readonly number[],
  maxima: readonly number[],
  method: 'grayWorld' | 'whitePatch',
): number[] {
  if (means.length === 0) return []
  if (method === 'grayWorld') {
    const reference = means.reduce((sum, value) => sum + value, 0) / means.length
    return means.map((mean) => (mean > 0 ? reference / mean : 1))
  }
  const reference = maxima.reduce((max, value) => Math.max(max, value), 0)
  return maxima.map((max) => (max > 0 && reference > 0 ? reference / max : 1))
}

/** 每通道直方图（长度 = levels）。 */
export function channelHistograms(block: ImageBlock, levels: number): Uint32Array[] {
  const { channels, pixels } = blockLayout(block)
  const ceiling = gradingCeiling(block.dtype)
  const scale = levels / (ceiling + 1)
  const histograms: Uint32Array[] = []
  for (let channel = 0; channel < channels; channel += 1) {
    const histogram = new Uint32Array(levels)
    for (let i = 0; i < pixels; i += 1) {
      const bin = Math.min(levels - 1, Math.max(0, Math.floor(block.data[channel * pixels + i]! * scale)))
      histogram[bin] = (histogram[bin] ?? 0) + 1
    }
    histograms.push(histogram)
  }
  return histograms
}

/**
 * 直方图均衡化的映射表。
 *
 * 标准 CDF 变换：`lut(i) = (cdf(i) − cdfMin) / (total − cdfMin) × ceiling`；
 * 空直方图返回全 0，调用方据此退化为恒等映射。
 */
export function equalizationLut(counts: ArrayLike<number>, ceiling: number): Float64Array {
  const lut = new Float64Array(counts.length)
  let total = 0
  for (let i = 0; i < counts.length; i += 1) total += counts[i]!
  if (total === 0) return lut
  let cdf = 0
  let cdfMin = -1
  for (let i = 0; i < counts.length; i += 1) {
    const count = counts[i]!
    // cdfMin 取「第一个非零桶的累计值」（标准 CDF 均衡公式），这样最暗的有效灰度映射到 0。
    if (cdfMin < 0 && count > 0) cdfMin = cdf + count
    cdf += count
    const low = cdfMin < 0 ? 0 : cdfMin
    const span = total - low
    lut[i] = span > 0 ? ((cdf - low) / span) * ceiling : ceiling
  }
  return lut
}

/**
 * 自动色阶的每通道黑/白点：按 `clipPercent` 从两端裁掉同样比例的像素。
 *
 * 与 ImageJ 的 `ContrastEnhancer` 一样按**每通道**独立裁剪 —— 这正是它能去掉偏色的原因。
 */
export function autoLevelBounds(
  histograms: readonly ArrayLike<number>[],
  counts: readonly number[],
  clipPercent: number,
): { min: number; max: number }[] {
  const ratio = Math.max(0, Math.min(10, clipPercent)) / 100
  return histograms.map((histogram, index) => {
    const total = counts[index] ?? 0
    const limit = Math.floor(total * ratio)
    let low = 0
    let acc = 0
    while (low < histogram.length - 1 && acc + histogram[low]! <= limit) {
      acc += histogram[low]!
      low += 1
    }
    let high = histogram.length - 1
    acc = 0
    while (high > low && acc + histogram[high]! <= limit) {
      acc += histogram[high]!
      high -= 1
    }
    return { min: low, max: high }
  })
}

/** 主入口：按方法产出一个新的像素块（不改动入参）。 */
export function gradeColors(block: ImageBlock, options: ColorGradingOptions): ImageBlock {
  const { channels, pixels } = blockLayout(block)
  const ceiling = gradingCeiling(block.dtype)
  const data = allocateBuffer(block.dtype, block.data.length)

  if (options.method === 'grayWorld' || options.method === 'whitePatch' || options.method === 'manual') {
    const gains = options.method === 'manual'
      ? (options.gains ?? [1, 1, 1])
      : (() => {
          const { means, maxima } = channelStatistics(block)
          return whiteBalanceGains(means, maxima, options.method as 'grayWorld' | 'whitePatch')
        })()
    for (let channel = 0; channel < channels; channel += 1) {
      const gain = gains[channel] ?? gains[0] ?? 1
      for (let i = 0; i < pixels; i += 1) {
        data[channel * pixels + i] = clampToDtype(block.dtype, block.data[channel * pixels + i]! * gain)
      }
    }
    return { ...block, data }
  }

  const levels = Math.max(2, Math.floor(options.levels ?? ceiling + 1))
  const histograms = channelHistograms(block, levels)
  const scale = levels / (ceiling + 1)

  if (options.method === 'autoLevels') {
    const bounds = autoLevelBounds(histograms, histograms.map((histogram) => histogram.reduce((sum, value) => sum + value, 0)), options.clipPercent ?? 0.5)
    for (let channel = 0; channel < channels; channel += 1) {
      const { min, max } = bounds[channel]!
      const span = Math.max(1, max - min)
      for (let i = 0; i < pixels; i += 1) {
        const value = block.data[channel * pixels + i]!
        data[channel * pixels + i] = clampToDtype(block.dtype, ((value - min) / span) * ceiling)
      }
    }
    return { ...block, data }
  }

  // 直方图均衡化：强度 < 100 时与原值线性混合。
  const strength = Math.max(0, Math.min(100, options.strength ?? 100)) / 100
  for (let channel = 0; channel < channels; channel += 1) {
    const lut = equalizationLut(histograms[channel]!, ceiling)
    for (let i = 0; i < pixels; i += 1) {
      const value = block.data[channel * pixels + i]!
      const bin = Math.min(levels - 1, Math.max(0, Math.floor(value * scale)))
      const mapped = lut[bin]!
      data[channel * pixels + i] = clampToDtype(block.dtype, value + (mapped - value) * strength)
    }
  }
  return { ...block, data }
}
