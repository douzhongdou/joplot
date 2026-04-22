import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import { buildUploadHint, pickCsvFiles } from '../lib/upload'

interface Props {
  hasDatasets: boolean
  onFiles: (files: File[]) => void | Promise<void>
}

export function FileUploader({ hasDatasets, onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = pickCsvFiles(Array.from(event.target.files ?? []))

    if (files.length > 0) {
      void onFiles(files)
      event.target.value = ''
    }
  }

  return (
    <div className="nav-upload">
      <span className="nav-upload-hint">{buildUploadHint(hasDatasets)}</span>

      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        multiple
        className="sr-only"
        onChange={handleChange}
      />

      <button type="button" className="toolbar-upload-button" onClick={() => inputRef.current?.click()}>
        {hasDatasets ? '添加 CSV' : '上传 CSV'}
      </button>
    </div>
  )
}
