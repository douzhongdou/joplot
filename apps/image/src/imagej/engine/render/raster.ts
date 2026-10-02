import type { ImageBlock } from '../types.ts'
import type { CameraState } from './geometry.ts'
import type { DisplayWindowLevel } from './rgba.ts'
import { adjustedColorValue, type ColorAdjustment } from '../colorAdjustments.ts'

export interface RasterOptions { gray?: boolean; threshold?: number; colorAdjustments?: readonly ColorAdjustment[] }

/** 只分配视口大小的 RGBA，按屏幕像素中心读取原始缓冲；图像边长不受 Canvas 限制。 */
export function rasterizeViewport(block: ImageBlock, camera: CameraState, settings: DisplayWindowLevel, options: RasterOptions = {}): Uint8ClampedArray<ArrayBuffer> {
  const dpr = camera.devicePixelRatio
  const width = Math.max(1, Math.round(camera.viewportWidth * dpr))
  const height = Math.max(1, Math.round(camera.viewportHeight * dpr))
  const out = new Uint8ClampedArray(width * height * 4)
  const iw = block.shape[block.axes.indexOf('x')]!, ih = block.shape[block.axes.indexOf('y')]!
  const c = block.axes.indexOf('c'), components = c < 0 ? 1 : block.shape[c]!
  const pixels = iw * ih
  const data = block.data
  const lo = settings.level - settings.window / 2
  const scale = 255 / (settings.window || 1)
  const xIndices = new Int32Array(width)
  for (let x = 0; x < width; x++) xIndices[x] = Math.floor(((x + 0.5) / dpr - camera.panX) / camera.zoom)
  for (let y = 0; y < height; y++) {
    const iy = Math.floor(((y + 0.5) / dpr - camera.panY) / camera.zoom)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4, ix = xIndices[x]!
      out[p + 3] = 255
      if (ix < 0 || iy < 0 || ix >= iw || iy >= ih) { out[p] = 19; out[p + 1] = 19; out[p + 2] = 23; continue }
      const index = iy * iw + ix
      if (components === 3 && !options.gray && options.threshold === undefined) {
        for (let channel = 0; channel < 3; channel++) {
          const value = adjustedColorValue(data[channel * pixels + index]!, channel, ix, iy, options.colorAdjustments ?? [], block.dtype === 'uint16' ? 65535 : 255)
          out[p + channel] = Number.isFinite(value) ? Math.round((value - lo) * scale) : 0
        }
      } else {
        const colorValue = (channel: number) => adjustedColorValue(data[channel * pixels + index]!, channel, ix, iy, options.colorAdjustments ?? [], block.dtype === 'uint16' ? 65535 : 255)
        const value = components === 3 ? Math.round((colorValue(0) + colorValue(1) + colorValue(2)) / 3) : data[index]!
        const mapped = Number.isFinite(value) ? Math.round((value - lo) * scale) : 0
        const gray = options.threshold === undefined ? mapped : Number.isFinite(value) && value > options.threshold ? 255 : 0
        out[p] = gray; out[p + 1] = gray; out[p + 2] = gray
      }
    }
  }
  return out
}
