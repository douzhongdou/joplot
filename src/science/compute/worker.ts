/**
 * 常驻计算 Worker。
 *
 * 数据驻留在 Worker 内（`cache`），主线程只发可重算的步骤集合、只收降采样预览。
 *
 * 依赖级增量：只有 `dirtyIds` 里的步骤会重算；其余步骤直接复用缓存输出。
 * 若某个干净步骤的输入尚未就绪（例如它的上游这次被算过），按顺序自然满足。
 */

import type { ScienceValue } from '../types.ts'
import { createSampleWorkspace } from '../lib/workspace.ts'
import { runStep } from '../lib/pipeline.ts'
import { valueToCsv } from '../lib/export.ts'
import { toPreview, toPreviewInRange } from './preview.ts'
import type { WorkerRequest, WorkerResponse } from './protocol.ts'

interface WorkerScope {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}

const scope = self as unknown as WorkerScope

let base: ScienceValue[] | null = null
const cache = new Map<string, ScienceValue>()

function post(message: WorkerResponse): void {
  scope.postMessage(message)
}

scope.addEventListener('message', (event: MessageEvent) => {
  const request = event.data as WorkerRequest
  if (request.type === 'export') {
    try {
      const value = base?.find((candidate) => candidate.id === request.valueId) ?? cache.get(request.valueId)
      if (!value) throw new Error(`Value "${request.valueId}" is unavailable`)
      post({ type: 'export-result', requestId: request.requestId, blob: valueToCsv(value) })
    } catch (error) {
      post({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) })
    }
    return
  }
  if (request.type === 'preview') {
    try {
      const values = request.valueIds.map((valueId) => {
        const value = base?.find((candidate) => candidate.id === valueId) ?? cache.get(valueId)
        if (!value) throw new Error(`Value "${valueId}" is unavailable`)
        return toPreviewInRange(value, request.xRange, request.target)
      })
      post({ type: 'preview-result', requestId: request.requestId, values })
    } catch (error) {
      post({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) })
    }
    return
  }
  if (request.type !== 'run') {
    return
  }

  const started = performance.now()
  try {
    if (request.reset || !base) {
      base = request.base ?? createSampleWorkspace().base
      cache.clear()
    }

    const dirty = new Set(request.dirtyIds)
    const available = new Map<string, ScienceValue>()
    for (const value of base) {
      available.set(value.id, value)
    }

    const values: ScienceValue[] = [...base]
    const errors: Record<string, string> = {}
    const timings: Record<string, number> = {}

    for (const step of request.steps) {
      const cached = cache.get(step.outputId)

      if (!dirty.has(step.id) && cached) {
        available.set(step.outputId, cached)
        values.push(cached)
        continue
      }

      const stepStarted = performance.now()
      try {
        const value = runStep(
          step,
          available.get(step.inputId),
          step.secondInputId ? available.get(step.secondInputId) : undefined,
        )
        available.set(step.outputId, value)
        cache.set(step.outputId, value)
        values.push(value)
      } catch (error) {
        cache.delete(step.outputId)
        errors[step.id] = error instanceof Error ? error.message : String(error)
      }
      timings[step.id] = performance.now() - stepStarted
    }

    post({
      type: 'result',
      requestId: request.requestId,
      values: values.map((value) => toPreview(value, request.previewTarget)),
      errors,
      timings,
      elapsedMs: performance.now() - started,
    })
  } catch (error) {
    post({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) })
  }
})

export {}
