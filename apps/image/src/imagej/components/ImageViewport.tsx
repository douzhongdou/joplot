'use client'

import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type PointerEvent } from 'react'
import type { ImageBlock } from '../engine/types'
import { clampZoom, fitZoom, oneToOneZoom, screenToImage, type CameraState } from '../engine/render/geometry'
import { rasterizeRegion, type RasterOptions } from '../engine/render/raster'
import type { DisplayWindowLevel } from '../engine/render/rgba'
import { adjustedColorValue } from '../engine/colorAdjustments'
import { findTool, type ToolDefinition, type ToolId } from '../lib/tools'
import {
  clampRoi,
  lineRoi,
  ovalFromCorners,
  pointsRoi,
  rectangleFromCorners,
  roiBounds,
  roiHandles,
  roiHit,
  roiIsFilled,
  roiPathData,
  roiTranslate,
  roiWithHandle,
  type PointsRoi,
  type Roi,
  type RoiKind,
} from '../lib/roi'

export interface ImageViewportHandle {
  fit(): void
  actualSize(): void
  zoomBy(factor: number): void
  /**
   * 当前视口覆盖的图像区域（含一圈余量）；整幅图都可见时返回 null。
   *
   * 滤镜预览用它把计算量从整幅图压到一个屏幕：区域边界靠算子声明的 halo 补像素，
   * 所以带内结果是正确的、带外保持原样——预览时大幅滚动会看到还没处理的像素，
   * 这是"只算可视区域"的固有取舍。
   */
  visibleRegion(): { x: number; y: number; width: number; height: number } | null
}
export interface PixelProbe { x: number; y: number; value: number }

/** 视口底色；与光栅化内核里的越界像素色一致，两者拼接处看不出接缝。 */
const VIEWPORT_BACKGROUND = '#131317'
/** 手柄命中半径（屏幕像素）。 */
const HANDLE_RADIUS = 6
/** 双击判定窗口（毫秒），对齐 ImageJ 的 `Toolbar.DOUBLE_CLICK_THRESHOLD`。 */
const DOUBLE_CLICK_MS = 500

/**
 * 主视口。
 *
 * 用原生滚动容器承载平移：内层 spacer 按 `zoom × 图像尺寸` 撑开，浏览器据此提供
 * 常驻的细 xy 滚动条（样式来自 `theme.css` 的全局滚动条规则）。canvas 固定为视口大小
 * 覆盖在上层（`pointer-events-none`），按滚动位置派生相机，只光栅化可见区域。
 *
 * 工具按 `lib/tools.ts` 的注册表分派（对齐 ImageJ 的工具栏）：
 * - 平移 / 缩放 / 取色：不产生选区；
 * - 矩形 / 椭圆 / 直线：按下拖出两端；
 * - 手绘：按下持续采样，松开成闭合区域；
 * - 折线 / 多边形 / 角度：逐点点击，双击或回车结束（Esc 取消）；
 * - 点：单击落点（`multipoint` 子类型可连续落点）。
 *
 * 选区一律用 SVG 叠加层绘制（`roiPathData`），与 canvas 共用同一套相机换算，
 * 因此不会出现选区与像素错半个像素的问题；顶点手柄在指针处理里做数学命中测试。
 */
