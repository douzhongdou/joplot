/**
 * Make Montage 内核（Image ▸ Stacks ▸ Make Montage...，ImageJ 的 `ij/plugin/MontageMaker.java`）。
 *
 * 与 ImageJ 一致的部分：
 * - 自动行列与缩放（`MontageMaker.java:74-87`）：`C = int(sqrt(n))`、`R = C`，余数向右加宽列数；
 *   输出宽度乘列数后超过 800 像素降为 0.5 倍、超过 1600 像素降为 0.25 倍；
 * - 输出尺寸 `outW = w*C + bw*(C-1)`、`outH = h*R + bw*(R-1)` —— 边框只在面板之间，外沿没有边框
 *   （`MontageMaker.java:158-246`）；
 * - 面板按行优先填充（先左到右、再上到下）；
 * - 输出是**单页图**（不是栈），尺寸由 scale 与行列决定。
 *
 * 尚未覆盖：ImageJ 的 “Label slices” 文本绘制。它依赖 Canvas 文本渲染，而本项目的投影/蒙太奇
 * 在引擎侧执行、像素不跨线程；本轮先只做几何拼接，标签绘制留到装饰批次（见移植文档批次 5）。
 */
import { allocateBuffer, elementCount, type Dtype, type ImageBlock, type PixelArray } from './types.ts'
import { defaultLabelColor, drawText, textHeight, textWidth } from './textRaster.ts'

export interface MontageLayout {
  columns: number
  rows: number
  scale: number
}

/** 面板数与单页宽度决定的行列与缩放，对齐 ImageJ 的自动默认值。 */
export function autoMontageLayout(width: number, count: number): MontageLayout {
  let columns = Math.max(1, Math.trunc(Math.sqrt(count)))
  const rows = columns
  const extra = count - columns * rows
  if (extra > 0) columns += Math.ceil(extra / rows)
  let scale = 1
  if (width * columns > 1600) scale = 0.25
  else if (width * columns > 800) scale = 0.5
  return { columns, rows, scale }
}

/** 以 number 读写 TypedArray：联合类型的索引赋值在 TS 下需要这一层转换。 */
function numberView(view: PixelArray): { [index: number]: number } {
  return view as unknown as { [index: number]: number }
}

function clampToDtype(dtype: Dtype, value: number): number {
  if (!Number.isFinite(value)) return value
  switch (dtype) {
    case 'uint8': return Math.max(0, Math.min(255, Math.round(value)))
    case 'uint16': return Math.max(0, Math.min(65535, Math.round(value)))
    case 'int16': return Math.max(-32768, Math.min(32767, Math.round(value)))
    case 'float32': return value
  }
}

/**
 * 把一个平面重采样进目标缓冲（双线性，与 ImageJ `ImageProcessor.resize` 的默认插值一致）。
 *
 * 目标像素中心反向映射到源坐标，再对四邻域加权；边界按夹取处理。
 */
function resamplePlane(options: {
  source: { [index: number]: number }
  sourceWidth: number
  sourceHeight: number
  destination: { [index: number]: number }
  destinationWidth: number
  destinationHeight: number
  plane: number
  targetWidth: number
  targetHeight: number
  offsetX: number
  offsetY: number
  dtype: Dtype
}): void {
  const { source, sourceWidth, sourceHeight, destination, destinationWidth, destinationHeight, plane, targetWidth, targetHeight, offsetX, offsetY, dtype } = options
  const sourcePlane = plane * sourceWidth * sourceHeight
  const destinationPlane = plane * destinationWidth * destinationHeight
  const stepX = sourceWidth / targetWidth
  const stepY = sourceHeight / targetHeight
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = (y + 0.5) * stepY - 0.5
    const y0 = Math.max(0, Math.min(sourceHeight - 1, Math.floor(sourceY)))
    const y1 = Math.max(0, Math.min(sourceHeight - 1, y0 + 1))
    const weightY = Math.max(0, Math.min(1, sourceY - y0))
    const row0 = sourcePlane + y0 * sourceWidth
    const row1 = sourcePlane + y1 * sourceWidth
    const destinationRow = destinationPlane + (offsetY + y) * destinationWidth + offsetX
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = (x + 0.5) * stepX - 0.5
      const x0 = Math.max(0, Math.min(sourceWidth - 1, Math.floor(sourceX)))
      const x1 = Math.max(0, Math.min(sourceWidth - 1, x0 + 1))
      const weightX = Math.max(0, Math.min(1, sourceX - x0))
      const top = source[row0 + x0]! * (1 - weightX) + source[row0 + x1]! * weightX
      const bottom = source[row1 + x0]! * (1 - weightX) + source[row1 + x1]! * weightX
      destination[destinationRow + x] = clampToDtype(dtype, top * (1 - weightY) + bottom * weightY)
    }
  }
}

