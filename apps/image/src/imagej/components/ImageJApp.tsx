'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Contrast,
  Crop,
  Download,
  FlipHorizontal,
  FlipVertical,
  Image as ImageIcon,
  Redo2,
  RotateCcw,
  RotateCw,
  Sparkles,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { AppNavbar } from '../../components/AppNavbar'
import { useI18n } from '../../i18n'
import { Button } from '@joplot/ui/button'
import { Label } from '@joplot/ui/label'
import { createImagejCopy, type ImagejCopy } from '../lib/i18n'
import { analyzeParticles, closeBinary, dilate, erode, fillHoles, openBinary, type Particle } from '../lib/binary'
import { decodeTiff, encodeTiff } from '../lib/tiff'
import { gaussianBlur, maximum3x3, minimum3x3 } from '../lib/filters'
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

/** 浏览器 Canvas 支持的最大边长，超过则拒绝导入，避免解码时崩溃。 */
const MAX_CANVAS_SIDE = 16_384

const ZOOM_STEPS = [0.125, 0.25, 0.5, 1, 2, 4, 8] as const

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

interface DragState {
  mode: 'draw' | 'move'
  anchorX: number
  anchorY: number
  start: Rect
}

export function ImageJApp() {
  const { language } = useI18n()
  const copy = useMemo(() => createImagejCopy(language), [language])

  const historyRef = useRef(new ImageHistory())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const originalCanvasRef = useRef<HTMLCanvasElement>(null)
  const resultCanvasRef = useRef<HTMLCanvasElement>(null)
  const histogramCanvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const importTokenRef = useRef(0)

  const [original, setOriginal] = useState<OriginalImage | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [current, setCurrent] = useState<GrayImage | null>(null)
  const [roi, setRoi] = useState<Rect | null>(null)
  const [zoom, setZoom] = useState(1)
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

    if (/\.tiff?$/i.test(file.name) || file.type === 'image/tiff') {
      try {
        const pages = decodeTiff(await file.arrayBuffer())
        if (token !== importTokenRef.current) return
        setOriginal(null)
        setStack(pages)
        setPageIndex(0)
        setCurrent(pages[0])
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

  /* ---------------- 画布绘制 ---------------- */

  useEffect(() => {
    paintRgba(originalCanvasRef.current, original)
  }, [original])

  useEffect(() => {
    paintGray(resultCanvasRef.current, display)
  }, [display])

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
  }, [stats, thresholdLevel])

  /* ---------------- ROI 交互 ---------------- */

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

  const onStagePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!current) return
    const point = pointerToImage(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)

    const insideRoi = roi
      && point.x >= roi.x && point.x < roi.x + roi.width
      && point.y >= roi.y && point.y < roi.y + roi.height

    dragRef.current = insideRoi && roi
      ? { mode: 'move', anchorX: point.x - roi.x, anchorY: point.y - roi.y, start: roi }
      : { mode: 'draw', anchorX: point.x, anchorY: point.y, start: { x: point.x, y: point.y, width: 1, height: 1 } }
    setRoi(dragRef.current.start)
  }

  const onStagePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!current) return
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
    const container = stageRef.current
    if (!current || !container) return
    const available = container.clientWidth - 16
    if (available <= 0) return
    setZoom(Math.max(0.05, Math.min(4, available / current.width)))
  }

  const hasImage = Boolean(current)
  const roiLabel = roi ? `${roi.width}×${roi.height} @ (${roi.x}, ${roi.y})` : '—'

  /* ---------------- 渲染 ---------------- */

  return (
    <div className="grid h-full grid-rows-[var(--navbar-height)_minmax(0,1fr)] bg-base-200">
      <AppNavbar section="imagej" />

      <div className="grid min-h-0 min-w-0 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
        <main className="flex min-w-0 flex-col gap-4 bg-base-100 p-4 lg:h-full lg:overflow-y-auto">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onFileInput}
              />
              <Button
                type="button"
                className="h-9 rounded-[var(--radius-box)] font-semibold"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImageIcon size={16} strokeWidth={2.2} />
                {copy.openImage}
              </Button>
              <span className="hidden text-xs text-base-content/55 sm:inline">{copy.dropHint}</span>
              {sourceName ? (
                <span className="max-w-56 truncate rounded-[var(--radius-field)] bg-muted px-2 py-1 text-xs text-base-content/70">
                  {sourceName}
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="icon-sm" aria-label={copy.zoomOut} disabled={!hasImage} onClick={() => setZoom((value) => nextZoom(value, -1))}>
                <ZoomOut size={15} />
              </Button>
              <span className="min-w-14 text-center text-xs tabular-nums text-base-content/70">
                {Math.round(zoom * 100)}%
              </span>
              <Button type="button" variant="outline" size="icon-sm" aria-label={copy.zoomIn} disabled={!hasImage} onClick={() => setZoom((value) => nextZoom(value, 1))}>
                <ZoomIn size={15} />
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8" disabled={!hasImage} onClick={fitToWindow}>
                {copy.fit}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-8" disabled={!roi} onClick={() => setRoi(null)}>
                {copy.roi.clear}
              </Button>
            </div>
          </div>

          {stack && stack.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Button type="button" variant="outline" size="sm" disabled={pageIndex === 0} onClick={() => selectPage(pageIndex - 1)}>←</Button>
              <span>{copy.stack.page} {pageIndex + 1} / {stack.length}</span>
              <Button type="button" variant="outline" size="sm" disabled={pageIndex + 1 >= stack.length} onClick={() => selectPage(pageIndex + 1)}>→</Button>
              <input type="range" min={0} max={stack.length - 1} value={pageIndex} onChange={(event) => selectPage(Number(event.target.value))} aria-label={copy.stack.page} className="max-w-48 accent-primary" />
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-[var(--radius-box)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {!hasImage ? (
            <div
              className="grid min-h-72 place-items-center rounded-[calc(var(--radius-box)+0.25rem)] border border-dashed border-base-300 bg-muted/40 p-8 text-center"
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
          ) : (
            <div className={`grid gap-4 ${original ? 'md:grid-cols-2' : ''}`}>
              {original ? <section className="flex min-w-0 flex-col gap-2">
                <h2 className="text-sm font-semibold text-base-content">{copy.original}</h2>
                <div className="grid place-items-center overflow-auto rounded-[var(--radius-box)] border border-base-300 bg-muted/40 p-2">
                  <canvas
                    ref={originalCanvasRef}
                    className="block max-w-none bg-base-100 shadow-sm"
                    style={{
                      width: original ? original.width * zoom : undefined,
                      height: original ? original.height * zoom : undefined,
                      imageRendering: zoom >= 1 ? 'pixelated' : 'auto',
                    }}
                  />
                </div>
              </section> : null}

              <section className="flex min-w-0 flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-base-content">{copy.result}</h2>
                  <span className="truncate font-mono text-[11px] text-base-content/55">{probe ? `${copy.stats.pixel} (${probe.x}, ${probe.y}) = ${probe.value} · ` : ''}{roiLabel}</span>
                </div>
                <div
                  ref={stageRef}
                  className="grid place-items-center overflow-auto rounded-[var(--radius-box)] border border-base-300 bg-muted/40 p-2"
                >
                  <div className="relative inline-block max-w-full">
                    <canvas
                      ref={resultCanvasRef}
                      className="block max-w-none cursor-crosshair touch-none bg-base-100 shadow-sm"
                      style={{
                        width: current ? current.width * zoom : undefined,
                        height: current ? current.height * zoom : undefined,
                        imageRendering: zoom >= 1 ? 'pixelated' : 'auto',
                      }}
                      onPointerDown={onStagePointerDown}
                      onPointerMove={onStagePointerMove}
                      onPointerLeave={() => setProbe(null)}
                      onPointerUp={onStagePointerUp}
                      onPointerCancel={onStagePointerUp}
                    />
                    {roi && current ? (
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
                <p className="text-[11px] text-base-content/50">{copy.roi.hint}</p>
              </section>
            </div>
          )}

          <section className="grid gap-3 rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-base-content">{copy.stats.heading}</h2>
              <span className="inline-flex rounded-[var(--radius-field)] bg-muted p-0.5">
                {(['image', 'roi'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={scope === value}
                    disabled={value === 'roi' && !roi}
                    className={`h-7 rounded-[calc(var(--radius-field)-2px)] px-3 text-xs font-medium transition disabled:opacity-40 ${
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
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    [copy.stats.pixels, stats.count.toLocaleString()],
                    [copy.stats.area, stats.area.toLocaleString()],
                    [copy.stats.mean, stats.mean.toFixed(2)],
                    [copy.stats.min, String(stats.min)],
                    [copy.stats.max, String(stats.max)],
                    [copy.stats.stdDev, stats.stdDev.toFixed(2)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-[var(--radius-field)] bg-muted px-3 py-2">
                      <dt className="text-[11px] text-base-content/55">{label}</dt>
                      <dd className="font-mono text-sm font-semibold tabular-nums text-base-content">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px] text-base-content/55">
                    <span>{copy.stats.histogram}</span>
                    <span>
                      {copy.stats.thresholdMark}: {thresholdLevel}
                    </span>
                  </div>
                  <canvas ref={histogramCanvasRef} className="block h-32 w-full rounded-[var(--radius-field)] bg-muted" />
                </div>
              </>
            ) : (
              <p className="text-sm text-base-content/55">
                {scope === 'roi' && hasImage ? copy.roi.needRoi : copy.emptyDescription}
              </p>
            )}
          </section>
          {particles ? (
            <section className="grid gap-2 rounded-[var(--radius-box)] border border-base-300 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{copy.binary.particles}: {particles.length}</h2>
                <Button type="button" variant="outline" size="sm" onClick={exportParticlesCsv}>{copy.binary.exportCsv}</Button>
              </div>
              <div className="max-h-64 overflow-auto">
                <table className="w-full min-w-[440px] text-left text-xs tabular-nums">
                  <thead><tr className="border-b border-base-300"><th className="p-2">#</th><th className="p-2">{copy.stats.area}</th><th className="p-2">{copy.binary.perimeter}</th><th className="p-2">{copy.binary.circularity}</th><th className="p-2">{copy.binary.centroid}</th></tr></thead>
                  <tbody>{particles.map((particle) => (
                    <tr key={particle.id} className="border-b border-base-200">
                      <td className="p-2">{particle.id}</td><td className="p-2">{particle.area}</td>
                      <td className="p-2">{particle.perimeter}</td><td className="p-2">{particle.circularity.toFixed(3)}</td>
                      <td className="p-2">({particle.centroidX.toFixed(1)}, {particle.centroidY.toFixed(1)})</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          ) : null}
        </main>

        <aside className="flex min-h-0 flex-col gap-4 border-t border-base-300 bg-base-100 p-4 lg:h-full lg:overflow-y-auto lg:border-l lg:border-t-0">
          <section className="grid gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">{copy.adjust.grayscale}</h2>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={!original} title={copy.adjust.grayscaleHint} onClick={resetToGray}>
                <ImageIcon size={15} />
                {copy.adjust.grayscale}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={!hasImage} onClick={() => run(invert)}>
                <Contrast size={15} />
                {copy.adjust.invert}
              </Button>
            </div>
          </section>

          <section className="grid gap-3 rounded-[var(--radius-box)] bg-muted/50 p-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">
              {copy.adjust.brightness} / {copy.adjust.contrast}
            </h2>
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
          </section>

          <section className="grid gap-3 rounded-[var(--radius-box)] bg-muted/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">{copy.adjust.threshold}</h2>
              <span className="font-mono text-xs tabular-nums text-base-content/70">{thresholdLevel}</span>
            </div>
            <input
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
          </section>

          <section className="grid gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">{copy.filters.heading}</h2>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={!hasImage} onClick={() => run(mean3x3)}>
                {copy.filters.mean}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={!hasImage} onClick={() => run(median3x3)}>
                {copy.filters.median}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={!hasImage} onClick={() => run(sharpen3x3)}>
                {copy.filters.sharpen}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={!hasImage} onClick={() => run(sobelEdges)}>
                {copy.filters.sobel}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={!hasImage} onClick={() => runAdvanced(minimum3x3)}>{copy.filters.minimum}</Button>
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={!hasImage} onClick={() => runAdvanced(maximum3x3)}>{copy.filters.maximum}</Button>
            </div>
            <Label htmlFor="imagej-gaussian-sigma" className="justify-between text-xs"><span>{copy.filters.gaussian} {copy.filters.sigma}</span><span>{gaussianSigma.toFixed(1)}</span></Label>
            <input id="imagej-gaussian-sigma" type="range" min={0.5} max={5} step={0.1} value={gaussianSigma} disabled={!hasImage} onChange={(event) => setGaussianSigma(Number(event.target.value))} className="w-full accent-primary" />
            <Button type="button" variant="outline" size="sm" disabled={!hasImage} onClick={() => runAdvanced((image) => gaussianBlur(image, gaussianSigma))}>{copy.filters.gaussian}</Button>
          </section>

          <section className="grid gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">{copy.geometry.heading}</h2>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={!hasImage || Boolean(stack && stack.length > 1)} title={stack && stack.length > 1 ? copy.stack.geometryUnavailable : undefined} onClick={cropToRoi}>
                <Crop size={15} />
                {copy.geometry.crop}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={!hasImage} onClick={() => run(flipHorizontal, { roiMode: 'selection' })}>
                <FlipHorizontal size={15} />
                {copy.geometry.flipH}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={!hasImage} onClick={() => run(flipVertical, { roiMode: 'selection' })}>
                <FlipVertical size={15} />
                {copy.geometry.flipV}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={!hasImage || Boolean(stack && stack.length > 1)} title={stack && stack.length > 1 ? copy.stack.geometryUnavailable : undefined} onClick={() => run((image) => rotate90(image, 'cw'), { resetRoi: true, roiMode: 'whole' })}>
                <RotateCw size={15} />
                {copy.geometry.rotateCw}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-9 col-span-2" disabled={!hasImage || Boolean(stack && stack.length > 1)} title={stack && stack.length > 1 ? copy.stack.geometryUnavailable : undefined} onClick={() => run((image) => rotate90(image, 'ccw'), { resetRoi: true, roiMode: 'whole' })}>
                <RotateCcw size={15} />
                {copy.geometry.rotateCcw}
              </Button>
            </div>
          </section>

          <section className="grid gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">{copy.binary.heading}</h2>
            <Label htmlFor="imagej-particle-min-area" className="text-xs">{copy.binary.minArea}</Label>
            <input id="imagej-particle-min-area" type="number" min={1} max={4_000_000} step={1} value={minParticleArea} onChange={(event) => setMinParticleArea(Math.max(1, Math.min(4_000_000, Math.round(Number(event.target.value) || 1))))} className="h-8 w-full rounded-md border border-base-300 bg-base-100 px-2 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!hasImage} onClick={() => runAdvanced(erode)}>{copy.binary.erode}</Button>
              <Button type="button" variant="outline" size="sm" disabled={!hasImage} onClick={() => runAdvanced(dilate)}>{copy.binary.dilate}</Button>
              <Button type="button" variant="outline" size="sm" disabled={!hasImage} onClick={() => runAdvanced(openBinary)}>{copy.binary.open}</Button>
              <Button type="button" variant="outline" size="sm" disabled={!hasImage} onClick={() => runAdvanced(closeBinary)}>{copy.binary.close}</Button>
              <Button type="button" variant="outline" size="sm" disabled={!hasImage} onClick={() => runAdvanced(fillHoles)}>{copy.binary.fillHoles}</Button>
              <Button type="button" variant="secondary" size="sm" disabled={!hasImage} onClick={analyzeCurrentParticles}>{copy.binary.analyze}</Button>
            </div>
          </section>

          <section className="grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" size="sm" className="h-9" disabled={!historyFlags.canUndo} onClick={undo}>
                <Undo2 size={15} />
                {copy.history.undo}
              </Button>
              <Button type="button" variant="secondary" size="sm" className="h-9" disabled={!historyFlags.canRedo} onClick={redo}>
                <Redo2 size={15} />
                {copy.history.redo}
              </Button>
              <Button type="button" className="h-9 col-span-2 font-semibold" disabled={!hasImage} onClick={exportPng}>
                <Download size={16} />
                {copy.exportPng}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!hasImage} onClick={() => downloadTiff(false)}>{copy.stack.exportCurrent}</Button>
              <Button type="button" variant="outline" size="sm" disabled={!stack || stack.length < 2} onClick={() => downloadTiff(true)}>{copy.stack.exportAll}</Button>
            </div>
          </section>

          <p className="text-[11px] leading-relaxed text-base-content/45">{copy.localNote}</p>

          <div role="status" aria-live="polite" className="text-xs text-base-content/60">
            {status}
          </div>
        </aside>
      </div>
    </div>
  )
}
