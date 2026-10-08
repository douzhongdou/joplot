'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleHelp, Download, Play, Table2, UploadCloud, X } from 'lucide-react'
import type { DatasetMapping, DatasetSummary, ScienceValue, SpectrumValue, WorkspaceSource } from '../types.ts'
import { values1d } from '../lib/dense.ts'
import { resolveValue, vectorField, vectorParentId, type VectorField } from '../lib/vectors.ts'
import { reconcileSteps, sanitizeMapping } from '../lib/base.ts'
import { datasetKey, loadScienceWorkspace, saveScienceRecipe, type ScienceRecipe } from '../lib/persistence.ts'
import { SCIENCE_COLORS } from '../lib/colors.ts'
import { createScienceCopy, type ScienceLanguage } from '../lib/i18n.ts'
import { spectrumReference, toRelativeDb } from '../lib/spectrumDisplay.ts'
import { getOperator, insertAnalysisStep, type AnalysisStep, type OpKind, type StepInsertPosition } from '../lib/pipeline.ts'
import { computeDirtySteps } from '../lib/dirty.ts'
import { forgetSentEvictions, novelEvictions, selectionAfterRemoval, snapshotStillCurrent } from '../lib/coordination.ts'
import { createSampleWorkspace } from '../lib/workspace.ts'
import { useComputeHost, type ComputeResult, type MutateOptions, type MutateResult } from '../compute/host.ts'
import { AnalysisPanel, type StepStatus } from './AnalysisPanel.tsx'
import { ImportDialog } from './ImportDialog.tsx'
import { AppNavbar } from '../../components/AppNavbar.tsx'
import { Button } from '@joplot/ui/button'
import { DropdownMenuItem } from '@joplot/ui/dropdown-menu'
import { Switch } from '@joplot/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@joplot/ui/tooltip'
import { Plot, type AxisRange, type PlotApi, type ScienceTrace, type TraceUpdate } from './Plot.tsx'
import { PlotToolbar, type PlotCopyState } from '../../components/PlotToolbar.tsx'
import { WorkspacePanel } from './WorkspacePanel.tsx'
import { DataTable, type DataTableSource } from './DataTable.tsx'

type RunStatus = 'idle' | 'running' | 'ready' | 'error'

type WaveMode = 'line' | 'markers' | 'line+markers'
type SpectrumScale = 'db' | 'linear'
type FrequencyScale = 'log' | 'linear'

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

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false
    }
  }
  return true
}

function seriesTrace(name: string, x: ArrayLike<number>, y: ArrayLike<number>, color: string, width: number): ScienceTrace {
  return { x, y, name, color, width, mode: 'lines' }
}

