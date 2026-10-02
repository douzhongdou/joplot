/**
 * 引擎宿主：管理已导入的 Dataset/Storage 并执行 Recipe。
 *
 * Worker 与主线程回退路径共用这一实现，避免行为分叉。像素不跨线程复制时可直接用
 * 主线程宿主（测试、SSR、Worker 不可用时）。
 */
import type { Dataset, SliceSelection } from '../dataset.ts'
import type { Storage } from '../storage.ts'
import { importFile, type ImportResult } from '../importer.ts'
import { PureComputeEngine, type EngineRunResult } from '../compute/engine.ts'
import type { Recipe } from '../recipe.ts'
import type { Region } from '../types.ts'

export interface HostRunRequest {
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  throughStepId?: string
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

  dataset(datasetId: string): Dataset | undefined {
    return this.entries.get(datasetId)?.dataset
  }

  async run(request: HostRunRequest): Promise<EngineRunResult> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    entry.controller = new AbortController()
    return this.engine.runRecipe(
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
