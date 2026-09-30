/**
 * ImageJ 8-bit 灰度算法移植（纯 TypeScript，无 Java 运行时依赖）。
 *
 * 只读参考源码（E:\Project\tool\imagej）：
 * - ij/process/ByteProcessor.java：convolve3x3 / filter（均值、中值、Sobel 边缘）、
 *   threshold、flipVertical、rotate、getHistogram、crop。
 * - ij/process/ImageProcessor.java：sharpen 核、findEdges、flipHorizontal、
 *   rotateRight / rotateLeft、显示范围（min/max）与 convertToByte 的缩放语义。
 * - ij/process/AutoThresholder.java：bilevel 快捷判断与 Otsu（类间方差最大化）。
 *
 * 约定：
 * - 像素为 0..255 的 8 位整数，行优先存储 `data[y * width + x]`。
 * - 所有函数均为纯函数（除 `ImageHistory`），返回新图像，不修改入参。
 * - 边界像素按 ImageJ 的取边方式做复制填充（replicate padding）。
 */

/** 8 位灰度图像。 */
export interface GrayImage {
  width: number
  height: number
  data: Uint8Array
}

/** 矩形 ROI，图像坐标系（左上角为原点）。 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 整图或 ROI 的测量结果（对应 ImageJ 的 ImageStatistics 子集）。 */
export interface ImageStats {
  /** 参与统计的像素数。 */
  count: number
  /** 面积：无标定图像下等于像素数（area = pixelCount * pw * ph，pw = ph = 1）。 */
  area: number
  mean: number
  min: number
  max: number
  /** 样本标准差（除以 n-1；n < 2 时为 0），与 ImageJ 一致。 */
  stdDev: number
  /** 256 级直方图。 */
  histogram: Uint32Array
}

export type ImageErrorCode =
  | 'invalid-size'
  | 'too-large'
  | 'invalid-rect'
  | 'empty-roi'
  | 'invalid-value'
  | 'history-limit'
  | 'no-image'
  | 'decode'

/** 带错误码的异常，便于 UI 映射文案。 */
export class ImagejError extends Error {
  readonly code: ImageErrorCode

  constructor(code: ImageErrorCode, message: string) {
    super(message)
    this.name = 'ImagejError'
    this.code = code
  }
}

/** 大图内存限制：单张图像的最大像素数（约等于字节数 / 1）。 */
export const MAX_IMAGE_PIXELS = 40_000_000

/** 撤销历史的最大快照数与最大字节预算（按 data 字节估算）。 */
export const HISTORY_LIMITS = {
  maxEntries: 24,
  maxBytes: 192 * 1024 * 1024,
} as const

/* ------------------------------------------------------------------ *
 * 创建 / 校验
 * ------------------------------------------------------------------ */

function assertInteger(value: number, code: ImageErrorCode, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ImagejError(code, `${label} 必须是有限整数，收到 ${String(value)}`)
  }
}

/** 创建一张填充为 `fill` 的新图像。尺寸非法或超过内存上限时抛 `ImagejError`。 */
export function createImage(width: number, height: number, fill = 0): GrayImage {
  assertInteger(width, 'invalid-size', 'width')
  assertInteger(height, 'invalid-size', 'height')
  assertInteger(fill, 'invalid-value', 'fill')

  if (width <= 0 || height <= 0) {
    throw new ImagejError('invalid-size', `图像尺寸必须大于 0，收到 ${width}x${height}`)
  }

  if (width * height > MAX_IMAGE_PIXELS) {
    throw new ImagejError(
      'too-large',
      `图像 ${width}x${height} 超过 ${MAX_IMAGE_PIXELS} 像素上限`,
    )
  }

  const clampedFill = Math.max(0, Math.min(255, fill))
  return { width, height, data: new Uint8Array(width * height).fill(clampedFill) }
}

/** 校验对象是否为合法的 `GrayImage`。 */
export function isValidImage(image: unknown): image is GrayImage {
  if (!image || typeof image !== 'object') {
    return false
  }
  const candidate = image as GrayImage
  return (
    Number.isInteger(candidate.width)
    && Number.isInteger(candidate.height)
    && candidate.width > 0
    && candidate.height > 0
    && candidate.data instanceof Uint8Array
    && candidate.data.length === candidate.width * candidate.height
  )
}

