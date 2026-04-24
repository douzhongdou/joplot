import { useCallback, useEffect, useState } from 'react'
import type { CsvData } from '../types'
import { deserializeDatasets, serializeDatasets } from '../lib/datasetPersistence.ts'
import { readSpreadsheetFile } from '../lib/spreadsheetImport.ts'

export const DATASET_STORAGE_KEY = 'csv-workbench-datasets'

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

export function useCsvData() {
  const [datasets, setDatasets] = useState<CsvData[]>(() => {
    if (typeof window === 'undefined') {
      return []
    }

    return deserializeDatasets(window.localStorage.getItem(DATASET_STORAGE_KEY))
  })

  const parseFiles = useCallback(async (files: File[]) => {
    const takenIds = new Set(datasets.map((dataset) => dataset.id))
    const parsed = await Promise.all(
      files.map((file) => readSpreadsheetFile(file, toDatasetId(file.name, takenIds))),
    )

    setDatasets((prev) => [...prev, ...parsed])
    return parsed
  }, [datasets])

  useEffect(() => {
    if (typeof window === 'undefined') {
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
  }, [datasets])

  const resetDatasets = useCallback(() => {
    setDatasets([])
  }, [])

  return { datasets, parseFiles, resetDatasets }
}
