/**
 * Worker ↔ 主线程协议。
 *
 * 解码与重计算在 Worker 中执行；主线程只发送文件、Recipe 与切片选择，接收最终图像与
 * 分析结果。图像块以 ArrayBuffer 转移（零拷贝）回主线程，发送侧随后不得再引用。
 */
import type { Dataset } from '../dataset.ts'
import type { SliceSelection } from '../dataset.ts'
import type { Recipe, StepScope } from '../recipe.ts'
import type { ChannelStats, ParticleRow } from '../../lib/engineTypes.ts'
import type { Dtype, Axes, Region } from '../types.ts'
import type { ImageAnalysis } from '../analysis.ts'

export interface SerializedBlock {
  dtype: Dtype
  axes: Axes
  shape: number[]
  region: Region
  data: ArrayBuffer
}

export interface StepOutcomeWire {
  stepId: string
  status: 'ok' | 'error'
  error?: string
  stats?: ChannelStats[]
  table?: ParticleRow[]
  ms: number
}

export interface ImportRequest {
  type: 'import'
  id: number
  file: File
}

/** 把多个文件合成一个 Stack 导入。 */
export interface ImportStackRequest {
  type: 'import-stack'
  id: number
  files: File[]
}

/** 只计算当前切片的整帧分析（不返回图像）；用于把分析移出显示路径。 */
export interface AnalyzeRequest {
  type: 'analyze'
  id: number
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  throughStepId?: string
}

export interface RunRequest {
  type: 'run'
  id: number
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  throughStepId?: string
  analyze?: boolean
}

export interface CancelRequest {
  type: 'cancel'
  id: number
  targetId: number
}

export interface DisposeRequest {
  type: 'dispose'
  id: number
  datasetId?: string
}

export type WorkerRequest = ImportRequest | ImportStackRequest | RunRequest | AnalyzeRequest | CancelRequest | DisposeRequest

export interface ImportedResponse {
  type: 'imported'
  id: number
  dataset: Dataset
}

export interface ResultResponse {
  type: 'result'
  id: number
  results: StepOutcomeWire[]
  image: SerializedBlock | null
  stats?: ChannelStats[]
  table?: ParticleRow[]
  analysis?: ImageAnalysis
  ms: number
  estimatedBytes: number
}

export interface ErrorResponse {
  type: 'error'
  id: number
  code: string
  message: string
}

export interface AnalysisResponse {
  type: 'analysis'
  id: number
  analysis?: ImageAnalysis
}

export type WorkerResponse = ImportedResponse | ResultResponse | AnalysisResponse | ErrorResponse

/** 一步作用范围的可序列化描述（RecipeStep 的 scope 已满足）。 */
export type { StepScope }
