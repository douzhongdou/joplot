import type { ImageBlock } from './types.ts'
import { clampRect, toRoi, type RoiInput } from '../lib/processor.ts'
import { isRoi, roiBounds, roiMask, type Roi } from '../lib/roi.ts'

export interface ImageAnalysis {
  count: number; area: number; mean: number; min: number; max: number; stdDev: number
  histogram: Uint32Array; histogramMin: number; histogramMax: number; profile: number[]
}

/** `clampRect` 只需要 width/height；这里避免为遍历分配像素缓冲。 */
const SIZE_ONLY = { width: 0, height: 0, data: new Uint8Array(0) }

/** 图像某点的等权灰度（RGB 与 Classic 口径一致）。 */
function grayAt(block: ImageBlock, index: number, pixels: number, rgb: boolean): number {
  return rgb ? Math.round((block.data[index]! + block.data[pixels + index]! + block.data[2 * pixels + index]!) / 3) : block.data[index]!
}

/**
 * 遍历 ROI 内的像素索引。
 *
 * 整图与矩形走紧凑循环（不生成掩码），其余形状按掩码跳过 ROI 外像素 ——
 * 因此椭圆不会统计到四角、多边形不会统计到凹口，线只统计笔画覆盖的像素。
 * 这正是把矩形升级成 ROI 的意义：统计口径必须与选区形状一致。
 */
function forEachRoiIndex(input: RoiInput | null, width: number, height: number, visit: (index: number) => void): void {
  if (!input) {
    const total = width * height
    for (let index = 0; index < total; index += 1) visit(index)
    return
  }
  const roi = toRoi(input)
  if (roi.kind === 'rectangle') {
    const bounds = clampRect(roi, { ...SIZE_ONLY, width, height })
    if (!bounds) return
    for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
      const rowStart = y * width
      for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) visit(rowStart + x)
    }
    return
  }
  const raster = roiMask(roi, width, height)
  if (!raster) return
  const { bounds, mask } = raster
  for (let row = 0; row < bounds.height; row += 1) {
    const rowStart = (bounds.y + row) * width + bounds.x
    const maskRowStart = row * bounds.width
    for (let column = 0; column < bounds.width; column += 1) {
      if (mask[maskRowStart + column]) visit(rowStart + column)
    }
  }
}

/** 沿折线按约 1 像素步长采样（线 / 折线 / 角度 ROI 的真实剖面）。 */
function samplePolyline(block: ImageBlock, points: readonly number[], closed = false): number[] {
  const width = block.shape[block.axes.indexOf('x')]!, height = block.shape[block.axes.indexOf('y')]!, pixels = width * height
  const ci = block.axes.indexOf('c'), rgb = ci >= 0 && block.shape[ci] === 3
  const out: number[] = []
  const count = Math.floor(points.length / 2)
  if (count < 2) return out
  const segmentCount = closed ? count : count - 1
  for (let i = 0; i < segmentCount; i += 1) {
    const j = (i + 1) % count
    const x1 = points[i * 2]!, y1 = points[i * 2 + 1]!
    const x2 = points[j * 2]!, y2 = points[j * 2 + 1]!
    const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1)))
    // 首段从 0 开始、其余段从 1 开始，避免折点被采样两次。
    for (let step = i === 0 ? 0 : 1; step <= steps; step += 1) {
      const t = step / steps
      const x = Math.max(0, Math.min(width - 1, Math.round(x1 + (x2 - x1) * t)))
      const y = Math.max(0, Math.min(height - 1, Math.round(y1 + (y2 - y1) * t)))
      out.push(grayAt(block, y * width + x, pixels, rgb))
    }
  }
  return out
}

/**
 * 剖面。
 *
 * 线 / 折线 / 角度 ROI 给的是**沿线采样**（ImageJ 的 Plot Profile 语义）；
 * 其余情况保持既有口径：取包围盒中心行逐像素（不改成列均值，以免改变现有结果与测试口径）。
 */
export function profileBlock(block: ImageBlock, input: RoiInput | null = null): number[] {
  const width = block.shape[block.axes.indexOf('x')]!, height = block.shape[block.axes.indexOf('y')]!, pixels = width * height
  const ci = block.axes.indexOf('c'), rgb = ci >= 0 && block.shape[ci] === 3

  if (input && isRoi(input)) {
    const roi: Roi = input
    if (roi.kind === 'line') return samplePolyline(block, [roi.x1, roi.y1, roi.x2, roi.y2])
    if (roi.kind === 'polyline') return samplePolyline(block, roi.points)
    if (roi.kind === 'angle') return samplePolyline(block, roi.points.slice(0, 6))
  }

  const bounds = input ? clampRect(isRoi(input) ? roiBounds(input) : input, { ...SIZE_ONLY, width, height }) : null
  const x0 = bounds?.x ?? 0, x1 = bounds ? bounds.x + bounds.width : width
  const y = Math.max(0, Math.min(height - 1, bounds ? bounds.y + Math.floor(bounds.height / 2) : Math.floor(height / 2)))
  const profile = []
  for (let x = x0; x < x1; x++) profile.push(grayAt(block, y * width + x, pixels, rgb))
  return profile
}

/** 在原始精度上测量，RGB 使用与 Classic 一致的等权灰度；忽略非有限值。
 *  `withProfile=false` 用于调用方会自行计算剖面的场景（例如分析 Worker），避免多走一趟。 */
export function analyzeBlock(block: ImageBlock, input: RoiInput | null = null, withProfile = true): ImageAnalysis {
  const width = block.shape[block.axes.indexOf('x')]!, height = block.shape[block.axes.indexOf('y')]!
  const pixels = width * height, c = block.axes.indexOf('c')
  const rgb = c >= 0 && block.shape[c] === 3
  const at = (index: number) => grayAt(block, index, pixels, rgb)
  let count = 0, mean = 0, m2 = 0, min = Infinity, max = -Infinity
  const histogram = new Uint32Array(256)
  // 非浮点的直方图值域固定，可在一遍遍历里同时累加；浮点需先得到 min/max 再建桶。
  const fixedRange = block.dtype !== 'float32'
  const fixedMin = block.dtype === 'int16' ? -32768 : 0
  const fixedMax = block.dtype === 'uint8' ? 255 : block.dtype === 'int16' ? 32767 : 65535
  const fixedScale = 255 / ((fixedMax - fixedMin) || 1)
  forEachRoiIndex(input, width, height, (index) => {
    const value = at(index)
    if (!Number.isFinite(value)) return
    count++
    const delta = value - mean; mean += delta / count; m2 += delta * (value - mean)
    if (value < min) min = value
    if (value > max) max = value
    if (fixedRange) histogram[Math.max(0, Math.min(255, Math.floor((value - fixedMin) * fixedScale)))]!++
  })
  if (!count) { min = 0; max = 0 }
  let histogramMin = fixedMin, histogramMax = fixedMax
  if (!fixedRange) {
    histogramMin = min; histogramMax = max
    const scale = 255 / ((histogramMax - histogramMin) || 1)
    forEachRoiIndex(input, width, height, (index) => {
      const value = at(index)
      if (Number.isFinite(value)) histogram[Math.max(0, Math.min(255, Math.floor((value - histogramMin) * scale)))]!++
    })
  }
  const profile = withProfile ? profileBlock(block, input) : []
  return { count, area: count, mean, min, max, stdDev: count > 1 ? Math.sqrt(m2 / (count - 1)) : 0, histogram, histogramMin, histogramMax, profile }
}
