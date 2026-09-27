/**
 * 常驻计算 Worker。
 *
 * 数据驻留在 Worker 内（`store` / `cache`），主线程只发流水线描述、只收降采样预览。
 *
 * 分步运行：请求带 `startIndex`，之前的步骤直接复用缓存结果，只重算 startIndex 起的部分。
 * 只有当缓存缺失（例如刚 reset）时，才回退为从第 0 步开始。
 */

import type { ScienceValue } from '../types.ts'
import { createSampleWorkspace } from '../lib/workspace.ts'
import { runPipeline } from '../lib/pipeline.ts'
import { toPreview } from './preview.ts'
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
  if (request.type !== 'run') {
    return
  }

  const started = performance.now()
  try {
    if (request.reset || !base) {
      base = createSampleWorkspace().base
      cache.clear()
    }

    const total = request.steps.length
    let start = Math.max(0, Math.min(request.startIndex, total))

    // 前缀缓存必须完整，否则回退到从头算。
    for (let i = 0; i < start; i += 1) {
      if (!cache.has(request.steps[i].outputId)) {
        start = 0
        break
      }
    }

    const seed: ScienceValue[] = [...base]
    for (let i = 0; i < start; i += 1) {
      const cached = cache.get(request.steps[i].outputId)
      if (cached) {
        seed.push(cached)
      }
    }

    const { values, errors, timings } = runPipeline(seed, request.steps.slice(start))
    for (const value of values) {
      cache.set(value.id, value)
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
