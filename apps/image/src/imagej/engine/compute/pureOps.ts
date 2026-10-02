/**
 * 纯 TypeScript 计算后端（参考实现与 WASM 缺失时的回退）。
 *
 * 处理二维块（axes 末尾为 y、x）；邻域算子的 RGB 通道由外层独立执行。8 位单通道数据委托给既有 ImageJ 迁移内核，
 * 以获得逐像素一致的行为；16 位 / 浮点走通用路径。堆栈与通道由引擎在外层迭代。
 *
 * 主工作台通过计算 Worker 执行这些内核；高斯使用行缓存，其他内核仍保留整帧输出。
 * ITK-Wasm 目前提供 I/O 与管道适配接口，尚未为这些算子配置编译后的 ITK 管道。
 */
import {
  applyLevels,
  flipHorizontal,
  flipVertical,
  invert as invertGray,
  levelsRange,
  mean3x3 as libMean3x3,
  median3x3 as libMedian3x3,
  minimum3x3 as libMinimum3x3,
  maximum3x3 as libMaximum3x3,
  otsuThreshold,
  rotate90,
  sharpen3x3 as libSharpen3x3,
  sobelEdges,
  type GrayImage,
  type Rect,
} from '../../lib/processor.ts'
import { analyzeParticles, closeBinary, dilate as libDilate, erode as libErode, fillHoles as libFillHoles, openBinary } from '../../lib/binary.ts'
import { gaussianBlur as libGaussian } from '../../lib/filters.ts'
import { gaussianInto } from '../../lib/gaussian.ts'
import { computeWindowLevel } from '../render/rgba.ts'
import { allocateBuffer, elementCount, type ImageBlock, type PixelArray, type Region } from '../types.ts'

/** 计算错误：算子不支持、尺寸非法等。 */
export class ComputeError extends Error {
  readonly code: 'unsupported' | 'invalid-input' | 'too-large' | 'global-op'
  constructor(code: ComputeError['code'], message: string) {
    super(message)
    this.name = 'ComputeError'
    this.code = code
  }
}

/** 对任意 TypedArray 的统一数字索引视图，便于跨 dtype 读写。 */
interface NumberArray {
  readonly length: number
  [index: number]: number
}

function numbers(view: PixelArray): NumberArray {
  return view as unknown as NumberArray
}

function plane2d(block: ImageBlock): { width: number; height: number } {
  const axes = block.axes
  const y = axes.indexOf('y')
  const x = axes.indexOf('x')
  if (x !== axes.length - 1 || y !== axes.length - 2) {
    throw new ComputeError('unsupported', '纯 TS 后端只处理末尾为 y、x 的二维块')
  }
  if (block.shape.length !== axes.length) throw new ComputeError('invalid-input', 'shape 与 axes 不一致')
  const width = block.shape[x]!
  const height = block.shape[y]!
  if (elementCount(block.shape) !== block.data.length) {
    throw new ComputeError('invalid-input', '块元素数与 shape 不一致')
  }
  return { width, height }
}

function dtypeMin(dtype: ImageBlock['dtype']): number {
  return dtype === 'float32' ? Number.NEGATIVE_INFINITY : dtype === 'int16' ? -32768 : 0
}

function dtypeMax(dtype: ImageBlock['dtype']): number {
  switch (dtype) {
    case 'uint8': return 255
    case 'uint16': return 65535
    case 'int16': return 32767
    case 'float32': return Number.POSITIVE_INFINITY
  }
}

function clampValue(dtype: ImageBlock['dtype'], value: number): number {
  if (dtype === 'float32') return value
  if (!Number.isFinite(value)) return value > 0 ? dtypeMax(dtype) : dtypeMin(dtype)
  const rounded = Math.round(value)
  const min = dtypeMin(dtype)
  const max = dtypeMax(dtype)
  return rounded < min ? min : rounded > max ? max : rounded
}

function newBlockLike(block: ImageBlock, dtype: ImageBlock['dtype'] = block.dtype): ImageBlock {
  const count = elementCount(block.shape)
  return { dtype, axes: block.axes, shape: block.shape, region: block.region, data: allocateBuffer(dtype, count) }
}

function toGray(block: ImageBlock): GrayImage {
  plane2d(block)
  if (block.dtype !== 'uint8') throw new ComputeError('unsupported', '该算子 8 位委托路径要求 uint8')
  return { width: block.shape[block.axes.indexOf('x')]!, height: block.shape[block.axes.indexOf('y')]!, data: block.data as Uint8Array }
}

function fromGray(image: GrayImage, region: Region, axes: ImageBlock['axes']): ImageBlock {
  // 单帧仍可能带 c/z/t 的单例轴，不能只返回 [y, x] 造成 axes 与 shape 错位。
  const shape = axes.map((axis) => axis === 'x' ? image.width : axis === 'y' ? image.height : 1)
  return { dtype: 'uint8', axes, shape, region, data: image.data }
}

