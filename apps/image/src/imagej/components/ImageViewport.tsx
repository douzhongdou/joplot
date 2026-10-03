'use client'

import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type PointerEvent } from 'react'
import type { ImageBlock } from '../engine/types'
import { clampZoom, fitZoom, oneToOneZoom, screenToImage, screenToPixel, type CameraState } from '../engine/render/geometry'
import { rasterizeViewport, type RasterOptions } from '../engine/render/raster'
import type { DisplayWindowLevel } from '../engine/render/rgba'
import type { Rect } from '../lib/processor'
import { adjustedColorValue } from '../engine/colorAdjustments'

export interface ImageViewportHandle { fit(): void; actualSize(): void; zoomBy(factor: number): void }
export interface PixelProbe { x: number; y: number; value: number }

/**
 * 主视口。
 *
 * 用原生滚动容器承载平移：内层 spacer 按 `zoom × 图像尺寸` 撑开，浏览器据此提供
 * 常驻的细 xy 滚动条（样式来自 `theme.css` 的全局滚动条规则）。canvas 固定为视口大小
 * 覆盖在上层（`pointer-events-none`），按滚动位置派生相机，只光栅化可见区域。
 *
 * - 拖动 / 空格 / 中键 / Alt：平移 = 改 `scrollLeft/scrollTop`。
 * - Ctrl/⌘ + 滚轮：以光标为锚点缩放；普通滚轮：Stack 翻页。
 */
