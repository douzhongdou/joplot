'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Download, Image as ImageIcon, ZoomIn, ZoomOut } from 'lucide-react'
import { AppNavbar } from '../../components/AppNavbar'
import { useI18n } from '../../i18n'
import { Button } from '@joplot/ui/button'
import { createImagejCopy } from '../lib/i18n'
import { MOCK_REGISTRY, defaultParams } from '../lib/engineRegistry.mock'
import type { OperatorSpec, ParticleRow, RecipeStep, StepParamValue, StepResult } from '../lib/engineTypes'
import { StepPanel } from './StepPanel'

/**
 * 图像工作台的 UI 外壳。
 *
 * 职责边界（与计算引擎分工）：
 * - 本文件只负责界面与交互：导入入口、工具栏、视口交互、右侧步骤台账、导出、文案。
 * - 像素运算、统计、直方图、粒子、解码归计算引擎；UI 通过 EngineAdapter 接缝驱动，
 *   台账（steps）由 UI 持有并编辑。
 * - 视口渲染目前由这里的 canvas 临时承担，引擎接管后替换本组件内部的渲染实现即可。
 */

const ZOOM_STEPS = [0.1, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32] as const
const MIN_ZOOM = ZOOM_STEPS[0]
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]

interface SourceImage {
  name: string
  width: number
  height: number
  data: Uint8ClampedArray<ArrayBuffer>
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

function nextZoom(zoom: number, direction: 1 | -1): number {
  if (direction === 1) {
    return ZOOM_STEPS.find((step) => step > zoom + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  }
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-6) ?? ZOOM_STEPS[0]
}

export function ImageJApp() {
  const { language } = useI18n()
  const copy = useMemo(() => createImagejCopy(language), [language])
  const registry = MOCK_REGISTRY

  const fileInputRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ anchorX: number; anchorY: number; scrollLeft: number; scrollTop: number } | null>(null)
  const importTokenRef = useRef(0)

  const [source, setSource] = useState<SourceImage | null>(null)
  const [probe, setProbe] = useState<{ x: number; y: number; value: string } | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  const [steps, setSteps] = useState<RecipeStep[]>([])
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  /** 执行结果由计算引擎填充；接入前为空。 */
  const [results] = useState<Record<string, StepResult>>({})

  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const pendingAnchorRef = useRef<{ imageX: number; imageY: number; offsetX: number; offsetY: number } | null>(null)

  const hasImage = Boolean(source)

  /* ---------------- 导入（解码归引擎，UI 只转交文件） ---------------- */

  const loadFile = useCallback(async (file: File) => {
    const token = ++importTokenRef.current
    setError('')
    setStatus(copy.status.loading)

    const objectUrl = URL.createObjectURL(file)
    try {
      const element = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('decode failed'))
        image.src = objectUrl
      })
      if (token !== importTokenRef.current) return

      const width = element.naturalWidth
      const height = element.naturalHeight
      if (!width || !height) throw new Error('empty image')

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('no 2d context')
      context.drawImage(element, 0, 0)
      const rgba = context.getImageData(0, 0, width, height).data

