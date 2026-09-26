'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RotateCcw, Download, X } from 'lucide-react'
import type { DownsampleMode, SuperDataset } from '../types.ts'
import type { SuperPlotCopy } from '../lib/i18n.ts'
import { computeSeriesStats, extractSeriesWindow } from '../lib/columns.ts'
import { downsamplePoints } from '../lib/downsample.ts'
import { getSuperPlotColor } from '../lib/colors.ts'
import { formatAmplitude, formatCount } from '../lib/format.ts'
import { PlotlyChart, type AxisRange, type PlotlyChartHandle, type SuperPlotTrace } from './PlotlyChart.tsx'
import { Button, Field, SelectInput } from './Controls.tsx'

interface Props {
  dataset: SuperDataset
  copy: SuperPlotCopy
  locale: string
  onOpenSpectrum: (signal: string) => void
}

const TARGET_POINTS = [2000, 4000, 8000, 20000]

export function WaveformPanel({ dataset, copy, locale, onOpenSpectrum }: Props) {
  const defaultX = useMemo(() => {
    if (dataset.timeColumn && dataset.numericColumns.includes(dataset.timeColumn)) {
      return dataset.timeColumn
    }
    return dataset.numericColumns[0] ?? dataset.headers[0] ?? ''
  }, [dataset])

  const [xColumn, setXColumn] = useState(defaultX)
  const [series, setSeries] = useState<string[]>(() => {
    const candidate = dataset.numericColumns.find((name) => name !== defaultX)
    return candidate ? [candidate] : dataset.numericColumns.slice(0, 1)
  })
  const [mode, setMode] = useState<DownsampleMode>('auto')
  const [target, setTarget] = useState(4000)
  const plotRef = useRef<PlotlyChartHandle>(null)
  const debounceRef = useRef<number | undefined>(undefined)
  const lastRangeKeyRef = useRef<string>('')

  const stateRef = useRef({ dataset, xColumn, series, mode, target })
  stateRef.current = { dataset, xColumn, series, mode, target }

  const xOptions = dataset.headers.map((header) => ({
    value: header,
    label: dataset.numericColumns.includes(header) ? header : `${header} (#)`,
  }))

  const availableColumns = dataset.numericColumns.filter((name) => name !== xColumn && !series.includes(name))

  function buildTrace(name: string, index: number, range: AxisRange | null): SuperPlotTrace {
    const { x, y } = extractSeriesWindow(dataset, xColumn, name, range)
    const sampled = downsamplePoints(x, y, mode, target)
    return {
      type: 'scattergl',
      mode: 'lines',
      name,
      x: sampled.x,
      y: sampled.y,
      line: { color: getSuperPlotColor(index), width: 1.1 },
      connectgaps: false,
      hovertemplate: `%{y:.4g}<extra>${name}</extra>`,
    }
  }

  const traceKey = `${xColumn}|${series.join(',')}|${mode}|${target}`
  const initialTraces = useMemo(
    () => series.map((name, index) => buildTrace(name, index, null)),
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

  const primaryStats = useMemo(() => {
    if (!series[0]) {
      return null
    }
    const { y } = extractSeriesWindow(dataset, null, series[0], null)
    return computeSeriesStats(y)
  }, [dataset, series])

  const layout = useMemo(() => ({
    margin: { l: 64, r: 16, t: 18, b: 42 },
    showlegend: series.length > 1,
    legend: { orientation: 'h', x: 0, y: 1.14, font: { size: 11 } },
    xaxis: {
      title: { text: xColumn, standoff: 6, font: { size: 12 } },
      gridcolor: 'rgba(127,127,127,0.16)',
      zerolinecolor: 'rgba(127,127,127,0.32)',
      showspikes: true,
      spikemode: 'across',
      spikethickness: 1,
      spikedash: 'dot',
    },
    yaxis: {
      title: { text: series.join(' / '), font: { size: 12 } },
      gridcolor: 'rgba(127,127,127,0.16)',
      zerolinecolor: 'rgba(127,127,127,0.32)',
    },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    dragmode: 'pan' as const,
    hovermode: 'x unified' as const,
    font: { family: 'Segoe UI, PingFang SC, Microsoft YaHei, sans-serif', size: 12 },
  }), [series, xColumn])

  const config = useMemo(() => ({ scrollZoom: true, doubleClick: 'reset' }), [])

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Field label={copy.waveform.xAxis}>
            <SelectInput
              value={xColumn}
              options={xOptions}
              onChange={(value) => setXColumn(value)}
            />
          </Field>
        </div>

        <div className="w-44">
          <Field label={copy.waveform.downsample}>
            <SelectInput
              value={mode}
              options={[
                { value: 'auto', label: copy.waveform.auto },
                { value: 'envelope', label: copy.waveform.envelope },
                { value: 'lttb', label: copy.waveform.lttb },
                { value: 'none', label: copy.waveform.none },
              ]}
              onChange={(value) => setMode(value as DownsampleMode)}
            />
          </Field>
        </div>

        <div className="w-28">
          <Field label={copy.waveform.targetPoints}>
            <SelectInput
              compact
              value={String(target)}
              options={TARGET_POINTS.map((points) => ({ value: String(points), label: formatCount(points, locale) }))}
              onChange={(value) => setTarget(Number(value))}
            />
          </Field>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button onClick={() => plotRef.current?.resetZoom()} variant="ghost">
            <RotateCcw size={14} /> {copy.waveform.resetZoom}
          </Button>
          <Button onClick={() => void plotRef.current?.exportPng(`${dataset.fileName}-waveform`)}>
            <Download size={14} /> {copy.waveform.exportPng}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3">
        <div className="flex flex-wrap gap-2">
          {series.map((name, index) => (
            <div
              key={`${name}-${index}`}
              className="flex items-center gap-2 rounded-full border border-base-300 bg-base-200/60 pl-2 pr-1 py-1"
            >
              <span className="size-2.5 rounded-full" style={{ background: getSuperPlotColor(index) }} />
              <SelectInput
                compact
                value={name}
                options={dataset.numericColumns.map((column) => ({ value: column, label: column }))}
                onChange={(value) => setSeries((prev) => prev.map((item, i) => (i === index ? value : item)))}
              />
              {series.length > 1 && (
                <button
                  type="button"
                  className="grid size-6 place-items-center rounded-full text-base-content/50 transition hover:bg-base-300 hover:text-base-content"
                  onClick={() => setSeries((prev) => prev.filter((_, i) => i !== index))}
                  aria-label={copy.waveform.removeSeries}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}

          {availableColumns.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => setSeries((prev) => [...prev, availableColumns[0]])}
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

        <div className="min-h-[300px] rounded-[var(--radius-box)] border border-base-300 bg-base-100/60 p-1">
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

        {primaryStats && (
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
              <div key={label} className="rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-base-content/45">{label}</div>
                <div className="truncate text-sm font-semibold text-base-content" title={value}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
