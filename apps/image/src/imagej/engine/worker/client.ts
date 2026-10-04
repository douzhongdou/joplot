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
import type { StackStatsResult } from '../stackStats.ts'
import type { StackProfilesResult } from '../stackProfiles.ts'
import type { ResultResponse, SerializedBlock, StepOutcomeWire, WorkerRequest, WorkerResponse, AnalysisResponse, StackStatsResponse, StackProfilesResponse, ProjectResponse, MontageResponse, MontageToStackResponse, ResliceResponse, OrthogonalResponse, RestructureResponse, CombineResponse, LabelResponse, Project3dResponse, RemontageResponse } from './protocol.ts'
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

/** 整栈逐页统计的请求参数（Measure Stack / Statistics / Plot Z-axis Profile 共用）。 */
export interface StackStatsOptions {
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  axis?: 'z' | 't' | 'c'
}

/** Z 投影的请求参数（Z Project... / Grouped Z Project...）。 */
export interface ProjectOptions {
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  axis?: 'z' | 't' | 'c'
  from?: number
  to?: number
  method: 'average' | 'max' | 'min' | 'sum' | 'sd' | 'median'
  groupSize?: number
  /** 对每条时间帧各投影一次（ImageJ 的 All time frames）。 */
  allTimeFrames?: boolean
  title?: string
}

/** Make Montage 的请求参数。 */
export interface MontageOptions {
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  axis?: 'z' | 't' | 'c'
  from?: number
  to?: number
  increment?: number
  columns?: number
  rows?: number
  scale?: number
  borderWidth?: number
  labelSlices?: boolean
  fontSize?: number
  labels?: string[]
  title?: string
}

/** Montage to Stack 的请求参数。 */
export interface MontageToStackOptions {
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  columns?: number
  rows?: number
  borderWidth?: number
  title?: string
}

/** Reslice 的请求参数。 */
export interface ResliceOptions {
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  bounds?: { x: number; y: number; width: number; height: number }
  axis?: 'z' | 't' | 'c'
  from?: number
  to?: number
  spacing?: number
  startAt?: 'top' | 'left' | 'bottom' | 'right'
  flip?: boolean
  rotate?: boolean
  title?: string
}

/** Orthogonal Views 的请求参数。 */
export interface OrthogonalOptions {
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  point?: { x: number; y: number }
  axis?: 'z' | 't' | 'c'
  from?: number
  to?: number
}

/** 逐页剖面的请求参数（Plot XY Profile）。 */
export interface StackProfilesOptions {
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  line?: { points: number[]; closed?: boolean }
  axis?: 'z' | 't' | 'c'
}

/** 栈结构编辑的请求参数。 */
export interface RestructureOptions {
  datasetId: string
  op: 'reverse' | 'reduce' | 'substack' | 'delete' | 'add'
  factor?: number
  pages?: number[]
  at?: number
  count?: number
  title?: string
}

/** 重排蒙太奇的请求参数（Magic Montage Tools 的核心动作）。 */
export interface RemontageOptions {
  datasetId: string
  recipe?: Recipe
  selection?: SliceSelection
  columns: number
  rows: number
  sourceColumns?: number
  sourceRows?: number
  borderWidth?: number
  labelSlices?: boolean
  fontSize?: number
  title?: string
}

/** 3D Project 的请求参数。 */
export interface Project3dOptions {
  datasetId: string
  recipe?: Recipe
  selection?: SliceSelection
  method: 'nearest' | 'brightest' | 'mean'
  axis: 'x' | 'y' | 'z'
  initialAngle?: number
  totalRotation?: number
  angleIncrement?: number
  opacity?: number
  surfaceCueing?: number
  interiorCueing?: number
  from?: number
  to?: number
  title?: string
}