/** 深拷贝图像。 */
export function cloneImage(image: GrayImage): GrayImage {
  if (!isValidImage(image)) {
    throw new ImagejError('invalid-size', 'cloneImage 收到非法图像')
  }
  return { width: image.width, height: image.height, data: image.data.slice() }
}

/* ------------------------------------------------------------------ *
 * ROI
 * ------------------------------------------------------------------ */

/** 把 ROI 夹取到图像范围内；无交集返回 null。 */
export function clampRect(rect: Rect, image: GrayImage): Rect | null {
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

/** 归一化 ROI：返回 `{ image, rect: null }` 表示整图。ROI 非法或为空时抛错。 */
export function resolveRoi(image: GrayImage, rect: Rect | null): { image: GrayImage; rect: Rect | null } {
  if (!isValidImage(image)) {
    throw new ImagejError('invalid-size', 'resolveRoi 收到非法图像')
  }
  if (!rect) {
    return { image, rect: null }
  }
  const clamped = clampRect(rect, image)
  if (!clamped) {
    throw new ImagejError('empty-roi', 'ROI 与图像没有交集')
  }
  return { image, rect: clamped }
}

/** 裁剪：返回 ROI 内的新图像（ByteProcessor.crop 语义）。 */
export function cropImage(image: GrayImage, rect: Rect): GrayImage {
  const { rect: roi } = resolveRoi(image, rect)
  if (!roi) {
    return cloneImage(image)
  }

  const out = createImage(roi.width, roi.height)
  for (let row = 0; row < roi.height; row += 1) {
    const srcStart = (roi.y + row) * image.width + roi.x
    out.data.set(image.data.subarray(srcStart, srcStart + roi.width), row * roi.width)
  }
  return out
}

/** 只把处理结果写回矩形 ROI。滤波可读取 ROI 外的相邻像素；翻转可选择先裁剪 ROI。 */
export function applyWithinRoi(
  image: GrayImage,
  rect: Rect | null,
  operation: (source: GrayImage) => GrayImage,
  cropBeforeProcessing = false,
): GrayImage {
  const roi = rect ? resolveRoi(image, rect).rect : null
  if (!roi) return operation(image)

  const source = cropBeforeProcessing ? cropImage(image, roi) : image
  const processed = operation(source)
  if (processed.width !== source.width || processed.height !== source.height) {
    throw new ImagejError('invalid-size', 'ROI 操作不能改变图像尺寸')
  }

  const out = cloneImage(image)
  for (let y = 0; y < roi.height; y += 1) {
    const targetStart = (roi.y + y) * image.width + roi.x
    const sourceStart = cropBeforeProcessing ? y * roi.width : targetStart
    out.data.set(processed.data.subarray(sourceStart, sourceStart + roi.width), targetStart)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 几何变换：翻转 / 90° 旋转
 * ------------------------------------------------------------------ */

/** 水平翻转（ImageProcessor.flipHorizontal）。 */
export function flipHorizontal(image: GrayImage): GrayImage {
  const out = createImage(image.width, image.height)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      out.data[y * image.width + (image.width - 1 - x)] = image.data[y * image.width + x]
    }
  }
  return out
}

/** 垂直翻转（ByteProcessor.flipVertical）。 */
export function flipVertical(image: GrayImage): GrayImage {
  const out = createImage(image.width, image.height)
  for (let y = 0; y < image.height; y += 1) {
    const target = (image.height - 1 - y) * image.width
    out.data.set(image.data.subarray(y * image.width, (y + 1) * image.width), target)
  }
  return out
}

export type RotateDirection = 'cw' | 'ccw'

/** 90° 旋转：`cw` 对应 ImageProcessor.rotateRight，`ccw` 对应 rotateLeft。 */
export function rotate90(image: GrayImage, direction: RotateDirection): GrayImage {
  const out = createImage(image.height, image.width)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const source = image.data[y * image.width + x]
      if (direction === 'cw') {
        // 源 (x, y) → 目标 (height-1-y, x)
        out.data[x * image.height + (image.height - 1 - y)] = source
      } else {
        // 源 (x, y) → 目标 (y, width-1-x)
        out.data[(image.width - 1 - x) * image.height + y] = source
      }
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 颜色与显示调整
 * ------------------------------------------------------------------ */

/** RGBA → 灰度。默认权重与 ImageJ ColorProcessor 一致（1/3 等权）。 */
export function toGrayFromRgba(
  width: number,
  height: number,
  rgba: ArrayLike<number>,
  weights: readonly [number, number, number] = [1 / 3, 1 / 3, 1 / 3],
): GrayImage {
  if (rgba.length !== width * height * 4) {
    throw new ImagejError('invalid-size', 'RGBA 数据长度与宽高不匹配')
  }
  const image = createImage(width, height)
  const [rw, gw, bw] = weights
  for (let i = 0, p = 0; i < image.data.length; i += 1, p += 4) {
    const gray = Math.round(rgba[p] * rw + rgba[p + 1] * gw + rgba[p + 2] * bw)
    image.data[i] = Math.max(0, Math.min(255, gray))
  }
  return image
}

/** 反相（ImageProcessor.process(INVERT)：255 - v）。 */
export function invert(image: GrayImage): GrayImage {
  const out = createImage(image.width, image.height)
  for (let i = 0; i < image.data.length; i += 1) {
    out.data[i] = 255 - image.data[i]
  }
  return out
}

export interface LevelsRange {
  min: number
  max: number
}

/**
 * 亮度/对比度 → 显示范围。
 * `brightness` 为 -127..127 的整体位移，`contrast` 为 0..100（50 表示原样）。
 */
export function levelsRange(brightness: number, contrast: number): LevelsRange {
  const safeBrightness = Number.isFinite(brightness) ? Math.max(-127, Math.min(127, brightness)) : 0
  const safeContrast = Number.isFinite(contrast) ? Math.max(1, Math.min(100, contrast)) : 50
  const factor = safeContrast / 50
  const half = 127.5 / factor
  return {
    min: 127.5 - half - safeBrightness,
    max: 127.5 + half - safeBrightness,
  }
}

/**
 * 按显示范围重映射像素（对应 convertToByte(true) 的 min/max 缩放）。
 * `min >= max` 时抛错，避免除零。
 */
export function applyLevels(image: GrayImage, min: number, max: number): GrayImage {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    throw new ImagejError('invalid-value', `显示范围非法：[${min}, ${max}]`)
  }

  const scale = 255 / (max - min)
  const out = createImage(image.width, image.height)
  for (let i = 0; i < image.data.length; i += 1) {
    const scaled = Math.round((image.data[i] - min) * scale)
    out.data[i] = scaled < 0 ? 0 : scaled > 255 ? 255 : scaled
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 阈值：手动 + 自动 Otsu
 * ------------------------------------------------------------------ */

/**
 * 手动阈值：像素 ≤ level → 0，> level → 255（ByteProcessor.threshold(level) 语义）。
 */
export function applyThreshold(image: GrayImage, level: number): GrayImage {
  if (!Number.isFinite(level)) {
    throw new ImagejError('invalid-value', '阈值必须是数字')
  }
  const clamped = Math.max(0, Math.min(255, Math.round(level)))
  const out = createImage(image.width, image.height)
  for (let i = 0; i < image.data.length; i += 1) {
    out.data[i] = image.data[i] > clamped ? 255 : 0
  }
  return out
}

/**
 * AutoThresholder.bilevel：直方图只有 1 或 2 个非零桶时直接返回阈值，
 * 否则返回 -1 表示需要继续走完整算法。
 */
export function bilevelThreshold(histogram: ArrayLike<number>): number {
  let firstNonZero = -1
  let secondNonZero = -1
  let nonZeroCount = 0

  for (let i = 0; i < histogram.length; i += 1) {
    if (histogram[i] > 0) {
      nonZeroCount += 1
      if (nonZeroCount > 2) {
        return -1
      }
      if (firstNonZero < 0) {
        firstNonZero = i
      } else {
        secondNonZero = i
      }
    }
  }

  if (nonZeroCount === 1) {
    return firstNonZero - 1
  }
  if (nonZeroCount === 2) {
    return secondNonZero - 1
  }
  return -1
}

/**
 * Otsu 自动阈值（AutoThresholder.Otsu 移植）：最大化类间方差。
 * 入参为直方图，返回 0..histogram.length-1 的阈值。
 */
export function otsuThreshold(histogram: ArrayLike<number>): number {
  const fastPath = bilevelThreshold(histogram)
  if (fastPath >= 0) {
    return fastPath
  }

  const length = histogram.length
  let numPixels = 0
  for (let i = 0; i < length; i += 1) {
    numPixels += histogram[i]
  }
  if (numPixels <= 0) {
    throw new ImagejError('invalid-value', '直方图为空，无法计算 Otsu 阈值')
  }

  const term = 1 / numPixels
  const histo = new Float64Array(length)
  const cumulative = new Float64Array(length)
  const mean = new Float64Array(length)

  for (let i = 0; i < length; i += 1) {
    histo[i] = term * histogram[i]
  }
  cumulative[0] = histo[0]
  for (let i = 1; i < length; i += 1) {
    cumulative[i] = cumulative[i - 1] + histo[i]
  }
  mean[0] = 0
  for (let i = 1; i < length; i += 1) {
    mean[i] = mean[i - 1] + i * histo[i]
  }

  const totalMean = mean[length - 1]
  let threshold = -1
  let maxBcv = 0

  for (let i = 0; i < length; i += 1) {
    const denominator = cumulative[i] * (1 - cumulative[i])
    if (denominator <= 0) {
      continue
    }
    const bcv = (totalMean * cumulative[i] - mean[i]) ** 2 / denominator
    if (maxBcv < bcv) {
      maxBcv = bcv
      threshold = i
    }
  }

  return threshold < 0 ? 0 : threshold
}

/* ------------------------------------------------------------------ *
 * 3x3 滤波（零分配：邻域以标量传入，绝不构造数组）
 *
 * 灰度用 stride=1，彩色通道用 stride=4 + offset 0/1/2，
 * 同一份实现既能算灰度也能就地算某个通道 —— 分通道不再需要拆平面。
 * ------------------------------------------------------------------ */

/** 平面视图：描述一个通道在缓冲区里的取值方式。 */
export interface Plane {
  data: Uint8Array | Uint8ClampedArray
  stride: number
  offset: number
}

type Kernel9 = (
  p1: number, p2: number, p3: number,
  p4: number, p5: number, p6: number,
  p7: number, p8: number, p9: number,
) => number

/** 通用 3×3 遍历：边界复制，结果夹取到 0..255 后写入 dst。内核为标量函数，无任何分配。 */
function map3x3(src: Plane, dst: Plane, width: number, height: number, kernel: Kernel9): void {
  const sd = src.data
  const dd = dst.data
  const ss = src.stride
  const ds = dst.stride
  const so = src.offset
  const dOff = dst.offset
  const srcRowSpan = width * ss
  const dstRowSpan = width * ds

  for (let y = 0; y < height; y += 1) {
    const r0 = (y > 0 ? y - 1 : 0) * srcRowSpan + so
    const r1 = y * srcRowSpan + so
    const r2 = (y + 1 < height ? y + 1 : height - 1) * srcRowSpan + so
    const dRow = y * dstRowSpan + dOff
    for (let x = 0; x < width; x += 1) {
      const x0 = (x > 0 ? x - 1 : 0) * ss
      const x1 = x * ss
      const x2 = (x + 1 < width ? x + 1 : width - 1) * ss
      const value = kernel(
        sd[r0 + x0], sd[r0 + x1], sd[r0 + x2],
        sd[r1 + x0], sd[r1 + x1], sd[r1 + x2],
        sd[r2 + x0], sd[r2 + x1], sd[r2 + x2],
      )
      dd[dRow + x * ds] = value < 0 ? 0 : value > 255 ? 255 : value
    }
  }
}

function grayPlane(image: GrayImage): Plane {
  return { data: image.data, stride: 1, offset: 0 }
}

/** 3x3 均值（ByteProcessor BLUR_MORE：(sum + 4) / 9）。 */
export function mean3x3Into(src: Plane, dst: Plane, width: number, height: number): void {
  map3x3(src, dst, width, height, (a, b, c, d, e, f, g, h, i) => Math.floor((a + b + c + d + e + f + g + h + i + 4) / 9))
}

/** 3x3 中值（9 个值取第 5 大）：复用一个 9 槽 scratch，逐像素原地插入排序。 */
const medianScratch = new Uint8Array(9)

export function median3x3Into(src: Plane, dst: Plane, width: number, height: number): void {
  const s = medianScratch
  map3x3(src, dst, width, height, (a, b, c, d, e, f, g, h, i) => {
    s[0] = a; s[1] = b; s[2] = c
    s[3] = d; s[4] = e; s[5] = f
    s[6] = g; s[7] = h; s[8] = i
    for (let m = 1; m < 9; m += 1) {
      const value = s[m]
      let j = m - 1
      while (j >= 0 && s[j] > value) {
        s[j + 1] = s[j]
        j -= 1
      }
      s[j + 1] = value
    }
    return s[4]
  })
}

/** 3×3 最小 / 最大秩滤波。 */
export function minimum3x3Into(src: Plane, dst: Plane, width: number, height: number): void {
  map3x3(src, dst, width, height, (a, b, c, d, e, f, g, h, i) =>
    Math.min(a, b, c, d, e, f, g, h, i))
}

export function maximum3x3Into(src: Plane, dst: Plane, width: number, height: number): void {
  map3x3(src, dst, width, height, (a, b, c, d, e, f, g, h, i) =>
    Math.max(a, b, c, d, e, f, g, h, i))
}

/**
 * 3x3 卷积（ByteProcessor.convolve3x3）：按 ImageJ 的整数除法（向零取整）
 * 与 `scale/2` 舍入，再夹取 0..255。
 */
export function convolve3x3Into(
  src: Plane,
  dst: Plane,
  width: number,
  height: number,
  kernel: readonly number[],
): void {
  if (kernel.length !== 9) {
    throw new ImagejError('invalid-value', '卷积核必须是 9 个元素')
  }
  let scale = 0
  const k: number[] = []
  for (const value of kernel) {
    if (!Number.isFinite(value)) {
      throw new ImagejError('invalid-value', '卷积核包含非数字')
    }
    const truncated = Math.trunc(value)
    k.push(truncated)
    scale += truncated
  }
  if (scale === 0) {
    scale = 1
  }
  const half = Math.trunc(scale / 2)
  const [k1, k2, k3, k4, k5, k6, k7, k8, k9] = k
  map3x3(src, dst, width, height, (a, b, c, d, e, f, g, h, i) =>
    Math.trunc((k1 * a + k2 * b + k3 * c + k4 * d + k5 * e + k6 * f + k7 * g + k8 * h + k9 * i + half) / scale))
}

/** Sobel 边缘（ByteProcessor FIND_EDGES）。 */
export function sobelEdgesInto(src: Plane, dst: Plane, width: number, height: number): void {
  map3x3(src, dst, width, height, (a, b, c, d, _e, f, g, h, i) => {
    const sum1 = a + 2 * b + c - g - 2 * h - i
    const sum2 = a + 2 * d + g - c - 2 * f - i
    const magnitude = Math.trunc(Math.sqrt(sum1 * sum1 + sum2 * sum2))
    return magnitude > 255 ? 255 : magnitude
  })
}

/** 可分离高斯（边界复制），逐像素四舍五入到 8 位；临时缓冲每次调用分配一个。 */
export function gaussianBlurInto(src: Plane, dst: Plane, width: number, height: number, sigma: number): void {
  if (!Number.isFinite(sigma) || sigma < 0.1 || sigma > 20) {
    throw new ImagejError('invalid-value', '高斯 sigma 必须在 0.1 到 20 之间')
  }
  const radius = Math.ceil(3 * sigma)
  const kernel = new Float64Array(radius * 2 + 1)
  let total = 0
  for (let k = -radius; k <= radius; k += 1) {
    const value = Math.exp(-(k * k) / (2 * sigma * sigma))
    kernel[k + radius] = value
    total += value
  }
  for (let k = 0; k < kernel.length; k += 1) kernel[k] /= total

  const sd = src.data
  const dd = dst.data
  const ss = src.stride
  const ds = dst.stride
  const so = src.offset
  const dOff = dst.offset
  const rowSpan = width * ss
  const temp = new Float32Array(width * height)

  // 水平
  for (let y = 0; y < height; y += 1) {
    const row = y * rowSpan + so
    const tRow = y * width
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let k = -radius; k <= radius; k += 1) {
        const nx = x + k < 0 ? 0 : x + k >= width ? width - 1 : x + k
        sum += sd[row + nx * ss] * kernel[k + radius]
      }
      temp[tRow + x] = sum
    }
  }

  // 垂直
  for (let y = 0; y < height; y += 1) {
    const dRow = y * width * ds + dOff
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let k = -radius; k <= radius; k += 1) {
        const ny = y + k < 0 ? 0 : y + k >= height ? height - 1 : y + k
        sum += temp[ny * width + x] * kernel[k + radius]
      }
      const value = Math.round(sum)
      dd[dRow + x * ds] = value < 0 ? 0 : value > 255 ? 255 : value
    }
  }
}

