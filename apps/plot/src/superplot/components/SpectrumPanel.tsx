'use client'

import { useEffect, useMemo, useState } from 'react'
import type { DetrendMode, SuperDataset, WindowKind } from '../types.ts'
import type { SuperPlotCopy } from '../lib/i18n.ts'
import { computeSpectrum, findSpectrumPeaks, magnitudeToDb, WINDOW_KINDS, DETREND_MODES } from '../lib/fft.ts'
import { extractNumericValues } from '../lib/columns.ts'
import { getSuperPlotColor, withAlpha } from '../lib/colors.ts'
import { resolveSuperPlotAxisColor, resolveSuperPlotGridColor, SUPER_PLOT_FONT_FAMILY } from '../lib/plotTheme.ts'
import { formatAmplitude, formatCount, formatFrequency } from '../lib/format.ts'
import { CHART_HOVERLABEL } from '../../lib/tooltipStyle.ts'
import { PlotlyChart, type PlotlyChartHandle, type SuperPlotTrace } from './PlotlyChart.tsx'
import { Field, NumberInput, SegmentedControl, SelectInput, Toggle } from './Controls.tsx'

type AutoWindow = WindowKind | 'auto'
type AutoDetrend = DetrendMode | 'auto'

const FFT_SIZE_OPTIONS = [0, 1024, 4096, 16384, 65536, 262144, 1048576]
const SEGMENT_OPTIONS = [0, 1, 4, 16, 64, 256]

const DEFAULT_WINDOW: WindowKind = 'hann'
const DEFAULT_DETREND: DetrendMode = 'mean'
const DEFAULT_OVERLAP = 0.5

export function useSpectrumModel(dataset: SuperDataset, initialSignal: string | null) {
  const defaultSignal = useMemo(
    () => initialSignal ?? dataset.numericColumns.find((name) => name !== dataset.timeColumn) ?? dataset.numericColumns[0] ?? '',
    [dataset, initialSignal],
  )

  const [signal, setSignal] = useState(defaultSignal)
  const [sampleRateAuto, setSampleRateAuto] = useState(true)
  const [sampleRateText, setSampleRateText] = useState('')
  const [windowKind, setWindowKind] = useState<AutoWindow>('auto')
  const [detrendMode, setDetrendMode] = useState<AutoDetrend>('auto')
  const [fftSize, setFftSize] = useState(0)
  const [segments, setSegments] = useState(0)
  const [overlap, setOverlap] = useState(DEFAULT_OVERLAP)
  const [normalize, setNormalize] = useState(true)
  const [amplitudeMode, setAmplitudeMode] = useState<'linear' | 'db'>('db')
  const [logFrequency, setLogFrequency] = useState(false)

  useEffect(() => {
    setSignal(defaultSignal)
  }, [defaultSignal])

  const datasetRate = dataset.sampleRate && dataset.sampleRate > 0 ? dataset.sampleRate : null
  const manualRate = Number(sampleRateText)
  const manualRateInvalid = !sampleRateAuto
    && sampleRateText.trim() !== ''
    && !(Number.isFinite(manualRate) && manualRate > 0)
  const resolvedSampleRate = sampleRateAuto
    ? (datasetRate ?? 1)
    : (Number.isFinite(manualRate) && manualRate > 0 ? manualRate : 1)
  const resolvedWindow: WindowKind = windowKind === 'auto' ? DEFAULT_WINDOW : windowKind
  const resolvedDetrend: DetrendMode = detrendMode === 'auto' ? DEFAULT_DETREND : detrendMode
  const resolvedSegments = segments > 0 ? segments : 1

  const spectrum = useMemo(() => {
    if (!signal) {
      return null
    }
    const values = extractNumericValues(dataset, signal)
    return computeSpectrum(values, {
      sampleRate: resolvedSampleRate,
      window: resolvedWindow,
      detrend: resolvedDetrend,
      fftSize,
      segments: resolvedSegments,
      overlap,
      normalize,
    })
  }, [dataset, signal, resolvedSampleRate, resolvedWindow, resolvedDetrend, fftSize, resolvedSegments, overlap, normalize])

  const peaks = useMemo(() => {
    if (!spectrum) {
      return []
    }
    return findSpectrumPeaks(spectrum.freq, spectrum.magnitude, 6, {
      minSeparationBins: 3,
      minFrequency: spectrum.freq.length > 1 ? spectrum.freq[1] * 2 : 0,
    })
  }, [spectrum])

  return {
    signal, setSignal,
    sampleRateAuto, setSampleRateAuto,
    sampleRateText, setSampleRateText,
    windowKind, setWindowKind: (value: string) => setWindowKind(value as AutoWindow),
    detrendMode, setDetrendMode: (value: string) => setDetrendMode(value as AutoDetrend),
    fftSize, setFftSize,
    segments, setSegments,
    overlap, setOverlap,
    normalize, setNormalize,
    amplitudeMode, setAmplitudeMode,
    logFrequency, setLogFrequency,
    datasetRate, manualRateInvalid, resolvedSampleRate,
    resolvedWindow, resolvedDetrend, resolvedSegments,
    spectrum, peaks,
  }
}