/** Label 的请求参数（把文本画进切片）。 */
export interface LabelOptions {
  datasetId: string
  recipe?: Recipe
  selection?: SliceSelection
  format: 'number' | 'zero-padded' | 'mm:ss' | 'hh:mm:ss' | 'text' | 'label'
  start?: number
  interval?: number
  text?: string
  x?: number
  y?: number
  fontSize?: number
  from?: number
  to?: number
  sliceLabels?: string[]
  title?: string
}

/** 跨数据集页合成的请求参数（Insert / Combine / Concatenate）。 */
export interface CombineOptions {
  op: 'insert' | 'combine' | 'concatenate'
  datasetId: string
  recipe?: Recipe
  datasetIds?: string[]
  otherDatasetId?: string
  x?: number
  y?: number
  vertical?: boolean
  title?: string
}

export interface EngineClient {
  readonly kind: 'worker' | 'inline'
  import(file: File): Promise<Dataset>
  importStack(files: File[]): Promise<Dataset>
  run(options: EngineRunOptions): Promise<EngineResult>
  /** 只算当前切片的整帧分析（不返回图像），用于把分析移出显示路径。 */
  analyze(options: EngineRunOptions): Promise<ImageAnalysis | undefined>
  /** 整栈逐页统计；没有可遍历的切片轴时返回 undefined。 */
  stackStats(options: StackStatsOptions): Promise<StackStatsResult | undefined>
  /** 逐页剖面（Plot XY Profile）；没有可遍历的切片轴时返回 undefined。 */
  stackProfiles(options: StackProfilesOptions): Promise<StackProfilesResult | undefined>
  /** 栈结构编辑（Reverse / Reduce / Make Substack / Delete / Add Slice）。 */
  restructure(options: RestructureOptions): Promise<Dataset | undefined>
  /** 跨数据集页合成（Insert / Combine / Concatenate）。 */
  combine(options: CombineOptions): Promise<Dataset | undefined>
  /** Label...：把文本画进切片，返回新的数据集。 */
  label(options: LabelOptions): Promise<Dataset | undefined>
  /** 3D Project：逐角度旋转投影，返回新的数据集。 */
  project3d(options: Project3dOptions): Promise<Dataset | undefined>
  /** 重排蒙太奇：按新行列重拼，返回新的数据集。 */
  remontage(options: RemontageOptions): Promise<Dataset | undefined>
  /** Z 投影；结果作为新 Dataset 注册在引擎侧，返回其元信息。 */
  project(options: ProjectOptions): Promise<Dataset | undefined>
  /** Make Montage；结果同样是引擎侧注册的新 Dataset。 */
  montage(options: MontageOptions): Promise<Dataset | undefined>
  /** Montage to Stack：把蒙太奇切回多页栈。 */
  montageToStack(options: MontageToStackOptions): Promise<Dataset | undefined>
  /** Reslice：沿选区垂直方向重切成新栈。 */
  reslice(options: ResliceOptions): Promise<Dataset | undefined>
  /** Orthogonal Views：重建 XZ 与 YZ 两张视图（各是一个新数据集）。 */
  orthogonal(options: OrthogonalOptions): Promise<Dataset[]>
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

  async analyze(options: EngineRunOptions): Promise<ImageAnalysis | undefined> {
    const response = (await this.request({
      type: 'analyze',
      id: this.nextId++,
      datasetId: options.datasetId,
      recipe: options.recipe,
      selection: options.selection,
      throughStepId: options.throughStepId,
    })) as AnalysisResponse
    return response.analysis
  }

  async stackStats(options: StackStatsOptions): Promise<StackStatsResult | undefined> {
    const response = (await this.request({
      type: 'stack-stats',
      id: this.nextId++,
      datasetId: options.datasetId,
      recipe: options.recipe,
      selection: options.selection,
      roi: options.roi,
      axis: options.axis,
    })) as StackStatsResponse
    return response.stats
  }

