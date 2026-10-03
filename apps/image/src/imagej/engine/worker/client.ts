/**
 * 引擎客户端：统一 Worker 与主线程回退两种执行方式。
 *
 * Worker 不可用（SSR、旧浏览器、打包失败）时回退到主线程宿主，行为保持一致，
 * 只是解码与计算会占用 UI 线程。结果图像块从 ArrayBuffer 反序列化。
 */
import type { Dataset, SliceSelection } from '../dataset.ts'
import type { Recipe } from '../recipe.ts'
import type { Dtype, ImageBlock, PixelArray, Region } from '../types.ts'
import type { ChannelStats, ParticleRow } from '../../lib/engineTypes.ts'
import type { ImageAnalysis } from '../analysis.ts'
import type { ResultResponse, SerializedBlock, StepOutcomeWire, WorkerRequest, WorkerResponse } from './protocol.ts'
import { EngineHost } from './host.ts'

export interface EngineRunOptions {
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  throughStepId?: string
  /** 请求引擎顺带产出整帧分析。 */
  analyze?: boolean
}

export interface EngineResult {
  results: StepOutcomeWire[]
  image: ImageBlock | null
  stats?: ChannelStats[]
  table?: ParticleRow[]
  analysis?: ImageAnalysis
  ms: number
  estimatedBytes: number
}

export interface EngineClient {
  readonly kind: 'worker' | 'inline'
  import(file: File): Promise<Dataset>
  importStack(files: File[]): Promise<Dataset>
  run(options: EngineRunOptions): Promise<EngineResult>
  cancel(): void
  dispose(datasetId?: string): void
  terminate(): void
}

function decodeBuffer(dtype: Dtype, buffer: ArrayBuffer): PixelArray {
  switch (dtype) {
    case 'uint8': return new Uint8Array(buffer)
    case 'uint16': return new Uint16Array(buffer)
    case 'int16': return new Int16Array(buffer)
    case 'float32': return new Float32Array(buffer)
  }
}

export function deserializeBlock(serialized: SerializedBlock): ImageBlock {
  return {
    dtype: serialized.dtype,
    axes: serialized.axes,
    shape: serialized.shape,
    region: serialized.region,
    data: decodeBuffer(serialized.dtype, serialized.data),
  }
}

interface Pending {
  resolve(value: WorkerResponse): void
  reject(error: Error): void
}

class WorkerEngineClient implements EngineClient {
  readonly kind = 'worker' as const
  private readonly worker: Worker
  private readonly pending = new Map<number, Pending>()
  private nextId = 1

  constructor(worker: Worker) {
    this.worker = worker
    this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      if (response.type === 'error') pending.reject(new Error(response.message))
      else pending.resolve(response)
    })
    this.worker.addEventListener('error', (event) => {
      const error = new Error(event.message || 'Worker 运行错误')
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    })
  }

  private request(message: WorkerRequest, transfer?: Transferable[]): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject })
      if (transfer && transfer.length > 0) this.worker.postMessage(message, transfer)
      else this.worker.postMessage(message)
    })
  }

  async import(file: File): Promise<Dataset> {
    const response = await this.request({ type: 'import', id: this.nextId++, file })
    if (response.type !== 'imported') throw new Error('Worker 未返回导入结果')
    return response.dataset
  }

  async importStack(files: File[]): Promise<Dataset> {
    const response = await this.request({ type: 'import-stack', id: this.nextId++, files })
    if (response.type !== 'imported') throw new Error('Worker 未返回导入结果')
    return response.dataset
  }

  async run(options: EngineRunOptions): Promise<EngineResult> {
    const response = (await this.request({
      type: 'run',
      id: this.nextId++,
      datasetId: options.datasetId,
      recipe: options.recipe,
      selection: options.selection,
      roi: options.roi,
      throughStepId: options.throughStepId,
      analyze: options.analyze,
    })) as ResultResponse
    return {
      results: response.results,
      image: response.image ? deserializeBlock(response.image) : null,
      stats: response.stats,
      table: response.table,
      analysis: response.analysis,
      ms: response.ms,
      estimatedBytes: response.estimatedBytes,
    }
  }

  cancel(): void {
    this.worker.postMessage({ type: 'cancel', id: this.nextId++, targetId: 0 } satisfies WorkerRequest)
  }

  dispose(datasetId?: string): void {
    this.worker.postMessage({ type: 'dispose', id: this.nextId++, datasetId } satisfies WorkerRequest)
  }

  terminate(): void {
    this.worker.terminate()
    this.pending.clear()
  }
}

class InlineEngineClient implements EngineClient {
  readonly kind = 'inline' as const
  private readonly host = new EngineHost()

  async import(file: File): Promise<Dataset> {
    const result = await this.host.import(file)
    return result.dataset
  }

  async importStack(files: File[]): Promise<Dataset> {
    const result = await this.host.importStack(files)
    return result.dataset
  }

  async run(options: EngineRunOptions): Promise<EngineResult> {
    const outcome = await this.host.run(options)
    return {
      results: outcome.results.map(({ stepId, status, error, stats, table, ms }) => ({ stepId, status, error, stats, table, ms })),
      image: outcome.image,
      stats: [...outcome.results].reverse().find((result) => result.stats)?.stats,
      table: [...outcome.results].reverse().find((result) => result.table)?.table,
      analysis: outcome.analysis,
      ms: outcome.ms,
      estimatedBytes: outcome.estimatedBytes,
    }
  }

  cancel(): void {
    this.host.cancel()
  }

  dispose(datasetId?: string): void {
    this.host.dispose(datasetId)
  }

  terminate(): void {
    this.host.dispose()
  }
}

/** 创建引擎客户端；默认优先 Worker，失败时回退主线程。 */
export function createEngineClient(options?: { preferWorker?: boolean; workerFactory?: () => Worker }): EngineClient {
  // React 可能丢弃一次 render；推迟到首次请求再创建 Worker，避免泄漏后台线程。
  let client: EngineClient | undefined
  const get = (): EngineClient => client ??= createActiveEngineClient(options)
  return {
    kind: options?.preferWorker !== false && typeof Worker !== 'undefined' ? 'worker' : 'inline',
    import: (file) => get().import(file), importStack: (files) => get().importStack(files), run: (request) => get().run(request),
    cancel: () => client?.cancel(), dispose: (datasetId) => client?.dispose(datasetId), terminate: () => { client?.terminate(); client = undefined },
  }
}

function createActiveEngineClient(options?: { preferWorker?: boolean; workerFactory?: () => Worker }): EngineClient {
  const preferWorker = options?.preferWorker ?? true
  if (preferWorker) {
    try {
      const worker = options?.workerFactory
        ? options.workerFactory()
        : new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
      return new WorkerEngineClient(worker)
    } catch {
      // 回退
    }
  }
  return new InlineEngineClient()
}
