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

/**
 * Merges one dataset into the persisted workbench list, de-duplicating its id
 * when needed. Returns the serialized list plus the id actually assigned.
 */
export function appendDatasetToSerialized(
  existing: string | null | undefined,
  dataset: CsvData,
): { serialized: string; id: string } {
  const current = deserializeDatasets(existing ?? null)
  const takenIds = new Set(current.map((item) => item.id))

  let id = dataset.id
  let suffix = 2

  while (takenIds.has(id)) {
    id = `${dataset.id}-${suffix}`
    suffix += 1
  }

  return {
    serialized: serializeDatasets([...current, { ...dataset, id }]),
    id,
  }
}

export const PENDING_CHART_DATASETS_KEY = 'csv-workbench-pending-chart-datasets'

/**
 * Records datasets sent from the function studio so the workbench opens a
 * fresh chart for them on next load. Consumed once by the workbench.
 */
export function writePendingChartDatasetIds(
  storage: Pick<Storage, 'setItem'>,
  ids: string[],
) {
  storage.setItem(PENDING_CHART_DATASETS_KEY, JSON.stringify(ids))
}

export function takePendingChartDatasetIds(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
): string[] {
  const raw = storage.getItem(PENDING_CHART_DATASETS_KEY)
  storage.removeItem(PENDING_CHART_DATASETS_KEY)

  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : []
  } catch {
    return []
  }
}
