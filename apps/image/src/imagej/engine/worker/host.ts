/**
 * 引擎宿主：管理已导入的 Dataset/Storage 并执行 Recipe。
 *
 * Worker 与主线程回退路径共用这一实现，避免行为分叉。像素不跨线程复制时可直接用
 * 主线程宿主（测试、SSR、Worker 不可用时）。
 */
import type { Dataset, SliceSelection } from '../dataset.ts'
import type { Storage } from '../storage.ts'
import { importFile, importImageStack, type ImportResult } from '../importer.ts'
import { analyzeBlock } from '../analysis.ts'
import { PureComputeEngine, type EngineRunResult } from '../compute/engine.ts'
import type { Recipe } from '../recipe.ts'
import type { Region } from '../types.ts'

export interface HostRunRequest {
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  throughStepId?: string
  /** 是否在算出图像后顺带产出整帧分析，供主线程直接读取（避免再复制一份画面）。 */
  analyze?: boolean
}

interface Entry {
  dataset: Dataset
  storage: Storage
  controller: AbortController
}

export class EngineHost {
  private readonly entries = new Map<string, Entry>()
  private readonly engine = new PureComputeEngine()

  async import(file: File, decoder?: (file: File) => Promise<unknown | null>): Promise<ImportResult> {
    const result = await importFile(file, decoder as never)
    this.entries.set(result.dataset.id, { dataset: result.dataset, storage: result.storage, controller: new AbortController() })
    return result
  }

  async importStack(files: File[], decoder?: (file: File) => Promise<unknown | null>): Promise<ImportResult> {
    const result = await importImageStack(files, decoder as never)
    this.entries.set(result.dataset.id, { dataset: result.dataset, storage: result.storage, controller: new AbortController() })
    return result
  }

  dataset(datasetId: string): Dataset | undefined {
    return this.entries.get(datasetId)?.dataset
  }

  async run(request: HostRunRequest): Promise<EngineRunResult> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    entry.controller = new AbortController()
    const outcome = await this.engine.runRecipe(
      {
        dataset: entry.dataset,
        storage: entry.storage,
        selection: request.selection,
        roi: request.roi,
        signal: entry.controller.signal,
        retainStepImages: false,
      },
      request.recipe,
      request.throughStepId,
    )
    // 分析在同一线程里顺带完成：主线程无需再复制整帧、再跑第二个 Worker。
    if (request.analyze && outcome.image) outcome.analysis = analyzeBlock(outcome.image)
    return outcome
  }

  cancel(): void {
    for (const entry of this.entries.values()) entry.controller.abort()
  }

  dispose(datasetId?: string): void {
    if (datasetId) {
      this.entries.get(datasetId)?.storage.release()
      this.entries.delete(datasetId)
      return
    }
    for (const entry of this.entries.values()) entry.storage.release()
    this.entries.clear()
  }
}
