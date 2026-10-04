/**
 * Z 投影内核：Image ▸ Stacks ▸ Z Project... 与 Stacks ▸ Tools ▸ Grouped Z Project...
 * （ImageJ 对应 `ij/plugin/ZProjector.java` 与 `ij/plugin/GroupedZProjector.java`）。
 *
 * 与 ImageJ 一致的部分：
 * - 六种方法（Average / Max / Min / Sum / Standard Deviation / Median）的公式
 *   （`ZProjector.java:701-867`）；
 * - 输出 dtype 规则（`ZProjector.java:360-372`、`:639-642`）：Average / Max / Min 与输入同类型，
 *   Sum 与 Standard Deviation 恒为 32 位浮点，Median 在 8 位输入下为 8 位、其余为 32 位浮点；
 * - 标准差用样本口径 `sqrt((n·Σv² - (Σv)²) / (n·(n-1)))`，n==1 时为 0；
 * - 浮点数据跳过 NaN（ImageJ 的 average 浮点路径按非 NaN 计数）。
 *
 * 有意不照抄的部分（已在 docs/stack-commands-migration.md 记录）：
 * - RGB 栈：ImageJ 会先把三通道各自按自身 min/max 重新拉伸到 0..255 再合并，逐通道的原始
 *   动态范围会丢失。本项目的数据模型里 RGB 就是 `c` 轴上的三个平面，直接逐元素投影即可，
 *   因此保留原精度；
 * - 16 位有符号数据的 Sum 修正（`ZProjector.java:360-363` 的 `subtract(sliceCount*32768)`）不适用，
 *   本项目没有该标定语义。
 */
import { allocateBuffer, elementCount, type Dtype, type ImageBlock, type PixelArray } from './types.ts'

export type ProjectionMethod = 'average' | 'max' | 'min' | 'sum' | 'sd' | 'median'

/** 方法顺序与 ImageJ 的 `ZProjector.METHODS`（`:24-25`）一致。 */
export const PROJECTION_METHODS: readonly ProjectionMethod[] = ['average', 'max', 'min', 'sum', 'sd', 'median']

/** 投影输出的 dtype，规则见文件头。 */
export function projectionDtype(method: ProjectionMethod, input: Dtype): Dtype {
  if (method === 'sum' || method === 'sd') return 'float32'
  if (method === 'median') return input === 'uint8' ? 'uint8' : 'float32'
  return input
}

/** 以 number 读写 TypedArray：联合类型的索引赋值在 TS 下需要这一层转换。 */
interface NumberView {
  [index: number]: number
  length: number
}

function asNumbers(view: PixelArray): NumberView {
  return view as unknown as NumberView
}

/** 按目标 dtype 取整并夹取；非有限值原样保留（浮点输出用于暴露 NaN / Inf）。 */
function clampToDtype(dtype: Dtype, value: number): number {
  switch (dtype) {
    case 'uint8': return Math.max(0, Math.min(255, Math.round(value)))
    case 'uint16': return Math.max(0, Math.min(65535, Math.round(value)))
    case 'int16': return Math.max(-32768, Math.min(32767, Math.round(value)))
    case 'float32': return value
  }
}

/** 对某个像素位置上收集到的 count 个有效值做归约。 */
function reduceValues(values: Float64Array, count: number, method: ProjectionMethod): number {
  if (count === 0) return Number.NaN
  switch (method) {
    case 'average': {
      let sum = 0
      for (let i = 0; i < count; i += 1) sum += values[i]!
      return sum / count
    }
    case 'sum': {
      let sum = 0
      for (let i = 0; i < count; i += 1) sum += values[i]!
      return sum
    }
    case 'max': {
      let best = Number.NEGATIVE_INFINITY
      for (let i = 0; i < count; i += 1) if (values[i]! > best) best = values[i]!
      return best
    }
    case 'min': {
      let best = Number.POSITIVE_INFINITY
      for (let i = 0; i < count; i += 1) if (values[i]! < best) best = values[i]!
      return best
    }
    case 'sd': {
      if (count < 2) return 0
      let sum = 0
      let sumSquares = 0
      for (let i = 0; i < count; i += 1) {
        const value = values[i]!
        sum += value
        sumSquares += value * value
      }
      const variance = (count * sumSquares - sum * sum) / (count * (count - 1))
      return variance > 0 ? Math.sqrt(variance) : 0
    }
    case 'median': {
      const sorted = values.subarray(0, count)
      sorted.sort()
      const middle = count >> 1
      return count % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
    }
  }
}

export interface ProjectFramesOptions {
  method: ProjectionMethod
  /** 参与投影的页下标（0-based，顺序即读取顺序）。 */
  frames: readonly number[]
  readFrame(index: number): Promise<ImageBlock>
  signal?: AbortSignal
}

/**
 * 把若干页投影成一页。
 *
 * 输入各页必须同形（axes 与 shape 一致）；这是本项目的固有约束 —— 同一 Storage 的页本来就同形。
 */
export async function projectFrames(options: ProjectFramesOptions): Promise<ImageBlock> {
  const { method, frames } = options
  if (frames.length === 0) throw new RangeError('投影至少需要一页')
  const blocks: ImageBlock[] = []
  for (const index of frames) {
    if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    blocks.push(await options.readFrame(index))
  }
  if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError')

  const first = blocks[0]!
  const count = blocks.length
  const outputDtype = projectionDtype(method, first.dtype)
  const length = first.data.length
  const out = allocateBuffer(outputDtype, length)
  const dst = asNumbers(out)
  const sources = blocks.map((block) => asNumbers(block.data))
  // 逐像素复用同一个收集缓冲，避免为每个像素分配数组。
  const collected = new Float64Array(count)
  for (let i = 0; i < length; i += 1) {
    let seen = 0
    for (let k = 0; k < count; k += 1) {
      const value = sources[k]![i]!
      if (Number.isNaN(value)) continue
      collected[seen] = value
      seen += 1
    }
    dst[i] = clampToDtype(outputDtype, reduceValues(collected, seen, method))
  }
  return {
    dtype: outputDtype,
    axes: first.axes,
    shape: [...first.shape],
    region: { start: first.shape.map(() => 0), shape: [...first.shape] },
    data: out,
  }
}

/**
 * 把每页的投影结果拼成一块连续缓冲（供按轴顺序存放的新 Dataset 使用）。
 *
 * `pages[i]` 的像素块按顺序紧挨着摆放，与 `axes` 中前导轴的顺序一致。
 */
export function concatPages(pages: readonly ImageBlock[], dtype: Dtype): PixelArray {
  const first = pages[0]
  if (!first) throw new RangeError('拼接至少需要一页')
  const pageLength = first.data.length
  const out = allocateBuffer(dtype, pageLength * pages.length)
  const dst = asNumbers(out)
  for (let page = 0; page < pages.length; page += 1) {
    const source = asNumbers(pages[page]!.data)
    const offset = page * pageLength
    for (let i = 0; i < pageLength; i += 1) dst[offset + i] = source[i]!
  }
  return out
}

/** 校验各页同形；投影前用它给出明确报错，而不是产出错位像素。 */
export function assertSameShape(pages: readonly ImageBlock[]): void {
  const first = pages[0]
  if (!first) return
  for (const page of pages) {
    if (page.dtype !== first.dtype || page.axes.join('') !== first.axes.join('') || elementCount(page.shape) !== elementCount(first.shape)) {
      throw new Error('投影要求各页同数据类型、同尺寸')
    }
  }
}
