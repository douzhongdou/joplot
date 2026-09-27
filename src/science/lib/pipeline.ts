/**
 * 分析流水线：线性 recipe（分析栈）。
 *
 * 引擎本身不认识任何具体算子——它只按注册表查找 OperatorDef 并调用 run。
 * 新增算子只需改 `operators.ts`。
 */

import type { ScienceValue, Series } from '../types.ts'
import { getOperator, type OperatorParams } from './operators.ts'

export type OpKind = string

export interface AnalysisStep {
  id: string
  op: OpKind
  inputId: string
  secondInputId?: string
  params: OperatorParams
  outputId: string
}

export interface PipelineResult {
  values: ScienceValue[]
  errors: Record<string, string>
  timings: Record<string, number>
}

export { detrendValues } from './transforms.ts'
export { getOperator, OPERATORS, OPERATOR_CATEGORIES } from './operators.ts'
export type {
  OperatorCategory,
  OperatorDef,
  OperatorOutput,
  OperatorParams,
  ParamSpec,
} from './operators.ts'

function requireSeries(
  value: ScienceValue | undefined,
  step: AnalysisStep,
  inputId: string | undefined,
  which: string,
): Series {
  if (!inputId) {
    throw new Error(`step ${step.id}: ${which} is not set`)
  }
  if (!value) {
    throw new Error(`step ${step.id}: ${which} "${inputId}" is missing (deleted or upstream failed)`)
  }
  if (value.kind !== 'series') {
    throw new Error(`step ${step.id}: ${which} "${inputId}" is a ${value.kind}, expected a series`)
  }
  return value
}

export function runPipeline(base: ScienceValue[], steps: AnalysisStep[]): PipelineResult {
  const values = [...base]
  const errors: Record<string, string> = {}
  const timings: Record<string, number> = {}

  for (const step of steps) {
    const started = performance.now()
    const definition = getOperator(step.op)
    if (!definition) {
      errors[step.id] = `step ${step.id}: unknown operator "${step.op}"`
      timings[step.id] = performance.now() - started
      continue
    }

    const input = values.find((value) => value.id === step.inputId)
    const secondInput = step.secondInputId
      ? values.find((value) => value.id === step.secondInputId)
      : undefined

    try {
      const first = requireSeries(input, step, step.inputId, 'input')
      const second = definition.secondInput
        ? requireSeries(secondInput, step, step.secondInputId, 'second input')
        : undefined

      values.push(definition.run(first, second, step.params, { id: step.outputId, name: step.outputId }))
    } catch (error) {
      errors[step.id] = error instanceof Error ? error.message : String(error)
    }

    timings[step.id] = performance.now() - started
  }

  return { values, errors, timings }
}

export function nextStepId(steps: AnalysisStep[], op: OpKind): string {
  let index = 1
  for (;;) {
    const candidate = `${op}${index}`
    if (!steps.some((step) => step.outputId === candidate)) {
      return candidate
    }
    index += 1
  }
}

export function defaultParams(op: OpKind): OperatorParams {
  const definition = getOperator(op)
  if (!definition) {
    return {}
  }

  const params: OperatorParams = {}
  for (const spec of definition.params) {
    params[spec.key] = spec.default
  }
  return params
}
