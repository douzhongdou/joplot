/** ImageJ GaussianBlur/RankFilters 的常用 8 位灰度子集。 */
import { createImage, ImagejError, type GrayImage } from './processor.ts'

const FILTER_PIXEL_LIMIT = 4_000_000

function checkSize(image: GrayImage): void {
  if (image.data.length > FILTER_PIXEL_LIMIT) throw new ImagejError('too-large', '高级滤波最多处理 400 万像素')
}

/** 可分离高斯卷积，边界复制，输出四舍五入到 8 位。 */
export function gaussianBlur(image: GrayImage, sigma: number): GrayImage {
  checkSize(image)
  if (!Number.isFinite(sigma) || sigma < 0.1 || sigma > 20) {
    throw new ImagejError('invalid-value', '高斯 sigma 必须在 0.1 到 20 之间')
  }
  const radius = Math.ceil(3 * sigma)
  const kernel = new Float64Array(radius * 2 + 1)
  let total = 0
  for (let i = -radius; i <= radius; i += 1) {
    const value = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel[i + radius] = value
    total += value
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= total
  const { width, height } = image
  const horizontal = new Float32Array(width * height)
  const out = createImage(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let k = -radius; k <= radius; k += 1) {
        const nx = Math.max(0, Math.min(width - 1, x + k))
        sum += image.data[y * width + nx] * kernel[k + radius]
      }
      horizontal[y * width + x] = sum
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let k = -radius; k <= radius; k += 1) {
        const ny = Math.max(0, Math.min(height - 1, y + k))
        sum += horizontal[ny * width + x] * kernel[k + radius]
      }
      out.data[y * width + x] = Math.round(sum)
    }
  }
  return out
}

function rank3x3(image: GrayImage, maximum: boolean): GrayImage {
  checkSize(image)
  const out = createImage(image.width, image.height)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let selected = maximum ? 0 : 255
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = Math.max(0, Math.min(image.width - 1, x + dx))
          const ny = Math.max(0, Math.min(image.height - 1, y + dy))
          const value = image.data[ny * image.width + nx]
          selected = maximum ? Math.max(selected, value) : Math.min(selected, value)
        }
      }
      out.data[y * image.width + x] = selected
    }
  }
  return out
}

export function minimum3x3(image: GrayImage): GrayImage { return rank3x3(image, false) }
export function maximum3x3(image: GrayImage): GrayImage { return rank3x3(image, true) }
