/**
 * 依赖级脏传播。
 *
 * 与"线性保守"不同：只有真正变化（或被变化步骤的输出所消费）的步骤才会被标脏。
 * 例如修改 smooth1 的参数，只会脏 smooth1，以及输入引用 smooth1 的下游步骤；
 * 输入是 signal 的 fft1 不受影响。
 */

import type { AnalysisStep } from './pipeline.ts'

export function computeDirtySteps(steps: AnalysisStep[], previous: AnalysisStep[]): Set<string> {
  const dirty = new Set<string>()

  // 1. 定义发生变化 / 新增的步骤
  for (let i = 0; i < steps.length; i += 1) {
    if (i >= previous.length || previous[i] !== steps[i]) {
      dirty.add(steps[i].id)
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
        const producer = producerByOutput.get(inputId)
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
