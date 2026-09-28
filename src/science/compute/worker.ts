/**
 * 常驻计算 Worker —— 数据集的「运行时主人」。
 *
 * 归属模型：
 *   - Runtime：Worker 持有 `datasets`(SuperDataset[])、`mappings`、`base`、`cache`。
 *   - Durable：IndexedDB 保存 `datasets`（本 Worker 写）；配方由主线程保存。
 * Worker 被终止（取消/重载/崩溃）后，靠 `hydrate` 从 IndexedDB 重新水合。
 *
 * 主线程只发请求、只收：数据集元信息 + 步骤 + 降采样预览。
 */

import type { DatasetMapping, ScienceValue, WorkspaceSource } from '../types.ts'
import type { SuperDataset } from '../../superplot/types.ts'
import type { AnalysisStep } from '../lib/pipeline.ts'
import { createSampleWorkspace } from '../lib/workspace.ts'
import { runStep } from '../lib/pipeline.ts'
import {
  baseValueIds,
  buildBaseValues,
  datasetSummary,
  defaultMapping,
  remapStepInputs,
} from '../lib/base.ts'
import { readScienceDataset } from '../lib/readDataset.ts'
import { loadScienceDatasets, saveScienceDatasets } from '../lib/persistence.ts'
import { valueToCsv } from '../lib/export.ts'
import { toPreview, toPreviewInRange } from './preview.ts'
import type { MutateRequest, RunRequest, WorkerRequest, WorkerResponse } from './protocol.ts'

interface WorkerScope {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}

const scope = self as unknown as WorkerScope

let datasets: SuperDataset[] = []
let mappings: Record<string, DatasetMapping> = {}
let base: ScienceValue[] | null = null
const cache = new Map<string, ScienceValue>()

function post(message: WorkerResponse): void {
  scope.postMessage(message)
}

function sampleBase(): ScienceValue[] {
  return createSampleWorkspace().base
}

async function hydrateIfNeeded(source: WorkspaceSource): Promise<void> {
  if (source === 'dataset' && datasets.length === 0) {
    datasets = await loadScienceDatasets()
  }
}

/** 保证每个数据集都有映射；清掉已删除数据集的映射。 */
function reconcileMappings(provided: Record<string, DatasetMapping>, current: SuperDataset[]): Record<string, DatasetMapping> {
  const next: Record<string, DatasetMapping> = {}
  for (const dataset of current) {
    next[dataset.id] = provided[dataset.id] ?? defaultMapping(datasetSummary(dataset))
  }
  return next
}

function rebuildBase(source: WorkspaceSource): void {
  base = source === 'sample' ? sampleBase() : buildBaseValues(datasets, mappings)
}

function finalizeSteps(steps: AnalysisStep[], resetStepsToStats: boolean): AnalysisStep[] {
  const values = base ?? []
  const firstId = values[0]?.id ?? 'signal'
  if (resetStepsToStats && values.length > 0) {
    return [{ id: 'step-stats', op: 'stats', inputId: firstId, params: {}, outputId: 'stats1' }]
  }
  // 可用输入 = base 变量 + 其他步骤的产出；只有真正失效的引用才重指向。
  const available = baseValueIds(values)
  for (const step of steps) {
    available.add(step.outputId)
  }
  return remapStepInputs(steps, available, firstId)
}

interface ComputeOutcome {
  values: ScienceValue[]
  errors: Record<string, string>
  timings: Record<string, number>
}