  async stackProfiles(options: StackProfilesOptions): Promise<StackProfilesResult | undefined> {
    const response = (await this.request({
      type: 'stack-profiles',
      id: this.nextId++,
      datasetId: options.datasetId,
      recipe: options.recipe,
      selection: options.selection,
      roi: options.roi,
      line: options.line,
      axis: options.axis,
    })) as StackProfilesResponse
    return response.profiles
  }

  async restructure(options: RestructureOptions): Promise<Dataset | undefined> {
    const response = (await this.request({
      type: 'restructure',
      id: this.nextId++,
      datasetId: options.datasetId,
      op: options.op,
      factor: options.factor,
      pages: options.pages,
      at: options.at,
      count: options.count,
      title: options.title,
    })) as RestructureResponse
    return response.dataset
  }

  async combine(options: CombineOptions): Promise<Dataset | undefined> {
    const response = (await this.request({
      type: 'combine',
      id: this.nextId++,
      op: options.op,
      datasetId: options.datasetId,
      recipe: options.recipe,
      datasetIds: options.datasetIds,
      otherDatasetId: options.otherDatasetId,
      x: options.x,
      y: options.y,
      vertical: options.vertical,
      title: options.title,
    })) as CombineResponse
    return response.dataset
  }

  async label(options: LabelOptions): Promise<Dataset | undefined> {
    const response = (await this.request({
      type: 'label',
      id: this.nextId++,
      datasetId: options.datasetId,
      recipe: options.recipe,
      selection: options.selection,
      format: options.format,
      start: options.start,
      interval: options.interval,
      text: options.text,
      x: options.x,
      y: options.y,
      fontSize: options.fontSize,
      from: options.from,
      to: options.to,
      sliceLabels: options.sliceLabels,
      title: options.title,
    })) as LabelResponse
    return response.dataset
  }

  async project3d(options: Project3dOptions): Promise<Dataset | undefined> {
    const response = (await this.request({
      type: 'project-3d',
      id: this.nextId++,
      datasetId: options.datasetId,
      recipe: options.recipe,
      selection: options.selection,
      method: options.method,
      axis: options.axis,
      initialAngle: options.initialAngle,
      totalRotation: options.totalRotation,
      angleIncrement: options.angleIncrement,
      opacity: options.opacity,
      surfaceCueing: options.surfaceCueing,
      interiorCueing: options.interiorCueing,
      from: options.from,
      to: options.to,
      title: options.title,
    })) as Project3dResponse
    return response.dataset
  }

  async remontage(options: RemontageOptions): Promise<Dataset | undefined> {
    const response = (await this.request({
      type: 'remontage',
      id: this.nextId++,
      datasetId: options.datasetId,
      recipe: options.recipe,
      selection: options.selection,
      columns: options.columns,
      rows: options.rows,
      sourceColumns: options.sourceColumns,
      sourceRows: options.sourceRows,
      borderWidth: options.borderWidth,
      labelSlices: options.labelSlices,
      fontSize: options.fontSize,
      title: options.title,
    })) as RemontageResponse
    return response.dataset
  }

  async project(options: ProjectOptions): Promise<Dataset | undefined> {
    const response = (await this.request({
      type: 'project',
      id: this.nextId++,
      datasetId: options.datasetId,
      recipe: options.recipe,
      selection: options.selection,
      roi: options.roi,
      axis: options.axis,
      from: options.from,
      to: options.to,
      method: options.method,
      groupSize: options.groupSize,
      allTimeFrames: options.allTimeFrames,
      title: options.title,
    })) as ProjectResponse
    return response.dataset
  }

  async montage(options: MontageOptions): Promise<Dataset | undefined> {
    const response = (await this.request({
      type: 'montage',
      id: this.nextId++,
      datasetId: options.datasetId,
      recipe: options.recipe,
      selection: options.selection,
      roi: options.roi,
      axis: options.axis,
      from: options.from,
      to: options.to,
      increment: options.increment,
      columns: options.columns,
      rows: options.rows,
      scale: options.scale,
      borderWidth: options.borderWidth,
      labelSlices: options.labelSlices,
      fontSize: options.fontSize,
      labels: options.labels,
      title: options.title,
    })) as MontageResponse
    return response.dataset
  }

