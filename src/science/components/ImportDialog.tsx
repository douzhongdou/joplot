'use client'

import { useRef, useState, type DragEvent } from 'react'
import { FlaskConical, FolderOpen, UploadCloud } from 'lucide-react'
import type { ScienceCopy } from '../lib/i18n.ts'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xls,text/csv,text/tab-separated-values'

interface Props {
  copy: ScienceCopy
  importing: boolean
  restoring: boolean
  onImport: (files: File[]) => void
  onLoadSample: () => void
  /** 紧凑样式（放进 navbar 工具条时用），不占满整行。 */
  compact?: boolean
}

export function ImportDialog({ copy, importing, restoring, onImport, onLoadSample, compact = false }: Props) {
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFiles(files: File[]) {
    if (files.length === 0) return
    onImport(files)
    setDragging(false)
    setOpen(false)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    handleFiles(Array.from(event.dataTransfer.files))
  }

  const label = restoring ? copy.restoring : importing ? copy.importing : copy.importData
  const trigger = (
    <button
      type="button"
      aria-label={compact ? label : undefined}
      className={compact
        ? 'grid size-7 shrink-0 place-items-center rounded-[calc(var(--radius-field)-2px)] text-base-content/60 transition hover:bg-base-content/10 hover:text-base-content disabled:pointer-events-none disabled:opacity-50'
        : 'flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-field)] bg-primary text-xs font-semibold text-primary-content transition hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50'}
      disabled={importing || restoring}
    >
      <UploadCloud size={compact ? 15 : 13} strokeWidth={2.2} />
      {compact ? null : label}
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {compact ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ) : (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{copy.importData}</DialogTitle>
        </DialogHeader>

        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`grid cursor-pointer place-items-center gap-2 rounded-[var(--radius-box)] px-6 py-10 text-center transition ${
            dragging ? 'bg-accent text-accent-foreground' : 'bg-muted/50 hover:bg-muted'
          }`}
        >
          <span className="grid size-12 place-items-center rounded-full bg-base-100 text-base-content/60">
            <UploadCloud size={22} strokeWidth={2} />
          </span>
          <span className="text-sm font-semibold text-base-content">{copy.dropFiles}</span>
          <span className="text-xs text-base-content/50">{copy.dropFilesHint}</span>
          <Button
            type="button"
            variant="outline"
            className="mt-1 h-8 text-xs font-semibold"
            onClick={(event) => {
              event.stopPropagation()
              inputRef.current?.click()
            }}
          >
            <FolderOpen size={13} strokeWidth={2.2} />
            {copy.openFile}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            onChange={(event) => {
              handleFiles(Array.from(event.currentTarget.files ?? []))
              event.currentTarget.value = ''
            }}
          />
        </div>

        <div className="flex items-center gap-3 text-[11px] text-base-content/40">
          <span className="h-px flex-1 bg-base-300" />
          {copy.orDivider}
          <span className="h-px flex-1 bg-base-300" />
        </div>

        <button
          type="button"
          onClick={() => {
            onLoadSample()
            setOpen(false)
          }}
          className="flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-field)] bg-muted text-xs font-semibold text-base-content/80 transition hover:bg-accent"
        >
          <FlaskConical size={13} strokeWidth={2.2} />
          {copy.loadSample}
        </button>
      </DialogContent>
    </Dialog>
  )
}