/* ------------------------------------------------------------------ *
 * 逐像素映射与直方图（同样零分配，支持 stride）
 * ------------------------------------------------------------------ */

/** 逐像素一元映射：内核是标量函数，逐像素调用不产生分配。 */
export function mapPixelsInto(
  src: Plane,
  dst: Plane,
  width: number,
  height: number,
  fn: (value: number) => number,
): void {
  const sd = src.data
  const dd = dst.data
  const ss = src.stride
  const ds = dst.stride
  const so = src.offset
  const dOff = dst.offset
  const rowSpan = width * ss
  const dRowSpan = width * ds
  for (let y = 0; y < height; y += 1) {
    const row = y * rowSpan + so
    const dRow = y * dRowSpan + dOff
    for (let x = 0; x < width; x += 1) {
      const value = fn(sd[row + x * ss])
      dd[dRow + x * ds] = value < 0 ? 0 : value > 255 ? 255 : value
    }
  }
}

/** 单通道 256 桶直方图（复用外部传入的 bins，不分配）。 */
export function histogramInto(src: Plane, width: number, height: number, bins: Uint32Array): void {
  bins.fill(0)
  const sd = src.data
  const ss = src.stride
  const so = src.offset
  const rowSpan = width * ss
  for (let y = 0; y < height; y += 1) {
    const row = y * rowSpan + so
    for (let x = 0; x < width; x += 1) {
      bins[sd[row + x * ss]] += 1
    }
  }
}

