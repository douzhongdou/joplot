'use client'

import { useMemo, useRef, useState } from 'react'
import { Download, RotateCcw } from 'lucide-react'
import type { SuperDataset } from '../types.ts'
import type { SuperPlotCopy } from '../lib/i18n.ts'
import type { DownsampleMode } from '../types.ts'
import type { PlotlyChartHandle } from './PlotlyChart.tsx'
import { Button } from './Controls.tsx'
import {
  WaveformControls,
  WaveformPlot,
  WaveformStats,
  getDefaultSeries,
  getDefaultXColumn,
} from './WaveformPanel.tsx'
import {
  SpectrumControls,
  SpectrumPlot,
  SpectrumResults,
  useSpectrumModel,
} from './SpectrumPanel.tsx'

interface Props {
  dataset: SuperDataset
  copy: SuperPlotCopy
  locale: string
  spectrumSignal: string | null
  onOpenSpectrum: (signal: string) => void
}

const PLOT_HEIGHT_CLASS = 'h-[300px] lg:h-[420px]'

export function SuperPlotWorkspace({ dataset, copy, locale, spectrumSignal, onOpenSpectrum }: Props) {
  const defaultX = useMemo(() => getDefaultXColumn(dataset), [dataset])

  const [xColumn, setXColumn] = useState(defaultX)
  const [series, setSeries] = useState<string[]>(() => getDefaultSeries(dataset, defaultX))
  const [mode, setMode] = useState<DownsampleMode>('auto')
  const [target, setTarget] = useState(4000)

  const waveformPlotRef = useRef<PlotlyChartHandle>(null)
  const spectrumPlotRef = useRef<PlotlyChartHandle>(null)

  const spectrumModel = useSpectrumModel(dataset, spectrumSignal)

  const hasNumeric = dataset.numericColumns.length > 0

  return (
    <div className="grid gap-4 p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="grid min-w-0 gap-3" aria-label={copy.timeDomain}>
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-primary" />
            <h2 className="text-sm font-semibold text-base-content">{copy.waveformTab}</h2>
            <span className="text-[11px] uppercase tracking-[0.12em] text-base-content/40">{copy.timeDomain}</span>
          </div>
          <WaveformPlot
            dataset={dataset}
            xColumn={xColumn}
            series={series}
            mode={mode}
            target={target}
            plotRef={waveformPlotRef}
            className={PLOT_HEIGHT_CLASS}
          />
        </section>

        <section className="grid min-w-0 gap-3" aria-label={copy.frequencyDomain}>
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-secondary" />
            <h2 className="text-sm font-semibold text-base-content">{copy.spectrumTab}</h2>
            <span className="text-[11px] uppercase tracking-[0.12em] text-base-content/40">{copy.frequencyDomain}</span>
          </div>
          {hasNumeric ? (
            <SpectrumPlot
              copy={copy}
              model={spectrumModel}
              plotRef={spectrumPlotRef}
              className={PLOT_HEIGHT_CLASS}
            />
          ) : (
            <div className={`grid place-items-center rounded-[var(--radius-box)] border border-dashed border-base-300 text-sm text-base-content/50 ${PLOT_HEIGHT_CLASS}`}>
              {copy.spectrum.noSignal}
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <section
          className="grid min-w-0 gap-4 rounded-[calc(var(--radius-box)+0.25rem)] border border-base-300 bg-base-100 p-4"
          aria-label={`${copy.timeDomain}${copy.settings}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="size-2.5 rounded-full bg-primary" />
            <h2 className="text-sm font-semibold text-base-content">{`${copy.timeDomain}${copy.settings}`}</h2>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={() => waveformPlotRef.current?.resetZoom()}>
                <RotateCcw size={14} /> {copy.waveform.resetZoom}
              </Button>
              <Button onClick={() => void waveformPlotRef.current?.exportPng(`${dataset.fileName}-waveform`)}>
                <Download size={14} /> {copy.waveform.exportPng}
              </Button>
            </div>
          </div>
          <WaveformControls
            dataset={dataset}
            copy={copy}
            locale={locale}
            xColumn={xColumn}
            onXColumnChange={setXColumn}
            series={series}
            onSeriesChange={setSeries}
            mode={mode}
            onModeChange={setMode}
            target={target}
            onTargetChange={setTarget}
            onOpenSpectrum={onOpenSpectrum}
          />
          <WaveformStats dataset={dataset} copy={copy} locale={locale} series={series} />
        </section>

        {hasNumeric && (
          <section
            className="grid min-w-0 gap-4 rounded-[calc(var(--radius-box)+0.25rem)] border border-base-300 bg-base-100 p-4"
            aria-label={`${copy.frequencyDomain}${copy.settings}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="size-2.5 rounded-full bg-secondary" />
              <h2 className="text-sm font-semibold text-base-content">{`${copy.frequencyDomain}${copy.settings}`}</h2>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" onClick={() => spectrumPlotRef.current?.resetZoom()}>
                  <RotateCcw size={14} /> {copy.waveform.resetZoom}
                </Button>
                <Button onClick={() => void spectrumPlotRef.current?.exportPng(`${dataset.fileName}-spectrum`)}>
                  <Download size={14} /> {copy.waveform.exportPng}
                </Button>
              </div>
            </div>
            <SpectrumControls dataset={dataset} copy={copy} locale={locale} model={spectrumModel} />
            <SpectrumResults copy={copy} locale={locale} model={spectrumModel} />
          </section>
        )}
      </div>
    </div>
  )
}