/* ------------------------------------------------------------------ *
 * 逐像素算子
 * ------------------------------------------------------------------ */

export function invert(block: ImageBlock): ImageBlock {
  const ci = block.axes.indexOf('c')
  if (block.dtype === 'uint8' && (ci < 0 || block.shape[ci] === 1)) return fromGray(invertGray(toGray(block)), block.region, block.axes)
  const out = newBlockLike(block)
  const src = numbers(block.data)
  const dst = numbers(out.data)
  const sum = block.dtype === 'float32' ? computeWindowLevel(block).level * 2 : dtypeMin(block.dtype) + dtypeMax(block.dtype)
  for (let i = 0; i < src.length; i += 1) dst[i] = clampValue(block.dtype, sum - src[i]!)
  return out
}

export function levels(block: ImageBlock, brightness: number, contrast: number): ImageBlock {
  if (block.dtype === 'uint8') {
    const range = levelsRange(brightness, contrast)
    const ci = block.axes.indexOf('c')
    if (ci < 0 || block.shape[ci] === 1) return fromGray(applyLevels(toGray(block), range.min, range.max), block.region, block.axes)
    const out = newBlockLike(block), scale = 255 / (range.max - range.min)
    for (let i = 0; i < block.data.length; i++) out.data[i] = clampValue(block.dtype, (block.data[i]! - range.min) * scale)
    return out
  }
  const out = newBlockLike(block)
  const src = numbers(block.data)
  const dst = numbers(out.data)
  const window = computeWindowLevel(block), range = levelsRange(brightness, contrast)
  const min = window.level - window.window / 2, max = min + window.window
  const lo = min + window.window * range.min / 255
  const span = window.window * (range.max - range.min) / 255
  for (let i = 0; i < src.length; i += 1) {
    dst[i] = clampValue(block.dtype, ((src[i]! - lo) / span) * (max - min) + min)
  }
  return out
}

export function threshold(block: ImageBlock, level: number): ImageBlock {
  const out = newBlockLike(block, 'uint8')
  const src = numbers(block.data)
  const dst = numbers(out.data)
  for (let i = 0; i < src.length; i += 1) dst[i] = Number.isFinite(src[i]) && src[i]! > level ? 255 : 0
  return out
}

export function otsu(block: ImageBlock): ImageBlock {
  const histogram = new Uint32Array(256)
  const src = numbers(block.data)
  let minValue = Number.POSITIVE_INFINITY
  let maxValue = Number.NEGATIVE_INFINITY
  for (let i = 0; i < src.length; i += 1) {
    const value = src[i]!
    if (!Number.isFinite(value)) continue
    if (value < minValue) minValue = value
    if (value > maxValue) maxValue = value
  }
  const span = maxValue - minValue || 1
  for (let i = 0; i < src.length; i += 1) {
    if (!Number.isFinite(src[i])) continue
    const bin = Math.max(0, Math.min(255, Math.round(((src[i]! - minValue) / span) * 255)))
    histogram[bin] = (histogram[bin] ?? 0) + 1
  }
  const thresholdBin = otsuThreshold(histogram)
  const level = minValue + (thresholdBin / 255) * span
  return threshold(block, level)
}

/* ------------------------------------------------------------------ *
 * 邻域算子（3×3）
 * ------------------------------------------------------------------ */

function generic3x3(block: ImageBlock, reduce: (values: number[]) => number): ImageBlock {
  const { width, height } = plane2d(block)
  const out = newBlockLike(block)
  const src = numbers(block.data)
  const dst = numbers(out.data)
  const values = new Array<number>(9)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let k = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = Math.min(height - 1, Math.max(0, y + dy)) * width
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = Math.min(width - 1, Math.max(0, x + dx))
          values[k++] = src[ny + nx]!
        }
      }
      dst[y * width + x] = clampValue(block.dtype, reduce(values))
    }
  }
  return out
}

function mean(values: number[]): number {
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  return values[(values.length - 1) >> 1]!
}

export function mean3x3(block: ImageBlock): ImageBlock {
  if (block.dtype === 'uint8') return fromGray(libMean3x3(toGray(block)), block.region, block.axes)
  return generic3x3(block, mean)
}

export function median3x3(block: ImageBlock): ImageBlock {
  if (block.dtype === 'uint8') return fromGray(libMedian3x3(toGray(block)), block.region, block.axes)
  return generic3x3(block, median)
}

export function minimum3x3(block: ImageBlock): ImageBlock {
  if (block.dtype === 'uint8') return fromGray(libMinimum3x3(toGray(block)), block.region, block.axes)
  return generic3x3(block, (values) => Math.min(...values))
}

