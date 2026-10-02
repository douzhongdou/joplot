'use client'

import { useEffect, useImperativeHandle, useRef, useState, type Ref, type PointerEvent } from 'react'
import type { ImageBlock } from '../engine/types'
import { centerCamera, fitZoom, oneToOneZoom, screenToPixel, zoomAt, type CameraState } from '../engine/render/geometry'
import { rasterizeViewport, type RasterOptions } from '../engine/render/raster'
import type { DisplayWindowLevel } from '../engine/render/rgba'
import type { Rect } from '../lib/processor'
import { adjustedColorValue } from '../engine/colorAdjustments'

export interface ImageViewportHandle { fit(): void; actualSize(): void; zoomBy(factor: number): void }
export interface PixelProbe { x: number; y: number; value: number }

export function ImageViewport({ block, windowLevel, options, tool, roi, onRoi, onProbe, onZoom, ref }: {
  block: ImageBlock; windowLevel: DisplayWindowLevel; options?: RasterOptions; tool: 'pan' | 'roi'; roi: Rect | null
  onRoi(roi: Rect | null): void; onProbe(probe: PixelProbe | null): void; onZoom(zoom: number): void
  ref?: Ref<ImageViewportHandle>
}) {
  const containerRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null)
  const [camera, setCamera] = useState<CameraState>({ zoom: 1, panX: 0, panY: 0, devicePixelRatio: 1, viewportWidth: 1, viewportHeight: 1 })
  const cameraRef = useRef(camera); cameraRef.current = camera
  const space = useRef(false)
  const drag = useRef<{ mode: 'pan' | 'draw' | 'move'; x: number; y: number; camera: CameraState; roi: Rect | null } | null>(null)
  const iw = block.shape[block.axes.indexOf('x')]!, ih = block.shape[block.axes.indexOf('y')]!
  const fit = () => setCamera((c) => centerCamera(iw, ih, { ...c, zoom: fitZoom(iw, ih, c.viewportWidth - 24, c.viewportHeight - 24) }))
  useImperativeHandle(ref, () => ({ fit, actualSize: () => setCamera((c) => centerCamera(iw, ih, { ...c, zoom: oneToOneZoom(c.devicePixelRatio) })), zoomBy: (factor) => setCamera((c) => zoomAt(c, factor, c.viewportWidth / 2, c.viewportHeight / 2)) }))
  useEffect(() => {
    const el = containerRef.current!
    const resize = () => setCamera((c) => {
      const next = { ...c, viewportWidth: Math.max(1, el.clientWidth), viewportHeight: Math.max(1, el.clientHeight), devicePixelRatio: window.devicePixelRatio || 1 }
      return centerCamera(iw, ih, { ...next, zoom: fitZoom(iw, ih, next.viewportWidth - 24, next.viewportHeight - 24) })
    })
    resize()
    const observer = new ResizeObserver(resize); observer.observe(el)
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const bounds = el.getBoundingClientRect()
      setCamera((c) => zoomAt(c, Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.005), event.clientX - bounds.left, event.clientY - bounds.top))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => { observer.disconnect(); el.removeEventListener('wheel', wheel) }
  }, [iw, ih])
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !(event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable))) { event.preventDefault(); space.current = true }
    }
    const up = () => { space.current = false }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', up) }
  }, [])
  useEffect(() => { onZoom(camera.zoom) }, [camera.zoom, onZoom])
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const width = Math.max(1, Math.round(camera.viewportWidth * camera.devicePixelRatio)), height = Math.max(1, Math.round(camera.viewportHeight * camera.devicePixelRatio))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      canvas.getContext('2d')?.putImageData(new ImageData(rasterizeViewport(block, camera, windowLevel, options), width, height), 0, 0)
    })
    return () => cancelAnimationFrame(frame)
  }, [block, camera, windowLevel, options])
  const point = (event: PointerEvent<HTMLCanvasElement>, clamp = false) => {
    const bounds = event.currentTarget.getBoundingClientRect(), c = cameraRef.current
    if (clamp) return { x: Math.max(0, Math.min(iw - 1, Math.floor((event.clientX - bounds.left - c.panX) / c.zoom))), y: Math.max(0, Math.min(ih - 1, Math.floor((event.clientY - bounds.top - c.panY) / c.zoom))) }
    return screenToPixel(event.clientX - bounds.left, event.clientY - bounds.top, c, iw, ih)
  }
  const down = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'pan' || space.current || event.button === 1 || event.altKey) {
      drag.current = { mode: 'pan', x: event.clientX, y: event.clientY, camera: cameraRef.current, roi: null }; return
    }
    const p = point(event); if (!p) return
    const inside = roi && p.x >= roi.x && p.x < roi.x + roi.width && p.y >= roi.y && p.y < roi.y + roi.height
    drag.current = { mode: inside ? 'move' : 'draw', x: p.x, y: p.y, camera: cameraRef.current, roi }
    if (!inside) onRoi({ x: p.x, y: p.y, width: 1, height: 1 })
  }
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const active = drag.current
    if (active?.mode === 'pan') {
      setCamera({ ...active.camera, panX: active.camera.panX + event.clientX - active.x, panY: active.camera.panY + event.clientY - active.y }); return
    }
    const p = point(event, Boolean(active)); if (!p) { onProbe(null); return }
    const i = p.y * iw + p.x, ci = block.axes.indexOf('c'), pixels = iw * ih
    const colorValue = (channel: number) => adjustedColorValue(block.data[channel * pixels + i]!, channel, p.x, p.y, options?.colorAdjustments ?? [], block.dtype === 'uint16' ? 65535 : 255)
    onProbe({ ...p, value: ci >= 0 && block.shape[ci] === 3 ? Math.round((colorValue(0) + colorValue(1) + colorValue(2)) / 3) : block.data[i]! })
    if (active?.mode === 'draw') onRoi({ x: Math.min(active.x, p.x), y: Math.min(active.y, p.y), width: Math.abs(active.x - p.x) + 1, height: Math.abs(active.y - p.y) + 1 })
    if (active?.mode === 'move' && active.roi) onRoi({ ...active.roi, x: Math.max(0, Math.min(iw - active.roi.width, active.roi.x + p.x - active.x)), y: Math.max(0, Math.min(ih - active.roi.height, active.roi.y + p.y - active.y)) })
  }
  const up = (event: PointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.mode === 'draw' && roi && (roi.width < 2 || roi.height < 2)) onRoi(null)
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-black">
    <canvas ref={canvasRef} aria-label="Image viewport" className="block h-full w-full touch-none" style={{ cursor: tool === 'roi' ? 'crosshair' : 'grab' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => onProbe(null)} />
    {roi && <div aria-hidden="true" className="pointer-events-none absolute border-2 border-primary bg-primary/10" style={{ left: camera.panX + roi.x * camera.zoom, top: camera.panY + roi.y * camera.zoom, width: roi.width * camera.zoom, height: roi.height * camera.zoom }} />}
  </div>
}
