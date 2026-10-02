/**
 * 图像运行时：把引擎客户端、Recipe 历史、ViewState、字节预算缓存与预取调度串起来。
 *
 * 框架无关，React 通过订阅状态工作。缓存命中只加速显示；撤销始终由 Recipe 重算决定。
 */
import type { Dataset, SliceSelection } from './dataset.ts'
import { datasetVersionKey } from './dataset.ts'
import { appendStep, createRecipe, makeStep, RecipeHistory, recipeVersionKey, removeStep, updateStepParams, type Recipe } from './recipe.ts'
import { ByteCache } from './scheduler/cache.ts'
import { TASK_PRIORITY, TaskQueue, VersionGuard, type SchedulerTask } from './scheduler/queue.ts'
import type { ChannelStats, ParticleRow } from '../lib/engineTypes.ts'
import type { ImageBlock } from './types.ts'
import { defaultOperatorParams, getOperator, validateOperatorParams } from './operators.ts'
import type { EngineClient, EngineResult } from './worker/client.ts'
import type { StepOutcomeWire } from './worker/protocol.ts'

export type RuntimeStatus = 'empty' | 'importing' | 'ready' | 'running' | 'error'

export interface RuntimeState {
  dataset: Dataset | null
  selection: SliceSelection
  recipe: Recipe | null
  /** 当前查看到的步骤（不改变图像流）。 */
  throughStepId?: string
  image: ImageBlock | null
  results: StepOutcomeWire[]
  stats?: ChannelStats[]
  table?: ParticleRow[]
  status: RuntimeStatus
  error?: string
  lastRunMs?: number
  estimatedBytes: number
  warnings: string[]
  cache: { entries: number; bytes: number; hits: number; misses: number }
  /** 实际使用的执行路径：Worker 或主线程回退。 */
  engine: 'worker' | 'inline'
}

export interface ImageRuntimeOptions {
  client: EngineClient
  /** 缓存字节预算；默认 256 MiB（架构方案第一轮受限测试配置）。 */
  cacheBytes?: number
  /** 是否预取邻页；默认开启。 */
  prefetch?: boolean
}

const EMPTY_CACHE = { entries: 0, bytes: 0, hits: 0, misses: 0 }

function selectionKey(selection: SliceSelection): string {
  return ['t', 'c', 'z'].map((axis) => `${axis}=${selection[axis as 't' | 'c' | 'z'] ?? 0}`).join(',')
}

export class ImageRuntime {
  private readonly client: EngineClient
  private readonly cache: ByteCache<ImageBlock>
  private readonly queue = new TaskQueue<EngineResult>()
  private readonly guard = new VersionGuard()
  private readonly prefetchEnabled: boolean
  private readonly listeners = new Set<(state: RuntimeState) => void>()
  private state: RuntimeState
  private history: RecipeHistory | null = null
  private pumping = false
  private disposed = false

