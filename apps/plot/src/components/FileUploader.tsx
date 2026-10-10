import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import { Upload } from 'lucide-react'
import type { TrackingInputMethod } from '../lib/analytics'
import { ACCEPTED_UPLOAD_TYPES, buildUploadHint, getUploadCopy, pickCsvFiles } from '../lib/upload'
import { useI18n } from '../i18n'
import { Button } from '@joplot/ui/button'

interface Props {
  hasDatasets: boolean
  onFiles: (files: File[], inputMethod?: TrackingInputMethod) => void | Promise<unknown>
  buttonClassName?: string
  containerClassName?: string
  disabled?: boolean
}

export function FileUploader({
  hasDatasets,
  onFiles,
  buttonClassName = '',
  containerClassName = '',
  disabled = false,
}: Props) {
  const { language } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonLabel = hasDatasets ? buildUploadHint(true, language) : buildUploadHint(false, language)
  const copy = getUploadCopy(language)

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (disabled) {
      event.target.value = ''
      return
    }

    const files = pickCsvFiles(Array.from(event.target.files ?? []))

    if (files.length > 0) {
      void onFiles(files, 'file_picker')
      event.target.value = ''
    }
  }

  return (
    <div className={`flex min-w-0 items-center justify-center ${containerClassName}`.trim()}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_UPLOAD_TYPES}
        multiple
        className="sr-only"
        disabled={disabled}
        onChange={handleChange}
      />

      <Button
        type="button"
        variant="outline"
        className={`h-11 rounded-[var(--radius-box)] font-semibold ${buttonClassName}`.trim()}
        onClick={() => inputRef.current?.click()}
        title={buttonLabel}
        disabled={disabled}
      >
        <Upload size={16} strokeWidth={2.2} />
        {hasDatasets ? copy.addButton : copy.uploadButton}
      </Button>
    </div>
  )
}