/* ---- 灰度图像入口（保持原有纯函数接口） ---- */

/** 3x3 均值（ByteProcessor BLUR_MORE：(sum + 4) / 9）。 */
export function mean3x3(image: GrayImage): GrayImage {
  const out = createImage(image.width, image.height)
  mean3x3Into(grayPlane(image), grayPlane(out), image.width, image.height)
  return out
}

/** 3x3 中值（ByteProcessor MEDIAN_FILTER：9 个值取第 5 大）。 */
export function median3x3(image: GrayImage): GrayImage {
  const out = createImage(image.width, image.height)
  median3x3Into(grayPlane(image), grayPlane(out), image.width, image.height)
  return out
}

/** 3x3 最小 / 最大。 */
export function minimum3x3(image: GrayImage): GrayImage {
  const out = createImage(image.width, image.height)
  minimum3x3Into(grayPlane(image), grayPlane(out), image.width, image.height)
  return out
}

export function maximum3x3(image: GrayImage): GrayImage {
  const out = createImage(image.width, image.height)
  maximum3x3Into(grayPlane(image), grayPlane(out), image.width, image.height)
  return out
}

/** 3x3 卷积（ByteProcessor.convolve3x3）。 */
export function convolve3x3(image: GrayImage, kernel: readonly number[]): GrayImage {
  const out = createImage(image.width, image.height)
  convolve3x3Into(grayPlane(image), grayPlane(out), image.width, image.height, kernel)
  return out
}

