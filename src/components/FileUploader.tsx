import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import { Plus } from 'lucide-react'
import { ACCEPTED_UPLOAD_TYPES, buildUploadHint, getUploadCopy, pickCsvFiles } from '../lib/upload'
import { useI18n } from '../i18n'

interface Props {
  hasDatasets: boolean
  onFiles: (files: File[]) => void | Promise<void>
  buttonClassName?: string
}

export function FileUploader({ hasDatasets, onFiles, buttonClassName = '' }: Props) {
  const { language } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonLabel = hasDatasets ? buildUploadHint(true, language) : buildUploadHint(false, language)
  const copy = getUploadCopy(language)

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = pickCsvFiles(Array.from(event.target.files ?? []))

    if (files.length > 0) {
      void onFiles(files)
      event.target.value = ''
    }
  }

  return (
    <div className="flex min-w-0 items-center justify-center">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_UPLOAD_TYPES}
        multiple
        className="sr-only"
        onChange={handleChange}
      />

      <button
        type="button"
        className={`inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-4 text-sm font-semibold text-base-content transition hover:border-primary/25 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 ${buttonClassName}`.trim()}
        onClick={() => inputRef.current?.click()}
        title={buttonLabel}
      >
        <Plus size={16} strokeWidth={2.2} />
        {hasDatasets ? copy.addButton : copy.uploadButton}
      </button>
    </div>
  )
}
