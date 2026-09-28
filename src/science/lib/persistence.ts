import type { SuperDataset } from '../../superplot/types.ts'
import type { AnalysisStep } from './pipeline.ts'
import { getOperator } from './operators.ts'

const DATABASE_NAME = 'joplot-science'
const STORE_NAME = 'workspace'
const DATASETS_KEY = 'datasets'
const LEGACY_DATASET_KEY = 'dataset'
const RECIPE_KEY = 'recipe'

export interface DatasetRecipeEntry {
  key: string
  datasetId: string
  xColumn: string
  yColumns: string[]
}

export interface ScienceRecipe {
  version: 2
  source: 'sample' | 'dataset'
  datasets: DatasetRecipeEntry[]
  steps: AnalysisStep[]
  selectedId: string
}

export interface RestoredScienceWorkspace {
  datasets: SuperDataset[]
  recipe: ScienceRecipe
}

export function datasetKey(dataset: SuperDataset): string {
  return `${dataset.id}:${dataset.createdAt}:${dataset.fileSize}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isStep(value: unknown): value is AnalysisStep {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.op !== 'string'
    || typeof value.inputId !== 'string' || typeof value.outputId !== 'string'
    || !getOperator(value.op) || !isRecord(value.params)) return false
  return (value.secondInputId === undefined || typeof value.secondInputId === 'string')
    && Object.values(value.params).every((param) => typeof param === 'string' || typeof param === 'number')
}

function isDataset(value: unknown): value is SuperDataset {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.fileName !== 'string'
    || !Number.isSafeInteger(value.rowCount) || Number(value.rowCount) < 0
    || !Array.isArray(value.columns) || !Array.isArray(value.numericColumns)
    || !Array.isArray(value.headers) || typeof value.createdAt !== 'number'
    || typeof value.fileSize !== 'number') return false
  return value.columns.every((column: unknown) => isRecord(column)
    && typeof column.name === 'string'
    && (column.kind === 'number' ? column.values instanceof Float64Array : Array.isArray(column.values)))
    && value.numericColumns.every((name: unknown) => typeof name === 'string')
}

function isDatasetEntry(value: unknown): value is DatasetRecipeEntry {
  return isRecord(value) && typeof value.key === 'string' && typeof value.datasetId === 'string'
    && typeof value.xColumn === 'string' && Array.isArray(value.yColumns)
    && value.yColumns.every((name: unknown) => typeof name === 'string')
}

function decodeStepsAndSelection(recipeValue: Record<string, unknown>): { steps: AnalysisStep[]; selectedId: string } | null {
  if (!Array.isArray(recipeValue.steps) || !recipeValue.steps.every(isStep)
    || typeof recipeValue.selectedId !== 'string') return null
  return { steps: recipeValue.steps, selectedId: recipeValue.selectedId }
}

/** 逐个校验 recipe 条目与存储的数据集，丢弃对不上的（文件被清掉/列被删），保留其余。 */
function matchEntries(
  entries: DatasetRecipeEntry[],
  stored: SuperDataset[],
): { datasets: SuperDataset[]; entries: DatasetRecipeEntry[] } {
  const datasets: SuperDataset[] = []
  const valid: DatasetRecipeEntry[] = []
  for (const entry of entries) {
    const dataset = stored.find((candidate) => datasetKey(candidate) === entry.key && candidate.id === entry.datasetId)
    if (!dataset || entry.yColumns.length === 0
      || !entry.yColumns.every((name) => dataset.numericColumns.includes(name))) continue
    datasets.push(dataset)
    valid.push(entry)
  }
  return { datasets, entries: valid }
}

function decodeV2(datasetsValue: unknown, recipeValue: Record<string, unknown>): RestoredScienceWorkspace | null {
  if ((recipeValue.source !== 'sample' && recipeValue.source !== 'dataset')
    || !Array.isArray(recipeValue.datasets) || !recipeValue.datasets.every(isDatasetEntry)) return null
  const core = decodeStepsAndSelection(recipeValue)
  if (!core) return null

  const stored = Array.isArray(datasetsValue) ? datasetsValue.filter(isDataset) : []
  const { datasets, entries } = matchEntries(recipeValue.datasets, stored)

  const recipe: ScienceRecipe = {
    version: 2,
    source: datasets.length > 0 ? 'dataset' : 'sample',
    datasets: entries,
    steps: core.steps,
    selectedId: core.selectedId,
  }
  return { datasets, recipe }
}

/** v1 存档迁移：单 dataset + 单映射 → v2 的 datasets 列表。 */
function decodeV1(legacyDatasetValue: unknown, recipeValue: Record<string, unknown>): RestoredScienceWorkspace | null {
  if ((recipeValue.source !== 'sample' && recipeValue.source !== 'dataset')
    || typeof recipeValue.xColumn !== 'string' || !Array.isArray(recipeValue.yColumns)
    || !recipeValue.yColumns.every((name: unknown) => typeof name === 'string')) return null
  const core = decodeStepsAndSelection(recipeValue)
  if (!core) return null

  const stored = isDataset(legacyDatasetValue) ? [legacyDatasetValue] : []
  const entries: DatasetRecipeEntry[] = recipeValue.source === 'dataset'
    ? [{ key: '', datasetId: '', xColumn: recipeValue.xColumn, yColumns: recipeValue.yColumns as string[] }]
    : []
  const legacyKey = (recipeValue as { datasetKey?: unknown }).datasetKey
  if (entries.length > 0 && stored.length > 0 && typeof legacyKey === 'string') {
    entries[0] = { ...entries[0], key: legacyKey, datasetId: stored[0].id }
  }
  const { datasets, entries: valid } = matchEntries(entries, stored)

  const recipe: ScienceRecipe = {
    version: 2,
    source: datasets.length > 0 ? 'dataset' : 'sample',
    datasets: valid,
    steps: core.steps,
    selectedId: core.selectedId,
  }
  return { datasets, recipe }
}

export function decodeScienceWorkspace(
  datasetsValue: unknown,
  recipeValue: unknown,
  legacyDatasetValue?: unknown,
): RestoredScienceWorkspace | null {
  if (!isRecord(recipeValue)) return null
  if (recipeValue.version === 2) return decodeV2(datasetsValue, recipeValue)
  if (recipeValue.version === 1) return decodeV1(legacyDatasetValue ?? datasetsValue, recipeValue)
  return null
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable'))
  })
}

async function transact(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
  const database = await openDatabase()
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode)
      const request = operation(transaction.objectStore(STORE_NAME))
      transaction.oncomplete = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Workspace storage failed'))
      transaction.onerror = () => reject(transaction.error ?? new Error('Workspace storage failed'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Workspace storage was aborted'))
    })
  } finally {
    database.close()
  }
}

export async function loadScienceWorkspace(): Promise<RestoredScienceWorkspace | null> {
  const [datasets, legacyDataset, recipe] = await Promise.all([
    transact('readonly', (store) => store.get(DATASETS_KEY)),
    transact('readonly', (store) => store.get(LEGACY_DATASET_KEY)),
    transact('readonly', (store) => store.get(RECIPE_KEY)),
  ])
  return decodeScienceWorkspace(datasets, recipe, legacyDataset)
}

export async function saveScienceDatasets(datasets: SuperDataset[]): Promise<void> {
  await transact('readwrite', (store) => store.put(datasets, DATASETS_KEY))
  // 清掉 v1 的单数据集槽位，避免残留旧档被误读。
  await transact('readwrite', (store) => store.delete(LEGACY_DATASET_KEY))
}

export async function saveScienceRecipe(recipe: ScienceRecipe): Promise<void> {
  await transact('readwrite', (store) => store.put(recipe, RECIPE_KEY))
}
