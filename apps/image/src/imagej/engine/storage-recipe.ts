/** 冻结处理链的按页存储。只保留 Recipe 和源引用，不保存整栈处理后的像素。 */
import type { Dataset, SliceSelection } from './dataset.ts'
import { PureComputeEngine } from './compute/engine.ts'
import type { Recipe } from './recipe.ts'
import { assertSameShape } from './stackProject.ts'
import { MemoryStorage, SharedStorage, validateRegion, type Storage, type StorageMetadata, type ReadRegionOptions } from './storage.ts'
import type { ImageBlock, Region } from './types.ts'

export class RecipePageStorage implements Storage {
  readonly id: string
  private readonly engine = new PureComputeEngine()
  private released = false
  private readonly dataset: Dataset
  private readonly source: SharedStorage
  private readonly recipe: Recipe
  private readonly meta: StorageMetadata
  private readonly throughStepId?: string

  private constructor(
    dataset: Dataset, source: SharedStorage, recipe: Recipe, meta: StorageMetadata, throughStepId?: string,
  ) {
    this.id = `${dataset.id}:recipe`
    this.dataset = dataset
    this.source = source
    this.recipe = recipe
    this.meta = meta
    this.throughStepId = throughStepId
  }

  static async create(dataset: Dataset, source: Storage, recipe: Recipe, throughStepId?: string, retained?: { axis: keyof SliceSelection; pages: readonly number[]; signal?: AbortSignal }): Promise<RecipePageStorage> {
    if (!(source instanceof SharedStorage)) throw new Error('RecipePageStorage 需要共享源存储')
    const owned = source.retain()
    const signal = retained?.signal
    const engine = new PureComputeEngine()
    const leading = dataset.axes.map((axis, i) => ({ axis, length: dataset.shape[i]! }))
      .filter((entry) => entry.axis !== 'x' && entry.axis !== 'y' && !(entry.axis === 'c' && dataset.componentKind === 'rgb'))
    const count = leading.reduce((product, entry) => product * entry.length, 1)
    const retainedPages = retained ? new Set(retained.pages) : undefined
    let first: ImageBlock | undefined
    try {
      const frozen = structuredClone(recipe)
      // 仅校验保留下来的页：子栈可从异形源中选出同形页。任何时刻仅保留首帧和当前帧。
      for (let page = 0; page < count; page++) {
        if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
        let remainder = page
        const selection: SliceSelection = {}
        for (let i = leading.length - 1; i >= 0; i--) {
          const entry = leading[i]!
          selection[entry.axis as keyof SliceSelection] = remainder % entry.length
          remainder = Math.floor(remainder / entry.length)
        }
        if (retained && !retainedPages!.has(selection[retained.axis] ?? 0)) continue
        const outcome = await engine.runRecipe({ dataset, storage: owned, selection, signal, retainStepImages: false }, frozen, throughStepId)
        if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
        const failure = outcome.results.find((result) => result.status === 'error')
        if (failure) throw new Error(failure.error)
        if (!outcome.image) throw new Error('栈重排未取得处理后的像素')
        first ??= outcome.image
        assertSameShape([first, outcome.image])
      }
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
      const block = first!
      if (new Set(block.axes).size !== block.axes.length) throw new Error('处理后的通道轴与切片轴冲突，无法重排此栈')
      const shape = block.shape.map((size, i) => leading.find((entry) => entry.axis === block.axes[i])?.length ?? size)
      const rgb = block.axes.includes('c') && block.shape[block.axes.indexOf('c')] === 3
      const meta: StorageMetadata = { ...source.metadata(), dtype: block.dtype, axes: [...block.axes], shape, channels: rgb ? [
        { index: 0, name: 'Red', kind: 'rgb', displayColor: [255, 0, 0] },
        { index: 1, name: 'Green', kind: 'rgb', displayColor: [0, 255, 0] },
        { index: 2, name: 'Blue', kind: 'rgb', displayColor: [0, 0, 255] },
      ] : [{ index: 0, name: 'Channel 1', kind: 'other' }] }
      return new RecipePageStorage(dataset, owned, frozen, meta, throughStepId)
    } catch (error) { owned.release(); throw error }
  }

  metadata(): StorageMetadata { return this.meta }
  capabilities() {
    return { regionRead: true, pageRead: true, compressed: this.source.capabilities().compressed, dtypes: [this.meta.dtype], dimensions: this.meta.axes.length }
  }

  async readRegion(region: Region, options?: ReadRegionOptions): Promise<ImageBlock> {
    if (this.released) throw new Error('RecipePageStorage 已释放')
    validateRegion(region, this.meta.axes, this.meta.shape)
    const selection: SliceSelection = {}
    for (let i = 0; i < this.meta.axes.length; i++) {
      const axis = this.meta.axes[i]!
      if (axis === 'x' || axis === 'y' || (axis === 'c' && this.meta.channels?.[0]?.kind === 'rgb')) continue
      if (region.shape[i] !== 1) throw new Error('RecipePageStorage 每次只能读取一帧')
      selection[axis] = region.start[i]!
    }
    const outcome = await this.engine.runRecipe({ dataset: this.dataset, storage: this.source, selection, signal: options?.signal, retainStepImages: false }, this.recipe, this.throughStepId)
    const failure = outcome.results.find((result) => result.status === 'error')
    if (failure) throw new Error(failure.error)
    if (!outcome.image) throw new Error('栈重排未取得处理后的像素')
    const block = outcome.image
    const memory = new MemoryStorage(this.id, { ...this.meta, shape: block.shape }, block.data)
    const local = { start: region.start.map((value, i) => this.meta.axes[i] === 'x' || this.meta.axes[i] === 'y' || (this.meta.axes[i] === 'c' && this.meta.channels?.[0]?.kind === 'rgb') ? value : 0), shape: [...region.shape] }
    try {
      const cropped = await memory.readRegion(local, options)
      return { ...cropped, region: { start: [...region.start], shape: [...region.shape] } }
    } finally { memory.release() }
  }

  release(): void {
    if (this.released) return
    this.released = true
    this.source.release()
  }
}
