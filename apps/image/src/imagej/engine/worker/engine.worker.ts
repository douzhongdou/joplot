/**
 * 计算 Worker 入口。
 *
 * 解码与重计算都在这里执行，主线程只发送文件与 Recipe。图像块以 ArrayBuffer 转移回主线程。
 * 通过 `new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })` 载入。
 */
import { EngineHost } from './host.ts'
import type { ImageBlock } from '../types.ts'
import {
  type ImportedResponse,
  type ResultResponse,
  type SerializedBlock,
  type StepOutcomeWire,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol.ts'

const host = new EngineHost()

type WorkerScope = {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void
}

const scope = self as unknown as WorkerScope

function serializeBlock(block: ImageBlock): { payload: SerializedBlock; transfer: Transferable[] } {
  const view = block.data
  const transfer: Transferable[] = []
  let buffer: ArrayBuffer
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    buffer = view.buffer as ArrayBuffer
    transfer.push(buffer)
  } else {
    buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
  }
  return {
    payload: {
      dtype: block.dtype,
      axes: block.axes,
      shape: [...block.shape],
      region: { start: [...block.region.start], shape: [...block.region.shape] },
      data: buffer,
    },
    transfer,
  }
}

function toWire(outcomes: Awaited<ReturnType<EngineHost['run']>>['results']): StepOutcomeWire[] {
  return outcomes.map(({ stepId, status, error, stats, table, ms }) => ({ stepId, status, error, stats, table, ms }))
}

async function handle(request: WorkerRequest): Promise<void> {
  switch (request.type) {
    case 'import': {
      const result = await host.import(request.file, undefined, request.options)
      const response: ImportedResponse = { type: 'imported', id: request.id, dataset: result.dataset }
      scope.postMessage(response)
      return
    }
    case 'import-stack': {
      const result = await host.importStack(request.files, undefined, request.options)
      const response: ImportedResponse = { type: 'imported', id: request.id, dataset: result.dataset }
      scope.postMessage(response)
      return
    }
    case 'analyze': {
      const analysis = await host.analyze(request)
      scope.postMessage({ type: 'analysis', id: request.id, analysis })
      return
    }
    case 'stack-stats': {
      const stats = await host.stackStats(request)
      scope.postMessage({ type: 'stack-stats', id: request.id, stats })
      return
    }
    case 'project': {
      const dataset = await host.project(request)
      scope.postMessage({ type: 'project', id: request.id, dataset })
      return
    }
    case 'montage': {
      const dataset = await host.montage(request)
      scope.postMessage({ type: 'montage', id: request.id, dataset })
      return
    }
    case 'montage-to-stack': {
      const dataset = await host.montageToStack(request)
      scope.postMessage({ type: 'montage-to-stack', id: request.id, dataset })
      return
    }
    case 'reslice': {
      const dataset = await host.reslice(request)
      scope.postMessage({ type: 'reslice', id: request.id, dataset })
      return
    }
    case 'orthogonal': {
      const datasets = await host.orthogonal(request)
      scope.postMessage({ type: 'orthogonal', id: request.id, datasets })
      return
    }
    case 'stack-profiles': {
      const profiles = await host.stackProfiles(request)
      scope.postMessage({ type: 'stack-profiles', id: request.id, profiles })
      return
    }
    case 'restructure': {
      const dataset = await host.restructure(request)
      scope.postMessage({ type: 'restructure', id: request.id, dataset })
      return
    }
    case 'combine': {
      const dataset = await host.combine(request)
      scope.postMessage({ type: 'combine', id: request.id, dataset })
      return
    }
    case 'label': {
      const dataset = await host.labelStack(request)
      scope.postMessage({ type: 'label', id: request.id, dataset })
      return
    }
    case 'project-3d': {
      const dataset = await host.project3d(request)
      scope.postMessage({ type: 'project-3d', id: request.id, dataset })
      return
    }
    case 'remontage': {
      const dataset = await host.remontage(request)
      scope.postMessage({ type: 'remontage', id: request.id, dataset })
      return
    }
    case 'run': {
      const outcome = await host.run(request)
      const response: ResultResponse = {
        type: 'result',
        id: request.id,
        results: toWire(outcome.results),
        image: null,
        ms: outcome.ms,
        estimatedBytes: outcome.estimatedBytes,
      }
      const transfer: Transferable[] = []
      if (outcome.image) {
        const serialized = serializeBlock(outcome.image)
        response.image = serialized.payload
        transfer.push(...serialized.transfer)
      }
      const lastStats = [...outcome.results].reverse().find((result) => result.stats)?.stats
      const lastTable = [...outcome.results].reverse().find((result) => result.table)?.table
      if (lastStats) response.stats = lastStats
      if (lastTable) response.table = lastTable
      if (outcome.analysis) response.analysis = outcome.analysis
      scope.postMessage(response, transfer)
      return
    }
    case 'cancel': {
      host.cancel()
      return
    }
    case 'dispose': {
      host.dispose(request.datasetId)
      return
    }
  }
}

scope.addEventListener('message', (event) => {
  const request = event.data
  handle(request).catch((error: unknown) => {
    scope.postMessage({
      type: 'error',
      id: request.id,
      code: 'engine',
      message: error instanceof Error ? error.message : String(error),
    })
  })
})
