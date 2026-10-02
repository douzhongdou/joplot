import type { ImageBlock } from './types.ts'
import type { Rect } from '../lib/processor.ts'

export interface ImageAnalysis {
  count: number; area: number; mean: number; min: number; max: number; stdDev: number
  histogram: Uint32Array; histogramMin: number; histogramMax: number; profile: number[]
}

export function profileBlock(block: ImageBlock, roi: Rect | null = null): number[] {
  const width = block.shape[block.axes.indexOf('x')]!, height = block.shape[block.axes.indexOf('y')]!, pixels = width * height
  const ci = block.axes.indexOf('c'), rgb = ci >= 0 && block.shape[ci] === 3
  const x0 = Math.max(0, Math.floor(roi?.x ?? 0)), x1 = Math.min(width, x0 + (roi?.width ?? width))
  const y = Math.max(0, Math.min(height - 1, Math.floor((roi?.y ?? 0) + (roi?.height ?? height) / 2)))
  const profile = []
  for (let x = x0; x < x1; x++) {
    const i = y * width + x
    profile.push(rgb ? Math.round((block.data[i]! + block.data[pixels + i]! + block.data[2 * pixels + i]!) / 3) : block.data[i]!)
  }
  return profile
}

/** 在原始精度上测量，RGB 使用与 Classic 一致的等权灰度；忽略非有限值。 */
export function analyzeBlock(block: ImageBlock, roi: Rect | null = null): ImageAnalysis {
  const width = block.shape[block.axes.indexOf('x')]!, height = block.shape[block.axes.indexOf('y')]!
  const pixels = width * height, c = block.axes.indexOf('c')
  const rgb = c >= 0 && block.shape[c] === 3
  const at = (index: number) => rgb ? Math.round((block.data[index]! + block.data[pixels + index]! + block.data[2 * pixels + index]!) / 3) : block.data[index]!
  const x0 = Math.max(0, Math.floor(roi?.x ?? 0)), y0 = Math.max(0, Math.floor(roi?.y ?? 0))
  const x1 = Math.min(width, x0 + (roi?.width ?? width)), y1 = Math.min(height, y0 + (roi?.height ?? height))
  let count = 0, mean = 0, m2 = 0, min = Infinity, max = -Infinity
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const value = at(y * width + x)
    if (!Number.isFinite(value)) continue
    count++
    const delta = value - mean; mean += delta / count; m2 += delta * (value - mean)
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!count) { min = 0; max = 0 }
  const histogramMin = block.dtype === 'float32' ? min : block.dtype === 'int16' ? -32768 : 0
  const histogramMax = block.dtype === 'float32' ? max : block.dtype === 'uint8' ? 255 : block.dtype === 'int16' ? 32767 : 65535
  const histogram = new Uint32Array(256), range = histogramMax - histogramMin || 1
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const value = at(y * width + x)
    if (Number.isFinite(value)) histogram[Math.max(0, Math.min(255, Math.floor((value - histogramMin) * 255 / range)))]!++
  }
  const profile = profileBlock(block, roi)
  return { count, area: count, mean, min, max, stdDev: count > 1 ? Math.sqrt(m2 / (count - 1)) : 0, histogram, histogramMin, histogramMax, profile }
}
