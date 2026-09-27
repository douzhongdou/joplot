'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScienceValue } from '../types.ts'
import { values1d } from '../lib/dense.ts'
import { SCIENCE_COLORS } from '../lib/colors.ts'
import { createScienceCopy, type ScienceLanguage } from '../lib/i18n.ts'
import { defaultParams, nextStepId, type AnalysisStep, type OpKind } from '../lib/pipeline.ts'
import { createSampleWorkspace } from '../lib/workspace.ts'
import { useComputeHost, type ComputeResult } from '../compute/host.ts'
import { AnalysisPanel, ResultsPanel, type StepStatus } from './AnalysisPanel.tsx'
import { Plot, type ScienceTrace } from './Plot.tsx'
import { WorkspacePanel } from './WorkspacePanel.tsx'

type RunStatus = 'idle' | 'running' | 'ready' | 'error'

interface WaveBundle {
  traces: ScienceTrace[]
  hasResidual: boolean
}

function seriesTrace(name: string, x: ArrayLike<number>, y: ArrayLike<number>, color: string, width: number): ScienceTrace {
  return { x, y, name, color, width, mode: 'lines' }
}

function buildWaveTraces(values: ScienceValue[], selected: ScienceValue, copy: ReturnType<typeof createScienceCopy>): WaveBundle {
  const traces: ScienceTrace[] = []
  const base = values.find((value) => value.id === 'signal' && value.kind === 'series')
  let hasResidual = false

  if (base && base.kind === 'series' && selected.id !== base.id) {
    traces.push(seriesTrace('signal', values1d(base.x), values1d(base.y), SCIENCE_COLORS.base, 1))
  }

  if (selected.kind === 'series') {
    traces.push(seriesTrace(selected.name, values1d(selected.x), values1d(selected.y), SCIENCE_COLORS.series, 1.9))
  }

  if (selected.kind === 'fit') {
    traces.push({
      x: values1d(selected.x),
      y: values1d(selected.y),
      name: copy.plot.data,
      color: SCIENCE_COLORS.base,
      mode: 'markers',
      opacity: 0.55,
    })
    traces.push(seriesTrace(copy.plot.fit, values1d(selected.x), values1d(selected.fitted), SCIENCE_COLORS.fit, 2))
    traces.push({
      x: values1d(selected.x),
      y: values1d(selected.residual),
      name: copy.plot.residual,
      color: SCIENCE_COLORS.residual,
      mode: 'lines',
      width: 1,
      dash: 'dot',
      yAxis: 'y2',
    })
    hasResidual = true
  }

  return { traces, hasResidual }
}

function buildSpectrumTraces(values: ScienceValue[], selected: ScienceValue): ScienceTrace[] {
  const spectrum = selected.kind === 'spectrum'
    ? selected
    : [...values].reverse().find((value) => value.kind === 'spectrum')

  if (!spectrum || spectrum.kind !== 'spectrum') {
    return []
  }

  return [
    seriesTrace('spectrum', values1d(spectrum.frequency), values1d(spectrum.magnitude), SCIENCE_COLORS.spectrum, 1.6),
    {
      x: spectrum.peaks.map((peak) => peak.frequency),
      y: spectrum.peaks.map((peak) => peak.magnitude),
      name: 'peaks',
      color: SCIENCE_COLORS.peak,
      mode: 'markers',
    },
  ]
}