export type SpectrumModel = ReturnType<typeof useSpectrumModel>

interface PlotProps {
  copy: SuperPlotCopy
  model: SpectrumModel
  plotRef: React.RefObject<PlotlyChartHandle | null>
  className?: string
}

export function SpectrumPlot({ copy, model, plotRef, className }: PlotProps) {
  const { spectrum, signal, amplitudeMode, logFrequency } = model

  const trace = useMemo<SuperPlotTrace[]>(() => {
    if (!spectrum) {
      return []
    }

    const startIndex = logFrequency ? 1 : 0
    const x: number[] = []
    const yValues: number[] = []
    const db = magnitudeToDb(spectrum.magnitude)

    for (let i = startIndex; i < spectrum.freq.length; i += 1) {
      if (logFrequency && spectrum.freq[i] <= 0) {
        continue
      }
      x.push(spectrum.freq[i])
      yValues.push(amplitudeMode === 'db' ? db[i] : spectrum.magnitude[i])
    }

    const color = getSuperPlotColor(0)
    return [{
      type: 'scattergl',
      mode: 'lines',
      name: signal,
      x,
      y: yValues,
      line: { color, width: 1.2 },
      fill: 'tozeroy',
      fillcolor: withAlpha(color, 0.16),
      hovertemplate: logFrequency ? 'f=%{x:.4g} Hz<extra></extra>' : '%{x:.4g}<extra></extra>',
    }]
  }, [spectrum, amplitudeMode, logFrequency, signal])

  const layout = useMemo(() => {
    const gridColor = resolveSuperPlotGridColor()
    const axisColor = resolveSuperPlotAxisColor()

    return {
      margin: { l: 68, r: 16, t: 18, b: 58 },
      showlegend: false,
      xaxis: {
        title: { text: copy.spectrum.frequency, font: { size: 12 } },
        type: logFrequency ? ('log' as const) : ('linear' as const),
        gridcolor: gridColor,
        zerolinecolor: axisColor,
      },
      yaxis: {
        title: { text: amplitudeMode === 'db' ? `${copy.spectrum.amplitude} (dB)` : copy.spectrum.amplitude, font: { size: 12 } },
        gridcolor: gridColor,
        zerolinecolor: axisColor,
      },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      hovermode: 'x unified' as const,
      hoverlabel: CHART_HOVERLABEL,
      font: { family: SUPER_PLOT_FONT_FAMILY, size: 12 },
    }
  }, [amplitudeMode, copy.spectrum.amplitude, copy.spectrum.frequency, logFrequency])

  const config = useMemo(() => ({ scrollZoom: true, doubleClick: 'reset' }), [])

  const revision = `${model.signal}|${model.resolvedWindow}|${model.resolvedDetrend}|${model.fftSize}|${model.resolvedSegments}|${model.overlap}|${model.normalize}|${model.amplitudeMode}|${model.logFrequency}|${model.resolvedSampleRate}`

  return (
    <div className={`rounded-[var(--radius-box)] bg-base-100 p-1 shadow-sm ${className ?? 'min-h-[300px]'}`}>
      <PlotlyChart
        ref={plotRef}
        data={trace}
        layout={layout}
        config={config}
        revision={revision}
      />
    </div>
  )
}

