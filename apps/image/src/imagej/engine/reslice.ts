/**
 * Reslice 内核（Image ▸ Stacks ▸ Reslice [/]...，ImageJ 的 `ij/plugin/Slicer.java`）。
 *
 * 与 ImageJ 一致的部分（矩形选区路径，`Slicer.java:357-472`）：
 * - 输出页数 = `(int)(roiH / d)`（Top / Bottom）或 `(int)(roiW / d)`（Left / Right），
 *   其中 `d` 是「相邻输出页沿垂直方向移动多少像素」（对话框里的 Output spacing 除以像素宽度）；
 * - Top / Left 从选区起点开始递增采样，Bottom / Right 从选区末端开始递减；
 * - 每页是「沿源切片轴堆起来的一维剖面」：不旋转时宽 = 剖面长度、高 = 源切片数；旋转 90° 则转置；
 * - `Flip vertically` 是把源切片逆序读出（`Slicer.java:483`），翻转的是输出的 z 方向而不是几何；
 * - 采样落在区域外时填 0（ImageJ 的 `getOrthoLine` 同样越界填 0，`Slicer.java:637-662`）。
 *
 * 尚未覆盖（见移植文档）：
 * - 线段 / 折线 / 自由线选区（ImageJ 会沿线取一维剖面并把线整体平移）；
 * - 输出 Z 间距带来的 z 方向重采样（默认 `Avoid interpolation` 下 ImageJ 也不重采样，
 *   本项目未标定的数据等价于该默认路径）；
 * - 输出栈的物理标定未按 `Slicer.java:129-171` 重算。
 */
import { allocateBuffer, type Dtype, type ImageBlock, type PixelArray } from './types.ts'

export type ResliceStart = 'top' | 'left' | 'bottom' | 'right'

export interface ResliceBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ResliceOptions {
  bounds: ResliceBounds
  /** 相邻输出页沿垂直方向移动的像素数。 */
  spacing: number
  startAt: ResliceStart
  /** 把源切片逆序读出。 */
  flip: boolean
  /** 输出转置（ImageJ 的 Rotate 90 degrees）。 */
  rotate: boolean
  /** 参与重切的源切片页下标（按顺序）。 */
  frames: readonly number[]
  /** 读取某一页；返回的块应当是选区内的像素（axes 为 `['y','x']`）。 */
  readFrame(index: number): Promise<ImageBlock>
  signal?: AbortSignal
}

function numberView(view: PixelArray): { [index: number]: number } {
  return view as unknown as { [index: number]: number }
}

function isHorizontal(startAt: ResliceStart): boolean {
  return startAt === 'top' || startAt === 'bottom'
}

/** 输出页数：ImageJ 的 `(int)(span / d)`，至少 1 页。 */
export function reslicePageCount(bounds: ResliceBounds, spacing: number, startAt: ResliceStart): number {
  const step = spacing > 0 ? spacing : 1
  const span = isHorizontal(startAt) ? bounds.height : bounds.width
  return Math.max(1, Math.floor(span / step))
}

/** 重切：返回输出栈的每一页。 */
export async function reslice(options: ResliceOptions): Promise<ImageBlock[]> {
  const { bounds, startAt, flip, rotate, frames } = options
  const step = options.spacing > 0 ? options.spacing : 1
  if (frames.length === 0) throw new RangeError('Reslice 至少需要一页')
  const horizontal = isHorizontal(startAt)
  const pageCount = reslicePageCount(bounds, step, startAt)

  const blocks: ImageBlock[] = []
  for (const index of frames) {
    if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    blocks.push(await options.readFrame(index))
  }
  if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError')

  const first = blocks[0]!
  const roiHeight = first.shape[first.axes.indexOf('y')]!
  const roiWidth = first.shape[first.axes.indexOf('x')]!
  const lineLimit = horizontal ? roiHeight : roiWidth
  const lineLength = horizontal ? roiWidth : roiHeight
  const ordered = flip ? [...blocks].reverse() : blocks
  const slices = ordered.length
  const outWidth = rotate ? slices : lineLength
  const outHeight = rotate ? lineLength : slices
  const shape = [outHeight, outWidth]

  const pages: ImageBlock[] = []
  for (let page = 0; page < pageCount; page += 1) {
    const out = allocateBuffer(first.dtype, outWidth * outHeight)
    const destination = numberView(out)
    // Bottom / Right 从选区末端往回走，与 ImageJ 的起点选择一致。
    const position = startAt === 'bottom' || startAt === 'right'
      ? lineLimit - 1 - page * step
      : page * step
    const line = Math.round(position)
    const valid = line >= 0 && line < lineLimit
    for (let z = 0; z < slices; z += 1) {
      const source = numberView(ordered[z]!.data)
      for (let i = 0; i < lineLength; i += 1) {
        const value = valid ? source[horizontal ? line * roiWidth + i : i * roiWidth + line]! : 0
        if (rotate) destination[i * outWidth + z] = value
        else destination[z * outWidth + i] = value
      }
    }
    pages.push({
      dtype: first.dtype,
      axes: ['y', 'x'] as const,
      shape: [...shape],
      region: { start: [0, 0], shape: [...shape] },
      data: out,
    })
  }
  return pages
}

/** 输出栈的 dtype（与输入一致）。 */
export function resliceDtype(input: Dtype): Dtype {
  return input
}