export function ScienceApp({ language }: { language: ScienceLanguage }) {
  const copy = useMemo(() => createScienceCopy(language), [language])
  const host = useComputeHost()

  const [steps, setSteps] = useState<AnalysisStep[]>(() => createSampleWorkspace().steps)
  const [selectedId, setSelectedId] = useState('fit1')
  const [result, setResult] = useState<ComputeResult | null>(null)
  const [timings, setTimings] = useState<Record<string, number>>({})
  const [status, setStatus] = useState<RunStatus>('idle')
  const [errorText, setErrorText] = useState('')
  const [dirtyFrom, setDirtyFrom] = useState(0)
  const [runningFrom, setRunningFrom] = useState(0)
  const [autoRun, setAutoRun] = useState(true)

  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const dirtyFromRef = useRef(dirtyFrom)
  dirtyFromRef.current = dirtyFrom
  const lastStepsRef = useRef<AnalysisStep[]>([])
  const timingsRef = useRef<Record<string, number>>({})
  const sequence = useRef(0)

  const run = useCallback(async (requestedFrom = 0, reset = false) => {
    const id = (sequence.current += 1)
    const from = reset ? 0 : Math.min(requestedFrom, dirtyFromRef.current)
    setStatus('running')
    setRunningFrom(from)
    setErrorText('')

    try {
      const next = await host.run(stepsRef.current, { reset, startIndex: from })
      if (id !== sequence.current) {
        return
      }
      setResult(next)
      timingsRef.current = { ...timingsRef.current, ...next.timings }
      setTimings(timingsRef.current)
      lastStepsRef.current = stepsRef.current
      dirtyFromRef.current = stepsRef.current.length
      setDirtyFrom(stepsRef.current.length)
      setStatus('ready')
    } catch (error) {
      if (id !== sequence.current) {
        return
      }
      setStatus('error')
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }, [host])

  // 步骤变化 → 定位首个变化的下标（引用比较），标脏；自动模式则从该处防抖运行。
  useEffect(() => {
    const previous = lastStepsRef.current
    const max = Math.min(previous.length, steps.length)
    let diff = 0
    while (diff < max && previous[diff] === steps[diff]) {
      diff += 1
    }

    dirtyFromRef.current = Math.min(dirtyFromRef.current, diff)
    setDirtyFrom((current) => Math.min(current, diff))

    if (!autoRun) {
      return
    }
    const timer = setTimeout(() => {
      void run(diff, false)
    }, 180)
    return () => clearTimeout(timer)
  }, [steps, autoRun, run])

  const cancel = () => {
    sequence.current += 1
    host.terminate()
    setStatus('idle')
  }

  const reload = () => {
    lastStepsRef.current = []
    dirtyFromRef.current = 0
    timingsRef.current = {}
    setTimings({})
    setSteps(createSampleWorkspace().steps)
    setSelectedId('fit1')
  }

  const values = result?.values ?? []
  const errors = result?.errors ?? {}
  const selected = values.find((value) => value.id === selectedId) ?? values[0]

  const wave = useMemo(
    () => (selected ? buildWaveTraces(values, selected, copy) : { traces: [], hasResidual: false }),
    [values, selected, copy],
  )
  const spectrum = useMemo(
    () => (selected ? buildSpectrumTraces(values, selected) : []),
    [values, selected],
  )

  const addStep = (op: OpKind) => {
    const seriesValues = values.filter((value) => value.kind === 'series')
    const selectedSeries = selected && selected.kind === 'series' ? selected.id : undefined
    const inputId = selectedSeries ?? seriesValues[seriesValues.length - 1]?.id ?? 'signal'
    const outputId = nextStepId(steps, op)
    setSteps((previous) => [
      ...previous,
      { id: `step-${outputId}`, op, inputId, params: defaultParams(op), outputId },
    ])
    setSelectedId(outputId)
  }

  const updateStep = (next: AnalysisStep) => {
    setSteps((previous) => previous.map((step) => (step.id === next.id ? next : step)))
  }

  const removeStep = (id: string) => {
    setSteps((previous) => {
      const target = previous.find((step) => step.id === id)
      if (!target) {
        return previous
      }
      return previous
        .filter((step) => step.id !== id)
        .map((step) => (step.inputId === target.outputId ? { ...step, inputId: target.inputId } : step))
    })
  }

  const stepStatus = (index: number): StepStatus => {
    const step = steps[index]
    if (!step) {
      return 'clean'
    }
    if (errors[step.id]) {
      return 'error'
    }
    if (status === 'running' && index >= runningFrom && index < steps.length) {
      return 'running'
    }
    if (index >= dirtyFrom) {
      return 'dirty'
    }
    return 'clean'
  }

  const isDirty = dirtyFrom < steps.length
  const statusText = status === 'running'
    ? copy.running
    : status === 'error'
      ? errorText || copy.error
      : isDirty
        ? copy.dirty
        : ''

  const statusDot = status === 'running'
    ? 'bg-warning'
    : status === 'error'
      ? 'bg-error'
      : isDirty
        ? 'bg-base-content/30'
        : 'bg-success'

  return (
    <div className="grid min-h-screen grid-cols-1 bg-base-200 lg:h-screen lg:min-h-0 lg:grid-cols-[260px_minmax(0,1fr)_330px] lg:overflow-hidden">
      <WorkspacePanel
        values={values}
        selectedId={selected?.id ?? ''}
        copy={copy}
        onSelect={setSelectedId}
        onReload={reload}
      />

      <main className="flex min-w-0 flex-col gap-4 p-4 lg:h-full lg:overflow-y-auto">
        <section className="flex min-w-0 flex-col gap-2 rounded-[calc(var(--radius-box)+0.25rem)] border border-base-300 bg-base-100 p-4">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-primary" />
            <h2 className="text-sm font-semibold text-base-content">{copy.plot.timeDomain}</h2>
            <span className="font-mono text-[11px] text-base-content/45">{selected?.name ?? '—'}</span>
          </div>
          {wave.traces.length > 0 ? (
            <Plot
              traces={wave.traces}
              xTitle="time (s)"
              yTitle="amplitude"
              y2Title={wave.hasResidual ? copy.plot.residual : undefined}
              height={300}
            />
          ) : (
            <p className="p-6 text-center text-xs text-base-content/40">{copy.empty}</p>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-2 rounded-[calc(var(--radius-box)+0.25rem)] border border-base-300 bg-base-100 p-4">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-secondary" />
            <h2 className="text-sm font-semibold text-base-content">{copy.plot.frequencyDomain}</h2>
          </div>
          {spectrum.length > 0 ? (
            <Plot traces={spectrum} xTitle="frequency (Hz)" yTitle="magnitude" height={240} />
          ) : (
            <p className="p-6 text-center text-xs text-base-content/40">{copy.empty}</p>
          )}
        </section>
      </main>

      <div className="flex min-h-0 flex-col border-t border-base-300 bg-base-100 lg:h-full lg:overflow-y-auto lg:border-l lg:border-t-0">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-base-300 bg-base-100 px-4 py-2">
          <span className={`size-2 shrink-0 rounded-full ${statusDot}`} />
          <span className="min-w-0 flex-1 truncate text-[11px] text-base-content/60">{statusText}</span>
          {result ? (
            <span className="font-mono text-[10px] text-base-content/40">{`${result.elapsedMs.toFixed(0)} ms`}</span>
          ) : null}
          {status === 'running' ? (
            <button
              type="button"
              onClick={cancel}
              className="h-7 shrink-0 rounded-[var(--radius-field)] border border-base-300 px-2.5 text-[11px] font-semibold text-base-content/70 transition hover:border-error/50 hover:text-error"
            >
              {copy.cancel}
            </button>
          ) : (
            <>
              <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-base-content/55">
                <input
                  type="checkbox"
                  className="size-3 accent-[var(--color-primary)]"
                  checked={autoRun}
                  onChange={(event) => setAutoRun(event.target.checked)}
                />
                {copy.auto}
              </label>
              <button
                type="button"
                onClick={() => void run(0, false)}
                className="h-7 shrink-0 rounded-[var(--radius-field)] bg-primary px-2.5 text-[11px] font-semibold text-primary-content transition hover:opacity-90"
              >
                {copy.runAll}
              </button>
            </>
          )}
        </div>

        <AnalysisPanel
          steps={steps}
          values={values}
          errors={errors}
          timings={timings}
          copy={copy}
          running={status === 'running'}
          stepStatus={stepStatus}
          onAdd={addStep}
          onUpdate={updateStep}
          onRemove={removeStep}
          onRunStep={(index) => void run(index, false)}
        />
        <ResultsPanel value={selected} copy={copy} />
      </div>
    </div>
  )
}
