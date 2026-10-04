/**
 * 整栈逐页统计内核。
 *
 * Image ▸ Stacks 的三个命令共用这一层：
 * - Measure Stack...（`ij/plugin/SimpleCommands.java:266-274` + `macros/MeasureStack.txt`）：逐页一行；
 * - Statistics（`ij/plugin/Stack_Statistics.java:12-52` + `ij/process/StackStatistics.java`）：整栈一行汇总；
 * - Plot Z-axis Profile（`ij/plugin/ZAxisProfiler.java:209-260`）：逐页均值的曲线。
 *
 * 与 ImageJ 的差别（均为适配「只读 + 按页惰性读取」的架构）：
 * - 逐页遍历由调用方注入 `readFrame`，因此同一份内核既能统计源数据，也能统计当前 Recipe 的处理结果；
 * - 中位数与众数取自直方图。整数 dtype 用位宽满桶（uint8 256、uint16/int16 65536，见 `stats.ts` 的
 *   `HISTOGRAM_BINS`），桶宽为 1，结果与逐像素排序完全一致；
 * - `float32` 没有可枚举的值域，因此**再读一遍**数据，按页内范围与全局范围各建一份 256 桶直方图，
 *   中位数与众数取桶中心（误差不超过一个桶宽）。多读一遍的代价只落在浮点数据上。
 */
import { StatsAccumulator, type MergedStats } from './stats.ts'
import type { ImageBlock } from './types.ts'

/** 浮点数据建直方图的桶数；与 ImageJ 的 8 位直方图路径同量级。 */
const FLOAT_HISTOGRAM_BINS = 256

/** 单页统计（对应 Measure Stack 结果表的一行）。 */
export interface StackFrameStats {
  /** 0-based 页下标。 */
  index: number
  /** 1-based 切片号，与 ImageJ 结果表的 Slice 列一致。 */
  slice: number
  count: number
  mean: number
  min: number
  max: number
  /** 样本标准差（除以 n-1），与 ImageJ 的 StdDev 列一致。 */
  stdDev: number
  /** 中位数；无有效像素时为 NaN。 */
  median: number
  /** 众数；无有效像素时为 NaN。 */
  mode: number
}

/** 整栈汇总（对应 Statistics 结果表的一行）。 */
export interface StackStatsSummary {
  /** 参与统计的像素/体素数。 */
  voxels: number
  mean: number
  min: number
  max: number
  /** 样本标准差（除以 n-1）。 */
  stdDev: number
  median: number
  mode: number
}

export interface StackStatsResult {
  /** 被遍历的切片轴。 */
  axis: 'z' | 't' | 'c'
  frameCount: number
  /** 逐页统计，顺序即遍历顺序。 */
  frames: StackFrameStats[]
  /** 逐页均值，Plot Z-axis Profile 的纵轴（y）。 */
  profile: number[]
  /** 逐页横轴坐标，按标定换算。 */
  x: number[]
  /** 横轴单位（未标定时为空字符串）。 */
  xUnit: string
  /** 横轴标题：切片轴给 "z"/"t"/"c"。 */
  xLabel: string
  /** 整栈汇总。 */
  summary: StackStatsSummary
}

export interface StackStatsCalibration {
  /** 相邻切片的物理间隔（如 pixelDepth）。 */
  spacing: number
  /** 横轴原点（标定时为 0，未标定为 -1，与 ImageJ 的 `ZAxisProfiler` 一致）。 */
  origin: number
  unit: string
}

export interface StackStatsInput {
  /** 切片轴上的页数。 */
  frameCount: number
  /** 读取第 index 页（0-based）；ROI 裁剪由调用方在这一步完成。 */
  readFrame(index: number): Promise<ImageBlock>
  /** 切片轴被遍历的轴名，用于横轴标题。 */
  axis?: 'z' | 't' | 'c'
  calibration?: StackStatsCalibration
  signal?: AbortSignal
}

/** 从直方图求中位数：返回桶号（桶宽为 1 时即像素值）。 */
export function histogramMedian(histogram: Uint32Array, count: number): number {
  if (count <= 0) return Number.NaN
  const half = count / 2
  let accumulated = 0
  for (let bin = 0; bin < histogram.length; bin += 1) {
    accumulated += histogram[bin] ?? 0
    if (accumulated >= half) return bin
  }
  return histogram.length - 1
}

/** 从直方图求众数：计数最大的桶；并列时取较小的桶（ImageJ 的 dmode 同样取首个最大值）。 */
export function histogramMode(histogram: Uint32Array): number {
  let best = Number.NaN
  let bestCount = 0
  for (let bin = 0; bin < histogram.length; bin += 1) {
    const value = histogram[bin] ?? 0
    if (value > bestCount) {
      bestCount = value
      best = bin
    }
  }
  return bestCount > 0 ? best : Number.NaN
}

/** 数值 → [min, max] 上 256 桶的桶号。 */
function floatBin(value: number, min: number, max: number): number {
  const span = max - min || 1
  return Math.min(FLOAT_HISTOGRAM_BINS - 1, Math.max(0, Math.floor(((value - min) / span) * FLOAT_HISTOGRAM_BINS)))
}

