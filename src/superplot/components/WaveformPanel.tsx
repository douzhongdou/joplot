'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import type { DownsampleMode, SuperDataset } from '../types.ts'
import type { SuperPlotCopy } from '../lib/i18n.ts'
import { computeSeriesStats, extractSeriesWindow } from '../lib/columns.ts'
import { downsamplePoints } from '../lib/downsample.ts'
import { getSuperPlotColorForSeries } from '../lib/colors.ts'
import { resolveSuperPlotAxisColor, resolveSuperPlotGridColor, SUPER_PLOT_FONT_FAMILY } from '../lib/plotTheme.ts'
import { formatAmplitude, formatCount } from '../lib/format.ts'
import { PlotlyChart, type AxisRange, type PlotlyChartHandle, type SuperPlotTrace } from './PlotlyChart.tsx'
import { Button, Field, SelectInput } from './Controls.tsx'

const TARGET_POINTS = [2000, 4000, 8000, 20000]

export function getDefaultXColumn(dataset: SuperDataset): string {
  if (dataset.timeColumn && dataset.numericColumns.includes(dataset.timeColumn)) {
    return dataset.timeColumn
  }
  return dataset.numericColumns[0] ?? dataset.headers[0] ?? ''
}

export function getDefaultSeries(dataset: SuperDataset, defaultX: string): string[] {
  const candidate = dataset.numericColumns.find((name) => name !== defaultX)
  return candidate ? [candidate] : dataset.numericColumns.slice(0, 1)
}

interface PlotProps {
  dataset: SuperDataset
  xColumn: string
  series: string[]
  mode: DownsampleMode
  target: number
  plotRef: React.RefObject<PlotlyChartHandle | null>
  className?: string
}

