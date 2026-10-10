import { useMemo } from 'react'
import { DataTable } from './DataTable'
import { useI18n } from '../i18n'
import type { CsvData } from '../types'

interface Props {
  datasets: CsvData[]
  activeDatasetId: string | null
  onSelectDataset: (id: string) => void
}

export function DataView({ datasets, activeDatasetId, onSelectDataset }: Props) {
  const { t } = useI18n()

  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId) ?? datasets[0] ?? null,
    [datasets, activeDatasetId],
  )

  if (datasets.length === 0) {
    return (
      <div className="grid h-full place-items-center text-base-content/55">
        {t('dataView.emptyState')}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex items-end gap-0 overflow-x-auto border-b border-base-300 bg-base-100 px-4"
        style={{ scrollbarWidth: 'thin' }}
      >
        {datasets.map((dataset) => (
          <button
            key={dataset.id}
            type="button"
            className={`shrink-0 max-w-40 truncate border-b-2 px-4 py-3 text-sm font-medium transition ${
              dataset.id === activeDataset?.id
                ? 'border-primary text-primary'
                : 'border-transparent text-base-content/60 hover:text-base-content'
            }`}
            title={dataset.fileName}
            onClick={() => onSelectDataset(dataset.id)}
          >
            {dataset.fileName}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {activeDataset && <DataTable dataset={activeDataset} />}
      </div>
    </div>
  )
}
