'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Check,
  Download,
  Image as ImageIcon,
  Plus,
  Redo2,
  Sparkles,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { AppNavbar } from '../../components/AppNavbar'
import { useI18n } from '../../i18n'
import { Button } from '@joplot/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@joplot/ui/dropdown-menu'
import { Label } from '@joplot/ui/label'
import { Slider } from '@joplot/ui/slider'
import { createImagejCopy, type ImagejCopy } from '../lib/i18n'
import { analyzeParticles, closeBinary, dilate, erode, fillHoles, openBinary, type Particle } from '../lib/binary'
import { decodeTiff, encodeTiff } from '../lib/tiff'
import { gaussianBlur, maximum3x3, minimum3x3 } from '../lib/filters'
import { MOCK_REGISTRY } from '../lib/engineRegistry.mock'
import { ImageJSidebar } from './ImageJSidebar'
import {
  ImagejError,
  MAX_IMAGE_PIXELS,
  applyLevels,
  applyThreshold,
  applyWithinRoi,
  clampRect,
  cropImage,
  flipHorizontal,
  flipVertical,
  histogram,
  ImageHistory,
  invert,
  levelsRange,
  mean3x3,
  median3x3,
  measure,
  otsuThreshold,
  profileLine,
  rotate90,
  sharpen3x3,
  sobelEdges,
  toGrayFromRgba,
  toRgba,
  type GrayImage,
  type ImageStats,
  type Rect,
} from '../lib/processor'

/**
 * 图像工作台：左右双栏（左「处理」右「分析」），点命令直接执行。
 *
 * - 左栏：处理命令目录 + 参数面板（非模态内联展开，调参时可同时看图与右栏直方图）。
 * - 右栏：统计 / 直方图 / 粒子结果常驻显示 + 导出。
 * - 命令点击即调用 processor 执行并进撤销历史；图像居中显示。
 */

/** 浏览器 Canvas 支持的最大边长，超过则拒绝导入，避免解码时崩溃。 */
const MAX_CANVAS_SIDE = 16_384

const ZOOM_STEPS = [0.1, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32] as const
const MIN_ZOOM = ZOOM_STEPS[0]
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]

interface OriginalImage {
  width: number
  height: number
  data: Uint8ClampedArray<ArrayBuffer>
}

function paintGray(canvas: HTMLCanvasElement | null, image: GrayImage | null): void {
  if (!canvas || !image) return
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) return
  context.putImageData(new ImageData(toRgba(image), image.width, image.height), 0, 0)
}

function paintRgba(canvas: HTMLCanvasElement | null, image: OriginalImage | null): void {
  if (!canvas || !image) return
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) return
  context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0)
}

/** 判断导入的 RGBA 数据里是否存在彩色像素（R/G/B 不全相等）。 */
function hasColorData(rgba: ArrayLike<number>): boolean {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] !== rgba[i + 1] || rgba[i] !== rgba[i + 2]) {
      return true
    }
  }
  return false
}

function nextZoom(zoom: number, direction: 1 | -1): number {
  if (direction === 1) {
    return ZOOM_STEPS.find((step) => step > zoom + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  }
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-6) ?? ZOOM_STEPS[0]
}

function normalizeRect(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax) + 1,
    height: Math.abs(by - ay) + 1,
  }
}

function toErrorText(error: unknown, copy: ImagejCopy): string {
  if (error instanceof ImagejError) {
    switch (error.code) {
      case 'too-large':
        return copy.errors.tooLarge
      case 'decode':
        return copy.errors.decode
      case 'empty-roi':
      case 'invalid-rect':
        return copy.errors.needsRoi
      case 'no-image':
        return copy.errors.noImage
      default:
        return error.message || copy.errors.generic
    }
  }
  return error instanceof Error && error.message ? error.message : copy.errors.generic
}

type StatsScope = 'image' | 'roi'

type ViewerTool = 'pan' | 'roi'

/** 带参数的命令：在左栏顶部内联展开参数面板（非模态）。 */
type ParamPanel = 'levels' | 'threshold' | 'gaussian'

/** 右栏视图卡片：一个卡片 = 一个分析可视化视图。 */
type ViewType = 'measurement' | 'histogram' | 'profile' | 'particles'
interface ViewCard { id: number; type: ViewType }

/** 「添加视图」下拉里的可选视图（顺序即展示顺序）。 */
const VIEW_TYPES: ViewType[] = ['measurement', 'histogram', 'profile', 'particles']

interface DragState {
  mode: 'draw' | 'move' | 'pan'
  anchorX: number
  anchorY: number
  start: Rect
  startScrollLeft: number
  startScrollTop: number
}

/**
 * 图表画布按 devicePixelRatio 放大、坐标系换算回 CSS 像素——高分屏上不发虚。
 * 返回可绘制的 2D 上下文与 CSS 宽度；无上下文时返回 null。
 */
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