function buildWaveTraces(values: ScienceValue[], selected: ScienceValue, copy: ReturnType<typeof createScienceCopy>, waveMode: WaveMode = 'line', input?: ScienceValue): WaveBundle {
  const traces: ScienceTrace[] = []
  const sources: TraceSource[] = []
  const base = values.find((value) => value.id === 'signal' && value.kind === 'series')
  const seriesMode = WAVE_MODE_PLOTLY[waveMode]
  let hasResidual = false

  if (selected.kind === 'series' && selected.id.startsWith('ds:') && vectorParentId(selected.id) === selected.id) {
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

  if (base && base.kind === 'series' && selected.id !== base.id && vectorParentId(selected.id) === selected.id) {
    traces.push({ ...seriesTrace('signal', values1d(base.x), values1d(base.y), SCIENCE_COLORS.base, 1), mode: seriesMode })
    sources.push({ valueId: base.id, field: 'y' })
  }

  if (selected.kind === 'series') {
    traces.push({ ...seriesTrace(selected.name, values1d(selected.x), values1d(selected.y), SCIENCE_COLORS.series, 1.9), mode: seriesMode })
    sources.push({ valueId: selected.id, field: 'y' })
  }

  // 频谱/统计等派生值没有自身波形：显示其输入曲线，避免选中 FFT 后上图被清空。
  if ((selected.kind === 'spectrum' || selected.kind === 'stats') && input?.kind === 'series' && (!base || input.id !== base.id)) {
    traces.push({ ...seriesTrace(input.name, values1d(input.x), values1d(input.y), SCIENCE_COLORS.series, 1.9), mode: seriesMode })
    sources.push({ valueId: input.id, field: 'y' })
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

/** 频谱区要画哪个频谱、以及是否只画它的某一个字段。 */
interface SpectrumTarget {
  spectrum: SpectrumValue
  /** null 表示选中的是频谱本身（幅度挂主轴、相位挂副轴）；否则只画该字段。 */
  field: VectorField | null
}

/**
 * 变量树里的 `fft1::phase` 是投影出来的 series，直接当普通 series 处理会把频域数据
 * 画到时域图上。这里把它还原成所属频谱 + 字段，交给频谱图去响应。
 */
function resolveSpectrumTarget(values: ScienceValue[], selected: ScienceValue | undefined): SpectrumTarget | null {
  if (!selected) {
    return null
  }

  if (selected.kind === 'spectrum') {
    return { spectrum: selected, field: null }
  }

  const parentId = vectorParentId(selected.id)
  if (parentId === selected.id) {
    return null
  }

  const parent = values.find((value) => value.id === parentId)
  return parent && parent.kind === 'spectrum'
    ? { spectrum: parent, field: vectorField(selected.id) }
    : null
}

function buildSpectrumTraces(target: SpectrumTarget, copy: ReturnType<typeof createScienceCopy>, scale: SpectrumScale): ScienceTrace[] {
  const { spectrum, field } = target
  const frequency = values1d(spectrum.frequency)

  // 单独看相位时把它升到主轴，否则相位会被幅度的量纲压成一条贴底的直线。
  if (field === 'phase') {
    return spectrum.phase
      ? [seriesTrace(copy.plot.phase, frequency, values1d(spectrum.phase), SCIENCE_COLORS.residual, 1.6)]
      : []
  }

  const magnitude = values1d(spectrum.magnitude)
  const reference = spectrumReference(magnitude)
  const displayMagnitude = scale === 'db' ? toRelativeDb(magnitude, reference) : magnitude
  const traces: ScienceTrace[] = [
    seriesTrace(scale === 'db' ? copy.plot.magnitudeDb : copy.plot.magnitude, frequency, displayMagnitude, SCIENCE_COLORS.spectrum, 1.6),
  ]

  // 选中频谱本身时相位仍挂在副轴；显式选中 magnitude 字段则只留幅度。
  if (!field && spectrum.phase) {
    traces.push({
      ...seriesTrace(copy.plot.phase, frequency, values1d(spectrum.phase), SCIENCE_COLORS.residual, 1.2),
      yAxis: 'y2' as const,
    })
  }

  return traces
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
  /** 待从 Worker 缓存驱逐的产出 id（被删除的步骤）。 */
  const [evictIds, setEvictIds] = useState<Set<string>>(new Set())
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [autoRun, setAutoRun] = useState(true)
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  const [mappings, setMappings] = useState<Record<string, DatasetMapping>>({})
  const [importing, setImporting] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  /** 主区域视图：图表（绘图）或表格（数据表）。 */
  const [view, setView] = useState<'plot' | 'table'>('plot')
  /** 表格视图锁定的数据集 id（点数据集的表格按钮时指定）；null 表格跟随左侧选中的结果变量。 */
  const [tableDatasetId, setTableDatasetId] = useState<string | null>(null)
  const [importError, setImportError] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [persistenceError, setPersistenceError] = useState(false)
  const [waveCopyState, setWaveCopyState] = useState<PlotCopyState>('idle')
  const [spectrumCopyState, setSpectrumCopyState] = useState<PlotCopyState>('idle')
  const [waveMode, setWaveMode] = useState<WaveMode>('line')
  /** 整页拖放状态：dragenter/leave 会随子元素冒泡，用计数器判断是否真的离开窗口。 */
  const [dragActive, setDragActive] = useState(false)
  const dragDepthRef = useRef(0)
  const [spectrumScale, setSpectrumScale] = useState<SpectrumScale>('db')
  const [frequencyScale, setFrequencyScale] = useState<FrequencyScale>('log')

  const wavePlotRef = useRef<PlotApi>(null)
  const spectrumPlotRef = useRef<PlotApi>(null)
  const waveRef = useRef<WaveBundle>({ traces: [], sources: [], hasResidual: false })
  const statusRef = useRef<RunStatus>('idle')
  const refineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastRangeKeyRef = useRef('')
  const previewSeqRef = useRef(0)
  const spectrumRefineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spectrumPreviewSeqRef = useRef(0)
  const lastSpectrumRangeKeyRef = useRef('')

  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const needsResetRef = useRef(true)
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const dirtyIdsRef = useRef(dirtyIds)
  dirtyIdsRef.current = dirtyIds
  const evictIdsRef = useRef(evictIds)
  evictIdsRef.current = evictIds
  const mappingsRef = useRef(mappings)
  mappingsRef.current = mappings
  const datasetsRef = useRef(datasets)
  datasetsRef.current = datasets
  /** 同步导入标志：供 effect / run 立即判定，不依赖 React state 的提交时机。 */
  const importingRef = useRef(false)
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
    options: { reset?: boolean; mappings?: Record<string, DatasetMapping>; throughIndex?: number; evictIds?: string[] } = {},
  ) => {
    // 导入期间不新发 run：运行需求由导入结束后的重算吸收，避免与导入请求交错。
    if (importingRef.current) {
      return
    }
    const list = [...ids]
    const evict = options.evictIds ?? []
    const shouldReset = Boolean(options.reset) || needsResetRef.current
    // 纯删除时 dirty 为空，但仍有缓存需驱逐、结果需刷新，因此不能早退。
    if (list.length === 0 && !shouldReset && evict.length === 0) {
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
        evictIds: evict,
      })
      if (id !== sequence.current) {
        return
      }
      // 对齐 Worker 的运行时真相：取消/崩溃后靠下一次运行收敛（不会读到旧数据集）。
      setDatasets(next.datasets)
      setMappings(next.mappings)
      mergeTimings(next.timings)
      lastStepsRef.current = submitted

      // 只清除本次请求实际发送过的驱逐项；期间新登记的驱逐必须保留，否则会永久丢失。
      const remainingEvict = forgetSentEvictions(evictIdsRef.current, evict)
      if (!sameSet(remainingEvict, evictIdsRef.current)) {
        evictIdsRef.current = remainingEvict
        setEvictIds(remainingEvict)
      }

      // 旧步骤快照的响应不得覆盖当前步骤（例如响应在途时删除了末步），否则幽灵产出会复活。
      if (snapshotStillCurrent(submitted, stepsRef.current)) {
        setResult(next)
        setSelectedId((current) => (next.values.some((value) => value.id === current) ? current : (next.values[0]?.id ?? 'signal')))
      }

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

  /**
   * 采纳 import / hydrate / remove-dataset 的结果。
   * `forSteps` 是请求发出时的步骤快照：
   * - 步骤未变：直接采纳 Worker 的步骤与结果；
   * - 步骤已变（导入期间被编辑）：只采纳数据集，保留当前步骤并按新 base 重映射，
   *   随后交给脏传播重算，避免出现「新步骤配旧结果」。
   */
  const applyMutate = useCallback((next: MutateResult, forSteps: AnalysisStep[]) => {
    needsResetRef.current = false
    // mutate 会清空 Worker 缓存，因此此前累积的待驱逐项一并作废。
    evictIdsRef.current = new Set()
    setEvictIds(evictIdsRef.current)
    setDatasets(next.datasets)
    setMappings(next.mappings)
    mergeTimings(next.timings)

    if (stepsRef.current === forSteps) {
      lastStepsRef.current = next.steps
      dirtyIdsRef.current = new Set()
      setSteps(next.steps)
      setResult(next)
      setDirtyIds(new Set())
      setStatus('ready')
      setSelectedId((current) => (next.values.some((value) => value.id === current) ? current : (next.values[0]?.id ?? 'signal')))
      return
    }

    // 步骤已变：保留当前步骤，按新 base 重映射后交给脏传播重算。
    const remapped = reconcileSteps(next.values, next.steps, stepsRef.current)
    lastStepsRef.current = []
    dirtyIdsRef.current = new Set(remapped.map((step) => step.id))
    setSteps(remapped)
    setDirtyIds(dirtyIdsRef.current)
    setResult(null)
    setStatus('idle')
  }, [])

  /** 带 epoch 守卫地发出 mutate：过期结果（被取消/被更晚的请求取代）返回 null，不覆盖状态。 */
  const requestMutate = useCallback(async (
    options: MutateOptions,
    onError?: (message: string) => void,
  ): Promise<MutateResult | null> => {
    const id = (sequence.current += 1)
    setStatus('running')
    setErrorText('')
    try {
      const next = await host.mutate(options)
      if (id !== sequence.current) {
        return null
      }
      return next
    } catch (error) {
      if (id !== sequence.current) {
        return null
      }
      const message = error instanceof Error ? error.message : String(error)
      if (onError) {
        onError(message)
        setStatus('idle')
      } else {
        setStatus('error')
        setErrorText(message)
      }
      return null
    }
  }, [host])

  const runMutate = useCallback(async (
    options: MutateOptions,
    onError?: (message: string) => void,
  ): Promise<boolean> => {
    const next = await requestMutate(options, onError)
    if (!next) {
      return false
    }
    applyMutate(next, options.steps)
    return true
  }, [requestMutate, applyMutate])

  // 步骤变化 → 依赖级脏传播；自动模式则防抖运行「变脏的那些步骤」。
  useEffect(() => {
    if (!hydrated) return

    // 1) 脏步骤：只保留仍存在的步骤 id，避免删除后残留。
    const dirty = computeDirtySteps(steps, lastStepsRef.current)
    const live = new Set(steps.map((step) => step.id))
    const mergedDirty = new Set<string>()
    for (const id of dirtyIdsRef.current) {
      if (live.has(id)) mergedDirty.add(id)
    }
    for (const id of dirty) mergedDirty.add(id)
    if (!sameSet(mergedDirty, dirtyIdsRef.current)) {
      dirtyIdsRef.current = mergedDirty
      setDirtyIds(mergedDirty)
    }

    // 2) 删除步骤产生的产出：登记为待驱逐，并**立即**发独立 evict 消息——
    //    即使 autoRun 关闭、或旧 run 仍在途，Worker 缓存也不能再留幽灵产出。
    const novel = novelEvictions(lastStepsRef.current, steps, evictIdsRef.current)
    if (novel.length > 0) {
      const mergedEvict = new Set([...evictIdsRef.current, ...novel])
      evictIdsRef.current = mergedEvict
      setEvictIds(mergedEvict)
      void host.evict(novel).catch(() => undefined)
    }

    // 导入期间不新发 run：运行需求会在导入结束（importing 翻转）后重新评估并合并成一次重算。
    if (importingRef.current) {
      return
    }

    const hasEvictions = evictIdsRef.current.size > 0
    if (!autoRun || (mergedDirty.size === 0 && !hasEvictions && !needsResetRef.current)) {
      return
    }
    const timer = setTimeout(() => {
      // 纯删除时 mergedDirty 可能为空，但 evictIds 非空，run 仍会刷新结果并驱逐缓存。
      void run(new Set(mergedDirty), {
        reset: needsResetRef.current,
        evictIds: [...evictIdsRef.current],
      })
    }, 180)
    return () => clearTimeout(timer)
  }, [steps, hydrated, autoRun, importing, run, host])

  const cancel = () => {
    sequence.current += 1
    host.terminate()
    needsResetRef.current = true
    lastStepsRef.current = []
    evictIdsRef.current = new Set()
    setEvictIds(evictIdsRef.current)
    setDirtyIds(new Set(steps.map((step) => step.id)))
    setResult(null)
    setStatus('idle')
  }

  const reload = () => {
    if (importingRef.current) return
    sequence.current += 1
    host.terminate()
    needsResetRef.current = true
    lastStepsRef.current = []
    dirtyIdsRef.current = new Set()
    evictIdsRef.current = new Set()
    setEvictIds(evictIdsRef.current)
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

  /** 整页拖放：只看文件拖拽，忽略了拖拽文字/元素的情况。 */
  const EVENT_HAS_FILES = (event: { dataTransfer?: DataTransfer | null }) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')

  const handlePageDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!EVENT_HAS_FILES(event)) return
    event.preventDefault()
    dragDepthRef.current += 1
    setDragActive(true)
  }

  const handlePageDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!EVENT_HAS_FILES(event)) return
    // 必须 preventDefault，否则浏览器会用自己的方式打开文件。
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  const handlePageDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!EVENT_HAS_FILES(event)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragActive(false)
  }

  const handlePageDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!EVENT_HAS_FILES(event)) return
    event.preventDefault()
    dragDepthRef.current = 0
    setDragActive(false)
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length > 0) void importFiles(files)
  }

  const importFiles = async (files: File[]) => {
    if (files.length === 0) return
    importingRef.current = true
    setImporting(true)
    setImportError('')
    const stepsAtStart = stepsRef.current
    try {
      const imported = await requestMutate({
        kind: 'import',
        source: 'dataset',
        mappings: mappingsRef.current,
        steps: stepsAtStart,
        files,
        // 「首次导入重置为统计步骤」只在导入期间没有步骤编辑时才成立。
        resetStepsToStats: datasetsRef.current.length === 0,
      }, setImportError)
      if (!imported) return

      if (stepsRef.current === stepsAtStart) {
        applyMutate(imported, stepsAtStart)
        return
      }

      // 步骤在导入期间被改动：只采纳数据集，用当前步骤在新 base 上重映射并重算。
      setDatasets(imported.datasets)
      setMappings(imported.mappings)
      const snapshot = stepsRef.current
      const recomputed = await requestMutate({
        kind: 'hydrate',
        source: imported.datasets.length > 0 ? 'dataset' : 'sample',
        mappings: imported.mappings,
        steps: snapshot,
      })
      if (recomputed) {
        applyMutate(recomputed, snapshot)
      }
    } finally {
      importingRef.current = false
      setImporting(false)
    }
  }

  const updateMapping = (datasetId: string, nextX: string, nextYs: string[], nextGroup = '') => {
    if (importingRef.current) return
    const summary = datasets.find((candidate) => candidate.id === datasetId)
    if (!summary) return
    const next = { ...mappings, [datasetId]: sanitizeMapping(summary, nextX, nextYs, nextGroup) }
    setMappings(next)
    setImportError('')
    // 映射变化不终止 Worker：把 mappings 发过去重建 base。
    void run(new Set(stepsRef.current.map((step) => step.id)), { reset: true, mappings: next })
  }

  const removeDataset = (datasetId: string) => {
    if (importingRef.current) return
    const remaining = datasets.filter((candidate) => candidate.id !== datasetId)
    void runMutate({
      kind: 'remove-dataset',
      source: remaining.length > 0 ? 'dataset' : 'sample',
      mappings,
      steps: stepsRef.current,
      datasetId,
    })
  }

  /** 左侧选中变量：表格视图随即跟随新的选择。 */
  const handleSelectValue = (id: string) => {
    setSelectedId(id)
    setTableDatasetId(null)
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
        restored.recipe.datasets.map((entry) => [entry.datasetId, entry.groupColumn
          ? { xColumn: entry.xColumn, yColumns: entry.yColumns, groupColumn: entry.groupColumn }
          : { xColumn: entry.xColumn, yColumns: entry.yColumns }]),
      )
      setSelectedId(restored.recipe.selectedId)
      // 先落步骤，使 mutate 结果按「步骤未变」路径原子采纳。
      setSteps(restored.recipe.steps)
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
        ...(mappings[dataset.id]?.groupColumn ? { groupColumn: mappings[dataset.id]!.groupColumn } : {}),
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
  const selected = resolveValue(values, selectedId) ?? values[0]

  const hasDatasets = datasets.length > 0
  /** 表格视图的数据源：锁定的数据集优先，否则展示当前选中结果（数据集已删除则回退）。 */
  const lockedDataset = tableDatasetId
    ? datasets.find((candidate) => candidate.id === tableDatasetId)
    : undefined
  const tableSource: DataTableSource | null = lockedDataset
    ? { kind: 'dataset', dataset: lockedDataset }
    : selected
      ? { kind: 'value', value: selected }
      : null

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

  /** 表格锁定在某个原始数据集时，导出该数据集的完整 CSV（表格本身不放导出按钮）。 */
  const exportRawDataset = async () => {
    if (!lockedDataset) return
    try {
      const blob = await host.exportDataset(lockedDataset.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const base = lockedDataset.fileName.replace(/\.(csv|tsv|txt|xlsx|xls)$/i, '').replace(/[\\/:*?"<>|]/g, '_')
      link.download = `${base || 'data'}.csv`
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

  /** 变量树里选中的可能是频谱字段（fft1::phase），先还原成它所属的频谱。 */
  const spectrumTarget = useMemo(() => resolveSpectrumTarget(values, selected), [values, selected])

  /**
   * 波形区一律按「选中该频谱」处理：点 `fft1::phase` 时上面显示 FFT 的输入时域信号，
   * 而不是把频域数据画到时域图上。
   */
  const waveSelected = useMemo(
    () => (spectrumTarget ? spectrumTarget.spectrum : selected),
    [spectrumTarget, selected],
  )

  /** 选中频谱/统计等派生值时，波形区回退到该步骤的输入曲线。 */
  const selectedInput = useMemo(() => {
    if (!waveSelected || (waveSelected.kind !== 'spectrum' && waveSelected.kind !== 'stats')) {
      return undefined
    }
    const step = steps.find((candidate) => candidate.outputId === waveSelected.id)
    if (!step) {
      return undefined
    }
    const input = resolveValue(values, step.inputId)
    return input?.kind === 'series' ? input : undefined
  }, [waveSelected, steps, values])

  /** 波形区实际展示的 series：派生值回退到输入曲线，轴标题跟随它。 */
  const waveSource = selectedInput ?? (waveSelected?.kind === 'series' ? waveSelected : undefined)
  const selectedDatasetId = waveSource?.id.startsWith('ds:')
    ? datasetPrefix(waveSource.id).slice(3, -1)
    : null
  const selectedMapping = selectedDatasetId ? mappings[selectedDatasetId] : undefined

  const wave = useMemo(
    () => (waveSelected ? buildWaveTraces(values, waveSelected, copy, waveMode, selectedInput) : { traces: [], sources: [], hasResidual: false }),
    [values, waveSelected, copy, waveMode, selectedInput],
  )
  waveRef.current = wave
  statusRef.current = status

  /** 频谱区展示的频谱：选中的就是它，否则回退到最后一个频谱产出。 */
  const spectrumValue = spectrumTarget?.spectrum ?? [...values].reverse().find((value) => value.kind === 'spectrum')
  const spectrumField = spectrumTarget?.field ?? null
  const spectrum = useMemo(
    () => (spectrumValue?.kind === 'spectrum'
      ? buildSpectrumTraces({ spectrum: spectrumValue, field: spectrumField }, copy, spectrumScale)
      : []),
    [spectrumValue, spectrumField, copy, spectrumScale],
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
  const spectrumReferenceValue = spectrumValue?.kind === 'spectrum'
    ? spectrumReference(values1d(spectrumValue.magnitude))
    : 1

  useEffect(() => {
    spectrumPreviewSeqRef.current += 1
    lastSpectrumRangeKeyRef.current = ''
    if (spectrumRefineTimerRef.current) clearTimeout(spectrumRefineTimerRef.current)
  }, [spectrumValue, spectrumField, spectrumScale, frequencyScale])

  const refineSpectrum = useCallback(async (range: AxisRange | null) => {
    if (!range || statusRef.current !== 'ready' || spectrumValue?.kind !== 'spectrum') return
    const key = `${spectrumValue.id}|${spectrumField}|${spectrumScale}|${frequencyScale}|${spectrumReferenceValue}|${range.min.toPrecision(12)}|${range.max.toPrecision(12)}`
    if (key === lastSpectrumRangeKeyRef.current) return
    lastSpectrumRangeKeyRef.current = key
    const seq = ++spectrumPreviewSeqRef.current
    try {
      const [preview] = await host.preview([spectrumValue.id], range)
      if (seq !== spectrumPreviewSeqRef.current || preview?.kind !== 'spectrum') return
      const x = values1d(preview.frequency)
      const updates: TraceUpdate[] = []

      if (spectrumField === 'phase') {
        // 单独看相位时它是主轴上的唯一一条 trace。
        if (preview.phase) updates.push({ index: 0, x, y: values1d(preview.phase) })
      } else {
        const magnitude = values1d(preview.magnitude)
        updates.push({
          index: 0,
          x,
          y: spectrumScale === 'db' ? toRelativeDb(magnitude, spectrumReferenceValue) : magnitude,
        })
        // 副轴相位只在「选中频谱本身」时才画，索引必须紧跟在幅度之后。
        if (!spectrumField && preview.phase) updates.push({ index: 1, x, y: values1d(preview.phase) })
      }

      spectrumPlotRef.current?.restyleTraces(updates)
    } catch {
      lastSpectrumRangeKeyRef.current = ''
    }
  }, [host, spectrumValue, spectrumField, spectrumScale, frequencyScale, spectrumReferenceValue])

  const handleSpectrumRangeChange = useCallback(() => {
    if (spectrumRefineTimerRef.current) clearTimeout(spectrumRefineTimerRef.current)
    spectrumRefineTimerRef.current = setTimeout(() => {
      void refineSpectrum(spectrumPlotRef.current?.getAxisRange() ?? null)
    }, 140)
  }, [refineSpectrum])
  // 只有分析栈里配了产出频谱的步骤时才显示频域区块，否则整块隐藏。
  const hasSpectrumStep = steps.some((step) => getOperator(step.op)?.output === 'spectrum')

  const addStep = (op: OpKind, position: StepInsertPosition) => {
    const seriesValues = values.filter((value) => value.kind === 'series')
    const selectedSeries = selected && selected.kind === 'series' ? selected.id : undefined
    const inputId = selectedSeries ?? seriesValues[seriesValues.length - 1]?.id ?? 'signal'
    const next = insertAnalysisStep(stepsRef.current, op, position, inputId)
    if (!next) return
    stepsRef.current = next.steps
    setSteps(next.steps)
    setSelectedId(next.inserted.outputId)
  }

  const updateStep = (next: AnalysisStep) => {
    setSteps((previous) => previous.map((step) => (step.id === next.id ? next : step)))
  }

  const removeStep = (id: string) => {
    const target = stepsRef.current.find((step) => step.id === id)
    if (!target) {
      return
    }
    const removedOutput = target.outputId

    // 选择状态：仅当被删的正是当前选中项时改选，避免保存一个已不存在的幽灵 id。
    const remainingIds = (result?.values ?? [])
      .filter((value) => value.id !== removedOutput)
      .map((value) => value.id)
    const fallbackId = stepsRef.current.find((step) => step.id !== id)?.outputId ?? target.inputId ?? 'signal'
    setSelectedId((current) => selectionAfterRemoval(current, removedOutput, remainingIds, fallbackId))

    // 立即从结果里剔除被删步骤的输出（值 / 错误 / 计时），避免幽灵值留在界面；
    // 待驱逐 id 由 effect 依据与 lastSteps 的差异登记，交给 Worker 清缓存。
    setResult((previous) => {
      if (!previous) {
        return previous
      }
      const values = previous.values.filter((value) => value.id !== removedOutput)
      if (values.length === previous.values.length) {
        return previous
      }
      const errors = { ...previous.errors }
      delete errors[id]
      const timings = { ...previous.timings }
      delete timings[id]
      return { ...previous, values, errors, timings }
    })

    setSteps((previous) => {
      const removing = previous.find((step) => step.id === id)
      if (!removing) {
        return previous
      }
      // 下游输入重映射：inputId 与 secondInputId 都指向被删步骤产出时，改接到其输入。
      return previous
        .filter((step) => step.id !== id)
        .map((step) => {
          const inputId = vectorParentId(step.inputId) === removing.outputId ? removing.inputId : step.inputId
          const secondInputId = step.secondInputId && vectorParentId(step.secondInputId) === removing.outputId ? removing.inputId : step.secondInputId
          return inputId === step.inputId && secondInputId === step.secondInputId
            ? step
            : { ...step, inputId, secondInputId }
        })
    })
  }

  const runToStep = (index: number) => {
    const upto = steps.slice(0, index + 1)
    const dirtyUpTo = upto.filter((step) => dirtyIdsRef.current.has(step.id)).map((step) => step.id)
    void run(dirtyUpTo.length > 0 ? dirtyUpTo : [steps[index].id], {
      throughIndex: index,
      evictIds: [...evictIdsRef.current],
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
    if (status === 'running' && runningIds.has(step.id)) {
      return 'running'
    }
    if (dirtyIds.has(step.id)) {
      return 'dirty'
    }
    return 'clean'
  }

  const isDirty = dirtyIds.size > 0 || evictIds.size > 0 || result === null
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

  /** logo 下拉菜单里的文件操作；语言与帮助由 AppNavbar 追加在同一菜单里。 */
  const fileMenu = (
    <>
      <DropdownMenuItem disabled={importing || !hydrated} onSelect={() => setImportDialogOpen(true)}>
        <UploadCloud size={15} aria-hidden="true" />
        {copy.importData}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!canExport} onSelect={() => { setTableDatasetId(null); setView('table') }}>
        <Table2 size={15} aria-hidden="true" />
        {copy.viewData}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!canExport} onSelect={() => void exportSelected()}>
        <Download size={15} aria-hidden="true" />
        {copy.exportShort}
      </DropdownMenuItem>
      {lockedDataset ? (
        <DropdownMenuItem onSelect={() => void exportRawDataset()}>
          <Download size={15} aria-hidden="true" />
          {copy.exportRawCsv}
        </DropdownMenuItem>
      ) : null}
    </>
  )

  const toolbar = (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-2 sm:min-w-max sm:gap-3">
      {/* 主区视图切换：贴在「文件」菜单之后，运行控件保持靠右 */}
      <div role="group" aria-label={copy.view.label} className="inline-flex shrink-0 rounded-[var(--radius-field)] bg-muted p-0.5">
        {(['plot', 'table'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={view === mode}
            className={`h-6 rounded-[calc(var(--radius-field)-2px)] px-2.5 text-xs font-medium transition ${
              view === mode ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/55 hover:text-base-content'
            }`}
            onClick={() => setView(mode)}
          >
            {mode === 'plot' ? copy.view.plot : copy.view.table}
          </button>
        ))}
      </div>

      <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
      <div className="flex items-center gap-1.5 sm:gap-3" role="group" aria-label={copy.runActions}>
        <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-xs font-medium text-base-content/75">
          <Switch checked={autoRun} onCheckedChange={setAutoRun} aria-label={copy.auto} className="h-5" />
          <span className="hidden sm:inline">{copy.auto}</span>
        </label>
        {status === 'running' ? (
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-1 text-xs has-[>svg]:px-1 sm:px-2 sm:has-[>svg]:px-2" onClick={cancel} aria-label={copy.cancel}>
            <X size={15} strokeWidth={2.1} />
            <span className="hidden sm:inline">{copy.cancel}</span>
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 px-1 text-xs has-[>svg]:px-1 sm:px-2 sm:has-[>svg]:px-2"
            disabled={!isDirty}
            onClick={() => void run(dirtyIdsRef.current, { evictIds: [...evictIdsRef.current] })}
            aria-label={copy.runAll}
          >
            <Play size={14} strokeWidth={2.3} />
            <span className="hidden sm:inline">{copy.runAll}</span>
          </Button>
        )}
      </div>

      <span role="status" aria-label={statusText || copy.ready} className={`size-2 shrink-0 rounded-full sm:hidden ${statusDot}`} />
      <div role="status" className="hidden shrink-0 items-center gap-2 rounded-md border border-base-300 bg-base-100 px-2.5 py-1.5 text-xs text-base-content/70 sm:flex">
        <span className={`size-2 shrink-0 rounded-full ${statusDot}`} aria-hidden="true" />
        <span className="max-w-40 truncate font-medium">{statusText || copy.ready}</span>
        {result ? (
          <span className="ml-1 border-l border-base-300 pl-2 text-base-content/55">
            {copy.lastRun} <span className="font-mono tabular-nums">{result.elapsedMs.toFixed(0)} ms</span>
          </span>
        ) : null}
      </div>
      </div>
    </div>
  )

  return (
    <div className="grid h-full grid-rows-[var(--navbar-height)_minmax(0,1fr)] bg-base-200" data-navbar="compact">
      <AppNavbar
        section="science"
        showNav={false}
        logoMenu={fileMenu}
        onLogoMenuCloseAutoFocus={(event) => {
          if (importDialogOpen) event.preventDefault()
        }}
        toolbar={toolbar}
      />

      <ImportDialog
        hideTrigger
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        copy={copy}
        importing={importing}
        restoring={!hydrated}
        onImport={(files) => void importFiles(files)}
        onLoadSample={reload}
      />

      <div
        className="relative grid min-h-0 min-w-0"
        onDragEnter={handlePageDragEnter}
        onDragOver={handlePageDragOver}
        onDragLeave={handlePageDragLeave}
        onDrop={handlePageDrop}
      >
        {dragActive ? (
          <div className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-[calc(var(--radius-box)+0.25rem)] border-2 border-dashed border-primary/60 bg-primary/5 backdrop-blur-[1px]">
            <div className="grid gap-2 text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
                <UploadCloud size={24} strokeWidth={2.2} />
              </span>
              <strong className="text-sm font-semibold text-base-content">{copy.dropFiles}</strong>
              <span className="text-xs text-base-content/55">{copy.dropFilesHint}</span>
            </div>
          </div>
        ) : null}

      <div className="grid min-h-0 min-w-0 grid-cols-1 overflow-y-auto lg:grid-cols-[260px_minmax(0,1fr)_330px] lg:overflow-hidden">
        <WorkspacePanel
          values={values}
          selectedId={selected?.id ?? ''}
          copy={copy}
          onSelect={handleSelectValue}
          datasets={datasets}
          mappings={mappings}
          importError={importError}
          persistenceError={persistenceError}
          importing={importing}
          onMappingChange={updateMapping}
          onRemoveDataset={removeDataset}
          onInspectDataset={(id) => {
            setTableDatasetId(id)
            setView('table')
          }}
        />

        <main className={view === 'table'
          ? 'flex min-w-0 flex-col bg-base-100 lg:h-full lg:overflow-hidden'
          : 'flex min-w-0 flex-col gap-4 bg-base-100 lg:h-full lg:overflow-y-auto'}>
        {view === 'table' ? (
          tableSource ? (
            <DataTable
              key={tableSource.kind === 'dataset' ? `dataset:${tableSource.dataset.id}` : `value:${tableSource.value.id}`}
              source={tableSource}
              host={host}
              copy={copy}
              revision={result}
            />
          ) : (
            <p className="grid flex-1 place-items-center p-6 text-center text-xs text-base-content/40">{copy.empty}</p>
          )
        ) : (
          <>
        <section className="flex min-w-0 flex-col gap-1">
          <h2 className="sr-only">{hasDatasets ? copy.plot.dataDomain : copy.plot.timeDomain}</h2>
          {selected?.kind === 'series' || wave.traces.length > 0 ? (
            <div className="flex items-center justify-end gap-2">
              {selected?.kind === 'series' && (
                <span className="inline-flex rounded-[var(--radius-field)] bg-muted p-0.5">
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
                <span>
                  <PlotToolbar
                    copyState={waveCopyState}
                    onAutorange={() => void wavePlotRef.current?.autorange()}
                    onCopyImage={() => void copyPlotImage(wavePlotRef.current, setWaveCopyState)}
                    onDownloadImage={() => void wavePlotRef.current?.downloadImage()}
                  />
                </span>
              )}
            </div>
          ) : null}
          {wave.traces.length > 0 ? (
            <Plot
              ref={wavePlotRef}
              traces={wave.traces}
              exportTitle={selected?.name ?? 'wave'}
              xTitle={selectedMapping ? (selectedMapping.xColumn || copy.rowIndex) : hasDatasets ? copy.rowIndex : 'time (s)'}
              yTitle={hasDatasets ? (waveSource?.name ?? selected?.name ?? copy.plot.data) : 'amplitude'}
              y2Title={wave.hasResidual ? copy.plot.residual : undefined}
              height={300}
              onRangeChange={handleWaveRangeChange}
              resizeLabel={copy.plot.resizePlot}
            />
          ) : (
            <p className="p-6 text-center text-xs text-base-content/40">{copy.empty}</p>
          )}
        </section>

        {hasSpectrumStep ? (
          <section className="flex min-w-0 flex-col gap-1 border-t border-base-300 pt-4">
            <h2 className="sr-only">{copy.plot.frequencyDomain}</h2>
            {spectrum.length > 0 ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {/* dB / 线性只对幅度有意义，单独看相位时这组按钮不适用。 */}
                {spectrumField !== 'phase' ? (
                  <div className="flex items-center gap-0.5 rounded-md border border-base-300 p-0.5" role="group" aria-label={copy.plot.spectrumScale}>
                    <Button type="button" size="sm" variant={spectrumScale === 'db' ? 'secondary' : 'ghost'} className="h-6 px-2 text-[11px]" aria-pressed={spectrumScale === 'db'} onClick={() => setSpectrumScale('db')}>{copy.plot.dbScale}</Button>
                    <Button type="button" size="sm" variant={spectrumScale === 'linear' ? 'secondary' : 'ghost'} className="h-6 px-2 text-[11px]" aria-pressed={spectrumScale === 'linear'} onClick={() => setSpectrumScale('linear')}>{copy.plot.linearScale}</Button>
                  </div>
                ) : null}
                <div className="flex items-center gap-0.5 rounded-md border border-base-300 p-0.5" role="group" aria-label={copy.plot.frequencyScale}>
                  {frequencyScale === 'log' ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" size="sm" variant="ghost" aria-label={copy.plot.dcHiddenOnLogFrequency} className="size-6 px-0 text-base-content/45">
                          <CircleHelp size={13} strokeWidth={2.2} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copy.plot.dcHiddenOnLogFrequency}</TooltipContent>
                    </Tooltip>
                  ) : null}
                  <Button type="button" size="sm" variant={frequencyScale === 'log' ? 'secondary' : 'ghost'} className="h-6 px-2 text-[11px]" aria-pressed={frequencyScale === 'log'} onClick={() => setFrequencyScale('log')}>{copy.plot.logFrequency}</Button>
                  <Button type="button" size="sm" variant={frequencyScale === 'linear' ? 'secondary' : 'ghost'} className="h-6 px-2 text-[11px]" aria-pressed={frequencyScale === 'linear'} onClick={() => setFrequencyScale('linear')}>{copy.plot.linearFrequency}</Button>
                </div>
                <span>
                  <PlotToolbar
                    copyState={spectrumCopyState}
                    onAutorange={() => void spectrumPlotRef.current?.autorange()}
                    onCopyImage={() => void copyPlotImage(spectrumPlotRef.current, setSpectrumCopyState)}
                    onDownloadImage={() => void spectrumPlotRef.current?.downloadImage()}
                  />
                </span>
              </div>
            ) : null}
            {spectrum.length > 0 ? (
              <Plot
                ref={spectrumPlotRef}
                traces={spectrum}
                exportTitle="spectrum"
                xTitle={`frequency (${spectrumValue?.kind === 'spectrum' ? spectrumValue.frequencyUnit ?? 'Hz' : 'Hz'})`}
                yTitle={spectrumField === 'phase'
                  ? copy.plot.phase
                  : spectrumScale === 'db' ? copy.plot.magnitudeDb : copy.plot.magnitude}
                y2Title={!spectrumField && spectrumValue?.kind === 'spectrum' && spectrumValue.phase ? copy.plot.phase : undefined}
                logX={frequencyScale === 'log'}
                height={300}
                onRangeChange={handleSpectrumRangeChange}
                resizeLabel={copy.plot.resizePlot}
              />
            ) : (
              <p className="p-6 text-center text-xs text-base-content/40">{copy.empty}</p>
            )}
            {spectrumValue?.kind === 'spectrum' && !spectrumValue.phase ? (
              <p className="pl-13 text-[11px] text-base-content/55">{copy.plot.phaseUnavailable}</p>
            ) : null}
          </section>
        ) : null}
          </>
        )}
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
      </div>
      </div>
      </div>
    </div>
  )
}
