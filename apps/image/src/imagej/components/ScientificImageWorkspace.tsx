'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { Check, Download, Image as ImageIcon, Plus, Redo2, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { AppNavbar } from '../../components/AppNavbar'
import { useI18n } from '../../i18n'
import { Button } from '@joplot/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@joplot/ui/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@joplot/ui/context-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@joplot/ui/tabs'
import { Label } from '@joplot/ui/label'
import { createImagejCopy } from '../lib/i18n'
import { readDroppedContent } from '../lib/dropFiles'
import { levelsRange, type Rect } from '../lib/processor'
import { getOperator, toUiRegistry } from '../engine/operators'
import { stepAppliesToSelection, type StepScope } from '../engine/recipe'
import { computeWindowLevel } from '../engine/render/rgba'
import { displayBlock as toDisplayBlock } from '../engine/render/display'
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@joplot/ui/dialog'
import { GaussianCommandPanel, LevelsCommandPanel, ThresholdCommandPanel } from './CommandPanels'
import { HistogramChart } from './HistogramChart'
import { applyColorAdjustments, type ColorAdjustment } from '../engine/colorAdjustments'

/** 需要先调参数再执行的操作：面板在对应命令项下方展开，所以这里存命令 label。 */
type ParamCommand = 'Brightness/Contrast' | 'Color Balance' | 'Threshold' | 'Gaussian Blur'
type ParamOp = 'levels' | 'threshold' | 'gaussian'
/** 命令 label → 算子 kind（命令目录里 label 是唯一键）。 */
const COMMAND_OPS: Record<ParamCommand, ParamOp> = {
  'Brightness/Contrast': 'levels',
  'Color Balance': 'levels',
  Threshold: 'threshold',
  'Gaussian Blur': 'gaussian',
}
/** 算子 kind → 命令目录里默认展开的那一项。 */
const OP_COMMANDS: Record<ParamOp, ParamCommand> = {
  levels: 'Brightness/Contrast',
  threshold: 'Threshold',
  gaussian: 'Gaussian Blur',
}
type ViewType = 'measurement' | 'histogram' | 'profile' | 'particles'
interface ViewCard { id: number; type: ViewType }
const VIEW_TYPES: ViewType[] = ['measurement', 'histogram', 'profile', 'particles']
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
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

