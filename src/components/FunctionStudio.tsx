'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Download, Eye, EyeOff, Maximize2, Plus, Send, Trash2 } from 'lucide-react'
import type { Data, Layout } from 'plotly.js/dist/plotly.min.js'
import { AppNavbar } from './AppNavbar'
import { PlotCanvas, type PlotCanvasApi } from './PlotCanvas'
import { DATASET_STORAGE_KEY } from '../hooks/useCsvData'
import { getLanguagePath, useI18n } from '../i18n'
import { appendDatasetToSerialized } from '../lib/datasetPersistence'
import { ExpressionError, parseExpression, type ParsedExpression } from '../lib/expression'
import { FUNCTION_EXAMPLES, type FunctionExample } from '../lib/functionExamples'
import {
  MAX_SAMPLES,
  MIN_SAMPLES,
  computeAdaptiveYRange,
  listFreeParameters,
  sampleCurve,
  sampledCurveToCsvRows,
} from '../lib/functionPlot'
import {
  DEFAULT_FUNCTION_STUDIO_STATE,
  FUNCTION_STUDIO_STORAGE_KEY,
  MAX_CURVES,
  deserializeFunctionStudioState,
  makeCurveId,
  serializeFunctionStudioState,
  type FunctionCurveState,
  type FunctionParamState,
} from '../lib/functionStudioPersistence'
import { getChartColor } from '../lib/theme'
import { CHART_HOVERLABEL } from '../lib/tooltipStyle'
import { buildDataset } from '../lib/workbench'

const EXPRESSION_DEBOUNCE_MS = 120
const FEEDBACK_RESET_MS = 1800
const WORKBENCH_REDIRECT_MS = 700
const DEFAULT_PARAM: Omit<FunctionParamState, 'name'> = { value: 1, min: -5, max: 5, step: 0.1 }

const sectionTitleClass = 'text-xs font-medium uppercase tracking-[0.12em] text-base-content/55'
const inputClass = 'h-10 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-3 text-sm text-base-content outline-none transition placeholder:text-base-content/40 focus:border-primary/35 focus:ring-2 focus:ring-primary/20'
const compactInputClass = 'h-8 w-full min-w-0 rounded-lg border border-base-300 bg-base-100 px-2 text-xs text-base-content outline-none transition focus:border-primary/35 focus:ring-2 focus:ring-primary/20'
const iconButtonClass = 'inline-grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-base-content/55 transition hover:text-primary disabled:pointer-events-none disabled:opacity-35'
const toolbarButtonClass = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-3 text-sm font-semibold text-base-content transition hover:border-primary/35 hover:text-primary disabled:pointer-events-none disabled:opacity-50'
const primaryButtonClass = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-box)] bg-primary px-3.5 text-sm font-semibold text-primary-content transition hover:brightness-105 disabled:pointer-events-none disabled:opacity-50'
const chipClass = 'inline-flex h-8 items-center rounded-full border border-base-300 bg-base-100 px-3 text-xs font-medium text-base-content/80 transition hover:border-primary/40 hover:text-primary'

interface Domain {
  xMin: number
  xMax: number
}

interface CurveParse {
  curve: FunctionCurveState
  parsed: ParsedExpression | null
  error: ExpressionError | null
}

type SendFeedback =
  | { kind: 'success'; count: number }
  | { kind: 'failed' }
  | { kind: 'empty' }

function parseNumberInput(text: string, fallback: number) {
  const trimmed = text.trim()
  const value = Number(trimmed)

  return trimmed !== '' && Number.isFinite(value) ? value : fallback
}

function parseOptionalNumber(text: string) {
  const trimmed = text.trim()

  if (!trimmed) {
    return null
  }

  const value = Number(trimmed)

  return Number.isFinite(value) ? value : null
}

function resolveDomain(xMinText: string, xMaxText: string): Domain {
  const xMin = parseNumberInput(xMinText, DEFAULT_FUNCTION_STUDIO_STATE.xMin)
  const xMax = parseNumberInput(xMaxText, DEFAULT_FUNCTION_STUDIO_STATE.xMax)

  if (xMin < xMax) {
    return { xMin, xMax }
  }

  if (xMin > xMax) {
    return { xMin: xMax, xMax: xMin }
  }

  return { xMin, xMax: xMin + 1 }
}

function formatSliderValue(value: number) {
  return String(Number(value.toFixed(3)))
}

