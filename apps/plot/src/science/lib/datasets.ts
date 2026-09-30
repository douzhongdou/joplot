/**
 * 数据集列表的纯操作，以及「变更前是否需要从持久层水合」的判定。
 *
 * Worker 可能因取消/崩溃被重建，此时内存 `datasets` 为空，但 IndexedDB 里仍有数据。
 * 因此 import / remove-dataset 必须先以持久层数据为基集，否则会用空/局部内存覆盖存储：
 *   - cancel 后重新导入 → 旧数据集被覆盖丢失；
 *   - cancel 后删除数据集 → 把持久存储写空。
 * reset-sample 属主动清空，不读持久层。
 */

import type { SuperDataset } from '../../superplot/types.ts'

export type DatasetMutateKind = 'import' | 'remove-dataset' | 'reset-sample'

/**
 * 解析数据集变更的操作基集：
 * - `reset-sample` → 空（主动清空）；
 * - `import` / `remove-dataset` → 内存有则用内存，内存为空（Worker 刚重建）则从持久层加载。
 */
export async function resolveDatasetMutationBase(
  kind: DatasetMutateKind,
  inMemory: SuperDataset[],
  load: () => Promise<SuperDataset[]>,
): Promise<SuperDataset[]> {
  if (kind === 'reset-sample') {
    return []
  }
  return inMemory.length > 0 ? inMemory : await load()
}

/** 导入去重：已有同 id 时加数字后缀。 */
export function dedupeDatasetId(existing: SuperDataset[], parsed: SuperDataset): SuperDataset {
  let dataset = parsed
  let suffix = 2
  while (existing.some((candidate) => candidate.id === dataset.id)) {
    dataset = { ...parsed, id: `${parsed.id}-${suffix}` }
    suffix += 1
  }
  return dataset
}

/** 删除指定 id 的数据集。 */
export function removeDatasetById(existing: SuperDataset[], datasetId: string): SuperDataset[] {
  return existing.filter((dataset) => dataset.id !== datasetId)
}