export interface MakeMontageOptions {
  columns: number
  rows: number
  scale: number
  /** 面板之间的边框宽度（像素）；外沿不加边框。 */
  borderWidth: number
  /** 参与的面板页下标（顺序即面板顺序，行优先填充）。 */
  frames: readonly number[]
  readFrame(index: number): Promise<ImageBlock>
  /** 调用方已经读过的首页（用于算自动布局时避免重复读取）。 */
  firstBlock?: ImageBlock
  /** 是否在面板底部居中标注切片文本（ImageJ 的 `Label slices`）。 */
  labelSlices?: boolean
  /** 标注字号；缺省 12，与 ImageJ 的对话框默认值一致。 */
  fontSize?: number
  /** 每个面板的标签文本；缺省用页序号（1-based）。 */
  labelAt?(frameIndex: number): string
  signal?: AbortSignal
}

/** 把若干页拼成一张蒙太奇图（单页，尺寸与 dtype 由输入与参数决定）。 */
export async function makeMontage(options: MakeMontageOptions): Promise<ImageBlock> {
  const { columns, rows, scale, borderWidth, frames } = options
  if (frames.length === 0) throw new RangeError('Make Montage 至少需要一页')
  if (columns < 1 || rows < 1) throw new RangeError('Make Montage 的行列必须是正整数')
  const first = options.firstBlock ?? await options.readFrame(frames[0]!)
  const xi = first.axes.indexOf('x')
  const yi = first.axes.indexOf('y')
  const width = first.shape[xi]!
  const height = first.shape[yi]!
  const panelWidth = Math.max(1, Math.trunc(width * scale))
  const panelHeight = Math.max(1, Math.trunc(height * scale))
  const outWidth = panelWidth * columns + borderWidth * Math.max(0, columns - 1)
  const outHeight = panelHeight * rows + borderWidth * Math.max(0, rows - 1)
  const planes = Math.max(1, elementCount(first.shape) / (width * height))
  const outShape = [...first.shape]
  outShape[yi] = outHeight
  outShape[xi] = outWidth
  const out = allocateBuffer(first.dtype, elementCount(outShape))
  const destination = numberView(out)
  // 背景保持 0：ImageJ 在未指定前景/背景色时用黑底（`MontageMaker.java:171-199` 的默认分支）。
  const panelCount = Math.min(frames.length, columns * rows)
  for (let panel = 0; panel < panelCount; panel += 1) {
    if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    const block = panel === 0 ? first : await options.readFrame(frames[panel]!)
    const source = numberView(block.data)
    const offsetX = (panel % columns) * (panelWidth + borderWidth)
    const offsetY = Math.floor(panel / columns) * (panelHeight + borderWidth)
    for (let plane = 0; plane < planes; plane += 1) {
      resamplePlane({
        source,
        sourceWidth: width,
        sourceHeight: height,
        destination,
        destinationWidth: outWidth,
        destinationHeight: outHeight,
        plane,
        targetWidth: panelWidth,
        targetHeight: panelHeight,
        offsetX,
        offsetY,
        dtype: first.dtype,
      })
    }
    if (options.labelSlices) {
      const fontSize = Math.max(5, Math.floor(options.fontSize ?? 12))
      const text = options.labelAt?.(frames[panel]!) ?? String(frames[panel]! + 1)
      const labelX = offsetX + Math.max(0, Math.floor((panelWidth - textWidth(text, fontSize)) / 2))
      const labelY = offsetY + Math.max(0, panelHeight - textHeight(fontSize))
      drawText(
        { data: out, width: outWidth, height: outHeight, planes },
        text,
        labelX,
        labelY,
        { fontSize, color: defaultLabelColor(first.dtype) },
      )
    }
  }
  return {
    dtype: first.dtype,
    axes: first.axes,
    shape: outShape,
    region: { start: first.shape.map(() => 0), shape: outShape },
    data: out,
  }
}

