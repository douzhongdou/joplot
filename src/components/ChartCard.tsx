import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import {
  Copy,
  CopyCheck,
  Download,
  GripVertical,
  MoveDiagonal2,
  ScanSearch,
} from 'lucide-react'
import { PlotCanvas } from './PlotCanvas'
import { buildAggregatedSeries, toPlotSeries } from '../lib/aggregation'
import { buildChartDataRevision, summarizeNumericColumn } from '../lib/workbench'
import { getChartColor, resolveThemeColor } from '../lib/theme'
import type { ChartCard as ChartCardConfig, CsvData, NormalizedRow } from '../types'
import type { CopyImageResult } from './PlotCanvas'
import { useI18n } from '../i18n'

interface Props {
  card: ChartCardConfig
  datasetsById: Record<string, CsvData>
  filteredRowsByDataset: Record<string, NormalizedRow[]>
  filterRevision: string
  selected: boolean
  onSelect: () => void
  onDragStart: (event: PointerEvent<HTMLElement>) => void
  onResizeStart: (event: PointerEvent<HTMLButtonElement>) => void
}

interface PlotCanvasApi {
  autorange: () => Promise<void>
  copyImage: () => Promise<CopyImageResult | null>
  downloadImage: () => Promise<void>
}

function formatValue(value: number | null) {
  return value === null ? '-' : Number(value.toFixed(3)).toString()
}

function parseNumberRange(min: string, max: string) {
  const minValue = Number(min)
  const maxValue = Number(max)

  return min.trim() !== ''
    && max.trim() !== ''
    && Number.isFinite(minValue)
    && Number.isFinite(maxValue)
    && minValue < maxValue
    ? [minValue, maxValue]
    : undefined
}

function parseTextRange(min: string, max: string) {
  return min.trim() !== '' && max.trim() !== '' ? [min, max] : undefined
}