export function ImageViewport({ block, windowLevel, options, tool, roi, onRoi, onProbe, onZoom, onStepPage, ref }: {
  block: ImageBlock; windowLevel: DisplayWindowLevel; options?: RasterOptions; tool: 'pan' | 'roi'; roi: Rect | null
  onRoi(roi: Rect | null): void; onProbe(probe: PixelProbe | null): void; onZoom(zoom: number): void
  /** Stack 模式下普通滚轮逐页切换，参数为 +1 / -1；省略表示没有可翻的页。 */
  onStepPage?(delta: number): void
  ref?: Ref<ImageViewportHandle>
}) {
  const scrollerRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [view, setView] = useState({ w: 0, h: 0, dpr: 1 })
  const [scroll, setScroll] = useState({ x: 0, y: 0 })
  const pendingScroll = useRef<{ x: number; y: number } | null>(null)
  const pendingCenter = useRef(true)
  const space = useRef(false)
  const drag = useRef<{ mode: 'pan' | 'draw' | 'move'; x: number; y: number; roi: Rect | null } | null>(null)
  const stepPageRef = useRef(onStepPage); stepPageRef.current = onStepPage
  const wheelAccum = useRef(0)

  const iw = block.shape[block.axes.indexOf('x')]!, ih = block.shape[block.axes.indexOf('y')]!

  /* 内容尺寸与图像在内容里的居中偏移；内容小于视口时图像居中显示。 */
  const content = useMemo(() => {
    const cw = Math.max(iw * zoom, view.w), ch = Math.max(ih * zoom, view.h)
    return { cw, ch, ox: (cw - iw * zoom) / 2, oy: (ch - ih * zoom) / 2 }
  }, [iw, ih, zoom, view.w, view.h])

  /* 相机由滚动位置派生：图像原点相对滚动视口的屏幕位置 = 居中偏移 − 已滚动距离。 */
  const camera: CameraState = useMemo(() => ({
    zoom,
    panX: content.ox - scroll.x,
    panY: content.oy - scroll.y,
    viewportWidth: view.w,
    viewportHeight: view.h,
    devicePixelRatio: view.dpr,
  }), [zoom, content.ox, content.oy, scroll.x, scroll.y, view.w, view.h, view.dpr])

  const cameraRef = useRef(camera); cameraRef.current = camera
  const zoomRef = useRef(zoom); zoomRef.current = zoom
  const viewRef = useRef(view); viewRef.current = view

  /** 以锚点（或居中）应用新缩放；滚动位置在 commit 后的 layout effect 里落定。 */
  const applyZoom = (nextZoom: number, anchorX?: number, anchorY?: number) => {
    const z = clampZoom(nextZoom)
    const v = viewRef.current
    if (anchorX === undefined || anchorY === undefined) {
      pendingScroll.current = null
      pendingCenter.current = true
    } else {
      const before = screenToImage(anchorX, anchorY, cameraRef.current)
      const cw = Math.max(iw * z, v.w), ch = Math.max(ih * z, v.h)
      const ox = (cw - iw * z) / 2, oy = (ch - ih * z) / 2
      pendingCenter.current = false
      pendingScroll.current = { x: ox + before.x * z - anchorX, y: oy + before.y * z - anchorY }
    }
    setZoom(z)
  }
  const applyZoomRef = useRef(applyZoom); applyZoomRef.current = applyZoom

  useImperativeHandle(ref, () => ({
    fit: () => applyZoomRef.current(fitZoom(iw, ih, viewRef.current.w - 24, viewRef.current.h - 24)),
    actualSize: () => applyZoomRef.current(oneToOneZoom(viewRef.current.dpr)),
    zoomBy: (factor) => applyZoomRef.current(zoomRef.current * factor, viewRef.current.w / 2, viewRef.current.h / 2),
  }))

  /* 测量视口；尺寸变化时重新适配窗口。 */
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => {
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight)
      const dpr = window.devicePixelRatio || 1
      setView((prev) => (prev.w === w && prev.h === h && prev.dpr === dpr ? prev : { w, h, dpr }))
      pendingScroll.current = null
      pendingCenter.current = true
      setZoom(fitZoom(iw, ih, w - 24, h - 24))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [iw, ih])

  /* 缩放 / 尺寸变化后落定滚动位置，并同步 scroll 状态。 */
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    if (pendingScroll.current) {
      el.scrollLeft = pendingScroll.current.x
      el.scrollTop = pendingScroll.current.y
      pendingScroll.current = null
    } else if (pendingCenter.current) {
      el.scrollLeft = (content.cw - view.w) / 2
      el.scrollTop = (content.ch - view.h) / 2
      pendingCenter.current = false
    }
    setScroll((prev) => (prev.x === el.scrollLeft && prev.y === el.scrollTop ? prev : { x: el.scrollLeft, y: el.scrollTop }))
  }, [zoom, content.cw, content.ch, view.w, view.h])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onScroll = () => setScroll({ x: el.scrollLeft, y: el.scrollTop })
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const wheel = (event: WheelEvent) => {
      // 始终接管滚轮，避免浏览器把它当作页面滚动或整页缩放。
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const bounds = el.getBoundingClientRect()
        const delta = Math.max(-100, Math.min(100, event.deltaY))
        applyZoomRef.current(zoomRef.current * Math.exp(-delta * 0.005), event.clientX - bounds.left, event.clientY - bounds.top)
        return
      }
      // 普通滚轮：Stack 模式下逐页切换；累积位移跨过阈值才翻一页。
      const step = stepPageRef.current
      if (!step) return
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1
      wheelAccum.current += event.deltaY * scale
      if (Math.abs(wheelAccum.current) >= 60) {
        const direction = wheelAccum.current > 0 ? 1 : -1
        wheelAccum.current = 0
        step(direction)
      }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !(event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable))) { event.preventDefault(); space.current = true }
    }
    const up = () => { space.current = false }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', up) }
  }, [])

  useEffect(() => { onZoom(zoom) }, [zoom, onZoom])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas || view.w <= 0 || view.h <= 0) return
      const width = Math.max(1, Math.round(view.w * view.dpr)), height = Math.max(1, Math.round(view.h * view.dpr))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      canvas.getContext('2d')?.putImageData(new ImageData(rasterizeViewport(block, camera, windowLevel, options), width, height), 0, 0)
    })
    return () => cancelAnimationFrame(frame)
  }, [block, camera, windowLevel, options, view.w, view.h, view.dpr])

  const point = (event: PointerEvent<HTMLDivElement>, clamp = false) => {
    const bounds = event.currentTarget.getBoundingClientRect(), c = cameraRef.current
    if (clamp) return { x: Math.max(0, Math.min(iw - 1, Math.floor((event.clientX - bounds.left - c.panX) / c.zoom))), y: Math.max(0, Math.min(ih - 1, Math.floor((event.clientY - bounds.top - c.panY) / c.zoom))) }
    return screenToPixel(event.clientX - bounds.left, event.clientY - bounds.top, c, iw, ih)
  }
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'pan' || space.current || event.button === 1 || event.altKey) {
      drag.current = { mode: 'pan', x: event.clientX, y: event.clientY, roi: null }; return
    }
    const p = point(event); if (!p) return
    const inside = roi && p.x >= roi.x && p.x < roi.x + roi.width && p.y >= roi.y && p.y < roi.y + roi.height
    drag.current = { mode: inside ? 'move' : 'draw', x: p.x, y: p.y, roi }
    if (!inside) onRoi({ x: p.x, y: p.y, width: 1, height: 1 })
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (active?.mode === 'pan') {
      const el = scrollerRef.current
      if (el) { el.scrollLeft -= event.clientX - active.x; el.scrollTop -= event.clientY - active.y }
      active.x = event.clientX; active.y = event.clientY; return
    }
    const p = point(event, Boolean(active)); if (!p) { onProbe(null); return }
    const i = p.y * iw + p.x, ci = block.axes.indexOf('c'), pixels = iw * ih
    const colorValue = (channel: number) => adjustedColorValue(block.data[channel * pixels + i]!, channel, p.x, p.y, options?.colorAdjustments ?? [], block.dtype === 'uint16' ? 65535 : 255)
    onProbe({ ...p, value: ci >= 0 && block.shape[ci] === 3 ? Math.round((colorValue(0) + colorValue(1) + colorValue(2)) / 3) : block.data[i]! })
    if (active?.mode === 'draw') onRoi({ x: Math.min(active.x, p.x), y: Math.min(active.y, p.y), width: Math.abs(active.x - p.x) + 1, height: Math.abs(active.y - p.y) + 1 })
    if (active?.mode === 'move' && active.roi) onRoi({ ...active.roi, x: Math.max(0, Math.min(iw - active.roi.width, active.roi.x + p.x - active.x)), y: Math.max(0, Math.min(ih - active.roi.height, active.roi.y + p.y - active.y)) })
  }
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.mode === 'draw' && roi && (roi.width < 2 || roi.height < 2)) onRoi(null)
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div className="absolute inset-0 overflow-hidden bg-black">
    <div ref={scrollerRef} className="absolute inset-0 overflow-scroll bg-transparent"
      style={{ cursor: tool === 'roi' ? 'crosshair' : 'grab' }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => onProbe(null)}>
      <div style={{ width: content.cw, height: content.ch }} />
    </div>
    <canvas ref={canvasRef} aria-label="Image viewport" className="pointer-events-none absolute left-0 top-0 touch-none" style={{ width: view.w || 1, height: view.h || 1 }} />
    {roi && <div aria-hidden="true" className="pointer-events-none absolute border-2 border-primary bg-primary/10" style={{ left: camera.panX + roi.x * camera.zoom, top: camera.panY + roi.y * camera.zoom, width: roi.width * camera.zoom, height: roi.height * camera.zoom }} />}
  </div>
}
