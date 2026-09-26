'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Activity, Database, FileUp, Loader2, UploadCloud } from 'lucide-react'
import type { SuperDataset } from '../types.ts'
import { readSuperDataset, toSuperDatasetId, type ParseProgress } from '../lib/parse.ts'
import { createSuperPlotCopy, type SuperPlotLanguage } from '../lib/i18n.ts'
import { formatBytes, formatCount, formatFrequency } from '../lib/format.ts'
import { WaveformPanel } from './WaveformPanel.tsx'
import { SpectrumPanel } from './SpectrumPanel.tsx'

interface Props {
  language: SuperPlotLanguage
  routeLanguage: string
}

export function SuperPlotApp({ language, routeLanguage }: Props) {
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
      setError(copy.parseFailed)
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
  }, [copy.parseFailed])

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
      <header className="flex flex-wrap items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-[var(--radius-box)] bg-primary/12 text-primary">
            <Activity size={18} strokeWidth={2.4} />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-base-content">{copy.branding}</div>
            <div className="text-[11px] text-base-content/50">large-data · FFT</div>
          </div>
        </div>

        <div className="hidden items-center gap-2 rounded-full border border-base-300 bg-base-200/60 px-3 py-1.5 text-[11px] font-medium text-base-content/55 sm:inline-flex">
          <span className="size-2 rounded-full bg-primary" />
          {copy.timeDomain}
          <span className="text-base-content/25">/</span>
          <span className="size-2 rounded-full bg-secondary" />
          {copy.frequencyDomain}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <a
            href={`/${routeLanguage}`}
            className="inline-flex h-9 items-center rounded-[var(--radius-field)] px-3 text-sm font-medium text-base-content/60 transition hover:bg-base-200 hover:text-base-content"
          >
            {copy.back}
          </a>
          {(['zh', 'en', 'ja'] as const).map((lang) => (
            <a
              key={lang}
              href={`/${lang}/super-plot`}
              className={`inline-flex h-8 min-w-8 items-center justify-center rounded-[var(--radius-field)] px-2 text-xs font-semibold uppercase transition ${
                lang === routeLanguage ? 'bg-primary text-primary-content' : 'text-base-content/50 hover:bg-base-200'
              }`}
            >
              {lang}
            </a>
          ))}
        </div>
      </header>

      <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-2.5 sm:px-6">
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
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-field)] bg-primary px-3 text-sm font-semibold text-primary-content transition hover:opacity-90"
            onClick={() => inputRef.current?.click()}
          >
            <FileUp size={15} /> {copy.chooseFile}
          </button>

          {datasets.length > 0 && (
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-field)] border border-base-300 px-3 text-sm font-medium text-base-content/75 transition hover:border-primary/40"
              onClick={() => inputRef.current?.click()}
            >
              <UploadCloud size={15} /> {copy.replaceFile}
            </button>
          )}

          {progress && (
            <span className="inline-flex items-center gap-2 text-xs font-medium text-base-content/60">
              <Loader2 size={14} className="animate-spin" />
              {copy.parsing(progressPercent, progressRows)}
            </span>
          )}

          {error && (
            <span className="text-xs font-medium text-error">{error}</span>
          )}
        </div>

        {datasets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-100 px-4 py-2 sm:px-6">
            {datasets.map((dataset) => (
              <button
                key={dataset.id}
                type="button"
                onClick={() => setActiveDatasetId(dataset.id)}
                className={`inline-flex max-w-64 items-center gap-2 truncate rounded-full border px-3 py-1 text-xs font-medium transition ${
                  dataset.id === activeDataset?.id
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-base-300 bg-base-200/50 text-base-content/65 hover:text-base-content'
                }`}
                title={`${dataset.fileName} · ${formatCount(dataset.rowCount, locale)} rows`}
              >
                <Database size={12} />
                <span className="truncate">{dataset.fileName}</span>
              </button>
            ))}
          </div>
        )}

        <main className="min-h-0">
          {!activeDataset && (
            <div className="h-full p-4 sm:p-6">
              <div
                className={`grid h-full min-h-[320px] place-items-center rounded-[calc(var(--radius-box)+0.25rem)] border-2 border-dashed transition ${
                  dragging ? 'border-primary/60 bg-primary/5' : 'border-base-300 bg-base-100'
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
                  <div className="grid gap-1">
                    <strong className="text-base font-semibold text-base-content">{copy.dropTitle}</strong>
                    <span className="text-xs text-base-content/50">{copy.dropHint}</span>
                  </div>
                  <span className="text-[11px] text-base-content/40">{copy.noDatasets}</span>
                </div>
              </div>
            </div>
          )}

          {activeDataset && (
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-base-300 bg-base-100 px-4 py-2 text-xs text-base-content/65 sm:px-6">
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

              <div className="grid min-h-0 grid-cols-1 divide-y divide-base-300 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                <section className="min-h-0 overflow-auto" aria-label={copy.timeDomain}>
                  <div className="flex h-full min-h-[600px] flex-col gap-3 p-4">
                    <div className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full bg-primary" />
                      <h2 className="text-sm font-semibold text-base-content">{copy.waveformTab}</h2>
                      <span className="text-[11px] uppercase tracking-[0.12em] text-base-content/40">{copy.timeDomain}</span>
                    </div>
                    <WaveformPanel
                      key={activeDataset.id}
                      dataset={activeDataset}
                      copy={copy}
                      locale={locale}
                      onOpenSpectrum={setSpectrumSignal}
                    />
                  </div>
                </section>

                <section className="min-h-0 overflow-auto" aria-label={copy.frequencyDomain}>
                  <div className="flex h-full min-h-[600px] flex-col gap-3 p-4">
                    <div className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full bg-secondary" />
                      <h2 className="text-sm font-semibold text-base-content">{copy.spectrumTab}</h2>
                      <span className="text-[11px] uppercase tracking-[0.12em] text-base-content/40">{copy.frequencyDomain}</span>
                    </div>
                    <SpectrumPanel
                      key={activeDataset.id}
                      dataset={activeDataset}
                      copy={copy}
                      locale={locale}
                      initialSignal={spectrumSignal}
                    />
                  </div>
                </section>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