function ImageDocumentView({ runtime, onOpenImage, tabsHeader, onEjectPage }: { runtime: ImageRuntime; onOpenImage(file: File): void; tabsHeader?: ReactNode; onEjectPage?(pageIndex: number): void }) {
  const { language } = useI18n()
  const copy = useMemo(() => createImagejCopy(language), [language])
  const state = useRuntimeState(runtime)
  const registry = useMemo(() => toUiRegistry(), [])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<ImageViewportHandle>(null)
  const profileCanvasRef = useRef<HTMLCanvasElement>(null)
  const [roi, setRoi] = useState<Rect | null>(null)
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<'pan' | 'roi'>('pan')
  const [probe, setProbe] = useState<PixelProbe | null>(null)
  const [brightness, setBrightness] = useState(0), [contrast, setContrast] = useState(50)
  const [gaussianSigma, setGaussianSigma] = useState(1.5), [thresholdLevel, setThresholdLevel] = useState(128)
  const [scope, setScope] = useState<'image' | 'roi'>('image')
  const [applyAll, setApplyAll] = useState(false)
  const [paramCommand, setParamCommand] = useState<ParamCommand | null>(null)
  const [views, setViews] = useState<ViewCard[]>([])
  const viewsIdRef = useRef(1)
  const [minParticleArea, setMinParticleArea] = useState(1)
  const [original, setOriginal] = useState<ImageBlock | null>(null), [showColor, setShowColor] = useState(true)
  const [showOriginal, setShowOriginal] = useState(false)
  const [colorPreview, setColorPreview] = useState<readonly ColorAdjustment[]>([])
  const [colorSession, setColorSession] = useState(0)
  const [uiError, setError] = useState(''), [exporting, setExporting] = useState(false)
  const image = state.image
  const isRgb = Boolean(image && image.axes.includes('c') && image.shape[image.axes.indexOf('c')] === 3)
  const current = image ? { width: image.shape[image.axes.indexOf('x')]!, height: image.shape[image.axes.indexOf('y')]!, data: image.data } : null
  const sourceName = state.dataset?.source.name ?? ''
  const busy = state.status === 'importing' || state.status === 'running' || exporting
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
  const levelsActive = brightness !== 0 || contrast !== 50
  const paramOp = paramCommand ? COMMAND_OPS[paramCommand] : null
  const analysisResult = useImageAnalysis(image, scope === 'roi' ? roi : null, views.some((view) => view.type === 'particles'), minParticleArea, roi, isRgb && colorPreview.length ? 'all' : undefined, colorPreview)
  const status = busy || (image && !analysisResult.analysis) ? copy.status.loading : state.dataset ? copy.status.ready : ''
  const stats = scope === 'roi' && !roi ? undefined : analysisResult.analysis
  const particles = analysisResult.particles ?? null
  const profileData = analysisResult.analysis?.profile ?? null
  const displayBlock = showOriginal && original ? original : image
  const baselineWindow = useMemo(() => {
    if (!displayBlock) return { window: 255, level: 127.5 }
    return displayBlock.dtype === 'uint8' ? { window: 255, level: 127.5 } : computeWindowLevel(displayBlock)
  }, [displayBlock])
  const displayWindow = useMemo(() => {
    const range = levelsRange(brightness, contrast), lo = baselineWindow.level - baselineWindow.window / 2
    return { window: baselineWindow.window * (range.max - range.min) / 255, level: lo + baselineWindow.window * (range.max + range.min) / 510 }
  }, [baselineWindow, brightness, contrast])
  const rasterOptions = useMemo(() => ({ gray: !showColor, threshold: paramOp === 'threshold' ? thresholdLevel : undefined, colorAdjustments: showOriginal ? [] : colorPreview }), [showColor, paramOp, thresholdLevel, colorPreview, showOriginal])
  const selectPage = (index: number) => {
    if (!slice) return
    if (colorPreview.length) commitColorPreview(colorPreview, false)
    setError(''); runtime.setSelection({ [slice.axis]: Math.max(0, Math.min(slice.length - 1, index)) })
  }
  const hasImage = Boolean(current)
  // 翻页走 ref：selectPage 每次渲染重建，若作为 effect 依赖会反复重绑监听。
  const selectPageRef = useRef<(index: number) => void>(() => {})
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
  const roiLabel = roi ? `${roi.width}×${roi.height} @ (${roi.x}, ${roi.y})` : '—'
  const seedDefaultViews = () => setViews((cards) => cards.length ? cards : [{ id: viewsIdRef.current++, type: 'measurement' }, { id: viewsIdRef.current++, type: 'histogram' }])
  useEffect(() => {
    let cancelled = false
    setRoi(null); setScope('image'); setProbe(null); setOriginal(null); setShowOriginal(false); setBrightness(0); setContrast(50); setColorPreview([])
    if (state.dataset) void runtime.readSourceFrame().then((block) => { if (!cancelled) setOriginal(block) }).catch((error: unknown) => { if (!cancelled) setError(String(error)) })
    return () => { cancelled = true }
  }, [runtime, state.dataset?.id, state.selection.t, state.selection.c, state.selection.z])
  useEffect(() => {
    if (current) setRoi((rect) => rect ? { x: Math.min(rect.x, current.width - 1), y: Math.min(rect.y, current.height - 1), width: Math.min(rect.width, current.width - Math.min(rect.x, current.width - 1)), height: Math.min(rect.height, current.height - Math.min(rect.y, current.height - 1)) } : null)
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
  const stepScope = (rect: Rect | null): StepScope => {
    const region = image && rect ? { start: image.axes.map((axis) => axis === 'x' ? rect.x : axis === 'y' ? rect.y : 0), shape: image.axes.map((axis, i) => axis === 'x' ? rect.width : axis === 'y' ? rect.height : image.shape[i]!) } : undefined
    if (applyAll) return region ? { kind: 'roi', region } : { kind: 'stack' }
    return { kind: 'frame', selection: { ...state.selection }, region }
  }
  const submit = (op: string, params: Record<string, number | string> = {}, rect: Rect | null = roi) => {
    if (!image || busy) return
    setError(''); setShowOriginal(false)
    if (colorPreview.length) commitColorPreview(colorPreview, applyAll)
    const ci = image.axes.indexOf('c')
    const needsGray = getOperator(op)?.input.channels !== 'any'
    setShowColor(op !== 'grayscale' && !needsGray)
    if (op !== 'grayscale' && needsGray && ci >= 0 && (image.shape[ci] ?? 1) > 1) runtime.addStep('grayscale', {}, stepScope(null))
    runtime.addStep(op, params, stepScope(rect))
  }
  /** 打开某个命令自己的参数面板（先提交正在预览的色彩调整，并切到合适的显示模式）。 */
  const openParamCommand = (command: ParamCommand) => {
    if (!image || busy || !COMMAND_OPS[command]) return
    const op = COMMAND_OPS[command]
    if (op !== 'levels' && colorPreview.length) commitColorPreview(colorPreview, false)
    setShowOriginal(false); setShowColor(op !== 'threshold'); setParamCommand(command)
  }
  /** 命令目录点选：再点一次已展开的命令即收起。 */
  const toggleParamCommand = (command: string) => {
    if (paramCommand === command) { closeParamCommand(); return }
    openParamCommand(command as ParamCommand)
  }
  const runCommand = (op: string) => {
    if (!image || busy) return
    if (op === 'levels' || op === 'threshold' || op === 'gaussian') { openParamCommand(OP_COMMANDS[op]); return }
    if (op === 'crop') {
      if (stack) { setError(copy.stack.geometryUnavailable); return }
      if (!roi) { setError(copy.errors.needsRoi); return }
      submit(op, { ...roi }, null); setRoi(null); return
    }
    if (op === 'rotateCW' || op === 'rotateCCW') {
      if (stack) { setError(copy.stack.geometryUnavailable); return }
      submit(op, {}, null); setRoi(null); return
    }
    submit(op, {}, op === 'grayscale' ? null : roi)
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
  const closeParamCommand = () => { if (colorPreview.length) commitColorPreview(colorPreview, false); setBrightness(0); setContrast(50); setParamCommand(null) }
  const applyCurrentLevels = () => { submit('levels', { brightness, contrast }, null); setBrightness(0); setContrast(50) }
  const applyCurrentThreshold = () => submit('threshold', { level: thresholdLevel })
  const applyOtsu = () => submit('otsu')
  const undo = () => { setError(''); setShowOriginal(false); setShowColor(true); setColorPreview([]); setColorSession((value) => value + 1); if (!colorPreview.length) runtime.undo() }
  const redo = () => { setError(''); setShowOriginal(false); setShowColor(true); setColorPreview([]); setColorSession((value) => value + 1); runtime.redo() }
  const zoomByStep = (direction: 1 | -1) => viewportRef.current?.zoomBy(direction > 0 ? 1.25 : 0.8)
  const fitToWindow = () => viewportRef.current?.fit()
  const showActualSize = () => viewportRef.current?.actualSize()
  const analyzeCurrentParticles = () => setViews((cards) => cards.some((card) => card.type === 'particles') ? cards : [...cards, { id: viewsIdRef.current++, type: 'particles' }])
  const viewTitle = (type: ViewType) => type === 'particles' && particles ? `${copy.views.particles} · ${particles.length}` : copy.views[type]
  const addView = (type: ViewType) => setViews((cards) => cards.some((card) => card.type === type) ? cards : [...cards, { id: viewsIdRef.current++, type }])
  const removeView = (id: number) => setViews((cards) => cards.filter((card) => card.id !== id))
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
      const bytes = await encodeImageBlock(toDisplayBlock(displayBlock, displayWindow, rasterOptions), 'image/png')
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
      const prepared = prepareChartCanvas(canvas, 112)
      if (!prepared) return
      const { context, width: cssWidth } = prepared
      const cssHeight = 112
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

  // 色彩平衡只在 RGB 图上可用；灰度图下它保持「尚未接入」的禁用态。
  const expandableCommands = useMemo<ParamCommand[]>(
    () => isRgb ? ['Brightness/Contrast', 'Color Balance', 'Threshold', 'Gaussian Blur'] : ['Brightness/Contrast', 'Threshold', 'Gaussian Blur'],
    [isRgb],
  )
  const panel: ReactNode = paramOp === 'levels'
    ? isRgb && image
      ? <ColorContrastPanel embedded session={colorSession} block={image} roi={roi} language={language} busy={busy} hasStack={Boolean(stack)} onPreview={setColorPreview} onApply={commitColorPreview} onClose={closeParamCommand} />
      : <LevelsCommandPanel copy={copy} brightness={brightness} contrast={contrast} active={levelsActive} disabled={!hasImage || busy} onBrightness={setBrightness} onContrast={setContrast} onApply={applyCurrentLevels} onClose={closeParamCommand} />
    : paramOp === 'threshold'
      ? <ThresholdCommandPanel copy={copy} level={thresholdLevel} minimum={stats?.histogramMin ?? 0} maximum={stats?.histogramMax ?? 255} step={image?.dtype === 'float32' ? 'any' : 1} disabled={!hasImage || busy} onLevel={setThresholdLevel} onApply={applyCurrentThreshold} onOtsu={applyOtsu} onClose={closeParamCommand} />
      : paramOp === 'gaussian'
        ? <GaussianCommandPanel copy={copy} sigma={gaussianSigma} disabled={!hasImage || busy} onSigma={setGaussianSigma} onApply={() => submit('gaussian', { sigma: gaussianSigma })} onClose={closeParamCommand} />
        : null

  /* ---------------- 右栏：卡片式视图（一个卡片 = 一个可视化） ---------------- */

  const viewCards = views.length ? (
    <div className="grid gap-4">
      {views.map((card) => (
        <section key={card.id} className="grid gap-2 rounded-[calc(var(--radius-box)+0.25rem)] bg-muted/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-base-content/55">{viewTitle(card.type)}</h3>
            <button
              type="button"
              aria-label={copy.close}
              onClick={() => removeView(card.id)}
              className="rounded-[var(--radius-field)] p-1 text-base-content/50 transition hover:bg-base-200 hover:text-base-content"
            >
              <X size={14} />
            </button>
          </div>

          {card.type === 'measurement' ? (
            !hasImage ? (
              <p className="text-sm text-base-content/55">{copy.emptyDescription}</p>
            ) : stats ? (
              <dl className="grid grid-cols-2 gap-2">
                {[
                  [copy.stats.pixels, stats.count.toLocaleString()],
                  [copy.stats.area, stats.area.toLocaleString()],
                  [copy.stats.mean, stats.mean.toFixed(2)],
                  [copy.stats.min, String(stats.min)],
                  [copy.stats.max, String(stats.max)],
                  [copy.stats.stdDev, stats.stdDev.toFixed(2)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[var(--radius-field)] bg-base-100 px-3 py-2">
                    <dt className="text-[11px] text-base-content/55">{label}</dt>
                    <dd className="font-mono text-sm font-semibold tabular-nums text-base-content">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-base-content/55">{scope === 'roi' && !roi ? copy.roi.needRoi : copy.status.loading}</p>
            )
          ) : null}

          {card.type === 'histogram' ? (
            <div className="rounded-[var(--radius-field)] bg-base-100">
              <HistogramChart
                data={stats ? { counts: stats.histogram, min: stats.histogramMin, max: stats.histogramMax } : null}
                height={112}
                color="var(--foreground)"
                labels={{ count: copy.stats.pixel, cumulative: copy.stats.cumulative, level: copy.stats.level, frequency: copy.stats.frequency, empty: stats ? '' : copy.status.loading }}
                ariaLabel={copy.views.histogram}
              />
            </div>
          ) : null}

          {card.type === 'profile' ? (
            <div className="grid gap-1">
              <canvas ref={profileCanvasRef} className="block w-full rounded-[var(--radius-field)] bg-base-100" style={{ height: 112 }} />
              <p className="text-[11px] text-base-content/55">{copy.views.profileNote}</p>
            </div>
          ) : null}

          {card.type === 'particles' ? (
            particles ? (
              <>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="imagej-particle-min-area" className="text-xs">{copy.binary.minArea}</Label>
                    <input
                      id="imagej-particle-min-area"
                      type="number"
                      min={1}
                      max={current ? current.width * current.height : undefined}
                      step={1}
                      value={minParticleArea}
                      onChange={(event) => setMinParticleArea(Math.max(1, Math.round(Number(event.target.value) || 1)))}
                      className="h-8 w-24 rounded-md border border-base-300 bg-base-100 px-2 text-sm"
                    />
                  </div>
                  <Button type="button" variant="secondary" size="sm" className="h-8" onClick={analyzeCurrentParticles}>
                    {copy.binary.analyze}
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={exportParticlesCsv}>{copy.binary.exportCsv}</Button>
                </div>
                <div className="max-h-56 overflow-auto rounded-[var(--radius-field)] bg-base-100">
                  <table className="w-full min-w-[280px] text-left text-xs tabular-nums">
                    <thead><tr className="border-b border-base-300"><th className="p-1.5">#</th><th className="p-1.5">{copy.stats.area}</th><th className="p-1.5">{copy.binary.perimeter}</th><th className="p-1.5">{copy.binary.circularity}</th><th className="p-1.5">{copy.binary.centroid}</th></tr></thead>
                    <tbody>{particles.map((particle) => (
                      <tr key={particle.id} className="border-b border-base-200">
                        <td className="p-1.5">{particle.id}</td><td className="p-1.5">{particle.area}</td>
                        <td className="p-1.5">{particle.perimeter}</td>
                        <td className="p-1.5">{particle.circularity.toFixed(3)}</td>
                        <td className="p-1.5">({particle.centroidX.toFixed(1)}, {particle.centroidY.toFixed(1)})</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </>
            ) : (
              <Button type="button" variant="secondary" size="sm" className="h-8 w-full" disabled={!hasImage || busy} onClick={analyzeCurrentParticles}>
                {copy.binary.analyze}
              </Button>
            )
          ) : null}
        </section>
      ))}
    </div>
  ) : (
    <p className="rounded-[calc(var(--radius-box)+0.25rem)] bg-muted/50 p-4 text-sm text-base-content/55">
      {hasImage ? copy.views.empty : copy.emptyDescription}
    </p>
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
              accept="image/*,.tif,.tiff,.webp,.fits,.fit,.fts"
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

            <div role="group" aria-label={copy.viewer.tool} className="inline-flex shrink-0 rounded-[var(--radius-field)] bg-muted p-0.5">
              {(['pan', 'roi'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={tool === value}
                  className={`h-6 rounded-[calc(var(--radius-field)-2px)] px-2 text-[11px] font-medium transition ${
                    tool === value ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/55 hover:text-base-content'
                  }`}
                  onClick={() => setTool(value)}
                >
                  {value === 'pan' ? copy.viewer.pan : copy.viewer.roiSelect}
                </button>
              ))}
            </div>

            {state.dataset?.componentKind === 'rgb' ? (
              <div role="group" aria-label={copy.viewer.display} className="inline-flex shrink-0 rounded-[var(--radius-field)] bg-muted p-0.5">
                {(['color', 'gray'] as const).map((value) => {
                  const active = value === 'color' ? showColor : !showColor
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      className={`h-6 rounded-[calc(var(--radius-field)-2px)] px-2 text-[11px] font-medium transition ${
                        active ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/55 hover:text-base-content'
                      }`}
                      onClick={() => setShowColor(value === 'color')}
                    >
                      {value === 'color' ? copy.viewer.color : copy.viewer.gray}
                    </button>
                  )
                })}
              </div>
            ) : null}

            <Button type="button" variant={showOriginal ? 'secondary' : 'outline'} size="sm" aria-pressed={showOriginal} disabled={!original || busy} onClick={() => { setShowOriginal(!showOriginal); closeParamCommand() }}>{copy.original}</Button>

            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-[var(--radius-field)] bg-muted p-0.5">
              <button type="button" aria-label={copy.zoomOut} disabled={!hasImage || busy} onClick={() => zoomByStep(-1)}
                className="flex size-6 items-center justify-center rounded-[calc(var(--radius-field)-2px)] text-base-content/70 transition hover:bg-base-100 hover:text-base-content disabled:opacity-40">
                <ZoomOut size={14} />
              </button>
              <span className="min-w-9 shrink-0 text-center text-[11px] tabular-nums text-base-content/70">
                {Math.round(zoom * 100)}%
              </span>
              <button type="button" aria-label={copy.zoomIn} disabled={!hasImage || busy} onClick={() => zoomByStep(1)}
                className="flex size-6 items-center justify-center rounded-[calc(var(--radius-field)-2px)] text-base-content/70 transition hover:bg-base-100 hover:text-base-content disabled:opacity-40">
                <ZoomIn size={14} />
              </button>
            </span>
            <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={!hasImage || busy} onClick={showActualSize}>
              {copy.viewer.actualSize}
            </Button>
            <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={!hasImage || busy} onClick={fitToWindow}>
              {copy.fit}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="shrink-0" disabled={!roi} onClick={() => setRoi(null)}>
              {copy.roi.clear}
            </Button>

            {slices.map((entry) => <span key={entry.axis} className="inline-flex shrink-0 items-center gap-1">
              <span className="text-[11px] uppercase text-base-content/55">{entry.axis}</span>
              <Button type="button" variant="outline" size="icon-sm" disabled={busy || entry.index === 0} aria-label={`${entry.axis} previous slice`} onClick={() => selectAxis(entry.axis, entry.index - 1)}>←</Button>
              <span className="text-[11px] tabular-nums">{stale ? '…' : entry.index + 1} / {entry.length}</span>
              <Button type="button" variant="outline" size="icon-sm" disabled={busy || entry.index + 1 >= entry.length} aria-label={`${entry.axis} next slice`} onClick={() => selectAxis(entry.axis, entry.index + 1)}>→</Button>
              <input type="range" min={0} max={entry.length - 1} value={entry.index} disabled={busy} onChange={(event) => selectAxis(entry.axis, Number(event.target.value))} aria-label={`${entry.axis} ${copy.stack.page}`} className="w-20 accent-primary" />
            </span>)}

            <span className="ml-auto hidden shrink-0 truncate pl-2 font-mono text-[11px] text-base-content/55 md:inline">
              {probe ? `(${probe.x}, ${probe.y}) = ${probe.value} · ` : ''}{roiLabel}
            </span>
          </>
        }
      />

      <div className="grid min-h-0 min-w-0 grid-cols-1 overflow-y-auto lg:grid-cols-[260px_minmax(0,1fr)_300px] lg:overflow-hidden">
        {/* 左栏「处理」：命令目录（选中项下方内联展开自己的操作面板）+ 撤销 / 状态 */}
        <aside className="order-2 flex min-h-0 flex-col border-b border-base-300 bg-base-100 lg:order-none lg:h-full lg:border-b-0 lg:border-r">
          {stack && <div className="shrink-0 border-b border-base-300 px-2.5 py-2 text-[11px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={applyAll} onChange={(event) => setApplyAll(event.target.checked)} />{copy.stack.applyAll}</label>
          </div>}
          <div className="min-h-0 flex-1">
            <ImageJSidebar language={language} registry={registry} onRun={runCommand} disabled={!hasImage || busy}
              expandableCommands={expandableCommands} expandedCommand={paramCommand} panel={panel} onToggleCommand={toggleParamCommand}
              stackActions={{ next: () => selectPage(pageIndex + 1), previous: () => selectPage(pageIndex - 1), canNext: Boolean(slice && pageIndex + 1 < slice.length), canPrevious: pageIndex > 0 }} />
          </div>

          <details className="max-h-40 shrink-0 overflow-auto border-t border-base-300 px-3 py-2 text-xs">
            <summary>{copy.steps.heading} · {state.recipe?.steps.length ?? 0}</summary>
            <ol className="mt-2 grid gap-1">{state.recipe?.steps.map((step) => <li key={step.id} className="flex items-center justify-between gap-2"><button disabled={busy || !stepAppliesToSelection(step, state.selection)} onClick={() => { setShowOriginal(false); runtime.viewStep(step.id) }}>{copy.steps.ops[step.op] ?? step.op}</button><button disabled={busy} aria-label={copy.steps.remove} onClick={() => { setShowOriginal(false); runtime.removeStep(step.id) }}><X size={12} /></button></li>)}</ol>
          </details>
          <footer className="shrink-0 border-t border-base-300 px-2.5 py-2">
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.history.undo} disabled={busy || !historyFlags.canUndo} onClick={undo}>
                <Undo2 size={14} />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.history.redo} disabled={busy || !historyFlags.canRedo} onClick={redo}>
                <Redo2 size={14} />
              </Button>
            </div>
            <div role="status" aria-live="polite" className="mt-1 min-h-4 text-[11px] text-base-content/60">
              {status}{state.lastRunMs !== undefined ? ` · ${state.lastRunMs} ms` : ''}
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
                ref={viewportRef}
                block={displayBlock}
                windowLevel={displayWindow}
                options={rasterOptions}
                tool={tool}
                roi={roi}
                onRoi={(rect) => { if (!stale) setRoi(rect) }}
                onProbe={(value) => setProbe(stale ? null : value)}
                onZoom={setZoom}
                onStepPage={slice && slice.length > 1 ? stepPage : undefined}
              />
              {stale && (
                <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-base-100/50">
                  <span className="rounded-[var(--radius-box)] bg-base-200 px-2 py-1 text-[11px] text-base-content/70">
                    {copy.status.loading}
                  </span>
                </div>
              )}
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
        </main>

        {/* 右栏「分析」：卡片式视图（一个卡片一个可视化）+ 导出 */}
        <aside className="order-3 flex min-h-0 flex-col border-t border-base-300 bg-base-100 lg:order-none lg:h-full lg:border-t-0 lg:border-l">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-base-300 px-3 py-2">
            {hasImage ? (
              <span className="inline-flex rounded-[var(--radius-field)] bg-base-200 p-0.5">
                {(['image', 'roi'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={scope === value}
                    disabled={value === 'roi' && !roi}
                    className={`h-6 rounded-[calc(var(--radius-field)-2px)] px-2 text-[11px] font-medium transition disabled:opacity-40 ${
                      scope === value ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/55 hover:text-base-content'
                    }`}
                    onClick={() => setScope(value)}
                  >
                    {value === 'image' ? copy.roi.scopeImage : copy.roi.scopeRoi}
                  </button>
                ))}
              </span>
            ) : <span />}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-7" disabled={!hasImage || busy}>
                  <Plus size={14} />
                  {copy.views.add}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {VIEW_TYPES.map((type) => {
                  const added = views.some((card) => card.type === type)
                  return (
                    <DropdownMenuItem key={type} disabled={!hasImage || added} onSelect={() => addView(type)}>
                      <span className="flex-1">{viewTitle(type)}</span>
                      {added ? <Check size={14} /> : null}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">{viewCards}</div>

          <footer className="shrink-0 border-t border-base-300 px-2.5 py-2">
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

interface DocumentEntry { id: string; title: string; files: File[]; runtime: ImageRuntime }

/** 文件夹导入时按扩展名筛选图片。 */
const IMAGE_FILE = /\.(png|jpe?g|webp|tiff?|bmp|gif|fits?|fts)$/i

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

  /* 卸载时释放全部文档运行时。 */
  useEffect(() => () => { for (const doc of documentsRef.current) doc.runtime.dispose() }, [])

  const openFiles = (files: readonly File[]) => {
    if (!files.length) return
    const created: DocumentEntry[] = []
    for (const file of files) {
      const runtime = createDocumentRuntime(engine)
      created.push({ id: nextDocumentId(), title: file.name, files: [file], runtime })
      void runtime.openFile(file)
    }
    setDocuments((docs) => [...docs, ...created])
    setActiveId(created[created.length - 1]!.id)
  }

  /** 把多个文件作为一个 Stack 打开（文件夹导入 / 合并 tab）。 */
  const openStackFiles = (files: readonly File[], title?: string) => {
    if (files.length < 2) { openFiles(files); return }
    const runtime = createDocumentRuntime(engine)
    const entry: DocumentEntry = { id: nextDocumentId(), title: title ?? `${files.length} images`, files: [...files], runtime }
    setDocuments((docs) => [...docs, entry])
    setActiveId(entry.id)
    void runtime.openStack(files)
  }

  /** 选择文件夹：过滤图片、按文件名自然排序后合成一个 Stack。 */
  const pickFolder = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    ;(input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true
    input.onchange = () => {
      const all = Array.from(input.files ?? [])
      const images = all
        .filter((file) => IMAGE_FILE.test(file.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
      if (!images.length) return
      const folder = images[0]!.webkitRelativePath?.split('/')[0]
      openStackFiles(images, folder || `${images.length} images`)
    }
    input.click()
  }

  /** 把任意多个 tab 的文件合成一个新的 Stack tab，并关闭原 tab（分组 = 组成 stack）。 */
  const mergeSelected = (ids: readonly string[]) => {
    const selected = documents.filter((doc) => ids.includes(doc.id))
    if (selected.length < 2) return
    const files = selected.flatMap((doc) => doc.files)
    for (const doc of selected) doc.runtime.dispose()
    const runtime = createDocumentRuntime(engine)
    const entry: DocumentEntry = { id: nextDocumentId(), title: `${files.length} images`, files, runtime }
    setDocuments((docs) => [...docs.filter((doc) => !ids.includes(doc.id)), entry])
    setActiveId(entry.id)
    void runtime.openStack(files)
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
    if (files.length > 1) void runtime.openStack(files)
    else if (files.length === 1) void runtime.openFile(files[0]!)
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
      void runtime.openFile(file)
      return { id: nextDocumentId(), title: file.name, files: [file], runtime }
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
    void ejected.runtime.openFile(file)
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
    if (files.length) openFiles(files)
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
      if (images.length) openStackFiles(images, folder.name)
    }
    if (files.length) openFiles(files)
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
      <TabsList className="h-full min-w-0 flex-1 items-stretch justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0">
        {documents.map((doc, index) => (
          <ContextMenu key={doc.id}>
            <ContextMenuTrigger asChild>
              <div className="group relative flex shrink-0 items-stretch">
                <TabsTrigger
                  value={doc.id}
                  title={doc.title}
                  className="h-full max-w-44 gap-1 rounded-[var(--radius-field)] border border-transparent py-0 pr-6 pl-2 text-xs data-[state=active]:border-base-300 data-[state=active]:bg-base-200">
                  <span className="truncate">{doc.title}</span>
                </TabsTrigger>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${copy.close} ${doc.title}`}
                  onClick={(event) => { event.stopPropagation(); closeDocument(doc.id) }}
                  className="absolute right-0.5 top-1/2 size-5 -translate-y-1/2 rounded-[3px] text-base-content/45 opacity-60 hover:bg-base-300 hover:text-base-content hover:opacity-100">
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
      <input ref={fileInputRef} type="file" multiple accept="image/*,.tif,.tiff,.webp,.fits,.fit,.fts" className="hidden" onChange={onFileInput} />
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
            <ImageDocumentView runtime={doc.runtime} onOpenImage={(file) => openFiles([file])} tabsHeader={doc.id === activeId ? tabsHeader : null} onEjectPage={doc.files.length > 1 ? (index) => extractPage(doc.id, index) : undefined} />
          </TabsContent>
        ))}
      </div>
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-base-100/60">
          <div className="rounded-[var(--radius-box)] border-2 border-dashed border-primary/60 px-6 py-4 text-sm text-base-content/80">{copy.dropHint}</div>
        </div>
      ) : null}

      <StackBuilderDialog open={stackDialog} onOpenChange={setStackDialog} rows={stackRows} copy={copy.stackBuilder} onCreate={mergeSelected} />

      <Dialog open={Boolean(renameDoc)} onOpenChange={(open) => { if (!open) setRenameId(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{copy.rename.title}</DialogTitle>
          </DialogHeader>
          <input
            value={renameValue}
            autoFocus
            aria-label={copy.rename.label}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') commitRename(); else if (event.key === 'Escape') setRenameId(null) }}
            className="h-9 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