function compute(steps: AnalysisStep[], dirtyIds: Set<string>): ComputeOutcome {
  const available = new Map<string, ScienceValue>()
  const values: ScienceValue[] = [...(base ?? [])]
  for (const value of values) {
    available.set(value.id, value)
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
        available.get(step.inputId),
        step.secondInputId ? available.get(step.secondInputId) : undefined,
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

function previewValues(values: ScienceValue[], target: number): ScienceValue[] {
  return values.map((value) => toPreview(value, target))
}

function allStepIds(steps: AnalysisStep[]): Set<string> {
  return new Set(steps.map((step) => step.id))
}

async function handleRun(request: RunRequest): Promise<void> {
  const started = performance.now()
  await hydrateIfNeeded(request.source)
  if (request.mappings) {
    mappings = reconcileMappings(request.mappings, datasets)
  }

  if (request.reset || !base) {
    rebuildBase(request.source)
    cache.clear()
  }

  const dirty = request.reset || !base ? allStepIds(request.steps) : new Set(request.dirtyIds)
  const { values, errors, timings } = compute(request.steps, dirty)

  post({
    type: 'result',
    requestId: request.requestId,
    datasets: datasets.map(datasetSummary),
    mappings,
    values: previewValues(values, request.previewTarget),
    errors,
    timings,
    elapsedMs: performance.now() - started,
  })
}

function dedupeDatasetId(existing: SuperDataset[], parsed: SuperDataset): SuperDataset {
  let dataset = parsed
  let suffix = 2
  while (existing.some((candidate) => candidate.id === dataset.id)) {
    dataset = { ...parsed, id: `${parsed.id}-${suffix}` }
    suffix += 1
  }
  return dataset
}

async function handleMutate(request: MutateRequest): Promise<void> {
  const started = performance.now()

  if (request.kind === 'import') {
    const files = request.files ?? []
    let next = datasets
    for (let index = 0; index < files.length; index += 1) {
      const parsed = await readScienceDataset(files[index])
      if (parsed.numericColumns.length === 0) {
        throw new Error(`${parsed.fileName} has no numeric columns`)
      }
      next = [...next, dedupeDatasetId(next, parsed)]
      post({ type: 'progress', requestId: request.requestId, done: index + 1, total: files.length })
    }
    datasets = next
    mappings = reconcileMappings(request.mappings, datasets)
    await saveScienceDatasets(datasets)
  } else if (request.kind === 'remove-dataset') {
    datasets = datasets.filter((dataset) => dataset.id !== request.datasetId)
    mappings = reconcileMappings(request.mappings, datasets)
    await saveScienceDatasets(datasets)
  } else if (request.kind === 'reset-sample') {
    datasets = []
    await saveScienceDatasets(datasets)
    mappings = {}
  } else {
    await hydrateIfNeeded(request.source)
    mappings = reconcileMappings(request.mappings, datasets)
  }

  rebuildBase(request.source)
  cache.clear()

  const steps = finalizeSteps(request.steps, Boolean(request.resetStepsToStats))
  const { values, errors, timings } = compute(steps, allStepIds(steps))

  post({
    type: 'mutate-result',
    requestId: request.requestId,
    datasets: datasets.map(datasetSummary),
    mappings,
    steps,
    values: previewValues(values, request.previewTarget),
    errors,
    timings,
    elapsedMs: performance.now() - started,
  })
}

function findValue(valueId: string): ScienceValue | undefined {
  return base?.find((value) => value.id === valueId) ?? cache.get(valueId)
}

scope.addEventListener('message', (event: MessageEvent) => {
  const request = event.data as WorkerRequest

  if (request.type === 'export') {
    try {
      const value = findValue(request.valueId)
      if (!value) throw new Error(`Value "${request.valueId}" is unavailable`)
      post({ type: 'export-result', requestId: request.requestId, blob: valueToCsv(value) })
    } catch (error) {
      post({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) })
    }
    return
  }

  if (request.type === 'preview') {
    try {
      const values = request.valueIds.map((valueId) => {
        const value = findValue(valueId)
        if (!value) throw new Error(`Value "${valueId}" is unavailable`)
        return toPreviewInRange(value, request.xRange, request.target)
      })
      post({ type: 'preview-result', requestId: request.requestId, values })
    } catch (error) {
      post({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) })
    }
    return
  }

  const handler = request.type === 'run'
    ? handleRun(request)
    : handleMutate(request)

  handler.catch((error: unknown) => {
    post({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) })
  })
})

export {}