export function maximum3x3(block: ImageBlock): ImageBlock {
  if (block.dtype === 'uint8') return fromGray(libMaximum3x3(toGray(block)), block.region, block.axes)
  return generic3x3(block, (values) => Math.max(...values))
}

const SHARPEN_KERNEL = [-1, -1, -1, -1, 12, -1, -1, -1, -1] as const

export function sharpen3x3(block: ImageBlock): ImageBlock {
  if (block.dtype === 'uint8') return fromGray(libSharpen3x3(toGray(block)), block.region, block.axes)
  return convolve3x3(block, SHARPEN_KERNEL)
}

export function convolve3x3(block: ImageBlock, kernel: readonly number[]): ImageBlock {
  if (kernel.length !== 9 || !kernel.every(Number.isFinite)) throw new ComputeError('invalid-input', '3×3 卷积核必须包含 9 个有限元素')
  const scale = kernel.reduce((sum, value) => sum + value, 0) || 1
  const { width, height } = plane2d(block)
  const out = newBlockLike(block)
  const src = numbers(block.data)
  const dst = numbers(out.data)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      let k = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = Math.min(height - 1, Math.max(0, y + dy)) * width
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = Math.min(width - 1, Math.max(0, x + dx))
          sum += src[ny + nx]! * kernel[k++]!
        }
      }
      dst[y * width + x] = clampValue(block.dtype, sum / scale)
    }
  }
  return out
}

export function sobel(block: ImageBlock): ImageBlock {
  if (block.dtype === 'uint8') return fromGray(sobelEdges(toGray(block)), block.region, block.axes)
  const { width, height } = plane2d(block)
  const out = newBlockLike(block)
  const src = numbers(block.data)
  const dst = numbers(out.data)
  const at = (x: number, y: number): number => src[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)
        + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
        + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
      dst[y * width + x] = clampValue(block.dtype, Math.hypot(gx, gy))
    }
  }
  return out
}

export function gaussian(block: ImageBlock, sigma: number): ImageBlock {
  if (!(sigma > 0)) throw new ComputeError('invalid-input', 'sigma 必须大于 0')
  if (block.dtype === 'uint8') return fromGray(libGaussian(toGray(block), sigma), block.region, block.axes)
  const { width, height } = plane2d(block)
  const out = newBlockLike(block)
  gaussianInto(numbers(block.data), numbers(out.data), width, height, sigma, {
    convert: (value) => clampValue(block.dtype, value),
  })
  return out
}

/* ------------------------------------------------------------------ *
 * 形态学（方形结构元，半径 r）
 * ------------------------------------------------------------------ */

function morph(block: ImageBlock, radius: number, dilate: boolean): ImageBlock {
  if (!Number.isInteger(radius) || radius < 1) throw new ComputeError('invalid-input', '结构元半径必须为正整数')
  if (block.dtype === 'uint8' && radius === 1) {
    const image = toGray(block)
    return fromGray(dilate ? libDilate(image) : libErode(image), block.region, block.axes)
  }
  const { width, height } = plane2d(block)
  const out = newBlockLike(block)
  const src = numbers(block.data)
  const dst = numbers(out.data)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = dilate ? dtypeMin(block.dtype) : dtypeMax(block.dtype)
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = Math.min(height - 1, Math.max(0, y + dy)) * width
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sample = src[ny + Math.min(width - 1, Math.max(0, x + dx))]!
          value = dilate ? Math.max(value, sample) : Math.min(value, sample)
        }
      }
      dst[y * width + x] = value
    }
  }
  return out
}

export const erode = (block: ImageBlock, radius = 1): ImageBlock => morph(block, radius, false)
export const dilate = (block: ImageBlock, radius = 1): ImageBlock => morph(block, radius, true)

export function open(block: ImageBlock, radius = 1): ImageBlock {
  if (block.dtype === 'uint8' && radius === 1) return fromGray(openBinary(toGray(block)), block.region, block.axes)
  return dilate(erode(block, radius), radius)
}

export function close(block: ImageBlock, radius = 1): ImageBlock {
  if (block.dtype === 'uint8' && radius === 1) return fromGray(closeBinary(toGray(block)), block.region, block.axes)
  return erode(dilate(block, radius), radius)
}

