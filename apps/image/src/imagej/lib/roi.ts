/**
 * ROI：图像坐标系下的选区。
 *
 * 对齐 ImageJ 的类型体系（`ij/gui/Roi.java:51-52` 的
 * `RECTANGLE / OVAL / POLYGON / FREEROI / LINE / POLYLINE / FREELINE / ANGLE / POINT`），
 * 但只保留两类本质：**填充区域**（矩形 / 椭圆 / 多边形 / 自由手绘）与**笔画**（线 / 折线 / 角度 / 点）。
 *
 * 关键设计（也是改造现有 `Rect` 的原因）：ROI 不等于它的包围盒。
 * 椭圆、多边形、手绘的统计与裁剪必须按"哪些像素真的在 ROI 内"来算，
 * 否则椭圆选区会统计到四角、手绘会统计到凹处。因此这里同时给出：
 *
 * - `roiBounds`：包围盒，给分配缓冲、裁剪、显示范围用；
 * - `roiMask`：包围盒内的逐像素掩码，给统计 / 分析 / 算子用。
 *
 * 多 ROI 预留：所有函数都是纯函数、且 ROI 带 `id`，调用方把状态从
 * `Roi | null` 换成 `Roi[]` 即可支持 ROI Manager，无需改本模块。
 *
 * 坐标一律用**图像坐标**（像素中心为整数 + 0.5 更好理解，但这里约定
 * 像素 (x, y) 覆盖 [x, x+1) × [y, y+1)，判定用像素中心 x+0.5）。
 */

/** 与 `lib/processor.ts` 的矩形同构；这里重新声明以免 lib 内部循环依赖。 */
export interface RoiBounds {
  x: number
  y: number
  width: number
  height: number
}

export type RoiKind = 'rectangle' | 'oval' | 'line' | 'polyline' | 'polygon' | 'freehand' | 'point' | 'angle'

export interface RoiBase {
  readonly id: string
  readonly kind: RoiKind
}

/** 轴对齐矩形（ImageJ 的 rectangle；圆角/旋转矩形属后续子类型）。 */
export interface RectangleRoi extends RoiBase {
  kind: 'rectangle'
  x: number
  y: number
  width: number
  height: number
}

/** 椭圆（ImageJ 的 oval / ellipse 子类型统一为内切于包围盒的椭圆）。 */
export interface OvalRoi extends RoiBase {
  kind: 'oval'
  x: number
  y: number
  width: number
  height: number
}

/** 直线（ImageJ 的 line；`arrow` 子类型影响绘制而不影响掩码）。 */
export interface LineRoi extends RoiBase {
  kind: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  arrow?: boolean
}

/**
 * 点序列型 ROI：折线、多边形、自由手绘、点集、角度。
 *
 * 扁平数组 `[x0, y0, x1, y1, …]`（对齐 ImageJ 的 `int[] xp, yp`）：
 * 结构化克隆高效，且顶点编辑只需操作相邻两个数。
 */
export interface PointsRoi extends RoiBase {
  kind: 'polyline' | 'polygon' | 'freehand' | 'point' | 'angle'
  points: number[]
}

export type Roi = RectangleRoi | OvalRoi | LineRoi | PointsRoi

/** 类型守卫：区分新 ROI 与旧的矩形字面量（两者都有 x/y/width/height）。 */
export function isRoi(value: unknown): value is Roi {
  return typeof value === 'object' && value !== null && typeof (value as { kind?: unknown }).kind === 'string'
}

let roiCounter = 0
function nextRoiId(kind: RoiKind): string {
  roiCounter += 1
  return `${kind}-${roiCounter}`
}

export function rectangleRoi(x: number, y: number, width: number, height: number, id?: string): RectangleRoi {
  return { id: id ?? nextRoiId('rectangle'), kind: 'rectangle', x, y, width, height }
}

export function ovalRoi(x: number, y: number, width: number, height: number, id?: string): OvalRoi {
  return { id: id ?? nextRoiId('oval'), kind: 'oval', x, y, width, height }
}

export function lineRoi(x1: number, y1: number, x2: number, y2: number, arrow = false, id?: string): LineRoi {
  return { id: id ?? nextRoiId('line'), kind: 'line', x1, y1, x2, y2, arrow }
}

export function pointsRoi(kind: PointsRoi['kind'], points: readonly number[], id?: string): PointsRoi {
  return { id: id ?? nextRoiId(kind), kind, points: [...points] }
}

