import { useCallback, useEffect, useState } from 'react'
import type { CsvData } from '../types'
import { deserializeDatasets, serializeDatasets } from '../lib/datasetPersistence.ts'
import { readSpreadsheetFile } from '../lib/spreadsheetImport.ts'

export const DATASET_STORAGE_KEY = 'csv-workbench-datasets'

interface DatasetHydrationState {
  datasets: CsvData[]
  hasRestored: boolean
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
  }
}

export function restoreDatasetsAfterHydration(serialized: string | null | undefined): CsvData[] {
  return deserializeDatasets(serialized)
}

export function useCsvData() {
  const [{ datasets, hasRestored }, setDatasetState] = useState<DatasetHydrationState>(
    getInitialDatasetHydrationState,
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    setDatasetState({
      datasets: restoreDatasetsAfterHydration(window.localStorage.getItem(DATASET_STORAGE_KEY)),
      hasRestored: true,
    })
  }, [])

  const parseFiles = useCallback(async (files: File[]) => {
    const takenIds = new Set(datasets.map((dataset) => dataset.id))
    const parsed = await Promise.all(
      files.map((file) => readSpreadsheetFile(file, toDatasetId(file.name, takenIds))),
    )

    setDatasetState((prev) => ({
      ...prev,
      datasets: [...prev.datasets, ...parsed],
    }))
    return parsed
  }, [datasets])

  useEffect(() => {
    if (typeof window === 'undefined' || !hasRestored) {
      return
    }

    try {
      if (datasets.length === 0) {
        window.localStorage.removeItem(DATASET_STORAGE_KEY)
      } else {
        window.localStorage.setItem(DATASET_STORAGE_KEY, serializeDatasets(datasets))
      }
    } catch {
      // Keep the session usable even if the browser rejects storage writes.
    }
  }, [datasets, hasRestored])

  const resetDatasets = useCallback(() => {
    setDatasetState((prev) => ({
      ...prev,
      datasets: [],
    }))
  }, [])

  return { datasets, parseFiles, resetDatasets, hasRestoredDatasets: hasRestored }
}
