import type { DatasetMapping, DatasetSummary, ScienceValue, WorkspaceSource } from '../types.ts'
import type { AnalysisStep } from '../lib/pipeline.ts'

/**
 * 主线程 → Worker
 *
 * 归属模型：Worker 是数据集的「运行时主人」（内存中的 SuperDataset[]/base/cache），
 * IndexedDB 是「持久主人」。Worker 被终止后，靠 `hydrate` 从 IndexedDB 恢复。
 */

export interface RunRequest {
  type: 'run'
  requestId: number
  /** 重置：重建 base、清缓存、全量重算（映射变化 / 取消后 / 重载后会用到）。 */
  reset: boolean
  source: WorkspaceSource
  /** 提供时先更新映射（改映射不终止 Worker）。 */
  mappings?: Record<string, DatasetMapping>
  /** 需要重算的步骤 id；其余步骤复用 Worker 侧缓存。 */
  dirtyIds: string[]
  steps: AnalysisStep[]
  previewTarget: number
}

export type MutateKind = 'import' | 'remove-dataset' | 'hydrate' | 'reset-sample'

export interface MutateRequest {
  type: 'mutate'
  kind: MutateKind
  requestId: number
  source: WorkspaceSource
  mappings: Record<string, DatasetMapping>
  steps: AnalysisStep[]
  /** import：待解析的文件（File 可结构化克隆，字节不经过主线程）。 */
  files?: File[]
  /** remove-dataset：要移除的数据集 id。 */
  datasetId?: string
  /** import 首次导入（工作区为空）时，把分析栈重置为单步描述统计。 */
  resetStepsToStats?: boolean
  previewTarget: number
}

export interface ExportRequest {
  type: 'export'
  requestId: number
  valueId: string
}

/** 按可见范围重新生成降采样预览（视野联动加细，不重算步骤）。 */
export interface PreviewRequest {
  type: 'preview'
  requestId: number
  valueIds: string[]
  xRange: { min: number; max: number } | null
  target: number
}

export type WorkerRequest = RunRequest | MutateRequest | ExportRequest | PreviewRequest

/** Worker → 主线程 */
export interface RunResultMessage {
  type: 'result'
  requestId: number
  /** 回传运行时真相，主线程据此对齐（取消/崩溃后靠下一次运行收敛）。 */
  datasets: DatasetSummary[]
  mappings: Record<string, DatasetMapping>
  values: ScienceValue[]
  errors: Record<string, string>
  timings: Record<string, number>
  elapsedMs: number
}

/** import / hydrate / remove-dataset 的结果：含更新后的数据集与步骤。 */
export interface MutateResultMessage {
  type: 'mutate-result'
  requestId: number
  datasets: DatasetSummary[]
  mappings: Record<string, DatasetMapping>
  steps: AnalysisStep[]
  values: ScienceValue[]
  errors: Record<string, string>
  timings: Record<string, number>
  elapsedMs: number
}

export interface ProgressMessage {
  type: 'progress'
  requestId: number
  done: number
  total: number
}

export interface ErrorMessage {
  type: 'error'
  requestId: number
  message: string
}

export interface ExportResultMessage {
  type: 'export-result'
  requestId: number
  blob: Blob
}

export interface PreviewResultMessage {
  type: 'preview-result'
  requestId: number
  values: ScienceValue[]
}

export type WorkerResponse =
  | RunResultMessage
  | MutateResultMessage
  | ProgressMessage
  | ErrorMessage
  | ExportResultMessage
  | PreviewResultMessage

export const DEFAULT_PREVIEW_TARGET = 4000
