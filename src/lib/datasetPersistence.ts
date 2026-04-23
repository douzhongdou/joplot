import type { CsvData, RawCsvRow } from '../types'
import { buildDataset } from './workbench.ts'

interface PersistedDataset {
  id: string
  fileName: string
  headers: string[]
  rows: RawCsvRow[]
}

function isRawCsvRow(value: unknown): value is RawCsvRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return Object.values(value).every((cell) => typeof cell === 'string')
}

function isPersistedDataset(value: unknown): value is PersistedDataset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Partial<PersistedDataset>

  return typeof candidate.id === 'string'
    && typeof candidate.fileName === 'string'
    && Array.isArray(candidate.headers)
    && candidate.headers.every((header) => typeof header === 'string')
    && Array.isArray(candidate.rows)
    && candidate.rows.every((row) => isRawCsvRow(row))
}

export function serializeDatasets(datasets: CsvData[]) {
  return JSON.stringify(
    datasets.map((dataset) => ({
      id: dataset.id,
      fileName: dataset.fileName,
      headers: dataset.headers,
      rows: dataset.rows.map((row) => row.raw),
    })),
  )
}

export function deserializeDatasets(serialized: string | null | undefined): CsvData[] {
  if (!serialized) {
    return []
  }

  try {
    const parsed = JSON.parse(serialized) as unknown

    if (!Array.isArray(parsed) || !parsed.every((dataset) => isPersistedDataset(dataset))) {
      return []
    }

    return parsed.map((dataset) => buildDataset(
      dataset.headers,
      dataset.rows,
      dataset.fileName,
      dataset.id,
    ))
  } catch {
    return []
  }
}