export interface SplitMontageOptions {
  columns: number
  rows: number
  /** 每个面板四边要裁掉的宽度（ImageJ 的 Border width）；0 表示不裁。 */
  borderWidth: number
}

/**
 * Montage to Stack（Image ▸ Stacks ▸ Tools ▸ Montage to Stack...，ImageJ 的 `ij/plugin/StackMaker.java`）。
 *
 * 与 ImageJ 一致：
 * - 面板按行优先切出，与 Make Montage 的填充顺序互为逆运算；
 * - 尺寸用整除截断（`w = W/columns`、`h = H/rows`），不能整除时右侧/下侧的余量被丢弃；
 * - 边框裁剪量与 ImageJ 相同：起点为 `border + border/2`（整数除法，`StackMaker.java:61-79`）。
 */
export function splitMontage(block: ImageBlock, options: SplitMontageOptions): ImageBlock[] {
  const { columns, rows, borderWidth } = options
  if (columns < 1 || rows < 1) throw new RangeError('Montage to Stack 的行列必须是正整数')
  const xi = block.axes.indexOf('x')
  const yi = block.axes.indexOf('y')
  const width = block.shape[xi]!
  const height = block.shape[yi]!
  // 面板宽度要把面板之间的边框排除掉，才能与 makeMontage 的 outW = w*C + bw*(C-1) 互逆。
  // ImageJ 的 StackMaker 直接用 W/columns（把边框算进格子），因此它的往返在带边框时不精确；
  // 这里取互逆的定义，属有意的行为差异（见移植文档 §4.9）。
  const panelWidth = Math.trunc((width - borderWidth * (columns - 1)) / columns)
  const panelHeight = Math.trunc((height - borderWidth * (rows - 1)) / rows)
  if (panelWidth < 1 || panelHeight < 1) throw new Error('行列数超过了图像尺寸')
  // ImageJ 的裁剪量不对称：左边裁 border、右边裁 border/2（`StackMaker.java:61-79`）。
  const left = borderWidth
  const right = Math.floor(borderWidth / 2)
  const sliceWidth = panelWidth - left - right
  const sliceHeight = panelHeight - left - right
  if (sliceWidth < 1 || sliceHeight < 1) throw new Error('边框宽度超过了面板尺寸')

  const planes = Math.max(1, elementCount(block.shape) / (width * height))
  const source = numberView(block.data)
  const sourcePlane = width * height
  const slicePlane = sliceWidth * sliceHeight
  const pageShape = [...block.shape]
  pageShape[yi] = sliceHeight
  pageShape[xi] = sliceWidth
  const pages: ImageBlock[] = []
  for (let panel = 0; panel < rows * columns; panel += 1) {
    const originX = (panel % columns) * (panelWidth + borderWidth) + left
    const originY = Math.floor(panel / columns) * (panelHeight + borderWidth) + left
    const out = allocateBuffer(block.dtype, elementCount(pageShape))
    const destination = numberView(out)
    for (let plane = 0; plane < planes; plane += 1) {
      const from = plane * sourcePlane
      const to = plane * slicePlane
      for (let y = 0; y < sliceHeight; y += 1) {
        const row = from + (originY + y) * width + originX
        const target = to + y * sliceWidth
        for (let x = 0; x < sliceWidth; x += 1) destination[target + x] = source[row + x]!
      }
    }
    pages.push({
      dtype: block.dtype,
      axes: block.axes,
      shape: [...pageShape],
      region: { start: block.shape.map(() => 0), shape: [...pageShape] },
      data: out,
    })
  }
  return pages
}