/** 由拖拽的两个角构造矩形（自动归一化方向）。 */
export function rectangleFromCorners(ax: number, ay: number, bx: number, by: number): RectangleRoi {
  const x = Math.min(ax, bx), y = Math.min(ay, by)
  return rectangleRoi(x, y, Math.abs(ax - bx), Math.abs(ay - by))
}

/** 由拖拽的两个角构造椭圆（内切于该矩形）。 */
export function ovalFromCorners(ax: number, ay: number, bx: number, by: number): OvalRoi {
  const x = Math.min(ax, bx), y = Math.min(ay, by)
  return ovalRoi(x, y, Math.abs(ax - bx), Math.abs(ay - by))
}

/** 填充区域类 ROI：掩码取自"面"。 */
export function roiIsFilled(roi: Roi): boolean {
  return roi.kind === 'rectangle' || roi.kind === 'oval' || roi.kind === 'polygon' || roi.kind === 'freehand'
}

/** 笔画类 ROI：掩码取自"线"，统计的是线覆盖的像素（如线剖面）。 */
export function roiIsStroke(roi: Roi): boolean {
  return roi.kind === 'line' || roi.kind === 'polyline' || roi.kind === 'angle'
}

/** 顶点列表（点序列类返回原数组；其余类型返回其关键点）。 */
export function roiPoints(roi: Roi): number[] {
  if (roi.kind === 'rectangle' || roi.kind === 'oval') {
    return [roi.x, roi.y, roi.x + roi.width - 1, roi.y, roi.x + roi.width - 1, roi.y + roi.height - 1, roi.x, roi.y + roi.height - 1]
  }
  if (roi.kind === 'line') return [roi.x1, roi.y1, roi.x2, roi.y2]
  return roi.points
}

/** 包围盒（向外取整到像素边界），已含所有关键点。 */
export function roiBounds(roi: Roi): RoiBounds {
  if (roi.kind === 'rectangle' || roi.kind === 'oval') {
    const x = Math.min(roi.x, roi.x + roi.width), y = Math.min(roi.y, roi.y + roi.height)
    return { x: Math.floor(x), y: Math.floor(y), width: Math.max(1, Math.ceil(Math.abs(roi.width))), height: Math.max(1, Math.ceil(Math.abs(roi.height))) }
  }
  const points = roi.kind === 'line' ? [roi.x1, roi.y1, roi.x2, roi.y2] : roi.points
  if (points.length < 2) return { x: Math.floor(points[0] ?? 0), y: Math.floor(points[1] ?? 0), width: 1, height: 1 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i]!); maxX = Math.max(maxX, points[i]!)
    minY = Math.min(minY, points[i + 1]!); maxY = Math.max(maxY, points[i + 1]!)
  }
  return { x: Math.floor(minX), y: Math.floor(minY), width: Math.max(1, Math.ceil(maxX) - Math.floor(minX) + 1), height: Math.max(1, Math.ceil(maxY) - Math.floor(minY) + 1) }
}

/** 单点是否在 ROI 内（像素中心判定）。用于交互命中测试与稀疏遍历。 */
export function roiContains(roi: Roi, x: number, y: number): boolean {
  const px = x + 0.5, py = y + 0.5
  if (roi.kind === 'rectangle') {
    return px >= roi.x && px < roi.x + roi.width && py >= roi.y && py < roi.y + roi.height
  }
  if (roi.kind === 'oval') {
    const rx = roi.width / 2, ry = roi.height / 2
    if (rx <= 0 || ry <= 0) return false
    const dx = (px - (roi.x + rx)) / rx, dy = (py - (roi.y + ry)) / ry
    return dx * dx + dy * dy <= 1
  }
  if (roi.kind === 'line') return pointNearSegment(px, py, roi.x1, roi.y1, roi.x2, roi.y2) <= 0.5
  const points = roi.points
  if (roi.kind === 'point') {
    // 严格掩码语义：只命中落点所在的那一个像素（交互容差见 roiHit）。
    for (let i = 0; i + 1 < points.length; i += 2) {
      if (Math.floor(px) === Math.floor(points[i]!) && Math.floor(py) === Math.floor(points[i + 1]!)) return true
    }
    return false
  }
  if (roi.kind === 'angle') {
    const [ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0] = points
    return pointNearSegment(px, py, ax, ay, bx, by) <= 0.5 || pointNearSegment(px, py, bx, by, cx, cy) <= 0.5
  }
  // polygon（闭合填充）与 polyline（折线笔画）、freehand（闭合填充）
  if (roi.kind === 'polygon' || roi.kind === 'freehand') return pointInPolygon(px, py, points)
  for (let i = 0; i + 3 < points.length; i += 2) {
    if (pointNearSegment(px, py, points[i]!, points[i + 1]!, points[i + 2]!, points[i + 3]!) <= 0.5) return true
  }
  return false
}

function pointNearSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** 射线法：点在多边形内（含边界容差）。 */export function pointInPolygon(px: number, py: number, points: readonly number[]): boolean {
  const count = Math.floor(points.length / 2)
  if (count < 3) return false
  let inside = false
  for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
    const xi = points[i * 2]!, yi = points[i * 2 + 1]!
    const xj = points[j * 2]!, yj = points[j * 2 + 1]!
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * 交互命中测试：点是否落在 ROI 上（含容差）。
 *
 * 与 `roiContains` 的分工：`roiContains` 是**掩码语义**（严格按像素中心判定，
 * 统计/算子用），这里是**手选语义** —— 线、折线、点这些细图形需要几像素容差
 * 才点得中，面积类则连轮廓附近也算命中。
 */
export function roiHit(roi: Roi, x: number, y: number, tolerance = 3): boolean {
  if (roi.kind === 'point') {
    for (let i = 0; i + 1 < roi.points.length; i += 2) {
      if (Math.hypot(x - roi.points[i]!, y - roi.points[i + 1]!) <= tolerance + 0.5) return true
    }
    return false
  }
  if (roi.kind === 'line') return pointNearSegment(x, y, roi.x1, roi.y1, roi.x2, roi.y2) <= tolerance
  if (roi.kind === 'polyline') {
    for (let i = 0; i + 3 < roi.points.length; i += 2) {
      if (pointNearSegment(x, y, roi.points[i]!, roi.points[i + 1]!, roi.points[i + 2]!, roi.points[i + 3]!) <= tolerance) return true
    }
    return false
  }
  if (roi.kind === 'angle') {
    const [ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0] = roi.points
    return pointNearSegment(x, y, ax, ay, bx, by) <= tolerance || pointNearSegment(x, y, bx, by, cx, cy) <= tolerance
  }
  const bounds = roiBounds(roi)
  if (x < bounds.x - tolerance || y < bounds.y - tolerance || x >= bounds.x + bounds.width + tolerance || y >= bounds.y + bounds.height + tolerance) return false
  return roiContains(roi, Math.floor(x), Math.floor(y)) || nearRoiOutline(roi, x, y, tolerance)
}

/** 点是否靠近面积类 ROI 的轮廓（矩形/椭圆/多边形/手绘的边框）。 */
function nearRoiOutline(roi: Roi, x: number, y: number, tolerance: number): boolean {
  const points = roiPoints(roi)
  const count = points.length / 2
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count
    if (pointNearSegment(x, y, points[i * 2]!, points[i * 2 + 1]!, points[j * 2]!, points[j * 2 + 1]!) <= tolerance) return true
  }
  return false
}

/**
 * 掩码：包围盒 + 逐像素值（255 表示在 ROI 内）。
 *
 * 填充类走解析判定或扫描线填充，笔画类按"到线段的距离"点亮像素 ——
 * 这正是统计与算子需要的语义（多边形按面积、线按线段）。
 * `width/height` 是所属图像的尺寸，用于把包围盒夹到图像内。
 */
