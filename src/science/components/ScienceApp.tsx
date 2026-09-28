'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScienceValue } from '../types.ts'
import type { SuperDataset } from '../../superplot/types.ts'
import { values1d } from '../lib/dense.ts'
import { seriesListFromDataset } from '../lib/import.ts'
import { readScienceDataset } from '../lib/readDataset.ts'
import { datasetKey, loadScienceWorkspace, saveScienceDatasets, saveScienceRecipe, type ScienceRecipe } from '../lib/persistence.ts'
import { SCIENCE_COLORS } from '../lib/colors.ts'
import { createScienceCopy, type ScienceLanguage } from '../lib/i18n.ts'
import { defaultParams, getOperator, nextStepId, type AnalysisStep, type OpKind } from '../lib/pipeline.ts'
import { computeDirtySteps } from '../lib/dirty.ts'
import { createSampleWorkspace } from '../lib/workspace.ts'
import { useComputeHost, type ComputeResult } from '../compute/host.ts'
import { AnalysisPanel, ResultsPanel, type StepStatus } from './AnalysisPanel.tsx'
import { Button } from '@/components/ui/button'
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

interface DatasetMapping {
  xColumn: string
  yColumns: string[]
}

/** 数据集 id 前缀，例如 `ds:scope-ch1:voltage_V` → `ds:scope-ch1:`。 */
function datasetPrefix(id: string): string {
  const secondColon = id.indexOf(':', 3)
  return secondColon < 0 ? id : id.slice(0, secondColon + 1)
}

function sanitizeMapping(dataset: SuperDataset, nextX: string, nextYs: string[]): DatasetMapping {
  let yColumns = [...new Set(nextYs)].filter((name) => name !== nextX)
  if (yColumns.length === 0) {
    yColumns = dataset.numericColumns.filter((name) => name !== nextX).slice(0, 1)
  }
  const xColumn = yColumns.length === 0 ? '' : nextX
  if (yColumns.length === 0) yColumns = dataset.numericColumns.slice(0, 1)
  return { xColumn, yColumns }
}

