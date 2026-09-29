'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Play, X, Zap } from 'lucide-react'
import type { DatasetMapping, DatasetSummary, ScienceValue, WorkspaceSource } from '../types.ts'
import { values1d } from '../lib/dense.ts'
import { sanitizeMapping } from '../lib/base.ts'
import { datasetKey, loadScienceWorkspace, saveScienceRecipe, type ScienceRecipe } from '../lib/persistence.ts'
import { SCIENCE_COLORS } from '../lib/colors.ts'
import { createScienceCopy, type ScienceLanguage } from '../lib/i18n.ts'
import { defaultParams, getOperator, nextStepId, type AnalysisStep, type OpKind } from '../lib/pipeline.ts'
import { computeDirtySteps } from '../lib/dirty.ts'
import { createSampleWorkspace } from '../lib/workspace.ts'
import { useComputeHost, type ComputeResult, type MutateOptions, type MutateResult } from '../compute/host.ts'
import { AnalysisPanel, ResultsPanel, type StepStatus } from './AnalysisPanel.tsx'
import { ImportDialog } from './ImportDialog.tsx'
import { AppNavbar } from '../../components/AppNavbar.tsx'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Plot, type AxisRange, type PlotApi, type ScienceTrace, type TraceUpdate } from './Plot.tsx'
import { PlotToolbar, type PlotCopyState } from '../../components/PlotToolbar.tsx'
import { WorkspacePanel } from './WorkspacePanel.tsx'

type RunStatus = 'idle' | 'running' | 'ready' | 'error'

type WaveMode = 'line' | 'markers' | 'line+markers'

const WAVE_MODE_PLOTLY: Record<WaveMode, 'lines' | 'markers' | 'lines+markers'> = {
  line: 'lines',
  markers: 'markers',
  'line+markers': 'lines+markers',
}

type TraceField = 'y' | 'fitted' | 'residual'

interface TraceSource {
  valueId: string
  field: TraceField
}

interface WaveBundle {
  traces: ScienceTrace[]
  sources: TraceSource[]
  hasResidual: boolean
}

/** 数据集 id 前缀，例如 `ds:scope-ch1:voltage_V` → `ds:scope-ch1:`。 */
function datasetPrefix(id: string): string {
  const secondColon = id.indexOf(':', 3)
  return secondColon < 0 ? id : id.slice(0, secondColon + 1)
}

function seriesTrace(name: string, x: ArrayLike<number>, y: ArrayLike<number>, color: string, width: number): ScienceTrace {
  return { x, y, name, color, width, mode: 'lines' }
}

