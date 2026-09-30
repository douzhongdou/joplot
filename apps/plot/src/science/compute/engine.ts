/**
 * 计算内核：`base + steps → values`，含缓存复用与按需驱逐。
 *
 * 从 Worker 抽出为纯逻辑，便于单测（不触碰 Worker / IndexedDB API）。
 * 语义：
 * - 不在 `dirtyIds` 且命中缓存的步骤直接复用缓存输出；
 * - `evictIds` 中的产出先从缓存删除，确保被删除步骤不会经 `findValue` 落到 preview/export。
 */

import type { ScienceValue } from '../types.ts'
import type { AnalysisStep } from '../lib/pipeline.ts'
import { runStep } from '../lib/pipeline.ts'
import { resolveValue, vectorParentId } from '../lib/vectors.ts'

export interface ComputeOutcome {
  values: ScienceValue[]
  errors: Record<string, string>
  timings: Record<string, number>
}

export interface ComputeInput {
  base: ScienceValue[]
  steps: AnalysisStep[]
  /** 需要重算的步骤 id；其余步骤若命中缓存则直接复用。 */
  dirtyIds: ReadonlySet<string>
  /** 产出缓存（原地更新）。 */
  cache: Map<string, ScienceValue>
  /** 需要驱逐的产出 id（被删除的步骤）。 */
  evictIds?: Iterable<string>
}

export function computeValues(input: ComputeInput): ComputeOutcome {
  const { base, steps, dirtyIds, cache } = input

  for (const id of input.evictIds ?? []) {
    cache.delete(id)
  }

  const available = new Map<string, ScienceValue>()
  const values: ScienceValue[] = [...base]
  for (const value of values) {
    available.set(value.id, value)
  }
  const resolveInput = (id: string): ScienceValue | undefined => {
    const parent = available.get(vectorParentId(id))
    return parent ? resolveValue([parent], id) : undefined
  }

  const errors: Record<string, string> = {}
  const timings: Record<string, number> = {}

  for (const step of steps) {
    const cached = cache.get(step.outputId)
    if (!dirtyIds.has(step.id) && cached) {
      available.set(step.outputId, cached)
      values.push(cached)
      continue
    }

    const started = performance.now()
    try {
      const value = runStep(
        step,
        resolveInput(step.inputId),
        step.secondInputId ? resolveInput(step.secondInputId) : undefined,
      )
      available.set(step.outputId, value)
      cache.set(step.outputId, value)
      values.push(value)
    } catch (error) {
      cache.delete(step.outputId)
      errors[step.id] = error instanceof Error ? error.message : String(error)
    }
    timings[step.id] = performance.now() - started
  }

  return { values, errors, timings }
}