function buildBase(nextDatasets: SuperDataset[], nextMappings: Record<string, DatasetMapping>): ScienceValue[] {
  return nextDatasets.flatMap((dataset) => {
    const mapping = nextMappings[dataset.id]
    if (!mapping) return []
    try {
      return seriesListFromDataset(dataset, mapping.xColumn, mapping.yColumns)
    } catch {
      return []
    }
  })
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
  const [datasets, setDatasets] = useState<SuperDataset[]>([])
  const [mappings, setMappings] = useState<Record<string, DatasetMapping>>({})
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [baseRevision, setBaseRevision] = useState(0)
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

  const savedDatasetKeysRef = useRef<string | undefined>(undefined)
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const baseRef = useRef<ScienceValue[]>(initialSeed.base)
  const needsResetRef = useRef(true)
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const dirtyIdsRef = useRef(dirtyIds)
  dirtyIdsRef.current = dirtyIds
  const lastStepsRef = useRef<AnalysisStep[]>([])
  const timingsRef = useRef<Record<string, number>>({})
  const sequence = useRef(0)

  const run = useCallback(async (ids: Iterable<string>, reset = false, throughIndex?: number) => {
    const list = [...ids]
    const shouldReset = reset || needsResetRef.current
    if (list.length === 0 && !shouldReset) {
      return
    }

    const id = (sequence.current += 1)
    setStatus('running')
    setRunningIds(new Set(list))
    setErrorText('')

    try {
      needsResetRef.current = false
      const submittedSteps = throughIndex === undefined ? stepsRef.current : stepsRef.current.slice(0, throughIndex + 1)
      const next = await host.run(submittedSteps, {
        reset: shouldReset,
        base: shouldReset ? baseRef.current : undefined,
        dirtyIds: list,
      })
      if (id !== sequence.current) {
        return
      }
      setResult(next)
      timingsRef.current = { ...timingsRef.current, ...next.timings }
      setTimings(timingsRef.current)
      lastStepsRef.current = submittedSteps
      const remaining = computeDirtySteps(stepsRef.current, submittedSteps)
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
      void run(new Set([...dirtyIdsRef.current, ...dirty]), needsResetRef.current)
    }, 180)
    return () => clearTimeout(timer)
  }, [steps, baseRevision, hydrated, autoRun, run])

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
    baseRef.current = createSampleWorkspace().base
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
    setSteps(createSampleWorkspace().steps)
    setSelectedId('fit1')
    setBaseRevision((previous) => previous + 1)
  }

  /** 以「数据集列表 + 各自映射」重建 base 并触发全量重算；失效的 ds: 输入重指向首个可用变量。 */
  const replaceBase = (
    nextDatasets: SuperDataset[],
    nextMappings: Record<string, DatasetMapping>,
    options?: { resetStepsToStats?: boolean },
  ) => {
    const series = buildBase(nextDatasets, nextMappings)
    const fallbackId = series[0]?.id ?? 'signal'
    const availableIds = new Set(series.map((value) => value.id))
    sequence.current += 1
    host.terminate()
    baseRef.current = nextDatasets.length > 0 ? series : createSampleWorkspace().base
    needsResetRef.current = true
    lastStepsRef.current = []
    timingsRef.current = {}
    setTimings({})
    setDirtyIds(new Set())
    setResult(null)
    setStatus('idle')
    setDatasets(nextDatasets)
    setMappings(nextMappings)
    setSelectedId(fallbackId)
    if (options?.resetStepsToStats) {
      setSteps([{ id: 'step-stats', op: 'stats', inputId: fallbackId, params: {}, outputId: 'stats1' }])
    } else {
      setSteps((previous) => previous.map((step) => ({
        ...step,
        inputId: step.inputId.startsWith('ds:') && !availableIds.has(step.inputId) ? fallbackId : step.inputId,
        secondInputId: step.secondInputId?.startsWith('ds:') && !availableIds.has(step.secondInputId)
          ? fallbackId
          : step.secondInputId,
      })))
    }
    setBaseRevision((previous) => previous + 1)
  }

  const importFiles = async (files: File[]) => {
    if (files.length === 0) return
    setImporting(true)
    setImportError('')
    try {
      let nextDatasets = datasets
      let nextMappings = mappings
      for (const file of files) {
        const parsed = await readScienceDataset(file)
        if (parsed.numericColumns.length === 0) throw new Error(copy.noNumeric)
        // 同名文件重复导入时给 dataset.id 去重，保证变量 id 全局唯一。
        let dataset = parsed
        let suffix = 2
        while (nextDatasets.some((existing) => existing.id === dataset.id)) {
          dataset = { ...parsed, id: `${parsed.id}-${suffix}` }
          suffix += 1
        }
        nextDatasets = [...nextDatasets, dataset]
        nextMappings = {
          ...nextMappings,
          [dataset.id]: sanitizeMapping(dataset, dataset.timeColumn ?? '', dataset.numericColumns),
        }
      }
      // 首个数据集替换示例信号时重置分析栈；追加数据集则保留现有步骤。
      replaceBase(nextDatasets, nextMappings, { resetStepsToStats: datasets.length === 0 })
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    } finally {
      setImporting(false)
    }
  }

  const updateMapping = (datasetId: string, nextX: string, nextYs: string[]) => {
    const dataset = datasets.find((candidate) => candidate.id === datasetId)
    if (!dataset) return
    try {
      replaceBase(datasets, { ...mappings, [datasetId]: sanitizeMapping(dataset, nextX, nextYs) })
      setImportError('')
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  const removeDataset = (datasetId: string) => {
    const nextMappings = { ...mappings }
    delete nextMappings[datasetId]
    replaceBase(datasets.filter((candidate) => candidate.id !== datasetId), nextMappings)
  }

  useEffect(() => {
    let active = true
    void loadScienceWorkspace().then((restored) => {
      if (!active) return
      if (restored) {
        const nextMappings = Object.fromEntries(
          restored.recipe.datasets.map((entry) => [entry.datasetId, { xColumn: entry.xColumn, yColumns: entry.yColumns }]),
        )
        replaceBase(restored.datasets, nextMappings)
        setSteps(restored.recipe.steps)
        setSelectedId(restored.recipe.selectedId)
        savedDatasetKeysRef.current = restored.datasets.map(datasetKey).join('|')
      } else {
        savedDatasetKeysRef.current = ''
      }
      setHydrated(true)
    }).catch(() => {
      if (active) {
        setPersistenceError(true)
        setHydrated(true)
      }
    })
    return () => { active = false }
    // Restore once per mounted workspace; subsequent edits are saved by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const keys = datasets.map(datasetKey).join('|')
    if (savedDatasetKeysRef.current === keys) return
    savedDatasetKeysRef.current = keys
    const next = saveQueueRef.current.catch(() => undefined).then(() => saveScienceDatasets(datasets))
    saveQueueRef.current = next
    void next.catch(() => setPersistenceError(true))
  }, [datasets, hydrated])

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
    const inputId = selectedSeries ?? seriesValues[seriesValues.length - 1]?.id ?? baseRef.current[0]?.id ?? 'signal'
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
    void run(dirtyUpTo.length > 0 ? dirtyUpTo : [steps[index].id], false, index)
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
    <div className="grid min-h-[calc(100vh-var(--navbar-height))] grid-cols-1 bg-base-200 lg:h-[calc(100vh-var(--navbar-height))] lg:min-h-0 lg:grid-cols-[260px_minmax(0,1fr)_330px] lg:overflow-hidden">
      <WorkspacePanel
        values={values}
        selectedId={selected?.id ?? ''}
        copy={copy}
        onSelect={setSelectedId}
        onReload={reload}
        datasets={datasets}
        mappings={mappings}
        importing={importing}
        restoring={!hydrated}
        importError={importError}
        persistenceError={persistenceError}
        onImport={(files) => void importFiles(files)}
        onMappingChange={updateMapping}
        onRemoveDataset={removeDataset}
        onExport={() => void exportSelected()}
        canExport={Boolean(selected && status === 'ready' && !isDirty)}
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
              className="h-7 shrink-0 rounded-[var(--radius-field)] bg-muted px-2.5 text-[11px] font-semibold text-base-content/70 transition hover:bg-destructive/10 hover:text-destructive"
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
              <Button
                type="button"
                size="sm"
                disabled={!isDirty}
                onClick={() => void run(dirtyIdsRef.current, false)}
                className="h-7 shrink-0 rounded-[var(--radius-field)] px-2.5 text-[11px] font-semibold"
              >
                {copy.runAll}
              </Button>
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
          sourceNames={sourceNames}
          onAdd={addStep}
          onUpdate={updateStep}
          onRemove={removeStep}
          onRunStep={runToStep}
        />
        <ResultsPanel value={selected} copy={copy} />
      </div>
    </div>
  )
}
