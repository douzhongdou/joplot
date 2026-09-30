'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Activity, Database, FileUp, Loader2, UploadCloud, X } from 'lucide-react'
import type { SuperDataset } from '../types.ts'
import { readSuperDataset, toSuperDatasetId, type ParseProgress } from '../lib/parse.ts'
import { createSuperPlotCopy, type SuperPlotLanguage } from '../lib/i18n.ts'
import { useI18n } from '../../i18n'
import type { SupportedLanguage } from '@joplot/i18n/config'
import { formatBytes, formatCount, formatFrequency } from '../lib/format.ts'
import { SuperPlotWorkspace } from './SuperPlotWorkspace.tsx'

interface Props {
  language: SuperPlotLanguage
}

const SWITCH_LANGUAGES: Array<{ value: SupportedLanguage; label: string }> = [
  { value: 'zh-CN', label: 'zh' },
  { value: 'en', label: 'en' },
  { value: 'ja-JP', label: 'ja' },
]

export function SuperPlotApp({ language }: Props) {
  const { language: activeLanguage, setLanguage } = useI18n()
  const copy = useMemo(() => createSuperPlotCopy(language), [language])
  const locale = language === 'zh-CN' ? 'zh-CN' : language === 'ja-JP' ? 'ja-JP' : 'en'
  const [datasets, setDatasets] = useState<SuperDataset[]>([])
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null)
  const [spectrumSignal, setSpectrumSignal] = useState<string | null>(null)
  const [progress, setProgress] = useState<ParseProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const importTokenRef = useRef(0)
  const knownIdsRef = useRef<Set<string>>(new Set())

  const activeDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === activeDatasetId) ?? datasets[0] ?? null,
    [datasets, activeDatasetId],
  )

  const importFiles = useCallback(async (files: File[]) => {
    const csvFiles = files.filter((file) => file.name.toLowerCase().endsWith('.csv'))
    if (csvFiles.length === 0) {
      setError(files.length > 0 ? copy.onlyCsv : copy.parseFailed)
      return
    }

    setError(null)
    const token = ++importTokenRef.current

    for (const file of csvFiles) {
      setProgress({ rows: 0, bytesProcessed: 0, bytesTotal: file.size })
      try {
        const dataset = await readSuperDataset(file, {
          onProgress: (next) => {
            if (token === importTokenRef.current) {
              setProgress(next)
            }
          },
        })

        if (token !== importTokenRef.current) {
          return
        }

        const baseId = dataset.id || toSuperDatasetId(file.name)
        let id = baseId
        let suffix = 2
        while (knownIdsRef.current.has(id)) {
          id = `${baseId}-${suffix}`
          suffix += 1
        }
        knownIdsRef.current.add(id)

        setDatasets((prev) => [...prev, { ...dataset, id }])
        setActiveDatasetId(id)
        setSpectrumSignal(null)
      } catch {
        if (token === importTokenRef.current) {
          setError(copy.parseFailed)
        }
      } finally {
        if (token === importTokenRef.current) {
          setProgress(null)
        }
      }
    }
  }, [copy.onlyCsv, copy.parseFailed])

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return
    }
    void importFiles(Array.from(fileList))
  }

  const progressPercent = progress && progress.bytesTotal > 0
    ? `${Math.min(100, Math.round((progress.bytesProcessed / progress.bytesTotal) * 100))}%`
    : '…'
  const progressRows = progress ? formatCount(progress.rows, locale) : '0'

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] bg-base-200 text-base-content">
      <header className="flex items-center gap-2 border-b border-base-300 bg-base-100 px-3 py-2 sm:px-4">
        <div className="flex shrink-0 items-center gap-1.5" title={copy.title}>
          <span className="grid size-7 place-items-center rounded-lg bg-primary/12 text-primary">
            <Activity size={15} strokeWidth={2.4} />
          </span>
          <span className="hidden text-sm font-semibold text-base-content lg:inline">{copy.branding}</span>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          multiple
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files)
            event.target.value = ''
          }}
        />
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-field)] bg-primary px-2.5 text-xs font-semibold text-primary-content transition hover:opacity-90"
          onClick={() => inputRef.current?.click()}
        >
          <FileUp size={13} /> {copy.chooseFile}
        </button>

        {datasets.length > 0 && (
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-field)] bg-muted px-2.5 text-xs font-medium text-base-content/75 transition hover:bg-accent"
            onClick={() => inputRef.current?.click()}
          >
            <UploadCloud size={13} /> {copy.replaceFile}
          </button>
        )}

        {datasets.length > 0 && (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {datasets.map((dataset) => (
              <button
                key={dataset.id}
                type="button"
                aria-current={dataset.id === activeDataset?.id ? 'true' : undefined}
                onClick={() => setActiveDatasetId(dataset.id)}
                className={`inline-flex h-7 max-w-48 shrink-0 items-center gap-1.5 truncate rounded-full px-2.5 text-xs font-medium transition ${
                  dataset.id === activeDataset?.id
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-muted text-base-content/65 hover:bg-accent hover:text-base-content'
                }`}
                title={`${dataset.fileName} · ${formatCount(dataset.rowCount, locale)} rows`}
              >
                <Database size={12} className="shrink-0" />
                <span className="truncate">{dataset.fileName}</span>
              </button>
            ))}
          </div>
        )}

        {progress && (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-base-content/60">
            <Loader2 size={13} className="animate-spin" />
            {copy.parsing(progressPercent, progressRows)}
          </span>
        )}

        {error && (
          <div role="alert" className="inline-flex min-w-0 shrink items-center gap-1.5 text-xs font-medium text-error" title={error}>
            <span className="truncate">{error}</span>
            <button
              type="button"
              className="grid size-5 shrink-0 place-items-center rounded-full text-error/70 transition hover:bg-error/10 hover:text-error"
              onClick={() => setError(null)}
              aria-label="×"
              title="×"
            >
              <X size={12} />
            </button>
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <a
            href="/"
            className="hidden h-8 items-center rounded-[var(--radius-field)] px-2 text-xs font-medium text-base-content/60 transition hover:bg-base-200 hover:text-base-content sm:inline-flex"
          >
            {copy.back}
          </a>
          {SWITCH_LANGUAGES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setLanguage(option.value)}
              aria-current={option.value === activeLanguage ? 'true' : undefined}
              className={`inline-flex h-7 min-w-7 items-center justify-center rounded-[var(--radius-field)] px-1.5 text-[11px] font-semibold uppercase transition ${
                option.value === activeLanguage ? 'bg-primary text-primary-content' : 'text-base-content/50 hover:bg-base-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">

        <main className="min-h-0 overflow-auto">
          {!activeDataset && (
            <div className="h-full p-4 sm:p-6">
              <div
                className={`grid h-full min-h-[320px] place-items-center rounded-[calc(var(--radius-box)+0.25rem)] transition ${
                  dragging ? 'border-2 border-dashed border-primary/60 bg-primary/5' : 'bg-muted/50'
                }`}
                onDragEnter={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  handleFiles(event.dataTransfer.files)
                }}
              >
                <div className="grid gap-3 text-center">
                  <span className="mx-auto grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
                    <UploadCloud size={26} />
                  </span>
                  <strong className="text-base font-semibold text-base-content">{copy.dropTitle}</strong>
                </div>
              </div>
            </div>
          )}

          {activeDataset && (
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 overflow-x-auto border-b border-base-300 bg-base-100 px-3 py-1.5 text-xs text-base-content/65 sm:px-4">
                <span className="font-semibold text-base-content">{activeDataset.fileName}</span>
                <span>{copy.rowsLabel}: <b className="font-semibold text-base-content">{formatCount(activeDataset.rowCount, locale)}</b></span>
                <span>{copy.sizeLabel}: <b className="font-semibold text-base-content">{formatBytes(activeDataset.fileSize)}</b></span>
                <span>{copy.columnsLabel}: <b className="font-semibold text-base-content">{formatCount(activeDataset.numericColumns.length, locale)}</b></span>
                {activeDataset.sampleRate && (
                  <span>{copy.rateLabel}: <b className="font-semibold text-base-content">{formatFrequency(activeDataset.sampleRate)}</b></span>
                )}
                {activeDataset.timeColumn && (
                  <span>{copy.timeColumnLabel}: <b className="font-semibold text-base-content">{activeDataset.timeColumn}</b></span>
                )}
              </div>

              <SuperPlotWorkspace
                key={activeDataset.id}
                dataset={activeDataset}
                copy={copy}
                locale={locale}
                spectrumSignal={spectrumSignal}
                onOpenSpectrum={setSpectrumSignal}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