/** 锐化（ImageProcessor.sharpen 的 {-1,-1,-1,-1,12,-1,-1,-1,-1} 核）。 */
export function sharpen3x3(image: GrayImage): GrayImage {
  return convolve3x3(image, [-1, -1, -1, -1, 12, -1, -1, -1, -1])
}

/** Sobel 边缘（ByteProcessor FIND_EDGES）。 */
export function sobelEdges(image: GrayImage): GrayImage {
  const out = createImage(image.width, image.height)
  sobelEdgesInto(grayPlane(image), grayPlane(out), image.width, image.height)
  return out
}

/* ------------------------------------------------------------------ *
 * 直方图与测量
 * ------------------------------------------------------------------ */

/** 计算 256 级直方图；`rect` 为 null 表示整图（ByteProcessor.getHistogram）。 */
export function histogram(image: GrayImage, rect: Rect | null = null): Uint32Array {
  const bins = new Uint32Array(256)
  const roi = rect ? resolveRoi(image, rect).rect : null

  if (!roi) {
    for (let i = 0; i < image.data.length; i += 1) {
      bins[image.data[i]] += 1
    }
    return bins
  }

  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    const rowStart = y * image.width + roi.x
    for (let x = 0; x < roi.width; x += 1) {
      bins[image.data[rowStart + x]] += 1
    }
  }
  return bins
}

