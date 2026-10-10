/**
 * 跨数据集的页合成内核：Image ▸ Stacks ▸ Tools 的 Insert / Combine / Concatenate。
 *
 * ImageJ 的对应实现都在「页」这一层搬像素：
 * - `StackInserter.java:60-90`：把源栈的第 i 页贴到目标栈第 i 页的 `(x, y)`，越界裁剪，
 *   源页数不足时重复使用最后一页（`ip1 = stack1[min(i, size1)]`）；
 * - `StackCombiner.java:69-137`：水平拼接取 `w1+w2 × max(h1,h2)`、垂直取 `max(w1,w2) × h1+h2`，
 *   页数取两者较大者，缺页的一侧留背景（`ip3.insert(..., w1, 0)` 即左上对齐）；
 * - `Concatenator.java:143-205`：各栈尺寸不同时，把较小的页**居中**放到最大宽高的画布上再首尾相接。
 *
 * 三者在本项目里都归结为「新建一块目标缓冲 + 把若干页 blit 进去」，因此共用下面两个纯函数。
 * 所有函数都只认「宽 × 高 × 平面数」，不关心轴顺序 —— 轴由调用方（引擎宿主）负责。
 */
import { allocateBuffer, type PixelArray } from './types.ts'

/** 一页的几何：宽、高与平面数（RGB 为 3，灰度标量为 1）。 */
export interface PageGeometry {
  width: number
  height: number
  planes: number
}

/** 由块推导页几何；x / y 之外的轴一律视为平面轴。 */
export function pageGeometry(block: { axes: readonly string[]; shape: readonly number[]; data: PixelArray }): PageGeometry {
  const width = block.shape[block.axes.indexOf('x')] ?? 1
  const height = block.shape[block.axes.indexOf('y')] ?? 1
  const pixels = Math.max(1, width * height)
  // RGB 的 `c` 轴长度就是平面数；其它前导轴在「页」的语境下长度都是 1。
  const channels = block.axes.indexOf('c')
  const planes = channels >= 0 ? block.shape[channels] ?? 1 : Math.max(1, Math.round(block.data.length / pixels))
  return { width, height, planes: Math.max(1, planes) }
}

/** 分配一块填 0 的目标缓冲（对应 ImageJ 的背景色填充；未标定时即黑底）。 */
export function emptyBuffer(dtype: Parameters<typeof allocateBuffer>[0], geometry: PageGeometry): PixelArray {
  return allocateBuffer(dtype, geometry.width * geometry.height * geometry.planes)
}

/**
 * 把一页拷贝到目标缓冲的 `(x, y)`。
 *
 * 越界部分被裁掉，与 ImageJ 的 `ImageProcessor.insert`（`copyBits(COPY)`）一致；
 * 平面数取两者较小者，避免把 3 通道的页贴进单通道缓冲。
 */
export function blitPage(
  destination: PixelArray,
  destinationGeometry: PageGeometry,
  source: PixelArray,
  sourceGeometry: PageGeometry,
  x: number,
  y: number,
): void {
  const dst = destination as unknown as { [index: number]: number }
  const src = source as unknown as { [index: number]: number }
  const planes = Math.min(destinationGeometry.planes, sourceGeometry.planes)
  const destinationPlane = destinationGeometry.width * destinationGeometry.height
  const sourcePlane = sourceGeometry.width * sourceGeometry.height
  const left = Math.max(0, Math.floor(x))
  const top = Math.max(0, Math.floor(y))
  const right = Math.min(destinationGeometry.width, left + sourceGeometry.width)
  const bottom = Math.min(destinationGeometry.height, top + sourceGeometry.height)
  if (right <= left || bottom <= top) return
  const rowWidth = right - left
  for (let plane = 0; plane < planes; plane += 1) {
    const from = plane * sourcePlane
    const to = plane * destinationPlane
    for (let row = top; row < bottom; row += 1) {
      const sourceRow = from + (row - top) * sourceGeometry.width + (left - Math.floor(x))
      const targetRow = to + row * destinationGeometry.width + left
      for (let i = 0; i < rowWidth; i += 1) dst[targetRow + i] = src[sourceRow + i]!
    }
  }
}

/** 把一页居中放到 `width × height` 的画布上（Concatenator 的做法）。 */
export function centerOffset(page: PageGeometry, width: number, height: number): { x: number; y: number } {
  return { x: Math.floor((width - page.width) / 2), y: Math.floor((height - page.height) / 2) }
}