export function ImageViewport({ block, windowLevel, options, tool, variant, roi, onRoi, onProbe, onZoom, onStepPage, onViewChange, ref }: {
  block: ImageBlock; windowLevel: DisplayWindowLevel; options?: RasterOptions
  tool: ToolId
  /** 工具子类型（直线：`line` / `arrow`；点：`point` / `multipoint`）。 */
  variant?: string
  roi: Roi | null
  onRoi(roi: Roi | null): void; onProbe(probe: PixelProbe | null): void; onZoom(zoom: number): void
  /** Stack 模式下普通滚轮逐页切换，参数为 +1 / -1；省略表示没有可翻的页。 */
  onStepPage?(delta: number): void
  /** 视口覆盖的图像区域变化时回调（含余量；整幅可见时为 null）。 */
  onViewChange?: (region: { x: number; y: number; width: number; height: number } | null) => void
  ref?: Ref<ImageViewportHandle>
}) {
  const scrollerRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null)
  /** 复用的 RGBA 缓冲与 2D 上下文：翻页每帧省掉数 MB 的分配。 */
  const bufferRef = useRef<Uint8ClampedArray<ArrayBuffer> | null>(null)
  const contextRef = useRef<CanvasRenderingContext2D | null>(null)
  const [zoom, setZoom] = useState(1)
  const [view, setView] = useState({ w: 0, h: 0, dpr: 1 })
  const [scroll, setScroll] = useState({ x: 0, y: 0 })
  /** 绘制中的预览选区（未提交）。 */
  const [draft, setDraft] = useState<Roi | null>(null)
  /** 多步工具已落的点，以及跟随光标的橡皮筋位置（只有点序列类工具会进入该状态）。 */
  const [pending, setPending] = useState<{ kind: PointsRoi['kind']; points: number[]; hover: [number, number] | null } | null>(null)
  const pendingRef = useRef(pending); pendingRef.current = pending
  const pendingScroll = useRef<{ x: number; y: number } | null>(null)
  const pendingCenter = useRef(true)
  const space = useRef(false)
  const drag = useRef<
    | { mode: 'pan'; x: number; y: number }
    | { mode: 'draw'; kind: RoiKind; start: { x: number; y: number }; current: { x: number; y: number } }
    | { mode: 'freehand'; points: number[] }
    | { mode: 'move'; roi: Roi; last: { x: number; y: number } }
    | { mode: 'handle'; index: number; roi: Roi }
    | null
  >(null)
  const stepPageRef = useRef(onStepPage); stepPageRef.current = onStepPage
  const onViewChangeRef = useRef(onViewChange); onViewChangeRef.current = onViewChange
  const wheelAccum = useRef(0)
  /** 最近一次落点的时间与位置：用于识别多步工具的双击收尾。 */
  const lastClick = useRef<{ x: number; y: number; at: number } | null>(null)

  const iw = block.shape[block.axes.indexOf('x')]!, ih = block.shape[block.axes.indexOf('y')]!
  const definition: ToolDefinition = findTool(tool)
  const arrowVariant = definition.id === 'line' && variant === 'arrow'
  const multipointVariant = definition.id === 'point' && variant === 'multipoint'

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
  const roiRef = useRef(roi); roiRef.current = roi
  const onRoiRef = useRef(onRoi); onRoiRef.current = onRoi

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

  /** 当前视口覆盖的图像区域；整幅可见时返回 null（见 ImageViewportHandle.visibleRegion）。 */
  const computeVisibleRegion = () => {
    const camera = cameraRef.current
    if (!camera.viewportWidth || !camera.viewportHeight) return null
    const topLeft = screenToImage(0, 0, camera)
    const bottomRight = screenToImage(camera.viewportWidth, camera.viewportHeight, camera)
    // 留一圈余量：小幅平移/缩放不必重算，仍落在已渲染的范围内。
    const margin = Math.round(Math.max(camera.viewportWidth, camera.viewportHeight) / camera.zoom * 0.4)
    const x0 = Math.max(0, Math.floor(topLeft.x) - margin)
    const y0 = Math.max(0, Math.floor(topLeft.y) - margin)
    const x1 = Math.min(iw, Math.ceil(bottomRight.x) + margin)
    const y1 = Math.min(ih, Math.ceil(bottomRight.y) + margin)
    const width = Math.max(1, x1 - x0), height = Math.max(1, y1 - y0)
    // 视口已经覆盖整幅图时就不必裁剪了。
    if (x0 === 0 && y0 === 0 && width >= iw && height >= ih) return null
    return { x: x0, y: y0, width, height }
  }
  const computeVisibleRegionRef = useRef(computeVisibleRegion); computeVisibleRegionRef.current = computeVisibleRegion

  /**
   * 相机变化后把新的可见区域报给上层（滤镜预览据此把计算收窄到视口）。
   *
   * 只有在区域**真的变了**才回调：余量内的平移不该触发重算。
   * 同样地，区域未变时上层也不会有任何动作。
   */
  const lastRegionRef = useRef<string>('')
  useLayoutEffect(() => {
    const report = () => {
      const region = computeVisibleRegionRef.current()
      const key = region ? `${region.x},${region.y},${region.width},${region.height}` : ''
      if (key === lastRegionRef.current) return
      lastRegionRef.current = key
      onViewChangeRef.current?.(region)
    }
    report()
  }, [camera.panX, camera.panY, camera.zoom, camera.viewportWidth, camera.viewportHeight, iw, ih])

  useImperativeHandle(ref, () => ({
    fit: () => applyZoomRef.current(fitZoom(iw, ih, viewRef.current.w - 24, viewRef.current.h - 24)),
    actualSize: () => applyZoomRef.current(oneToOneZoom(viewRef.current.dpr)),
    zoomBy: (factor) => applyZoomRef.current(zoomRef.current * factor, viewRef.current.w / 2, viewRef.current.h / 2),
    visibleRegion: () => computeVisibleRegionRef.current(),
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

  /** 多步工具的收尾：双击或回车提交，Esc 丢弃。 */
  const commitPending = () => {
    const current = pendingRef.current
    if (!current) return
    const enough = current.kind === 'angle' ? current.points.length >= 6 : current.points.length >= 4
    if (!enough) { setPending(null); return }
    onRoiRef.current(pointsRoi(current.kind, current.points))
    setPending(null)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (event.key === 'Escape') { setPending(null); setDraft(null); drag.current = null; return }
      if (event.key === 'Enter' && pendingRef.current) { event.preventDefault(); commitPending() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { onZoom(zoom) }, [zoom, onZoom])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas || view.w <= 0 || view.h <= 0) return
      const width = Math.max(1, Math.round(view.w * view.dpr)), height = Math.max(1, Math.round(view.h * view.dpr))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      const context = contextRef.current ?? (contextRef.current = canvas.getContext('2d'))
      if (!context) return
      // 只光栅化图像覆盖的那块矩形，其余像素一次铺底色。翻页时这一步在主线程上，
      // 缩小查看（Stack 的常见形态）下处理的像素数因此降一个数量级。
      const { pixels, region } = rasterizeRegion(block, camera, windowLevel, options, bufferRef.current ?? undefined)
      bufferRef.current = pixels
      context.fillStyle = VIEWPORT_BACKGROUND
      context.fillRect(0, 0, width, height)
      if (region.width > 0 && region.height > 0) {
        context.putImageData(new ImageData(pixels.subarray(0, region.width * region.height * 4), region.width, region.height), region.x, region.y)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [block, camera, windowLevel, options, view.w, view.h, view.dpr])

  /** 事件位置 → 图像坐标（夹取到图像内）；选区构造用。 */
  const imagePoint = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect(), c = cameraRef.current
    return {
      x: Math.max(0, Math.min(iw - 1, Math.floor((event.clientX - bounds.left - c.panX) / c.zoom))),
      y: Math.max(0, Math.min(ih - 1, Math.floor((event.clientY - bounds.top - c.panY) / c.zoom))),
    }
  }
  /** 不夹取的图像坐标：用于判断光标是否已移出图像。 */
  const rawImagePoint = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect(), c = cameraRef.current
    return { x: (event.clientX - bounds.left - c.panX) / c.zoom, y: (event.clientY - bounds.top - c.panY) / c.zoom }
  }
  const probeAt = (x: number, y: number) => {
    const i = y * iw + x, ci = block.axes.indexOf('c'), pixels = iw * ih
    const colorValue = (channel: number) => adjustedColorValue(block.data[channel * pixels + i]!, channel, x, y, options?.colorAdjustments ?? [], block.dtype === 'uint16' ? 65535 : 255)
    onProbe({ x, y, value: ci >= 0 && block.shape[ci] === 3 ? Math.round((colorValue(0) + colorValue(1) + colorValue(2)) / 3) : block.data[i]! })
  }

  /** 命中的手柄序号（按屏幕距离判定，避免给 SVG 手柄再加一层事件监听）。 */
  const handleAt = (event: PointerEvent<HTMLDivElement>): number | null => {
    const current = roiRef.current
    if (!current) return null
    const bounds = event.currentTarget.getBoundingClientRect(), c = cameraRef.current
    const handles = roiHandles(current)
    for (let index = 0; index * 2 + 1 < handles.length; index += 1) {
      const hx = bounds.left + c.panX + handles[index * 2]! * c.zoom
      const hy = bounds.top + c.panY + handles[index * 2 + 1]! * c.zoom
      if (Math.hypot(event.clientX - hx, event.clientY - hy) <= HANDLE_RADIUS) return index
    }
    return null
  }

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const panning = definition.interaction === 'pan' || space.current || event.button === 1 || event.altKey
    if (panning) {
      drag.current = { mode: 'pan', x: event.clientX, y: event.clientY }
      return
    }
    if (event.button !== 0) return

    const p = imagePoint(event)
    if (definition.interaction === 'zoom') {
      const bounds = event.currentTarget.getBoundingClientRect()
      const factor = event.shiftKey ? 1 / 1.6 : 1.6
      applyZoomRef.current(zoomRef.current * factor, event.clientX - bounds.left, event.clientY - bounds.top)
      return
    }
    if (definition.interaction === 'pick') { probeAt(p.x, p.y); return }

    // 先看是否在编辑已有选区：手柄 > 内部拖动 > 新绘制。
    const handle = handleAt(event)
    if (handle !== null && roi) { drag.current = { mode: 'handle', index: handle, roi }; return }
    if (roi && roiHit(roi, p.x, p.y)) { drag.current = { mode: 'move', roi, last: p }; return }

    const kind = definition.roiKind
    if (!kind) return
    if (definition.interaction === 'drag') { drag.current = { mode: 'draw', kind, start: p, current: p }; setDraft(null); return }
    if (definition.interaction === 'freehand') { drag.current = { mode: 'freehand', points: [p.x, p.y] }; setDraft(pointsRoi('freehand', [p.x, p.y])); return }
    if (definition.interaction === 'dot') {
      if (multipointVariant) {
        const existing = roi && roi.kind === 'point' ? roi.points : []
        onRoi(pointsRoi('point', [...existing, p.x, p.y]))
      } else onRoi(pointsRoi('point', [p.x, p.y]))
      return
    }
    // multi：逐点累积，双击或回车提交（多步工具只产出点序列类 ROI）。
    // 双击的两次 press 都会进来，这里按「时间 + 位置」判一次双击来避免多落一个顶点
    // （对齐 ImageJ 的 DOUBLE_CLICK_THRESHOLD；注入事件的 `detail` 不可靠，故不用它）。
    const now = performance.now()
    const last = lastClick.current
    const doubleClick = last !== null && now - last.at <= DOUBLE_CLICK_MS && last.x === p.x && last.y === p.y
    lastClick.current = { x: p.x, y: p.y, at: now }
    if (doubleClick) return
    const pointsKind = definition.roiKind as PointsRoi['kind']
    const current = pendingRef.current
    const base = current && current.kind === pointsKind ? current.points : []
    // 点回起点：闭合意图（ImageJ 的多边形也支持这样收尾），直接提交。
    if (base.length >= 6 && p.x === base[0] && p.y === base[1]) { commitPending(); return }
    const lastX = base[base.length - 2], lastY = base[base.length - 1]
    if (lastX !== undefined && lastX === p.x && lastY === p.y) return
    setPending({ kind: pointsKind, points: [...base, p.x, p.y], hover: null })
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (active?.mode === 'pan') {
      const el = scrollerRef.current
      if (el) { el.scrollLeft -= event.clientX - active.x; el.scrollTop -= event.clientY - active.y }
      active.x = event.clientX; active.y = event.clientY; return
    }
    const p = imagePoint(event)
    if (active?.mode === 'draw') {
      active.current = p
      setDraft(active.kind === 'rectangle' ? rectangleFromCorners(active.start.x, active.start.y, p.x, p.y)
        : active.kind === 'oval' ? ovalFromCorners(active.start.x, active.start.y, p.x, p.y)
          : lineRoi(active.start.x, active.start.y, p.x, p.y, arrowVariant))
      return
    }
    if (active?.mode === 'freehand') {
      const points = active.points
      const lastX = points[points.length - 2], lastY = points[points.length - 1]
      // 抽稀：相邻采样点至少相隔一个像素，避免手绘产生上万顶点。
      if (lastX === undefined || Math.hypot(p.x - lastX, p.y - lastY) >= 1) points.push(p.x, p.y)
      setDraft(pointsRoi('freehand', points))
      return
    }
    if (active?.mode === 'move') {
      const next = clampRoi(roiTranslate(active.roi, p.x - active.last.x, p.y - active.last.y), iw, ih)
      active.roi = next; active.last = p
      onRoi(next)
      return
    }
    if (active?.mode === 'handle') {
      const next = clampRoi(roiWithHandle(active.roi, active.index, p.x, p.y), iw, ih)
      active.roi = next
      onRoi(next)
      return
    }
    // 多步工具：跟踪光标做橡皮筋预览。
    const current = pendingRef.current
    if (current) setPending({ ...current, hover: [p.x, p.y] })
    if (definition.interaction === 'pick') { probeAt(p.x, p.y); return }
    const raw = rawImagePoint(event)
    if (raw.x < 0 || raw.y < 0 || raw.x >= iw || raw.y >= ih) { onProbe(null); return }
    probeAt(p.x, p.y)
  }

  const up = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    // 用 drag 里记录的几何提交（不读 draft state，避免快速抬手时读到上一帧的值）。
    if (active?.mode === 'draw') {
      setDraft(null)
      const { start, current, kind } = active
      const next = kind === 'rectangle' ? rectangleFromCorners(start.x, start.y, current.x, current.y)
        : kind === 'oval' ? ovalFromCorners(start.x, start.y, current.x, current.y)
          : lineRoi(start.x, start.y, current.x, current.y, arrowVariant)
      const bounds = roiBounds(next)
      // 直线只要有长度即可；面积类需要两个方向都成形，否则视为误点。
      if (next.kind === 'line' ? (bounds.width < 2 && bounds.height < 2) : (bounds.width < 2 || bounds.height < 2)) return
      onRoi(next)
      return
    }
    if (active?.mode === 'freehand') {
      setDraft(null)
      // 自由手绘至少要围出一个像样的区域，否则视为误点。
      if (active.points.length < 6) return
      const next = pointsRoi('freehand', active.points)
      const bounds = roiBounds(next)
      if (bounds.width < 3 && bounds.height < 3) return
      onRoi(next)
    }
  }

  /** 选区几何 → 屏幕坐标（与 canvas 共用同一套相机换算）。 */
  const screenPath = (target: Roi, dashed: boolean) => (
    <path
      d={roiPathData(target, camera.panX, camera.panY, camera.zoom)}
      fill={roiIsFilled(target) ? 'color-mix(in oklab, var(--color-primary, #3b82f6) 16%, transparent)' : 'none'}
      stroke="var(--color-primary, #3b82f6)"
      strokeWidth={1.5}
      strokeDasharray={dashed ? '5 3' : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )

  const handles = useMemo(() => {
    if (!roi) return []
    const points = roiHandles(roi)
    const out: { x: number; y: number; index: number }[] = []
    for (let index = 0; index * 2 + 1 < points.length; index += 1) {
      out.push({ x: camera.panX + points[index * 2]! * camera.zoom, y: camera.panY + points[index * 2 + 1]! * camera.zoom, index })
    }
    return out
  }, [roi, camera.panX, camera.panY, camera.zoom])

  const cursor = definition.interaction === 'pan' ? 'grab' : definition.id === 'zoom' ? 'zoom-in' : 'crosshair'

  return <div className="absolute inset-0 overflow-hidden bg-black">
    <div ref={scrollerRef} className="absolute inset-0 overflow-scroll bg-transparent"
      style={{ cursor }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => onProbe(null)}
      onDoubleClick={() => { if (pendingRef.current) commitPending() }}>
      <div style={{ width: content.cw, height: content.ch }} />
    </div>
    <canvas ref={canvasRef} aria-label="Image viewport" className="pointer-events-none absolute left-0 top-0 touch-none" style={{ width: view.w || 1, height: view.h || 1 }} />
    <svg aria-hidden="true" data-roi-overlay="true" className="pointer-events-none absolute left-0 top-0" width={view.w || 1} height={view.h || 1}>
      {roi ? screenPath(roi, false) : null}
      {draft ? screenPath(draft, true) : null}
      {pending ? screenPath(pendingPreview(pending), true) : null}
      {handles.map((handle) => (
        <circle key={handle.index} cx={handle.x} cy={handle.y} r={3.5}
          fill="var(--color-base-100, #fff)" stroke="var(--color-primary, #3b82f6)" strokeWidth={1.5} />
      ))}
      {definition.id === 'angle' && roi?.kind === 'angle' ? angleLabel(roi, camera) : null}
      {definition.id === 'line' && roi?.kind === 'line' ? lineLabel(roi, camera) : null}
    </svg>
  </div>
}