export function ChartCard({
  card,
  datasetsById,
  filteredRowsByDataset,
  filterRevision,
  selected,
  onSelect,
  onDragStart,
  onResizeStart,
}: Props) {
  const { t, formatNumber } = useI18n()
  const plotRef = useRef<PlotCanvasApi>(null)
  const [copyToast, setCopyToast] = useState('')

  const kindLabels: Record<ChartCardConfig['kind'], string> = {
    line: t('chartKinds.line'),
    scatter: t('chartKinds.scatter'),
    bar: t('chartKinds.bar'),
    stats: t('chartKinds.stats'),
  }

  useEffect(() => {
    if (!copyToast) {
      return
    }

    const timeoutId = window.setTimeout(() => setCopyToast(''), 1600)

    return () => window.clearTimeout(timeoutId)
  }, [copyToast])

  const validSeries = useMemo(() => (
    card.dataConfig.mode === 'raw'
      ? card.series
      .map((series) => {
        const dataset = datasetsById[series.datasetId]

        if (!dataset || !dataset.headers.includes(card.xColumn) || !series.yColumn) {
          return null
        }

        if (!dataset.numericColumns.includes(series.yColumn)) {
          return null
        }

        return {
          series,
          dataset,
          rows: filteredRowsByDataset[series.datasetId] ?? dataset.rows,
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : []
  ), [card.dataConfig.mode, card.series, card.xColumn, datasetsById, filteredRowsByDataset])

  const aggregateResult = useMemo(() => {
    if (card.dataConfig.mode !== 'aggregate') {
      return null
    }

    return buildAggregatedSeries(
      Object.values(datasetsById),
      card.dataConfig.aggregation,
      filteredRowsByDataset,
    )
  }, [card.dataConfig, datasetsById, filteredRowsByDataset])

  const plotData = useMemo(() => {
    if (card.kind === 'stats') {
      return []
    }

    if (aggregateResult) {
      return toPlotSeries(aggregateResult).map((series, index) => {
        const color = getChartColor(index)

        if (card.kind === 'bar') {
          return {
            type: 'bar' as const,
            x: series.x,
            y: series.y,
            marker: { color },
            name: series.name,
          }
        }

        return {
          type: 'scattergl' as const,
          mode: card.kind === 'scatter' ? 'markers' : card.drawMode,
          x: series.x,
          y: series.y,
          marker: { color, size: 6 },
          line: { color, width: card.lineWidth },
          name: series.name,
          connectgaps: false,
        }
      })
    }

    return validSeries.map(({ series, rows }) => {
      const x = rows.map((row) => row.raw[card.xColumn] ?? '')
      const y = rows.map((row) => row.numeric[series.yColumn!])

      if (card.kind === 'bar') {
        return {
          type: 'bar' as const,
          x,
          y,
          marker: { color: series.color },
          name: series.label,
        }
      }

      return {
        type: 'scattergl' as const,
        mode: card.kind === 'scatter' ? 'markers' : card.drawMode,
        x,
        y,
        marker: { color: series.color, size: 6 },
        line: { color: series.color, width: card.lineWidth },
        name: series.label,
        connectgaps: false,
      }
    })
  }, [aggregateResult, card.drawMode, card.kind, card.lineWidth, validSeries])

  const hasAggregateSeries = (aggregateResult?.series.length ?? 0) > 0
  const renderedSeriesCount = aggregateResult ? aggregateResult.series.length : validSeries.length

  const plotLayout = useMemo(() => ({
    xaxis: {
      title: { text: card.showAxes ? card.xColumn : '' },
      automargin: true,
      showgrid: card.showGrid,
      gridcolor: resolveThemeColor('--chart-grid', 'rgba(15, 23, 42, 0.08)'),
      color: resolveThemeColor('--chart-axis', 'rgba(15, 23, 42, 0.72)'),
      visible: card.showAxes,
      range: parseTextRange(card.xRange.min, card.xRange.max),
    },
    yaxis: {
      title: {
        text: card.showAxes
          ? (
              card.dataConfig.mode === 'aggregate'
                ? card.dataConfig.aggregation.metricColumn
                : (validSeries[0]?.series.yColumn ?? '')
            )
          : '',
      },
      automargin: true,
      showgrid: card.showGrid,
      gridcolor: resolveThemeColor('--chart-grid', 'rgba(15, 23, 42, 0.08)'),
      color: resolveThemeColor('--chart-axis', 'rgba(15, 23, 42, 0.72)'),
      visible: card.showAxes,
      range:
        parseNumberRange(card.yRange.min, card.yRange.max)
        ?? (
          card.yMin !== null && card.yMax !== null && card.yMin < card.yMax
            ? [card.yMin, card.yMax]
            : undefined
        ),
    },
    showlegend: card.showLegend && renderedSeriesCount > 1,
    hovermode: 'x unified',
  }), [
    card.dataConfig,
    card.showAxes,
    card.showGrid,
    card.showLegend,
    card.xColumn,
    card.xRange.max,
    card.xRange.min,
    card.yMax,
    card.yMin,
    card.yRange.max,
    card.yRange.min,
    renderedSeriesCount,
    validSeries,
  ])

  const primarySeries = validSeries[0] ?? null
  const summary = useMemo(
    () => (
      primarySeries?.series.yColumn
        ? summarizeNumericColumn(primarySeries.rows, primarySeries.series.yColumn)
        : null
    ),
    [primarySeries],
  )
  const aggregateSummary = useMemo(() => {
    const firstSeries = aggregateResult?.series[0]

    if (!firstSeries) {
      return null
    }

    const values = firstSeries.points
      .map((point) => point.y)
      .filter((value): value is number => value !== null)

    if (values.length === 0) {
      return {
        seriesName: firstSeries.name,
        count: 0,
        min: null,
        max: null,
        mean: null,
      }
    }

    return {
      seriesName: firstSeries.name,
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    }
  }, [aggregateResult])

  async function handleCopyImage() {
    const mode = await plotRef.current?.copyImage()
    let nextLabel = ''

    switch (mode) {
      case 'binary':
      case 'html':
      case 'text':
        nextLabel = t('chartCard.copySuccess')
        break
      case 'downloaded':
        nextLabel = t('chartCard.copyDownloadedFallback')
        break
      default:
        nextLabel = ''
    }

    if (nextLabel) {
      setCopyToast(nextLabel)
    }
  }

  return (
    <article
      className={`relative flex h-full min-h-0 flex-col rounded-[calc(var(--radius-box)+0.25rem)] border bg-base-100 p-3 transition ${
        selected
          ? 'border-primary/40 ring-1 ring-primary/15'
          : 'border-base-300 hover:border-primary/20'
      }`}
      onMouseDown={onSelect}
    >
      <div className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3 pb-3">
        <button
          type="button"
          className="inline-grid size-9 place-items-center rounded-[var(--radius-box)] border-0 bg-transparent text-base-content/60 transition hover:bg-transparent hover:text-primary active:cursor-grabbing"
          onPointerDown={onDragStart}
          aria-label={t('chartCard.dragCard')}
          title={t('chartCard.dragCard')}
        >
          <GripVertical size={16} strokeWidth={2.2} />
        </button>

        <div className="grid min-w-0 gap-2">
          <h3 className="break-words text-xl font-semibold leading-none text-base-content">{card.title}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 items-center rounded-full border border-base-300 bg-base-200 px-3 text-xs font-medium text-base-content/70">
              {kindLabels[card.kind]}
            </span>
            <span className="inline-flex h-7 items-center rounded-full border border-base-300 bg-base-200 px-3 text-xs font-medium text-base-content/70">
              {t('chartCard.seriesCount', { count: formatNumber(renderedSeriesCount) })}
            </span>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {card.kind === 'stats' && aggregateSummary && (
          <div className="grid flex-1 grid-cols-3 gap-3 max-md:grid-cols-1">
            {[
              [t('chartCard.stats.dataset'), aggregateSummary.seriesName],
              [t('chartCard.stats.validValues'), String(aggregateSummary.count)],
              [t('chartCard.stats.missingValues'), String(aggregateResult?.skippedRows ?? 0)],
              [t('chartCard.stats.min'), formatValue(aggregateSummary.min)],
              [t('chartCard.stats.max'), formatValue(aggregateSummary.max)],
              [t('chartCard.stats.mean'), formatValue(aggregateSummary.mean)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-base-content/55">{label}</div>
                <div className="mt-2 break-words text-2xl font-semibold text-base-content">{value}</div>
              </div>
            ))}
          </div>
        )}

        {card.kind === 'stats' && !aggregateSummary && summary && primarySeries && (
          <div className="grid flex-1 grid-cols-3 gap-3 max-md:grid-cols-1">
            {[
              [t('chartCard.stats.dataset'), primarySeries.dataset.fileName],
              [t('chartCard.stats.validValues'), String(summary.count)],
              [t('chartCard.stats.missingValues'), String(summary.missing)],
              [t('chartCard.stats.min'), formatValue(summary.min)],
              [t('chartCard.stats.max'), formatValue(summary.max)],
              [t('chartCard.stats.mean'), formatValue(summary.mean)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius-box)] border border-base-300 bg-base-200/50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-base-content/55">{label}</div>
                <div className="mt-2 break-words text-2xl font-semibold text-base-content">{value}</div>
              </div>
            ))}
          </div>
        )}

        {card.kind !== 'stats' && (validSeries.length > 0 || hasAggregateSeries) && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <PlotCanvas
              ref={plotRef}
              data={plotData}
              uirevision={buildChartDataRevision(card, filterRevision)}
              layout={plotLayout}
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-grid size-9 place-items-center rounded-[var(--radius-box)] border-0 bg-transparent text-base-content/65 transition hover:bg-transparent hover:text-primary"
                onClick={() => void plotRef.current?.autorange()}
                aria-label={t('chartCard.autorange')}
                title={t('chartCard.autorange')}
              >
                <ScanSearch size={15} strokeWidth={2.1} />
              </button>
              <button
                type="button"
                className="inline-grid size-9 place-items-center rounded-[var(--radius-box)] border-0 bg-transparent text-base-content/65 transition hover:bg-transparent hover:text-primary"
                onClick={() => void handleCopyImage()}
                aria-label={t('chartCard.copyImage')}
                title={t('chartCard.copyImage')}
              >
                {copyToast ? <CopyCheck size={15} strokeWidth={2.1} /> : <Copy size={15} strokeWidth={2.1} />}
              </button>
              <button
                type="button"
                className="inline-grid size-9 place-items-center rounded-[var(--radius-box)] border-0 bg-transparent text-base-content/65 transition hover:bg-transparent hover:text-primary"
                onClick={() => void plotRef.current?.downloadImage()}
                aria-label={t('chartCard.downloadImage')}
                title={t('chartCard.downloadImage')}
              >
                <Download size={15} strokeWidth={2.1} />
              </button>

              {copyToast && (
                <div className="inline-flex h-9 items-center rounded-full bg-primary/10 px-3 text-xs font-semibold text-primary">
                  {copyToast}
                </div>
              )}
            </div>
          </div>
        )}

        {aggregateResult && (
          aggregateResult.skippedDatasets.length > 0
          || aggregateResult.skippedRows > 0
          || aggregateResult.omittedSeriesCount > 0
        ) && (
          <div className="mt-3 rounded-[var(--radius-box)] bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
            {t('chartCard.aggregateSkipped', {
              datasets: aggregateResult.skippedDatasets.length,
              rows: aggregateResult.skippedRows,
              series: aggregateResult.omittedSeriesCount,
            })}
          </div>
        )}

        {((card.kind === 'stats' && !summary && !aggregateSummary) || (card.kind !== 'stats' && validSeries.length === 0 && !hasAggregateSeries)) && (
          <div className="flex flex-1 items-center justify-center rounded-[var(--radius-box)] border border-dashed border-base-300 bg-base-200/50 p-6 text-center text-sm leading-6 text-base-content/55">
            <div>{t('chartCard.noValidSeries')}</div>
          </div>
        )}
      </div>

      <button
        type="button"
        className="absolute bottom-3 right-3 inline-grid size-9 place-items-center rounded-[var(--radius-box)] border-0 bg-transparent text-base-content/60 transition hover:bg-transparent hover:text-primary"
        onPointerDown={onResizeStart}
        aria-label={t('chartCard.resizeCard')}
        title={t('chartCard.resizeCard')}
      >
        <MoveDiagonal2 size={15} strokeWidth={2.1} />
      </button>
    </article>
  )
}