interface ControlsProps {
  dataset: SuperDataset
  copy: SuperPlotCopy
  locale: string
  model: SpectrumModel
}

export function SpectrumControls({ dataset, copy, locale, model }: ControlsProps) {
  const {
    signal, setSignal,
    sampleRateAuto, setSampleRateAuto,
    sampleRateText, setSampleRateText,
    windowKind, setWindowKind,
    detrendMode, setDetrendMode,
    fftSize, setFftSize,
    segments, setSegments,
    overlap, setOverlap,
    normalize, setNormalize,
    amplitudeMode, setAmplitudeMode,
    logFrequency, setLogFrequency,
    datasetRate, manualRateInvalid,
  } = model

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-0 sm:w-44">
          <Field label={copy.spectrum.signal}>
            <SelectInput
              value={signal}
              options={dataset.numericColumns.map((column) => ({ value: column, label: column }))}
              onChange={setSignal}
            />
          </Field>
        </div>

        <div className="pb-0.5">
          <SegmentedControl
            value={amplitudeMode}
            options={[
              { value: 'db', label: copy.spectrum.decibels },
              { value: 'linear', label: copy.spectrum.linear },
            ]}
            onChange={setAmplitudeMode}
          />
        </div>

        <div className="pb-1.5">
          <Toggle checked={logFrequency} onChange={setLogFrequency} label={copy.spectrum.logFrequency} />
        </div>
      </div>

      <div className="grid gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/55">{copy.spectrum.advanced}</span>
        <div className="grid gap-3 rounded-[var(--radius-box)] bg-muted/50 p-3 sm:grid-cols-2 xl:grid-cols-3">
        <Field
          label={copy.spectrum.sampleRate}
          hint={sampleRateAuto ? `${copy.spectrum.auto} · ${formatFrequency(datasetRate ?? 1)}` : undefined}
        >
          <div className="flex items-center gap-2">
            <SelectInput
              compact
              value={sampleRateAuto ? 'auto' : 'manual'}
              options={[
                { value: 'auto', label: copy.spectrum.auto },
                { value: 'manual', label: copy.spectrum.manual },
              ]}
              onChange={(value) => {
                const nextAuto = value === 'auto'
                setSampleRateAuto(nextAuto)
                if (!nextAuto && sampleRateText === '') {
                  setSampleRateText(String(datasetRate ?? 1))
                }
              }}
            />
            {!sampleRateAuto && (
              <input
                type="text"
                inputMode="decimal"
                className={`h-8 min-w-0 flex-1 rounded-[var(--radius-field)] border-0 bg-muted px-2 text-xs text-base-content outline-none transition focus-visible:ring-2 focus-visible:ring-ring/30 ${manualRateInvalid ? 'ring-1 ring-destructive/40' : ''}`}
                value={sampleRateText}
                onChange={(event) => setSampleRateText(event.target.value)}
                aria-label={copy.spectrum.sampleRate}
                aria-invalid={manualRateInvalid}
              />
            )}
          </div>
        </Field>

        <Field
          label={copy.spectrum.window}
          hint={windowKind === 'auto' ? `${copy.spectrum.auto} · ${copy.windows[DEFAULT_WINDOW]}` : undefined}
        >
          <SelectInput
            value={windowKind}
            options={[
              { value: 'auto', label: copy.spectrum.auto },
              ...WINDOW_KINDS.map((kind) => ({ value: kind, label: copy.windows[kind] })),
            ]}
            onChange={setWindowKind}
          />
        </Field>

        <Field
          label={copy.spectrum.detrend}
          hint={detrendMode === 'auto' ? `${copy.spectrum.auto} · ${copy.detrends[DEFAULT_DETREND]}` : undefined}
        >
          <SelectInput
            value={detrendMode}
            options={[
              { value: 'auto', label: copy.spectrum.auto },
              ...DETREND_MODES.map((kind) => ({ value: kind, label: copy.detrends[kind] })),
            ]}
            onChange={setDetrendMode}
          />
        </Field>

        <Field label={copy.spectrum.fftSize}>
          <SelectInput
            value={String(fftSize)}
            options={FFT_SIZE_OPTIONS.map((size) => ({
              value: String(size),
              label: size === 0 ? copy.spectrum.auto : formatCount(size, locale),
            }))}
            onChange={(value) => setFftSize(Number(value))}
          />
        </Field>

        <Field label={copy.spectrum.segments} hint={segments === 0 ? `${copy.spectrum.auto} · 1` : undefined}>
          <SelectInput
            value={String(segments)}
            options={SEGMENT_OPTIONS.map((count) => ({
              value: String(count),
              label: count === 0 ? copy.spectrum.auto : String(count),
            }))}
            onChange={(value) => setSegments(Number(value))}
          />
        </Field>

        <Field label={copy.spectrum.overlap}>
          <NumberInput value={overlap} step={0.05} min={0} max={0.9} onChange={setOverlap} />
        </Field>

        <div className="flex items-end pb-2">
          <Toggle checked={normalize} onChange={setNormalize} label={copy.spectrum.normalize} />
        </div>
        </div>
      </div>
    </div>
  )
}

