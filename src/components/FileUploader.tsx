import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import { Plus } from 'lucide-react'
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
    <div className="flex min-w-0 items-center gap-3">
      <span className="hidden text-sm text-base-content/55 xl:block">
        {buildUploadHint(hasDatasets)}
      </span>

      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        multiple
        className="sr-only"
        onChange={handleChange}
      />

      <button
        type="button"
        className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-4 text-sm font-semibold text-base-content transition hover:border-primary/25 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
        onClick={() => inputRef.current?.click()}
      >
        <Plus size={16} strokeWidth={2.2} />
        {hasDatasets ? '添加 CSV' : '上传 CSV'}
      </button>
    </div>
  )
}
