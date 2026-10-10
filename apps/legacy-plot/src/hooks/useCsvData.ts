import { useCallback, useEffect, useState } from 'react'
import type { CsvData } from '../types'
import { deserializeDatasets, serializeDatasets } from '../lib/datasetPersistence.ts'
import { readSpreadsheetFile } from '../lib/spreadsheetImport.ts'

export const DATASET_STORAGE_KEY = 'csv-workbench-datasets'

interface DatasetHydrationState {
  datasets: CsvData[]
  hasRestored: boolean
  persistenceFailed: boolean
}

export interface ParsedImportFailure {
  file: File
  error: unknown
}

export interface ParsedImportSuccess {
  file: File
  dataset: CsvData
}

export interface ParsedImportResult {
  successes: ParsedImportSuccess[]
  parsed: CsvData[]
  failures: ParsedImportFailure[]
}

function toDatasetId(fileName: string, taken: Set<string>) {
  const base = fileName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'dataset'

  let nextId = base
  let suffix = 2

  while (taken.has(nextId)) {
    nextId = `${base}-${suffix}`
    suffix += 1
  }

  taken.add(nextId)
  return nextId
}

export function getInitialDatasetHydrationState(): DatasetHydrationState {
  return {
    datasets: [],
    hasRestored: false,
    persistenceFailed: false,
  }
}

export function persistDatasetsToStorage(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  datasets: CsvData[],
): boolean {
  try {
    if (datasets.length === 0) {
      storage.removeItem(DATASET_STORAGE_KEY)
    } else {
      storage.setItem(DATASET_STORAGE_KEY, serializeDatasets(datasets))
    }

    return true
  } catch {
    return false
  }
}

export function restoreDatasetsAfterHydration(serialized: string | null | undefined): CsvData[] {
  return deserializeDatasets(serialized)
}

export async function parseImportedFiles(
  files: File[],
  existingDatasets: CsvData[],
): Promise<ParsedImportResult> {
  const takenIds = new Set(existingDatasets.map((dataset) => dataset.id))
  const results = await Promise.all(
    files.map(async (file) => {
      try {
        const dataset = await readSpreadsheetFile(file, toDatasetId(file.name, takenIds))
        return { file, dataset, error: null }
      } catch (error) {
        return { file, dataset: null, error }
      }
    }),
  )

  return {
    successes: results
      .filter((result): result is { file: File; dataset: CsvData; error: null } => result.dataset !== null)
      .map((result) => ({
        file: result.file,
        dataset: result.dataset,
      })),
    parsed: results
      .map((result) => result.dataset)
      .filter((dataset): dataset is CsvData => dataset !== null),
    failures: results
      .filter((result) => result.error !== null)
      .map((result) => ({
        file: result.file,
        error: result.error,
      })),
  }
}

export function useCsvData() {
  const [{ datasets, hasRestored, persistenceFailed }, setDatasetState] = useState<DatasetHydrationState>(
    getInitialDatasetHydrationState,
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    setDatasetState((prev) => ({
      ...prev,
      datasets: restoreDatasetsAfterHydration(window.localStorage.getItem(DATASET_STORAGE_KEY)),
      hasRestored: true,
    }))
  }, [])

  const parseFiles = useCallback(async (files: File[]) => {
    const result = await parseImportedFiles(files, datasets)

    if (result.parsed.length > 0) {
      setDatasetState((prev) => ({
        ...prev,
        datasets: [...prev.datasets, ...result.parsed],
      }))
    }

    return result
  }, [datasets])

  useEffect(() => {
    if (typeof window === 'undefined' || !hasRestored) {
      return
    }

    const persisted = persistDatasetsToStorage(window.localStorage, datasets)

    setDatasetState((prev) => (
      prev.persistenceFailed === !persisted
        ? prev
        : { ...prev, persistenceFailed: !persisted }
    ))
  }, [datasets, hasRestored])

  const resetDatasets = useCallback(() => {
    setDatasetState((prev) => ({
      ...prev,
      datasets: [],
    }))
  }, [])

  return { datasets, parseFiles, resetDatasets, hasRestoredDatasets: hasRestored, persistenceFailed }
}