  async montageToStack(options: MontageToStackOptions): Promise<Dataset | undefined> {
    const response = (await this.request({
      type: 'montage-to-stack',
      id: this.nextId++,
      datasetId: options.datasetId,
      recipe: options.recipe,
      selection: options.selection,
      roi: options.roi,
      columns: options.columns,
      rows: options.rows,
      borderWidth: options.borderWidth,
      title: options.title,
    })) as MontageToStackResponse
    return response.dataset
  }

  async reslice(options: ResliceOptions): Promise<Dataset | undefined> {
    const response = (await this.request({
      type: 'reslice',
      id: this.nextId++,
      datasetId: options.datasetId,
      recipe: options.recipe,
      selection: options.selection,
      bounds: options.bounds,
      axis: options.axis,
      from: options.from,
      to: options.to,
      spacing: options.spacing,
      startAt: options.startAt,
      flip: options.flip,
      rotate: options.rotate,
      title: options.title,
    })) as ResliceResponse
    return response.dataset
  }

  async orthogonal(options: OrthogonalOptions): Promise<Dataset[]> {
    const response = (await this.request({
      type: 'orthogonal',
      id: this.nextId++,
      datasetId: options.datasetId,
      recipe: options.recipe,
      selection: options.selection,
      point: options.point,
      axis: options.axis,
      from: options.from,
      to: options.to,
    })) as OrthogonalResponse
    return response.datasets
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

  async analyze(options: EngineRunOptions): Promise<ImageAnalysis | undefined> {
    return this.host.analyze(options)
  }

  async stackStats(options: StackStatsOptions): Promise<StackStatsResult | undefined> {
    return this.host.stackStats(options)
  }

  async stackProfiles(options: StackProfilesOptions): Promise<StackProfilesResult | undefined> {
    return this.host.stackProfiles(options)
  }

  async restructure(options: RestructureOptions): Promise<Dataset | undefined> {
    return this.host.restructure(options)
  }

  async combine(options: CombineOptions): Promise<Dataset | undefined> {
    return this.host.combine(options)
  }

  async label(options: LabelOptions): Promise<Dataset | undefined> {
    return this.host.labelStack(options)
  }

  async project3d(options: Project3dOptions): Promise<Dataset | undefined> {
    return this.host.project3d(options)
  }

  async remontage(options: RemontageOptions): Promise<Dataset | undefined> {
    return this.host.remontage(options)
  }

  async project(options: ProjectOptions): Promise<Dataset | undefined> {
    return this.host.project(options)
  }

  async montage(options: MontageOptions): Promise<Dataset | undefined> {
    return this.host.montage(options)
  }

  async montageToStack(options: MontageToStackOptions): Promise<Dataset | undefined> {
    return this.host.montageToStack(options)
  }

  async reslice(options: ResliceOptions): Promise<Dataset | undefined> {
    return this.host.reslice(options)
  }

  async orthogonal(options: OrthogonalOptions): Promise<Dataset[]> {
    return this.host.orthogonal(options)
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
    import: (file) => get().import(file), importStack: (files) => get().importStack(files), run: (request) => get().run(request), analyze: (options) => get().analyze(options), stackStats: (options) => get().stackStats(options), stackProfiles: (options) => get().stackProfiles(options), restructure: (options) => get().restructure(options), combine: (options) => get().combine(options), label: (options) => get().label(options), project3d: (options) => get().project3d(options), remontage: (options) => get().remontage(options), project: (options) => get().project(options), montage: (options) => get().montage(options), montageToStack: (options) => get().montageToStack(options), reslice: (options) => get().reslice(options), orthogonal: (options) => get().orthogonal(options),
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
