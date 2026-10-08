/**
 * Joplot Science MVP 的数据模型（Contract v0.1 的最小落地）。
 *
 * 这里刻意保持"薄"：
 * - DenseArray 只描述 shape/strides/offset/dtype 与后端数据，不实现算法世界。
 * - Value 逻辑上不可变：每个算子产出新 Value，不原地改。
 * - 每个 Value 带 provenance，可追溯来源。
 */

export type NumericDType = 'float64' | 'int32' | 'bool'

/** 薄 descriptor：MVP 只有 JS Float64Array 后端。 */
export interface DenseArray {
  readonly dtype: NumericDType
  readonly shape: readonly number[]
  readonly strides: readonly number[]
  readonly offset: number
  readonly data: Float64Array
}

export interface Series {
  id: string
  name: string
  kind: 'series'
  x: DenseArray
  y: DenseArray
  sampleRate?: number
  /** X-axis unit used to label derived frequency (for example s or sample). */
  xUnit?: string
  /** 原始采样点数（预览下沉后仍保留真实长度）。 */
  pointCount?: number
  provenance: string
}

export interface SpectrumValue {
  id: string
  name: string
  kind: 'spectrum'
  frequency: DenseArray
  magnitude: DenseArray
  /** 单次 FFT 相位（弧度）；Welch 功率平均时为 null。 */
  phase: DenseArray | null
  sampleRate: number
  frequencyUnit?: string
  pointCount?: number
  provenance: string
}

export interface FitParameter {
  name: string
  value: number
  stderr: number
}

/** 拟合停止原因：步长收敛 / 达到最大迭代 / 无法继续下降。 */
export type FitStopReason = 'converged' | 'maxIterations' | 'stalled'

export interface FitValue {
  id: string
  name: string
  kind: 'fit'
  x: DenseArray
  y: DenseArray
  fitted: DenseArray
  residual: DenseArray
  modelId: string
  modelName: string
  modelExpr: string
  params: FitParameter[]
  rSquared: number
  rmse: number
  /** 实际进入 LM 外层循环的次数（零次运行记 0）。 */
  iterations: number
  converged: boolean
  /** 停止原因，与 `converged` 同源，供界面区分「没算够」与「卡住」。 */
  stopReason: FitStopReason
  pointCount?: number
  provenance: string
}

export interface StatsValue {
  id: string
  name: string
  kind: 'stats'
  sourceId: string
  rows: Array<{ key: string; value: number }>
  provenance: string
}

export type ScienceValue = Series | SpectrumValue | FitValue | StatsValue

export type ScienceValueKind = ScienceValue['kind']

/** 列映射：X 列(空串=行号)与若干 Y 列。 */
export interface DatasetMapping {
  xColumn: string
  yColumns: string[]
  /**
   * 分组列（可选）：非空时按该列取值把每个 Y 列拆成多条曲线。
   * 用于「同一文件里多组数据串联」（例如 condition / polarization）的场景。
   */
  groupColumn?: string
}

/**
 * 数据集的「元信息」。主线程只持有它，完整列数组驻留 Worker。
 * 字段取自 SuperDataset 中 UI/映射/持久化所需的部分。
 */
export interface DatasetSummary {
  id: string
  fileName: string
  headers: string[]
  numericColumns: string[]
  rowCount: number
  timeColumn: string | null
  createdAt: number
  fileSize: number
}

export type WorkspaceSource = 'sample' | 'dataset'
