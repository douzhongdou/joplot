/**
 * 主线程同步直方图（用于显示）。
 *
 * 为什么需要它：worker 版分析每翻一页要 `block.data.slice()` 复制整帧（12–38 MB）再全图遍历，
 * 往返上百毫秒，而且为了让画面不闪，旧结果会一直保留到新结果返回——于是翻页时直方图明显滞后。
 * 但直方图所需的数据本来就在主线程内存里，所以这里同步扫一遍：抽样 stride 让成本降到
 * 全扫的 1/stride²（抽样直方图用于显示完全够看），精确统计仍由 worker 负责（测量、粒子等）。
 */

import type { ImageBlock } from '../engine/types'
import type { ColorChannel } from '../engine/colorAdjustments'

export interface FastHistogram {
  /** 桶计数，长度 = ceiling + 1（uint8 为 256，其余按数据类型的上界取）。 */
  counts: Uint32Array
  /** 参与统计的像素数（抽样后）。 */
  count: number
  /** 实际取到的最小 / 最大灰度。 */
  min: number
  max: number
  /** 值域下界与桶宽：值 = histogramMin + bin * binSize。 */
  histogramMin: number
  histogramMax: number
  /** true 表示这是抽样结果，读数应视为近似。 */
  sampled: boolean
}

/**
 * 抽样行距：像素越多隔行越多。
 *
 * 只按**行**抽样，行内始终逐像素连续访问。先前的按点抽样（每隔 stride 个像素取一个）是跳跃
 * 访问，cache 极不友好——4M 像素实测要 19ms，比顺序全扫还慢；改成整行连续后降到几毫秒。
 */
function rowStrideFor(pixels: number): number {
  if (pixels <= 1 << 22) return 1
  if (pixels <= 1 << 24) return 2
  return 4
}

const CHANNEL_INDEX: Record<ColorChannel, number> = { all: -1, red: 0, green: 1, blue: 2 }

/**
 * 同步计算整幅（或当前块）的直方图。
 *
 * `channel` 语义与 worker 一致：单通道数据忽略它；RGB 数据下 `all` 取三通道等权亮度，
 * 其余取对应通道。
 */
export function fastHistogram(block: ImageBlock, channel: ColorChannel = 'all'): FastHistogram {
  const xi = block.axes.indexOf('x')
  const yi = block.axes.indexOf('y')
  const ci = block.axes.indexOf('c')
  const width = block.shape[xi] ?? 0
  const height = block.shape[yi] ?? 0
  const channels = ci >= 0 ? (block.shape[ci] ?? 1) : 1
  const pixels = width * height
  const ceiling = block.dtype === 'uint16' ? 65535 : 255
  const bins = ceiling + 1
  const counts = new Uint32Array(bins)
  if (pixels <= 0) return { counts, count: 0, min: 0, max: ceiling, histogramMin: 0, histogramMax: ceiling, sampled: false }

  // 具体 TypedArray 的类型：写成 ArrayLike<number> 会让索引访问去优化。
  const data = block.data as unknown as Uint8Array | Uint16Array | Int16Array | Float32Array
  const rowStride = rowStrideFor(pixels)
  const selected = channels === 3 ? CHANNEL_INDEX[channel] : -1
  let seen = 0
  let min = bins
  let max = -1

  if (channels === 1 && block.dtype === 'uint8') {
    // 最常见的一条：8 位单通道。索引值本身就是要找的桶，连 clamp 都不需要，
    // 而且只有一种数组类型，V8 能把循环吃满——union 版本这里要慢 4 倍以上。
    const bytes = block.data as unknown as Uint8Array
    for (let y = 0; y < height; y += rowStride) {
      const row = y * width
      for (let x = 0; x < width; x += 1) {
        const bin = bytes[row + x]!
        counts[bin] += 1
        seen += 1
        if (bin < min) min = bin
        if (bin > max) max = bin
      }
    }
  } else if (channels === 3) {
    const greenOffset = pixels
    const blueOffset = 2 * pixels
    for (let y = 0; y < height; y += rowStride) {
      const row = y * width
      // 行内不抽样：连续访问才有 cache 友好性。
      for (let x = 0; x < width; x += 1) {
        const i = row + x
        const value = selected >= 0
          ? (data[selected * pixels + i] as number)
          : Math.round(((data[i] as number) + (data[greenOffset + i] as number) + (data[blueOffset + i] as number)) / 3)
        const bin = value < 0 ? 0 : value > ceiling ? ceiling : value | 0
        counts[bin] += 1
        seen += 1
        if (bin < min) min = bin
        if (bin > max) max = bin
      }
    }
  } else {
    for (let y = 0; y < height; y += rowStride) {
      const row = y * width
      for (let x = 0; x < width; x += 1) {
        const value = data[row + x] as number
        const bin = value < 0 ? 0 : value > ceiling ? ceiling : value | 0
        counts[bin] += 1
        seen += 1
        if (bin < min) min = bin
        if (bin > max) max = bin
      }
    }
  }

  return {
    counts,
    count: seen,
    min: max >= 0 ? min : 0,
    max: max >= 0 ? max : ceiling,
    histogramMin: 0,
    histogramMax: ceiling,
    sampled: rowStride > 1,
  }
}

