'use client'

/**
 * 主线程侧的 Worker 宿主：请求/响应封装 + React hook。
 * Worker 延迟创建（首次请求），因此 SSR 阶段不会触碰浏览器 API。
 *
 * Worker 会被终止（取消/重载/崩溃）；数据集由 Worker 从 IndexedDB 水合，
 * 主线程只保留元信息与配方。
 */

import { useEffect, useRef } from 'react'
import type { DatasetMapping, DatasetSummary, ScienceValue, WorkspaceSource } from '../types.ts'
import type { AnalysisStep } from '../lib/pipeline.ts'
import {
  DEFAULT_PREVIEW_TARGET,
  type MutateKind,
  type MutateRequest,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol.ts'

export interface ComputeResult {
  datasets: DatasetSummary[]
  mappings: Record<string, DatasetMapping>
  values: ScienceValue[]
  errors: Record<string, string>
  timings: Record<string, number>
  elapsedMs: number
}

export interface MutateResult extends ComputeResult {
  steps: AnalysisStep[]
}

export interface RunOptions {
  reset?: boolean
  source: WorkspaceSource
  mappings?: Record<string, DatasetMapping>
  dirtyIds?: Iterable<string>
  /** 需要从 Worker 缓存驱逐的产出 id（被删除的步骤）。 */
  evictIds?: Iterable<string>
  previewTarget?: number
}

export interface MutateOptions {
  kind: MutateKind
  source: WorkspaceSource
  mappings: Record<string, DatasetMapping>
  steps: AnalysisStep[]
  files?: File[]
  datasetId?: string
  resetStepsToStats?: boolean
  previewTarget?: number
}

export interface ComputeHost {
  run(steps: AnalysisStep[], options: RunOptions): Promise<ComputeResult>
  mutate(options: MutateOptions): Promise<MutateResult>
  exportValue(valueId: string): Promise<Blob>
  preview(valueIds: string[], xRange: { min: number; max: number } | null, target?: number): Promise<ScienceValue[]>
  /**
   * 独立驱逐产出自 Worker 缓存（与 run/mutate 同队列保序）。
   * Worker 尚未创建时为空操作（新 Worker 缓存本就为空）。
   */
  evict(ids: string[]): Promise<void>
  terminate(): void
}

export function createComputeHost(): ComputeHost {
  let worker: Worker | null = null
  let sequence = 0
  /** Worker 被终止时自增；排队中尚未发出的请求据此判为取消。 */
  let generation = 0
  /** run/mutate 串行链：保证 Worker 侧状态变更按发出顺序执行，互不交错。 */
  let queue: Promise<unknown> = Promise.resolve()
  const pending = new Map<number, {
    resolve: (result: ComputeResult | MutateResult | Blob | ScienceValue[] | undefined) => void
    reject: (error: unknown) => void
  }>()

  const rejectAll = (error: Error) => {
    for (const entry of pending.values()) {
      entry.reject(error)
    }
    pending.clear()
  }

  const ensureWorker = (): Worker => {
    if (worker) {
      return worker
    }

    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent) => {
      const message = event.data as WorkerResponse
      if (message.type === 'progress') {
        return
      }
      const entry = pending.get(message.requestId)
      if (!entry) {
        return
      }
      pending.delete(message.requestId)
      if (message.type === 'result') {
        entry.resolve({
          datasets: message.datasets,
          mappings: message.mappings,
          values: message.values,
          errors: message.errors,
          timings: message.timings,
          elapsedMs: message.elapsedMs,
        })
      } else if (message.type === 'mutate-result') {
        entry.resolve({
          datasets: message.datasets,
          mappings: message.mappings,
          steps: message.steps,
          values: message.values,
          errors: message.errors,
          timings: message.timings,
          elapsedMs: message.elapsedMs,
        })
      } else if (message.type === 'export-result') {
        entry.resolve(message.blob)
      } else if (message.type === 'preview-result') {
        entry.resolve(message.values)
      } else if (message.type === 'evict-result') {
        entry.resolve(undefined)
      } else {
        entry.reject(new Error(message.message))
      }
    })
    worker.addEventListener('error', () => {
      rejectAll(new Error('compute worker crashed'))
      worker?.terminate()
      worker = null
    })

    return worker
  }

  /** 状态类请求（run/mutate）串行执行；terminate 后排队中的任务直接判为取消。 */
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const gen = generation
    const next = queue.then(
      () => (gen === generation ? task() : Promise.reject(new Error('compute cancelled'))),
      () => (gen === generation ? task() : Promise.reject(new Error('compute cancelled'))),
    )
    queue = next.catch(() => undefined)
    return next
  }

  return {
    run(steps, options) {
      return enqueue(() => {
        const instance = ensureWorker()
        const requestId = (sequence += 1)
        return new Promise<ComputeResult>((resolve, reject) => {
          pending.set(requestId, { resolve: (result) => resolve(result as ComputeResult), reject })
          const request: WorkerRequest = {
            type: 'run',
            requestId,
            reset: Boolean(options.reset),
            source: options.source,
            mappings: options.mappings,
            dirtyIds: options.dirtyIds ? [...options.dirtyIds] : [],
            evictIds: options.evictIds ? [...options.evictIds] : [],
            steps,
            previewTarget: options.previewTarget ?? DEFAULT_PREVIEW_TARGET,
          }
          instance.postMessage(request)
        })
      })
    },
    mutate(options) {
      return enqueue(() => {
        const instance = ensureWorker()
        const requestId = (sequence += 1)
        return new Promise<MutateResult>((resolve, reject) => {
          pending.set(requestId, { resolve: (result) => resolve(result as MutateResult), reject })
          const request: MutateRequest = {
            type: 'mutate',
            kind: options.kind,
            requestId,
            source: options.source,
            mappings: options.mappings,
            steps: options.steps,
            files: options.files,
            datasetId: options.datasetId,
            resetStepsToStats: options.resetStepsToStats,
            previewTarget: options.previewTarget ?? DEFAULT_PREVIEW_TARGET,
          }
          instance.postMessage(request)
        })
      })
    },
    exportValue(valueId) {
      const instance = ensureWorker()
      const requestId = (sequence += 1)
      return new Promise<Blob>((resolve, reject) => {
        pending.set(requestId, { resolve: (result) => resolve(result as Blob), reject })
        instance.postMessage({ type: 'export', requestId, valueId } satisfies WorkerRequest)
      })
    },
    preview(valueIds, xRange, target = DEFAULT_PREVIEW_TARGET) {
      const instance = ensureWorker()
      const requestId = (sequence += 1)
      return new Promise<ScienceValue[]>((resolve, reject) => {
        pending.set(requestId, { resolve: (result) => resolve(result as ScienceValue[]), reject })
        instance.postMessage({ type: 'preview', requestId, valueIds, xRange, target } satisfies WorkerRequest)
      })
    },
    evict(ids) {
      // 尚无 Worker 时无缓存可清；直接空操作，避免为一个空驱逐创建 Worker。
      if (ids.length === 0 || !worker) {
        return Promise.resolve()
      }
      return enqueue<void>(() => {
        const instance = worker
        if (!instance) {
          return Promise.resolve()
        }
        const requestId = (sequence += 1)
        return new Promise<void>((resolve, reject) => {
          pending.set(requestId, { resolve: () => resolve(), reject })
          instance.postMessage({ type: 'evict', requestId, ids } satisfies WorkerRequest)
        })
      })
    },
    terminate() {
      // 自增 generation：排队中尚未发出的 run/mutate 会在出队时直接判为取消。
      generation += 1
      rejectAll(new Error('compute cancelled'))
      worker?.terminate()
      worker = null
    },
  }
}

export function useComputeHost(): ComputeHost {
  const hostRef = useRef<ComputeHost | null>(null)
  if (!hostRef.current) {
    hostRef.current = createComputeHost()
  }
  useEffect(() => () => hostRef.current?.terminate(), [])
  return hostRef.current
}
