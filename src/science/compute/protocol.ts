import type { ScienceValue } from '../types.ts'
import type { AnalysisStep } from '../lib/pipeline.ts'

/** 主线程 → Worker */
export interface RunRequest {
  type: 'run'
  requestId: number
  reset: boolean
  /** Full input values, supplied only when the workspace changes. */
  base?: ScienceValue[]
  /** 需要重算的步骤 id；其余步骤复用 Worker 侧缓存。 */
  dirtyIds: string[]
  steps: AnalysisStep[]
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

export type WorkerRequest = RunRequest | ExportRequest | PreviewRequest

/** Worker → 主线程 */
export interface RunResultMessage {
  type: 'result'
  requestId: number
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

export type WorkerResponse = RunResultMessage | ProgressMessage | ErrorMessage | ExportResultMessage | PreviewResultMessage

export const DEFAULT_PREVIEW_TARGET = 4000
