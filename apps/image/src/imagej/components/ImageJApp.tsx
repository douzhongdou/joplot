'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Download,
  Image as ImageIcon,
  Redo2,
  Sparkles,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { AppNavbar } from '../../components/AppNavbar'
import { useI18n } from '../../i18n'
import { Button } from '@joplot/ui/button'
import { Label } from '@joplot/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@joplot/ui/dialog'
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
 * 图像工作台：菜单式侧栏 + 点命令直接执行（无步骤排队）。
 *
 * - 右侧 ImageJSidebar 按 ImageJ 菜单（Image / Process / Analyze）列出命令，
 *   点击即调用 processor 立即执行并进撤销历史。
 * - 带参数的命令（亮度对比度 / 阈值 / 高斯）弹参数对话框，实时预览后应用。
 * - 测量、直方图、粒子结果渲染在「分析」页顶部的结果区。
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

/** 带参数的命令，以对话框收集参数。 */
type ParamDialog = 'levels' | 'threshold' | 'gaussian'

interface DragState {
  mode: 'draw' | 'move' | 'pan'
  anchorX: number
  anchorY: number
  start: Rect
  startScrollLeft: number
  startScrollTop: number
}

export function ImageJApp() {
  const { language } = useI18n()
  const copy = useMemo(() => createImagejCopy(language), [language])

  const historyRef = useRef(new ImageHistory())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resultCanvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const histogramCanvasRef = useRef<HTMLCanvasElement>(null)
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
  /** 「分析」页结果区是否展开（执行测量 / 粒子后打开）。 */
  const [showResults, setShowResults] = useState(false)
  const [paramDialog, setParamDialog] = useState<ParamDialog | null>(null)

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

  /* ---------------- 文件导入 ---------------- */

  const loadFile = useCallback(async (file: File) => {
    const token = ++importTokenRef.current
    setError('')
    setStatus(copy.status.loading)
    setParamDialog(null)
    setShowResults(false)

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
    if (current && !roi && current.data.length > 4_000_000) {
      setError(copy.errors.filterTooLarge)
      return
    }
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

  const analyzeCurrentParticles = () => {
    const image = guardImage()
    if (!image) return
    if (image.data.length > 4_000_000) {
      setError(copy.errors.analysisTooLarge)
      return
    }
    try {
      setParticles(analyzeParticles(image, minParticleArea))
      setShowResults(true)
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
        return setParamDialog('levels')
      case 'threshold':
        return setParamDialog('threshold')
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
        return setParamDialog('gaussian')
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
      case 'measure':
        return setShowResults(true)
      case 'particles':
        return analyzeCurrentParticles()
      default:
        return
    }
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

  useEffect(() => {
    const canvas = histogramCanvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const width = 640
    const height = 160
    canvas.width = width
    canvas.height = height
    context.clearRect(0, 0, width, height)
    context.fillStyle = 'rgba(0,0,0,0.04)'
    context.fillRect(0, 0, width, height)

    if (!stats) {
      return
    }

    const bins = stats.histogram
    let maxCount = 0
    for (let i = 0; i < bins.length; i += 1) {
      if (bins[i] > maxCount) maxCount = bins[i]
    }
    if (maxCount === 0) return

    const barWidth = width / bins.length
    context.fillStyle = 'rgba(59, 130, 246, 0.75)'
    for (let i = 0; i < bins.length; i += 1) {
      const barHeight = (bins[i] / maxCount) * (height - 8)
      if (barHeight <= 0) continue
      context.fillRect(i * barWidth, height - barHeight, Math.max(1, barWidth - 0.4), barHeight)
    }

    const markerX = (thresholdLevel / 255) * width
    context.fillStyle = 'rgba(239, 68, 68, 0.9)'
    context.fillRect(markerX, 0, 2, height)
    // showResults 参与依赖：结果区是后挂载的，画布出现时要补画一次。
  }, [stats, thresholdLevel, showResults])

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

  // 滚轮缩放；非 passive 监听才能 preventDefault 掉浏览器自身滚动。
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleWheel = (event: WheelEvent) => {
      if (!current) return
      event.preventDefault()
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2
      zoomAt(zoomRef.current * factor, event.clientX, event.clientY)
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

  /* ---------------- 「分析」页结果区 ---------------- */

  const resultsPanel = showResults && hasImage ? (
    <div className="grid gap-4 rounded-[calc(var(--radius-box)+0.25rem)] bg-muted/50 p-4">
      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-base-content/55">{copy.stats.heading}</h3>
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
        </div>

        {stats ? (
          <>
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
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-base-content/55">
                <span>{copy.stats.histogram}</span>
                <span>{copy.stats.thresholdMark}: {thresholdLevel}</span>
              </div>
              <canvas ref={histogramCanvasRef} className="block h-28 w-full rounded-[var(--radius-field)] bg-base-100" />
            </div>
          </>
        ) : (
          <p className="text-sm text-base-content/55">
            {scope === 'roi' && hasImage ? copy.roi.needRoi : copy.emptyDescription}
          </p>
        )}
      </section>

      {particles ? (
        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-base-content/55">{copy.binary.particles}: {particles.length}</h3>
            <Button type="button" variant="outline" size="sm" onClick={exportParticlesCsv}>{copy.binary.exportCsv}</Button>
          </div>
          <div className="flex items-end gap-2">
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
                className="h-8 w-28 rounded-md border border-base-300 bg-base-100 px-2 text-sm"
              />
            </div>
            <Button type="button" variant="secondary" size="sm" className="h-8" onClick={analyzeCurrentParticles}>
              {copy.binary.analyze}
            </Button>
          </div>
          <div className="max-h-56 overflow-auto rounded-[var(--radius-field)] bg-base-100">
            <table className="w-full min-w-[280px] text-left text-xs tabular-nums">
              <thead><tr className="border-b border-base-300"><th className="p-1.5">#</th><th className="p-1.5">{copy.stats.area}</th><th className="p-1.5">{copy.binary.perimeter}</th><th className="p-1.5">{copy.binary.circularity}</th><th className="p-1.5">{copy.binary.centroid}</th></tr></thead>
              <tbody>{particles.map((particle) => (
                <tr key={particle.id} className="border-b border-base-200">
                  <td className="p-1.5">{particle.id}</td><td className="p-1.5">{particle.area}</td>
                  <td className="p-1.5">{particle.perimeter}</td><td className="p-1.5">{particle.circularity.toFixed(3)}</td>
                  <td className="p-1.5">({particle.centroidX.toFixed(1)}, {particle.centroidY.toFixed(1)})</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  ) : null

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
                <button
                  key={value}
                  type="button"
                  aria-pressed={tool === value}
                  className={`h-7 rounded-[calc(var(--radius-field)-2px)] px-2.5 text-xs font-medium transition ${
                    tool === value ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/55 hover:text-base-content'
                  }`}
                  onClick={() => setTool(value)}
                >
                  {value === 'pan' ? copy.viewer.pan : copy.viewer.roiSelect}
                </button>
              ))}
            </div>

            {original ? (
              <div role="group" aria-label={copy.viewer.display} className="inline-flex shrink-0 rounded-[var(--radius-field)] bg-muted p-0.5">
                {(['color', 'gray'] as const).map((value) => {
                  const active = value === 'color' ? showColor : !showColor
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      className={`h-7 rounded-[calc(var(--radius-field)-2px)] px-2.5 text-xs font-medium transition ${
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
                <input type="range" min={0} max={stack.length - 1} value={pageIndex} onChange={(event) => selectPage(Number(event.target.value))} aria-label={copy.stack.page} className="w-28 accent-primary" />
              </span>
            ) : null}

            <span className="ml-auto hidden shrink-0 truncate pl-2 font-mono text-[11px] text-base-content/55 md:inline">
              {probe ? `(${probe.x}, ${probe.y}) = ${probe.value} · ` : ''}{roiLabel}
            </span>
          </>
        }
      />

      <div className="grid min-h-0 min-w-0 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
        <main className="relative min-h-[60vh] min-w-0 bg-base-100 lg:min-h-0">
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

        <aside className="flex min-h-0 flex-col border-t border-base-300 bg-base-100 lg:h-full lg:border-l lg:border-t-0">
          <div className="min-h-0 flex-1">
            <ImageJSidebar
              language={language}
              copy={copy}
              registry={MOCK_REGISTRY}
              onRun={runCommand}
              resultsPanel={resultsPanel}
            />
          </div>

          <footer className="shrink-0 border-t border-base-300 px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.history.undo} disabled={!historyFlags.canUndo} onClick={undo}>
                <Undo2 size={15} />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.history.redo} disabled={!historyFlags.canRedo} onClick={redo}>
                <Redo2 size={15} />
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 flex-1" disabled={!hasImage} onClick={exportPng}>
                <Download size={14} />
                {copy.exportPng}
              </Button>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <Button type="button" variant="outline" size="sm" className="h-8" disabled={!hasImage} onClick={() => downloadTiff(false)}>{copy.stack.exportCurrent}</Button>
              <Button type="button" variant="outline" size="sm" className="h-8" disabled={!stack || stack.length < 2} onClick={() => downloadTiff(true)}>{copy.stack.exportAll}</Button>
            </div>
            <div role="status" aria-live="polite" className="mt-1.5 min-h-4 text-xs text-base-content/60">
              {status}
            </div>
          </footer>
        </aside>
      </div>

      {/* 亮度 / 对比度：滑杆实时预览（display 计算），应用后写入历史并复位。 */}
      <Dialog
        open={paramDialog === 'levels'}
        onOpenChange={(open) => {
          if (!open) {
            setBrightness(0)
            setContrast(50)
            setParamDialog(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{copy.adjust.brightness} / {copy.adjust.contrast}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label htmlFor="imagej-brightness" className="justify-between text-xs">
                <span>{copy.adjust.brightness}</span>
                <span className="font-mono tabular-nums text-base-content/60">{brightness}</span>
              </Label>
              <input
                id="imagej-brightness"
                type="range"
                min={-127}
                max={127}
                step={1}
                value={brightness}
                disabled={!hasImage}
                onChange={(event) => setBrightness(Number(event.target.value))}
                className="w-full accent-primary"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="imagej-contrast" className="justify-between text-xs">
                <span>{copy.adjust.contrast}</span>
                <span className="font-mono tabular-nums text-base-content/60">{contrast}</span>
              </Label>
              <input
                id="imagej-contrast"
                type="range"
                min={1}
                max={100}
                step={1}
                value={contrast}
                disabled={!hasImage}
                onChange={(event) => setContrast(Number(event.target.value))}
                className="w-full accent-primary"
              />
            </div>
            <Button type="button" size="sm" className="h-8" disabled={!hasImage || !levelsActive} onClick={applyCurrentLevels}>
              {copy.adjust.applyLevels}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 阈值：应用写入二值图；自动阈值走 Otsu。 */}
      <Dialog open={paramDialog === 'threshold'} onOpenChange={(open) => { if (!open) setParamDialog(null) }}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{copy.adjust.threshold}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="imagej-threshold-level" className="text-xs">{copy.adjust.threshold}</Label>
              <span className="font-mono text-xs tabular-nums text-base-content/70">{thresholdLevel}</span>
            </div>
            <input
              id="imagej-threshold-level"
              type="range"
              min={0}
              max={255}
              step={1}
              value={thresholdLevel}
              disabled={!hasImage}
              aria-label={copy.adjust.threshold}
              onChange={(event) => setThresholdLevel(Number(event.target.value))}
              className="w-full accent-primary"
            />
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
        </DialogContent>
      </Dialog>

      {/* 高斯模糊：sigma 实时可调，应用写入历史。 */}
      <Dialog open={paramDialog === 'gaussian'} onOpenChange={(open) => { if (!open) setParamDialog(null) }}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{copy.filters.gaussian}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label htmlFor="imagej-gaussian-sigma" className="justify-between text-xs">
                <span>{copy.filters.sigma}</span>
                <span className="font-mono tabular-nums text-base-content/60">{gaussianSigma.toFixed(1)}</span>
              </Label>
              <input
                id="imagej-gaussian-sigma"
                type="range"
                min={0.5}
                max={5}
                step={0.1}
                value={gaussianSigma}
                disabled={!hasImage}
                onChange={(event) => setGaussianSigma(Number(event.target.value))}
                className="w-full accent-primary"
              />
            </div>
            <Button type="button" size="sm" className="h-8" disabled={!hasImage} onClick={() => runAdvanced((image) => gaussianBlur(image, gaussianSigma))}>
              {copy.filters.gaussian}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
