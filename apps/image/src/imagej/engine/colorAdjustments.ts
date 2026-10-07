import type { ImageBlock } from './types.ts'
import { allocateBuffer } from './types.ts'
import type { Rect } from '../lib/processor.ts'

export type ColorChannel = 'all' | 'red' | 'green' | 'blue'
export interface ColorAdjustment { min: number; max: number; channel: ColorChannel; roi?: Rect }
export interface ContrastRange { min: number; max: number }
const CHANNEL_INDEX = { all: -1, red: 0, green: 1, blue: 2 } as const

/** ImageJ ContrastAdjuster: RGB sliders use 256 positions; brightness moves the center. */
export function adjustContrastRange(range: ContrastRange, control: 'minimum' | 'maximum' | 'brightness' | 'contrast', value: number, defaultMin = 0, defaultMax = 255): ContrastRange {
  const extent = defaultMax - defaultMin
  if (control === 'minimum') { const min = defaultMin + value * extent / 255; return { min, max: Math.max(min, Math.min(defaultMax, range.max)) } }
  if (control === 'maximum') { const max = defaultMin + value * extent / 255; return { min: Math.min(max, Math.max(defaultMin, range.min)), max } }
  if (control === 'brightness') { const center = defaultMin + extent * (256 - value) / 256, half = (range.max - range.min) / 2; return { min: center - half, max: center + half } }
  const slope = value <= 128 ? value / 128 : 128 / (256 - value)
  if (slope <= 0) return range
  const center = (range.min + range.max) / 2, half = extent / (2 * slope)
  return { min: center - half, max: center + half }
}

export function contrastSliderValues(range: ContrastRange, defaultMin = 0, defaultMax = 255) {
  const extent = defaultMax - defaultMin, width = range.max - range.min
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.trunc(value)))
  const contrast = width < extent ? 256 - width * 128 / extent : extent * 128 / width
  return { minimum: clamp((range.min - defaultMin) * 255 / extent), maximum: clamp((range.max - defaultMin) * 255 / extent), brightness: clamp((1 - ((range.min + range.max) / 2 - defaultMin) / extent) * 256), contrast: clamp(contrast) }
}

/** ColorProcessor.setMinAndMax: truncate minimum, multiply by 256, truncate LUT values. */
export function imagejColorValue(value: number, min: number, max: number, ceiling = 255): number {
  if (!Number.isFinite(value)) return 0
  const mapped = (ceiling + 1) * (value - Math.trunc(min)) / (max - min)
  if (Number.isNaN(mapped)) return 0 // Java converts NaN to int zero.
  return Math.max(0, Math.min(ceiling, Math.trunc(mapped)))
}

export function adjustedColorValue(value: number, channel: number, x: number, y: number, adjustments: readonly ColorAdjustment[], ceiling = 255): number {
  for (const setting of adjustments) {
    const selected = setting.channel === 'all' || channel === CHANNEL_INDEX[setting.channel]
    const rect = setting.roi
    if (selected && (!rect || (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height))) value = imagejColorValue(value, setting.min, setting.max, ceiling)
  }
  return value
}

export function applyColorAdjustments(block: ImageBlock, adjustments: readonly ColorAdjustment[]): ImageBlock {
  const channels = block.shape[block.axes.indexOf('c')] ?? 1
  if (channels !== 3 && channels !== 1) throw new RangeError('Display range adjustment supports grayscale or RGB')
  if (adjustments.some((setting) => !Number.isFinite(setting.min) || !Number.isFinite(setting.max) || setting.max < setting.min || !['all', 'red', 'green', 'blue'].includes(setting.channel))) throw new RangeError('Invalid RGB display range or channel')
  const width = block.shape[block.axes.indexOf('x')]!, height = block.shape[block.axes.indexOf('y')]!, pixels = width * height
  const data = allocateBuffer(block.dtype, block.data.length), ceiling = block.dtype === 'uint16' ? 65535 : 255
  if (channels === 1) {
    // 灰度：`all` 的显示范围直接作用在这一个通道上（ImageJ 的 B&C 对灰度就是这样）。
    for (let i = 0; i < pixels; i++) data[i] = adjustedColorValue(block.data[i]!, 0, i % width, Math.floor(i / width), adjustments, ceiling)
    return { ...block, data }
  }
  for (let channel = 0; channel < 3; channel++) for (let i = 0; i < pixels; i++) data[channel * pixels + i] = adjustedColorValue(block.data[channel * pixels + i]!, channel, i % width, Math.floor(i / width), adjustments, ceiling)
  return { ...block, data }
}

/** Color Balance histograms show the selected component; All shows equal-weight intensity. */
export function colorHistogramBlock(block: ImageBlock, channel: ColorChannel, adjustments: readonly ColorAdjustment[]): ImageBlock {
  const width = block.shape[block.axes.indexOf('x')]!, height = block.shape[block.axes.indexOf('y')]!, pixels = width * height
  const data = allocateBuffer(block.dtype, pixels), selected = CHANNEL_INDEX[channel], ceiling = block.dtype === 'uint16' ? 65535 : 255
  for (let i = 0; i < pixels; i++) {
    const at = (c: number) => adjustedColorValue(block.data[c * pixels + i]!, c, i % width, Math.floor(i / width), adjustments, ceiling)
    data[i] = selected >= 0 ? at(selected) : Math.round((at(0) + at(1) + at(2)) / 3)
  }
  return { dtype: block.dtype, axes: ['y', 'x'], shape: [height, width], region: { start: [0, 0], shape: [height, width] }, data }
}

/** ContrastAdjuster Auto ignores histogram bins containing >10% of pixels and repeats more aggressively. */
export function imagejAutoRange(histogram: Uint32Array, count: number, min: number, max: number, previousThreshold = 0, histogramMin = 0, histogramMax = 255) {
  const autoThreshold = previousThreshold < 10 ? 5000 : Math.floor(previousThreshold / 2)
  const threshold = Math.floor(count / autoThreshold), limit = Math.floor(count / 10)
  const qualifies = (i: number) => histogram[i]! <= limit && histogram[i]! > threshold
  let first = 0, last = 255
  while (first < 255 && !qualifies(first)) first++
  while (last > 0 && !qualifies(last)) last--
  if (last < first) return { min: histogramMin, max: histogramMax, autoThreshold: 0 }
  const binSize = (histogramMax - histogramMin + 1) / 256
  const lo = histogramMin + first * binSize, hi = histogramMin + last * binSize
  return { min: lo === hi ? min : lo, max: lo === hi ? max : hi, autoThreshold }
}
