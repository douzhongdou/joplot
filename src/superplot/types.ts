/**
 * super-plot 模块自有的列式数据集模型。
 *
 * 与工作台里的 `CsvData`（每行一个 `{ raw, numeric }` 对象）不同，这里把每一列
 * 存成类型化数组 / 字符串数组，行数可以是百万级，内存和遍历都接近最优。
 * 该模块刻意与工作台解耦，互不引用，方便单独迭代和测试。
 */

export interface SuperNumericColumn {
  name: string
  kind: 'number'
  /** 缺失值以 NaN 存放，`missing` 为掩码，非缺失处恒为 0。 */
  values: Float64Array
  missing: Uint8Array | null
  validCount: number
  missingCount: number
  min: number
  max: number
  mean: number
}

export interface SuperStringColumn {
  name: string
  kind: 'string'
  values: string[]
}

export type SuperColumn = SuperNumericColumn | SuperStringColumn

export interface SuperDataset {
  id: string
  fileName: string
  headers: string[]
  columns: SuperColumn[]
  rowCount: number
  numericColumns: string[]
  /** 推断出的时间列与采样率（Hz）；无法推断时为 null。 */
  timeColumn: string | null
  sampleRate: number | null
  fileSize: number
  createdAt: number
}

export interface PointPair {
  x: Float64Array
  y: Float64Array
}

export type DownsampleMode = 'auto' | 'envelope' | 'lttb' | 'none'

export type WindowKind = 'hann' | 'hamming' | 'blackman' | 'flattop' | 'rectangular'

export type DetrendMode = 'none' | 'mean' | 'linear'

export interface SpectrumOptions {
  sampleRate: number
  window: WindowKind
  detrend: DetrendMode
  /** 单边福利用：0 表示自动（不补零），正数表示目标 FFT 长度（会向上取 2 的幂）。 */
  fftSize: number
  /** Welch 平均：1 段表示单次 FFT。 */
  segments: number
  /** Welch 段间重叠比例（0~0.9）。 */
  overlap: number
  /** 单边谱是否按窗函数相干增益做幅度归一化。 */
  normalize: boolean
}

export interface SpectrumResult {
  freq: Float64Array
  magnitude: Float64Array
  /** 原始 FFT 长度（补零后）。 */
  fftSize: number
  /** 实际参与运算的样本数（Welch 时为单段长度）。 */
  segmentLength: number
  segmentCount: number
  binWidth: number
  coherentGain: number
  /** 去均值/去趋势后的直流与趋势信息，便于 UI 展示。 */
  removedMean: number
  removedSlope: number
}

export interface SpectrumPeak {
  frequency: number
  magnitude: number
  /** 相对峰值的 dB（0 为最高峰）。 */
  relativeDb: number
}