/**
 * 测量面积、均值、最小/最大与标准差（整图或 ROI）。
 * 标准差按 ImageJ 的样本标准差口径：sqrt((n*Σx² - (Σx)²)/n/(n-1))。
 */
export function measure(image: GrayImage, rect: Rect | null = null): ImageStats {
  const bins = histogram(image, rect)

  let count = 0
  let sum = 0
  let min = 255
  let max = 0

  for (let value = 0; value < bins.length; value += 1) {
    const frequency = bins[value]
    if (frequency === 0) {
      continue
    }
    count += frequency
    sum += value * frequency
    if (value < min) min = value
    if (value > max) max = value
  }

  if (count === 0) {
    throw new ImagejError('empty-roi', '所选范围内没有像素')
  }

  let sumSquares = 0
  for (let value = 0; value < bins.length; value += 1) {
    const frequency = bins[value]
    if (frequency > 0) {
      sumSquares += value * value * frequency
    }
  }

  let stdDev = 0
  if (count > 1) {
    const variance = (count * sumSquares - sum * sum) / count
    stdDev = variance > 0 ? Math.sqrt(variance / (count - 1)) : 0
  }

  return {
    count,
    area: count,
    mean: sum / count,
    min,
    max,
    stdDev,
    histogram: bins,
  }
}

