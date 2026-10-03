/**
 * 浏览器原生位图解码。
 *
 * ITK-Wasm image-io 不覆盖 WebP，因此 WebP 走浏览器自带的 `createImageBitmap` + 2D Canvas：
 * 在 Worker 里用 `OffscreenCanvas`，主线程回退时用 `<canvas>`。解码结果固定为 8 位，
 * WebP 本身也只有 8 位，因此不存在精度损失（Alpha 通道当前忽略）。
 *
 * `rgbaToPlanarRgb` 是纯函数，与浏览器 API 解耦，可在 Node 测试中直接验证。
 */

import type { ChannelInfo } from './types.ts'
import type { DecodedImage } from './importer.ts'

const RGB_CHANNELS: ChannelInfo[] = [
  { index: 0, name: 'Red', kind: 'rgb', displayColor: [255, 0, 0] },
  { index: 1, name: 'Green', kind: 'rgb', displayColor: [0, 255, 0] },
  { index: 2, name: 'Blue', kind: 'rgb', displayColor: [0, 0, 255] },
]

/** 把交织的 RGBA 缓冲转换为内部使用的平面分离 RGB（`c` 轴）。 */
export function rgbaToPlanarRgb(rgba: ArrayLike<number>, width: number, height: number): DecodedImage {
  const pixels = width * height
  const data = new Uint8Array(pixels * 3)
  for (let i = 0; i < pixels; i += 1) {
    const at = i * 4
    data[i] = rgba[at]!
    data[pixels + i] = rgba[at + 1]!
    data[2 * pixels + i] = rgba[at + 2]!
  }
  return {
    dtype: 'uint8',
    axes: ['c', 'y', 'x'],
    shape: [3, height, width],
    channels: RGB_CHANNELS,
    componentKind: 'rgb',
    data,
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    warnings: [],
  }
}

/** 当前环境能否用浏览器原生 API 解码位图。 */
export function canDecodeNativeBitmap(): boolean {
  return typeof createImageBitmap === 'function'
}

/** 用浏览器原生解码器解码 WebP 等格式；环境不支持时返回 null。 */
export async function decodeWebpFile(file: Blob): Promise<DecodedImage | null> {
  if (typeof createImageBitmap !== 'function') return null
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = bitmap
    const raster = createRaster(width, height)
    if (!raster) return null
    raster.drawImage(bitmap, 0, 0)
    const image = raster.getImageData(0, 0, width, height)
    return rgbaToPlanarRgb(image.data, width, height)
  } finally {
    bitmap.close?.()
  }
}

/** 只取绘制与取像所需的方法，兼容 Offscreen 与主线程两种 2D 上下文。 */
interface Raster2d {
  drawImage(image: ImageBitmap, x: number, y: number): void
  getImageData(x: number, y: number, width: number, height: number): ImageData
}

function createRaster(width: number, height: number): Raster2d | null {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height)
    return canvas.getContext('2d')
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas.getContext('2d')
  }
  return null
}
