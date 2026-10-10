import type { CsvData } from '../types'

interface Props {
  datasets: CsvData[]
  activeDatasetId: string | null
  onSelect: (datasetId: string) => void
}

export function DatasetSidebar({ datasets, activeDatasetId, onSelect }: Props) {
  return (
    <section className="sidebar-panel">
      <div className="sidebar-panel-header">
        <div>
          <p className="sidebar-kicker">Datasets</p>
          <h2>数据集</h2>
        </div>
      </div>

      <div className="dataset-list">
        {datasets.map((dataset) => (
          <button
            key={dataset.id}
            type="button"
            className={`dataset-item ${dataset.id === activeDatasetId ? 'dataset-item-active' : ''}`}
            onClick={() => onSelect(dataset.id)}
          >
            <strong>{dataset.fileName}</strong>
            <span>{dataset.rowCount.toLocaleString()} 行</span>
            <span>{dataset.headers.length} 列</span>
          </button>
        ))}
      </div>
    </section>
  )
}
