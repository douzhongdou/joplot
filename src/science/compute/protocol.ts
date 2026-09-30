import type { DatasetMapping, DatasetSummary, ScienceValue, WorkspaceSource } from '../types.ts'
import type { AnalysisStep } from '../lib/pipeline.ts'
import type { DataTablePage } from '../lib/dataTable.ts'

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
  /** 需要从缓存驱逐的产出 id（被删除的步骤），避免幽灵值被预览/导出取到。 */
  evictIds?: string[]
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

export interface DatasetPageRequest {
  type: 'dataset-page'
  requestId: number
  datasetId: string
  offset: number
  limit: number
}

export interface ValuePageRequest {
  type: 'value-page'
  requestId: number
  valueId: string
  offset: number
  limit: number
}

export interface ExportDatasetRequest {
  type: 'export-dataset'
  requestId: number
  datasetId: string
}

/** 独立驱逐：删除步骤后立即清 Worker 缓存，不依赖后续 run（autoRun 关闭时也要生效）。 */
export interface EvictRequest {
  type: 'evict'
  requestId: number
  ids: string[]
}

/** 按可见范围重新生成降采样预览（视野联动加细，不重算步骤）。 */
export interface PreviewRequest {
  type: 'preview'
  requestId: number
  valueIds: string[]
  xRange: { min: number; max: number } | null
  target: number
}

export type WorkerRequest = RunRequest | MutateRequest | ExportRequest | ExportDatasetRequest | DatasetPageRequest | ValuePageRequest | PreviewRequest | EvictRequest

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

export interface DatasetPageResultMessage {
  type: 'dataset-page-result'
  requestId: number
  page: DataTablePage
}

export interface PreviewResultMessage {
  type: 'preview-result'
  requestId: number
  values: ScienceValue[]
}

export interface EvictResultMessage {
  type: 'evict-result'
  requestId: number
}

export type WorkerResponse =
  | RunResultMessage
  | MutateResultMessage
  | ProgressMessage
  | ErrorMessage
  | ExportResultMessage
  | DatasetPageResultMessage
  | PreviewResultMessage
  | EvictResultMessage

export const DEFAULT_PREVIEW_TARGET = 4000
