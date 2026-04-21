import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import type { CsvData } from '../types'

interface Props {
  onFile: (file: File) => void
  csv: CsvData | null
}

export function FileUploader({ onFile, csv }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (file) {
      onFile(file)
      event.target.value = ''
    }
  }

  return (
    <div className="uploader-inline">
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="sr-only"
        onChange={handleChange}
      />

      <button type="button" className="primary-button" onClick={() => inputRef.current?.click()}>
        {csv ? '更换 CSV' : '上传 CSV'}
      </button>

      <div className="uploader-file">
        <span className="uploader-file-label">当前文件</span>
        <strong>{csv?.fileName ?? '未加载'}</strong>
      </div>

      <div className="uploader-meta">
        <span>{csv ? `${csv.rowCount.toLocaleString()} 行` : '等待数据'}</span>
        <span>{csv ? `${csv.numericColumns.length} 个数值列` : '仅支持带表头 CSV'}</span>
      </div>
    </div>
  )
}