export function roiMask(roi: Roi, width: number, height: number): { bounds: RoiBounds; mask: Uint8Array } | null {
  const raw = roiBounds(roi)
  const x0 = Math.max(0, raw.x), y0 = Math.max(0, raw.y)
  const x1 = Math.min(width, raw.x + raw.width), y1 = Math.min(height, raw.y + raw.height)
  if (x1 <= x0 || y1 <= y0) return null
  const bounds: RoiBounds = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  const mask = new Uint8Array(bounds.width * bounds.height)

  if (roi.kind === 'rectangle') {
    mask.fill(255)
    return { bounds, mask }
  }
  if (roi.kind === 'oval') {
    const rx = roi.width / 2, ry = roi.height / 2
    const cx = roi.x + rx, cy = roi.y + ry
    for (let row = 0; row < bounds.height; row += 1) {
      const dy = (bounds.y + row + 0.5 - cy) / (ry || 1)
      for (let column = 0; column < bounds.width; column += 1) {
        const dx = (bounds.x + column + 0.5 - cx) / (rx || 1)
        if (dx * dx + dy * dy <= 1) mask[row * bounds.width + column] = 255
      }
    }
    return { bounds, mask }
  }
  if (roi.kind === 'polygon' || roi.kind === 'freehand') {
    fillPolygon(roi.points, bounds, mask)
    return { bounds, mask }
  }
  if (roi.kind === 'point') {
    for (let i = 0; i + 1 < roi.points.length; i += 2) {
      const x = Math.floor(roi.points[i]!), y = Math.floor(roi.points[i + 1]!)
      if (x >= x0 && x < x1 && y >= y0 && y < y1) mask[(y - y0) * bounds.width + (x - x0)] = 255
    }
    return { bounds, mask }
  }
  const segments: number[] = roi.kind === 'line'
    ? [roi.x1, roi.y1, roi.x2, roi.y2]
    : roi.kind === 'angle'
      ? roi.points.slice(0, 6)
      : roi.points
  // 角度是 a-b、b-c 两段折线，不闭合（首尾相连会多出一条边）。
  strokeSegments(segments, bounds, mask, false)
  return { bounds, mask }
}

/** 扫描线填充闭合多边形（顶点为图像坐标，像素中心采样）。 */
function fillPolygon(points: readonly number[], bounds: RoiBounds, mask: Uint8Array): void {
  const count = Math.floor(points.length / 2)
  if (count < 3) {
    strokeSegments(points, bounds, mask, false)
    return
  }
  const crossings: number[] = []
  for (let row = 0; row < bounds.height; row += 1) {
    const y = bounds.y + row + 0.5
    crossings.length = 0
    for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
      const xj = points[j * 2]!, yj = points[j * 2 + 1]!
      const xi = points[i * 2]!, yi = points[i * 2 + 1]!
      if ((yi > y) !== (yj > y)) crossings.push(((xj - xi) * (y - yi)) / (yj - yi) + xi)
    }
    if (crossings.length < 2) continue
    crossings.sort((a, b) => a - b)
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(bounds.x, Math.ceil(crossings[k]! - 0.5))
      const to = Math.min(bounds.x + bounds.width - 1, Math.floor(crossings[k + 1]! - 0.5))
      for (let x = from; x <= to; x += 1) mask[row * bounds.width + (x - bounds.x)] = 255
    }
  }
}

/** 按线段列表点亮像素（一像素宽的笔画）。 */
function strokeSegments(points: readonly number[], bounds: RoiBounds, mask: Uint8Array, closed: boolean): void {
  const count = Math.floor(points.length / 2)
  for (let i = 0; i + 3 < count * 2; i += 2) {
    const x1 = points[i]!, y1 = points[i + 1]!
    const x2 = points[i + 2]!, y2 = points[i + 3]!
    strokeSegment(x1, y1, x2, y2, bounds, mask)
  }
  if (closed && count >= 3) strokeSegment(points[(count - 1) * 2]!, points[(count - 1) * 2 + 1]!, points[0]!, points[1]!, bounds, mask)
}

function strokeSegment(x1: number, y1: number, x2: number, y2: number, bounds: RoiBounds, mask: Uint8Array): void {
  // 只遍历该线段包围盒内的像素，避免整幅掩码逐像素判定。
  const minX = Math.max(bounds.x, Math.floor(Math.min(x1, x2) - 1))
  const maxX = Math.min(bounds.x + bounds.width - 1, Math.ceil(Math.max(x1, x2) + 1))
  const minY = Math.max(bounds.y, Math.floor(Math.min(y1, y2) - 1))
  const maxY = Math.min(bounds.y + bounds.height - 1, Math.ceil(Math.max(y1, y2) + 1))
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointNearSegment(x + 0.5, y + 0.5, x1, y1, x2, y2) <= 0.5) mask[(y - bounds.y) * bounds.width + (x - bounds.x)] = 255
    }
  }
}

/** 掩码内命中像素数（= 面积）。 */
export function roiArea(roi: Roi, width: number, height: number): number {
  const raster = roiMask(roi, width, height)
  if (!raster) return 0
  let count = 0
  for (const value of raster.mask) if (value) count += 1
  return count
}