interface ResultsProps {
  copy: SuperPlotCopy
  locale: string
  model: SpectrumModel
}

export function SpectrumResults({ copy, locale, model }: ResultsProps) {
  const { spectrum, peaks } = model

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-[var(--radius-box)] shadow-sm">
        <div className="border-b border-base-300 bg-base-200/50 px-3 py-2 text-xs font-semibold text-base-content/70">
          {copy.spectrum.peakTable}
        </div>
        <table className="w-full text-xs">
          <caption className="sr-only">{copy.spectrum.peakTable}</caption>
          <thead>
            <tr className="text-left text-base-content/45">
              <th scope="col" className="px-3 py-1.5 font-medium">{copy.spectrum.frequency}</th>
              <th scope="col" className="px-3 py-1.5 font-medium">{copy.spectrum.magnitude}</th>
              <th scope="col" className="px-3 py-1.5 font-medium">{copy.spectrum.relative}</th>
            </tr>
          </thead>
          <tbody>
            {peaks.map((peak, index) => (
              <tr key={`${peak.frequency}-${index}`} className="border-t border-base-300/60">
                <td className="px-3 py-1.5 font-mono">{formatFrequency(peak.frequency)}</td>
                <td className="px-3 py-1.5 font-mono">{peak.magnitude.toPrecision(4)}</td>
                <td className="px-3 py-1.5 font-mono">{peak.relativeDb.toFixed(1)} dB</td>
              </tr>
            ))}
            {peaks.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-base-content/45" colSpan={3}>{copy.spectrum.noPeaks}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {spectrum && (
        <div className="flex flex-col justify-center gap-2 rounded-[var(--radius-box)] bg-muted/50 px-4 py-3 text-xs text-base-content/65">
          <div>{copy.spectrum.summary(formatCount(spectrum.fftSize, locale), formatFrequency(spectrum.binWidth), spectrum.segmentCount)}</div>
          <div className="font-mono text-[11px] text-base-content/45">
            {copy.spectrum.removed(formatAmplitude(spectrum.removedMean), spectrum.removedSlope.toExponential(2))}
          </div>
        </div>
      )}
    </div>
  )
}