export function ImageJApp() {
  const { language } = useI18n()
  const copy = useMemo(() => createImagejCopy(language), [language])

  const historyRef = useRef(new ImageHistory())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resultCanvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const histogramCanvasRef = useRef<HTMLCanvasElement>(null)
  const profileCanvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const importTokenRef = useRef(0)

  const [original, setOriginal] = useState<OriginalImage | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [current, setCurrent] = useState<GrayImage | null>(null)
  const [showColor, setShowColor] = useState(true)
  const [roi, setRoi] = useState<Rect | null>(null)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const pendingAnchorRef = useRef<{ imageX: number; imageY: number; offsetX: number; offsetY: number } | null>(null)
  const wheelAccumRef = useRef(0)
  const wheelNavRef = useRef<{ count: number; step: (delta: number) => void }>({ count: 0, step: () => {} })
  const [brightness, setBrightness] = useState(0)
  const [contrast, setContrast] = useState(50)
  const [gaussianSigma, setGaussianSigma] = useState(1.5)
  const [thresholdLevel, setThresholdLevel] = useState(128)
  const [scope, setScope] = useState<StatsScope>('image')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [historyFlags, setHistoryFlags] = useState({ canUndo: false, canRedo: false })
  const [particles, setParticles] = useState<Particle[] | null>(null)
  const [minParticleArea, setMinParticleArea] = useState(1)
  const [stack, setStack] = useState<GrayImage[] | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [probe, setProbe] = useState<{ x: number; y: number; value: number } | null>(null)
  const [tool, setTool] = useState<ViewerTool>('pan')
  const [spaceHeld, setSpaceHeld] = useState(false)
  /** 左栏顶部展开的参数面板（亮度 / 阈值 / 高斯）。 */
  const [paramPanel, setParamPanel] = useState<ParamPanel | null>(null)
  /** 右栏卡片列表（载入图像时若为空则播种默认视图）。 */
  const [views, setViews] = useState<ViewCard[]>([])
  const viewsIdRef = useRef(1)

  const syncHistory = useCallback(() => {
    setHistoryFlags({
      canUndo: historyRef.current.canUndo,
      canRedo: historyRef.current.canRedo,
    })
  }, [])

  const levelsActive = brightness !== 0 || contrast !== 50

  const display = useMemo<GrayImage | null>(() => {
    if (!current) return null
    if (!levelsActive) return current
    const range = levelsRange(brightness, contrast)
    try {
      return applyLevels(current, range.min, range.max)
    } catch {
      return current
    }
  }, [current, brightness, contrast, levelsActive])

  const stats = useMemo<ImageStats | null>(() => {
    if (!current) return null
    if (scope === 'roi' && !roi) return null
    try {
      return measure(current, scope === 'roi' ? roi : null)
    } catch {
      return null
    }
  }, [current, roi, scope])

  /** Plot Profile：ROI 水平中线（无选区时为图像中线）上的灰度采样。 */
  const profileData = useMemo<number[] | null>(() => {
    if (!current) return null
    const y = roi ? Math.min(roi.y + Math.floor(roi.height / 2), current.height - 1) : Math.floor(current.height / 2)
    const x0 = roi ? roi.x : 0
    const x1 = roi ? Math.min(roi.x + roi.width - 1, current.width - 1) : current.width - 1
    try {
      return profileLine(current, x0, y, x1, y)
    } catch {
      return null
    }
  }, [current, roi])

  /** 首次载入（或视图被清空后）播种默认视图：统计测量 + 直方图。 */
  const seedDefaultViews = () => {
    setViews((cards) => (cards.length ? cards : [
      { id: viewsIdRef.current++, type: 'measurement' },
      { id: viewsIdRef.current++, type: 'histogram' },
    ]))
  }

  /* ---------------- 文件导入 ---------------- */

  const loadFile = useCallback(async (file: File) => {
    const token = ++importTokenRef.current
    setError('')
    setStatus(copy.status.loading)
    setParamPanel(null)

    if (/\.tiff?$/i.test(file.name) || file.type === 'image/tiff') {
      try {
        const pages = decodeTiff(await file.arrayBuffer())
        if (token !== importTokenRef.current) return
        setOriginal(null)
        setStack(pages)
        setPageIndex(0)
        setCurrent(pages[0])
        setShowColor(false)
        setProbe(null)
        setSourceName(file.name)
        setRoi(null)
        setParticles(null)
        setBrightness(0)
        setContrast(50)
        setZoom(1)
        historyRef.current.clear()
        syncHistory()
        setStatus(copy.status.ready)
        seedDefaultViews()
      } catch (loadError) {
        if (token !== importTokenRef.current) return
        setStatus('')
        setError(toErrorText(loadError, copy))
      }
      return
    }

    const objectUrl = URL.createObjectURL(file)
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image()
        element.onload = () => resolve(element)
        element.onerror = () => reject(new ImagejError('decode', 'decode failed'))
        element.src = objectUrl
      })
      if (token !== importTokenRef.current) return

      const width = image.naturalWidth
      const height = image.naturalHeight
      if (!width || !height) {
        throw new ImagejError('decode', 'empty image')
      }
      if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE || width * height > MAX_IMAGE_PIXELS) {
        throw new ImagejError('too-large', `${width}x${height}`)
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        throw new ImagejError('decode', 'no 2d context')
      }
      context.drawImage(image, 0, 0)
      const rgba = context.getImageData(0, 0, width, height).data

      const gray = toGrayFromRgba(width, height, rgba)
      setOriginal({ width, height, data: rgba })
      setCurrent(gray)
      setShowColor(hasColorData(rgba))
      setProbe(null)
      setStack(null)
      setPageIndex(0)
      setParticles(null)
      setSourceName(file.name)
      setRoi(null)
      setBrightness(0)
      setContrast(50)
      setThresholdLevel(128)
      setZoom(1)
      historyRef.current.clear()
      syncHistory()
      setStatus(copy.status.ready)
      seedDefaultViews()
    } catch (loadError) {
      if (token !== importTokenRef.current) return
      setStatus('')
      setError(toErrorText(loadError, copy))
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }, [copy, syncHistory])

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void loadFile(file)
    event.target.value = ''
  }

  /* ---------------- 操作提交 ---------------- */

  const commit = useCallback((next: GrayImage, options?: { resetRoi?: boolean }) => {
    if (!current) return
    historyRef.current.push(current)
    setCurrent(next)
    setShowColor(false)
    setProbe(null)
    if (stack) setStack((pages) => pages?.map((page, index) => index === pageIndex ? next : page) ?? null)
    setParticles(null)
    if (options?.resetRoi) {
      setRoi(null)
    } else if (roi) {
      setRoi(clampRect(roi, next))
    }
    syncHistory()
    setStatus(copy.status.applied)
  }, [current, roi, copy, syncHistory, stack, pageIndex])

  const guardImage = (): GrayImage | null => {
    if (!current) {
      setError(copy.errors.noImage)
      return null
    }
    setError('')
    return current
  }

  const run = (operation: (image: GrayImage) => GrayImage, options?: { resetRoi?: boolean; roiMode?: 'whole' | 'selection' }) => {
    const image = guardImage()
    if (!image) return
    try {
      const next = options?.roiMode === 'whole'
        ? operation(image)
        : applyWithinRoi(image, roi, operation, options?.roiMode === 'selection')
      commit(next, options)
    } catch (operationError) {
      setError(toErrorText(operationError, copy))
    }
  }

  const runAdvanced = (operation: (image: GrayImage) => GrayImage) => {
    run(operation, { roiMode: 'selection' })
  }

  const resetToGray = () => {
    if (!original) return
    setError('')
    try {
      commit(toGrayFromRgba(original.width, original.height, original.data), { resetRoi: true })
    } catch (resetError) {
      setError(toErrorText(resetError, copy))
    }
  }

  const applyCurrentLevels = () => {
    const image = guardImage()
    if (!image) return
    const range = levelsRange(brightness, contrast)
    try {
      commit(applyLevels(image, range.min, range.max))
      setBrightness(0)
      setContrast(50)
    } catch (levelsError) {
      setError(toErrorText(levelsError, copy))
    }
  }

  const applyCurrentThreshold = () => {
    const image = guardImage()
    if (!image) return
    try {
      commit(applyWithinRoi(image, roi, (source) => applyThreshold(source, thresholdLevel)))
    } catch (thresholdError) {
      setError(toErrorText(thresholdError, copy))
    }
  }

  const applyOtsu = () => {
    const image = guardImage()
    if (!image) return
    try {
      const bins = histogram(image, roi)
      const level = Math.max(0, Math.min(255, otsuThreshold(bins)))
      setThresholdLevel(level)
      commit(applyWithinRoi(image, roi, (source) => applyThreshold(source, level)))
      setStatus(`${copy.adjust.otsuResult}: ${level}`)
    } catch (otsuError) {
      setError(toErrorText(otsuError, copy))
    }
  }

  const cropToRoi = () => {
    const image = guardImage()
    if (!image) return
    if (!roi) {
      setError(copy.errors.needsRoi)
      return
    }
    try {
      commit(cropImage(image, roi), { resetRoi: true })
      setZoom(1)
    } catch (cropError) {
      setError(toErrorText(cropError, copy))
    }
  }

  const undo = () => {
    const image = guardImage()
    if (!image) return
    const previous = historyRef.current.undo(image)
    if (!previous) return
    setCurrent(previous)
    setShowColor(false)
    setProbe(null)
    if (stack) setStack((pages) => pages?.map((page, index) => index === pageIndex ? previous : page) ?? null)
    setParticles(null)
    setRoi((currentRoi) => (currentRoi ? clampRect(currentRoi, previous) : null))
    syncHistory()
    setStatus(copy.status.ready)
  }

  const redo = () => {
    const image = guardImage()
    if (!image) return
    const next = historyRef.current.redo(image)
    if (!next) return
    setCurrent(next)
    setShowColor(false)
    setProbe(null)
    if (stack) setStack((pages) => pages?.map((page, index) => index === pageIndex ? next : page) ?? null)
    setParticles(null)
    setRoi((currentRoi) => (currentRoi ? clampRect(currentRoi, next) : null))
    syncHistory()
    setStatus(copy.status.ready)
  }

  /* ---------------- 导出 ---------------- */

  const exportPng = () => {
    const image = display ?? guardImage()
    if (!image) return
    try {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      if (!context) throw new ImagejError('decode', 'no 2d context')
      context.putImageData(new ImageData(toRgba(image), image.width, image.height), 0, 0)
      canvas.toBlob((blob) => {
        if (!blob) {
          setError(copy.errors.generic)
          return
        }
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${sourceName.replace(/\.[^.]+$/, '') || 'image'}-result.png`
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
        setStatus(copy.status.applied)
      }, 'image/png')
    } catch (exportError) {
      setError(toErrorText(exportError, copy))
    }
  }

  const downloadTiff = (allPages: boolean) => {
    const image = guardImage()
    if (!image) return
    try {
      const pages = allPages && stack ? stack : [display ?? image]
      const blob = new Blob([encodeTiff(pages)], { type: 'image/tiff' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${sourceName.replace(/\.[^.]+$/, '') || 'image'}${allPages && stack ? '-stack' : '-result'}.tif`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (exportError) {
      setError(toErrorText(exportError, copy))
    }
  }

  const selectPage = (index: number) => {
    if (!stack || index < 0 || index >= stack.length) return
    setPageIndex(index)
    setCurrent(stack[index])
    setShowColor(false)
    setProbe(null)
    setRoi(null)
    setParticles(null)
    setBrightness(0)
    setContrast(50)
    historyRef.current.clear()
    syncHistory()
  }

  // 供视口滚轮翻页读取：每次渲染刷新，避免 effect 反复重绑。
  wheelNavRef.current = { count: stack?.length ?? 0, step: (delta: number) => selectPage(pageIndex + delta) }

  const analyzeCurrentParticles = () => {
    const image = guardImage()
    if (!image) return
    try {
      setParticles(analyzeParticles(image, minParticleArea))
    } catch (analysisError) {
      setError(toErrorText(analysisError, copy))
    }
  }

  const exportParticlesCsv = () => {
    if (!particles) return
    const lines = ['id,area,perimeter,circularity,centroid_x,centroid_y,bounds_x,bounds_y,bounds_width,bounds_height']
    for (const particle of particles) {
      lines.push([
        particle.id, particle.area, particle.perimeter, particle.circularity,
        particle.centroidX, particle.centroidY, particle.bounds.x, particle.bounds.y,
        particle.bounds.width, particle.bounds.height,
      ].join(','))
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${sourceName.replace(/\.[^.]+$/, '') || 'image'}-particles.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  /* ---------------- 右栏视图卡片 ---------------- */

  /** 「添加视图」下拉项：已添加的类型置灰（粒子卡带结果计数）。 */
  const viewTitle = (type: ViewType): string => {
    switch (type) {
      case 'measurement':
        return copy.views.measurement
      case 'histogram':
        return copy.views.histogram
      case 'profile':
        return copy.views.profile
      case 'particles':
        return particles ? `${copy.views.particles} · ${particles.length}` : copy.views.particles
    }
  }

  const addView = (type: ViewType) => {
    setViews((cards) => (cards.some((card) => card.type === type) ? cards : [...cards, { id: viewsIdRef.current++, type }]))
    if (type === 'particles' && current) analyzeCurrentParticles()
  }

  const removeView = (id: number) => setViews((cards) => cards.filter((card) => card.id !== id))

  /* ---------------- 命令分发（侧栏点一下直接执行） ---------------- */

  /** 多页栈上不允许改变切片尺寸的操作。 */
  const guardStackSize = () => {
    if (stack && stack.length > 1) {
      setError(copy.stack.geometryUnavailable)
      return false
    }
    return true
  }

  const runCommand = (op: string) => {
    switch (op) {
      case 'grayscale':
        return resetToGray()
      case 'invert':
        return run(invert)
      case 'levels':
        return setParamPanel('levels')
      case 'threshold':
        return setParamPanel('threshold')
      case 'otsu':
        return applyOtsu()
      case 'mean3x3':
        return run(mean3x3)
      case 'median3x3':
        return run(median3x3)
      case 'sharpen3x3':
        return run(sharpen3x3)
      case 'sobel':
        return run(sobelEdges)
      case 'minimum3x3':
        return runAdvanced(minimum3x3)
      case 'maximum3x3':
        return runAdvanced(maximum3x3)
      case 'gaussian':
        return setParamPanel('gaussian')
      case 'erode':
        return runAdvanced(erode)
      case 'dilate':
        return runAdvanced(dilate)
      case 'open':
        return runAdvanced(openBinary)
      case 'close':
        return runAdvanced(closeBinary)
      case 'fillHoles':
        return runAdvanced(fillHoles)
      case 'crop':
        if (!guardStackSize()) return
        return cropToRoi()
      case 'flipH':
        return run(flipHorizontal, { roiMode: 'selection' })
      case 'flipV':
        return run(flipVertical, { roiMode: 'selection' })
      case 'rotateCW':
        if (!guardStackSize()) return
        return run((image) => rotate90(image, 'cw'), { resetRoi: true, roiMode: 'whole' })
      case 'rotateCCW':
        if (!guardStackSize()) return
        return run((image) => rotate90(image, 'ccw'), { resetRoi: true, roiMode: 'whole' })
      default:
        return
    }
  }

  /** 关闭参数面板：亮度/对比度复位即撤掉实时预览（不写入历史）。 */
  const closeParamPanel = () => {
    setBrightness(0)
    setContrast(50)
    setParamPanel(null)
  }

  /* ---------------- 画布绘制 ---------------- */

  useEffect(() => {
    if (showColor && original) {
      paintRgba(resultCanvasRef.current, original)
      return
    }
    paintGray(resultCanvasRef.current, display)
  }, [display, showColor, original])

  // 空格键临时切到平移（与中键、平移工具等效）。
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      return Boolean(element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable))
    }
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTypingTarget(event.target)) setSpaceHeld(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // 直方图卡片：按 devicePixelRatio 重绘，带坐标轴/刻度/峰值标注与阈值虚线标记。
  useEffect(() => {
    const canvas = histogramCanvasRef.current
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
      const destructive = styles.getPropertyValue('--destructive').trim() || '#ef4444'

      // 水平网格线（100% / 50% / 0）
      context.strokeStyle = foreground
      context.lineWidth = 1
      for (const fraction of [0, 0.5, 1]) {
        const y = Math.round(padTop + plotHeight * fraction) + 0.5
        context.globalAlpha = 0.1
        context.beginPath()
        context.moveTo(padLeft, y)
        context.lineTo(padLeft + plotWidth, y)
        context.stroke()
      }
      // 基线
      const baseY = Math.round(padTop + plotHeight) + 0.5
      context.globalAlpha = 0.25
      context.beginPath()
      context.moveTo(padLeft, baseY)
      context.lineTo(padLeft + plotWidth, baseY)
      context.stroke()
      context.globalAlpha = 1

      // x 轴刻度：0 / 128 / 255
      context.font = '9px ui-monospace, SFMono-Regular, monospace'
      context.fillStyle = foreground
      context.globalAlpha = 0.55
      context.textAlign = 'left'
      context.fillText('0', padLeft, cssHeight - 5)
      context.textAlign = 'center'
      context.fillText('128', padLeft + plotWidth / 2, cssHeight - 5)
      context.textAlign = 'right'
      context.fillText('255', padLeft + plotWidth, cssHeight - 5)

      if (stats) {
        const bins = stats.histogram
        let maxCount = 0
        for (let i = 0; i < bins.length; i += 1) {
          if (bins[i] > maxCount) maxCount = bins[i]
        }
        if (maxCount > 0) {
          // 峰值计数标注
          context.fillText(String(maxCount), padLeft + plotWidth, padTop - 5)

          const barWidth = plotWidth / bins.length
          context.fillStyle = primary
          context.globalAlpha = 0.85
          for (let i = 0; i < bins.length; i += 1) {
            const barHeight = (bins[i] / maxCount) * plotHeight
            if (barHeight <= 0) continue
            const x = padLeft + i * barWidth
            context.fillRect(x, padTop + plotHeight - barHeight, Math.max(1, barWidth - 0.5), barHeight)
          }
          context.globalAlpha = 1

          // 阈值标记：虚线贯穿
          const markerX = padLeft + (thresholdLevel / 255) * plotWidth
          context.strokeStyle = destructive
          context.globalAlpha = 0.9
          context.lineWidth = 1.5
          context.setLineDash([4, 3])
          context.beginPath()
          context.moveTo(markerX, padTop - 3)
          context.lineTo(markerX, padTop + plotHeight)
          context.stroke()
          context.setLineDash([])
          context.globalAlpha = 1
        }
      }
      context.globalAlpha = 1
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [stats, thresholdLevel, views])

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
      for (const value of [255, 128, 0]) {
        const y = Math.round(padTop + plotHeight * (1 - value / 255)) + 0.5
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
      context.fillText('255', padLeft + plotWidth, padTop - 5)
      context.fillText('0', padLeft + plotWidth, cssHeight - 5)

      const values = profileData
      if (values && values.length >= 2) {
        const stepX = plotWidth / (values.length - 1)
        const pointX = (index: number) => padLeft + index * stepX
        const pointY = (value: number) => padTop + plotHeight * (1 - value / 255)

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
  }, [profileData, views])

  /* ---------------- 视口交互：缩放 / 平移 / ROI ---------------- */

  const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))

  const pointerToImage = (event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    if (!current) return null
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const x = Math.round(((event.clientX - rect.left) / rect.width) * current.width)
    const y = Math.round(((event.clientY - rect.top) / rect.height) * current.height)
    return {
      x: Math.max(0, Math.min(current.width - 1, x)),
      y: Math.max(0, Math.min(current.height - 1, y)),
    }
  }

  /** 以视口内某点为锚点缩放：滚动校正在浏览器绘制前完成，避免缩放时抖动。 */
  const zoomAt = (target: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    const applied = clampZoom(target)

    if (!viewport || !current) {
      zoomRef.current = applied
      setZoom(applied)
      return
    }

    const bounds = viewport.getBoundingClientRect()
    const offsetX = clientX - bounds.left
    const offsetY = clientY - bounds.top
    const currentZoom = zoomRef.current
    pendingAnchorRef.current = {
      imageX: (viewport.scrollLeft + offsetX) / currentZoom,
      imageY: (viewport.scrollTop + offsetY) / currentZoom,
      offsetX,
      offsetY,
    }
    zoomRef.current = applied
    setZoom(applied)
  }

  // 尺寸变化后、浏览器绘制前同步校正滚动位置（同一帧完成，不闪）。
  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current
    pendingAnchorRef.current = null
    const viewport = viewportRef.current
    if (!anchor || !viewport) return
    viewport.scrollLeft = anchor.imageX * zoom - anchor.offsetX
    viewport.scrollTop = anchor.imageY * zoom - anchor.offsetY
  }, [zoom])

  const zoomByStep = (direction: 1 | -1) => {
    const viewport = viewportRef.current
    const target = nextZoom(zoomRef.current, direction)
    if (!viewport) {
      setZoom(clampZoom(target))
      return
    }
    const bounds = viewport.getBoundingClientRect()
    zoomAt(target, bounds.left + viewport.clientWidth / 2, bounds.top + viewport.clientHeight / 2)
  }

  // 滚轮：Ctrl/⌘ + 滚轮缩放；普通滚轮在 Stack 下翻页。非 passive 监听才能 preventDefault 掉浏览器缩放/滚动。
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleWheel = (event: WheelEvent) => {
      if (!current) return
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2
        zoomAt(zoomRef.current * factor, event.clientX, event.clientY)
        return
      }
      const nav = wheelNavRef.current
      if (nav.count <= 1) return
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1
      wheelAccumRef.current += event.deltaY * scale
      if (Math.abs(wheelAccumRef.current) >= 60) {
        const direction = wheelAccumRef.current > 0 ? 1 : -1
        wheelAccumRef.current = 0
        nav.step(direction)
      }
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [current])

  const wantsPan = (event: ReactPointerEvent<HTMLCanvasElement>) =>
    tool === 'pan' || spaceHeld || event.button === 1 || event.altKey

  const onStagePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const viewport = viewportRef.current

    if (wantsPan(event) && viewport) {
      event.preventDefault()
      dragRef.current = {
        mode: 'pan',
        anchorX: event.clientX,
        anchorY: event.clientY,
        start: { x: 0, y: 0, width: 0, height: 0 },
        startScrollLeft: viewport.scrollLeft,
        startScrollTop: viewport.scrollTop,
      }
      return
    }

    const point = pointerToImage(event)
    if (!point) return

    const insideRoi = roi
      && point.x >= roi.x && point.x < roi.x + roi.width
      && point.y >= roi.y && point.y < roi.y + roi.height

    dragRef.current = insideRoi && roi
      ? { mode: 'move', anchorX: point.x - roi.x, anchorY: point.y - roi.y, start: roi, startScrollLeft: 0, startScrollTop: 0 }
      : { mode: 'draw', anchorX: point.x, anchorY: point.y, start: { x: point.x, y: point.y, width: 1, height: 1 }, startScrollLeft: 0, startScrollTop: 0 }
    setRoi(dragRef.current.start)
  }

  const onStagePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!current) return
    const drag = dragRef.current

    if (drag?.mode === 'pan') {
      const viewport = viewportRef.current
      if (viewport) {
        viewport.scrollLeft = drag.startScrollLeft - (event.clientX - drag.anchorX)
        viewport.scrollTop = drag.startScrollTop - (event.clientY - drag.anchorY)
      }
      return
    }

    const point = pointerToImage(event)
    if (!point) return
    setProbe((previous) => previous?.x === point.x && previous?.y === point.y
      ? previous
      : { ...point, value: current.data[point.y * current.width + point.x] })
    if (!drag) return

    if (drag.mode === 'draw') {
      setRoi(normalizeRect(drag.anchorX, drag.anchorY, point.x, point.y))
      return
    }

    const offsetX = point.x - drag.anchorX
    const offsetY = point.y - drag.anchorY
    const moved = clampRect(
      { x: drag.start.x + offsetX, y: drag.start.y + offsetY, width: drag.start.width, height: drag.start.height },
      current,
    )
    if (moved) setRoi(moved)
  }

  const onStagePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    // 单击（没有拖出 ≥2×2 的矩形）时不保留 1×1 的伪 ROI。
    if (drag?.mode === 'draw') {
      setRoi((currentRoi) => (currentRoi && currentRoi.width >= 2 && currentRoi.height >= 2 ? currentRoi : null))
    }
  }

  const fitToWindow = () => {
    const viewport = viewportRef.current
    if (!current || !viewport) return
    const availableWidth = viewport.clientWidth - 24
    const availableHeight = viewport.clientHeight - 24
    if (availableWidth <= 0 || availableHeight <= 0) return
    const fitted = clampZoom(Math.min(availableWidth / current.width, availableHeight / current.height))
    pendingAnchorRef.current = {
      imageX: current.width / 2,
      imageY: current.height / 2,
      offsetX: viewport.clientWidth / 2,
      offsetY: viewport.clientHeight / 2,
    }
    zoomRef.current = fitted
    setZoom(fitted)
  }

  const showActualSize = () => {
    const viewport = viewportRef.current
    if (!viewport) {
      zoomRef.current = 1
      setZoom(1)
      return
    }
    const bounds = viewport.getBoundingClientRect()
    zoomAt(1, bounds.left + viewport.clientWidth / 2, bounds.top + viewport.clientHeight / 2)
  }

  const hasImage = Boolean(current)
  const roiLabel = roi ? `${roi.width}×${roi.height} @ (${roi.x}, ${roi.y})` : '—'

  /* ---------------- 右栏：卡片式视图（一个卡片 = 一个可视化） ---------------- */

  const viewCards = views.length ? (
    <div className="grid gap-4">
      {views.map((card) => (
        <section key={card.id} className="grid gap-2 rounded-[calc(var(--radius-box)+0.25rem)] bg-muted/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-base-content/55">{viewTitle(card.type)}</h3>
            <Button variant="ghost"
              type="button"
              aria-label={copy.close}
              onClick={() => removeView(card.id)}
              className="rounded-[var(--radius-field)] p-1 text-base-content/50 transition hover:bg-base-200 hover:text-base-content"
            >
              <X size={14} />
            </Button>
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
                    <dt className="text-xs text-base-content/55">{label}</dt>
                    <dd className="font-mono text-sm font-semibold tabular-nums text-base-content">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-base-content/55">{copy.roi.needRoi}</p>
            )
          ) : null}

          {card.type === 'histogram' ? (
            <div className="grid gap-1">
              <div className="flex justify-end text-xs text-base-content/55">
                <span>{copy.stats.thresholdMark}: {thresholdLevel}</span>
              </div>
              <canvas ref={histogramCanvasRef} className="block w-full rounded-[var(--radius-field)] bg-base-100" style={{ height: 112 }} />
            </div>
          ) : null}

          {card.type === 'profile' ? (
            <div className="grid gap-1">
              <canvas ref={profileCanvasRef} className="block w-full rounded-[var(--radius-field)] bg-base-100" style={{ height: 112 }} />
              <p className="text-xs text-base-content/55">{copy.views.profileNote}</p>
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
                      max={4_000_000}
                      step={1}
                      value={minParticleArea}
                      onChange={(event) => setMinParticleArea(Math.max(1, Math.min(4_000_000, Math.round(Number(event.target.value) || 1))))}
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
              <Button type="button" variant="secondary" size="sm" className="h-8 w-full" disabled={!hasImage} onClick={analyzeCurrentParticles}>
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
              accept="image/*"
              className="hidden"
              onChange={onFileInput}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 rounded-[var(--radius-box)] font-semibold"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon size={15} strokeWidth={2.2} />
              {copy.openImage}
            </Button>
            {sourceName ? (
              <span className="hidden max-w-48 shrink-0 truncate rounded-[var(--radius-field)] bg-muted px-2 py-1 text-xs text-base-content/70 sm:inline">
                {sourceName}
              </span>
            ) : null}

            <div role="group" aria-label={copy.viewer.tool} className="inline-flex shrink-0 rounded-[var(--radius-field)] bg-muted p-0.5">
              {(['pan', 'roi'] as const).map((value) => (
                <Button variant="ghost"
                  key={value}
                  type="button"
                  aria-pressed={tool === value}
                  className={`h-7 rounded-[calc(var(--radius-field)-2px)] px-2.5 text-xs font-medium transition ${
                    tool === value ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/55 hover:text-base-content'
                  }`}
                  onClick={() => setTool(value)}
                >
                  {value === 'pan' ? copy.viewer.pan : copy.viewer.roiSelect}
                </Button>
              ))}
            </div>

            {original ? (
              <div role="group" aria-label={copy.viewer.display} className="inline-flex shrink-0 rounded-[var(--radius-field)] bg-muted p-0.5">
                {(['color', 'gray'] as const).map((value) => {
                  const active = value === 'color' ? showColor : !showColor
                  return (
                    <Button variant="ghost"
                      key={value}
                      type="button"
                      aria-pressed={active}
                      className={`h-7 rounded-[calc(var(--radius-field)-2px)] px-2.5 text-xs font-medium transition ${
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

            <Button type="button" variant="outline" size="icon-sm" aria-label={copy.zoomOut} disabled={!hasImage} onClick={() => zoomByStep(-1)}>
              <ZoomOut size={15} />
            </Button>
            <span className="min-w-12 shrink-0 text-center text-xs tabular-nums text-base-content/70">
              {Math.round(zoom * 100)}%
            </span>
            <Button type="button" variant="outline" size="icon-sm" aria-label={copy.zoomIn} disabled={!hasImage} onClick={() => zoomByStep(1)}>
              <ZoomIn size={15} />
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" disabled={!hasImage} onClick={showActualSize}>
              {copy.viewer.actualSize}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" disabled={!hasImage} onClick={fitToWindow}>
              {copy.fit}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0" disabled={!roi} onClick={() => setRoi(null)}>
              {copy.roi.clear}
            </Button>

            {stack && stack.length > 1 ? (
              <span className="inline-flex shrink-0 items-center gap-1">
                <Button type="button" variant="outline" size="sm" className="h-8" disabled={pageIndex === 0} onClick={() => selectPage(pageIndex - 1)}>←</Button>
                <span className="text-xs tabular-nums text-base-content/70">{pageIndex + 1} / {stack.length}</span>
                <Button type="button" variant="outline" size="sm" className="h-8" disabled={pageIndex + 1 >= stack.length} onClick={() => selectPage(pageIndex + 1)}>→</Button>
                <Slider min={0} max={stack.length - 1} step={1} value={[pageIndex]} onValueChange={(next) => selectPage(next[0] ?? pageIndex)} aria-label={copy.stack.page} className="w-28" />
              </span>
            ) : null}

            <span className="ml-auto hidden shrink-0 truncate pl-2 font-mono text-xs text-base-content/55 md:inline">
              {probe ? `(${probe.x}, ${probe.y}) = ${probe.value} · ` : ''}{roiLabel}
            </span>
          </>
        }
      />

      <div className="grid min-h-0 min-w-0 grid-cols-1 overflow-y-auto lg:grid-cols-[300px_minmax(0,1fr)_340px] lg:overflow-hidden">
        {/* 左栏「处理」：参数面板（内联展开）+ 命令目录 + 撤销 / 状态 */}
        <aside className="order-2 flex min-h-0 flex-col border-b border-base-300 bg-base-100 lg:order-none lg:h-full lg:border-b-0 lg:border-r">
          {paramPanel === 'levels' ? (
            <section className="shrink-0 border-b border-base-300 px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">{copy.adjust.brightness} / {copy.adjust.contrast}</h3>
                <Button variant="ghost" type="button" aria-label={copy.close} onClick={closeParamPanel} className="rounded-[var(--radius-field)] p-1 text-base-content/50 hover:bg-muted hover:text-base-content">
                  <X size={14} />
                </Button>
              </div>
              <div className="grid gap-2.5">
                <div className="grid gap-1">
                  <Label htmlFor="imagej-brightness" className="justify-between text-xs">
                    <span>{copy.adjust.brightness}</span>
                    <span className="font-mono tabular-nums text-base-content/60">{brightness}</span>
                  </Label>
                  <Slider id="imagej-brightness" min={-127} max={127} step={1} value={[brightness]} disabled={!hasImage} onValueChange={(next) => setBrightness(next[0] ?? brightness)} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="imagej-contrast" className="justify-between text-xs">
                    <span>{copy.adjust.contrast}</span>
                    <span className="font-mono tabular-nums text-base-content/60">{contrast}</span>
                  </Label>
                  <Slider id="imagej-contrast" min={1} max={100} step={1} value={[contrast]} disabled={!hasImage} onValueChange={(next) => setContrast(next[0] ?? contrast)} />
                </div>
                <Button type="button" size="sm" className="h-8" disabled={!hasImage || !levelsActive} onClick={applyCurrentLevels}>
                  {copy.adjust.applyLevels}
                </Button>
              </div>
            </section>
          ) : null}

          {paramPanel === 'threshold' ? (
            <section className="shrink-0 border-b border-base-300 px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">{copy.adjust.threshold}</h3>
                <Button variant="ghost" type="button" aria-label={copy.close} onClick={closeParamPanel} className="rounded-[var(--radius-field)] p-1 text-base-content/50 hover:bg-muted hover:text-base-content">
                  <X size={14} />
                </Button>
              </div>
              <div className="grid gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="imagej-threshold-level" className="text-xs">{copy.adjust.threshold}</Label>
                  <span className="font-mono text-xs tabular-nums text-base-content/70">{thresholdLevel}</span>
                </div>
                <Slider id="imagej-threshold-level" min={0} max={255} step={1} value={[thresholdLevel]} disabled={!hasImage} aria-label={copy.adjust.threshold} onValueChange={(next) => setThresholdLevel(next[0] ?? thresholdLevel)} />
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" size="sm" className="h-8" disabled={!hasImage} onClick={applyCurrentThreshold}>
                    {copy.adjust.thresholdApply}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" className="h-8" disabled={!hasImage} onClick={applyOtsu}>
                    <Sparkles size={14} />
                    {copy.adjust.otsu}
                  </Button>
                </div>
              </div>
            </section>
          ) : null}

          {paramPanel === 'gaussian' ? (
            <section className="shrink-0 border-b border-base-300 px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">{copy.filters.gaussian}</h3>
                <Button variant="ghost" type="button" aria-label={copy.close} onClick={closeParamPanel} className="rounded-[var(--radius-field)] p-1 text-base-content/50 hover:bg-muted hover:text-base-content">
                  <X size={14} />
                </Button>
              </div>
              <div className="grid gap-2.5">
                <div className="grid gap-1">
                  <Label htmlFor="imagej-gaussian-sigma" className="justify-between text-xs">
                    <span>{copy.filters.sigma}</span>
                    <span className="font-mono tabular-nums text-base-content/60">{gaussianSigma.toFixed(1)}</span>
                  </Label>
                  <Slider id="imagej-gaussian-sigma" min={0.5} max={5} step={0.1} value={[gaussianSigma]} disabled={!hasImage} onValueChange={(next) => setGaussianSigma(next[0] ?? gaussianSigma)} />
                </div>
                <Button type="button" size="sm" className="h-8" disabled={!hasImage} onClick={() => runAdvanced((image) => gaussianBlur(image, gaussianSigma))}>
                  {copy.filters.gaussian}
                </Button>
              </div>
            </section>
          ) : null}

          <div className="min-h-0 flex-1">
            <ImageJSidebar language={language} registry={MOCK_REGISTRY} onRun={runCommand} />
          </div>

          <footer className="shrink-0 border-t border-base-300 px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.history.undo} disabled={!historyFlags.canUndo} onClick={undo}>
                <Undo2 size={15} />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.history.redo} disabled={!historyFlags.canRedo} onClick={redo}>
                <Redo2 size={15} />
              </Button>
            </div>
            <div role="status" aria-live="polite" className="mt-1.5 min-h-4 text-xs text-base-content/60">
              {status}
            </div>
          </footer>
        </aside>

        <main className="order-1 relative min-h-[60vh] min-w-0 bg-base-100 lg:order-none lg:min-h-0">
          {error ? (
            <p role="alert" className="absolute left-3 right-3 top-3 z-10 rounded-[var(--radius-box)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {!hasImage ? (
            <div
              className="grid h-full place-items-center p-8 text-center"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const file = event.dataTransfer.files?.[0]
                if (file) void loadFile(file)
              }}
            >
              <div className="grid gap-2 justify-items-center">
                <ImageIcon size={34} className="text-base-content/35" aria-hidden="true" />
                <strong className="text-base-content">{copy.emptyTitle}</strong>
                <p className="max-w-md text-sm text-base-content/60">{copy.emptyDescription}</p>
                <p className="text-xs text-base-content/45">{copy.localNote}</p>
              </div>
            </div>
          ) : current ? (
            <div
              ref={viewportRef}
              className="absolute inset-0 overflow-scroll bg-base-100"
              style={{ scrollbarGutter: 'stable' }}
            >
              <div
                className="relative inline-block"
                style={{ width: current.width * zoom, height: current.height * zoom, margin: 8 }}
              >
                <canvas
                  ref={resultCanvasRef}
                  className="block touch-none"
                  style={{
                    width: current.width * zoom,
                    height: current.height * zoom,
                    imageRendering: 'pixelated',
                    cursor: tool === 'pan' || spaceHeld ? 'grab' : 'crosshair',
                  }}
                  onPointerDown={onStagePointerDown}
                  onPointerMove={onStagePointerMove}
                  onPointerLeave={() => setProbe(null)}
                  onPointerUp={onStagePointerUp}
                  onPointerCancel={onStagePointerUp}
                />
                {roi ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute border-2 border-primary bg-primary/10"
                    style={{
                      left: roi.x * zoom,
                      top: roi.y * zoom,
                      width: roi.width * zoom,
                      height: roi.height * zoom,
                    }}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </main>

        {/* 右栏「分析」：卡片式视图（一个卡片一个可视化）+ 导出 */}
        <aside className="order-3 flex min-h-0 flex-col border-t border-base-300 bg-base-100 lg:order-none lg:h-full lg:border-t-0 lg:border-l">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-base-300 px-3 py-2">
            {hasImage ? (
              <span className="inline-flex rounded-[var(--radius-field)] bg-base-200 p-0.5">
                {(['image', 'roi'] as const).map((value) => (
                  <Button variant="ghost"
                    key={value}
                    type="button"
                    aria-pressed={scope === value}
                    disabled={value === 'roi' && !roi}
                    className={`h-6 rounded-[calc(var(--radius-field)-2px)] px-2 text-xs font-medium transition disabled:opacity-40 ${
                      scope === value ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/55 hover:text-base-content'
                    }`}
                    onClick={() => setScope(value)}
                  >
                    {value === 'image' ? copy.roi.scopeImage : copy.roi.scopeRoi}
                  </Button>
                ))}
              </span>
            ) : <span />}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-7" disabled={!hasImage}>
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

          <footer className="shrink-0 border-t border-base-300 px-3 py-2.5">
            <div className="grid gap-1.5">
              <Button type="button" variant="outline" size="sm" className="h-8" disabled={!hasImage} onClick={exportPng}>
                <Download size={14} />
                {copy.exportPng}
              </Button>
              <div className="grid grid-cols-2 gap-1.5">
                <Button type="button" variant="outline" size="sm" className="h-8" disabled={!hasImage} onClick={() => downloadTiff(false)}>{copy.stack.exportCurrent}</Button>
                <Button type="button" variant="outline" size="sm" className="h-8" disabled={!stack || stack.length < 2} onClick={() => downloadTiff(true)}>{copy.stack.exportAll}</Button>
              </div>
            </div>
          </footer>
        </aside>
      </div>
    </div>
  )
}



