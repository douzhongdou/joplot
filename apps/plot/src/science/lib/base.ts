/**
 * base（分析栈输入）的构建与步骤输入重映射。
 *
 * Runtime 归属模型下，这些都在 Worker 里执行：Worker 持有 SuperDataset[]，
 * 依据 mappings 构建 base，并在 base 变化后把失效的步骤输入重指向首个可用变量。
 */

import type { DatasetMapping, DatasetSummary, ScienceValue } from '../types.ts'
import type { SuperDataset } from '../../superplot/types.ts'
import type { AnalysisStep } from './pipeline.ts'
import { seriesListFromDataset } from './import.ts'
import { vectorParentId } from './vectors.ts'

/** 用「数据集 + 映射」构建 base；无有效序列时返回空数组（由调用方决定是否回退示例信号）。 */
export function buildBaseValues(
  datasets: SuperDataset[],
  mappings: Record<string, DatasetMapping>,
): ScienceValue[] {
  return datasets.flatMap((dataset) => {
    const mapping = mappings[dataset.id]
    if (!mapping) return []
    try {
      return seriesListFromDataset(dataset, mapping.xColumn, mapping.yColumns, mapping.groupColumn)
    } catch {
      return []
    }
  })
}

/** 把引用了不存在变量的步骤输入重指向 fallbackId。 */
export function remapStepInputs(
  steps: AnalysisStep[],
  availableIds: ReadonlySet<string>,
  fallbackId: string,
): AnalysisStep[] {
  return steps.map((step) => ({
    ...step,
    inputId: availableIds.has(vectorParentId(step.inputId)) ? step.inputId : fallbackId,
    secondInputId: step.secondInputId && !availableIds.has(vectorParentId(step.secondInputId))
      ? fallbackId
      : step.secondInputId,
  }))
}

export function baseValueIds(values: ScienceValue[]): Set<string> {
  return new Set(values.map((value) => value.id))
}

/** 从 Worker 返回的 values（base + 步骤产出）里还原 base 变量 id。 */
export function inferBaseIds(values: ScienceValue[], producedSteps: AnalysisStep[]): string[] {
  const produced = new Set(producedSteps.map((step) => step.outputId))
  return values.filter((value) => !produced.has(value.id)).map((value) => value.id)
}

/**
 * 数据源变化后，把「当前步骤」按新 base 重映射：
 * 可用输入 = 新 base 变量 + 当前步骤产出；失效引用指向首个 base 变量。
 */
export function reconcileSteps(
  values: ScienceValue[],
  producedSteps: AnalysisStep[],
  currentSteps: AnalysisStep[],
): AnalysisStep[] {
  const baseIds = inferBaseIds(values, producedSteps)
  const available = new Set(baseIds)
  for (const step of currentSteps) {
    available.add(step.outputId)
  }
  return remapStepInputs(currentSteps, available, baseIds[0] ?? 'signal')
}

export function datasetSummary(dataset: SuperDataset): DatasetSummary {
  return {
    id: dataset.id,
    fileName: dataset.fileName,
    headers: dataset.headers,
    numericColumns: dataset.numericColumns,
    rowCount: dataset.rowCount,
    timeColumn: dataset.timeColumn,
    createdAt: dataset.createdAt,
    fileSize: dataset.fileSize,
  }
}

/** 纠正映射：Y 列去重、排除 X 列，至少保留一个 Y；分组列必须是有效表头且不等于 X。 */
export function sanitizeMapping(summary: DatasetSummary, nextX: string, nextYs: string[], nextGroup = ''): DatasetMapping {
  let yColumns = [...new Set(nextYs)].filter((name) => name !== nextX)
  if (yColumns.length === 0) {
    yColumns = summary.numericColumns.filter((name) => name !== nextX).slice(0, 1)
  }
  const groupColumn = nextGroup && nextGroup !== nextX && summary.headers.includes(nextGroup)
    ? nextGroup
    : undefined
  return groupColumn ? { xColumn: nextX, yColumns, groupColumn } : { xColumn: nextX, yColumns }
}

/** 新数据集的默认映射：优先用推断出的时间列做 X，否则用行号。 */
export function defaultMapping(summary: DatasetSummary): DatasetMapping {
  return sanitizeMapping(summary, summary.timeColumn ?? '', [])
}