function readStoredState() {
  try {
    return deserializeFunctionStudioState(window.localStorage.getItem(FUNCTION_STUDIO_STORAGE_KEY))
  } catch {
    return DEFAULT_FUNCTION_STUDIO_STATE
  }
}

export function FunctionStudio() {
  const { t, language } = useI18n()
  const plotRef = useRef<PlotCanvasApi>(null)
  const [hydrated, setHydrated] = useState(false)
  const [persistenceFailed, setPersistenceFailed] = useState(false)
  const [curves, setCurves] = useState<FunctionCurveState[]>(DEFAULT_FUNCTION_STUDIO_STATE.curves)
  const [xMinText, setXMinText] = useState(String(DEFAULT_FUNCTION_STUDIO_STATE.xMin))
  const [xMaxText, setXMaxText] = useState(String(DEFAULT_FUNCTION_STUDIO_STATE.xMax))
  const [yMinText, setYMinText] = useState(DEFAULT_FUNCTION_STUDIO_STATE.yMin)
  const [yMaxText, setYMaxText] = useState(DEFAULT_FUNCTION_STUDIO_STATE.yMax)
  const [samples, setSamples] = useState(DEFAULT_FUNCTION_STUDIO_STATE.samples)
  const [params, setParams] = useState<FunctionParamState[]>([])
  const [rangeTick, setRangeTick] = useState(0)
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied' | 'downloaded'>('idle')
  const [sendFeedback, setSendFeedback] = useState<SendFeedback | null>(null)

  const domain = useMemo(() => resolveDomain(xMinText, xMaxText), [xMinText, xMaxText])

  const [debounced, setDebounced] = useState<{ curves: FunctionCurveState[]; domain: Domain }>({
    curves: DEFAULT_FUNCTION_STUDIO_STATE.curves,
    domain: { xMin: DEFAULT_FUNCTION_STUDIO_STATE.xMin, xMax: DEFAULT_FUNCTION_STUDIO_STATE.xMax },
  })

  useEffect(() => {
    const restored = readStoredState()
    const restoredDomain = { xMin: restored.xMin, xMax: restored.xMax }

    setCurves(restored.curves)
    setXMinText(String(restored.xMin))
    setXMaxText(String(restored.xMax))
    setYMinText(restored.yMin)
    setYMaxText(restored.yMax)
    setSamples(restored.samples)
    setParams(restored.params)
    setDebounced({ curves: restored.curves, domain: restoredDomain })
    setHydrated(true)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced({ curves, domain })
    }, EXPRESSION_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [curves, domain])

  useEffect(() => {
    if (!hydrated) {
      return
    }

    try {
      window.localStorage.setItem(
        FUNCTION_STUDIO_STORAGE_KEY,
        serializeFunctionStudioState({
          curves,
          xMin: domain.xMin,
          xMax: domain.xMax,
          yMin: yMinText,
          yMax: yMaxText,
          samples,
          params,
        }),
      )
      setPersistenceFailed(false)
    } catch {
      setPersistenceFailed(true)
    }
  }, [curves, domain, hydrated, params, samples, yMaxText, yMinText])

  const parsedCurves = useMemo<CurveParse[]>(
    () => debounced.curves.map((curve) => {
      try {
        return { curve, parsed: parseExpression(curve.expression), error: null }
      } catch (error) {
        return { curve, parsed: null, error: error instanceof ExpressionError ? error : null }
      }
    }),
    [debounced.curves],
  )

  const parseResultById = useMemo(
    () => Object.fromEntries(parsedCurves.map((result) => [result.curve.id, result])),
    [parsedCurves],
  )

  useEffect(() => {
    const referenced = new Set<string>()

    parsedCurves.forEach(({ parsed }) => {
      if (parsed) {
        listFreeParameters(parsed).forEach((name) => referenced.add(name))
      }
    })

    setParams((prev) => {
      const kept = prev.filter((param) => referenced.has(param.name))
      const knownNames = new Set(kept.map((param) => param.name))
      const added = [...referenced]
        .filter((name) => !knownNames.has(name))
        .map((name) => ({ name, ...DEFAULT_PARAM }))

      if (added.length === 0 && kept.length === prev.length) {
        return prev
      }

      return [...kept, ...added]
    })
  }, [parsedCurves])

  const paramValues = useMemo(
    () => Object.fromEntries(params.map((param) => [param.name, param.value])),
    [params],
  )

  const sampledCurves = useMemo(
    () => parsedCurves
      .filter(({ curve, parsed }) => curve.visible && parsed !== null)
      .map(({ curve, parsed }) => sampleCurve(curve.id, curve.expression, curve.color, parsed!, {
        xMin: debounced.domain.xMin,
        xMax: debounced.domain.xMax,
        samples,
        params: paramValues,
      })),
    [debounced.domain, paramValues, parsedCurves, samples],
  )

  const plotData = useMemo<Data[]>(
    () => sampledCurves.map((curve) => ({
      type: 'scatter',
      mode: 'lines',
      x: curve.xs,
      y: curve.ys,
      name: curve.expression,
      line: { color: curve.color, width: 2.2 },
      connectgaps: false,
      hovertemplate: `x = %{x:.4g}<br>y = %{y:.4g}<extra>${curve.expression}</extra>`,
    })),
    [sampledCurves],
  )

  const showLegend = sampledCurves.length > 1

  const adaptiveYRange = useMemo(
    () => computeAdaptiveYRange(sampledCurves),
    [sampledCurves],
  )

  const yRange = useMemo<[number | null, number | null] | null>(() => {
    const manualMin = parseOptionalNumber(yMinText)
    const manualMax = parseOptionalNumber(yMaxText)

    if (manualMin === null && manualMax === null) {
      return adaptiveYRange
    }

    return [
      manualMin ?? adaptiveYRange?.[0] ?? null,
      manualMax ?? adaptiveYRange?.[1] ?? null,
    ]
  }, [adaptiveYRange, yMaxText, yMinText])

  const yaxis = useMemo(() => ({
    zeroline: true,
    zerolinewidth: 1.4,
    zerolinecolor: 'rgba(17, 24, 39, 0.35)',
    gridcolor: 'rgba(17, 24, 39, 0.08)',
    ...(yRange ? { range: yRange } : {}),
  }), [yRange])

  const plotLayout = useMemo<Partial<Layout>>(() => ({
    margin: { l: 56, r: 20, t: 20, b: showLegend ? 76 : 48 },
    showlegend: showLegend,
    legend: { orientation: 'h', x: 0, y: -0.18, font: { size: 12 } },
    hovermode: 'x',
    hoverlabel: CHART_HOVERLABEL,
    xaxis: {
      zeroline: true,
      zerolinewidth: 1.4,
      zerolinecolor: 'rgba(17, 24, 39, 0.35)',
      gridcolor: 'rgba(17, 24, 39, 0.08)',
    },
    yaxis,
  }), [showLegend, yaxis])

  const uirevision = `function-plot:${debounced.domain.xMin}:${debounced.domain.xMax}:${samples}:${yMinText || 'auto'}|${yMaxText || 'auto'}:${rangeTick}`

  useEffect(() => {
    if (copyFeedback === 'idle') {
      return
    }

    const timer = window.setTimeout(() => setCopyFeedback('idle'), FEEDBACK_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [copyFeedback])

  useEffect(() => {
    if (!sendFeedback || sendFeedback.kind === 'success') {
      return
    }

    const timer = window.setTimeout(() => setSendFeedback(null), FEEDBACK_RESET_MS * 2)
    return () => window.clearTimeout(timer)
  }, [sendFeedback])

  function updateCurve(curveId: string, patch: Partial<FunctionCurveState>) {
    setCurves((prev) => prev.map((curve) => (curve.id === curveId ? { ...curve, ...patch } : curve)))
  }

  function addCurve(expression = '') {
    setCurves((prev) => {
      if (prev.length >= MAX_CURVES) {
        return prev
      }

      return [...prev, {
        id: makeCurveId(),
        expression,
        color: getChartColor(prev.length),
        visible: true,
      }]
    })
  }

  function removeCurve(curveId: string) {
    setCurves((prev) => (prev.length <= 1 ? prev : prev.filter((curve) => curve.id !== curveId)))
  }

  function applyExample(example: FunctionExample) {
    const isPristineDefault = curves.length === 1
      && curves[0].expression.trim() === DEFAULT_FUNCTION_STUDIO_STATE.curves[0].expression

    if (isPristineDefault || curves.every((curve) => curve.expression.trim() === '')) {
      setCurves((prev) => [{ ...prev[0], expression: example.expression }])
      return
    }

    addCurve(example.expression)
  }

  function updateParam(name: string, patch: Partial<FunctionParamState>) {
    setParams((prev) => prev.map((param) => {
      if (param.name !== name) {
        return param
      }

      const next = { ...param, ...patch }

      if (next.max <= next.min) {
        return param
      }

      return { ...next, value: Math.min(Math.max(next.value, next.min), next.max) }
    }))
  }

  async function handleCopyImage() {
    const result = await plotRef.current?.copyImage()

    if (result === 'downloaded') {
      setCopyFeedback('downloaded')
    } else if (result) {
      setCopyFeedback('copied')
    }
  }

  function handleSendToWorkbench() {
    if (sampledCurves.length === 0) {
      setSendFeedback({ kind: 'empty' })
      return
    }

    try {
      let serialized = window.localStorage.getItem(DATASET_STORAGE_KEY) ?? ''

      sampledCurves.forEach((curve) => {
        const dataset = buildDataset(['x', 'y'], sampledCurveToCsvRows(curve), curve.expression)
        serialized = appendDatasetToSerialized(serialized, dataset).serialized
      })

      window.localStorage.setItem(DATASET_STORAGE_KEY, serialized)
      setSendFeedback({ kind: 'success', count: sampledCurves.length })
      window.setTimeout(() => {
        window.location.assign(getLanguagePath(language))
      }, WORKBENCH_REDIRECT_MS)
    } catch {
      setSendFeedback({ kind: 'failed' })
    }
  }

  function describeError(error: ExpressionError) {
    const key = `functionStudio.errors.${error.code}`
    const message = t(key, error.params)

    return message === key ? t('functionStudio.invalidCurve') : message
  }

  function describeSendFeedback(feedback: SendFeedback) {
    switch (feedback.kind) {
      case 'success':
        return t('functionStudio.sendSuccess', { count: feedback.count })
      case 'failed':
        return t('functionStudio.sendFailed')
      case 'empty':
        return t('functionStudio.sendEmpty')
    }
  }

  return (
    <div className="grid h-full grid-rows-[var(--navbar-height)_minmax(0,1fr)] bg-base-200 text-base-content">
      <AppNavbar section="function" />

      <main className="min-h-0 overflow-y-auto lg:overflow-hidden">
        {persistenceFailed && (
          <div
            role="status"
            className="border-b border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-base-content sm:px-6"
          >
            {t('persistence.storageWarning')}
          </div>
        )}

        <div className="grid min-h-0 lg:h-full lg:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="order-2 min-h-0 border-t border-base-300 bg-base-100 lg:order-1 lg:overflow-y-auto lg:border-t-0 lg:border-r">
            <div className="grid gap-6 p-4 sm:p-5">
              <header className="grid gap-1.5">
                <h1 className="text-lg font-semibold text-base-content">{t('functionStudio.heading')}</h1>
                <p className="text-sm leading-relaxed text-base-content/65">{t('functionStudio.description')}</p>
              </header>

              <section className="grid gap-3">
                <h2 className={sectionTitleClass}>{t('functionStudio.curvesSectionTitle')}</h2>
                <div className="grid gap-2">
                  {curves.map((curve) => {
                    const parseResult = parseResultById[curve.id]
                    const error = parseResult?.error ?? null
                    const showError = error !== null && curve.expression.trim() !== ''

                    return (
                      <div
                        key={curve.id}
                        className={`rounded-[var(--radius-box)] border bg-base-100 transition ${
                          showError ? 'border-error/40' : 'border-base-300 focus-within:border-primary/35'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 p-1.5 pl-2.5">
                          <label
                            className="relative inline-grid size-7 shrink-0 place-items-center rounded-lg border border-base-300"
                            style={{ backgroundColor: curve.color }}
                            title={t('functionStudio.colorLabel')}
                          >
                            <input
                              type="color"
                              value={curve.color}
                              onChange={(event) => updateCurve(curve.id, { color: event.target.value })}
                              className="absolute inset-0 cursor-pointer opacity-0"
                              aria-label={t('functionStudio.colorLabel')}
                            />
                          </label>
                          <span className="shrink-0 font-mono text-sm text-base-content/50">y =</span>
                          <input
                            type="text"
                            value={curve.expression}
                            placeholder={t('functionStudio.expressionPlaceholder')}
                            onChange={(event) => updateCurve(curve.id, { expression: event.target.value })}
                            className={`h-9 min-w-0 flex-1 bg-transparent px-1 font-mono text-sm text-base-content outline-none placeholder:font-sans placeholder:text-base-content/40 ${
                              curve.visible ? '' : 'text-base-content/45 line-through'
                            }`}
                            spellCheck={false}
                            autoComplete="off"
                            autoCapitalize="off"
                            aria-label={t('functionStudio.expressionLabel')}
                          />
                          <button
                            type="button"
                            className={iconButtonClass}
                            onClick={() => updateCurve(curve.id, { visible: !curve.visible })}
                            aria-label={t('functionStudio.toggleCurve')}
                            aria-pressed={curve.visible}
                            title={t('functionStudio.toggleCurve')}
                          >
                            {curve.visible ? <Eye size={15} strokeWidth={2.1} /> : <EyeOff size={15} strokeWidth={2.1} />}
                          </button>
                          <button
                            type="button"
                            className={iconButtonClass}
                            onClick={() => removeCurve(curve.id)}
                            disabled={curves.length <= 1}
                            aria-label={t('functionStudio.removeCurve')}
                            title={t('functionStudio.removeCurve')}
                          >
                            <Trash2 size={15} strokeWidth={2.1} />
                          </button>
                        </div>
                        {showError && error && (
                          <p className="border-t border-error/20 bg-error/5 px-3 py-1.5 text-xs leading-relaxed text-error">
                            {describeError(error)}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[var(--radius-box)] border border-dashed border-base-300 bg-transparent px-3 text-sm font-semibold text-base-content/70 transition hover:border-primary/40 hover:text-primary disabled:pointer-events-none disabled:opacity-40"
                  onClick={() => addCurve()}
                  disabled={curves.length >= MAX_CURVES}
                >
                  <Plus size={15} strokeWidth={2.2} />
                  {t('functionStudio.addCurve')}
                </button>
                <p className="text-xs leading-relaxed text-base-content/50">{t('functionStudio.functionsHint')}</p>
              </section>

              <section className="grid gap-3">
                <h2 className={sectionTitleClass}>{t('functionStudio.domainSectionTitle')}</h2>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1.5">
                    <span className="text-xs text-base-content/60">{t('functionStudio.xMin')}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={xMinText}
                      onChange={(event) => setXMinText(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs text-base-content/60">{t('functionStudio.xMax')}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={xMaxText}
                      onChange={(event) => setXMaxText(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs text-base-content/60">{t('functionStudio.yMin')}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={yMinText}
                      placeholder={t('inspector.autoRangePlaceholder')}
                      onChange={(event) => setYMinText(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs text-base-content/60">{t('functionStudio.yMax')}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={yMaxText}
                      placeholder={t('inspector.autoRangePlaceholder')}
                      onChange={(event) => setYMaxText(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                </div>
                <label className="grid gap-1.5">
                  <span className="flex items-center justify-between text-xs text-base-content/60">
                    <span>{t('functionStudio.samplesLabel')}</span>
                    <span className="font-mono text-base-content/75">{t('functionStudio.samplesValue', { count: samples })}</span>
                  </span>
                  <input
                    type="range"
                    min={MIN_SAMPLES}
                    max={MAX_SAMPLES}
                    step={50}
                    value={samples}
                    onChange={(event) => setSamples(Number(event.target.value))}
                    className="w-full accent-primary"
                  />
                </label>
              </section>

              <section className="grid gap-3">
                <h2 className={sectionTitleClass}>{t('functionStudio.paramsSectionTitle')}</h2>
                {params.length === 0 ? (
                  <p className="text-xs leading-relaxed text-base-content/50">{t('functionStudio.paramsEmptyHint')}</p>
                ) : (
                  <div className="grid gap-4">
                    {params.map((param) => (
                      <div key={param.name} className="grid gap-2 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-sm font-semibold text-base-content">{param.name}</span>
                          <input
                            type="number"
                            step={param.step}
                            value={formatSliderValue(param.value)}
                            onChange={(event) => {
                              const next = Number(event.target.value)
                              if (Number.isFinite(next)) {
                                updateParam(param.name, { value: next })
                              }
                            }}
                            className={`${compactInputClass} w-24 font-mono`}
                            aria-label={param.name}
                          />
                        </div>
                        <input
                          type="range"
                          min={param.min}
                          max={param.max}
                          step={param.step}
                          value={param.value}
                          onChange={(event) => updateParam(param.name, { value: Number(event.target.value) })}
                          className="w-full accent-primary"
                          aria-label={param.name}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <label className="grid gap-1">
                            <span className="text-[11px] text-base-content/50">{t('functionStudio.paramMin')}</span>
                            <input
                              type="number"
                              value={param.min}
                              onChange={(event) => {
                                const next = Number(event.target.value)
                                if (Number.isFinite(next)) {
                                  updateParam(param.name, { min: next })
                                }
                              }}
                              className={`${compactInputClass} font-mono`}
                            />
                          </label>
                          <label className="grid gap-1">
                            <span className="text-[11px] text-base-content/50">{t('functionStudio.paramMax')}</span>
                            <input
                              type="number"
                              value={param.max}
                              onChange={(event) => {
                                const next = Number(event.target.value)
                                if (Number.isFinite(next)) {
                                  updateParam(param.name, { max: next })
                                }
                              }}
                              className={`${compactInputClass} font-mono`}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="grid gap-3">
                <h2 className={sectionTitleClass}>{t('functionStudio.examplesSectionTitle')}</h2>
                <div className="flex flex-wrap gap-2">
                  {FUNCTION_EXAMPLES.map((example) => (
                    <button
                      key={example.id}
                      type="button"
                      className={chipClass}
                      onClick={() => applyExample(example)}
                      title={example.expression}
                    >
                      {t(`functionStudio.examples.${example.id}`)}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </aside>

          <section className="order-1 flex h-[52vh] min-h-[320px] flex-col lg:order-2 lg:h-auto lg:min-h-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-100 px-3 py-2 sm:px-4">
              <button
                type="button"
                className={toolbarButtonClass}
                onClick={() => {
                  setYMinText('')
                  setYMaxText('')
                  setRangeTick((tick) => tick + 1)
                }}
                disabled={sampledCurves.length === 0}
                title={t('functionStudio.autorangeHint')}
              >
                <Maximize2 size={15} strokeWidth={2.1} />
                <span className="hidden sm:inline">{t('chartCard.autorange')}</span>
              </button>
              <button
                type="button"
                className={toolbarButtonClass}
                onClick={() => void handleCopyImage()}
                disabled={sampledCurves.length === 0}
              >
                {copyFeedback === 'idle' ? <Copy size={15} strokeWidth={2.1} /> : <Check size={15} strokeWidth={2.1} />}
                <span className="hidden sm:inline">
                  {copyFeedback === 'copied'
                    ? t('chartCard.copySuccess')
                    : copyFeedback === 'downloaded'
                      ? t('chartCard.copyDownloadedFallback')
                      : t('chartCard.copyImage')}
                </span>
              </button>
              <button
                type="button"
                className={toolbarButtonClass}
                onClick={() => void plotRef.current?.downloadImage()}
                disabled={sampledCurves.length === 0}
              >
                <Download size={15} strokeWidth={2.1} />
                <span className="hidden sm:inline">{t('chartCard.downloadImage')}</span>
              </button>

              <div className="ml-auto flex items-center gap-2">
                {sendFeedback && (
                  <span
                    role="status"
                    className={`text-xs ${sendFeedback.kind === 'success' ? 'text-success' : 'text-error'}`}
                  >
                    {describeSendFeedback(sendFeedback)}
                  </span>
                )}
                <button
                  type="button"
                  className={primaryButtonClass}
                  onClick={handleSendToWorkbench}
                  disabled={sampledCurves.length === 0 || sendFeedback?.kind === 'success'}
                  title={t('functionStudio.sendHint')}
                >
                  <Send size={15} strokeWidth={2.1} />
                  {t('functionStudio.sendToWorkbench')}
                </button>
              </div>
            </div>

            <div className="relative flex min-h-0 flex-1 flex-col bg-base-200 p-2 sm:p-3">
              <PlotCanvas
                ref={plotRef}
                data={plotData}
                layout={plotLayout}
                uirevision={uirevision}
                exportKind="line"
                exportTitle="joplot-function-plot"
              />
              {sampledCurves.length === 0 && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
                  <div className="grid max-w-sm gap-1.5 rounded-[var(--radius-box)] border border-base-300 bg-base-100/95 px-5 py-4 text-center backdrop-blur-sm">
                    <strong className="text-sm font-semibold text-base-content">{t('functionStudio.emptyPlotTitle')}</strong>
                    <p className="text-xs leading-relaxed text-base-content/60">{t('functionStudio.emptyPlotDescription')}</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
