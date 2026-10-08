'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode, useSyncExternalStore } from 'react'
import { ChevronLeft, ChevronRight, Download, Image as ImageIcon, Plus, Redo2, RefreshCw, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { AppNavbar } from '../../components/AppNavbar'
import { useI18n } from '../../i18n'
import { Button } from '@joplot/ui/button'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@joplot/ui/accordion'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@joplot/ui/card'
import { Checkbox } from '@joplot/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@joplot/ui/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@joplot/ui/context-menu'
import { Input } from '@joplot/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@joplot/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@joplot/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@joplot/ui/toggle-group'
import { Label } from '@joplot/ui/label'
import { Slider } from '@joplot/ui/slider'
import { createImagejCopy } from '../lib/i18n'
import { readDroppedContent } from '../lib/dropFiles'
import { analysisViews, type ViewType } from '../lib/analysisViews'
import { fastHistogram } from '../lib/fastHistogram'
import { toRoi, type RoiInput } from '../lib/processor'
import { animationInterval, nextAnimationStep } from '../lib/animation'
import { clampRoi, isRoi, roiBounds, roiPoints, type Roi } from '../lib/roi'
import { TOOLS, VARIANT_ICONS, toolByShortcut, type ToolDefinition, type ToolId } from '../lib/tools'
import { getOperator, toUiRegistry } from '../engine/operators'
import { stepAppliesToSelection, type StepScope } from '../engine/recipe'
import { computeWindowLevel } from '../engine/render/rgba'
import { displayBlock as toDisplayBlock } from '../engine/render/display'
import type { Dataset } from '../engine/dataset'
import type { ImageBlock } from '../engine/types'
import { encodeTiffStack } from '../engine/tiff'
import { ImageJSidebar } from './ImageJSidebar'
import { createDocumentRuntime, createWorkspaceEngine, useRuntimeState, type ImageWorkspaceEngine } from './useImageRuntime'
import type { ImageRuntime } from '../engine/runtime'
import { useImageAnalysis } from './useImageAnalysis'
import { ImageViewport, type ImageViewportHandle, type PixelProbe } from './ImageViewport'
import { ColorContrastPanel } from './ColorContrastPanel'
import { StackBuilderDialog, type StackRow } from './StackBuilderDialog'
import { StackOrderDialog } from './StackOrderDialog'
import { RawSensorDialog, type RawSensorPrompt } from './RawSensorDialog'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@joplot/ui/dialog'
import { AnimationCommandPanel, CombineCommandPanel, DebayerCommandPanel, FilterCommandPanel, LabelCommandPanel, MontageCommandPanel, MontageToStackCommandPanel, OrthogonalCommandPanel, Project3dCommandPanel, ReduceCommandPanel, RemontageCommandPanel, ResliceCommandPanel, SetLabelCommandPanel, SubstackCommandPanel, ThresholdCommandPanel, ZProjectCommandPanel } from './CommandPanels'
import { HistogramChart } from './HistogramChart'
import { applyColorAdjustments, type ColorAdjustment } from '../engine/colorAdjustments'
import { ColorGradingPanel } from './ColorGradingPanel'
import type { ColorGradingMethod } from '../engine/colorGrading'
import { needsSensorOptions, type RawSensorOptions } from '../engine/raw/sensor'

/** 需要先调参数再执行的操作：面板在对应命令项下方展开，所以这里存命令 label。 */
type ParamCommand =
  | 'Brightness/Contrast' | 'White Balance' | 'Threshold' | 'Debayer'
  | 'Mean' | 'Median' | 'Gaussian Blur' | 'Minimum' | 'Maximum' | 'Sharpen' | 'Unsharp Mask'
type ParamOp = 'levels' | 'colorGrading' | 'threshold' | 'debayer' | 'mean3x3' | 'median3x3' | 'gaussian' | 'minimum3x3' | 'maximum3x3' | 'sharpen3x3' | 'unsharpMask'
/** 需要一个"参数 + 预览"面板的滤镜算子（面板由 FilterCommandPanel 统一渲染）。 */
/** 拖滤镜参数滑杆时，等停手这么久再真的重算预览。 */
const FILTER_PREVIEW_DEBOUNCE_MS = 120
const FILTER_OPS: readonly ParamOp[] = ['mean3x3', 'median3x3', 'gaussian', 'minimum3x3', 'maximum3x3', 'sharpen3x3', 'unsharpMask']
/** 命令目录 FILTERS 组里这两列顺序一致的命令名（都带参数面板）。 */
const FILTER_COMMANDS: readonly ParamCommand[] = ['Mean', 'Median', 'Gaussian Blur', 'Minimum', 'Maximum', 'Sharpen', 'Unsharp Mask']
/** 各滤镜的参数默认值/下限（顺序即字段顺序）；`max` 缺省表示不设上限。 */
const FILTER_FIELDS: Partial<Record<ParamOp, readonly { key: string; fallback: number; min: number; max?: number; step: number }[]>> = {
  // 半径允许小数、不设上限（ImageJ 的 RankFilters 半径本来就是 float）。
  // 大半径会随 r² 变慢，但取多大是用户的选择。
  mean3x3: [{ key: 'radius', fallback: 1, min: 0, step: 0.1 }],
  median3x3: [{ key: 'radius', fallback: 2, min: 0, step: 0.1 }],
  gaussian: [{ key: 'sigma', fallback: 1.5, min: 0.1, step: 0.1 }],
  minimum3x3: [{ key: 'radius', fallback: 1, min: 0, step: 0.1 }],
  maximum3x3: [{ key: 'radius', fallback: 1, min: 0, step: 0.1 }],
  sharpen3x3: [{ key: 'amount', fallback: 1, min: 0, step: 0.1 }],
  unsharpMask: [{ key: 'sigma', fallback: 2, min: 0.1, step: 0.1 }, { key: 'amount', fallback: 0.6, min: 0, step: 0.1 }],
}
/** 命令 label → 算子 kind（命令目录里 label 是唯一键）。 */
const COMMAND_OPS: Record<ParamCommand, ParamOp> = {
  'Brightness/Contrast': 'levels',
  'White Balance': 'colorGrading',
  Threshold: 'threshold',
  Debayer: 'debayer',
  Mean: 'mean3x3',
  Median: 'median3x3',
  'Gaussian Blur': 'gaussian',
  Minimum: 'minimum3x3',
  Maximum: 'maximum3x3',
  Sharpen: 'sharpen3x3',
  'Unsharp Mask': 'unsharpMask',
}
/** 算子 kind → 命令目录里默认展开的那一项。 */
const OP_COMMANDS: Record<ParamOp, ParamCommand> = {
  levels: 'Brightness/Contrast',
  colorGrading: 'White Balance',
  threshold: 'Threshold',
  debayer: 'Debayer',
  mean3x3: 'Mean',
  median3x3: 'Median',
  gaussian: 'Gaussian Blur',
  minimum3x3: 'Minimum',
  maximum3x3: 'Maximum',
  sharpen3x3: 'Sharpen',
  unsharpMask: 'Unsharp Mask',
}

const VIEW_TYPES: ViewType[] = ['measurement', 'histogram', 'profile', 'particles']
/**
 * 栈命令 → 它打开的视图卡片。
 *
 * 这些卡片不进「添加视图」下拉：它们由 Image ▸ Stacks 的命令唤起 —— 前三张共用
 * `runtime.measureStack()` 的一次整栈统计，`Plot XY Profile` 用 `runtime.loadStackProfiles()`。
 */
const STACK_VIEW_COMMANDS: Record<string, ViewType> = {
  'plot-z-profile': 'zprofile',
  'measure-stack': 'stackMeasure',
  'stack-statistics': 'stackStatistics',
  'plot-xy-profile': 'xyProfile',
}
type ProjectionMethod = 'average' | 'max' | 'min' | 'sum' | 'sd' | 'median'
const PROJECT_COMMANDS = ['Z Project...', 'Grouped Z Project...'] as const
type ProjectCommand = typeof PROJECT_COMMANDS[number]
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
/** 能整除页数的组大小候选；对齐 ImageJ 的 "Valid factors: ..." 提示行（最多 10 个）。 */
function groupSizeFactors(count: number): number[] {
  const factors: number[] = []
  for (let value = 1; value <= count && factors.length < 10; value += 1) {
    if (count % value === 0) factors.push(value)
  }
  return factors
}

/**
 * 解析 ImageJ 风格的切片表达式：`1-3`、`1-100-2`、`7,9,25` → 0-based 下标数组。
 *
 * 与 ImageJ 的 SubstackMaker 一样以 1 开始计数，越界的项直接丢弃；结果去重并升序。
 */
function parseSliceList(input: string, count: number): number[] {
  const pages: number[] = []
  for (const token of input.split(/[,，\s]+/).filter(Boolean)) {
    const range = /^(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?$/.exec(token)
    if (range) {
      const from = Math.max(1, Number(range[1]))
      const to = Math.min(count, Number(range[2]))
      const step = range[3] ? Math.max(1, Number(range[3])) : 1
      for (let value = from; value <= to; value += step) pages.push(value - 1)
      continue
    }
    const single = Number(token)
    if (Number.isInteger(single) && single >= 1 && single <= count) pages.push(single - 1)
  }
  return [...new Set(pages)].sort((a, b) => a - b)
}

/**
 * Stack 切片栏：图像窗口底部的一条矮栏（每行 24px）。
 *
 * 位置与 ImageJ 的 `StackWindow` 滚动条一致 —— `ImageLayout.moveComponents`
 * （`ImageLayout.java:59-70`）把画布之后的组件依次排在图像**下方**，
 * 窗口高度再由 `ImageWindow.getMaximumBounds`（`:556-564`）把滚动条算进去；
 * 控件本身也对应 `ScrollbarWithLabel`：轴名 + 滚动条 + 位置读数。
 *
 * 每个可翻的轴独占一行，因此 hyperstack（c/z/t）也只是几行矮栏，不会挤压图像。
 * 翻页在途时页码显示 `…`：架构方案第 1 节禁止"新页码配旧像素"。
 */
function StackSliceBar({ slices, stale, disabled, pageLabel, onSelect }: {
  slices: readonly { axis: 't' | 'c' | 'z'; length: number; index: number }[]
  stale: boolean
  disabled: boolean
  pageLabel: string
  onSelect(axis: 't' | 'c' | 'z', index: number): void
}) {
  if (!slices.length) return null
  return (
    <div className="flex shrink-0 flex-col border-t border-base-300 bg-base-100">
      {slices.map((entry) => (
        <div key={entry.axis} className="flex h-6 items-center gap-1.5 px-2">
          <span className="w-2.5 shrink-0 text-xs font-semibold uppercase text-base-content/55">{entry.axis}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${entry.axis} previous slice`}
            disabled={disabled || entry.index === 0}
            onClick={() => onSelect(entry.axis, entry.index - 1)}
            className="size-4 rounded-[calc(var(--radius-field)-3px)] text-base-content/60"
          >
            <ChevronLeft size={12} />
          </Button>
          <Slider
            min={0}
            max={entry.length - 1}
            step={1}
            value={[entry.index]}
            disabled={disabled}
            onValueChange={(next) => onSelect(entry.axis, next[0] ?? entry.index)}
            aria-label={`${entry.axis} ${pageLabel}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${entry.axis} next slice`}
            disabled={disabled || entry.index + 1 >= entry.length}
            onClick={() => onSelect(entry.axis, entry.index + 1)}
            className="size-4 rounded-[calc(var(--radius-field)-3px)] text-base-content/60"
          >
            <ChevronRight size={12} />
          </Button>
          <span className="w-14 shrink-0 text-right text-xs tabular-nums text-base-content/70">
            {stale ? '…' : entry.index + 1} / {entry.length}
          </span>
        </div>
      ))}
    </div>
  )
}

function prepareChartCanvas(
  canvas: HTMLCanvasElement,
  cssHeight: number,
): { context: CanvasRenderingContext2D; width: number } | null {
  const cssWidth = Math.max(1, Math.round(canvas.clientWidth || canvas.parentElement?.clientWidth || 300))
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  canvas.width = Math.round(cssWidth * dpr)
  canvas.height = Math.round(cssHeight * dpr)
  canvas.style.height = `${cssHeight}px`
  const context = canvas.getContext('2d')
  if (!context) return null
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, cssWidth, cssHeight)
  return { context, width: cssWidth }
}

function ImageDocumentView({ runtime, onOpenImage, onOpenDataset, onListDocuments, tabsHeader, onEjectPage }: { runtime: ImageRuntime; onOpenImage(file: File): void; onOpenDataset?(dataset: Dataset): void; onListDocuments?(): Array<{ id: string; title: string }>; tabsHeader?: ReactNode; onEjectPage?(pageIndex: number): void }) {
  const { language } = useI18n()
  const copy = useMemo(() => createImagejCopy(language), [language])
  const state = useRuntimeState(runtime)
  const registry = useMemo(() => toUiRegistry(), [])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<ImageViewportHandle>(null)
  const profileCanvasRef = useRef<HTMLCanvasElement>(null)
  const [roi, setRoi] = useState<Roi | null>(null)
  const [zoom, setZoom] = useState(1)
  /** 当前工具（对齐 ImageJ 工具栏；默认为矩形，与 ImageJ 一致）。 */
  const [tool, setTool] = useState<ToolId>('rectangle')
  /** 各工具的子类型：双击工具图标切换（ImageJ 的 Toolbar.getName 子类型机制）。 */
  const [toolVariants, setToolVariants] = useState<Record<string, string>>({ line: 'line', point: 'point' })
  const [probe, setProbe] = useState<PixelProbe | null>(null)
  const [thresholdLevel, setThresholdLevel] = useState(128)
  const [debayerPattern, setDebayerPattern] = useState('auto'), [debayerAlgorithm, setDebayerAlgorithm] = useState('malvar')
  const [scope, setScope] = useState<'image' | 'roi'>('image')
  const [applyAll, setApplyAll] = useState(false)
  const [paramCommand, setParamCommand] = useState<ParamCommand | null>(null)
  useEffect(() => {
  }, [])
  /** 各滤镜面板当前参数（按算子 kind 分开记，切来切去不会丢）。 */
  const [filterValues, setFilterValues] = useState<Record<string, Record<string, number>>>({})
  /** 勾选「预览」时临时加进 recipe 的那一步；取消勾选/关面板要把它移除。 */
  const [filterPreviewStepId, setFilterPreviewStepId] = useState<string | null>(null)
  const filterPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 视口变化后更新预览作用域的防抖定时器。 */
  const filterScopeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 分析面板跨图片标签页共享（见 lib/analysisViews）：切标签页不重置，卡片列表是全局的。
  const viewsState = useSyncExternalStore(analysisViews.subscribe, analysisViews.snapshot, analysisViews.snapshot)
  const views = viewsState.cards
  const [minParticleArea, setMinParticleArea] = useState(1)
  const [original, setOriginal] = useState<ImageBlock | null>(null), [showColor, setShowColor] = useState(true)
  const [showOriginal, setShowOriginal] = useState(false)
  const [colorPreview, setColorPreview] = useState<readonly ColorAdjustment[]>([])
  /** 「白平衡」的调色参数：方法 + 各方法自己的参数。 */
  const [gradingMethod, setGradingMethod] = useState<ColorGradingMethod>('grayWorld')
  const [gradingClip, setGradingClip] = useState(0.5)
  const [gradingStrength, setGradingStrength] = useState(100)
  const [gradingGains, setGradingGains] = useState<[number, number, number]>([1, 1, 1])
  /**
   * 白平衡的预览步骤 id（用 ref 而非 state：UI 不依赖它，也不该因为它重渲染）。
   *
   * 与滤镜面板同一套机制：参数一变就把预览作为**临时步骤**加进处理链（或更新它），
   * 点「应用」时停止跟踪使那一步变成正式步骤，收起面板时把它撤掉。
   */
  const gradingPreviewStepId = useRef<string | null>(null)

  /** 「预览」复选框：默认开启（ImageJ 的 Color Balance 默认就勾着）。 */

  const [gradingPreview, setGradingPreview] = useState(true)

  const [colorSession, setColorSession] = useState(0)
  /** 展开中的 Z 投影命令（`Z Project...` / `Grouped Z Project...`）；与算子参数面板互斥。 */
  const [projectCommand, setProjectCommand] = useState<ProjectCommand | null>(null)
  const [projectionMethod, setProjectionMethod] = useState<ProjectionMethod>('average')
  const [projectionStart, setProjectionStart] = useState(1)
  const [projectionStop, setProjectionStop] = useState(1)
  const [projectionGroup, setProjectionGroup] = useState(2)
  const [projectionAllTime, setProjectionAllTime] = useState(false)
  /** 「制作蒙太奇…」面板的展开状态与参数；0 表示交给引擎按 ImageJ 的自动规则计算。 */
  const [montageOpen, setMontageOpen] = useState(false)
  const [montage, setMontage] = useState({ columns: 0, rows: 0, scale: 0, border: 0, start: 1, stop: 1, increment: 1, labelSlices: false, fontSize: 12 })
  /** 「蒙太奇转 Stack…」面板的展开状态与参数；0 表示沿用蒙太奇元数据里的行列。 */
  const [montageToStackOpen, setMontageToStackOpen] = useState(false)
  const [montageToStack, setMontageToStack] = useState({ columns: 0, rows: 0, border: 0 })
  /** 「重切…」（Reslice）面板的展开状态与参数。 */
  const [resliceOpen, setResliceOpen] = useState(false)
  const [reslice, setReslice] = useState({ spacing: 1, startAt: 'top', flip: false, rotate: false })
  /** 「正交视图」面板的展开状态与交叉点（打开时缺省取图像中心）。 */
  const [orthogonalOpen, setOrthogonalOpen] = useState(false)
  const [orthogonalPoint, setOrthogonalPoint] = useState({ x: 0, y: 0 })
  /** 「抽稀…」与「子栈…」两个结构编辑面板的展开状态与参数。 */
  const [reduceOpen, setReduceOpen] = useState(false)
  const [reduceFactor, setReduceFactor] = useState(2)
  const [substackOpen, setSubstackOpen] = useState(false)
  const [substackPages, setSubstackPages] = useState('')
  /** 「插入图像」/「合并拼接」面板的展开状态与参数（候选来自其它已打开文档）。 */
  const [combineOpen, setCombineOpen] = useState(false)
  const [combineOp, setCombineOp] = useState<'insert' | 'combine'>('insert')
  const [combineSource, setCombineSource] = useState('')
  const [combineVertical, setCombineVertical] = useState(false)
  const [combineDocuments, setCombineDocuments] = useState<Array<{ id: string; title: string }>>([])
  const [insertX, setInsertX] = useState(0)
  const [insertY, setInsertY] = useState(0)
  /** 动画状态（ImageJ 的 Animator：Start / Stop / Options）。 */
  const [animationOpen, setAnimationOpen] = useState(false)
  const [animation, setAnimation] = useState({ running: false, fps: 7, first: 1, last: 0, loop: false, forward: true })
  /** 「设置标签」面板的展开状态与输入值（打开时填入当前页标签）。 */
  const [labelOpen, setLabelOpen] = useState(false)
  const [labelValue, setLabelValue] = useState('')
  /** 「标注切片」面板的展开状态与参数（Label...，把文本画进像素）。 */
  const [annotateOpen, setAnnotateOpen] = useState(false)
  const [annotate, setAnnotate] = useState({ format: 'number', start: 1, interval: 1, text: '', x: 5, y: 20, fontSize: 18 })
  /** 「3D 投影」面板的展开状态与参数。 */
  const [project3dOpen, setProject3dOpen] = useState(false)
  /** 「蒙太奇工具」面板的展开状态与参数（按新行列重排蒙太奇）。 */
  const [remontageOpen, setRemontageOpen] = useState(false)
  const [remontage, setRemontage] = useState({ sourceColumns: 0, sourceRows: 0, columns: 2, rows: 2, border: 0, labelSlices: false, fontSize: 12 })
  const [project3d, setProject3d] = useState({
    method: 'brightest',
    axis: 'y',
    initialAngle: 0,
    totalRotation: 360,
    angleIncrement: 10,
    opacity: 0,
    surfaceCueing: 100,
    interiorCueing: 50,
  })
  const [uiError, setError] = useState(''), [exporting, setExporting] = useState(false)
  /** Original 帧的在途请求序号：切片切换或重复点击时作废旧读取。 */
  const originalRequest = useRef(0)
  const image = state.image
  const isRgb = Boolean(image && image.axes.includes('c') && image.shape[image.axes.indexOf('c')] === 3)
  const current = image ? { width: image.shape[image.axes.indexOf('x')]!, height: image.shape[image.axes.indexOf('y')]!, data: image.data } : null
  const sourceName = state.dataset?.source.name ?? ''
  const busy = state.status === 'importing' || state.status === 'running' || exporting
  // 灰度图上灰度世界/白点是恒等变换：切到灰度图时把方法挪到真正有效的那个。
  useEffect(() => {
    if (!isRgb && (gradingMethod === 'grayWorld' || gradingMethod === 'whitePatch')) setGradingMethod('autoLevels')
  }, [isRgb, gradingMethod])
  /**
   * 白平衡预览：参数一变就把效果作为**临时步骤**刷进处理链；面板收起或切到别的命令时撤掉它。
   * 点「应用」只是停止跟踪该步骤，它就留在链里变成正式一步。
   */
  useEffect(() => {
    if (paramCommand !== 'White Balance' || !gradingPreview) {
      if (gradingPreviewStepId.current) { runtime.removeStep(gradingPreviewStepId.current); gradingPreviewStepId.current = null }
      return
    }
    if (!image || busy) return
    const timer = setTimeout(() => {
      const params = {
        method: gradingMethod,
        clipPercent: gradingClip,
        strength: gradingStrength,
        gainR: gradingGains[0],
        gainG: gradingGains[1],
        gainB: gradingGains[2],
      }
      const current = gradingPreviewStepId.current
      if (current) runtime.updateParams(current, params)
      else gradingPreviewStepId.current = runtime.addStep('colorGrading', params, { kind: 'frame', selection: { ...state.selection } }) ?? null
    }, FILTER_PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // image / busy / runtime / state 故意不进依赖：预览会改写它们，放进去会自激。
  }, [paramCommand, gradingPreview, gradingMethod, gradingClip, gradingStrength, gradingGains])
  /* 翻页导航只受导入 / 导出影响：切片切换很轻，不应因正在计算而变灰（否则滚动时工具栏一直灰）。 */
  const navBusy = state.status === 'importing' || exporting
  // 切片切换后新像素就绪前，视口里仍是上一帧。此时不显示新页码，
  // 也不接受探查与 ROI，避免把旧页像素当成新页使用（架构方案第 1 节）。
  const stale = Boolean(state.imageStale && state.image)
  const error = uiError || state.error || ''
  const historyFlags = { canUndo: runtime.canUndo() || colorPreview.length > 0, canRedo: runtime.canRedo() }
  const slices = (['t', 'c', 'z'] as const).map((axis) => ({ axis, length: state.dataset?.shape[state.dataset.axes.indexOf(axis)] ?? 1, index: state.selection[axis] ?? 0 }))
    .filter((entry) => entry.length > 1 && !(entry.axis === 'c' && state.dataset?.componentKind === 'rgb'))
  const frameCount = slices.reduce((count, entry) => count * entry.length, 1)
  const stack = frameCount > 1 ? { length: frameCount } : null
  const slice = slices.find((entry) => entry.axis === 'z') ?? slices[0]
  const pageIndex = slice?.index ?? 0
  /** 切片轴的页数：跨帧命令（Z 投影 / 整栈统计）的作用范围。 */
  const sliceCount = slice?.length ?? 1
  /** 时间帧数：大于 1 时 Z 投影才提供「全部时间帧」。 */
  const timeCount = slices.find((entry) => entry.axis === 't')?.length ?? 1
  const stackStats = state.stackStats
  /** 数据集是否有切片轴：结构编辑（Add Slice 等）据此可用，长度 1 的单页栈也算。 */
  const hasSliceAxis = Boolean(state.dataset && (['z', 't', 'c'] as const).some((axis) => {
    const dataset = state.dataset!
    return dataset.axes.includes(axis) && !(axis === 'c' && dataset.componentKind === 'rgb')
  }))
  /** 统计卡片的占位文案：区分「没跑过」与「跑过但被切片/Recipe 变更作废」。 */
  const stackStatsPlaceholder = state.stackStatsStale ? copy.stackOps.stale : copy.status.loading
  /** Z 轴剖面折线：逐切片均值映射到 0..100 × 0..40 的 SVG 视口坐标。 */
  const zProfilePoints = useMemo(() => {
    const values = stackStats?.profile ?? []
    if (values.length < 2) return ''
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    return values
      .map((value, index) => `${((index / (values.length - 1)) * 100).toFixed(2)},${(38 - ((value - min) / span) * 36).toFixed(2)}`)
      .join(' ')
  }, [stackStats])
  /** 曲线纵轴的实际范围，用于卡片脚注。 */
  const zProfileRange = useMemo<[string, string]>(() => {
    const values = stackStats?.profile ?? []
    if (!values.length) return ['—', '—']
    return [Math.min(...values).toFixed(2), Math.max(...values).toFixed(2)]
  }, [stackStats])
  /** 逐页剖面折线：共用同一纵轴（对应 ImageJ 的 ProfilePlot.setMinAndMax），当前切片高亮。 */
  const profilePolylines = useMemo(() => {
    const result = state.stackProfiles
    if (!result || result.length < 2) return []
    const span = result.max - result.min || 1
    return result.profiles.map((profile, index) => ({
      index,
      points: profile
        .map((value, x) => `${((x / Math.max(1, profile.length - 1)) * 100).toFixed(2)},${(38 - ((value - result.min) / span) * 36).toFixed(2)}`)
        .join(' '),
    }))
  }, [state.stackProfiles])
  const paramOp = paramCommand ? COMMAND_OPS[paramCommand] : null
  const particlesRequested = views.some((view) => view.type === 'particles')
  const analysisChannel = isRgb && colorPreview.length ? 'all' as const : undefined
  /* 引擎在 run 里已顺带算好整帧分析：整图、无 ROI、无粒子、无通道调整时直接用，免复制、免第二个 Worker。 */
  const engineCovered = scope === 'image' && !roi && !particlesRequested && !analysisChannel
  const workerAnalysis = useImageAnalysis(image, scope === 'roi' ? roi : null, particlesRequested, minParticleArea, roi, analysisChannel, colorPreview, !engineCovered)
  const analysisResult = engineCovered ? { analysis: state.analysis } : workerAnalysis
  const status = state.status === 'importing' ? copy.status.loading : state.dataset ? copy.status.ready : ''
  /** 整卷预热进度：惰性 Stack 打开后后台解码，翻页因此变成缓存命中。 */
  const preload = state.preload
  const stats = scope === 'roi' && !roi ? undefined : analysisResult.analysis
  const particles = analysisResult.particles ?? null
  const profileData = analysisResult.analysis?.profile ?? null
  const displayBlock = showOriginal && original ? original : image

  /*
   * 右栏「直方图」卡片：主线程同步算，翻页同帧即出结果（不再等 worker 往返）。
   * Live 对齐 ImageJ 直方图窗口的复选框：勾上跟随当前切片；取消后画面冻在最后一次结果上，
   * 点刷新才拉当前切片——用于边翻边对照某一页的分布。
   */
  const liveHistogram = useMemo(() => displayBlock ? fastHistogram(displayBlock, analysisChannel ?? 'all') : null, [displayBlock, analysisChannel])
  const currentHistogram = liveHistogram ? { counts: liveHistogram.counts, min: liveHistogram.histogramMin, max: liveHistogram.histogramMax } : null
  // Live 与冻结值按卡片 id 存在共享 store 里（不在本组件内）：跨图片标签页保留，
  // 所以可以冻住一张图的直方图、切到另一张继续看，两张并排对比。
  const isHistLive = (id: number) => viewsState.live[id] !== false
  const histogramFor = (id: number) => isHistLive(id) ? currentHistogram : (viewsState.frozen[id] ?? currentHistogram)
  const refreshHistogram = (id: number) => analysisViews.freeze(id, currentHistogram)
  const toggleHistLive = (id: number, on: boolean) => analysisViews.setLive(id, on, currentHistogram)
  const baselineWindow = useMemo(() => {
    if (!displayBlock) return { window: 255, level: 127.5 }
    return displayBlock.dtype === 'uint8' ? { window: 255, level: 127.5 } : computeWindowLevel(displayBlock)
  }, [displayBlock])
  const rasterOptions = useMemo(() => ({ gray: !showColor, threshold: paramOp === 'threshold' ? thresholdLevel : undefined, colorAdjustments: showOriginal ? [] : colorPreview }), [showColor, paramOp, thresholdLevel, colorPreview, showOriginal])
  const selectPage = (index: number) => {
    if (!slice) return
    if (colorPreview.length) commitColorPreview(colorPreview, false)
    setError(''); runtime.setSelection({ [slice.axis]: Math.max(0, Math.min(slice.length - 1, index)) })
  }
  const hasImage = Boolean(current)
  // 翻页走 ref：selectPage 每次渲染重建，若作为 effect 依赖会反复重绑监听。
  const selectPageRef = useRef<(index: number) => void>(() => {})
  /* 动画播放：按帧率推进当前切片；每次翻页后重排定时器，避免请求堆积。 */
  useEffect(() => {
    if (!animation.running || sliceCount < 2) return
    const timer = setTimeout(() => {
      setAnimation((current) => {
        if (!current.running) return current
        const step = nextAnimationStep({
          current: pageIndex,
          first: current.first || 1,
          last: current.last || sliceCount,
          forward: current.forward,
          loop: current.loop,
        }, sliceCount)
        selectPageRef.current(step.index)
        return { ...current, forward: step.forward }
      })
    }, animationInterval(animation.fps))
    return () => clearTimeout(timer)
  }, [animation, pageIndex, sliceCount])
  selectPageRef.current = selectPage
  const pageIndexRef = useRef(pageIndex)
  pageIndexRef.current = pageIndex
  /** 供视口滚轮翻页调用：以当前页为基准步进，越界由 selectPage 夹取。 */
  const stepPage = (delta: number) => selectPageRef.current(pageIndexRef.current + delta)
  useEffect(() => {
    if (!slice) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // 焦点在输入控件时不劫持按键：range 滑杆要用方向键与 Home/End。
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
      }
      const last = slice.length - 1
      const key = event.key
      let targetPage: number | undefined
      if (key === '.' || key === '>') targetPage = pageIndex + 1
      else if (key === ',' || key === '<') targetPage = pageIndex - 1
      else if (key === 'Home') targetPage = 0
      else if (key === 'End') targetPage = last
      if (targetPage === undefined) return
      const next = Math.max(0, Math.min(last, targetPage))
      if (next === pageIndex) return
      event.preventDefault()
      selectPageRef.current(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slice, pageIndex])
  /**
   * 工具快捷键独立注册。
   *
   * 不能并进下面那个翻页用的 keydown：那个 effect 依赖 `slice`，单图模式下会提前
   * return，于是"没有切片就切不了工具"。这里只依赖稳定的 setTool。
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if (!/^[a-z]$/i.test(event.key)) return
      const shortcutTool = toolByShortcut(event.key)
      if (!shortcutTool) return
      event.preventDefault()
      setTool(shortcutTool.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const roiLabel = useMemo(() => {
    if (!roi) return '—'
    const bounds = roiBounds(roi)
    const tools = copy.tools as Record<string, string>
    // 直线的 `arrow` 是子类型，`kind` 仍是 line，这里显示用户实际选的那个名字。
    const name = roi.kind === 'line' && roi.arrow ? tools.arrow ?? roi.kind : tools[roi.kind] ?? roi.kind
    return `${name} · ${bounds.width}×${bounds.height} @ (${bounds.x}, ${bounds.y})`
  }, [roi, copy])
  /**
   * 当前展开的命令标签。
   *
   * 各面板各有自己的状态（参数面板、Z 投影、蒙太奇、Reslice…），侧栏只认一个标签，
   * 因此在这里把它们合并回读：侧栏据此显示 ▾ 与高亮，也据此判断"再点一次是收起"。
   */
  const expandedCommandLabel = useMemo<string | null>(() => {
    if (paramCommand) return paramCommand
    if (projectCommand) return projectCommand
    if (montageOpen) return 'Make Montage...'
    if (montageToStackOpen) return 'Montage to Stack...'
    if (resliceOpen) return 'Reslice [/]...'
    if (orthogonalOpen) return 'Orthogonal Views'
    if (reduceOpen) return 'Reduce...'
    if (substackOpen) return 'Make Substack...'
    if (combineOpen) return combineOp === 'insert' ? 'Insert...' : 'Combine...'
    if (animationOpen) return 'Animation Options...'
    if (labelOpen) return 'Set Label...'
    if (annotateOpen) return 'Label...'
    if (project3dOpen) return '3D Project...'
    if (remontageOpen) return 'Magic Montage Tools'
    return null
  }, [paramCommand, projectCommand, montageOpen, montageToStackOpen, resliceOpen, orthogonalOpen, reduceOpen, substackOpen, combineOpen, combineOp, animationOpen, labelOpen, annotateOpen, project3dOpen, remontageOpen])

  const seedDefaultViews = () => analysisViews.seed()
  useEffect(() => {
    // 翻页作废在途的 Original 读取：Original 改为按需读，见 toggleOriginal。
    originalRequest.current += 1
    setRoi(null); setScope('image'); setProbe(null); setOriginal(null); setShowOriginal(false); setColorPreview([])
  }, [runtime, state.dataset?.id, state.selection.t, state.selection.c, state.selection.z])
  useEffect(() => {
    if (current) setRoi((target) => target ? clampRoi(target, current.width, current.height) : null)
  }, [current?.width, current?.height])
  /* 数据集就绪后播种默认视图：新建文档由外壳导入，不经过本组件的 loadFile。 */
  useEffect(() => {
    if (state.dataset) seedDefaultViews()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.dataset?.id])
  /* 打开文件交给外壳：每个文件开一个新 tab。 */
  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (file) onOpenImage(file); event.target.value = ''
  }
  /** 工具显示名：有子类型时用子类型的名字（直线 → 箭头）。 */
  const toolLabel = (tools: Record<string, string>, entry: ToolDefinition, variantId?: string): string => {
    const key = variantId ?? entry.id
    return tools[key] ?? tools[entry.id] ?? entry.id
  }
  /** 双击工具图标：在子类型之间循环（对齐 ImageJ 的工具族切换）。 */
  const cycleToolVariant = (entry: ToolDefinition) => {
    if (!entry.variants?.length) return
    const current = toolVariants[entry.id] ?? entry.variants[0]!.id
    const index = entry.variants.findIndex((variant) => variant.id === current)
    const next = entry.variants[(index + 1) % entry.variants.length]!.id
    setToolVariants((prev) => ({ ...prev, [entry.id]: next }))
    setTool(entry.id)
  }

  /** 某个滤镜面板当前的参数值（缺省用声明的默认值补）。 */
  const filterParamValues = (op: ParamOp): Record<string, number> => {
    const stored = filterValues[op] ?? {}
    return Object.fromEntries((FILTER_FIELDS[op] ?? []).map((field) => [field.key, stored[field.key] ?? field.fallback]))
  }
  /**
   * 预览步骤的作用域。
   *
   * 未勾 "应用到整个 Stack" 时，把作用域收窄到**当前视口覆盖的区域**（含余量）：
   * 整幅 4096×3072 算一次滤镜要几百毫秒，而屏幕上通常只看得到其中一小块。
   * 区域边界由算子声明的 halo 补像素，所以带内结果与全图计算一致；
   * 整幅图都可见时 `visibleRegion()` 返回 null，退化成原来的整帧作用域。
   */
  const filterPreviewScope = (): StepScope => {
    const scope = stepScope(null)
    if (applyAll || scope.kind !== 'frame' || !image) return scope
    const bounds = viewportRef.current?.visibleRegion()
    if (!bounds) return scope
    return {
      ...scope,
      region: {
        start: image.axes.map((axis) => (axis === 'x' ? bounds.x : axis === 'y' ? bounds.y : 0)),
        shape: image.axes.map((axis, index) => (axis === 'x' ? bounds.width : axis === 'y' ? bounds.height : image.shape[index]!)),
      },
    }
  }
  /**
   * 视口变化（缩放/滚动）时让预览跟上：把预览步骤的作用域换成新的可见区域。
   *
   * 两处克制：先防抖（滚动是一串事件），再依赖 `updateScope` 在作用域等价时
   * 直接返回——余量内的小幅平移不会触发任何重算。
   */
  const handleViewChange = (region: { x: number; y: number; width: number; height: number } | null) => {
    if (!filterPreviewStepId || !image) return
    if (filterScopeTimer.current) clearTimeout(filterScopeTimer.current)
    const stepId = filterPreviewStepId
    filterScopeTimer.current = setTimeout(() => {
      filterScopeTimer.current = null
      if (applyAll) return
      const next = region
        ? {
            kind: 'frame' as const,
            selection: { ...state.selection },
            region: {
              start: image.axes.map((axis) => (axis === 'x' ? region.x : axis === 'y' ? region.y : 0)),
              shape: image.axes.map((axis, index) => (axis === 'x' ? region.width : axis === 'y' ? region.height : image.shape[index]!)),
            },
          }
        : stepScope(null)
      runtime.updateScope(stepId, next)
    }, FILTER_PREVIEW_DEBOUNCE_MS)
  }

  /**
   * 预览的增/改/删：勾选 = 临时加一步，调参 = 原地更新那一步，取消 = 移除。
   * 这样预览走的是真实渲染管线（分块、窗口/水平、ROI 都与最终结果一致）。
   */
  const syncFilterPreview = (op: ParamOp, params: Record<string, number>, on: boolean) => {
    if (!on) {
      if (filterPreviewStepId) { runtime.removeStep(filterPreviewStepId); setFilterPreviewStepId(null) }
      return
    }
    setShowOriginal(false)
    if (filterPreviewStepId) runtime.updateParams(filterPreviewStepId, params)
    // 每次重新勾选都重新取一次可见区域，跟随用户当下的缩放/滚动位置。
    else setFilterPreviewStepId(runtime.addStep(op, params, filterPreviewScope()) ?? null)
  }
  /** 调参：先记下来，正在预览就（防抖后）实时更新。 */
  const changeFilterValue = (op: ParamOp, key: string, value: number) => {
    const next = { ...filterParamValues(op), [key]: value }
    setFilterValues((current) => ({ ...current, [op]: next }))
    if (!filterPreviewStepId) return
    // 拖滑杆会连续触发。全图滤镜一次要几百毫秒，每次都排队会让手感很卡，
    // 所以停手 120ms 再更新那一步——预览仍是即时的，只是不再逐帧重算。
    if (filterPreviewTimer.current) clearTimeout(filterPreviewTimer.current)
    const stepId = filterPreviewStepId
    filterPreviewTimer.current = setTimeout(() => { filterPreviewTimer.current = null; runtime.updateParams(stepId, next) }, FILTER_PREVIEW_DEBOUNCE_MS)
  }
  /** 执行：已经在预览就直接留下那一步，否则按当前参数提交一步。 */
  const applyFilter = (op: ParamOp) => {
    setError('')
    if (filterPreviewStepId) setFilterPreviewStepId(null)
    else submit(op, filterParamValues(op), null)
    setParamCommand(null)
  }

  const stepScope = (target: RoiInput | null): StepScope => {
    // 算子作用域目前是矩形 `Region`，因此取选区包围盒；统计类走掩码语义（见 analysis.ts）。
    const bounds = target ? roiBounds(toRoi(target)) : null
    const region = image && bounds ? { start: image.axes.map((axis) => axis === 'x' ? bounds.x : axis === 'y' ? bounds.y : 0), shape: image.axes.map((axis, i) => axis === 'x' ? bounds.width : axis === 'y' ? bounds.height : image.shape[i]!) } : undefined
    if (applyAll) return region ? { kind: 'roi', region } : { kind: 'stack' }
    return { kind: 'frame', selection: { ...state.selection }, region }
  }
  const submit = (op: string, params: Record<string, number | string> = {}, target: RoiInput | null = roi) => {
    if (!image || busy) return
    setError(''); setShowOriginal(false)
    if (colorPreview.length) commitColorPreview(colorPreview, applyAll)
    const ci = image.axes.indexOf('c')
    const needsGray = getOperator(op)?.input.channels !== 'any'
    // debayer 需要单通道输入，但输出是 RGB，应保持彩色显示；其他需要灰度的算子仍先转灰度。
    const outputsRgb = op === 'debayer'
    setShowColor(outputsRgb || (op !== 'grayscale' && !needsGray))
    if (op !== 'grayscale' && !outputsRgb && needsGray && ci >= 0 && (image.shape[ci] ?? 1) > 1) runtime.addStep('grayscale', {}, stepScope(null))
    runtime.addStep(op, params, stepScope(target))
  }
  /** 打开某个命令自己的参数面板（先提交正在预览的色彩调整，并切到合适的显示模式）。 */
  const openParamCommand = (command: ParamCommand) => {
    if (!image || busy || !COMMAND_OPS[command]) return
    const op = COMMAND_OPS[command]
    if (op !== 'levels' && colorPreview.length) commitColorPreview(colorPreview, false)
    // 切换面板前先把上一个滤镜的预览步骤撤掉，否则会留在处理台账里。
    if (filterPreviewTimer.current) { clearTimeout(filterPreviewTimer.current); filterPreviewTimer.current = null }
    if (filterPreviewStepId) { runtime.removeStep(filterPreviewStepId); setFilterPreviewStepId(null) }
    setShowOriginal(false); setShowColor(op !== 'threshold'); setParamCommand(command)
  }
  /** 命令目录点选：再点一次已展开的命令即收起。 */
  /** 执行「制作蒙太奇」；结果数据集同样交给外壳另开一个 tab。 */
  const applyMontage = async () => {
    if (!image || busy) return
    setError('')
    const montaged = await runtime.montageStack({
      from: Math.max(0, montage.start - 1),
      to: Math.min(sliceCount - 1, Math.max(montage.start - 1, montage.stop - 1)),
      increment: Math.max(1, montage.increment),
      columns: montage.columns > 0 ? montage.columns : undefined,
      rows: montage.rows > 0 ? montage.rows : undefined,
      scale: montage.scale > 0 ? montage.scale : undefined,
      borderWidth: montage.border,
      labelSlices: montage.labelSlices,
      fontSize: montage.fontSize,
    })
    setMontageOpen(false)
    if (montaged) onOpenDataset?.(montaged)
  }

  /** 执行「蒙太奇转 Stack」；结果数据集同样交给外壳另开一个 tab。 */
  const applyMontageToStack = async () => {
    if (!image || busy) return
    setError('')
    const stacked = await runtime.montageToStack({
      columns: montageToStack.columns > 0 ? montageToStack.columns : undefined,
      rows: montageToStack.rows > 0 ? montageToStack.rows : undefined,
      borderWidth: montageToStack.border,
    })
    setMontageToStackOpen(false)
    if (stacked) onOpenDataset?.(stacked)
  }

  /** 执行「重切」（Reslice）；结果数据集同样交给外壳另开一个 tab。 */
  const applyReslice = async () => {
    if (!image || busy) return
    setError('')
    const bounds = roi ? roiBounds(toRoi(roi)) : null
    const sliced = await runtime.resliceStack({
      bounds: bounds
        ? {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.max(1, Math.round(bounds.width)),
            height: Math.max(1, Math.round(bounds.height)),
          }
        : undefined,
      spacing: reslice.spacing,
      startAt: reslice.startAt as 'top' | 'left' | 'bottom' | 'right',
      flip: reslice.flip,
      rotate: reslice.rotate,
    })
    setResliceOpen(false)
    if (sliced) onOpenDataset?.(sliced)
  }

  /** 执行「正交视图」：XZ 与 YZ 各开一个新 tab。 */
  const applyOrthogonalViews = async () => {
    if (!image || busy) return
    setError('')
    const views = await runtime.orthogonalViews({ point: orthogonalPoint })
    setOrthogonalOpen(false)
    for (const view of views) onOpenDataset?.(view)
  }

  /** 执行一次结构编辑（Reverse / Reduce / Substack / Delete / Add）；结果数据集另开一个 tab。 */
  const applyRestructure = async (
    op: 'reverse' | 'reduce' | 'substack' | 'delete' | 'add',
    options: { factor?: number; pages?: number[]; at?: number; count?: number } = {},
  ) => {
    if (!image || busy) return
    setError('')
    const restructured = await runtime.restructureStack({ op, ...options })
    setReduceOpen(false)
    setSubstackOpen(false)
    if (restructured) onOpenDataset?.(restructured)
    else setError(copy.stackOps.needsStack)
  }
  /** 「蒙太奇工具…」：按新行列重排当前蒙太奇图，结果另开一个 tab。 */
  const applyRemontage = async () => {
    if (!image || busy) return
    setError('')
    const remontaged = await runtime.remontageStack({
      columns: remontage.columns,
      rows: remontage.rows,
      sourceColumns: remontage.sourceColumns || undefined,
      sourceRows: remontage.sourceRows || undefined,
      borderWidth: remontage.border,
      labelSlices: remontage.labelSlices,
      fontSize: remontage.fontSize,
    })
    setRemontageOpen(false)
    if (remontaged) onOpenDataset?.(remontaged)
  }
  /** 「3D 投影…」：逐角度旋转投影，结果数据集另开一个 tab。 */
  const applyProject3d = async () => {
    if (!image || busy) return
    setError('')
    const projected = await runtime.project3dStack({
      method: project3d.method as 'nearest' | 'brightest' | 'mean',
      axis: project3d.axis as 'x' | 'y' | 'z',
      initialAngle: project3d.initialAngle,
      totalRotation: project3d.totalRotation,
      angleIncrement: project3d.angleIncrement,
      opacity: project3d.opacity,
      surfaceCueing: project3d.surfaceCueing,
      interiorCueing: project3d.interiorCueing,
      from: 0,
      to: sliceCount - 1,
    })
    setProject3dOpen(false)
    if (projected) onOpenDataset?.(projected)
  }
  /** 「标注切片…」：按格式把文本画进像素，结果数据集另开一个 tab。 */
  const applyAnnotate = async () => {
    if (!image || busy) return
    setError('')
    const labelled = await runtime.labelStack({
      format: annotate.format as 'number' | 'zero-padded' | 'mm:ss' | 'hh:mm:ss' | 'text' | 'label',
      start: annotate.start,
      interval: annotate.interval,
      text: annotate.text,
      x: annotate.x,
      y: annotate.y,
      fontSize: annotate.fontSize,
    })
    setAnnotateOpen(false)
    if (labelled) onOpenDataset?.(labelled)
  }
  /** 「插入图像…」/「合并拼接…」：把当前文档与所选文档合成一个新数据集。 */
  const applyCombine = async () => {
    if (!image || busy || !combineSource) return
    setError('')
    const combined = await runtime.combineStacks(combineOp === 'insert'
      ? { op: 'insert', otherDatasetId: combineSource, x: insertX, y: insertY }
      : { op: 'combine', otherDatasetId: combineSource, vertical: combineVertical })
    setCombineOpen(false)
    if (combined) onOpenDataset?.(combined)
  }
  /** 「首尾拼接」：把当前文档与其它已打开文档按顺序拼成一个栈。 */
  const applyConcatenate = async (datasetIds: readonly string[]) => {
    if (!image || busy) return
    setError('')
    const combined = await runtime.combineStacks({ op: 'concatenate', datasetIds: [...datasetIds] })
    if (combined) onOpenDataset?.(combined)
  }
  /** 「抽稀…」：步长来自面板。 */
  const applyReduce = () => void applyRestructure('reduce', { factor: reduceFactor })
  /** 「子栈…」：解析切片表达式后执行。 */
  const applySubstack = () => {
    const pages = parseSliceList(substackPages, sliceCount)
    if (pages.length === 0) { setError(`${copy.stackOps.pagesHint}`); return }
    void applyRestructure('substack', { pages })
  }

  /** 关闭命令目录里所有可能展开的面板；同一时刻只允许一个命令展开。 */
  const closeCommandPanels = () => {
    closeParamCommand()
    setProjectCommand(null)
    setMontageOpen(false)
    setMontageToStackOpen(false)
    setResliceOpen(false)
    setOrthogonalOpen(false)
    setReduceOpen(false)
    setSubstackOpen(false)
    setCombineOpen(false)
    setAnimationOpen(false)
    setLabelOpen(false)
    setAnnotateOpen(false)
    setProject3dOpen(false)
    setRemontageOpen(false)
  }

  /** 命令目录点选：再点一次已展开的命令即收起。 */
  const toggleParamCommand = (command: string) => {
    if (command === 'Magic Montage Tools') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen(false)
      setReduceOpen(false)
      setSubstackOpen(false)
      setCombineOpen(false)
      setAnimationOpen(false)
      setLabelOpen(false)
      setAnnotateOpen(false)
      setProject3dOpen(false)
      setRemontageOpen((current) => !current)
      setRemontage((current) => ({
        ...current,
        sourceColumns: current.sourceColumns || Number(state.dataset?.metadata.montageColumns ?? 0) || 2,
        sourceRows: current.sourceRows || Number(state.dataset?.metadata.montageRows ?? 0) || 2,
      }))
      return
    }
    if (command === '3D Project...') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen(false)
      setReduceOpen(false)
      setSubstackOpen(false)
      setCombineOpen(false)
      setAnimationOpen(false)
      setLabelOpen(false)
      setAnnotateOpen(false)
      setProject3dOpen((current) => !current)
      return
    }
    if (command === 'Label...') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen(false)
      setReduceOpen(false)
      setSubstackOpen(false)
      setCombineOpen(false)
      setAnimationOpen(false)
      setLabelOpen(false)
      setAnnotateOpen((current) => !current)
      return
    }
    if (command === 'Set Label...') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen(false)
      setReduceOpen(false)
      setSubstackOpen(false)
      setCombineOpen(false)
      setAnimationOpen(false)
      setLabelOpen((current) => !current)
      setLabelValue(runtime.sliceLabel(pageIndex))
      return
    }
    if (command === 'Animation Options...') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen(false)
      setReduceOpen(false)
      setSubstackOpen(false)
      setCombineOpen(false)
      setAnimationOpen((current) => !current)
      setAnimation((current) => ({ ...current, first: current.first || 1, last: current.last || sliceCount }))
      return
    }
    if (command === 'Insert...' || command === 'Combine...') {
      const documents = onListDocuments?.() ?? []
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen(false)
      setReduceOpen(false)
      setSubstackOpen(false)
      setCombineDocuments(documents)
      setCombineSource((current) => documents.some((entry) => entry.id === current) ? current : documents[0]?.id ?? '')
      setCombineOp(command === 'Insert...' ? 'insert' : 'combine')
      setCombineOpen((current) => !current)
      return
    }
    if (command === 'Reduce...') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen(false)
      setSubstackOpen(false)
      setReduceOpen((current) => !current)
      return
    }
    if (command === 'Make Substack...') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen(false)
      setReduceOpen(false)
      setSubstackOpen((current) => !current)
      setSubstackPages((current) => current || `1-${sliceCount}`)
      return
    }
    if (command === 'Orthogonal Views') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      const next = !orthogonalOpen
      setOrthogonalOpen(next)
      if (next) {
        setOrthogonalPoint({
          x: Math.max(0, Math.round(((current?.width ?? 1) - 1) / 2)),
          y: Math.max(0, Math.round(((current?.height ?? 1) - 1) / 2)),
        })
      }
      return
    }
    if (command === 'Reslice [/]...') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setOrthogonalOpen(false)
      setResliceOpen((current) => !current)
      return
    }
    if (command === 'Montage to Stack...') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen(false)
      setMontageToStackOpen((current) => !current)
      return
    }
    if (command === 'Make Montage...') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen(false)
      setMontageOpen((current) => !current)
      setMontage((current) => ({ ...current, start: 1, stop: sliceCount, increment: 1 }))
      return
    }
    if ((PROJECT_COMMANDS as readonly string[]).includes(command)) {
      const next = command as ProjectCommand
      closeParamCommand()
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen(false)
      setProjectCommand((current) => (current === next ? null : next))
      setProjectionStart(1)
      setProjectionStop(sliceCount)
      setProjectionGroup(Math.max(1, Math.min(2, sliceCount)))
      return
    }
    setProjectCommand(null)
    setMontageOpen(false)
    setMontageToStackOpen(false)
    setResliceOpen(false)
    setOrthogonalOpen(false)
    if (paramCommand === command) { closeParamCommand(); return }
    openParamCommand(command as ParamCommand)
  }
  const runCommand = (op: string) => {
    if (!image || busy) return
    if (op === 'levels' || op === 'threshold' || op === 'gaussian' || op === 'debayer') { openParamCommand(OP_COMMANDS[op]); return }
    if (op === 'crop') {
      if (stack) { setError(copy.stack.geometryUnavailable); return }
      if (!roi) { setError(copy.errors.needsRoi); return }
      submit(op, { ...roiBounds(roi) }, null); setRoi(null); return
    }
    if (op === 'rotateCW' || op === 'rotateCCW') {
      if (stack) { setError(copy.stack.geometryUnavailable); return }
      submit(op, {}, null); setRoi(null); return
    }
    submit(op, {}, op === 'grayscale' ? null : roi)
  }
  /** 矩形 ROI → 引擎侧区域（与 `stepScope` 的换算一致）。 */
  const roiRegion = (target: RoiInput | null) => {
    const bounds = image && target ? roiBounds(toRoi(target)) : null
    return bounds
      ? {
          start: image!.axes.map((axis) => (axis === 'x' ? bounds.x : axis === 'y' ? bounds.y : 0)),
          shape: image!.axes.map((axis, index) => (axis === 'x' ? bounds.width : axis === 'y' ? bounds.height : image!.shape[index]!)),
        }
      : undefined
  }
  /** 线 / 折线选区 → 引擎侧采样点；矩形选区返回 undefined，走矩形中线口径。 */
  const lineSamplePoints = (target: RoiInput | null): { points: number[]; closed?: boolean } | undefined => {
    if (!target || !isRoi(target)) return undefined
    if (target.kind === 'line') return { points: roiPoints(target) }
    if (target.kind === 'polyline' || target.kind === 'polygon' || target.kind === 'freehand') {
      return { points: roiPoints(target), closed: target.kind === 'polygon' }
    }
    return undefined
  }
  /**
   * Image ▸ Stacks 的跨帧命令。
   *
   * Z 投影两项先展开参数面板；Plot Z-axis Profile / Measure Stack / Statistics 共用一次
   * `runtime.measureStack()`，只是各自打开不同的视图卡片（同一份逐页统计的三种呈现）。
   */
  const runStackCommand = (command: string) => {
    if (!image || busy) return
    if (command === 'montage-to-stack') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen((current) => !current)
      return
    }
    if (command === 'orthogonal-views') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen((current) => !current)
      // 交叉点缺省取图像中心，与 ImageJ 的初始位置一致。
      setOrthogonalPoint({
        x: Math.max(0, Math.round(((current?.width ?? 1) - 1) / 2)),
        y: Math.max(0, Math.round(((current?.height ?? 1) - 1) / 2)),
      })
      return
    }
    if (command === 'reslice') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setOrthogonalOpen(false)
      setResliceOpen((current) => !current)
      return
    }
    if (command === 'montage') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setMontageOpen((current) => !current)
      setMontage((current) => ({ ...current, start: 1, stop: sliceCount, increment: 1 }))
      return
    }
    if (command === 'z-project' || command === 'grouped-z-project') {
      const grouped = command === 'grouped-z-project'
      closeParamCommand()
      setProjectCommand((active) => (active === (grouped ? 'Grouped Z Project...' : 'Z Project...') ? null : grouped ? 'Grouped Z Project...' : 'Z Project...'))
      setProjectionStart(1)
      setProjectionStop(sliceCount)
      setProjectionGroup(Math.max(1, Math.min(2, sliceCount)))
      return
    }
    if (command === 'remove-slice-labels') {
      runtime.clearSliceLabels()
      setLabelOpen(false)
      return
    }
    // 动画：Start / Stop 直接切换播放状态，Options 由可展开命令处理。
    if (command === 'animation-start') {
      if (sliceCount < 2) { setError(copy.stackOps.needsStack); return }
      setError('')
      setAnimation((current) => ({ ...current, running: true, first: current.first || 1, last: current.last || sliceCount, forward: true }))
      return
    }
    if (command === 'animation-stop') {
      setAnimation((current) => ({ ...current, running: false }))
      return
    }
    // 跨文档合成：Insert / Combine 先选来源文档，Concatenate 直接拼接全部已打开文档。
    if (command === 'insert' || command === 'combine') {
      const documents = onListDocuments?.() ?? []
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen(false)
      setReduceOpen(false)
      setSubstackOpen(false)
      setCombineDocuments(documents)
      setCombineSource((current) => documents.some((entry) => entry.id === current) ? current : documents[0]?.id ?? '')
      setCombineOp(command === 'insert' ? 'insert' : 'combine')
      setInsertX(0)
      setInsertY(0)
      // 再点一次同一个命令即收起（面板已经没有 ✕ 了）。
      setCombineOpen((current) => (combineOp === (command === 'insert' ? 'insert' : 'combine') ? !current : true))
      return
    }
    if (command === 'concatenate') {
      const datasetId = state.dataset?.id
      const others = (onListDocuments?.() ?? []).map((entry) => entry.id)
      if (!datasetId || others.length === 0) { setError(copy.stackOps.needSecondDocument); return }
      void applyConcatenate([datasetId, ...others])
      return
    }
    // 结构编辑类命令：Reverse / Add / Delete 直接执行，Reduce 与子栈先开参数面板。
    if (command === 'reverse') { void applyRestructure('reverse'); return }
    if (command === 'add-slice') { void applyRestructure('add', { at: pageIndex + 1, count: 1 }); return }
    if (command === 'delete-slice') {
      if (sliceCount < 2) { setError(copy.stackOps.needsStack); return }
      void applyRestructure('delete', { pages: [pageIndex] })
      return
    }
    if (command === 'reduce') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen(false)
      setSubstackOpen(false)
      setReduceOpen((current) => !current)
      return
    }
    if (command === 'substack') {
      closeParamCommand()
      setProjectCommand(null)
      setMontageOpen(false)
      setMontageToStackOpen(false)
      setResliceOpen(false)
      setOrthogonalOpen(false)
      setReduceOpen(false)
      setSubstackOpen((current) => !current)
      setSubstackPages(`1-${sliceCount}`)
      return
    }
    // 只有参数面板、没有独立执行流程的命令（命令目录里点开它们的下拉）。
    // 统一在这里处理，避免每个命令再抄一遍"关掉其它所有面板"。
    const PANEL_ONLY = new Set(['animation-options', 'set-label', 'label', 'project-3d', 'magic-montage'])
    if (PANEL_ONLY.has(command)) {
      // 先记住它原本是否展开：closeCommandPanels() 会把目标也置为关闭，
      // 之后再取反就永远得到 true（永远关不掉）。已展开就只收起。
      const wasOpen =
        command === 'animation-options' ? animationOpen
        : command === 'set-label' ? labelOpen
        : command === 'label' ? annotateOpen
        : command === 'project-3d' ? project3dOpen
        : remontageOpen
      closeCommandPanels()
      if (wasOpen) return
      if (command === 'animation-options') {
        setAnimationOpen(true)
        setAnimation((current) => ({ ...current, first: current.first || 1, last: current.last || sliceCount }))
      } else if (command === 'set-label') {
        setLabelOpen(true)
        setLabelValue(runtime.sliceLabel(pageIndex))
      } else if (command === 'label') setAnnotateOpen(true)
      else if (command === 'project-3d') setProject3dOpen(true)
      else {
        setRemontageOpen(true)
        setRemontage((current) => ({
          ...current,
          sourceColumns: current.sourceColumns || Number(state.dataset?.metadata.montageColumns ?? 0) || 2,
          sourceRows: current.sourceRows || Number(state.dataset?.metadata.montageRows ?? 0) || 2,
        }))
      }
      return
    }
    const view = STACK_VIEW_COMMANDS[command]
    if (!view) return
    if (sliceCount < 2) { setError(copy.stackOps.needsStack); return }
    setError('')
    analysisViews.add(view)
    // Plot XY Profile 取逐页剖面（线选区沿线采样）；其余三个共用一次整栈统计。
    if (command === 'plot-xy-profile') {
      void runtime.loadStackProfiles({ roi: roiRegion(roi), line: lineSamplePoints(roi) })
      return
    }
    void runtime.measureStack(roiRegion(roi))
  }
  /** 执行 Z 投影；结果数据集交给外壳另开一个 tab（当前文档不变）。 */
  const applyProjection = async (grouped: boolean) => {
    if (!image || busy) return
    // 与 ImageJ 的 GroupedZProjector 一致：组大小必须整除页数，先在这里拦下并给出合法取值。
    if (grouped && projectionGroup > 1 && sliceCount % projectionGroup !== 0) {
      setError(`${copy.stackOps.groupHint}（${copy.stackOps.factors}: ${groupSizeFactors(sliceCount).join(', ')}）`)
      return
    }
    setError('')
    const projected = await runtime.projectStack({
      method: projectionMethod,
      from: grouped ? 0 : projectionStart - 1,
      to: grouped ? sliceCount - 1 : projectionStop - 1,
      groupSize: grouped ? projectionGroup : undefined,
      allTimeFrames: grouped ? false : projectionAllTime,
      roi: roiRegion(roi),
    })
    setProjectCommand(null)
    if (projected) onOpenDataset?.(projected)
  }
  /** 「白平衡」：按所选调色算法往处理链加一步 colorGrading（纯调色，非显示范围）。 */
  const applyColorGrading = () => {
    if (!hasImage || busy) return
    setError('')
    if (gradingPreviewStepId.current) {
      // 预览已经是处理链里的一步：停止跟踪它就等于「固化」，不需要再加一步。
      gradingPreviewStepId.current = null
      return
    }
    runtime.addStep('colorGrading', {
      method: gradingMethod,
      clipPercent: gradingClip,
      strength: gradingStrength,
      gainR: gradingGains[0],
      gainG: gradingGains[1],
      gainB: gradingGains[2],
    }, stepScope(null))
    // 应用后不收起面板：白平衡通常要连着试几种方法/参数，收起反而碍事（再点一次命令项即可收起）。
  }

  const commitColorPreview = (settings: readonly ColorAdjustment[], allPages: boolean) => {
    if (!image || busy) return
    for (const adjustment of settings) {
      const scope = stepScope(adjustment.roi ?? null)
      const region = scope.kind === 'frame' || scope.kind === 'roi' ? scope.region : undefined
      const target: StepScope = allPages ? region ? { kind: 'roi', region } : { kind: 'stack' } : { kind: 'frame', selection: { ...state.selection }, region }
      runtime.addStep('levels', { mode: 'rgb-range', minimum: adjustment.min, maximum: adjustment.max, channel: adjustment.channel }, target)
    }
    setColorPreview([])
  }
  const selectAxis = (axis: 't' | 'c' | 'z', index: number) => { if (colorPreview.length) commitColorPreview(colorPreview, false); runtime.setSelection({ [axis]: index }) }
  const closeParamCommand = () => {
    if (filterPreviewTimer.current) { clearTimeout(filterPreviewTimer.current); filterPreviewTimer.current = null }
    if (filterScopeTimer.current) { clearTimeout(filterScopeTimer.current); filterScopeTimer.current = null }
    if (colorPreview.length) commitColorPreview(colorPreview, false)
    // 关面板时把预览步骤一并撤销，避免留下一步"没人认领"的处理。
    if (filterPreviewStepId) { runtime.removeStep(filterPreviewStepId); setFilterPreviewStepId(null) }
    setParamCommand(null)
  }
  /**
   * Original 对比按需取帧。
   *
   * 旧实现在每次切片切换时都调 `readSourceFrame()`：那是一次完整的空 Recipe 执行，
   * 会把整页像素重新读一遍并跨线程传回主线程，再触发一次全量重渲染 ——
   * 对大页（4096² uint16 合 33.5 MB）而言，这一步比翻页本身还贵。
   */
  const toggleOriginal = () => {
    closeParamCommand()
    if (showOriginal) { setShowOriginal(false); return }
    setShowOriginal(true)
    if (original) return
    const request = ++originalRequest.current
    void runtime.readSourceFrame()
      .then((block) => { if (originalRequest.current === request) setOriginal(block) })
      .catch((error: unknown) => { if (originalRequest.current === request) setError(String(error)) })
  }
  const applyCurrentThreshold = () => submit('threshold', { level: thresholdLevel })
  const applyOtsu = () => submit('otsu')
  const undo = () => { setError(''); setShowOriginal(false); setShowColor(true); setColorPreview([]); setColorSession((value) => value + 1); if (!colorPreview.length) runtime.undo() }
  const redo = () => { setError(''); setShowOriginal(false); setShowColor(true); setColorPreview([]); setColorSession((value) => value + 1); runtime.redo() }
  const zoomByStep = (direction: 1 | -1) => viewportRef.current?.zoomBy(direction > 0 ? 1.25 : 0.8)
  const fitToWindow = () => viewportRef.current?.fit()
  const showActualSize = () => viewportRef.current?.actualSize()
  const analyzeCurrentParticles = () => analysisViews.add('particles')
  const viewTitle = (type: ViewType) => type === 'particles' && particles ? `${copy.views.particles} · ${particles.length}` : copy.views[type]
  // 不再去重：同一种视图允许并存（配合各自的 Live 状态做对照）。
  const addView = (type: ViewType) => analysisViews.add(type)
  const removeView = (id: number) => analysisViews.remove(id)
  const exportParticlesCsv = () => {
    if (!particles) return
    const lines = ['id,area,perimeter,circularity,centroid_x,centroid_y,bounds_x,bounds_y,bounds_width,bounds_height', ...particles.map((p) => [p.id,p.area,p.perimeter,p.circularity,p.centroidX,p.centroidY,p.bounds.x,p.bounds.y,p.bounds.width,p.bounds.height].join(','))]
    download(new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }), `${sourceName.replace(/\.[^.]+$/, '')}-particles.csv`)
  }
  const exportPng = async () => {
    if (!displayBlock) return
    setError(''); setExporting(true)
    try {
      const { encodeImageBlock } = await import('../engine/compute/itk')
      const bytes = await encodeImageBlock(toDisplayBlock(displayBlock, baselineWindow, rasterOptions), 'image/png')
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/png' })
      download(blob, `${sourceName.replace(/\.[^.]+$/, '')}-result.png`)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setExporting(false) }
  }
  const downloadTiff = async (allPages: boolean) => {
    if (!image) return
    setError(''); setExporting(true)
    try {
      if (allPages && colorPreview.length) { commitColorPreview(colorPreview, false); await runtime.run() }
      const frames = allPages ? runtime.exportFrames() : (async function* () { yield isRgb && colorPreview.length ? applyColorAdjustments(image, colorPreview) : image })()
      const blob = await encodeTiffStack(frames, allPages ? frameCount : 1)
      download(blob, `${sourceName.replace(/\.[^.]+$/, '')}-${allPages ? 'stack' : 'result'}.tif`)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setExporting(false) }
  }
  // 剖面图卡片：ROI 水平中线（无选区时为图像中线）上的灰度曲线。
  useEffect(() => {
    const canvas = profileCanvasRef.current
    if (!canvas) return

    const draw = () => {
      const prepared = prepareChartCanvas(canvas, 96)
      if (!prepared) return
      const { context, width: cssWidth } = prepared
      const cssHeight = 96
      const padLeft = 6
      const padRight = 6
      const padTop = 14
      const padBottom = 16
      const plotWidth = cssWidth - padLeft - padRight
      const plotHeight = cssHeight - padTop - padBottom
      const styles = getComputedStyle(canvas)
      const foreground = styles.getPropertyValue('--foreground').trim() || '#111111'
      const primary = styles.getPropertyValue('--primary').trim() || '#3b82f6'

      // y 轴网格 255 / 128 / 0
      context.strokeStyle = foreground
      context.lineWidth = 1
      for (const value of [stats?.histogramMax ?? 255, ((stats?.histogramMin ?? 0) + (stats?.histogramMax ?? 255)) / 2, stats?.histogramMin ?? 0]) {
        const y = Math.round(padTop + plotHeight * (1 - (value - (stats?.histogramMin ?? 0)) / ((stats?.histogramMax ?? 255) - (stats?.histogramMin ?? 0) || 1))) + 0.5
        context.globalAlpha = value === 128 ? 0.1 : 0.16
        context.beginPath()
        context.moveTo(padLeft, y)
        context.lineTo(padLeft + plotWidth, y)
        context.stroke()
      }
      context.globalAlpha = 1

      context.font = '9px ui-monospace, SFMono-Regular, monospace'
      context.fillStyle = foreground
      context.globalAlpha = 0.55
      context.textAlign = 'right'
      context.fillText(String(stats?.histogramMax ?? 255), padLeft + plotWidth, padTop - 5)
      context.fillText(String(stats?.histogramMin ?? 0), padLeft + plotWidth, cssHeight - 5)

      const values = profileData
      if (values && values.length >= 2) {
        const stepX = plotWidth / (values.length - 1)
        const pointX = (index: number) => padLeft + index * stepX
        const pointY = (value: number) => padTop + plotHeight * (1 - (value - (stats?.histogramMin ?? 0)) / ((stats?.histogramMax ?? 255) - (stats?.histogramMin ?? 0) || 1))

        // 面积填充
        context.beginPath()
        context.moveTo(pointX(0), padTop + plotHeight)
        for (let i = 0; i < values.length; i += 1) context.lineTo(pointX(i), pointY(values[i]))
        context.lineTo(pointX(values.length - 1), padTop + plotHeight)
        context.closePath()
        context.fillStyle = primary
        context.globalAlpha = 0.12
        context.fill()
        context.globalAlpha = 1

        // 曲线
        context.beginPath()
        for (let i = 0; i < values.length; i += 1) {
          const x = pointX(i)
          const y = pointY(values[i])
          if (i === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        }
        context.strokeStyle = primary
        context.lineWidth = 1.5
        context.lineJoin = 'round'
        context.stroke()

        // 峰值与线长标注
        let peak = 0
        for (const value of values) if (value > peak) peak = value
        context.fillStyle = foreground
        context.globalAlpha = 0.55
        context.textAlign = 'left'
        context.fillText(String(peak), padLeft, padTop - 5)
        context.textAlign = 'center'
        context.fillText(`${values.length} px`, padLeft + plotWidth / 2, cssHeight - 5)
      }
      context.globalAlpha = 1
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [profileData, stats, views])

  /* ---------------- 左栏：命令项下方内联展开的操作面板（同一时刻只展开一个命令） ---------------- */

  // 白平衡只在 RGB 图上可用；灰度图下它保持「尚未接入」的禁用态。
  const expandableCommands = useMemo<string[]>(
    () => [
      ...(isRgb ? ['Brightness/Contrast', 'White Balance'] : ['Brightness/Contrast']),
      'Threshold', 'Debayer', ...FILTER_COMMANDS,
      // Z 投影只在多页 Stack 上有意义。
      ...(stack ? [...PROJECT_COMMANDS, 'Make Montage...'] : []),
      // 蒙太奇转 Stack 作用于单张蒙太奇图，不要求多页栈。
      'Montage to Stack...',
      'Reslice [/]...',
      // 正交视图需要 Z 方向有多个切片。
      ...(stack ? ['Orthogonal Views'] : []),
      // 结构编辑：Reverse / Add Slice / Delete Slice 点了直接执行、没有参数面板，
      // 所以不列在这里（列了会让命令项带一个点不开的 ▸）。Reduce 与子栈有面板。
      ...(hasSliceAxis ? ['Reduce...', 'Make Substack...'] : []),
      // 跨文档合成：来源文档在面板里选。
      'Insert...', 'Combine...',
      // 动画选项与切片标签：都要有切片轴才有意义。
      ...(hasSliceAxis ? ['Animation Options...', 'Set Label...', 'Label...', '3D Project...', 'Magic Montage Tools'] : []),
    ],
    [isRgb, stack, hasSliceAxis],
  )
  /** 蒙太奇元数据提示：说明这张图的行列，供「蒙太奇转 Stack」沿用。 */
  const montageHint = state.dataset?.metadata?.montageColumns !== undefined
    ? `${copy.stackOps.columns} / ${copy.stackOps.rows}: ${String(state.dataset.metadata.montageColumns)} × ${String(state.dataset.metadata.montageRows ?? '?')}`
    : ''
  const panel: ReactNode = remontageOpen
    ? <RemontageCommandPanel
        copy={copy}
        sourceColumns={remontage.sourceColumns}
        sourceRows={remontage.sourceRows}
        columns={remontage.columns}
        rows={remontage.rows}
        border={remontage.border}
        labelSlices={remontage.labelSlices}
        fontSize={remontage.fontSize}
        hint={montageHint}
        disabled={!hasImage || busy}
        onSourceColumns={(value) => setRemontage((current) => ({ ...current, sourceColumns: value }))}
        onSourceRows={(value) => setRemontage((current) => ({ ...current, sourceRows: value }))}
        onColumns={(value) => setRemontage((current) => ({ ...current, columns: value }))}
        onRows={(value) => setRemontage((current) => ({ ...current, rows: value }))}
        onBorder={(value) => setRemontage((current) => ({ ...current, border: value }))}
        onLabelSlices={(value) => setRemontage((current) => ({ ...current, labelSlices: value }))}
        onFontSize={(value) => setRemontage((current) => ({ ...current, fontSize: value }))}
        onApply={() => void applyRemontage()}
        onClose={() => setRemontageOpen(false)}
      />
    : project3dOpen
    ? <Project3dCommandPanel
        copy={copy}
        method={project3d.method}
        axis={project3d.axis}
        initialAngle={project3d.initialAngle}
        totalRotation={project3d.totalRotation}
        angleIncrement={project3d.angleIncrement}
        opacity={project3d.opacity}
        surfaceCueing={project3d.surfaceCueing}
        interiorCueing={project3d.interiorCueing}
        angleCount={Math.max(1, Math.floor(Math.abs(project3d.totalRotation) / Math.max(1, Math.abs(project3d.angleIncrement) || 10)) + 1)}
        disabled={!hasImage || busy}
        onMethod={(value) => setProject3d((current) => ({ ...current, method: value }))}
        onAxis={(value) => setProject3d((current) => ({ ...current, axis: value }))}
        onInitialAngle={(value) => setProject3d((current) => ({ ...current, initialAngle: value }))}
        onTotalRotation={(value) => setProject3d((current) => ({ ...current, totalRotation: value }))}
        onAngleIncrement={(value) => setProject3d((current) => ({ ...current, angleIncrement: value }))}
        onOpacity={(value) => setProject3d((current) => ({ ...current, opacity: value }))}
        onSurfaceCueing={(value) => setProject3d((current) => ({ ...current, surfaceCueing: value }))}
        onInteriorCueing={(value) => setProject3d((current) => ({ ...current, interiorCueing: value }))}
        onApply={() => void applyProject3d()}
        onClose={() => setProject3dOpen(false)}
      />
    : annotateOpen
    ? <LabelCommandPanel
        copy={copy}
        format={annotate.format}
        start={annotate.start}
        interval={annotate.interval}
        text={annotate.text}
        x={annotate.x}
        y={annotate.y}
        fontSize={annotate.fontSize}
        disabled={!hasImage || busy}
        onFormat={(value) => setAnnotate((current) => ({ ...current, format: value }))}
        onStart={(value) => setAnnotate((current) => ({ ...current, start: value }))}
        onInterval={(value) => setAnnotate((current) => ({ ...current, interval: value }))}
        onText={(value) => setAnnotate((current) => ({ ...current, text: value }))}
        onX={(value) => setAnnotate((current) => ({ ...current, x: value }))}
        onY={(value) => setAnnotate((current) => ({ ...current, y: value }))}
        onFontSize={(value) => setAnnotate((current) => ({ ...current, fontSize: value }))}
        onApply={() => void applyAnnotate()}
        onClose={() => setAnnotateOpen(false)}
      />
    : labelOpen
    ? <SetLabelCommandPanel
        copy={copy}
        value={labelValue}
        sliceNumber={pageIndex + 1}
        disabled={!hasImage || busy}
        onChange={setLabelValue}
        onApply={() => { runtime.setSliceLabel(pageIndex, labelValue.trim()); setLabelOpen(false) }}
        onClear={() => { runtime.clearSliceLabels(); setLabelValue(''); setLabelOpen(false) }}
        onClose={() => setLabelOpen(false)}
      />
    : animationOpen
    ? <AnimationCommandPanel
        copy={copy}
        fps={animation.fps}
        first={animation.first || 1}
        last={animation.last || sliceCount}
        loop={animation.loop}
        running={animation.running}
        sliceCount={sliceCount}
        disabled={!hasImage || busy}
        onFps={(value) => setAnimation((current) => ({ ...current, fps: value }))}
        onFirst={(value) => setAnimation((current) => ({ ...current, first: value }))}
        onLast={(value) => setAnimation((current) => ({ ...current, last: value }))}
        onLoop={(value) => setAnimation((current) => ({ ...current, loop: value }))}
        onStart={() => setAnimation((current) => ({ ...current, running: true, forward: true }))}
        onStop={() => setAnimation((current) => ({ ...current, running: false }))}
        onClose={() => setAnimationOpen(false)}
      />
    : combineOpen
    ? <CombineCommandPanel
        copy={copy}
        op={combineOp}
        documents={combineDocuments}
        source={combineSource}
        x={insertX}
        y={insertY}
        vertical={combineVertical}
        disabled={!hasImage || busy}
        onSource={setCombineSource}
        onX={setInsertX}
        onY={setInsertY}
        onVertical={setCombineVertical}
        onApply={() => void applyCombine()}
        onClose={() => setCombineOpen(false)}
      />
    : reduceOpen
    ? <ReduceCommandPanel
        copy={copy}
        factor={reduceFactor}
        sliceCount={sliceCount}
        disabled={!hasImage || busy}
        onFactor={setReduceFactor}
        onApply={applyReduce}
        onClose={() => setReduceOpen(false)}
      />
    : substackOpen
      ? <SubstackCommandPanel
          copy={copy}
          value={substackPages}
          sliceCount={sliceCount}
          disabled={!hasImage || busy}
          onChange={setSubstackPages}
          onApply={applySubstack}
          onClose={() => setSubstackOpen(false)}
        />
    : orthogonalOpen
    ? <OrthogonalCommandPanel
        copy={copy}
        x={orthogonalPoint.x}
        y={orthogonalPoint.y}
        width={current?.width ?? 1}
        height={current?.height ?? 1}
        disabled={!hasImage || busy}
        onX={(value) => setOrthogonalPoint((point) => ({ ...point, x: value }))}
        onY={(value) => setOrthogonalPoint((point) => ({ ...point, y: value }))}
        onApply={() => void applyOrthogonalViews()}
        onClose={() => setOrthogonalOpen(false)}
      />
    : resliceOpen
      ? <ResliceCommandPanel
        copy={copy}
        spacing={reslice.spacing}
        startAt={reslice.startAt}
        flip={reslice.flip}
        rotate={reslice.rotate}
        hasRoi={Boolean(roi)}
        disabled={!hasImage || busy}
        onSpacing={(value) => setReslice((current) => ({ ...current, spacing: value }))}
        onStartAt={(value) => setReslice((current) => ({ ...current, startAt: value }))}
        onFlip={(value) => setReslice((current) => ({ ...current, flip: value }))}
        onRotate={(value) => setReslice((current) => ({ ...current, rotate: value }))}
        onApply={() => void applyReslice()}
        onClose={() => setResliceOpen(false)}
      />
    : montageToStackOpen
      ? <MontageToStackCommandPanel
        copy={copy}
        columns={montageToStack.columns}
        rows={montageToStack.rows}
        border={montageToStack.border}
        hint={montageHint}
        disabled={!hasImage || busy}
        onColumns={(value) => setMontageToStack((current) => ({ ...current, columns: value }))}
        onRows={(value) => setMontageToStack((current) => ({ ...current, rows: value }))}
        onBorder={(value) => setMontageToStack((current) => ({ ...current, border: value }))}
        onApply={() => void applyMontageToStack()}
        onClose={() => setMontageToStackOpen(false)}
      />
    : montageOpen
      ? <MontageCommandPanel
        copy={copy}
        columns={montage.columns}
        rows={montage.rows}
        scale={montage.scale}
        border={montage.border}
        start={montage.start}
        stop={montage.stop}
        increment={montage.increment}
        sliceCount={sliceCount}
        labelSlices={montage.labelSlices}
        fontSize={montage.fontSize}
        disabled={!hasImage || busy}
        onColumns={(value) => setMontage((current) => ({ ...current, columns: value }))}
        onRows={(value) => setMontage((current) => ({ ...current, rows: value }))}
        onScale={(value) => setMontage((current) => ({ ...current, scale: value }))}
        onBorder={(value) => setMontage((current) => ({ ...current, border: value }))}
        onStart={(value) => setMontage((current) => ({ ...current, start: value }))}
        onStop={(value) => setMontage((current) => ({ ...current, stop: value }))}
        onIncrement={(value) => setMontage((current) => ({ ...current, increment: value }))}
        onLabelSlices={(value) => setMontage((current) => ({ ...current, labelSlices: value }))}
        onFontSize={(value) => setMontage((current) => ({ ...current, fontSize: value }))}
        onApply={() => void applyMontage()}
        onClose={() => setMontageOpen(false)}
      />
    : projectCommand
      ? <ZProjectCommandPanel
        copy={copy}
        grouped={projectCommand === 'Grouped Z Project...'}
        method={projectionMethod}
        start={projectionStart}
        stop={projectionStop}
        groupSize={projectionGroup}
        sliceCount={sliceCount}
        timeCount={timeCount}
        factors={groupSizeFactors(sliceCount)}
        allTimeFrames={projectionAllTime}
        disabled={!hasImage || busy}
        onMethod={(value) => setProjectionMethod(value as ProjectionMethod)}
        onStart={setProjectionStart}
        onStop={setProjectionStop}
        onGroupSize={setProjectionGroup}
        onAllTimeFrames={setProjectionAllTime}
        onApply={() => void applyProjection(projectCommand === 'Grouped Z Project...')}
        onClose={() => setProjectCommand(null)}
      />
    : paramOp === 'colorGrading'
    ? <ColorGradingPanel
        language={language}
        method={gradingMethod}
        clipPercent={gradingClip}
        strength={gradingStrength}
        gains={gradingGains}
        preview={gradingPreview}

        rgb={isRgb}
        disabled={!hasImage || busy}
        onMethod={setGradingMethod}
        onClipPercent={setGradingClip}
        onStrength={setGradingStrength}
        onGain={(channel, value) => setGradingGains((current) => [channel === 0 ? value : current[0], channel === 1 ? value : current[1], channel === 2 ? value : current[2]])}

        onPreview={setGradingPreview}
        onApply={applyColorGrading}
      />
    : paramOp === 'levels'
    ? image
      ? <ColorContrastPanel embedded session={colorSession} block={image} roi={roi ? roiBounds(roi) : null} language={language} busy={busy} hasStack={Boolean(stack)} singleChannel={!isRgb} mode={paramCommand === 'White Balance' ? 'colorBalance' : 'brightness'} onPreview={setColorPreview} onApply={commitColorPreview} onClose={closeParamCommand} />
      : null
    : paramOp === 'threshold'
      ? <ThresholdCommandPanel copy={copy} level={thresholdLevel} minimum={stats?.histogramMin ?? 0} maximum={stats?.histogramMax ?? 255} step={image?.dtype === 'float32' ? 'any' : 1} disabled={!hasImage || busy} onLevel={setThresholdLevel} onApply={applyCurrentThreshold} onOtsu={applyOtsu} onClose={closeParamCommand} />
      : paramOp && FILTER_OPS.includes(paramOp) && FILTER_FIELDS[paramOp]
        ? <FilterCommandPanel
            copy={copy}
            fields={FILTER_FIELDS[paramOp]!}
            values={filterParamValues(paramOp)}
            preview={Boolean(filterPreviewStepId)}
            disabled={!hasImage || busy}
            onValue={(key, value) => changeFilterValue(paramOp, key, value)}
            onPreview={(on) => syncFilterPreview(paramOp, filterParamValues(paramOp), on)}
            onApply={() => applyFilter(paramOp)}
            onClose={closeParamCommand}
          />
        : paramOp === 'debayer'
          ? <DebayerCommandPanel copy={copy} pattern={debayerPattern} algorithm={debayerAlgorithm} disabled={!hasImage || busy} onPattern={setDebayerPattern} onAlgorithm={setDebayerAlgorithm} onApply={() => submit('debayer', { pattern: debayerPattern, algorithm: debayerAlgorithm }, null)} onClose={closeParamCommand} />
          : null

  /* ---------------- 右栏：卡片式视图（一个卡片 = 一个可视化） ---------------- */

  const viewCards = views.length ? (
    <div className="grid gap-2">
      {views.map((card) => (
        <Card key={card.id} className="gap-1 rounded-sm border-base-300 px-1 py-1 shadow-none">
          {/* 标题行压矮：行高由 16px 的按钮容器决定，标题本身不再撑高。 */}
          <CardHeader className="flex h-4 flex-row items-center justify-between gap-1 px-0 py-0">
            <CardTitle className="text-sm font-semibold leading-none text-base-content/50">{viewTitle(card.type)}</CardTitle>
            <CardAction className="row-span-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={copy.close}
                onClick={() => removeView(card.id)}
                className="size-4 rounded-sm text-base-content/45 hover:bg-base-200 hover:text-base-content"
              >
                <X size={13} />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-1 px-0 py-0">

          {card.type === 'measurement' ? (
            !hasImage ? (
              <p className="text-sm text-base-content/55">{copy.emptyDescription}</p>
            ) : stats ? (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {[
                  [copy.stats.pixels, stats.count.toLocaleString()],
                  [copy.stats.area, stats.area.toLocaleString()],
                  [copy.stats.mean, stats.mean.toFixed(2)],
                  [copy.stats.min, String(stats.min)],
                  [copy.stats.max, String(stats.max)],
                  [copy.stats.stdDev, stats.stdDev.toFixed(2)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-2">
                    <dt className="truncate text-xs text-base-content/55">{label}</dt>
                    <dd className="font-mono text-xs font-semibold tabular-nums text-base-content">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-base-content/55">{scope === 'roi' && !roi ? copy.roi.needRoi : copy.status.loading}</p>
            )
          ) : null}

          {card.type === 'histogram' ? (
            <>
              <HistogramChart
                data={histogramFor(card.id)}
                height={96}
                color="var(--foreground)"
                labels={{ count: copy.stats.pixel, cumulative: copy.stats.cumulative, level: copy.stats.level, frequency: copy.stats.frequency, empty: currentHistogram ? '' : copy.status.loading }}
                ariaLabel={copy.views.histogram}
              />
              {/* 对齐 ImageJ 直方图窗口：Live 决定是否跟随当前切片，刷新拉一次。每张卡片独立。 */}
              <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                <label className="flex items-center gap-1.5 text-base-content/70">
                  <Checkbox checked={isHistLive(card.id)} onCheckedChange={(value) => toggleHistLive(card.id, value === true)} />
                  {copy.stats.live}
                </label>
                <Button type="button" size="sm" variant="ghost" className="h-5 px-1.5" disabled={busy || isHistLive(card.id) || !currentHistogram} onClick={() => refreshHistogram(card.id)}>
                  <RefreshCw size={12} />
                  <span className="ml-1">{copy.stats.refresh}</span>
                </Button>
              </div>
            </>
          ) : null}

          {card.type === 'profile' ? (
            <div className="grid gap-0.5">
              <canvas ref={profileCanvasRef} className="block w-full" style={{ height: 96 }} />
              <p className="text-xs text-base-content/55">{copy.views.profileNote}</p>
            </div>
          ) : null}

          {card.type === 'particles' ? (
            particles ? (
              <>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="grid gap-0.5">
                    <Label htmlFor="imagej-particle-min-area" className="text-xs">{copy.binary.minArea}</Label>
                    <Input
                      id="imagej-particle-min-area"
                      type="number"
                      min={1}
                      max={current ? current.width * current.height : undefined}
                      step={1}
                      value={minParticleArea}
                      onChange={(event) => setMinParticleArea(Math.max(1, Math.round(Number(event.target.value) || 1)))}
                      className="h-7 w-24 px-2 text-xs md:text-xs"
                    />
                  </div>
                  <Button type="button" variant="secondary" size="sm" className="h-7" onClick={analyzeCurrentParticles}>
                    {copy.binary.analyze}
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7" onClick={exportParticlesCsv}>{copy.binary.exportCsv}</Button>
                </div>
                <div className="max-h-56 overflow-auto">
                  <Table className="min-w-[280px] text-xs tabular-nums">
                    <TableHeader>
                      <TableRow className="border-base-300 hover:bg-transparent">
                        <TableHead className="h-auto p-1.5">#</TableHead>
                        <TableHead className="h-auto p-1.5">{copy.stats.area}</TableHead>
                        <TableHead className="h-auto p-1.5">{copy.binary.perimeter}</TableHead>
                        <TableHead className="h-auto p-1.5">{copy.binary.circularity}</TableHead>
                        <TableHead className="h-auto p-1.5">{copy.binary.centroid}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {particles.map((particle) => (
                        <TableRow key={particle.id} className="border-base-200">
                          <TableCell className="p-1.5">{particle.id}</TableCell>
                          <TableCell className="p-1.5">{particle.area}</TableCell>
                          <TableCell className="p-1.5">{particle.perimeter}</TableCell>
                          <TableCell className="p-1.5">{particle.circularity.toFixed(3)}</TableCell>
                          <TableCell className="p-1.5">({particle.centroidX.toFixed(1)}, {particle.centroidY.toFixed(1)})</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : (
              <Button type="button" variant="secondary" size="sm" className="h-7 w-full" disabled={!hasImage || busy} onClick={analyzeCurrentParticles}>
                {copy.binary.analyze}
              </Button>
            )
          ) : null}

          {/* Z 轴剖面：逐切片均值（Plot Z-axis Profile 的结果形态）。
              用内联 SVG 而不是 canvas：这里只有一条折线，无需逐像素绘制，也能随面板自适应。 */}
          {card.type === 'zprofile' ? (
            zProfilePoints ? (
              <div className="grid gap-1">
                <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="block h-24 w-full text-primary" role="img" aria-label={copy.views.zprofile}>
                  <polyline fill="none" stroke="currentColor" strokeWidth={1.2} vectorEffect="non-scaling-stroke" points={zProfilePoints} />
                </svg>
                <p className="text-xs text-base-content/55">
                  {copy.views.zProfileNote}
                  {stackStats ? ` · ${copy.stats.min} ${zProfileRange[0]} · ${copy.stats.max} ${zProfileRange[1]}` : ''}
                </p>
              </div>
            ) : (
              <p className="text-sm text-base-content/55">{stackStatsPlaceholder}</p>
            )
          ) : null}

          {/* 整栈测量：每切片一行（Measure Stack...）。 */}
          {card.type === 'stackMeasure' ? (
            stackStats ? (
              <div className="max-h-56 overflow-auto">
                <Table className="min-w-[300px] text-xs tabular-nums">
                  <TableHeader>
                    <TableRow className="border-base-300 hover:bg-transparent">
                      <TableHead className="h-auto p-1.5">{copy.stackOps.slice}</TableHead>
                      <TableHead className="h-auto p-1.5">{copy.stats.mean}</TableHead>
                      <TableHead className="h-auto p-1.5">{copy.stats.min}</TableHead>
                      <TableHead className="h-auto p-1.5">{copy.stats.max}</TableHead>
                      <TableHead className="h-auto p-1.5">{copy.stats.stdDev}</TableHead>
                      <TableHead className="h-auto p-1.5">{copy.stackOps.median}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stackStats.frames.map((row) => (
                      <TableRow key={row.slice} className="border-base-200">
                        <TableCell className="p-1.5">{row.slice}</TableCell>
                        <TableCell className="p-1.5">{row.mean.toFixed(2)}</TableCell>
                        <TableCell className="p-1.5">{row.min}</TableCell>
                        <TableCell className="p-1.5">{row.max}</TableCell>
                        <TableCell className="p-1.5">{row.stdDev.toFixed(2)}</TableCell>
                        <TableCell className="p-1.5">{Number.isNaN(row.median) ? '—' : row.median}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-base-content/55">{stackStatsPlaceholder}</p>
            )
          ) : null}

          {/* 整栈统计：一行汇总（Statistics）。 */}
          {card.type === 'stackStatistics' ? (
            stackStats ? (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {([
                  [copy.stackOps.voxels, stackStats.summary.voxels.toLocaleString()],
                  [copy.stats.mean, stackStats.summary.mean.toFixed(2)],
                  [copy.stats.min, String(stackStats.summary.min)],
                  [copy.stats.max, String(stackStats.summary.max)],
                  [copy.stats.stdDev, stackStats.summary.stdDev.toFixed(2)],
                  [copy.stackOps.median, Number.isNaN(stackStats.summary.median) ? '—' : String(stackStats.summary.median)],
                  [copy.stackOps.mode, Number.isNaN(stackStats.summary.mode) ? '—' : String(stackStats.summary.mode)],
                ] as const).map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-2">
                    <dt className="truncate text-xs text-base-content/55">{label}</dt>
                    <dd className="font-mono text-xs font-semibold tabular-nums text-base-content">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-base-content/55">{stackStatsPlaceholder}</p>
            )
          ) : null}

          {/* 逐页剖面：每页一条曲线，共用同一纵轴（Plot XY Profile）。 */}
          {card.type === 'xyProfile' ? (
            profilePolylines.length ? (
              <div className="grid gap-1">
                <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="block h-24 w-full" role="img" aria-label={copy.views.xyProfile}>
                  {profilePolylines.map((line) => (
                    <polyline
                      key={line.index}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={line.index === pageIndex ? 1.4 : 0.6}
                      className={line.index === pageIndex ? 'text-primary' : 'text-base-content/30'}
                      vectorEffect="non-scaling-stroke"
                      points={line.points}
                    />
                  ))}
                </svg>
                <p className="text-xs text-base-content/55">
                  {copy.views.xyProfileNote}
                  {state.stackProfiles ? ` · ${state.stackProfiles.min.toFixed(2)} – ${state.stackProfiles.max.toFixed(2)} · ${state.stackProfiles.frameCount} × ${state.stackProfiles.length}` : ''}
                </p>
              </div>
            ) : (
              <p className="text-sm text-base-content/55">{stackStatsPlaceholder}</p>
            )
          ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  ) : (
    <p className="text-sm text-base-content/55">{hasImage ? copy.views.empty : copy.emptyDescription}</p>
  )

  /* ---------------- 渲染 ---------------- */

  return (
    <div className="grid h-full grid-rows-[var(--navbar-height)_minmax(0,1fr)] bg-base-100">
      <AppNavbar
        section="imagej"
        toolbar={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.tif,.tiff,.webp,.fits,.fit,.fts,.dng,.cr2,.nef,.arw,.orf,.rw2,.raf,.raw"
              className="hidden"
              onChange={onFileInput}
            />
            <Button
              type="button"
              size="sm"
              className="shrink-0 font-semibold"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon size={14} strokeWidth={2.2} />
              {copy.openImage}
            </Button>

            {/* 工具网格：对齐 ImageJ 的工具栏。一个图标是一个"工具族"，
                双击在族内切换子类型（直线 line/arrow、点 point/multipoint）。 */}
            <div role="group" aria-label={copy.viewer.tool} className="inline-flex shrink-0 flex-wrap items-center gap-0.5 rounded-[var(--radius-field)] bg-muted p-0.5">
              {TOOLS.map((entry) => {
                const variantId = toolVariants[entry.id]
                const Icon = (variantId ? VARIANT_ICONS[variantId] : undefined) ?? entry.icon
                const active = tool === entry.id
                const label = toolLabel(copy.tools, entry, variantId)
                const hint = entry.variants?.length
                  ? `${label} (${entry.shortcut.toUpperCase()}) · ${copy.tools.variantsHint}`
                  : `${label} (${entry.shortcut.toUpperCase()})`
                return (
                  <Button
                    key={entry.id}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={label}
                    aria-pressed={active}
                    title={hint}
                    disabled={!hasImage}
                    className={`size-6 rounded-[calc(var(--radius-field)-2px)] ${
                      active ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/55 hover:text-base-content'
                    }`}
                    onClick={() => setTool(entry.id)}
                    onDoubleClick={() => cycleToolVariant(entry)}
                  >
                    <Icon size={15} />
                  </Button>
                )
              })}
            </div>

            {state.dataset?.componentKind === 'rgb' ? (
              <div role="group" aria-label={copy.viewer.display} className="inline-flex shrink-0 rounded-[var(--radius-field)] bg-muted p-0.5">
                {(['color', 'gray'] as const).map((value) => {
                  const active = value === 'color' ? showColor : !showColor
                  return (
                    <Button
                      key={value}
                      type="button"
                      variant="ghost"
                      aria-pressed={active}
                      className={`h-6 rounded-[calc(var(--radius-field)-2px)] px-2 text-xs font-medium ${
                        active ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/55 hover:text-base-content'
                      }`}
                      onClick={() => setShowColor(value === 'color')}
                    >
                      {value === 'color' ? copy.viewer.color : copy.viewer.gray}
                    </Button>
                  )
                })}
              </div>
            ) : null}

            <Button type="button" variant={showOriginal ? 'secondary' : 'outline'} size="sm" aria-pressed={showOriginal} disabled={navBusy} onClick={toggleOriginal}>{copy.original}</Button>

            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-[var(--radius-field)] bg-muted p-0.5">
              <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.zoomOut} disabled={!hasImage || navBusy} onClick={() => zoomByStep(-1)}
                className="size-6 rounded-[calc(var(--radius-field)-2px)] text-base-content/70 hover:bg-base-100 hover:text-base-content">
                <ZoomOut size={14} />
              </Button>
              <span className="min-w-9 shrink-0 text-center text-xs tabular-nums text-base-content/70">
                {Math.round(zoom * 100)}%
              </span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.zoomIn} disabled={!hasImage || navBusy} onClick={() => zoomByStep(1)}
                className="size-6 rounded-[calc(var(--radius-field)-2px)] text-base-content/70 hover:bg-base-100 hover:text-base-content">
                <ZoomIn size={14} />
              </Button>
            </span>
            <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={!hasImage || navBusy} onClick={showActualSize}>
              {copy.viewer.actualSize}
            </Button>
            <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={!hasImage || navBusy} onClick={fitToWindow}>
              {copy.fit}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="shrink-0" disabled={!roi} onClick={() => setRoi(null)}>
              {copy.roi.clear}
            </Button>

            <span className="ml-auto hidden shrink-0 truncate pl-2 font-mono text-xs text-base-content/55 md:inline">
              {probe ? `(${probe.x}, ${probe.y}) = ${probe.value} · ` : ''}{roiLabel}
            </span>
          </>
        }
      />

      <div className="grid min-h-0 min-w-0 grid-cols-1 overflow-y-auto lg:grid-cols-[260px_minmax(0,1fr)_300px] lg:overflow-hidden">
        {/* 左栏「处理」：命令目录（选中项下方内联展开自己的操作面板）+ 撤销 / 状态 */}
        <aside className="order-2 flex min-h-0 flex-col border-b border-base-300 bg-base-100 lg:order-none lg:h-full lg:border-b-0 lg:border-r">
          {stack && <div className="shrink-0 border-b border-base-300 px-2.5 py-2 text-xs">
            <Label className="flex items-center gap-2">
              <Checkbox checked={applyAll} onCheckedChange={(value) => setApplyAll(value === true)} />
              {copy.stack.applyAll}
            </Label>
          </div>}
          <div className="min-h-0 flex-1">
            <ImageJSidebar language={language} registry={registry} onRun={runCommand} onCommand={runStackCommand} disabled={!hasImage || busy}
              expandableCommands={expandableCommands} expandedCommand={expandedCommandLabel} panel={panel} onToggleCommand={toggleParamCommand}
              stackActions={{ next: () => selectPage(pageIndex + 1), previous: () => selectPage(pageIndex - 1), canNext: Boolean(slice && pageIndex + 1 < slice.length), canPrevious: pageIndex > 0 }} />
          </div>

          <Accordion type="single" collapsible className="max-h-40 shrink-0 overflow-auto border-t border-base-300 px-3 text-xs">
            <AccordionItem value="steps" className="border-b-0">
              <AccordionTrigger className="py-2 text-xs font-normal hover:no-underline [&>svg]:size-3.5">
                {copy.steps.heading} · {state.recipe?.steps.length ?? 0}
              </AccordionTrigger>
              <AccordionContent className="pb-2">
                <ol className="grid gap-1">{state.recipe?.steps.map((step) => (
                  <li key={step.id} className="flex items-center justify-between gap-2">
                    <Button type="button" variant="ghost" size="sm" className="h-6 justify-start px-1.5 text-xs font-normal"
                      disabled={busy || !stepAppliesToSelection(step, state.selection)}
                      onClick={() => { setShowOriginal(false); runtime.viewStep(step.id) }}>
                      {copy.steps.ops[step.op] ?? step.op}
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" className="size-5" aria-label={copy.steps.remove}
                      disabled={busy} onClick={() => { setShowOriginal(false); runtime.removeStep(step.id) }}>
                      <X size={12} />
                    </Button>
                  </li>
                ))}</ol>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          <footer className="shrink-0 border-t border-base-300 px-2.5 py-2">
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.history.undo} disabled={busy || !historyFlags.canUndo} onClick={undo}>
                <Undo2 size={14} />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.history.redo} disabled={busy || !historyFlags.canRedo} onClick={redo}>
                <Redo2 size={14} />
              </Button>
            </div>
            <div role="status" aria-live="polite" className="mt-1 min-h-4 text-xs text-base-content/60">
              {preload ? `${copy.stack.preloading} ${preload.done} / ${preload.total}` : status}
              {!preload && state.lastRunMs !== undefined ? ` · ${state.lastRunMs} ms` : ''}
              {state.sliceLabels?.[pageIndex] ? ` · ${state.sliceLabels[pageIndex]}` : ''}
              {analysisResult.error && <span className="text-destructive">{analysisResult.error}</span>}
            </div>
          </footer>
        </aside>

        <main className="order-1 flex min-h-[60vh] min-w-0 flex-col bg-base-100 lg:order-none lg:min-h-0">
          {tabsHeader}
          <ContextMenu>
            <ContextMenuTrigger asChild>
          <div className="relative min-h-0 flex-1">
          {error ? (
            <p role="alert" className="absolute left-3 right-3 top-3 z-10 rounded-[var(--radius-box)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {/* 整卷预热进度：让它显式可见，用户才知道「等一下」换来了后面的翻页手感。 */}
          {preload && !error ? (
            <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-[var(--radius-box)] border border-base-300 bg-base-100/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur">
              <span className="font-medium">{copy.stack.preloading}</span>
              <span className="ml-2 tabular-nums text-base-content/70">{preload.done} / {preload.total}</span>
              <span className="ml-2 h-1 w-24 overflow-hidden rounded-full bg-base-200 align-middle">
                <span className="block h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${preload.total ? Math.round((preload.done / preload.total) * 100) : 0}%` }} />
              </span>
            </div>
          ) : null}

          {!hasImage ? (
            <div className="grid h-full place-items-center p-8 text-center">
              <div className="grid gap-2 justify-items-center">
                <ImageIcon size={34} className="text-base-content/35" aria-hidden="true" />
                <strong className="text-base-content">{copy.emptyTitle}</strong>
                <p className="max-w-md text-sm text-base-content/60">{copy.emptyDescription}</p>
                <p className="text-xs text-base-content/45">{copy.localNote}</p>
              </div>
            </div>
          ) : displayBlock ? (
            <>
              <ImageViewport
                onViewChange={handleViewChange}
                ref={viewportRef}
                block={displayBlock}
                windowLevel={baselineWindow}
                options={rasterOptions}
                tool={tool}
                roi={roi}
                onRoi={(rect) => { if (!stale) setRoi(rect) }}
                onProbe={(value) => setProbe(stale ? null : value)}
                onZoom={setZoom}
                onStepPage={slice && slice.length > 1 ? stepPage : undefined}
              />
            </>
          ) : null}
          </div>
            </ContextMenuTrigger>
            {onEjectPage && slice && slice.length > 1 ? (
              <ContextMenuContent className="w-48">
                <ContextMenuItem onSelect={() => onEjectPage(pageIndex)}>{copy.ejectPage}</ContextMenuItem>
              </ContextMenuContent>
            ) : null}
          </ContextMenu>
          {/* 切片栏紧贴图像窗口的**下方**，与 ImageJ 的 StackWindow 滚动条位置一致
              （ImageLayout 把滚动条排在画布之后），并从工具栏里移了出来。 */}
          <StackSliceBar slices={slices} stale={stale} disabled={navBusy} pageLabel={copy.stack.page} onSelect={selectAxis} />
        </main>

        {/* 右栏「分析」：卡片式视图（一个卡片一个可视化）+ 导出 */}
        <aside className="order-3 flex min-h-0 flex-col border-t border-base-300 bg-base-100 lg:order-none lg:h-full lg:border-t-0 lg:border-l">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-base-300 px-2 py-1.5">
            {hasImage ? (
              <ToggleGroup
                type="single"
                value={scope}
                onValueChange={(value) => { if (value === 'image' || value === 'roi') setScope(value) }}
                aria-label={copy.viewer.display}
                className="gap-0 rounded-[var(--radius-field)] bg-base-200 p-0.5"
              >
                {(['image', 'roi'] as const).map((value) => (
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    disabled={value === 'roi' && !roi}
                    className="h-6 min-w-0 flex-none rounded-[calc(var(--radius-field)-2px)] px-2 text-xs font-medium text-base-content/55 shadow-none hover:bg-transparent hover:text-base-content data-[state=on]:bg-base-100 data-[state=on]:text-base-content data-[state=on]:shadow-sm"
                  >
                    {value === 'image' ? copy.roi.scopeImage : copy.roi.scopeRoi}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : <span />}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-7" disabled={!hasImage || busy}>
                  <Plus size={14} />
                  {copy.views.add}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {/* 同一种视图可以加多个：一个开 Live 跟随当前切片，另一个关掉 Live 冻在原地，
                    这样就能并排比较两幅图的分布。已添加的类型显示数量，而不是禁用。 */}
                {VIEW_TYPES.map((type) => {
                  const count = views.filter((card) => card.type === type).length
                  return (
                    <DropdownMenuItem key={type} disabled={!hasImage} onSelect={() => addView(type)}>
                      <span className="flex-1">{viewTitle(type)}</span>
                      {count > 0 ? <span className="font-mono text-xs text-base-content/50">{count}</span> : null}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">{viewCards}</div>

          <footer className="shrink-0 border-t border-base-300 px-2 py-1.5">
            <div className="grid gap-1.5">
              <Button type="button" variant="outline" size="sm" className="h-8" disabled={!hasImage || busy} onClick={exportPng}>
                <Download size={14} />
                {copy.exportPng}
              </Button>
              <div className="grid grid-cols-2 gap-1.5">
                <Button type="button" variant="outline" size="sm" className="h-8" disabled={!hasImage || busy} onClick={() => downloadTiff(false)}>{copy.stack.exportCurrent}</Button>
                <Button type="button" variant="outline" size="sm" className="h-8" disabled={busy || !stack || stack.length < 2} onClick={() => downloadTiff(true)}>{copy.stack.exportAll}</Button>
              </div>
            </div>
          </footer>
        </aside>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 外壳：多文档（tab）管理
 * ------------------------------------------------------------------ */

/**
 * 一个 tab 的文档。
 *
 * `rawOptions` 记下无头 RAW 的导入参数（按文件名）：重命名 / 拆分 / 重排都会重建文档并重新导入，
 * 参数丢了这些操作对裸数据就再也做不成。
 */
interface DocumentEntry {
  id: string
  title: string
  files: File[]
  runtime: ImageRuntime
  rawOptions?: ReadonlyMap<string, RawSensorOptions>
}

/** 文件夹导入时按扩展名筛选图片。 */
const IMAGE_FILE = /\.(png|jpe?g|webp|tiff?|bmp|gif|fits?|fts|dng|cr2|crw|nef|nrw|arw|srf|sr2|orf|rw2|pef|srw|raf|3fr|fff|iiq|mrw|dcr|kdc|rwl|x3f|erf|mef|mos|mfw|raw)$/i

/** 相机 RAW 扩展名（含无头 `.raw`）；用于「打开 RAW 时自动去马赛克」的导入选项与裸数据探测。 */
const RAW_FILE = /\.(dng|cr2|crw|nef|nrw|arw|srf|sr2|orf|rw2|pef|srw|raf|3fr|fff|iiq|mrw|dcr|kdc|rwl|x3f|erf|mef|mos|mfw|raw)$/i

const byNameNatural = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

let documentCounter = 0
function nextDocumentId(): string {
  documentCounter += 1
  return `doc_${Date.now().toString(36)}_${documentCounter.toString(36)}`
}

/**
 * 工作台外壳。
 *
 * 持有共享引擎与一组文档；每个文档 = 一个 `ImageRuntime`，并渲染一个 `ImageDocumentView`。
 * 非活动文档用 `hidden` 保留挂载状态（缩放 / ROI / 处理记录都留在各自的组件里），
 * 从而 tab 切换不丢视图状态。引擎（Worker + 字节缓存）由所有文档共享。
 */
export function ScientificImageWorkspace() {
  const { language } = useI18n()
  const copy = useMemo(() => createImagejCopy(language), [language])
  const engineRef = useRef<ImageWorkspaceEngine | null>(null)
  if (!engineRef.current) engineRef.current = createWorkspaceEngine()
  const engine = engineRef.current
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [documents, setDocuments] = useState<DocumentEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const documentsRef = useRef(documents); documentsRef.current = documents
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const [stackDialog, setStackDialog] = useState(false)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [reorderId, setReorderId] = useState<string | null>(null)
  const [rawPrompt, setRawPrompt] = useState<RawSensorPrompt | null>(null)
  /** 裸数据对话框的等待句柄：undefined 的 promise 结果表示「无需询问」，null 表示用户取消。 */
  const rawResolver = useRef<((options: RawSensorOptions | null) => void) | null>(null)

  /* 卸载时释放全部文档运行时。 */
  useEffect(() => () => { for (const doc of documentsRef.current) doc.runtime.dispose() }, [])

  /**
   * 打开前的参数询问。
   *
   * 带 TIFF 容器的 RAW（DNG / CR2 / ARW …）头部自带宽高位深，返回 undefined 表示不用问；
   * 只有无头裸数据（工业相机 / 传感器直接落盘）才需要弹对话框，否则解码器连宽高都不知道。
   */
  /**
   * 打开前的参数询问。
   *
   * 判据直接用引擎的 `needsSensorOptions`（像 RAW 且没有 TIFF 容器头），
   * 于是「UI 弹了对话框」和「解码器要参数」永远是同一个判断，不会各写一套正则而漂移。
   */
  const askRawOptions = async (file: File, count = 1): Promise<RawSensorOptions | null | undefined> => {
    if (!await needsSensorOptions(file)) return undefined
    return new Promise<RawSensorOptions | null>((resolve) => {
      rawResolver.current = resolve
      setRawPrompt({ file, count })
    })
  }

  /** 一批文件里第一个需要参数的裸数据：整批共用的参数就以它为准来问。 */
  const firstHeadlessRaw = async (files: readonly File[]): Promise<File | undefined> => {
    for (const file of files) {
      if (await needsSensorOptions(file)) return file
    }
    return undefined
  }

  const settleRawPrompt = (options: RawSensorOptions | null) => {
    const resolve = rawResolver.current
    rawResolver.current = null
    setRawPrompt(null)
    resolve?.(options)
  }

  /**
   * 导入一个文件，返回最终生效的裸数据参数（可能来自兜底补问）。
   *
   * 最后一道保险：万一某条入口没问参数，解码器会明确报「该 RAW 没有容器头」——与其把人堵在
   * 报错上，不如这时补问一次再重试。正常路径不会走到这里。
   */
  const openInto = async (runtime: ImageRuntime, file: File, options?: RawSensorOptions): Promise<RawSensorOptions | undefined> => {
    await runtime.openFile(file, options)
    let settled = options
    if (!options && /没有容器头|无法识别该格式|无法解码该文件/.test(runtime.getState().error ?? '')) {
      const asked = await askRawOptions(file)
      if (asked) {
        settled = asked
        await runtime.openFile(file, asked)
      }
    }
    return settled
  }

  const openFiles = async (files: readonly File[]) => {
    if (!files.length) return
    const created: DocumentEntry[] = []
    for (const file of files) {
      const options = await askRawOptions(file)
      if (options === null) continue
      const runtime = createDocumentRuntime(engine)
      const entry: DocumentEntry = {
        id: nextDocumentId(),
        title: file.name,
        files: [file],
        runtime,
        rawOptions: options ? new Map([[file.name, options]]) : undefined,
      }
      created.push(entry)
      // 先挂文档再导入：tab 立刻出现；兜底补问拿到的参数回来后再补记，拆分 / 重建才不会丢。
      void openInto(runtime, file, options ?? undefined).then((settled) => {
        if (!settled || entry.rawOptions?.has(file.name)) return
        const rawOptions = new Map([[file.name, settled]])
        entry.rawOptions = rawOptions
        setDocuments((docs) => docs.map((doc) => (doc.id === entry.id ? { ...doc, rawOptions } : doc)))
      })
    }
    if (!created.length) return
    setDocuments((docs) => [...docs, ...created])
    setActiveId(created[created.length - 1]!.id)
  }

  /**
   * 把多个文件作为一个 Stack 打开（文件夹导入 / 合并 tab）。
   *
   * `rawOptions` 是整批无头 RAW 共用的一组参数：文件夹里的裸数据来自同一台传感器，
   * 只问一次就够了；参数按文件名记进文档，拆分 / 重排 / 重命名重建时都能复原。
   */
  const openStackFiles = async (files: readonly File[], title?: string, rawOptions?: RawSensorOptions) => {
    if (files.length < 2) { void openFiles(files); return }
    const runtime = createDocumentRuntime(engine)
    const entry: DocumentEntry = {
      id: nextDocumentId(),
      title: title ?? `${files.length} images`,
      files: [...files],
      runtime,
      rawOptions: rawOptions
        ? new Map(files.filter((file) => RAW_FILE.test(file.name)).map((file) => [file.name, rawOptions]))
        : undefined,
    }
    setDocuments((docs) => [...docs, entry])
    setActiveId(entry.id)
    void runtime.openStack(files, entry.rawOptions)
  }

  /**
   * 打开一个由计算产生的新数据集（例如 Z 投影结果）。
   *
   * 与文件导入的差别只在来源：`files` 为空，所以「拆分 / 重排 / 合并」这些依赖文件列表的操作
   * 对它自动禁用，而显示、继续处理、导出与另存为 TIFF 都照常工作。
   */
  const openDerivedDataset = (dataset: Dataset) => {
    const runtime = createDocumentRuntime(engine)
    const entry: DocumentEntry = { id: nextDocumentId(), title: dataset.source.name, files: [], runtime }
    setDocuments((docs) => [...docs, entry])
    setActiveId(entry.id)
    void runtime.adoptDataset(dataset)
  }

  /** 其它已打开文档的可选列表（供 Insert / Combine 选择来源；值用各自的 datasetId）。 */
  const listOtherDatasets = (excludeId: string) => documentsRef.current
    .filter((doc) => doc.id !== excludeId)
    .map((doc) => ({ id: doc.runtime.getState().dataset?.id ?? '', title: doc.title }))
    .filter((entry) => entry.id)

  /**
   * 文件夹 → 一个 Stack（与 jpg 文件夹完全同样的体验）。
   *
   * 无头 RAW 的宽高位深谁都不知道，所以先拿第一个文件问一次参数，整批共用后再进 Stack；
   * 只有一个文件时退回单图打开（那时由 `openFiles` 自己问）。
   */
  const openFolderAsStack = async (images: readonly File[], title: string) => {
    if (images.length < 2) { void openFiles(images); return }
    const headless = await firstHeadlessRaw(images)
    if (!headless) { void openStackFiles(images, title); return }
    const rawCount = images.filter((file) => RAW_FILE.test(file.name)).length
    const options = await askRawOptions(headless, rawCount)
    if (options === null) return
    void openStackFiles(images, title, options ?? undefined)
  }

  /** 选择文件夹：过滤图片、按文件名自然排序后合成一个 Stack。 */
  const pickFolder = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    ;(input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true
    input.onchange = () => { void (async () => {
      const all = Array.from(input.files ?? [])
      const images = all
        .filter((file) => IMAGE_FILE.test(file.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
      if (!images.length) return
      const folder = images[0]!.webkitRelativePath?.split('/')[0]
      await openFolderAsStack(images, folder || `${images.length} images`)
    })() }
    input.click()
  }

  /** 把任意多个 tab 的文件合成一个新的 Stack tab，并关闭原 tab（分组 = 组成 stack）。 */
  const mergeSelected = (ids: readonly string[]) => {
    const selected = documents.filter((doc) => ids.includes(doc.id))
    if (selected.length < 2) return
    const files = selected.flatMap((doc) => doc.files)
    // 合并前的 tab 可能各自持有裸数据参数（甚至参数不同），按文件名并起来带走。
    const rawOptions = new Map<string, RawSensorOptions>()
    for (const doc of selected) for (const [name, options] of doc.rawOptions ?? []) rawOptions.set(name, options)
    for (const doc of selected) doc.runtime.dispose()
    const runtime = createDocumentRuntime(engine)
    const entry: DocumentEntry = {
      id: nextDocumentId(),
      title: `${files.length} images`,
      files,
      runtime,
      rawOptions: rawOptions.size ? rawOptions : undefined,
    }
    setDocuments((docs) => [...docs.filter((doc) => !ids.includes(doc.id)), entry])
    setActiveId(entry.id)
    void runtime.openStack(files, entry.rawOptions)
  }

  const mergeDocuments = (leftId: string, rightId: string) => mergeSelected([leftId, rightId])

  const stackRows: StackRow[] = documents.map((doc) => ({
    id: doc.id,
    title: doc.title,
    modified: doc.files.reduce((max, file) => Math.max(max, file.lastModified || 0), 0),
    size: doc.files.reduce((sum, file) => sum + file.size, 0),
    pages: doc.files.length,
  }))

  const renameDoc = documents.find((doc) => doc.id === renameId) ?? null
  const reorderDoc = documents.find((doc) => doc.id === reorderId) ?? null

  /** 用新的文件列表重建文档（重新导入；该文档的处理记录不会保留）。 */
  const rebuildDocument = (doc: DocumentEntry, files: File[], title: string): DocumentEntry => {
    doc.runtime.dispose()
    const runtime = createDocumentRuntime(engine)
    if (files.length > 1) void runtime.openStack(files, doc.rawOptions)
    else if (files.length === 1) void runtime.openFile(files[0]!, doc.rawOptions?.get(files[0]!.name))
    return { ...doc, runtime, files, title }
  }

  const commitRename = () => {
    if (!renameId) return
    const next = renameValue.trim()
    if (next) setDocuments((docs) => docs.map((doc) => (doc.id === renameId ? { ...doc, title: next } : doc)))
    setRenameId(null)
  }

  /** 把 Stack 拆成每个文件一个独立 tab。 */
  const splitDocument = (id: string) => {
    const index = documents.findIndex((doc) => doc.id === id)
    if (index < 0) return
    const doc = documents[index]!
    if (doc.files.length < 2) return
    doc.runtime.dispose()
    const created: DocumentEntry[] = doc.files.map((file) => {
      const runtime = createDocumentRuntime(engine)
      const options = doc.rawOptions?.get(file.name)
      void runtime.openFile(file, options)
      return {
        id: nextDocumentId(),
        title: file.name,
        files: [file],
        runtime,
        rawOptions: options ? new Map([[file.name, options]]) : undefined,
      }
    })
    setDocuments((docs) => [...docs.slice(0, index), ...created, ...docs.slice(index + 1)])
    if (activeId === id) setActiveId(created[0]!.id)
  }

  /** 把当前页从 Stack 移出：剩下仍是 Stack（或降级为单图），被移出的成为独立 tab。 */
  const extractPage = (id: string, pageIndex: number) => {
    const index = documents.findIndex((doc) => doc.id === id)
    if (index < 0) return
    const doc = documents[index]!
    if (doc.files.length < 2) return
    const file = doc.files[pageIndex]
    if (!file) return
    const remaining = doc.files.filter((_, i) => i !== pageIndex)
    const updated = remaining.length > 0 ? rebuildDocument(doc, remaining, remaining.length > 1 ? doc.title : remaining[0]!.name) : null
    if (remaining.length === 0) doc.runtime.dispose()
    const ejected: DocumentEntry = { id: nextDocumentId(), title: file.name, files: [file], runtime: createDocumentRuntime(engine) }
    const ejectedOptions = doc.rawOptions?.get(file.name)
    if (ejectedOptions) ejected.rawOptions = new Map([[file.name, ejectedOptions]])
    void ejected.runtime.openFile(file, ejectedOptions)
    setDocuments((docs) => {
      const before = docs.slice(0, index), after = docs.slice(index + 1)
      return [...before, ...(updated ? [updated] : []), ejected, ...after]
    })
    setActiveId(ejected.id)
  }

  /** 按新的顺序重建 Stack。 */
  const reorderDocument = (id: string, order: readonly number[]) => {
    const doc = documents.find((entry) => entry.id === id)
    if (!doc || order.length !== doc.files.length) return
    const files = order.map((fileIndex) => doc.files[fileIndex]!)
    const next = rebuildDocument(doc, files, doc.title)
    setDocuments((docs) => docs.map((entry) => (entry.id === id ? next : entry)))
  }

  const closeDocument = (id: string) => {
    const index = documents.findIndex((doc) => doc.id === id)
    if (index < 0) return
    const doc = documents[index]!
    const next = documents.filter((entry) => entry.id !== id)
    doc.runtime.dispose()
    setDocuments(next)
    if (activeId === id) setActiveId(next[Math.min(index, next.length - 1)]?.id ?? null)
  }

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length) void openFiles(files)
    event.target.value = ''
  }

  const closeOthers = (id: string) => {
    for (const doc of documents) if (doc.id !== id) doc.runtime.dispose()
    setDocuments(documents.filter((doc) => doc.id === id))
    setActiveId(id)
  }

  const closeToRight = (id: string) => {
    const index = documents.findIndex((doc) => doc.id === id)
    if (index < 0) return
    const removed = documents.slice(index + 1)
    for (const doc of removed) doc.runtime.dispose()
    setDocuments(documents.slice(0, index + 1))
    if (activeId && removed.some((doc) => doc.id === activeId)) setActiveId(id)
  }

  const isLastDocument = (id: string) => documents[documents.length - 1]?.id === id

  /** 拖放：多个文件各开一个 tab；每个文件夹合成一个 Stack。 */
  const handleDrop = async (data: DataTransfer) => {
    const { files, folders } = await readDroppedContent(data)
    for (const folder of folders) {
      const images = folder.files.filter((file) => IMAGE_FILE.test(file.name)).sort(byNameNatural)
      if (images.length) await openFolderAsStack(images, folder.name)
    }
    if (files.length) void openFiles(files)
  }
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types?.includes('Files')) return
    dragDepth.current += 1
    setDragging(true)
  }
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types?.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    void handleDrop(event.dataTransfer)
  }

  const tabsHeader = (
    <div className="flex h-9 shrink-0 items-stretch gap-1 border-b border-base-300 bg-base-100 px-1.5">
      <TabsList className="h-[calc(100%+1px)] min-w-0 flex-1 items-stretch justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0">
        {documents.map((doc, index) => (
          <ContextMenu key={doc.id}>
            <ContextMenuTrigger asChild>
              <div className="group relative flex shrink-0 items-stretch">
                <TabsTrigger
                  value={doc.id}
                  title={doc.title}
                  className="h-full max-w-44 gap-1 rounded-t-[var(--radius-field)] rounded-b-none border border-transparent py-0 pr-6 pl-2 text-xs transition-colors data-[state=active]:border-base-300 data-[state=active]:border-b-transparent data-[state=active]:bg-base-200">
                  <span className="truncate">{doc.title}</span>
                </TabsTrigger>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${copy.close} ${doc.title}`}
                  onClick={(event) => { event.stopPropagation(); closeDocument(doc.id) }}
                  /* 关闭按钮只让图标变亮，不出现背景块：Button 的 ghost 变体在暗色主题下是
                     `dark:hover:bg-accent/50`，必须连 dark 变体一起覆盖，否则 hover 仍有底色。 */
                  className="absolute right-0.5 top-1/2 size-5 -translate-y-1/2 rounded-[3px] text-base-content/45 opacity-60 hover:bg-transparent hover:text-base-content hover:opacity-100 dark:hover:bg-transparent">
                  <X size={11} />
                </Button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
              <ContextMenuItem onSelect={() => closeDocument(doc.id)}>{copy.close}</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={documents.length <= 1} onSelect={() => closeOthers(doc.id)}>{copy.tabs.closeOthers}</ContextMenuItem>
              <ContextMenuItem disabled={isLastDocument(doc.id)} onSelect={() => closeToRight(doc.id)}>{copy.tabs.closeToRight}</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={index === 0} onSelect={() => mergeDocuments(documents[index - 1]!.id, doc.id)}>{copy.tabs.mergePrevious}</ContextMenuItem>
              <ContextMenuItem disabled={index === documents.length - 1} onSelect={() => mergeDocuments(doc.id, documents[index + 1]!.id)}>{copy.tabs.mergeNext}</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => setStackDialog(true)}>{copy.tabs.buildStack}</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => { setRenameId(doc.id); setRenameValue(doc.title) }}>{copy.tabs.rename}</ContextMenuItem>
              <ContextMenuItem disabled={doc.files.length < 2} onSelect={() => splitDocument(doc.id)}>{copy.tabs.splitStack}</ContextMenuItem>
              <ContextMenuItem disabled={doc.files.length < 2} onSelect={() => setReorderId(doc.id)}>{copy.tabs.reorderStack}</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </TabsList>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.openImage} title={copy.openImage} className="my-auto shrink-0">
            <Plus size={15} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>{copy.openImage}</DropdownMenuItem>
          <DropdownMenuItem onSelect={pickFolder}>{copy.tabs.openFolder}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={documents.length < 2} onSelect={() => setStackDialog(true)}>{copy.tabs.buildStack}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <Tabs
      value={activeId ?? ''}
      onValueChange={setActiveId}
      className="relative h-screen gap-0"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input ref={fileInputRef} type="file" multiple accept="image/*,.tif,.tiff,.webp,.fits,.fit,.fts,.dng,.cr2,.nef,.arw,.orf,.rw2,.raf,.raw" className="hidden" onChange={onFileInput} />
      <div className="relative min-h-0 flex-1">
        {documents.length === 0 ? (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="grid gap-2 justify-items-center">
              <ImageIcon size={34} className="text-base-content/35" aria-hidden="true" />
              <strong className="text-base-content">{copy.emptyTitle}</strong>
              <p className="max-w-md text-sm text-base-content/60">{copy.emptyDescription}</p>
              <p className="text-xs text-base-content/45">{copy.localNote}</p>
              <Button type="button" size="sm" onClick={() => fileInputRef.current?.click()}>
                <ImageIcon size={14} strokeWidth={2.2} />
                {copy.openImage}
              </Button>
            </div>
          </div>
        ) : documents.map((doc) => (
          <TabsContent key={doc.id} value={doc.id} forceMount className="m-0 h-full outline-none data-[state=inactive]:hidden">
            <ImageDocumentView runtime={doc.runtime} onOpenImage={(file) => { void openFiles([file]) }} onOpenDataset={openDerivedDataset} onListDocuments={() => listOtherDatasets(doc.id)} tabsHeader={doc.id === activeId ? tabsHeader : null} onEjectPage={doc.files.length > 1 ? (index) => extractPage(doc.id, index) : undefined} />
          </TabsContent>
        ))}
      </div>
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-base-100/60">
          <div className="rounded-[var(--radius-box)] border-2 border-dashed border-primary/60 px-6 py-4 text-sm text-base-content/80">{copy.dropHint}</div>
        </div>
      ) : null}

      <StackBuilderDialog open={stackDialog} onOpenChange={setStackDialog} rows={stackRows} copy={copy.stackBuilder} onCreate={mergeSelected} />

      {/* 无头裸数据（没有容器头的 .raw）缺少宽高位深，导入前必须问一次参数。 */}
      <RawSensorDialog
        prompt={rawPrompt}
        copy={copy.rawSensor}
        onConfirm={settleRawPrompt}
        onCancel={() => settleRawPrompt(null)}
      />

      <Dialog open={Boolean(renameDoc)} onOpenChange={(open) => { if (!open) setRenameId(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{copy.rename.title}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            autoFocus
            aria-label={copy.rename.label}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') commitRename(); else if (event.key === 'Escape') setRenameId(null) }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameId(null)}>{copy.rename.cancel}</Button>
            <Button type="button" onClick={commitRename}>{copy.rename.confirm}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StackOrderDialog
        open={Boolean(reorderDoc)}
        onOpenChange={(open) => { if (!open) setReorderId(null) }}
        names={reorderDoc ? reorderDoc.files.map((file) => file.name) : []}
        fileLabel={copy.stackBuilder.file}
        copy={copy.reorder}
        onApply={(order) => { if (reorderDoc) reorderDocument(reorderDoc.id, order) }}
      />
    </Tabs>
  )
}