export function fillHoles(block: ImageBlock): ImageBlock {
  if (block.dtype === 'uint8') return fromGray(libFillHoles(toGray(block)), block.region, block.axes)
  const { width, height } = plane2d(block)
  const src = numbers(block.data)
  const out = newBlockLike(block)
  const dst = numbers(out.data)
  const foreground = new Uint8Array(width * height)
  for (let i = 0; i < src.length; i += 1) foreground[i] = Number.isFinite(src[i]) && src[i]! !== 0 ? 1 : 0
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0
  const add = (index: number): void => {
    if (foreground[index] === 0 && visited[index] === 0) {
      visited[index] = 1
      queue[tail++] = index
    }
  }
  for (let x = 0; x < width; x += 1) { add(x); add((height - 1) * width + x) }
  for (let y = 0; y < height; y += 1) { add(y * width); add(y * width + width - 1) }
  while (head < tail) {
    const index = queue[head++]!
    const x = index % width
    if (x > 0) add(index - 1)
    if (x + 1 < width) add(index + 1)
    if (index >= width) add(index - width)
    if (index + width < width * height) add(index + width)
  }
  for (let i = 0; i < foreground.length; i += 1) {
    dst[i] = foreground[i] !== 0 || visited[i] === 0 ? block.dtype === 'float32' ? 255 : dtypeMax(block.dtype) : 0
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 几何算子
 * ------------------------------------------------------------------ */

export function crop(block: ImageBlock, rect: Rect): ImageBlock {
  const { width, height } = plane2d(block)
  const x = Math.max(0, Math.min(width - 1, Math.floor(rect.x)))
  const y = Math.max(0, Math.min(height - 1, Math.floor(rect.y)))
  const w = Math.max(1, Math.min(width - x, Math.floor(rect.width)))
  const h = Math.max(1, Math.min(height - y, Math.floor(rect.height)))
  const bytesPerElement = block.data.BYTES_PER_ELEMENT
  const srcBytes = new Uint8Array(block.data.buffer, block.data.byteOffset, block.data.byteLength)
  const planes = block.data.length / (width * height)
  const outData = allocateBuffer(block.dtype, planes * w * h)
  const outBytes = new Uint8Array(outData.buffer, outData.byteOffset, outData.byteLength)
  for (let plane = 0; plane < planes; plane += 1) for (let row = 0; row < h; row += 1) {
    const from = (plane * width * height + (y + row) * width + x) * bytesPerElement
    const to = (plane * w * h + row * w) * bytesPerElement
    outBytes.set(srcBytes.subarray(from, from + w * bytesPerElement), to)
  }
  return {
    dtype: block.dtype,
    axes: block.axes,
    shape: [...block.shape.slice(0, -2), h, w],
    region: { start: [...block.region.start], shape: [...block.region.shape] },
    data: outData,
  }
}

function remap(block: ImageBlock, pick: (x: number, y: number) => number): ImageBlock {
  const { width, height } = plane2d(block)
  const out = newBlockLike(block)
  const dst = numbers(out.data)
  const src = numbers(block.data)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      dst[y * width + x] = src[pick(x, y)]!
    }
  }
  return out
}

export function flipHorizontalBlock(block: ImageBlock): ImageBlock {
  if (block.dtype === 'uint8') return fromGray(flipHorizontal(toGray(block)), block.region, block.axes)
  const { width } = plane2d(block)
  return remap(block, (x, y) => y * width + (width - 1 - x))
}

export function flipVerticalBlock(block: ImageBlock): ImageBlock {
  if (block.dtype === 'uint8') return fromGray(flipVertical(toGray(block)), block.region, block.axes)
  const { width, height } = plane2d(block)
  return remap(block, (x, y) => (height - 1 - y) * width + x)
}

export function rotateBlock(block: ImageBlock, direction: 'cw' | 'ccw'): ImageBlock {
  if (block.dtype === 'uint8') {
    const image = rotate90(toGray(block), direction)
    return fromGray(image, block.region, block.axes)
  }
  const { width, height } = plane2d(block)
  const out = allocateBuffer(block.dtype, width * height)
  const dst = numbers(out)
  const src = numbers(block.data)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = direction === 'cw' ? height - 1 - y : y
      const ny = direction === 'cw' ? x : width - 1 - x
      dst[ny * height + nx] = src[y * width + x]!
    }
  }
  return { dtype: block.dtype, axes: block.axes, shape: [...block.shape.slice(0, -2), width, height], region: block.region, data: out }
}

/* ------------------------------------------------------------------ *
 * 分析算子
 * ------------------------------------------------------------------ */

/** 8 连通粒子分析；非 8 位输入先按非零二值化。 */
export function particles(block: ImageBlock, minArea: number): ReturnType<typeof analyzeParticles> {
  const image = block.dtype === 'uint8' ? toGray(block) : binarize(block)
  return analyzeParticles(image, minArea)
}

function binarize(block: ImageBlock): GrayImage {
  const { width, height } = plane2d(block)
  const data = new Uint8Array(width * height)
  const src = numbers(block.data)
  for (let i = 0; i < src.length; i += 1) data[i] = Number.isFinite(src[i]) && src[i]! !== 0 ? 255 : 0
  return { width, height, data }
}
