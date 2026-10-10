/**
 * 图像运行时：把引擎客户端、Recipe 历史、ViewState、字节预算缓存与预取调度串起来。
 *
 * 框架无关，React 通过订阅状态工作。缓存命中只加速显示；撤销始终由 Recipe 重算决定。
 */
import type { Dataset, SliceSelection } from './dataset.ts'
import { datasetVersionKey } from './dataset.ts'
import { appendStep, createRecipe, makeStep, RecipeHistory, recipeVersionKey, removeStep, updateStepParams, updateStepScope, type Recipe, type StepScope } from './recipe.ts'
import { ByteCache } from './scheduler/cache.ts'
import { TASK_PRIORITY, TaskQueue, VersionGuard, type SchedulerTask, type TaskPriority } from './scheduler/queue.ts'
import type { ChannelStats, ParticleRow } from '../lib/engineTypes.ts'
import type { ImageAnalysis } from './analysis.ts'
import type { StackStatsResult } from './stackStats.ts'
import type { StackProfilesResult } from './stackProfiles.ts'
import type { ImageBlock, Region } from './types.ts'
import { defaultOperatorParams, getOperator, validateOperatorParams } from './operators.ts'
import type { EngineClient, EngineResult, EngineRunOptions } from './worker/client.ts'
import type { StepOutcomeWire } from './worker/protocol.ts'
import type { RawSensorOptions } from './raw/sensor.ts'

export type RuntimeStatus = 'empty' | 'importing' | 'ready' | 'running' | 'error'

export interface RuntimeState {
  dataset: Dataset | null
  selection: SliceSelection
  recipe: Recipe | null
  /** 当前查看到的步骤（不改变图像流）。 */
  throughStepId?: string
  image: ImageBlock | null
  /**
   * 当前 `image` 是否已与 `selection` 失配。
   *
   * 切片切换是「先改 selection、异步再产出 image」，若 UI 不加区分就会出现
   * 新页码配旧像素。架构方案第 1 节明确禁止该状态，故在此显式暴露，
   * 由 UI 决定是清空还是标注为加载中。
   */
  imageStale: boolean
  results: StepOutcomeWire[]
  stats?: ChannelStats[]
  table?: ParticleRow[]
  /** 当前帧的整帧分析（直方图 / 剖面 / 统计），由引擎顺带产出。 */
  analysis?: ImageAnalysis
  /**
   * 整栈逐页统计结果，由 `measureStack()` 产出。
   *
   * Image ▸ Stacks 的三个命令共用这一份结果：Measure Stack 读 `frames`、Statistics 读 `summary`、
   * Plot Z-axis Profile 读 `profile`。它是显式触发的一次性结果，切片或 Recipe 变化后立即失效（见 `emit`）。
   */
  stackStats?: StackStatsResult
  /**
   * 曾经算出过整栈统计、但已被切片或 Recipe 变更作废。
   *
   * UI 据此把卡片从「加载中」改说成「结果已过期」，避免把「没跑过」与「跑过但失效了」混为一谈。
   */
  stackStatsStale?: boolean
  /** 逐页剖面结果（Plot XY Profile），由 `loadStackProfiles()` 产出。 */
  stackProfiles?: StackProfilesResult
  /**
   * 页标签（ImageJ 的 slice label）：下标对应当前切片轴。
   *
   * 它只影响显示与导出，**不参与像素缓存键** —— 改标签不会让整卷重新解码。
   */
  sliceLabels?: string[]
  status: RuntimeStatus
  error?: string
  lastRunMs?: number
  estimatedBytes: number
  warnings: string[]
  cache: { entries: number; bytes: number; hits: number; misses: number }
  /**
   * 整卷预热进度；`undefined` 表示没有在预热。
   *
   * 文件夹 / 多页 Stack 的页是惰性解码的，首次读取每页要付一次完整解码
   * （实测 4096×3072 JPEG 约 115 ms）。打开后后台把整卷预热进缓存，
   * UI 据此显示进度，预热完成后翻页就只剩缓存命中。
   */
  preload?: { done: number; total: number }
  /** 实际使用的执行路径：Worker 或主线程回退。 */
  engine: 'worker' | 'inline'
}

export interface ImageRuntimeOptions {
  client: EngineClient
  /** 缓存字节预算；默认 256 MiB（架构方案第一轮受限测试配置）。 */
  cacheBytes?: number
  /** 共享缓存：多文档共用一个实例；提供时忽略 cacheBytes。 */
  cache?: ByteCache<EngineResult>
  /** 是否预取邻页；默认开启。 */
  prefetch?: boolean
  /** 是否由本运行时负责 terminate client；共享 client 时置 false。默认 true。 */
  ownsClient?: boolean
}

const EMPTY_CACHE = { entries: 0, bytes: 0, hits: 0, misses: 0 }

/** 预取窗口：翻页方向上取 4 页、反方向取 2 页（按由近及远入队）。 */
const PREFETCH_FORWARD = 4
const PREFETCH_BACKWARD = 2
/** 距当前页超过这么多页的待跑预取视为用户已滚过去，直接丢弃。 */
const PREFETCH_KEEP_DISTANCE = 8
/** 整卷预热允许放宽到的缓存上限（字节）；超出部分退化为预取窗口。 */
const WARMUP_BUDGET_FALLBACK = 768 * 1024 * 1024

/**
 * 整卷预热的缓存上限。
 *
 * 优先按设备内存估算（取其四分之一，封顶 1 GiB）：上百张 4096×3072 的页
 * 单页就 36 MB，固定上限要么撑不住、要么在小内存设备上把标签页拖垮。
 * 拿不到 `deviceMemory`（Node 测试、Firefox/Safari）时退回 768 MiB。
 */