/* ------------------------------------------------------------------ *
 * 撤销 / 重做
 * ------------------------------------------------------------------ */

/** 撤销历史：受条目数与字节预算双重限制，超限时淘汰最旧快照。 */
export class ImageHistory {
  private past: GrayImage[] = []
  private future: GrayImage[] = []
  private bytes = 0
  private readonly limits: { maxEntries: number; maxBytes: number }

  constructor(limits: { maxEntries: number; maxBytes: number } = HISTORY_LIMITS) {
    this.limits = limits
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  get depth(): number {
    return this.past.length
  }

  get usedBytes(): number {
    return this.bytes
  }

  /** 记录一次修改前的状态（提交新状态前调用）。 */
  push(snapshot: GrayImage): void {
    if (!isValidImage(snapshot)) {
      throw new ImagejError('invalid-size', '历史快照不是合法图像')
    }
    this.past.push(snapshot)
    this.bytes += snapshot.data.byteLength
    this.future = []
    this.evict()
  }

  private evict(): void {
    while (this.past.length > this.limits.maxEntries || (this.bytes > this.limits.maxBytes && this.past.length > 1)) {
      const removed = this.past.shift()
      if (!removed) {
        break
      }
      this.bytes -= removed.data.byteLength
    }
  }

  /** 撤销：返回上一张图像，无可撤销时返回 null。 */
  undo(current: GrayImage): GrayImage | null {
    const previous = this.past.pop()
    if (!previous) {
      return null
    }
    this.bytes -= previous.data.byteLength
    this.future.push(current)
    return previous
  }

  /** 重做：返回下一张图像，无可重做时返回 null。 */
  redo(current: GrayImage): GrayImage | null {
    const next = this.future.pop()
    if (!next) {
      return null
    }
    this.bytes += current.data.byteLength
    this.past.push(current)
    this.evict()
    return next
  }

  clear(): void {
    this.past = []
    this.future = []
    this.bytes = 0
  }
}

/* ------------------------------------------------------------------ *
 * 导出
 * ------------------------------------------------------------------ */

/** 灰度 → RGBA（PNG 导出用），alpha 固定 255。 */
export function toRgba(image: GrayImage): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(image.data.length * 4)
  for (let i = 0, p = 0; i < image.data.length; i += 1, p += 4) {
    const value = image.data[i]
    rgba[p] = value
    rgba[p + 1] = value
    rgba[p + 2] = value
    rgba[p + 3] = 255
  }
  return rgba
}