/** 平移整个 ROI（拖拽用）；坐标不取整，保持连续拖拽的精度。 */
export function roiTranslate(roi: Roi, dx: number, dy: number): Roi {
  if (roi.kind === 'rectangle' || roi.kind === 'oval') return { ...roi, x: roi.x + dx, y: roi.y + dy }
  if (roi.kind === 'line') return { ...roi, x1: roi.x1 + dx, y1: roi.y1 + dy, x2: roi.x2 + dx, y2: roi.y2 + dy }
  const points = [...roi.points]
  for (let i = 0; i + 1 < points.length; i += 2) { points[i] = points[i]! + dx; points[i + 1] = points[i + 1]! + dy }
  return { ...roi, points }
}

/** 手柄点（交互用）：填充类给四角 + 四边中点，点序列类给每个顶点。 */
export function roiHandles(roi: Roi): number[] {
  if (roi.kind === 'rectangle' || roi.kind === 'oval') {
    const { x, y, width: w, height: h } = roi
    return [x, y, x + w / 2, y, x + w, y, x + w, y + h / 2, x + w, y + h, x + w / 2, y + h, x, y + h, x, y + h / 2]
  }
  if (roi.kind === 'line') return [roi.x1, roi.y1, roi.x2, roi.y2]
  // 自由手绘的顶点可能有几十上百个，逐个画手柄会糊满画面（ImageJ 也只在 ROI Manager
  // 里编辑它们）；这里不给手柄，仍可整体拖动或用 Clear ROI 清掉。
  if (roi.kind === 'freehand') return []
  return [...roi.points]
}

/** 用新位置替换第 `index` 个手柄（顶点编辑）。 */
export function roiWithHandle(roi: Roi, index: number, x: number, y: number): Roi {
  if (roi.kind === 'line') return index === 0 ? { ...roi, x1: x, y1: y } : { ...roi, x2: x, y2: y }
  if (roi.kind === 'rectangle' || roi.kind === 'oval') return resizeRectRoi(roi, index, x, y)
  const points = [...roi.points]
  if (index * 2 + 1 < points.length) { points[index * 2] = x; points[index * 2 + 1] = y }
  return { ...roi, points }
}

/** 拖四角/四边中点缩放矩形或椭圆，保持对角锚点不动。 */
function resizeRectRoi(roi: RectangleRoi | OvalRoi, index: number, x: number, y: number): RectangleRoi | OvalRoi {
  let left = roi.x, top = roi.y, right = roi.x + roi.width, bottom = roi.y + roi.height
  // 手柄顺序与 roiHandles 一致：0 左上、2 右上、4 右下、6 左下；1/3/5/7 为边中点。
  if (index === 0 || index === 6 || index === 7) left = x
  if (index === 2 || index === 3 || index === 4) right = x
  if (index === 0 || index === 1 || index === 2) top = y
  if (index === 4 || index === 5 || index === 6) bottom = y
  const nx = Math.min(left, right), ny = Math.min(top, bottom)
  const next = { ...roi, x: nx, y: ny, width: Math.max(1, Math.abs(right - left)), height: Math.max(1, Math.abs(bottom - top)) }
  return next
}

/** 顶点数（多边形/折线/手绘/点集用；其余返回 2 或 4）。 */
export function roiVertexCount(roi: Roi): number {
  if (roi.kind === 'rectangle' || roi.kind === 'oval') return 4
  if (roi.kind === 'line') return 2
  return Math.floor(roi.points.length / 2)
}

/** 在最近的一条边上插入顶点（多边形/折线编辑）。 */
export function roiInsertVertex(roi: PointsRoi, x: number, y: number): PointsRoi {
  const count = Math.floor(roi.points.length / 2)
  if (count < 2) return { ...roi, points: [...roi.points, x, y] }
  let bestIndex = 0, bestDistance = Infinity
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count
    const distance = pointNearSegment(x, y, roi.points[i * 2]!, roi.points[i * 2 + 1]!, roi.points[j * 2]!, roi.points[j * 2 + 1]!)
    if (distance < bestDistance) { bestDistance = distance; bestIndex = i }
  }
  const points = [...roi.points]
  points.splice((bestIndex + 1) * 2, 0, x, y)
  return { ...roi, points }
}

/** 删除顶点（至少保留 2 个，否则返回 null 表示该 ROI 应被丢弃）。 */
export function roiRemoveVertex(roi: PointsRoi, index: number): PointsRoi | null {
  const points = [...roi.points]
  points.splice(index * 2, 2)
  if (points.length < 4) return null
  return { ...roi, points }
}

