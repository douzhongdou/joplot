import type { ImageBlock } from '../types.ts'
import type { CameraState } from './geometry.ts'
import type { DisplayWindowLevel } from './rgba.ts'
import { adjustedColorValue, type ColorAdjustment } from '../colorAdjustments.ts'

export interface RasterOptions { gray?: boolean; threshold?: number; colorAdjustments?: readonly ColorAdjustment[] }

/** 视口里图像覆盖的像素矩形（dpr 像素，已夹到视口内）。 */
export interface RasterRegion { x: number; y: number; width: number; height: number }

/** 图像之外的底色，与视口容器的暗背景一致。 */
const BACKGROUND: readonly [number, number, number] = [19, 19, 23]
/** 同一底色的 RGBA 打包值（小端 `0xAABBGGRR`），用于按字填充背景行。 */
const BACKGROUND_RGBA = 0xff171313

const NO_ADJUSTMENTS: readonly ColorAdjustment[] = []

/** 视口的设备像素尺寸。 */
function deviceSize(camera: CameraState) {
  const dpr = camera.devicePixelRatio
  return { width: Math.max(1, Math.round(camera.viewportWidth * dpr)), height: Math.max(1, Math.round(camera.viewportHeight * dpr)) }
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

/**
 * 值域到 8 位的映射查表。
 *
 * 整数 dtype 的取值只有 0..ceiling 种（uint8 是 256、uint16 是 65536），
 * 于是逐像素的 `Math.round((value - lo) * scale)` 可以换成一次数组读 —— 翻页要重刷
 * 整屏时这是主线程的主要开销。表按 `(ceiling, lo, scale)` 缓存，只有拖亮度 / 对比度
 * 才会重建。表内已做过 `Math.round` 与 clamp，与原路径逐位一致
 * （输出缓冲是 `Uint8ClampedArray`，整数赋值的语义同样是夹取）。
 */
const LUT_CACHE = new Map<string, Uint8Array>()
function mappingLut(ceiling: number, lo: number, scale: number): Uint8Array {
  const key = `${ceiling}\u0001${lo}\u0001${scale}`
  const cached = LUT_CACHE.get(key)
  if (cached) return cached
  const lut = new Uint8Array(ceiling + 1)
  for (let value = 0; value <= ceiling; value += 1) lut[value] = clampByte(Math.round((value - lo) * scale))
  if (LUT_CACHE.size >= 8) LUT_CACHE.clear()
  LUT_CACHE.set(key, lut)
  return lut
}

/**
 * 把图像画进 `out`（`out` 只覆盖 `region` 大小的缓冲）。
 *
 * 采样口径与输出像素值与原整视口实现一致：按屏幕像素中心反查图像坐标、
 * 越界写背景色、彩色 / 灰度 / 阈值各走独立分支。分支与查表都在循环外决定，
 * 免掉逐像素的选项判断与空 `colorAdjustments` 上的 `adjustedColorValue` 调用。
 */
function paint(out: Uint8ClampedArray, region: RasterRegion, block: ImageBlock, camera: CameraState, settings: DisplayWindowLevel, options: RasterOptions): void {
  const width = region.width, height = region.height
  if (width <= 0 || height <= 0) return
  const dpr = camera.devicePixelRatio
  const iw = block.shape[block.axes.indexOf('x')]!, ih = block.shape[block.axes.indexOf('y')]!
  const c = block.axes.indexOf('c'), components = c < 0 ? 1 : block.shape[c]!
  const pixels = iw * ih
  const source = block.data
  const lo = settings.level - settings.window / 2
  const scale = 255 / (settings.window || 1)
  const adjustments = options.colorAdjustments ?? NO_ADJUSTMENTS
  const color = components === 3 && !options.gray
  const threshold = options.threshold
  const ceiling = block.dtype === 'uint16' ? 65535 : 255
  /** 只有浮点数据会出现非有限值；整数路径省掉逐像素的 `Number.isFinite`，并可用查表。 */
  const mayBeNonFinite = block.dtype === 'float32'
  const lut = mayBeNonFinite ? null : mappingLut(ceiling, lo, scale)
  const xIndices = new Int32Array(width)
  for (let i = 0; i < width; i++) xIndices[i] = Math.floor(((region.x + i + 0.5) / dpr - camera.panX) / camera.zoom)
  const rowBytes = width * 4

  for (let row = 0; row < height; row++) {
    const iy = Math.floor(((region.y + row + 0.5) / dpr - camera.panY) / camera.zoom)
    const base = row * rowBytes
    if (iy < 0 || iy >= ih) {
      // 整行在图像之外：按字填背景，不进入逐像素映射。
      new Uint32Array(out.buffer, out.byteOffset + base, width).fill(BACKGROUND_RGBA)
      continue
    }
    const rowStart = iy * iw
    for (let i = 0, p = base; i < width; i++, p += 4) {
      out[p + 3] = 255
      const ix = xIndices[i]!
      if (ix < 0 || ix >= iw) { out[p] = BACKGROUND[0]; out[p + 1] = BACKGROUND[1]; out[p + 2] = BACKGROUND[2]; continue }
      const index = rowStart + ix
      if (threshold !== undefined) {
        const value = components === 3
          ? Math.round((adjustedColorValue(source[index]!, 0, ix, iy, adjustments, ceiling) + adjustedColorValue(source[pixels + index]!, 1, ix, iy, adjustments, ceiling) + adjustedColorValue(source[2 * pixels + index]!, 2, ix, iy, adjustments, ceiling)) / 3)
          : source[index]!
        const level = Number.isFinite(value) && value > threshold ? 255 : 0
        out[p] = level; out[p + 1] = level; out[p + 2] = level
        continue
      }
      if (color) {
        if (adjustments.length === 0) {
          if (lut) {
            out[p] = lut[source[index]!]!
            out[p + 1] = lut[source[pixels + index]!]!
            out[p + 2] = lut[source[2 * pixels + index]!]!
          } else {
            for (let channel = 0; channel < 3; channel++) {
              const value = source[channel * pixels + index]!
              out[p + channel] = Number.isFinite(value) ? Math.round((value - lo) * scale) : 0
            }
          }
          continue
        }
        for (let channel = 0; channel < 3; channel++) {
          const value = adjustedColorValue(source[channel * pixels + index]!, channel, ix, iy, adjustments, ceiling)
          out[p + channel] = Number.isFinite(value) ? Math.round((value - lo) * scale) : 0
        }
        continue
      }
      // 单通道不参与 RGB 通道调整：与通道语义一致，也与原实现逐位一致。
      let level: number
      if (components !== 3) {
        const raw = source[index]!
        level = lut ? lut[raw]! : Number.isFinite(raw) ? Math.round((raw - lo) * scale) : 0
      } else {
        const averaged = Math.round((adjustedColorValue(source[index]!, 0, ix, iy, adjustments, ceiling) + adjustedColorValue(source[pixels + index]!, 1, ix, iy, adjustments, ceiling) + adjustedColorValue(source[2 * pixels + index]!, 2, ix, iy, adjustments, ceiling)) / 3)
        level = Number.isFinite(averaged) ? Math.round((averaged - lo) * scale) : 0
      }
      out[p] = level; out[p + 1] = level; out[p + 2] = level
    }
  }
}

/**
 * 图像在视口里覆盖的像素矩形。
 *
 * 这是翻页渲染的杠杆：缩小查看时视口远大于图像，只光栅化这个矩形就够，
 * 其余像素是纯背景（由一次 `fillRect` 铺好），不必逐像素参与映射。
 * 边界向外取整各留一个像素，落进矩形但实际越界的像素由绘制内核写成背景色，
 * 因此结果与整视口逐像素渲染逐位一致（`rasterizeViewport` 保留为回归口径）。
 */
export function imageRasterRegion(block: ImageBlock, camera: CameraState): RasterRegion {
  const { width, height } = deviceSize(camera)
  const dpr = camera.devicePixelRatio
  const iw = block.shape[block.axes.indexOf('x')]!, ih = block.shape[block.axes.indexOf('y')]!
  const x = Math.max(0, Math.floor(camera.panX * dpr))
  const y = Math.max(0, Math.floor(camera.panY * dpr))
  const right = Math.min(width, Math.ceil((camera.panX + iw * camera.zoom) * dpr))
  const bottom = Math.min(height, Math.ceil((camera.panY + ih * camera.zoom) * dpr))
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

/**
 * 只光栅化图像覆盖的区域，返回该区域的像素与它应贴到的位置。
 *
 * 调用方（`ImageViewport`）先用背景色铺满画布，再把结果 `putImageData` 到 `region`。
 * 传入 `reuse` 可复用调用方的缓冲，免掉每帧数 MB 的 RGBA 分配与回收。
 */
export function rasterizeRegion(block: ImageBlock, camera: CameraState, settings: DisplayWindowLevel, options: RasterOptions = {}, reuse?: Uint8ClampedArray<ArrayBuffer>): { pixels: Uint8ClampedArray<ArrayBuffer>; region: RasterRegion } {
  const region = imageRasterRegion(block, camera)
  const length = region.width * region.height * 4
  const pixels = reuse && reuse.length >= length ? reuse : new Uint8ClampedArray(length)
  paint(pixels, region, block, camera, settings, options)
  return { pixels, region }
}

/** 整视口 RGBA（视口大小，图像之外为底色）。保留为逐像素回归口径。 */
export function rasterizeViewport(block: ImageBlock, camera: CameraState, settings: DisplayWindowLevel, options: RasterOptions = {}): Uint8ClampedArray<ArrayBuffer> {
  const { width, height } = deviceSize(camera)
  const out = new Uint8ClampedArray(width * height * 4)
  new Uint32Array(out.buffer).fill(BACKGROUND_RGBA)
  const region = imageRasterRegion(block, camera)
  if (region.width <= 0 || region.height <= 0) return out
  const pixels = new Uint8ClampedArray(region.width * region.height * 4)
  paint(pixels, region, block, camera, settings, options)
  for (let row = 0; row < region.height; row += 1) {
    const from = row * region.width * 4
    out.set(pixels.subarray(from, from + region.width * 4), ((region.y + row) * width + region.x) * 4)
  }
  return out
}
