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
import {
  baseValueIds,
  buildBaseValues,
  datasetSummary,
  defaultMapping,
  remapStepInputs,
} from '../lib/base.ts'
import { readScienceDataset } from '../lib/readDataset.ts'
import { dedupeDatasetId, removeDatasetById, resolveDatasetMutationBase } from '../lib/datasets.ts'
import { loadScienceDatasets, saveScienceDatasets } from '../lib/persistence.ts'
import { valueToCsv } from '../lib/export.ts'
import { resolveValue, vectorParentId } from '../lib/vectors.ts'
import { computeValues } from './engine.ts'
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
  const { values, errors, timings } = computeValues({
    base: base ?? [],
    steps: request.steps,
    dirtyIds: dirty,
    cache,
    evictIds: request.evictIds,
  })

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

async function handleMutate(request: MutateRequest): Promise<void> {
  const started = performance.now()

  if (request.kind === 'import' || request.kind === 'remove-dataset' || request.kind === 'reset-sample') {
    // 关键：先解析操作基集（import/remove 在内存为空时从 IndexedDB 水合），
    // 避免 Worker 重建后用空内存覆盖持久数据。reset-sample 主动清空。
    const baseline = await resolveDatasetMutationBase(request.kind, datasets, loadScienceDatasets)

    if (request.kind === 'import') {
      const files = request.files ?? []
      let next = baseline
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
      datasets = removeDatasetById(baseline, request.datasetId ?? '')
      mappings = reconcileMappings(request.mappings, datasets)
      await saveScienceDatasets(datasets)
    } else {
      datasets = baseline
      mappings = {}
      await saveScienceDatasets(datasets)
    }
  } else {
    await hydrateIfNeeded(request.source)
    mappings = reconcileMappings(request.mappings, datasets)
  }

  rebuildBase(request.source)
  cache.clear()

  const steps = finalizeSteps(request.steps, Boolean(request.resetStepsToStats))
  const { values, errors, timings } = computeValues({
    base: base ?? [],
    steps,
    dirtyIds: allStepIds(steps),
    cache,
  })

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
  const parentId = vectorParentId(valueId)
  const parent = base?.find((value) => value.id === parentId) ?? cache.get(parentId)
  return parent ? resolveValue([parent], valueId) : undefined
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

  if (request.type === 'evict') {
    // 独立驱逐：删除步骤后立即清缓存，不依赖后续 run（autoRun 关闭也要生效）。
    for (const id of request.ids) {
      cache.delete(id)
    }
    post({ type: 'evict-result', requestId: request.requestId })
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