/** 多步工具的预览几何：已落的点 + 跟随光标的那一段。 */
function pendingPreview(pending: { kind: PointsRoi['kind']; points: number[]; hover: [number, number] | null }): Roi {
  const points = [...pending.points]
  if (pending.hover) points.push(pending.hover[0], pending.hover[1])
  return pointsRoi(pending.kind, points)
}

/** 直线的长度与角度标注（对齐 ImageJ 画线时显示长度/角度的习惯）。 */
function lineLabel(roi: Roi, camera: CameraState) {
  if (roi.kind !== 'line') return null
  const dx = roi.x2 - roi.x1, dy = roi.y2 - roi.y1
  const cx = camera.panX + ((roi.x1 + roi.x2) / 2) * camera.zoom
  const cy = camera.panY + ((roi.y1 + roi.y2) / 2) * camera.zoom
  return <text x={cx + 6} y={cy - 6} className="fill-base-content text-xs" stroke="var(--color-base-100, #fff)" strokeWidth={3}>
    {`${Math.hypot(dx, dy).toFixed(1)} px · ${(Math.atan2(-dy, dx) * 180 / Math.PI).toFixed(1)}°`}
  </text>
}

/** 角度标注（ImageJ 的 angle 工具在中点显示夹角）。 */
function angleLabel(roi: Roi, camera: CameraState) {
  if (roi.kind !== 'angle' || roi.points.length < 6) return null
  const [ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0] = roi.points
  const v1x = ax - bx, v1y = ay - by, v2x = cx - bx, v2y = cy - by
  const angle = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / ((Math.hypot(v1x, v1y) || 1) * (Math.hypot(v2x, v2y) || 1))))) * 180 / Math.PI
  const screenX = camera.panX + bx * camera.zoom, screenY = camera.panY + by * camera.zoom
  return <text x={screenX + 8} y={screenY - 8} className="fill-base-content text-xs" stroke="var(--color-base-100, #fff)" strokeWidth={3}>
    {`${angle.toFixed(1)}°`}
  </text>
}

