/**
 * 显示映射：把任意 dtype 的像素块映射为 RGBA，供 Canvas / PNG 导出使用。
 * 最近邻语义：每个像素独立映射，不混合邻域。
 */
import type { ImageBlock } from '../types.ts'

export interface DisplayWindowLevel {
  window: number
  level: number
}

/** 由块的极值计算窗口/层位；常量块给一个最小窗口避免除零。 */
export function computeWindowLevel(block: ImageBlock): DisplayWindowLevel {
  const values = block.data as unknown as { readonly length: number; readonly [index: number]: number }
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]!
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { window: 1, level: Number.isFinite(min) ? min : 0 }
  }
  return { window: max - min, level: (max + min) / 2 }
}

/** 把像素块映射为 8 位 RGBA（不透明）。三通道输入按 RGB 直接输出。 */
export function blockToRgba(block: ImageBlock, settings: DisplayWindowLevel): Uint8ClampedArray<ArrayBuffer> {
  const values = block.data as unknown as { readonly length: number; readonly [index: number]: number }
  const width = block.shape[block.axes.indexOf('x')] ?? 0
  const height = block.shape[block.axes.indexOf('y')] ?? 0
  const c = block.axes.indexOf('c')
  const components = c >= 0 ? (block.shape[c] ?? 1) : 1
  const pixels = width * height
  const out = new Uint8ClampedArray(new ArrayBuffer(pixels * 4))
  if (components === 3) {
    for (let i = 0; i < pixels; i += 1) {
      out[i * 4] = clamp8(values[i]!)
      out[i * 4 + 1] = clamp8(values[pixels + i]!)
      out[i * 4 + 2] = clamp8(values[2 * pixels + i]!)
      out[i * 4 + 3] = 255
    }
    return out
  }
  const lo = settings.level - settings.window / 2
  const scale = settings.window === 0 ? 0 : 255 / settings.window
  for (let i = 0; i < pixels; i += 1) {
    const mapped = Math.max(0, Math.min(255, Math.round((values[i]! - lo) * scale)))
    out[i * 4] = mapped
    out[i * 4 + 1] = mapped
    out[i * 4 + 2] = mapped
    out[i * 4 + 3] = 255
  }
  return out
}

function clamp8(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value)
}