function warmupBudgetLimit(): number {
  const deviceMemory = (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory
  if (typeof deviceMemory === 'number' && deviceMemory > 0) return Math.min(deviceMemory * 1024 ** 3 / 4, 1024 ** 3)
  return WARMUP_BUDGET_FALLBACK
}
/** 预热放宽预算时的余量系数：留出缓存条目之外的开销。 */
const WARMUP_BUDGET_SLACK = 1.15
/** recipe 变化后重排整卷预热的防抖窗口（拖参数滑杆时不要每次都重排）。 */
const WARMUP_DEBOUNCE_MS = 400

function selectionKey(selection: SliceSelection): string {
  return ['t', 'c', 'z'].map((axis) => `${axis}=${selection[axis as 't' | 'c' | 'z'] ?? 0}`).join(',')
}

export class ImageRuntime {
  private readonly client: EngineClient
  private readonly cache: ByteCache<EngineResult>
  private activeCacheKey?: string
  private readonly queue = new TaskQueue<EngineResult>()
  private readonly guard = new VersionGuard()
  private readonly prefetchEnabled: boolean
  private readonly ownsClient: boolean
  private readonly ownsCache: boolean
  /** 在途的引擎请求，按缓存键去重：显示请求可复用并发中的预取。 */
  private readonly inflight = new Map<string, Promise<EngineResult>>()
  private readonly listeners = new Set<(state: RuntimeState) => void>()
  private state: RuntimeState
  private history: RecipeHistory | null = null
  private pumping = false
  private runPromise: Promise<void> | null = null
  private runQueued = false
  private analysisInFlight = false
  private analysisQueued = false
  /** 最近一次切片切换的轴与方向，决定预取窗口偏向哪一侧。 */
  private prefetchDirection?: { axis: 't' | 'c' | 'z'; delta: number }
  /** 整卷预热进度；未开始或已完成为 undefined。 */
  private warmup?: { total: number; done: number }
  private warmupTimer?: ReturnType<typeof setTimeout>
  /** 已预热过的数据集版本，避免每页跑完后重复整卷扫描。 */
  private warmupFinished?: string
  private disposed = false

  constructor(options: ImageRuntimeOptions) {
    this.client = options.client
    this.cache = options.cache ?? new ByteCache<EngineResult>(options.cacheBytes ?? 256 * 1024 * 1024)
    this.ownsCache = !options.cache
    this.ownsClient = options.ownsClient ?? true
    this.prefetchEnabled = options.prefetch ?? true
    this.state = {
      dataset: null,
      selection: {},
      recipe: null,
      image: null,
      imageStale: false,
      results: [],
      status: 'empty',
      estimatedBytes: 0,
      warnings: [],
      cache: EMPTY_CACHE,
      engine: options.client.kind,
    }
  }

  getState(): RuntimeState {
    return this.state
  }

  subscribe(listener: (state: RuntimeState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(patch: Partial<RuntimeState>): void {
    // 切片或 Recipe 一变，整栈统计就对不上画面了。失效判定集中在这里，
    // 免得每个改动 selection / recipe 的调用点都要记得自己清。
    const invalidated = 'selection' in patch || 'recipe' in patch || 'throughStepId' in patch
    const staleStats = invalidated
      ? { stackStats: undefined, stackStatsStale: Boolean(this.state.stackStats) || Boolean(this.state.stackStatsStale), stackProfiles: undefined }
      : null
    this.state = { ...this.state, ...patch, ...staleStats, cache: this.cacheStats() }
    for (const listener of this.listeners) listener(this.state)
  }

  private cacheStats() {
    const stats = this.cache.stats()
    return { entries: stats.entries, bytes: stats.bytes, hits: stats.hits, misses: stats.misses }
  }

  private versionFor(recipe: Recipe, throughStepId?: string): string {
    return `${datasetVersionKey(this.state.dataset!)}|${selectionKey(this.state.selection)}|${recipeVersionKey(recipe, throughStepId)}`
  }

  /**
   * 与「看哪一页」无关的版本：数据集与 Recipe（含查看到哪一步）。
   *
   * 预取结果按 selection 进缓存，因此翻页本身不会让预取失去意义 ——
   * 过期判定必须用这个版本，否则用户每翻一页都会把在途与已入队的预取全部作废
   * （旧实现把 selection 计进版本，连续翻页时预取命中率恒为 0）。
   */
  private dataVersionFor(recipe: Recipe, throughStepId?: string): string {
    return `${datasetVersionKey(this.state.dataset!)}|${recipeVersionKey(recipe, throughStepId)}`
  }

  /** 版本是否已不再对应当前数据集与 Recipe。 */
  private isOutdated(version: string): boolean {
    const dataset = this.state.dataset
    const recipe = this.currentRecipe()
    if (this.disposed || !dataset || !recipe) return true
    return this.dataVersionFor(recipe, this.state.throughStepId) !== version
  }

  /** 打开单个文件；无头传感器裸数据需要 `options`（宽高、像素类型等无法从文件推断）。 */
  async openFile(file: File, options?: RawSensorOptions): Promise<void> {
    await this.openWith(() => this.client.import(file, options))
  }

  /**
   * 把多个文件作为一个 Stack 打开（文件夹导入 / 合并 tab）。
   *
   * 导入成功后把每个源文件名写成该页的默认标签：多文件 Stack 的页序就是文件序
   * （见 `importImageStack`），没有标签的话界面只有 `i / n`，翻页时看不出这一页
   * 来自哪个文件——这也正是 ImageJ 用文件名标注 image sequence 的做法。
   */
  async openStack(files: readonly File[], options?: ReadonlyMap<string, RawSensorOptions>): Promise<void> {
    const imported = await this.openWith(() => this.client.importStack([...files], options))
    // 只有真的导入成功才写标签：失败时原 Stack 还在，不能把它标成这批文件名。
    // 页数与文件数不一致时也不写——那种页不是「一个文件一页」，标了就是错位。
    if (imported && this.pageCount() === files.length) this.setSliceLabels(files.map((file) => file.name))
  }

  /** 跑一次导入并接管数据集；返回是否成功（失败时保留原数据集，只报错）。 */
  private async openWith(importer: () => Promise<Dataset>): Promise<boolean> {
    this.emit({ status: 'importing', error: undefined, warnings: [] })
    try {
      await this.adoptDataset(await importer())
      return true
    } catch (error) {
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  /**
   * 采用一个已在引擎侧注册好的数据集。
   *
   * 「导入一个文件」与「投影结果开新 tab」共用这一条路径：都会重建 Recipe 历史、清缓存与预热状态，
   * 并把画面刷成新数据集的当前切片。调用方负责为新数据集建好 Storage 并注册到引擎。
   */
  async adoptDataset(dataset: Dataset): Promise<void> {
    if (this.state.dataset && this.state.dataset.id !== dataset.id) this.client.dispose(this.state.dataset.id)
    this.history = new RecipeHistory(createRecipe(dataset.id, dataset.revision))
    if (this.ownsCache) this.cache.clear()
    this.activeCacheKey = undefined
    this.warmup = undefined
    this.warmupFinished = undefined
    this.guard.update(`${datasetVersionKey(dataset)}|${selectionKey({})}|`)
    this.emit({
      dataset,
      selection: {},
      recipe: this.history.current(),
      throughStepId: undefined,
      image: null,
      imageStale: false,
      results: [],
      stats: undefined,
      table: undefined,
      analysis: undefined,
      status: 'ready',
      estimatedBytes: 0,
      preload: undefined,
      sliceLabels: undefined,
    })
    await this.run()
  }

  setSelection(patch: SliceSelection): void {
    const dataset = this.state.dataset
    if (!dataset) return
    const selection = { ...this.state.selection, ...patch }
    // 切片实际变化才标记 image 过期：重复设置同一页不应把画面清空。
    const changed = selectionKey(selection) !== selectionKey(this.state.selection)
    if (changed) {
      for (const axis of ['z', 't', 'c'] as const) {
        const previous = this.state.selection[axis]
        const next = selection[axis]
        if (previous !== undefined && next !== undefined && next !== previous) this.prefetchDirection = { axis, delta: next > previous ? 1 : -1 }
      }
    }
    this.emit({ selection, imageStale: changed ? true : this.state.imageStale })
    // 顺序有意为之：显示请求先发到引擎，预取随后入队，这样 Worker 里当前页永远排在预取前面。
    void this.run()
    if (changed) this.schedulePrefetch()
  }

  stepSelection(axis: 't' | 'c' | 'z', delta: number): void {
    const dataset = this.state.dataset
    if (!dataset) return
    const length = dataset.shape[dataset.axes.indexOf(axis)] ?? 1
    const current = this.state.selection[axis] ?? 0
    const next = Math.max(0, Math.min(length - 1, current + delta))
    if (next !== current) this.setSelection({ [axis]: next })
  }

  private currentRecipe(): Recipe | null {
    return this.history?.current() ?? this.state.recipe
  }

  /** 追加一步；返回新步骤的 id（调用方据此把这一步当作可更新/可撤销的"预览步骤"）。 */
  addStep(op: string, params?: Record<string, number | string>, scope?: StepScope): string | undefined {
    if (!this.history) return undefined
    const capability = getOperator(op)
    if (!capability) return undefined
    const step = makeStep(op, { ...defaultOperatorParams(capability), ...params }, scope)
    this.history.commit(appendStep(this.history.current(), step))
    this.emit({ recipe: this.history.current(), throughStepId: step.id })
    void this.run()
    return step.id
  }

  updateParams(stepId: string, params: Record<string, number | string>): void {
    if (!this.history) return
    const step = this.history.current().steps.find((candidate) => candidate.id === stepId)
    const capability = step ? getOperator(step.op) : undefined
    if (step && capability) {
      const validation = validateOperatorParams(capability, params)
      this.history.commit(updateStepParams(this.history.current(), stepId, validation.values))
    }
    this.emit({ recipe: this.history.current() })
    void this.run()
  }

  /**
   * 原地改某一步的作用域（滤镜预览跟随视口用）。
   * 作用域没变时不产生新修订也不重跑——平移到余量内不该触发重算。
   */
  updateScope(stepId: string, scope: StepScope): void {
    if (!this.history) return
    const next = updateStepScope(this.history.current(), stepId, scope)
    if (next === this.history.current()) return
    this.history.commit(next)
    this.emit({ recipe: next })
    void this.run()
  }

  removeStep(stepId: string): void {
    if (!this.history) return
    this.history.commit(removeStep(this.history.current(), stepId))
    this.emit({ recipe: this.history.current(), throughStepId: undefined })
    void this.run()
  }

  /** 查看某个步骤的结果（不删除后续步骤）。 */
  viewStep(stepId?: string): void {
    this.emit({ throughStepId: stepId })
    void this.run()
  }

  undo(): void {
    if (!this.history || !this.history.canUndo()) return
    this.history.undo()
    this.emit({ recipe: this.history.current(), throughStepId: undefined })
    void this.run()
  }

  canUndo(): boolean {
    return this.history?.canUndo() ?? false
  }

  canRedo(): boolean { return this.history?.canRedo() ?? false }

  async readSourceFrame(): Promise<ImageBlock | null> {
    const dataset = this.state.dataset
    if (!dataset) return null
    const result = await this.client.run({ datasetId: dataset.id, recipe: createRecipe(dataset.id, dataset.revision), selection: { ...this.state.selection } })
    return result.image
  }

  /** 当前切片轴上的页数（没有切片轴时为 1）。 */
  private pageCount(): number {
    const dataset = this.state.dataset
    if (!dataset) return 1
    const axis = this.sliceAxis(dataset)
    return axis ? dataset.shape[dataset.axes.indexOf(axis)] ?? 1 : 1
  }

  /** 读取某一页的标签；未设置时返回空串。 */
  sliceLabel(index: number): string {
    return this.state.sliceLabels?.[index] ?? ''
  }

  /**
   * 设置某一页的标签（ImageJ 的 `Set Label...`）。
   *
   * 空串表示清除该页标签；标签只影响显示与导出，不触发票据重算。
   */
  setSliceLabel(index: number, label: string): void {
    const count = this.pageCount()
    if (!Number.isInteger(index) || index < 0 || index >= count) return
    const labels = [...this.state.sliceLabels ?? []]
    while (labels.length < count) labels.push('')
    labels[index] = label
    this.emit({ sliceLabels: labels })
  }

  /**
   * 批量设置页标签（导入多文件 Stack 时用文件名做默认值）。
   *
   * 与 `setSliceLabel` 一样只影响显示与导出，但一次 `emit` 写完所有页：
   * 逐页调用会触发 N 次界面更新。
   */
  setSliceLabels(labels: readonly string[]): void {
    const count = this.pageCount()
    if (!count) return
    this.emit({ sliceLabels: Array.from({ length: count }, (_, index) => labels[index] ?? '') })
  }

  /** 清空所有页标签（ImageJ 的 `Remove Slice Labels`）。 */
  clearSliceLabels(): void {
    this.emit({ sliceLabels: undefined })
  }

  /**
   * 整栈逐页统计：Measure Stack... / Statistics / Plot Z-axis Profile。
   *
   * 与 `run()` 分开：它不改变显示图像、也不进显示缓存，逐页像素全程留在引擎侧。
   * `roi` 是图像坐标区域（矩形选区）；`axis` 缺省由引擎取 z → t → c 中第一个长度大于 1 的轴。
   */
  async measureStack(roi?: Region, axis?: 'z' | 't' | 'c'): Promise<StackStatsResult | undefined> {
    const dataset = this.state.dataset
    const recipe = this.currentRecipe()
    if (!dataset || !recipe || this.disposed) return undefined
    this.emit({ status: 'running', error: undefined })
    try {
      const stats = await this.client.stackStats({
        datasetId: dataset.id,
        recipe,
        selection: { ...this.state.selection },
        roi,
        axis,
      })
      if (this.disposed) return undefined
      this.emit({ stackStats: stats, stackStatsStale: false, status: 'ready' })
      return stats
    } catch (error) {
      if (this.disposed) return undefined
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  /**
   * Z 投影：把当前数据集的若干页投影成**新的数据集**，返回其元信息。
   *
   * 不改变当前文档的画面（本工作台的做法是拿返回的 Dataset 另开一个 tab）；
   * 引擎侧负责注册新 Dataset 与其 Storage，像素不跨线程。
   */
  async projectStack(options: {
    method: 'average' | 'max' | 'min' | 'sum' | 'sd' | 'median'
    axis?: 'z' | 't' | 'c'
    from?: number
    to?: number
    groupSize?: number
    /** 对每条时间帧各投影一次（ImageJ 的 All time frames）。 */
    allTimeFrames?: boolean
    title?: string
    roi?: Region
  }): Promise<Dataset | undefined> {
    const dataset = this.state.dataset
    const recipe = this.currentRecipe()
    if (!dataset || !recipe || this.disposed) return undefined
    this.emit({ status: 'running', error: undefined })
    try {
      const projected = await this.client.project({
        datasetId: dataset.id,
        recipe,
        selection: { ...this.state.selection },
        roi: options.roi,
        axis: options.axis,
        from: options.from,
        to: options.to,
        method: options.method,
        groupSize: options.groupSize,
        allTimeFrames: options.allTimeFrames,
        title: options.title,
      })
      if (this.disposed) return undefined
      this.emit({ status: 'ready' })
      return projected
    } catch (error) {
      if (this.disposed) return undefined
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  /**
   * Make Montage：把若干页拼成一张大图，返回引擎侧注册好的新数据集。
   *
   * 与 `projectStack` 一样不改变当前文档；调用方拿返回的 Dataset 另开 tab。
   * 行列与缩放不传时由引擎按 ImageJ 的自动规则计算。
   */
  async montageStack(options: {
    axis?: 'z' | 't' | 'c'
    from?: number
    to?: number
    increment?: number
    columns?: number
    rows?: number
    scale?: number
    borderWidth?: number
    /** 在面板底部标注切片文本（ImageJ 的 Label slices）。 */
    labelSlices?: boolean
    fontSize?: number
    title?: string
    roi?: Region
  }): Promise<Dataset | undefined> {
    const dataset = this.state.dataset
    const recipe = this.currentRecipe()
    if (!dataset || !recipe || this.disposed) return undefined
    this.emit({ status: 'running', error: undefined })
    try {
      const montaged = await this.client.montage({
        datasetId: dataset.id,
        recipe,
        selection: { ...this.state.selection },
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
        labels: this.state.sliceLabels,
        title: options.title,
      })
      if (this.disposed) return undefined
      this.emit({ status: 'ready' })
      return montaged
    } catch (error) {
      if (this.disposed) return undefined
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  /**
   * Montage to Stack：把当前蒙太奇图切回多页栈，返回引擎侧注册好的新数据集。
   *
   * 行列不传时沿用 Make Montage 写进元数据的值（对应 ImageJ 的 xMontage / yMontage）。
   */
  async montageToStack(options: {
    columns?: number
    rows?: number
    borderWidth?: number
    title?: string
    roi?: Region
  } = {}): Promise<Dataset | undefined> {
    const dataset = this.state.dataset
    const recipe = this.currentRecipe()
    if (!dataset || !recipe || this.disposed) return undefined
    this.emit({ status: 'running', error: undefined })
    try {
      const stacked = await this.client.montageToStack({
        datasetId: dataset.id,
        recipe,
        selection: { ...this.state.selection },
        roi: options.roi,
        columns: options.columns,
        rows: options.rows,
        borderWidth: options.borderWidth,
        title: options.title,
      })
      if (this.disposed) return undefined
      this.emit({ status: 'ready' })
      return stacked
    } catch (error) {
      if (this.disposed) return undefined
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  /**
   * Reslice：沿选区的垂直方向重切成新栈，返回引擎侧注册好的新数据集。
   *
   * `bounds` 不传时按整帧处理；行列与标定沿用源数据。
   */
  async resliceStack(options: {
    bounds?: { x: number; y: number; width: number; height: number }
    axis?: 'z' | 't' | 'c'
    from?: number
    to?: number
    spacing?: number
    startAt?: 'top' | 'left' | 'bottom' | 'right'
    flip?: boolean
    rotate?: boolean
    title?: string
  } = {}): Promise<Dataset | undefined> {
    const dataset = this.state.dataset
    const recipe = this.currentRecipe()
    if (!dataset || !recipe || this.disposed) return undefined
    this.emit({ status: 'running', error: undefined })
    try {
      const sliced = await this.client.reslice({
        datasetId: dataset.id,
        recipe,
        selection: { ...this.state.selection },
        bounds: options.bounds,
        axis: options.axis,
        from: options.from,
        to: options.to,
        spacing: options.spacing,
        startAt: options.startAt,
        flip: options.flip,
        rotate: options.rotate,
        title: options.title,
      })
      if (this.disposed) return undefined
      this.emit({ status: 'ready' })
      return sliced
    } catch (error) {
      if (this.disposed) return undefined
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  /**
   * Orthogonal Views：由当前 z 栈重建 XZ 与 YZ 两张视图，各返回一个引擎侧注册好的新数据集。
   *
   * 交叉点缺省取图像中心；调用方拿返回的数据集各开一个 tab。
   */
  async orthogonalViews(options: {
    point?: { x: number; y: number }
    axis?: 'z' | 't' | 'c'
    from?: number
    to?: number
  } = {}): Promise<Dataset[]> {
    const dataset = this.state.dataset
    const recipe = this.currentRecipe()
    if (!dataset || !recipe || this.disposed) return []
    this.emit({ status: 'running', error: undefined })
    try {
      const views = await this.client.orthogonal({
        datasetId: dataset.id,
        recipe,
        selection: { ...this.state.selection },
        point: options.point,
        axis: options.axis,
        from: options.from,
        to: options.to,
      })
      if (this.disposed) return []
      this.emit({ status: 'ready' })
      return views
    } catch (error) {
      if (this.disposed) return []
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return []
    }
  }

  /**
   * 逐页剖面（Plot XY Profile）：逐页取同一条剖面，返回曲线数据与共用纵轴范围。
   *
   * 与整栈统计一样是显式触发的一次性结果，切片或 Recipe 变化后即失效。
   */
  async loadStackProfiles(options: {
    roi?: Region
    line?: { points: number[]; closed?: boolean }
    axis?: 'z' | 't' | 'c'
  } = {}): Promise<StackProfilesResult | undefined> {
    const dataset = this.state.dataset
    const recipe = this.currentRecipe()
    if (!dataset || !recipe || this.disposed) return undefined
    this.emit({ status: 'running', error: undefined })
    try {
      const profiles = await this.client.stackProfiles({
        datasetId: dataset.id,
        recipe,
        selection: { ...this.state.selection },
        roi: options.roi,
        line: options.line,
        axis: options.axis,
      })
      if (this.disposed) return undefined
      this.emit({ stackProfiles: profiles, status: 'ready' })
      return profiles
    } catch (error) {
      if (this.disposed) return undefined
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  /**
   * 栈结构编辑（Reverse / Reduce / Make Substack / Delete / Add Slice）。
   *
   * 结果是一个新数据集（页映射存储），调用方拿它另开一个 tab；当前文档不受影响。
   */
  async restructureStack(options: {
    op: 'reverse' | 'reduce' | 'substack' | 'delete' | 'add'
    factor?: number
    pages?: number[]
    at?: number
    count?: number
    title?: string
  }): Promise<Dataset | undefined> {
    const dataset = this.state.dataset
    if (!dataset || this.disposed) return undefined
    this.emit({ status: 'running', error: undefined })
    try {
      const restructured = await this.client.restructure({ datasetId: dataset.id, ...options })
      if (this.disposed) return undefined
      this.emit({ status: 'ready' })
      return restructured
    } catch (error) {
      if (this.disposed) return undefined
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  /**
   * 跨数据集页合成（Insert / Combine / Concatenate）；结果数据集由调用方另开 tab。
   *
   * 主数据集（本运行时）走当前 Recipe，其它数据集按源像素读取。
   */
  async combineStacks(options: {
    op: 'insert' | 'combine' | 'concatenate'
    otherDatasetId?: string
    datasetIds?: string[]
    x?: number
    y?: number
    vertical?: boolean
    title?: string
  }): Promise<Dataset | undefined> {
    const dataset = this.state.dataset
    if (!dataset || this.disposed) return undefined
    this.emit({ status: 'running', error: undefined })
    try {
      const combined = await this.client.combine({
        datasetId: dataset.id,
        recipe: this.currentRecipe() ?? undefined,
        ...options,
      })
      if (this.disposed) return undefined
      this.emit({ status: 'ready' })
      return combined
    } catch (error) {
      if (this.disposed) return undefined
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  /**
   * Label...：在指定范围的切片上标注文本；结果数据集由调用方另开 tab。
   *
   * `format = 'label'` 时使用当前的页标签（`setSliceLabel` 写的那些）。
   */
  async labelStack(options: {
    format: 'number' | 'zero-padded' | 'mm:ss' | 'hh:mm:ss' | 'text' | 'label'
    start?: number
    interval?: number
    text?: string
    x?: number
    y?: number
    fontSize?: number
    from?: number
    to?: number
    title?: string
  }): Promise<Dataset | undefined> {
    const dataset = this.state.dataset
    if (!dataset || this.disposed) return undefined
    this.emit({ status: 'running', error: undefined })
    try {
      const labelled = await this.client.label({
        datasetId: dataset.id,
        recipe: this.currentRecipe() ?? undefined,
        selection: { ...this.state.selection },
        sliceLabels: this.state.sliceLabels,
        ...options,
      })
      if (this.disposed) return undefined
      this.emit({ status: 'ready' })
      return labelled
    } catch (error) {
      if (this.disposed) return undefined
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  /**
   * 3D Project：绕指定轴逐角度旋转投影；结果数据集由调用方另开 tab。
   */
  async project3dStack(options: {
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
  }): Promise<Dataset | undefined> {
    const dataset = this.state.dataset
    if (!dataset || this.disposed) return undefined
    this.emit({ status: 'running', error: undefined })
    try {
      const projected = await this.client.project3d({
        datasetId: dataset.id,
        recipe: this.currentRecipe() ?? undefined,
        selection: { ...this.state.selection },
        ...options,
      })
      if (this.disposed) return undefined
      this.emit({ status: 'ready' })
      return projected
    } catch (error) {
      if (this.disposed) return undefined
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  /**
   * 重排蒙太奇（Magic Montage Tools）：按新行列重拼当前蒙太奇图。
   *
   * 源行列缺省沿用元数据里的记录；结果会写回新的行列，供后续 Montage to Stack 使用。
   */
  async remontageStack(options: {
    columns: number
    rows: number
    sourceColumns?: number
    sourceRows?: number
    borderWidth?: number
    labelSlices?: boolean
    fontSize?: number
    title?: string
  }): Promise<Dataset | undefined> {
    const dataset = this.state.dataset
    if (!dataset || this.disposed) return undefined
    this.emit({ status: 'running', error: undefined })
    try {
      const remontaged = await this.client.remontage({
        datasetId: dataset.id,
        recipe: this.currentRecipe() ?? undefined,
        selection: { ...this.state.selection },
        ...options,
      })
      if (this.disposed) return undefined
      this.emit({ status: 'ready' })
      return remontaged
    } catch (error) {
      if (this.disposed) return undefined
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  redo(): void {
    if (!this.history?.canRedo()) return
    this.history.redo()
    this.emit({ recipe: this.history.current(), throughStepId: undefined })
    void this.run()
  }

  /** 顺序执行各页供导出使用，保留各页自己的处理记录，不改变当前选择。 */
  async *exportFrames(): AsyncGenerator<ImageBlock> {
    const dataset = this.state.dataset
    const recipe = this.currentRecipe()
    if (!dataset || !recipe) return
    const leading = dataset.axes.map((axis, index) => ({ axis, length: dataset.shape[index]! }))
      .filter((entry): entry is { axis: 't' | 'c' | 'z'; length: number } => (entry.axis === 't' || entry.axis === 'z' || entry.axis === 'c') && !(entry.axis === 'c' && dataset.componentKind === 'rgb'))
    const count = leading.reduce((total, entry) => total * entry.length, 1)
    for (let index = 0; index < count; index += 1) {
      const selection: SliceSelection = {}
      let remainder = index
      for (let i = leading.length - 1; i >= 0; i--) {
        const entry = leading[i]!
        selection[entry.axis] = remainder % entry.length
        remainder = Math.floor(remainder / entry.length)
      }
      const result = await this.client.run({ datasetId: dataset.id, recipe, selection })
      const failure = result.results.find((step) => step.status === 'error')
      if (failure) throw new Error(failure.error)
      if (result.image) yield result.image
    }
  }

  async run(): Promise<void> {
    // 合并高频请求：一批连续调用只跑「最新一次」。已有 drain 在途时挂到同一个 promise，
    // 因此 `await run()` 依然会等到（含后续合并进来的）执行真正结束——测试与 openWith 依赖这一点。
    this.runQueued = true
    if (this.runPromise) return this.runPromise
    this.runPromise = this.drainRuns()
    return this.runPromise
  }

  private async drainRuns(): Promise<void> {
    try {
      while (this.runQueued && !this.disposed) {
        this.runQueued = false
        await this.runOnce()
      }
    } finally {
      this.runPromise = null
      if (this.runQueued && !this.disposed) this.runPromise = this.drainRuns()
      else if (!this.disposed) {
        // 显示已停下来：把邻页预取与整帧分析补上（翻页期间两者都给显示让路）。
        this.schedulePrefetch()
        this.scheduleAnalysis()
      }
    }
  }

  private async runOnce(): Promise<void> {
    const dataset = this.state.dataset
    const recipe = this.currentRecipe()
    if (!dataset || !recipe || this.disposed) return
    const version = this.versionFor(recipe, this.state.throughStepId)
    this.guard.update(version)
    // 先给当前页做缓存查找。命中时不广播 running：翻页绝大多数是命中，
    // 那次 emit 只会白触发一遍全量重渲染。
    const key = this.cacheKeyFor(dataset, recipe, this.state.selection, this.state.throughStepId)
    if (this.activeCacheKey) this.cache.unpin(this.activeCacheKey)
    this.activeCacheKey = key
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.pin(key)
      this.emit({ image: cached.image, imageStale: false, results: cached.results, stats: cached.stats, table: cached.table, lastRunMs: cached.ms, estimatedBytes: cached.estimatedBytes, status: 'ready' })
      this.schedulePrefetch()
      this.scheduleWarmupSoon()
      return
    }
    this.emit({ status: 'running', error: undefined })
    try {
      const result = await this.runShared(key, {
        datasetId: dataset.id,
        recipe,
        selection: this.state.selection,
        throughStepId: this.state.throughStepId,
      })
      if (this.guard.version() !== version) return // 过期结果不覆盖当前画面
      if (result.image) {
        const bytes = result.image.data.byteLength
        if (!result.results.some((step) => step.status === 'error')) this.cache.set(key, result, bytes, true)
      }
      this.emit({
        image: result.image,
        imageStale: false,
        results: result.results,
        stats: result.stats,
        table: result.table,
        status: result.results.some((step) => step.status === 'error') ? 'error' : 'ready',
        error: result.results.find((step) => step.status === 'error')?.error,
        lastRunMs: result.ms,
        estimatedBytes: result.estimatedBytes,
      })
      this.schedulePrefetch()
      this.scheduleWarmupSoon()
    } catch (error) {
      if (this.guard.version() !== version) return
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * 同一个缓存键只跑一次引擎请求。
   *
   * 翻页时「当前页的显示请求」与「上一次翻页后已发出的邻页预取」很容易撞在同一页上：
   * 共享在途 Promise 后，显示请求直接搭上预取的车（省掉一次整页解码与传输），
   * 也不会出现两次请求并发争抢引擎、双双变慢的情况。
   */
  private runShared(key: string, request: EngineRunOptions): Promise<EngineResult> {
    const existing = this.inflight.get(key)
    if (existing) return existing
    let promise: Promise<EngineResult>
    promise = this.client.run(request).finally(() => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key)
    })
    this.inflight.set(key, promise)
    return promise
  }

  private cacheKeyFor(dataset: Dataset, recipe: Recipe, selection: SliceSelection, throughStepId?: string): string {
    return [
      datasetVersionKey(dataset),
      selectionKey(selection),
      recipeVersionKey(recipe, throughStepId),
    ].join('\u0001')
  }

  /**
   * 整帧分析不进显示路径：翻页时先出图（ImageJ 的 setSlice 也只换指针 + 重绘），
   * 随后立即请求当前切片的直方图/统计（合并、只保留最新），算完单独 emit。
   * 这样面板是「live」的（像 ImageJ 的 Live 直方图），又不阻塞出图；
   * 分析在 Worker 内直接读缓存页，不跨线程拷贝整帧。
   */
  private scheduleAnalysis(): void {
    this.analysisQueued = true
    void this.pumpAnalysis()
  }

  private async pumpAnalysis(): Promise<void> {
    if (this.analysisInFlight) return
    this.analysisInFlight = true
    try {
      while (this.analysisQueued && !this.disposed) {
        // 显示优先：翻页在途时不给引擎添分析负载，等停下来再补（分析只保留最新一页的结果）。
        if (this.runQueued || this.runPromise) return
        this.analysisQueued = false
        const dataset = this.state.dataset
        const recipe = this.currentRecipe()
        if (!dataset || !recipe) break
        const version = this.guard.version()
        const selection = { ...this.state.selection }
        const throughStepId = this.state.throughStepId
        try {
          const analysis = await this.client.analyze({ datasetId: dataset.id, recipe, selection, throughStepId })
          if (analysis && this.guard.version() === version) this.emit({ analysis })
        } catch {
          // 分析失败不影响显示
        }
      }
    } finally {
      this.analysisInFlight = false
    }
  }

  /**
   * 预取邻页：窗口按最近的翻页方向偏置，结果只入缓存。
   *
   * 三条与旧实现的差别（决定了连续翻页时能否命中缓存）：
   * 1. 过期判定只跟数据集与 Recipe，不再把当前 selection 算进去 —— 翻页不会作废预取；
   * 2. 每次切片切换即刻调用，不再等当前页算完；
   * 3. 先丢掉距当前页过远的待跑预取，避免用户已经滚过去还在算旧页。
   */
  private schedulePrefetch(): void {
    const dataset = this.state.dataset
    const recipe = this.currentRecipe()
    if (!this.prefetchEnabled || !dataset || !recipe || this.disposed) return
    const axis = this.sliceAxis(dataset)
    if (!axis) return
    const length = dataset.shape[dataset.axes.indexOf(axis)]!
    const current = this.state.selection[axis] ?? 0
    const forward = this.prefetchDirection?.axis === axis ? this.prefetchDirection.delta : 1
    const version = this.dataVersionFor(recipe, this.state.throughStepId)
    const throughStepId = this.state.throughStepId
    // 只裁预取：后台预热任务的目标页本来就离当前页很远。
    this.queue.cancelWhere((task) => task.sliceIndex !== undefined && task.priority !== TASK_PRIORITY.background && Math.abs(task.sliceIndex - current) > PREFETCH_KEEP_DISTANCE)
    // 方向上的近页优先，再补反方向的近页；入队顺序即同优先级内的执行顺序。
    const offsets = forward > 0
      ? [...Array.from({ length: PREFETCH_FORWARD }, (_, i) => i + 1), ...Array.from({ length: PREFETCH_BACKWARD }, (_, i) => -i - 1)]
      : [...Array.from({ length: PREFETCH_FORWARD }, (_, i) => -i - 1), ...Array.from({ length: PREFETCH_BACKWARD }, (_, i) => i + 1)]
    for (const offset of offsets) {
      const target = current + offset
      if (target < 0 || target >= length) continue
      this.enqueuePage({
        dataset, recipe, axis, target, version, throughStepId, kind: 'prefetch',
        priority: offset * forward > 0 ? TASK_PRIORITY.prefetchForward : TASK_PRIORITY.prefetchBackward,
      })
    }
    void this.pump()
  }

  /** 切片轴：`z` 优先，其次 `t`；RGB 的 `c` 轴不作为可翻切片。 */
  private sliceAxis(dataset: Dataset): 'z' | 't' | 'c' | undefined {
    return (['z', 't', 'c'] as const).find((candidate) => !(candidate === 'c' && dataset.componentKind === 'rgb') && (dataset.shape[dataset.axes.indexOf(candidate)] ?? 1) > 1)
  }

  /**
   * 把一页排进后台队列：命中缓存则直接记账，否则交给空闲时的引擎执行。
   *
   * 预取与整卷预热共用这一条路径，靠 `kind` 区分优先级与进度记账，
   * 并用同一个 coalesceKey 保证同一页只会排队一次。
   */
  private enqueuePage(options: {
    dataset: Dataset
    recipe: Recipe
    axis: 'z' | 't' | 'c'
    target: number
    version: string
    throughStepId?: string
    kind: 'prefetch' | 'warmup'
    priority: TaskPriority
  }): void {
    const { dataset, recipe, axis, target, version, throughStepId, kind, priority } = options
    const selection = { ...this.state.selection, [axis]: target }
    const key = this.cacheKeyFor(dataset, recipe, selection, throughStepId)
    if (this.cache.has(key)) {
      if (kind === 'warmup') this.noteWarmupPage()
      return
    }
    const task: SchedulerTask<EngineResult> = {
      id: `${kind}:${key}`,
      priority,
      coalesceKey: `page:${axis}:${target}`,
      sliceIndex: target,
      isStale: () => this.isOutdated(version),
      // 预热任务被同页的预取顶掉、或被取消时也要记账，否则进度永远到不了 100%。
      onDiscard: kind === 'warmup' ? () => this.noteWarmupPage() : undefined,
      run: async () => {
        try {
          const result = await this.runShared(key, {
            datasetId: dataset.id,
            recipe,
            selection,
            throughStepId,
          })
          if (result.image && !result.results.some((step) => step.status === 'error')) {
            this.cache.set(key, result, result.image.data.byteLength)
          }
          return result
        } finally {
          // 失败也要记账，否则进度永远停在未完成、预热的预算放宽也不会收回。
          if (kind === 'warmup') this.noteWarmupPage()
        }
      },
    }
    if (!this.queue.push(task) && kind === 'warmup') this.noteWarmupPage()
    // 入队后必须唤醒执行器：pump 会在队列取空时退出，这里不叫醒的话，
    // 后续入队的预取/预热任务就没人跑了。
    void this.pump()
  }

  /**
   * 整卷预热：把还没进缓存的页按后台优先级铺满队列。
   *
   * 对齐 ImageJ 的行为 —— 它在拖入文件夹时就把整卷读进内存（代价是 Loading），
   * 之后翻页只是换引用 + GPU blit；我们的惰性栈把这份成本摊到了每一页首次显示上。
   * 这里把它挪回打开阶段：显示空闲时逐页预热，用户翻页时自动让路（见 `pump`），
   * 并按「页数 × 单页字节」临时放宽缓存预算，否则预热结果会被自身预算淘汰。
   */
  private scheduleWarmup(): void {
    const dataset = this.state.dataset
    const recipe = this.currentRecipe()
    if (!this.prefetchEnabled || !dataset || !recipe || this.disposed || this.warmup) return
    const version = this.dataVersionFor(recipe, this.state.throughStepId)
    if (this.warmupFinished === version) return
    const axis = this.sliceAxis(dataset)
    if (!axis) { this.warmupFinished = version; return }
    const length = dataset.shape[dataset.axes.indexOf(axis)]!
    const pageBytes = this.state.image?.data.byteLength ?? 0
    if (!pageBytes || length < 2) { this.warmupFinished = version; return }
    const wanted = Math.ceil(pageBytes * length * WARMUP_BUDGET_SLACK)
    if (wanted > this.cache.budget()) this.cache.setBudget(Math.min(warmupBudgetLimit(), wanted))
    // 预算内能容下多少页；装不下的部分仍由预取窗口覆盖。
    const total = Math.max(1, Math.min(length, Math.floor(this.cache.budget() / pageBytes)))
    this.warmup = { total, done: 0 }
    this.warmupFinished = version
    const throughStepId = this.state.throughStepId
    // 离当前页越近越先预热：用户随手翻一两页就能命中，而不是等它从头顺序铺过来。
    const current = this.state.selection[axis] ?? 0
    const order = Array.from({ length: total }, (_, index) => index)
      .sort((a, b) => Math.abs(a - current) - Math.abs(b - current))
    for (const target of order) {
      this.enqueuePage({ dataset, recipe, axis, target, version, throughStepId, kind: 'warmup', priority: TASK_PRIORITY.background })
    }
    this.emitWarmup()
    void this.pump()
  }

  /** 预热完成一页；进度按 5% 粒度广播，避免整卷逐页触发全量重渲染。 */
  private noteWarmupPage(): void {
    const warmup = this.warmup
    if (!warmup) return
    warmup.done += 1
    const step = Math.max(1, Math.floor(warmup.total / 20))
    if (warmup.done >= warmup.total) { this.warmup = undefined; this.emitWarmup() }
    else if (warmup.done % step === 0) this.emitWarmup()
  }

  private emitWarmup(): void {
    const warmup = this.warmup
    this.emit({ preload: warmup ? { done: warmup.done, total: warmup.total } : undefined })
  }

  /**
   * recipe 变化会重排整卷预热，而这个入口会被 `runOnce` 每次执行后调用。
   *
   * 拖参数滑杆会高频改 recipe（`updateParams` → `run` → 这里），若每次都重排，
   * 整卷任务会被反复清空重建——界面一直显示"正在载入"而且很卡。所以：
   * 旧预热的结果已随旧 recipe 作废，先取消它并收起进度，等改动停下来再重新铺。
   */
  private scheduleWarmupSoon(): void {
    if (!this.prefetchEnabled || this.disposed) return
    this.cancelWarmup()
    if (this.warmupTimer) clearTimeout(this.warmupTimer)
    this.warmupTimer = setTimeout(() => {
      this.warmupTimer = undefined
      this.scheduleWarmup()
    }, WARMUP_DEBOUNCE_MS)
  }

  /** 撤掉队列里所有预热任务并收起进度（`noteWarmupPage` 对空进度是安全的）。 */
  private cancelWarmup(): void {
    if (this.warmup) { this.warmup = undefined; this.emitWarmup() }
    this.queue.cancelWhere((task) => task.id.startsWith('warmup:'))
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.disposed) return
    this.pumping = true
    try {
      for (;;) {
        if (this.disposed) break
        // 显示优先由队列保证（`queue.next()` 取优先级最高的任务，翻页是 critical、
        // 预热是 background），所以这里**不能**因为"有显示请求"就 break：
        // pump 只在 scheduleWarmup() 时启动一次，一旦退出，用户在连续翻页期间
        // 整卷预热就再也不会推进，于是翻到哪页都还是 cache miss。
        const task = this.queue.next()
        if (!task) break
        try {
          await task.run()
        } catch {
          // 预取失败不影响主路径
        }
      }
    } finally {
      this.pumping = false
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.warmupTimer) { clearTimeout(this.warmupTimer); this.warmupTimer = undefined }
    this.queue.clear()
    if (this.ownsCache) this.cache.clear()
    const datasetId = this.state.dataset?.id
    if (datasetId) this.client.dispose(datasetId)
    if (this.ownsClient) this.client.terminate()
    this.listeners.clear()
  }
}