/** 把 ROI 夹到图像范围内（越界拖拽用）。 */
export function clampRoi(roi: Roi, width: number, height: number): Roi {
  const bounds = roiBounds(roi)
  let dx = 0, dy = 0
  if (bounds.x < 0) dx = -bounds.x
  if (bounds.y < 0) dy = -bounds.y
  if (bounds.x + bounds.width > width) dx = Math.min(dx, width - (bounds.x + bounds.width))
  if (bounds.y + bounds.height > height) dy = Math.min(dy, height - (bounds.y + bounds.height))
  return dx || dy ? roiTranslate(roi, dx, dy) : roi
}

/** ROI 的简短描述（状态栏显示）。 */
export function describeRoi(roi: Roi, area: number): string {
  const bounds = roiBounds(roi)
  const geometry = `${bounds.width}×${bounds.height} @ (${bounds.x}, ${bounds.y})`
  if (roiIsStroke(roi)) return `${roi.kind} · ${geometry}`
  return `${roi.kind} · ${geometry} · ${area} px`
}

/**
 * SVG path 的 `d`（视口坐标）。
 *
 * 与 `rasterizeViewport` 共用同一套相机换算（`pan + 图像坐标 × zoom`），
 * 因此叠加层与画布里的像素天然对齐，不会出现选区偏半个像素的问题。
 * 填充与描边由调用方按 `roiIsFilled` 决定。
 */
export function roiPathData(roi: Roi, panX: number, panY: number, zoom: number): string {
  const x = (value: number) => panX + value * zoom
  const y = (value: number) => panY + value * zoom
  const round = (value: number) => Math.round(value * 100) / 100

  if (roi.kind === 'rectangle') {
    const left = x(roi.x), top = y(roi.y), right = x(roi.x + roi.width), bottom = y(roi.y + roi.height)
    return `M ${round(left)} ${round(top)} H ${round(right)} V ${round(bottom)} H ${round(left)} Z`
  }
  if (roi.kind === 'oval') {
    // 用两段圆弧拼椭圆：中心 + 两个半径，避免采样折线在放大时出现棱角。
    const cx = x(roi.x + roi.width / 2), cy = y(roi.y + roi.height / 2)
    const rx = Math.abs(roi.width * zoom) / 2, ry = Math.abs(roi.height * zoom) / 2
    return `M ${round(cx - rx)} ${round(cy)} A ${round(rx)} ${round(ry)} 0 1 0 ${round(cx + rx)} ${round(cy)} A ${round(rx)} ${round(ry)} 0 1 0 ${round(cx - rx)} ${round(cy)} Z`
  }
  if (roi.kind === 'line') return `M ${round(x(roi.x1))} ${round(y(roi.y1))} L ${round(x(roi.x2))} ${round(y(roi.y2))}`
  if (roi.kind === 'point') {
    // 每个点画成一个小方块（与 ImageJ 的点标记一致），彼此独立不连线。
    const size = 2.5
    const parts: string[] = []
    for (let i = 0; i + 1 < roi.points.length; i += 2) {
      const px = x(roi.points[i]! + 0.5), py = y(roi.points[i + 1]! + 0.5)
      parts.push(`M ${round(px - size)} ${round(py - size)} h ${size * 2} v ${size * 2} h ${-size * 2} Z`)
    }
    return parts.join(' ')
  }
  const points = roi.kind === 'angle' ? roi.points.slice(0, 6) : roi.points
  if (points.length < 4) return ''
  const parts: string[] = [`M ${round(x(points[0]!))} ${round(y(points[1]!))}`]
  for (let i = 2; i + 1 < points.length; i += 2) parts.push(`L ${round(x(points[i]!))} ${round(y(points[i + 1]!))}`)
  if (roi.kind === 'polygon' || roi.kind === 'freehand') parts.push('Z')
  return parts.join(' ')
}

/** 构造中的预览几何（拖拽/多步工具），与已提交的 ROI 用同一套渲染。 */
export function previewRoi(kind: RoiKind, points: readonly number[], arrow = false): Roi | null {
  if (kind === 'rectangle' && points.length >= 4) return rectangleFromCorners(points[0]!, points[1]!, points[2]!, points[3]!)
  if (kind === 'oval' && points.length >= 4) return ovalFromCorners(points[0]!, points[1]!, points[2]!, points[3]!)
  if (kind === 'line' && points.length >= 4) return lineRoi(points[0]!, points[1]!, points[2]!, points[3]!, arrow)
  if (kind === 'freehand' || kind === 'polygon' || kind === 'polyline' || kind === 'point' || kind === 'angle') {
    if (points.length < 2) return null
    return pointsRoi(kind, points)
  }
  return null
}