/** 桶号 → 数值（取桶中心，误差不超过一个桶宽）。 */
function floatBinValue(min: number, max: number, bin: number): number {
  if (Number.isNaN(bin)) return Number.NaN
  const span = max - min || 1
  return min + (bin + 0.5) * (span / FLOAT_HISTOGRAM_BINS)
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
}

function writeHistogramDerived(
  histogram: Uint32Array,
  count: number,
  toValue: (bin: number) => number,
): { median: number; mode: number } {
  return {
    median: toValue(histogramMedian(histogram, count)),
    mode: toValue(histogramMode(histogram)),
  }
}

/**
 * 浮点数据的第二遍读取：按页内范围与全局范围各建一份 256 桶直方图。
 *
 * 整数 dtype 一遍就能得到精确结果（桶宽 1），因此不会走到这里。
 */
async function buildFloatHistograms(
  input: StackStatsInput,
  frames: StackFrameStats[],
  summary: StackStatsSummary,
  ranges: ReadonlyArray<{ min: number; max: number }>,
  totals: MergedStats,
): Promise<void> {
  const totalHistogram = new Uint32Array(FLOAT_HISTOGRAM_BINS)
  for (let index = 0; index < frames.length; index += 1) {
    abortIfNeeded(input.signal)
    const range = ranges[index]
    if (!range) continue
    const block = await input.readFrame(index)
    const pageHistogram = new Uint32Array(FLOAT_HISTOGRAM_BINS)
    const values = block.data
    for (let i = 0; i < values.length; i += 1) {
      const value = values[i]!
      if (Number.isNaN(value)) continue
      pageHistogram[floatBin(value, range.min, range.max)]! += 1
      totalHistogram[floatBin(value, totals.min, totals.max)]! += 1
    }
    const frame = frames[index]!
    const page = writeHistogramDerived(pageHistogram, frame.count, (bin) => floatBinValue(range.min, range.max, bin))
    frame.median = page.median
    frame.mode = page.mode
  }
  const overall = writeHistogramDerived(totalHistogram, summary.voxels, (bin) => floatBinValue(totals.min, totals.max, bin))
  summary.median = overall.median
  summary.mode = overall.mode
}

/** 逐页读取 → 逐页统计 → 合并成整栈汇总。 */
export async function computeStackStats(input: StackStatsInput): Promise<StackStatsResult> {
  const frames: StackFrameStats[] = []
  const profile: number[] = []
  /** 浮点页的范围（整数页为 undefined），第二遍建桶要用。 */
  const floatRanges: Array<{ min: number; max: number } | undefined> = []
  // 合并用的累加器要等第一页拿到 dtype 才能确定直方图桶数。
  let totals: StatsAccumulator | undefined
  for (let index = 0; index < input.frameCount; index += 1) {
    abortIfNeeded(input.signal)
    const block = await input.readFrame(index)
    totals ??= new StatsAccumulator(block.dtype)
    const accumulator = new StatsAccumulator(block.dtype)
    accumulator.add(block)
    totals.merge(accumulator)
    const merged = accumulator.merged()
    const histogram = accumulator.histogram
    if (histogram) floatRanges.push(undefined)
    else floatRanges.push({ min: merged.count ? merged.min : 0, max: merged.count ? merged.max : 0 })
    const derived = histogram
      ? writeHistogramDerived(histogram, merged.count, (bin) => bin)
      : { median: Number.NaN, mode: Number.NaN }
    frames.push({
      index,
      slice: index + 1,
      count: merged.count,
      mean: merged.mean,
      min: merged.min,
      max: merged.max,
      stdDev: merged.sampleStdDev,
      median: derived.median,
      mode: derived.mode,
    })
    profile.push(merged.mean)
  }
  abortIfNeeded(input.signal)

  const mergedTotals = totals?.merged()
  const voxels = mergedTotals?.count ?? 0
  const summary: StackStatsSummary = {
    voxels,
    mean: mergedTotals?.mean ?? 0,
    min: mergedTotals?.min ?? 0,
    max: mergedTotals?.max ?? 0,
    stdDev: mergedTotals?.sampleStdDev ?? 0,
    median: Number.NaN,
    mode: Number.NaN,
  }
  const integerHistogram = totals?.histogram
  if (integerHistogram) {
    const derived = writeHistogramDerived(integerHistogram, voxels, (bin) => bin)
    summary.median = derived.median
    summary.mode = derived.mode
  } else if (mergedTotals && voxels > 0) {
    await buildFloatHistograms(input, frames, summary, floatRanges as ReadonlyArray<{ min: number; max: number }>, mergedTotals)
  }

  // 横轴：未标定从 1 开始（ImageJ 的 origin=-1、calFactor=1），标定后从 0 开始。
  const calibration = input.calibration
  const spacing = calibration && Number.isFinite(calibration.spacing) && calibration.spacing !== 0 ? calibration.spacing : 1
  const origin = calibration?.origin ?? -1
  const x = frames.map((frame) => (frame.index - origin) * spacing)
  const axis = input.axis ?? 'z'
  return {
    axis,
    frameCount: frames.length,
    frames,
    profile,
    x,
    xUnit: calibration?.unit ?? '',
    xLabel: axis,
    summary,
  }
}
