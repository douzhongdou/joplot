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

/** 用「数据集 + 映射」构建 base；无有效序列时返回空数组（由调用方决定是否回退示例信号）。 */
export function buildBaseValues(
  datasets: SuperDataset[],
  mappings: Record<string, DatasetMapping>,
): ScienceValue[] {
  return datasets.flatMap((dataset) => {
    const mapping = mappings[dataset.id]
    if (!mapping) return []
    try {
      return seriesListFromDataset(dataset, mapping.xColumn, mapping.yColumns)
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
    inputId: availableIds.has(step.inputId) ? step.inputId : fallbackId,
    secondInputId: step.secondInputId && !availableIds.has(step.secondInputId)
      ? fallbackId
      : step.secondInputId,
  }))
}

export function baseValueIds(values: ScienceValue[]): Set<string> {
  return new Set(values.map((value) => value.id))
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

/** 纠正映射：Y 列去重、排除 X 列，至少保留一个 Y。 */
export function sanitizeMapping(summary: DatasetSummary, nextX: string, nextYs: string[]): DatasetMapping {
  let yColumns = [...new Set(nextYs)].filter((name) => name !== nextX)
  if (yColumns.length === 0) {
    yColumns = summary.numericColumns.filter((name) => name !== nextX).slice(0, 1)
  }
  return { xColumn: nextX, yColumns }
}

/** 新数据集的默认映射：优先用推断出的时间列做 X，否则用行号。 */
export function defaultMapping(summary: DatasetSummary): DatasetMapping {
  return sanitizeMapping(summary, summary.timeColumn ?? '', [])
}

