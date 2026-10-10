/**
 * 逐页剖面内核（Image ▸ Stacks ▸ Tools ▸ Plot XY Profile，ImageJ 的 `ij/plugin/StackPlotter.java`）。
 *
 * 与 ImageJ 一致的部分（`StackPlotter.java:60-88`）：
 * - 逐页取同一条剖面（矩形选区或线选区），曲面数量由切片数或帧数决定；
 * - 所有曲线**共用同一个纵轴刻度**（`ProfilePlot.setMinAndMax(ymin, ymax)`），
 *   因此曲线之间的高低可以直接比较 —— 这也是该命令区别于「每页各自缩放」的关键。
 *
 * 与 ImageJ 的差别：
 * - ImageJ 把每页曲线**栅格化成一张位图**（含坐标轴与网格）再拼成一个 `"Profile Plots"` 栈。
 *   本项目的引擎只产出曲线数据，绘制交给视图卡片：曲线能跟随主题缩放，也避免在 Worker 里
 *   做文本与坐标轴的光栅化（与 Montage 的标签绘制是同一类取舍）。
 * - 剖面的采样定义沿用本工作台既有口径（矩形取水平中线、线选区沿线取），见 `engine/analysis.ts`
 *   的 `profileBlock`；ImageJ 的 `ProfilePlot` 对矩形选区取的是**每一列的平均**。
 */
import type { ImageBlock } from './types.ts'

export interface StackProfilesInput {
  /** 切片轴上的页数。 */
  frameCount: number
  readFrame(index: number): Promise<ImageBlock>
  /** 把一页采样成一条剖面；各页长度应一致（不一致时按最短对齐）。 */
  sample(block: ImageBlock): number[]
  axis?: 'z' | 't' | 'c'
  signal?: AbortSignal
}

export interface StackProfilesResult {
  axis: 'z' | 't' | 'c'
  frameCount: number
  /** 每页一条剖面，顺序即遍历顺序。 */
  profiles: number[][]
  /** 对齐后的剖面长度。 */
  length: number
  /** 所有曲线的共同纵轴范围。 */
  min: number
  max: number
}

/** 逐页采样并汇总共用纵轴范围。 */
export async function computeStackProfiles(input: StackProfilesInput): Promise<StackProfilesResult> {
  const profiles: number[][] = []
  for (let index = 0; index < input.frameCount; index += 1) {
    if (input.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    const block = await input.readFrame(index)
    profiles.push(input.sample(block))
  }
  if (input.signal?.aborted) throw new DOMException('已取消', 'AbortError')

  const shortest = profiles.reduce((length, profile) => Math.min(length, profile.length), Number.POSITIVE_INFINITY)
  const length = Number.isFinite(shortest) ? shortest : 0
  const aligned = profiles.map((profile) => profile.slice(0, length))
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const profile of aligned) {
    for (const value of profile) {
      if (!Number.isFinite(value)) continue
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0
    max = 0
  }
  return { axis: input.axis ?? 'z', frameCount: aligned.length, profiles: aligned, length, min, max }
}
