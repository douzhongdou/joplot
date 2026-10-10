/**
 * 依赖级脏传播。
 *
 * 与"线性保守"不同：只有真正变化（或被变化步骤的输出所消费）的步骤才会被标脏。
 * 例如修改 smooth1 的参数，只会脏 smooth1，以及输入引用 smooth1 的下游步骤；
 * 输入是 signal 的 fft1 不受影响。
 *
 * 按 `id` + 对象引用比对，而不是按数组下标：
 * - 删除末步时下标法会返回空集，导致自动运行不触发、旧结果留在界面；
 * - 删除中间步骤时下标法会把后续整段误标脏。
 * 删除产生的输入重映射会让受影响步骤变成新对象，因此本就应被标脏。
 */

import type { AnalysisStep } from './pipeline.ts'
import { vectorParentId } from './vectors.ts'

export function computeDirtySteps(steps: AnalysisStep[], previous: AnalysisStep[]): Set<string> {
  const dirty = new Set<string>()
  const previousById = new Map(previous.map((step) => [step.id, step]))

  // 1. 定义发生变化 / 新增的步骤（按 id 匹配：同 id 但换了对象引用即视为改动）
  for (const step of steps) {
    if (previousById.get(step.id) !== step) {
      dirty.add(step.id)
    }
  }

  if (dirty.size === 0) {
    return dirty
  }

  // 2. 沿 input 依赖做传递闭包：谁消费了脏输出，谁就脏
  const producerByOutput = new Map<string, string>()
  for (const step of steps) {
    producerByOutput.set(step.outputId, step.id)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const step of steps) {
      if (dirty.has(step.id)) {
        continue
      }
      const inputs = [step.inputId, step.secondInputId]
      const consumesDirty = inputs.some((inputId) => {
        if (!inputId) return false
        const producer = producerByOutput.get(vectorParentId(inputId))
        return producer !== undefined && dirty.has(producer)
      })
      if (consumesDirty) {
        dirty.add(step.id)
        changed = true
      }
    }
  }

  return dirty
}

/**
 * `previous` 有、`next` 没有的 outputId：即被删除步骤的产出。
 * 这些产出必须从 Worker 缓存驱逐，否则 preview/export 仍能取到"幽灵值"。
 */
export function removedOutputIds(previous: AnalysisStep[], next: AnalysisStep[]): string[] {
  const current = new Set(next.map((step) => step.outputId))
  const removed: string[] = []
  for (const step of previous) {
    if (!current.has(step.outputId)) {
      removed.push(step.outputId)
    }
  }
  return removed
}