  constructor(options: ImageRuntimeOptions) {
    this.client = options.client
    this.cache = new ByteCache<ImageBlock>(options.cacheBytes ?? 256 * 1024 * 1024)
    this.prefetchEnabled = options.prefetch ?? true
    this.state = {
      dataset: null,
      selection: {},
      recipe: null,
      image: null,
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
    this.state = { ...this.state, ...patch, cache: this.cacheStats() }
    for (const listener of this.listeners) listener(this.state)
  }

  private cacheStats() {
    const stats = this.cache.stats()
    return { entries: stats.entries, bytes: stats.bytes, hits: stats.hits, misses: stats.misses }
  }

  private versionFor(recipe: Recipe, throughStepId?: string): string {
    return `${datasetVersionKey(this.state.dataset!)}|${selectionKey(this.state.selection)}|${recipeVersionKey(recipe, throughStepId)}`
  }

  async openFile(file: File): Promise<void> {
    this.emit({ status: 'importing', error: undefined, warnings: [] })
    try {
      const dataset = await this.client.import(file)
      this.history = new RecipeHistory(createRecipe(dataset.id, dataset.revision))
      this.cache.clear()
      this.guard.update(`${datasetVersionKey(dataset)}|${selectionKey({})}|`)
      this.emit({
        dataset,
        selection: {},
        recipe: this.history.current(),
        throughStepId: undefined,
        image: null,
        results: [],
        stats: undefined,
        table: undefined,
        status: 'ready',
        estimatedBytes: 0,
      })
      await this.run()
    } catch (error) {
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  setSelection(patch: SliceSelection): void {
    const dataset = this.state.dataset
    if (!dataset) return
    const selection = { ...this.state.selection, ...patch }
    this.emit({ selection })
    void this.run()
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

  addStep(op: string): void {
    if (!this.history) return
    const capability = getOperator(op)
    if (!capability) return
    const step = makeStep(op, defaultOperatorParams(capability))
    this.history.commit(appendStep(this.history.current(), step))
    this.emit({ recipe: this.history.current(), throughStepId: step.id })
    void this.run()
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

  async run(): Promise<void> {
    const dataset = this.state.dataset
    const recipe = this.currentRecipe()
    if (!dataset || !recipe || this.disposed) return
    const version = this.versionFor(recipe, this.state.throughStepId)
    this.guard.update(version)
    this.emit({ status: 'running', error: undefined })
    // 先给当前页做缓存查找。
    const key = this.cacheKeyFor(dataset, recipe, this.state.selection, this.state.throughStepId)
    const cached = this.cache.get(key)
    if (cached) {
      this.emit({ image: cached, status: 'ready' })
      this.schedulePrefetch()
      return
    }
    try {
      const result = await this.client.run({
        datasetId: dataset.id,
        recipe,
        selection: this.state.selection,
        throughStepId: this.state.throughStepId,
      })
      if (this.guard.version() !== version) return // 过期结果不覆盖当前画面
      if (result.image) {
        const bytes = result.image.data.byteLength
        this.cache.set(key, result.image, bytes, true)
      }
      this.emit({
        image: result.image,
        results: result.results,
        stats: result.stats,
        table: result.table,
        status: 'ready',
        lastRunMs: result.ms,
        estimatedBytes: result.estimatedBytes,
      })
      this.schedulePrefetch()
    } catch (error) {
      this.emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  private cacheKeyFor(dataset: Dataset, recipe: Recipe, selection: SliceSelection, throughStepId?: string): string {
    return [
      datasetVersionKey(dataset),
      selectionKey(selection),
      recipeVersionKey(recipe, throughStepId),
    ].join('\u0001')
  }

  /** 预取邻页（P2）：按翻页方向设置优先级，结果只入缓存。 */
  private schedulePrefetch(): void {
    const dataset = this.state.dataset
    const recipe = this.currentRecipe()
    if (!this.prefetchEnabled || !dataset || !recipe) return
    const axis = (['z', 't', 'c'] as const).find((candidate) => (dataset.shape[dataset.axes.indexOf(candidate)] ?? 1) > 1)
    if (!axis) return
    const length = dataset.shape[dataset.axes.indexOf(axis)]!
    const current = this.state.selection[axis] ?? 0
    for (const delta of [1, -1, 2]) {
      const target = current + delta
      if (target < 0 || target >= length) continue
      const selection = { ...this.state.selection, [axis]: target }
      const key = this.cacheKeyFor(dataset, recipe, selection, this.state.throughStepId)
      if (this.cache.has(key)) continue
      const version = `${datasetVersionKey(dataset)}|${selectionKey(selection)}|${recipeVersionKey(recipe, this.state.throughStepId)}`
      const task: SchedulerTask<EngineResult> = {
        id: `prefetch:${key}`,
        priority: delta > 0 ? TASK_PRIORITY.prefetchForward : TASK_PRIORITY.prefetchBackward,
        coalesceKey: `prefetch:${axis}:${target}`,
        isStale: () => this.guard.version() !== version,
        run: async () => {
          const result = await this.client.run({
            datasetId: dataset.id,
            recipe,
            selection,
            throughStepId: this.state.throughStepId,
          })
          if (result.image) {
            this.cache.set(key, result.image, result.image.data.byteLength)
          }
          return result
        },
      }
      this.queue.push(task)
    }
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.disposed) return
    this.pumping = true
    try {
      for (;;) {
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
    this.queue.clear()
    this.cache.clear()
    this.client.terminate()
    this.listeners.clear()
  }
}
