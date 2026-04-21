import { useRef, useState } from 'react'
import type { CsvData } from '../types'

interface Props {
  onFile: (file: File) => void
  csv: CsvData | null
}

export function FileUploader({ onFile, csv }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.csv')) onFile(file)
  }

  return (
    <div className="upload-shell">
      <div
        className={`upload-dropzone ${
          dragging
            ? 'upload-dropzone-dragging'
            : ''
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="sr-only"
          onChange={handleChange}
        />
        <div className="upload-icon">CSV</div>
        <div className="upload-title">拖拽 CSV 文件到此处，或点击选择</div>
        <div className="upload-subtitle">
          适合带表头、结构较规整的数据。空值或不合法数值会按空处理。
        </div>
      </div>

      {csv && (
        <div className="upload-meta">
          <div className="upload-meta-value">{csv.rowCount.toLocaleString()} 行</div>
          <div>{csv.numericColumns.length} 个可用数值列</div>
        </div>
      )}
    </div>
  )
}
