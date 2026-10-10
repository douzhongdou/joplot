/**
 * run / evict 的协调逻辑（纯函数，便于单测）。
 *
 * 背景：`run` 提交的是**调用时的步骤快照**，Worker 计算期间主线程可能继续编辑
 * （尤其删除末步）。此时：
 * - 旧快照的响应不得覆盖当前步骤，否则被删步骤的产出会被写回界面（幽灵复活）；
 * - 驱逐项必须在删除后及时执行，且"已发送"的驱逐不能连带清掉期间新登记的驱逐。
 */

import type { AnalysisStep } from './pipeline.ts'
import { removedOutputIds } from './dirty.ts'
import { vectorParentId } from './vectors.ts'

/**
 * 响应所基于的步骤快照，是否仍是当前步骤（或当前步骤的前缀）。
 * 元素按引用比对：任一步骤被替换/删除都会失配，从而拒绝采纳旧结果。
 */
export function snapshotStillCurrent(submitted: AnalysisStep[], current: AnalysisStep[]): boolean {
  if (submitted.length > current.length) {
    return false
  }
  for (let index = 0; index < submitted.length; index += 1) {
    if (submitted[index] !== current[index]) {
      return false
    }
  }
  return true
}

/**
 * 只清除本次请求**实际发送过**的驱逐项，保留期间新登记的。
 * （旧行为无条件清空 evict 集合，会把尚未发送的驱逐永久丢失。）
 */
export function forgetSentEvictions(current: ReadonlySet<string>, sent: Iterable<string>): Set<string> {
  const next = new Set(current)
  for (const id of sent) {
    next.delete(id)
  }
  return next
}

/** 相对上次提交新出现、且尚未登记的待驱逐产出。 */
export function novelEvictions(
  previous: AnalysisStep[],
  current: AnalysisStep[],
  alreadyEvicting: ReadonlySet<string>,
): string[] {
  return removedOutputIds(previous, current).filter((id) => !alreadyEvicting.has(id))
}

/**
 * 删除步骤后的选中项决策：
 * - 只有被删步骤的产出恰好是当前选中项时才改选（删除非选中步骤不得动选中项）；
 * - 优先取当前结果中首个仍存在的值，否则回退到 `fallbackId`。
 * 这样可避免 recipe 持久化一个已不存在的幽灵 id，而不是仅靠 UI 的 values[0] 临时回退。
 */
export function selectionAfterRemoval(
  currentSelectedId: string,
  removedOutputId: string,
  availableIds: readonly string[],
  fallbackId: string,
): string {
  if (vectorParentId(currentSelectedId) !== removedOutputId) {
    return currentSelectedId
  }
  return availableIds[0] ?? fallbackId
}
