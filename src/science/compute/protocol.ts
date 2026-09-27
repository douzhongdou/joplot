import type { ScienceValue } from '../types.ts'
import type { AnalysisStep } from '../lib/pipeline.ts'

/** 主线程 → Worker */
export interface RunRequest {
  type: 'run'
  requestId: number
  reset: boolean
  /** 需要重算的步骤 id；其余步骤复用 Worker 侧缓存。 */
  dirtyIds: string[]
  steps: AnalysisStep[]
  previewTarget: number
}

export type WorkerRequest = RunRequest

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

export type WorkerResponse = RunResultMessage | ProgressMessage | ErrorMessage

export const DEFAULT_PREVIEW_TARGET = 4000