export function WaveformPlot({ dataset, xColumn, series, mode, target, plotRef, className }: PlotProps) {
  const debounceRef = useRef<number | undefined>(undefined)
  const lastRangeKeyRef = useRef<string>('')

  const stateRef = useRef({ dataset, xColumn, series, mode, target })
  stateRef.current = { dataset, xColumn, series, mode, target }

  function buildTrace(name: string, range: AxisRange | null): SuperPlotTrace {
    const { x, y } = extractSeriesWindow(dataset, xColumn, name, range)
    const sampled = downsamplePoints(x, y, mode, target)
    return {
      type: 'scattergl',
      mode: 'lines',
      name,
      x: sampled.x,
      y: sampled.y,
      line: { color: getSuperPlotColorForSeries(name, dataset.id), width: 1.1 },
      connectgaps: false,
      hovertemplate: `%{y:.4g}<extra>${name}</extra>`,
    }
  }

  const traceKey = `${xColumn}|${series.join(',')}|${mode}|${target}`
  const initialTraces = useMemo(
    () => series.map((name) => buildTrace(name, null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [traceKey, dataset.id],
  )

  function refine(range: AxisRange | null, force = false) {
    const rangeKey = range ? `${range.min.toFixed(9)}|${range.max.toFixed(9)}` : 'full'
    if (!force && rangeKey === lastRangeKeyRef.current) {
      return
    }
    lastRangeKeyRef.current = rangeKey

    const current = stateRef.current
    const updates = current.series.map((name, index) => {
      const { x, y } = extractSeriesWindow(current.dataset, current.xColumn, name, range)
      const sampled = downsamplePoints(x, y, current.mode, current.target)
      return { index, x: sampled.x, y: sampled.y }
    })
    plotRef.current?.restyleTraces(updates)
  }

  function scheduleRefine(range: AxisRange | null) {
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => refine(range), 140)
  }

  useEffect(() => () => window.clearTimeout(debounceRef.current), [])

  const layout = useMemo(() => {
    const gridColor = resolveSuperPlotGridColor()
    const axisColor = resolveSuperPlotAxisColor()

    return {
      margin: { l: 64, r: 16, t: 18, b: 42 },
      showlegend: series.length > 1,
      legend: { orientation: 'h', x: 0, y: 1.14, font: { size: 11 } },
      xaxis: {
        title: { text: xColumn, standoff: 6, font: { size: 12 } },
        gridcolor: gridColor,
        zerolinecolor: axisColor,
        showspikes: true,
        spikemode: 'across',
        spikethickness: 1,
        spikedash: 'dot',
      },
      yaxis: {
        title: { text: series.join(' / '), font: { size: 12 } },
        gridcolor: gridColor,
        zerolinecolor: axisColor,
      },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      dragmode: 'pan' as const,
      hovermode: 'x unified' as const,
      font: { family: SUPER_PLOT_FONT_FAMILY, size: 12 },
    }
  }, [series, xColumn])

  const config = useMemo(() => ({ scrollZoom: true, doubleClick: 'reset' }), [])

  return (
    <div className={`rounded-[var(--radius-box)] bg-base-100 p-1 shadow-sm ${className ?? 'min-h-[300px]'}`}>
      <PlotlyChart
        ref={plotRef}
        data={initialTraces}
        layout={layout}
        config={config}
        revision={traceKey}
        onRangeChange={scheduleRefine}
        onAfterRender={() => refine(plotRef.current?.getAxisRange() ?? null, true)}
      />
    </div>
  )
}

interface ControlsProps {
  dataset: SuperDataset
  copy: SuperPlotCopy
  locale: string
  xColumn: string
  onXColumnChange: (value: string) => void
  series: string[]
  onSeriesChange: (next: string[]) => void
  mode: DownsampleMode
  onModeChange: (mode: DownsampleMode) => void
  target: number
  onTargetChange: (target: number) => void
  onOpenSpectrum: (signal: string) => void
}

export function WaveformControls({
  dataset,
  copy,
  locale,
  xColumn,
  onXColumnChange,
  series,
  onSeriesChange,
  mode,
  onModeChange,
  target,
  onTargetChange,
  onOpenSpectrum,
}: ControlsProps) {
  const xOptions = dataset.headers.map((header) => ({
    value: header,
    label: dataset.numericColumns.includes(header) ? header : `${header} (#)`,
  }))

  const availableColumns = dataset.numericColumns.filter((name) => name !== xColumn && !series.includes(name))

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-0 sm:w-40">
          <Field label={copy.waveform.xAxis}>
            <SelectInput
              value={xColumn}
              options={xOptions}
              onChange={onXColumnChange}
            />
          </Field>
        </div>

        <div className="w-full min-w-0 sm:w-44">
          <Field label={copy.waveform.downsample}>
            <SelectInput
              value={mode}
              options={[
                { value: 'auto', label: copy.waveform.auto },
                { value: 'envelope', label: copy.waveform.envelope },
                { value: 'lttb', label: copy.waveform.lttb },
                { value: 'none', label: copy.waveform.none },
              ]}
              onChange={(value) => onModeChange(value as DownsampleMode)}
            />
          </Field>
        </div>

        <div className="w-full min-w-0 sm:w-28">
          <Field label={copy.waveform.targetPoints}>
            <SelectInput
              compact
              value={String(target)}
              options={TARGET_POINTS.map((points) => ({ value: String(points), label: formatCount(points, locale) }))}
              onChange={(value) => onTargetChange(Number(value))}
            />
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {series.map((name, index) => (
          <div
            key={`${name}-${index}`}
            className="flex items-center gap-2 rounded-full bg-muted pl-2 pr-1 py-1"
          >
            <span className="size-2.5 rounded-full" style={{ background: getSuperPlotColorForSeries(name, dataset.id) }} />
            <SelectInput
              compact
              value={name}
              options={dataset.numericColumns.map((column) => ({ value: column, label: column }))}
              onChange={(value) => onSeriesChange(series.map((item, i) => (i === index ? value : item)))}
            />
            {series.length > 1 && (
              <button
                type="button"
                className="grid size-6 place-items-center rounded-full text-base-content/50 transition hover:bg-base-300 hover:text-base-content"
                onClick={() => onSeriesChange(series.filter((_, i) => i !== index))}
                aria-label={`${copy.waveform.removeSeries} ${name}`}
                title={`${copy.waveform.removeSeries} ${name}`}
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}

        {availableColumns.length > 0 && (
          <Button
            variant="ghost"
            onClick={() => onSeriesChange([...series, availableColumns[0]])}
          >
            <Plus size={14} /> {copy.waveform.addSeries}
          </Button>
        )}

        {series[0] && (
          <Button
            variant="primary"
            onClick={() => onOpenSpectrum(series[0])}
          >
            {copy.waveform.openSpectrum}
          </Button>
        )}
      </div>
    </div>
  )
}

interface StatsProps {
  dataset: SuperDataset
  copy: SuperPlotCopy
  locale: string
  series: string[]
}

export function WaveformStats({ dataset, copy, locale, series }: StatsProps) {
  const primaryStats = useMemo(() => {
    if (!series[0]) {
      return null
    }
    const { y } = extractSeriesWindow(dataset, null, series[0], null)
    return computeSeriesStats(y)
  }, [dataset, series])

  if (!primaryStats) {
    return null
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {([
        [copy.stats.samples, formatCount(primaryStats.count, locale)],
        [copy.stats.min, formatAmplitude(primaryStats.min)],
        [copy.stats.max, formatAmplitude(primaryStats.max)],
        [copy.stats.mean, formatAmplitude(primaryStats.mean)],
        [copy.stats.rms, formatAmplitude(primaryStats.rms)],
        [copy.stats.peakToPeak, formatAmplitude(primaryStats.peakToPeak)],
        [copy.stats.std, formatAmplitude(primaryStats.std)],
      ] as Array<[string, string]>).map(([label, value]) => (
        <div key={label} className="rounded-[var(--radius-field)] bg-muted px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-base-content/45">{label}</div>
          <div className="truncate text-sm font-semibold text-base-content" title={value}>{value}</div>
        </div>
      ))}
    </div>
  )
}
