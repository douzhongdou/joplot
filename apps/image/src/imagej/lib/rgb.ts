/**
 * RGB（彩色）图像的几何/亮度操作。
 *
 * 灰度算法都在 processor.ts 里；这里只提供彩色对应的同名操作，
 * 让几何与显示类步骤对彩色图同样可用（不会被强行转灰度）。
 */

import { ImagejError, type Rect } from './processor.ts'

export interface RgbImage {
  kind: 'rgb'
  width: number
  height: number
  data: Uint8ClampedArray
}

function assertRgb(image: RgbImage): void {
  if (image.width <= 0 || image.height <= 0 || image.data.length !== image.width * image.height * 4) {
    throw new ImagejError('invalid-size', 'RGB 图像尺寸与数据不匹配')
  }
}

export function cloneRgb(image: RgbImage): RgbImage {
  return { kind: 'rgb', width: image.width, height: image.height, data: image.data.slice() }
}

export function clampRgbRect(rect: Rect, image: RgbImage): Rect | null {
  if (![rect.x, rect.y, rect.width, rect.height].every((value) => Number.isFinite(value))) {
    return null
  }
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(image.width, Math.ceil(rect.x + rect.width))
  const y1 = Math.min(image.height, Math.ceil(rect.y + rect.height))
  if (x1 <= x0 || y1 <= y0) {
    return null
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function invertRgb(image: RgbImage): RgbImage {
  assertRgb(image)
  const out = image.data.slice()
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255 - out[i]
    out[i + 1] = 255 - out[i + 1]
    out[i + 2] = 255 - out[i + 2]
  }
  return { kind: 'rgb', width: image.width, height: image.height, data: out }
}

export function cropRgb(image: RgbImage, rect: Rect): RgbImage {
  assertRgb(image)
  const roi = clampRgbRect(rect, image)
  if (!roi) {
    throw new ImagejError('empty-roi', '裁剪区域与图像没有交集')
  }
  const out = new Uint8ClampedArray(roi.width * roi.height * 4)
  for (let row = 0; row < roi.height; row += 1) {
    const from = ((roi.y + row) * image.width + roi.x) * 4
    out.set(image.data.subarray(from, from + roi.width * 4), row * roi.width * 4)
  }
  return { kind: 'rgb', width: roi.width, height: roi.height, data: out }
}

export function flipRgbHorizontal(image: RgbImage): RgbImage {
  assertRgb(image)
  const { width, height } = image
  const out = new Uint8ClampedArray(image.data.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4
      const to = (y * width + (width - 1 - x)) * 4
      out[to] = image.data[from]
      out[to + 1] = image.data[from + 1]
      out[to + 2] = image.data[from + 2]
      out[to + 3] = image.data[from + 3]
    }
  }
  return { kind: 'rgb', width, height, data: out }
}

export function flipRgbVertical(image: RgbImage): RgbImage {
  assertRgb(image)
  const { width, height } = image
  const out = new Uint8ClampedArray(image.data.length)
  for (let y = 0; y < height; y += 1) {
    const from = y * width * 4
    const to = (height - 1 - y) * width * 4
    out.set(image.data.subarray(from, from + width * 4), to)
  }
  return { kind: 'rgb', width, height, data: out }
}

export function rotateRgb90(image: RgbImage, direction: 'cw' | 'ccw'): RgbImage {
  assertRgb(image)
  const { width, height } = image
  const out = new Uint8ClampedArray(image.data.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4
      const target = direction === 'cw'
        ? (x * height + (height - 1 - y)) * 4
        : ((width - 1 - x) * height + y) * 4
      out[target] = image.data[from]
      out[target + 1] = image.data[from + 1]
      out[target + 2] = image.data[from + 2]
      out[target + 3] = image.data[from + 3]
    }
  }
  return { kind: 'rgb', width: height, height: width, data: out }
}

/** 亮度/对比度重映射（与灰度版本同一公式，逐通道应用）。 */
export function levelsRgb(image: RgbImage, min: number, max: number): RgbImage {
  assertRgb(image)
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    throw new ImagejError('invalid-value', `显示范围非法：[${min}, ${max}]`)
  }
  const scale = 255 / (max - min)
  const out = image.data.slice()
  for (let i = 0; i < out.length; i += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = Math.round((out[i + channel] - min) * scale)
      out[i + channel] = value < 0 ? 0 : value > 255 ? 255 : value
    }
  }
  return { kind: 'rgb', width: image.width, height: image.height, data: out }
}
