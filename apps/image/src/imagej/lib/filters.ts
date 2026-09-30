/** ImageJ GaussianBlur/RankFilters 的常用 8 位灰度子集。实现委托给 processor 的 stride 内核。 */
import {
  ImagejError,
  createImage,
  gaussianBlurInto,
  maximum3x3Into,
  minimum3x3Into,
  type GrayImage,
  type Plane,
} from './processor.ts'

const FILTER_PIXEL_LIMIT = 4_000_000

function checkSize(image: GrayImage): void {
  if (image.data.length > FILTER_PIXEL_LIMIT) throw new ImagejError('too-large', '高级滤波最多处理 400 万像素')
}

function plane(data: GrayImage['data']): Plane {
  return { data, stride: 1, offset: 0 }
}

/** 可分离高斯卷积，边界复制，输出四舍五入到 8 位。 */
export function gaussianBlur(image: GrayImage, sigma: number): GrayImage {
  checkSize(image)
  const out = createImage(image.width, image.height)
  gaussianBlurInto(plane(image.data), plane(out.data), image.width, image.height, sigma)
  return out
}

export function minimum3x3(image: GrayImage): GrayImage {
  checkSize(image)
  const out = createImage(image.width, image.height)
  minimum3x3Into(plane(image.data), plane(out.data), image.width, image.height)
  return out
}

export function maximum3x3(image: GrayImage): GrayImage {
  checkSize(image)
  const out = createImage(image.width, image.height)
  maximum3x3Into(plane(image.data), plane(out.data), image.width, image.height)
  return out
}