      setSource({ name: file.name, width, height, data: rgba })
      setSteps([])
      setSelectedStepId(null)
      setProbe(null)
      setZoom(1)
      setStatus(copy.status.ready)
    } catch (loadError) {
      if (token !== importTokenRef.current) return
      setStatus('')
      setError(loadError instanceof Error ? loadError.message : copy.errors.generic)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }, [copy])

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void loadFile(file)
    event.target.value = ''
  }

  /* ---------------- 视口绘制与交互 ---------------- */

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !source) return
    canvas.width = source.width
    canvas.height = source.height
    const context = canvas.getContext('2d')
    if (!context) return
    context.putImageData(new ImageData(source.data, source.width, source.height), 0, 0)
  }, [source])

  const clampZoomRef = clampZoom

  const zoomAt = (target: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    const applied = clampZoomRef(target)
    if (!viewport || !source) {
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

  // 滚轮缩放；非 passive 监听才能 preventDefault 掉浏览器自身滚动。
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const handleWheel = (event: WheelEvent) => {
      if (!source) return
      event.preventDefault()
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2
      zoomAt(zoomRef.current * factor, event.clientX, event.clientY)
    }
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [source])

  const zoomByStep = (direction: 1 | -1) => {
    const viewport = viewportRef.current
    const target = nextZoom(zoomRef.current, direction)
    if (!viewport) {
      zoomRef.current = clampZoom(target)
      setZoom(clampZoom(target))
      return
    }
    const bounds = viewport.getBoundingClientRect()
    zoomAt(target, bounds.left + viewport.clientWidth / 2, bounds.top + viewport.clientHeight / 2)
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

  const fitToWindow = () => {
    const viewport = viewportRef.current
    if (!source || !viewport) return
    const availableWidth = viewport.clientWidth - 24
    const availableHeight = viewport.clientHeight - 24
    if (availableWidth <= 0 || availableHeight <= 0) return
    const fitted = clampZoom(Math.min(availableWidth / source.width, availableHeight / source.height))
    pendingAnchorRef.current = {
      imageX: source.width / 2,
      imageY: source.height / 2,
      offsetX: viewport.clientWidth / 2,
      offsetY: viewport.clientHeight / 2,
    }
    zoomRef.current = fitted
    setZoom(fitted)
  }

  const onViewportPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const viewport = viewportRef.current
    if (!viewport) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      anchorX: event.clientX,
      anchorY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    }
  }

  const onViewportPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    const viewport = viewportRef.current
    if (drag && viewport) {
      viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.anchorX)
      viewport.scrollTop = drag.scrollTop - (event.clientY - drag.anchorY)
      return
    }
    if (!source) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    const x = Math.max(0, Math.min(source.width - 1, Math.round(((event.clientX - bounds.left) / bounds.width) * source.width)))
    const y = Math.max(0, Math.min(source.height - 1, Math.round(((event.clientY - bounds.top) / bounds.height) * source.height)))
    const offset = (y * source.width + x) * 4
    const value = `${source.data[offset]}, ${source.data[offset + 1]}, ${source.data[offset + 2]}`
    setProbe((previous) => (previous?.x === x && previous?.y === y ? previous : { x, y, value }))
  }

  const onViewportPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  /* ---------------- 台账编辑（引擎执行由 adapter 接管） ---------------- */

  const makeStepId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

  const addStep = (operator: OperatorSpec, index: number) => {
    const step: RecipeStep = { id: makeStepId(), op: operator.kind, params: defaultParams(operator) }
    setSteps((previous) => {
      const next = [...previous]
      next.splice(Math.max(0, Math.min(index, next.length)), 0, step)
      return next
    })
    setSelectedStepId(step.id)
  }

  const removeStep = (id: string) => {
    setSteps((previous) => previous.filter((step) => step.id !== id))
    setSelectedStepId((previous) => (previous === id ? null : previous))
  }

  const updateParam = (id: string, key: string, value: StepParamValue) => {
    setSteps((previous) => previous.map((step) => (
      step.id === id ? { ...step, params: { ...step.params, [key]: value } } : step
    )))
  }

  const exportParticles = (rows: ParticleRow[]) => {
    const header = 'channel,id,area,perimeter,circularity,centroid_x,centroid_y'
    const body = rows.map((row) => [
      row.channel, row.id, row.area, row.perimeter, row.circularity,
      row.centroidX.toFixed(1), row.centroidY.toFixed(1),
    ].join(','))
    const blob = new Blob([`${header}\n${body.join('\n')}\n`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(source?.name ?? 'image').replace(/\.[^.]+$/, '')}-particles.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const exportPng = () => {
    const canvas = canvasRef.current
    if (!canvas || !source) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${source.name.replace(/\.[^.]+$/, '') || 'image'}-result.png`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }, 'image/png')
  }

  const sourceLabel = source ? `${source.width} × ${source.height}` : '—'

  /* ---------------- 渲染 ---------------- */

  return (
    <div className="grid h-full grid-rows-[var(--navbar-height)_minmax(0,1fr)] bg-base-100">
      <AppNavbar
        section="imagej"
        toolbar={
          <>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileInput} />
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 rounded-[var(--radius-box)] font-semibold"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon size={15} strokeWidth={2.2} />
              {copy.openImage}
            </Button>
            {source ? (
              <span className="hidden max-w-48 shrink-0 truncate rounded-[var(--radius-field)] bg-muted px-2 py-1 text-xs text-base-content/70 sm:inline">
                {source.name}
              </span>
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
            <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0" disabled={!hasImage} onClick={exportPng}>
              <Download size={14} />
              {copy.exportPng}
            </Button>

            <span className="ml-auto hidden shrink-0 truncate pl-2 font-mono text-[11px] text-base-content/55 md:inline">
              {probe ? `(${probe.x}, ${probe.y}) = ${probe.value} · ` : ''}{sourceLabel}
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
          ) : source ? (
            <div
              ref={viewportRef}
              className="absolute inset-0 overflow-scroll bg-base-100"
              style={{ scrollbarGutter: 'stable' }}
            >
              <div
                className="relative inline-block"
                style={{ width: source.width * zoom, height: source.height * zoom, margin: 8 }}
              >
                <canvas
                  ref={canvasRef}
                  className="block touch-none"
                  style={{
                    width: source.width * zoom,
                    height: source.height * zoom,
                    imageRendering: 'pixelated',
                    cursor: dragRef.current ? 'grabbing' : 'grab',
                  }}
                  onPointerDown={onViewportPointerDown}
                  onPointerMove={onViewportPointerMove}
                  onPointerLeave={() => setProbe(null)}
                  onPointerUp={onViewportPointerUp}
                  onPointerCancel={onViewportPointerUp}
                />
              </div>
            </div>
          ) : null}
        </main>

        <aside className="flex min-h-0 flex-col gap-4 border-t border-base-300 bg-base-100 p-4 lg:h-full lg:overflow-y-auto lg:border-l lg:border-t-0">
          <StepPanel
            copy={copy}
            registry={registry}
            sourceName={source?.name ?? ''}
            sourceLabel={sourceLabel}
            steps={steps}
            results={results}
            selectedId={selectedStepId}
            onSelect={setSelectedStepId}
            onAdd={addStep}
            onRemove={removeStep}
            onParam={updateParam}
            onExportParticles={exportParticles}
          />

          <p className="text-[11px] leading-relaxed text-base-content/45">{copy.localNote}</p>

          <div role="status" aria-live="polite" className="text-xs text-base-content/60">
            {status}
          </div>
        </aside>
      </div>
    </div>
  )
}