function buildWaveTraces(values: ScienceValue[], selected: ScienceValue, copy: ReturnType<typeof createScienceCopy>, waveMode: WaveMode = 'line'): WaveBundle {
  const traces: ScienceTrace[] = []
  const sources: TraceSource[] = []
  const base = values.find((value) => value.id === 'signal' && value.kind === 'series')
  const seriesMode = WAVE_MODE_PLOTLY[waveMode]
  let hasResidual = false

  if (selected.kind === 'series' && selected.id.startsWith('ds:')) {
    const groupPrefix = datasetPrefix(selected.id)
    const colors = [SCIENCE_COLORS.series, '#e05252', '#38a3a5', '#a855f7', '#f2994a', '#76923c']
    values.filter((value) => value.kind === 'series' && value.id.startsWith(groupPrefix)).forEach((value, index) => {
      if (value.kind === 'series') {
        traces.push({ ...seriesTrace(value.name, values1d(value.x), values1d(value.y), colors[index % colors.length], value.id === selected.id ? 2 : 1.3), mode: seriesMode })
        sources.push({ valueId: value.id, field: 'y' })
      }
    })
    return { traces, sources, hasResidual: false }
  }

  if (base && base.kind === 'series' && selected.id !== base.id) {
    traces.push({ ...seriesTrace('signal', values1d(base.x), values1d(base.y), SCIENCE_COLORS.base, 1), mode: seriesMode })
    sources.push({ valueId: base.id, field: 'y' })
  }

  if (selected.kind === 'series') {
    traces.push({ ...seriesTrace(selected.name, values1d(selected.x), values1d(selected.y), SCIENCE_COLORS.series, 1.9), mode: seriesMode })
    sources.push({ valueId: selected.id, field: 'y' })
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
    sources.push({ valueId: selected.id, field: 'y' })
    traces.push(seriesTrace(copy.plot.fit, values1d(selected.x), values1d(selected.fitted), SCIENCE_COLORS.fit, 2))
    sources.push({ valueId: selected.id, field: 'fitted' })
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
    sources.push({ valueId: selected.id, field: 'residual' })
    hasResidual = true
  }

  return { traces, sources, hasResidual }
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

  const [initialSeed] = useState(createSampleWorkspace)
  const [steps, setSteps] = useState<AnalysisStep[]>(initialSeed.steps)
  const [selectedId, setSelectedId] = useState('fit1')
  const [result, setResult] = useState<ComputeResult | null>(null)
  const [timings, setTimings] = useState<Record<string, number>>({})
  const [status, setStatus] = useState<RunStatus>('idle')
  const [errorText, setErrorText] = useState('')
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [autoRun, setAutoRun] = useState(true)
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  const [mappings, setMappings] = useState<Record<string, DatasetMapping>>({})
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [persistenceError, setPersistenceError] = useState(false)
  const [waveCopyState, setWaveCopyState] = useState<PlotCopyState>('idle')
  const [spectrumCopyState, setSpectrumCopyState] = useState<PlotCopyState>('idle')
  const [waveMode, setWaveMode] = useState<WaveMode>('line')

  const wavePlotRef = useRef<PlotApi>(null)
  const spectrumPlotRef = useRef<PlotApi>(null)
  const waveRef = useRef<WaveBundle>({ traces: [], sources: [], hasResidual: false })
  const statusRef = useRef<RunStatus>('idle')
  const refineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastRangeKeyRef = useRef('')
  const previewSeqRef = useRef(0)

  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const needsResetRef = useRef(true)
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const dirtyIdsRef = useRef(dirtyIds)
  dirtyIdsRef.current = dirtyIds
  const lastStepsRef = useRef<AnalysisStep[]>([])
  const timingsRef = useRef<Record<string, number>>({})
  const sequence = useRef(0)

  const source: WorkspaceSource = datasets.length > 0 ? 'dataset' : 'sample'
  const sourceRef = useRef<WorkspaceSource>(source)
  sourceRef.current = source

  const mergeTimings = (next: Record<string, number>) => {
    timingsRef.current = { ...timingsRef.current, ...next }
    setTimings(timingsRef.current)
  }

  /** 运行/增量重算；reset 会重建 base（映射变化、取消后、重载后）。 */
  const run = useCallback(async (
    ids: Iterable<string>,
    options: { reset?: boolean; mappings?: Record<string, DatasetMapping>; throughIndex?: number } = {},
  ) => {
    const list = [...ids]
    const shouldReset = Boolean(options.reset) || needsResetRef.current
    if (list.length === 0 && !shouldReset) {
      return
    }

    const id = (sequence.current += 1)
    setStatus('running')
    setRunningIds(new Set(list))
    setErrorText('')

    try {
      needsResetRef.current = false
      const submitted = options.throughIndex === undefined
        ? stepsRef.current
        : stepsRef.current.slice(0, options.throughIndex + 1)
      const next = await host.run(submitted, {
        reset: shouldReset,
        source: sourceRef.current,
        mappings: options.mappings,
        dirtyIds: list,
      })
      if (id !== sequence.current) {
        return
      }
      setResult(next)
      // 对齐 Worker 的运行时真相：取消/崩溃后靠下一次运行收敛（不会读到旧数据集）。
      setDatasets(next.datasets)
      setMappings(next.mappings)
      mergeTimings(next.timings)
      lastStepsRef.current = submitted
      const remaining = computeDirtySteps(stepsRef.current, submitted)
      dirtyIdsRef.current = remaining
      setDirtyIds(remaining)
      setStatus('ready')
    } catch (error) {
      if (id !== sequence.current) {
        return
      }
      if (shouldReset) needsResetRef.current = true
      setStatus('error')
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }, [host])

  /** 采纳 import / hydrate / remove-dataset 的结果：Worker 已更新数据集与步骤。 */
  const applyMutate = useCallback((next: MutateResult) => {
    needsResetRef.current = false
    lastStepsRef.current = next.steps
    dirtyIdsRef.current = new Set()
    setDatasets(next.datasets)
    setMappings(next.mappings)
    setSteps(next.steps)
    setResult(next)
    mergeTimings(next.timings)
    setDirtyIds(new Set())
    setStatus('ready')
    setSelectedId((current) => (next.values.some((value) => value.id === current) ? current : (next.values[0]?.id ?? 'signal')))
  }, [])

  /** 带 epoch 守卫地执行 mutate：过期结果（被取消/被更晚的请求取代）不覆盖状态。 */
  const runMutate = useCallback(async (
    options: MutateOptions,
    onError?: (message: string) => void,
  ): Promise<boolean> => {
    const id = (sequence.current += 1)
    setStatus('running')
    setErrorText('')
    try {
      const next = await host.mutate(options)
      if (id !== sequence.current) {
        return false
      }
      applyMutate(next)
      return true
    } catch (error) {
      if (id !== sequence.current) {
        return false
      }
      const message = error instanceof Error ? error.message : String(error)
      if (onError) {
        onError(message)
        setStatus('idle')
      } else {
        setStatus('error')
        setErrorText(message)
      }
      return false
    }
  }, [host, applyMutate])

  // 步骤变化 → 依赖级脏传播；自动模式则防抖运行「变脏的那些步骤」。
  useEffect(() => {
    if (!hydrated) return
    const dirty = computeDirtySteps(steps, lastStepsRef.current)
    if (dirty.size > 0) {
      const merged = new Set([...dirtyIdsRef.current, ...dirty])
      dirtyIdsRef.current = merged
      setDirtyIds(merged)
    }

    if (!autoRun || (dirty.size === 0 && !needsResetRef.current)) {
      return
    }
    const timer = setTimeout(() => {
      void run(new Set([...dirtyIdsRef.current, ...dirty]), { reset: needsResetRef.current })
    }, 180)
    return () => clearTimeout(timer)
  }, [steps, hydrated, autoRun, run])

  const cancel = () => {
    sequence.current += 1
    host.terminate()
    needsResetRef.current = true
    lastStepsRef.current = []
    setDirtyIds(new Set(steps.map((step) => step.id)))
    setResult(null)
    setStatus('idle')
  }

  const reload = () => {
    sequence.current += 1
    host.terminate()
    needsResetRef.current = true
    lastStepsRef.current = []
    dirtyIdsRef.current = new Set()
    timingsRef.current = {}
    setTimings({})
    setDirtyIds(new Set())
    setResult(null)
    setDatasets([])
    setMappings({})
    setImportError('')
    setStatus('idle')
    setSelectedId('fit1')
    const sample = createSampleWorkspace()
    setSteps(sample.steps)
    void runMutate({ kind: 'reset-sample', source: 'sample', mappings: {}, steps: sample.steps })
  }

  const importFiles = async (files: File[]) => {
    if (files.length === 0) return
    setImporting(true)
    setImportError('')
    try {
      await runMutate({
        kind: 'import',
        source: 'dataset',
        mappings,
        steps: stepsRef.current,
        files,
        resetStepsToStats: datasets.length === 0,
      }, setImportError)
    } finally {
      setImporting(false)
    }
  }

  const updateMapping = (datasetId: string, nextX: string, nextYs: string[]) => {
    const summary = datasets.find((candidate) => candidate.id === datasetId)
    if (!summary) return
    const next = { ...mappings, [datasetId]: sanitizeMapping(summary, nextX, nextYs) }
    setMappings(next)
    setImportError('')
    // 映射变化不终止 Worker：把 mappings 发过去重建 base。
    void run(new Set(stepsRef.current.map((step) => step.id)), { reset: true, mappings: next })
  }

  const removeDataset = (datasetId: string) => {
    const remaining = datasets.filter((candidate) => candidate.id !== datasetId)
    void runMutate({
      kind: 'remove-dataset',
      source: remaining.length > 0 ? 'dataset' : 'sample',
      mappings,
      steps: stepsRef.current,
      datasetId,
    })
  }

  // 挂载时从 IndexedDB 恢复配方；数据集由 Worker 从 IndexedDB 水合。
  useEffect(() => {
    let active = true
    void loadScienceWorkspace().then((restored) => {
      if (!active) return
      if (!restored) {
        setHydrated(true)
        return
      }
      const nextMappings = Object.fromEntries(
        restored.recipe.datasets.map((entry) => [entry.datasetId, { xColumn: entry.xColumn, yColumns: entry.yColumns }]),
      )
      setSelectedId(restored.recipe.selectedId)
      void runMutate({
        kind: 'hydrate',
        source: restored.recipe.source,
        mappings: nextMappings,
        steps: restored.recipe.steps,
      }).then((ok) => {
        if (!active) return
        if (!ok) setPersistenceError(true)
        setHydrated(true)
      })
    }).catch(() => {
      if (active) {
        setPersistenceError(true)
        setHydrated(true)
      }
    })
    return () => { active = false }
    // 仅挂载时恢复一次；后续编辑由下面的保存 effect 处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 只保存配方（步骤/映射/选中）；数据集由 Worker 持久化。
  useEffect(() => {
    if (!hydrated) return
    const recipe: ScienceRecipe = {
      version: 2,
      source: datasets.length > 0 ? 'dataset' : 'sample',
      datasets: datasets.map((dataset) => ({
        key: datasetKey(dataset),
        datasetId: dataset.id,
        xColumn: mappings[dataset.id]?.xColumn ?? '',
        yColumns: mappings[dataset.id]?.yColumns ?? [],
      })),
      steps,
      selectedId,
    }
    const timer = setTimeout(() => {
      const next = saveQueueRef.current.catch(() => undefined).then(() => saveScienceRecipe(recipe))
      saveQueueRef.current = next
      void next.catch(() => setPersistenceError(true))
    }, 250)
    return () => clearTimeout(timer)
  }, [datasets, mappings, steps, selectedId, hydrated])

  const values = result?.values ?? []
  const errors = result?.errors ?? {}
  const selected = values.find((value) => value.id === selectedId) ?? values[0]

  const hasDatasets = datasets.length > 0
  const selectedDatasetId = selected?.kind === 'series' && selected.id.startsWith('ds:')
    ? datasetPrefix(selected.id).slice(3, -1)
    : null
  const selectedMapping = selectedDatasetId ? mappings[selectedDatasetId] : undefined

  /** valueId → 来源文件名，给分析步骤的输入下拉做 `文件名 · 列名` 前缀。 */
  const sourceNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const dataset of datasets) {
      for (const yName of mappings[dataset.id]?.yColumns ?? []) {
        names[`ds:${dataset.id}:${yName}`] = dataset.fileName
      }
    }
    return names
  }, [datasets, mappings])

  const exportSelected = async () => {
    if (!selected || status !== 'ready' || dirtyIds.size > 0) return
    try {
      const blob = await host.exportValue(selected.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${selected.name.replace(/[^\w\u4e00-\u9fff.-]+/g, '_') || 'result'}.csv`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (error) {
      setStatus('error')
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }

  const copyPlotImage = async (api: PlotApi | null, setCopyState: (state: PlotCopyState) => void) => {
    if (!api) return
    const result = await api.copyImage()
    if (result) {
      setCopyState(result === 'downloaded' ? 'downloaded' : 'copied')
    }
  }

  const wave = useMemo(
    () => (selected ? buildWaveTraces(values, selected, copy, waveMode) : { traces: [], sources: [], hasResidual: false }),
    [values, selected, copy, waveMode],
  )
  waveRef.current = wave
  statusRef.current = status
  const spectrum = useMemo(
    () => (selected ? buildSpectrumTraces(values, selected) : []),
    [values, selected],
  )

  // 视野联动：缩放后按可见范围向 Worker 要更密的降采样，restyle 就地刷新（不打断缩放）。
  const refineWave = useCallback(async (range: AxisRange | null) => {
    if (!range || statusRef.current !== 'ready') {
      return
    }
    const plan = waveRef.current
    if (plan.traces.length === 0 || plan.sources.length === 0) {
      return
    }
    const key = `${range.min.toFixed(9)}|${range.max.toFixed(9)}`
    if (key === lastRangeKeyRef.current) {
      return
    }
    lastRangeKeyRef.current = key

    const uniqueIds = [...new Set(plan.sources.map((source) => source.valueId))]
    const seq = (previewSeqRef.current += 1)
    try {
      const previews = await host.preview(uniqueIds, range)
      if (seq !== previewSeqRef.current) {
        return
      }
      const byId = new Map(previews.map((value) => [value.id, value]))
      const updates: TraceUpdate[] = []
      plan.sources.forEach((source, index) => {
        const value = byId.get(source.valueId)
        if (!value) {
          return
        }
        if (source.field === 'y' && value.kind === 'series') {
          updates.push({ index, x: values1d(value.x), y: values1d(value.y) })
        } else if (value.kind === 'fit') {
          const dense = source.field === 'fitted' ? value.fitted : source.field === 'residual' ? value.residual : value.y
          updates.push({ index, x: values1d(value.x), y: values1d(dense) })
        }
      })
      wavePlotRef.current?.restyleTraces(updates)
    } catch {
      // Worker 重启/取消等场景，放弃本次 refine，下次视野变化会重试。
    }
  }, [host])

  const handleWaveRangeChange = useCallback(() => {
    if (refineTimerRef.current) {
      clearTimeout(refineTimerRef.current)
    }
    refineTimerRef.current = setTimeout(() => {
      // 触发时刻再读当前范围：双击/按钮复位等场景下，事件捕获到的范围可能已过期。
      void refineWave(wavePlotRef.current?.getAxisRange() ?? null)
    }, 140)
  }, [refineWave])
  const spectrumValue = selected?.kind === 'spectrum'
    ? selected
    : [...values].reverse().find((value) => value.kind === 'spectrum')
  // 只有分析栈里配了产出频谱的步骤时才显示频域区块，否则整块隐藏。
  const hasSpectrumStep = steps.some((step) => getOperator(step.op)?.output === 'spectrum')

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

  const runToStep = (index: number) => {
    const upto = steps.slice(0, index + 1)
    const dirtyUpTo = upto.filter((step) => dirtyIdsRef.current.has(step.id)).map((step) => step.id)
    void run(dirtyUpTo.length > 0 ? dirtyUpTo : [steps[index].id], { throughIndex: index })
  }

  const stepStatus = (index: number): StepStatus => {
    const step = steps[index]
    if (!step) {
      return 'clean'
    }
    if (errors[step.id]) {
      return 'error'
    }
    if (status === 'running' && runningIds.has(step.id)) {
      return 'running'
    }
    if (dirtyIds.has(step.id)) {
      return 'dirty'
    }
    return 'clean'
  }

  const isDirty = dirtyIds.size > 0 || result === null
  const canExport = Boolean(selected && status === 'ready' && !isDirty)
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

  const toolbar = (
    <div className="flex items-center gap-2.5">
      {/* 文件区 */}
      <div className="flex items-center gap-1">
        <ImportDialog
          compact
          copy={copy}
          importing={importing}
          restoring={!hydrated}
          onImport={(files) => void importFiles(files)}
          onLoadSample={reload}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!canExport}
                onClick={() => void exportSelected()}
                aria-label={copy.exportCsv}
                className="size-7 shrink-0 rounded-[calc(var(--radius-field)-2px)] text-base-content/60 hover:bg-base-content/10 hover:text-base-content"
              >
                <Download size={15} strokeWidth={2.2} />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{copy.exportCsv}</TooltipContent>
        </Tooltip>
      </div>

      <span className="h-5 w-px shrink-0 bg-base-300" aria-hidden="true" />

      {/* 运行区 */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-pressed={autoRun}
                onClick={() => setAutoRun((value) => !value)}
                aria-label={copy.auto}
                className={`size-7 shrink-0 rounded-[calc(var(--radius-field)-2px)] ${
                  autoRun
                    ? 'bg-primary/10 text-primary hover:bg-primary/15'
                    : 'text-base-content/50 hover:bg-base-content/10 hover:text-base-content'
                }`}
              >
                <Zap size={15} strokeWidth={2.2} />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{copy.auto}</TooltipContent>
        </Tooltip>

        {status === 'running' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={cancel}
                  aria-label={copy.cancel}
                  className="size-7 shrink-0 rounded-[calc(var(--radius-field)-2px)] text-base-content/60 hover:bg-destructive/10 hover:text-destructive"
                >
                  <X size={15} strokeWidth={2.2} />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{copy.cancel}</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0">
                <Button
                  type="button"
                  size="icon-sm"
                  disabled={!isDirty}
                  onClick={() => void run(dirtyIdsRef.current, {})}
                  aria-label={copy.runAll}
                  className="size-7 shrink-0 rounded-[calc(var(--radius-field)-2px)] shadow-none"
                >
                  <Play size={14} strokeWidth={2.5} />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{copy.runAll}</TooltipContent>
          </Tooltip>
        )}
      </div>

      <span className="h-5 w-px shrink-0 bg-base-300" aria-hidden="true" />

      {/* 状态区 */}
      <span className="inline-flex shrink-0 items-center gap-1.5 px-0.5 text-[11px] font-medium text-base-content/60">
        <span className={`size-1.5 shrink-0 rounded-full ${statusDot}`} />
        {statusText ? <span className="hidden max-w-40 truncate sm:inline">{statusText}</span> : null}
        {result ? (
          <span className="hidden shrink-0 font-mono text-[10px] text-base-content/40 md:inline">{`${result.elapsedMs.toFixed(0)} ms`}</span>
        ) : null}
      </span>
    </div>
  )

  return (
    <div className="grid h-full grid-rows-[var(--navbar-height)_minmax(0,1fr)] bg-base-200">
      <AppNavbar section="science" showNav={false} toolbar={toolbar} />

      <div className="grid min-h-0 min-w-0 grid-cols-1 overflow-y-auto lg:grid-cols-[260px_minmax(0,1fr)_330px] lg:overflow-hidden">
        <WorkspacePanel
          values={values}
          selectedId={selected?.id ?? ''}
          copy={copy}
          onSelect={setSelectedId}
          datasets={datasets}
          mappings={mappings}
          importError={importError}
          persistenceError={persistenceError}
          onMappingChange={updateMapping}
          onRemoveDataset={removeDataset}
        />

        <main className="flex min-w-0 flex-col gap-4 p-4 lg:h-full lg:overflow-y-auto">
        <section className="flex min-w-0 flex-col gap-2 rounded-[calc(var(--radius-box)+0.25rem)] bg-base-100 p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-primary" />
            <h2 className="text-sm font-semibold text-base-content">{hasDatasets ? copy.plot.dataDomain : copy.plot.timeDomain}</h2>
            <span className="font-mono text-[11px] text-base-content/45">{selected?.name ?? '—'}</span>
            {selected?.kind === 'series' && (
              <span className="ml-auto inline-flex rounded-[var(--radius-field)] bg-muted p-0.5">
                {(['line', 'markers', 'line+markers'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={waveMode === mode}
                    className={`h-6 rounded-[calc(var(--radius-field)-2px)] px-2 text-[11px] font-medium transition ${
                      waveMode === mode ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/55 hover:text-base-content'
                    }`}
                    onClick={() => setWaveMode(mode)}
                  >
                    {mode === 'line' ? copy.waveModeLine : mode === 'markers' ? copy.waveModeMarkers : copy.waveModeBoth}
                  </button>
                ))}
              </span>
            )}
            {wave.traces.length > 0 && (
              <span className={selected?.kind === 'series' ? '' : 'ml-auto'}>
                <PlotToolbar
                  copyState={waveCopyState}
                  onAutorange={() => void wavePlotRef.current?.autorange()}
                  onCopyImage={() => void copyPlotImage(wavePlotRef.current, setWaveCopyState)}
                  onDownloadImage={() => void wavePlotRef.current?.downloadImage()}
                />
              </span>
            )}
          </div>
          {wave.traces.length > 0 ? (
            <Plot
              ref={wavePlotRef}
              traces={wave.traces}
              exportTitle={selected?.name ?? 'wave'}
              xTitle={selectedMapping ? (selectedMapping.xColumn || copy.rowIndex) : hasDatasets ? copy.rowIndex : 'time (s)'}
              yTitle={hasDatasets ? (selected?.name ?? copy.plot.data) : 'amplitude'}
              y2Title={wave.hasResidual ? copy.plot.residual : undefined}
              height={300}
              onRangeChange={handleWaveRangeChange}
            />
          ) : (
            <p className="p-6 text-center text-xs text-base-content/40">{copy.empty}</p>
          )}
        </section>

        {hasSpectrumStep ? (
          <section className="flex min-w-0 flex-col gap-2 rounded-[calc(var(--radius-box)+0.25rem)] bg-base-100 p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-secondary" />
              <h2 className="text-sm font-semibold text-base-content">{copy.plot.frequencyDomain}</h2>
              {spectrum.length > 0 && (
                <span className="ml-auto">
                  <PlotToolbar
                    copyState={spectrumCopyState}
                    onAutorange={() => void spectrumPlotRef.current?.autorange()}
                    onCopyImage={() => void copyPlotImage(spectrumPlotRef.current, setSpectrumCopyState)}
                    onDownloadImage={() => void spectrumPlotRef.current?.downloadImage()}
                  />
                </span>
              )}
            </div>
            {spectrum.length > 0 ? (
              <Plot
                ref={spectrumPlotRef}
                traces={spectrum}
                exportTitle="spectrum"
                xTitle={`frequency (${spectrumValue?.kind === 'spectrum' ? spectrumValue.frequencyUnit ?? 'Hz' : 'Hz'})`}
                yTitle="magnitude"
                height={240}
              />
            ) : (
              <p className="p-6 text-center text-xs text-base-content/40">{copy.empty}</p>
            )}
          </section>
        ) : null}
      </main>

      <div className="flex min-h-0 flex-col border-t border-base-300 bg-base-100 lg:h-full lg:overflow-y-auto lg:border-l lg:border-t-0">
        <AnalysisPanel
          steps={steps}
          values={values}
          errors={errors}
          timings={timings}
          copy={copy}
          running={status === 'running'}
          stepStatus={stepStatus}
          sourceNames={sourceNames}
          onAdd={addStep}
          onUpdate={updateStep}
          onRemove={removeStep}
          onRunStep={runToStep}
        />
        <ResultsPanel value={selected} copy={copy} />
      </div>
      </div>
    </div>
  )
}
