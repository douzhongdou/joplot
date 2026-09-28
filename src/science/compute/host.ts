'use client'

/**
 * 主线程侧的 Worker 宿主：请求/响应封装 + React hook。
 * Worker 延迟创建（首次 run），因此 SSR 阶段不会触碰浏览器 API。
 */

import { useEffect, useRef } from 'react'
import type { ScienceValue } from '../types.ts'
import type { AnalysisStep } from '../lib/pipeline.ts'
import { DEFAULT_PREVIEW_TARGET, type WorkerRequest, type WorkerResponse } from './protocol.ts'

export interface ComputeResult {
  values: ScienceValue[]
  errors: Record<string, string>
  timings: Record<string, number>
  elapsedMs: number
}

export interface ComputeHost {
  run(
    steps: AnalysisStep[],
    options?: { reset?: boolean; base?: ScienceValue[]; dirtyIds?: Iterable<string>; previewTarget?: number },
  ): Promise<ComputeResult>
  exportValue(valueId: string): Promise<Blob>
  preview(valueIds: string[], xRange: { min: number; max: number } | null, target?: number): Promise<ScienceValue[]>
  terminate(): void
}

export function createComputeHost(): ComputeHost {
  let worker: Worker | null = null
  let sequence = 0
  const pending = new Map<number, {
    resolve: (result: ComputeResult | Blob | ScienceValue[]) => void
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
          values: message.values,
          errors: message.errors,
          timings: message.timings,
          elapsedMs: message.elapsedMs,
        })
      } else if (message.type === 'export-result') {
        entry.resolve(message.blob)
      } else if (message.type === 'preview-result') {
        entry.resolve(message.values)
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

  return {
    run(steps, options = {}) {
      const instance = ensureWorker()
      const requestId = (sequence += 1)
      return new Promise<ComputeResult>((resolve, reject) => {
        pending.set(requestId, { resolve: (result) => resolve(result as ComputeResult), reject })
        const request: WorkerRequest = {
          type: 'run',
          requestId,
          reset: Boolean(options.reset),
          base: options.base,
          dirtyIds: options.dirtyIds ? [...options.dirtyIds] : [],
          steps,
          previewTarget: options.previewTarget ?? DEFAULT_PREVIEW_TARGET,
        }
        instance.postMessage(request)
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
    terminate() {
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
