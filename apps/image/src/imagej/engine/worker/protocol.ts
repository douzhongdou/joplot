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

export interface RunRequest {
  type: 'run'
  id: number
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  throughStepId?: string
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

export type WorkerRequest = ImportRequest | ImportStackRequest | RunRequest | CancelRequest | DisposeRequest

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
  ms: number
  estimatedBytes: number
}

export interface ErrorResponse {
  type: 'error'
  id: number
  code: string
  message: string
}

export type WorkerResponse = ImportedResponse | ResultResponse | ErrorResponse

/** 一步作用范围的可序列化描述（RecipeStep 的 scope 已满足）。 */
export type { StepScope }
