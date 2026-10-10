/**
 * 分析流水线：线性 recipe（分析栈）。
 *
 * 引擎本身不认识任何具体算子——它只按注册表查找 OperatorDef 并调用 run。
 * 新增算子只需改 `operators.ts`。
 */

import type { ScienceValue, Series } from '../types.ts'
import { getOperator, type OperatorParams } from './operators.ts'
import { resolveValue } from './vectors.ts'

export type OpKind = string

export interface AnalysisStep {
  id: string
  op: OpKind
  inputId: string
  secondInputId?: string
  params: OperatorParams
  outputId: string
}

export type StepInsertPosition =
  | { type: 'before' | 'after'; stepId: string }
  | { type: 'end' }

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

export function runStep(
  step: AnalysisStep,
  input: ScienceValue | undefined,
  secondInput: ScienceValue | undefined,
): ScienceValue {
  const definition = getOperator(step.op)
  if (!definition) {
    throw new Error(`step ${step.id}: unknown operator "${step.op}"`)
  }

  const first = requireSeries(input, step, step.inputId, 'input')
  const second = definition.secondInput
    ? requireSeries(secondInput, step, step.secondInputId, 'second input')
    : undefined

  return definition.run(first, second, step.params, { id: step.outputId, name: step.outputId })
}

export function runPipeline(base: ScienceValue[], steps: AnalysisStep[]): PipelineResult {
  const values = [...base]
  const errors: Record<string, string> = {}
  const timings: Record<string, number> = {}

  for (const step of steps) {
    const started = performance.now()
    const input = resolveValue(values, step.inputId)
    const secondInput = step.secondInputId
      ? resolveValue(values, step.secondInputId)
      : undefined

    try {
      values.push(runStep(step, input, secondInput))
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

/** Insert into the recipe, connecting the adjacent step when the new output is a series. */
export function insertAnalysisStep(
  steps: AnalysisStep[],
  op: OpKind,
  position: StepInsertPosition,
  fallbackInputId: string,
): { steps: AnalysisStep[]; inserted: AnalysisStep } | null {
  const anchorIndex = position.type === 'end'
    ? -1
    : steps.findIndex((step) => step.id === position.stepId)
  if (position.type !== 'end' && anchorIndex < 0) {
    return null
  }

  const anchor = anchorIndex < 0 ? undefined : steps[anchorIndex]
  const index = position.type === 'end'
    ? steps.length
    : position.type === 'before' ? anchorIndex : anchorIndex + 1
  const anchorProducesSeries = anchor ? getOperator(anchor.op)?.output === 'series' : false
  const inputId = position.type === 'before'
    ? anchor!.inputId
    : position.type === 'after'
      ? anchorProducesSeries ? anchor!.outputId : anchor!.inputId
      : fallbackInputId
  const outputId = nextStepId(steps, op)
  const inserted: AnalysisStep = {
    id: `step-${outputId}`,
    op,
    inputId,
    params: defaultParams(op),
    outputId,
  }
  const next = [...steps]
  next.splice(index, 0, inserted)

  // Keep existing branches alone. Only the immediately following step in this chain is reconnected.
  const shouldConnectNext = getOperator(op)?.output === 'series'
    && (position.type === 'before' || (position.type === 'after' && anchorProducesSeries))
  const following = next[index + 1]
  if (shouldConnectNext && following?.inputId === inputId) {
    next[index + 1] = { ...following, inputId: outputId }
  }

  return { steps: next, inserted }
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
