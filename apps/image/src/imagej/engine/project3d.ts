/**
 * 3D Project 内核（Image ▸ Stacks ▸ 3D Project...，ImageJ 的 `ij/plugin/Projector.java`）。
 *
 * 与 ImageJ 一致的部分：
 * - 三个旋转轴（X / Y / Z）与三种投影方法（Nearest Point / Brightest Point / Mean Value，
 *   `Projector.java:491-783`）；
 * - 角度序列：`nProj = floor(|总旋转| / 角度增量) + 1`，角度从初始角起按增量步进（`Projector.java:104-163`）；
 * - 投影画布尺寸（`Projector.java:461-481`）：
 *   - 绕 Y 轴：`宽 = round(sqrt((nSlices·si)² + W²))`，高 = H；
 *   - 绕 X 轴：宽 = W，`高 = round(sqrt((nSlices·si)² + H²))`；
 *   - 绕 Z 轴：宽高都取对角式，宽为奇数时 +1；
 *   其中 `si = pixelDepth / pixelWidth` 是切片间距（未标定时为 1）。
 * - 深度提示（Surface / Interior depth-cueing）：`值 × (1 - 强度 × 由远及近的比例)`；
 * - 不透明度（Opacity）：最终结果 = `(opacity·表面 + (100-opacity)·体渲染) / 100`。
 *
 * 有意的差异（见移植文档 §4.18）：
 * - ImageJ 会先把 16/32 位输入降到 8 位（`Projector.java:276-281`）；本项目保留输入 dtype；
 * - `Interpolate` 的 z 方向插值与超栈的 `All time points` 未提供；
 * - ImageJ 用整数定点（`BIGPOWEROF2 = 8192`）算旋转，这里是浮点 —— 逐像素的角度采样因此略有不同。
 */
import { allocateBuffer, type Dtype, type ImageBlock, type PixelArray } from './types.ts'
import { pageGeometry } from './stackCombine.ts'

export type Projection3dMethod = 'nearest' | 'brightest' | 'mean'
export type Projection3dAxis = 'x' | 'y' | 'z'

export const PROJECTION_3D_METHODS: readonly Projection3dMethod[] = ['nearest', 'brightest', 'mean']
export const PROJECTION_3D_AXES: readonly Projection3dAxis[] = ['x', 'y', 'z']

/** 逐像素工作量上限（角度 × 切片 × 像素）；超过时给出明确报错而不是让页面卡住。 */
export const PROJECTION_3D_BUDGET = 4e8

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

/** 角度序列：与 ImageJ 的 `nProj = floor(总旋转 / 增量) + 1` 一致。 */
export function projection3dAngles(initial: number, total: number, increment: number): number[] {
  const step = Number.isFinite(increment) && increment !== 0 ? Math.abs(increment) : 10
  const count = Math.max(1, Math.floor(Math.abs(total) / step) + 1)
  const direction = increment < 0 ? -1 : 1
  return Array.from({ length: count }, (_, index) => initial + direction * index * step)
}

/** 投影画布尺寸；`sliceInterval` 是切片间距与像素宽度的比值。 */
export function projection3dSize(
  axis: Projection3dAxis,
  width: number,
  height: number,
  slices: number,
  sliceInterval: number,
): { width: number; height: number } {
  const depth = slices * sliceInterval
  const diagonalWidth = Math.round(Math.sqrt(depth * depth + width * width))
  const diagonalHeight = Math.round(Math.sqrt(depth * depth + height * height))
  if (axis === 'y') return { width: diagonalWidth, height }
  if (axis === 'x') return { width, height: diagonalHeight }
  // 绕 Z 轴：两个方向都要能容纳对角，且宽度取偶数（ImageJ 的写法）。
  return { width: diagonalWidth % 2 === 1 ? diagonalWidth + 1 : diagonalWidth, height: diagonalHeight }
}

export interface Project3dOptions {
  method: Projection3dMethod
  axis: Projection3dAxis
  initialAngle: number
  totalRotation: number
  angleIncrement: number
  /** 切片间距 / 像素宽度；未标定时为 1。 */
  sliceInterval: number
  /** 不透明度 0-100：0 全用体渲染，100 全用表面。 */
  opacity: number
  /** 表面深度提示强度 0-100。 */
  surfaceCueing: number
  /** 内部深度提示强度 0-100。 */
  interiorCueing: number
  /** 参与投影的切片页下标（顺序即 z 顺序）。 */
  frames: readonly number[]
  readFrame(index: number): Promise<ImageBlock>
  /** 逐像素工作量上限；缺省用 `PROJECTION_3D_BUDGET`（测试用更小的值验证保护分支）。 */
  budget?: number
  signal?: AbortSignal
}

/** 逐像素工作量：角度数 × 切片数 × 单页像素数。 */
export function projectionWorkload(angles: number, slices: number, width: number, height: number): number {
  return angles * slices * width * height
}

/** 逐角度旋转投影；返回的每一页对应一个角度。 */
export async function project3d(options: Project3dOptions): Promise<ImageBlock[]> {
  if (options.frames.length === 0) throw new RangeError('3D Project 至少需要一页')
  const blocks: ImageBlock[] = []
  for (const index of options.frames) {
    if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    blocks.push(await options.readFrame(index))
  }
  const first = blocks[0]!
  const geometry = pageGeometry(first)
  if (geometry.planes > 1) throw new Error('3D Project 暂不支持多通道数据，请先转换为灰度')
  const width = geometry.width
  const height = geometry.height
  const slices = blocks.length
  const sliceInterval = Number.isFinite(options.sliceInterval) && options.sliceInterval > 0 ? options.sliceInterval : 1
  const angles = projection3dAngles(options.initialAngle, options.totalRotation, options.angleIncrement)
  const size = projection3dSize(options.axis, width, height, slices, sliceInterval)
  const work = projectionWorkload(angles.length, slices, width, height)
  if (work > (options.budget ?? PROJECTION_3D_BUDGET)) {
    throw new Error(`3D Project 的计算量过大（约 ${Math.round(work / 1e6)} 百万像素次），请增大角度增量或缩小切片范围`)
  }

  const pixels = size.width * size.height
  const sources = blocks.map((block) => numberView(block.data))
  const zCenter = ((slices - 1) * sliceInterval) / 2
  /** 深度提示的归一化分母：最远与最近切片的间距。 */
  const maxDepth = (slices - 1) * sliceInterval
  const xCenter = (width - 1) / 2
  const yCenter = (height - 1) / 2
  // 旋转中心对齐到投影画布中心（两者尺寸不同，必须用各自的几何中心）。
  const projectionCenterX = (size.width - 1) / 2
  const projectionCenterY = (size.height - 1) / 2
  const opacity = Math.max(0, Math.min(100, options.opacity))
  const surfaceCueing = Math.max(0, Math.min(100, options.surfaceCueing)) / 100
  const interiorCueing = Math.max(0, Math.min(100, options.interiorCueing)) / 100

  const pages: ImageBlock[] = []
  for (const angle of angles) {
    if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    const out = allocateBuffer(first.dtype, pixels)
    const view = numberView(out)
    const depth = new Float64Array(pixels).fill(Number.POSITIVE_INFINITY)
    const surface = new Float64Array(pixels)
    const volume = new Float64Array(pixels)
    const sum = new Float64Array(pixels)
    const count = new Uint32Array(pixels)
    const radians = (angle * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)

    for (let z = 0; z < slices; z += 1) {
      const source = sources[z]!
      const sourceZ = z * sliceInterval
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const dx = x - xCenter
          const dy = y - yCenter
          const dz = sourceZ - zCenter
          let rotatedX = dx
          let rotatedY = dy
          let targetDepth = sourceZ
          if (options.axis === 'y') {
            rotatedX = dx * cos - dz * sin
            targetDepth = zCenter + dx * sin + dz * cos
          } else if (options.axis === 'x') {
            rotatedY = dy * cos - dz * sin
            targetDepth = zCenter + dy * sin + dz * cos
          } else {
            rotatedX = dx * cos - dy * sin
            rotatedY = dx * sin + dy * cos
          }
          const targetX = Math.round(projectionCenterX + rotatedX)
          const targetY = Math.round(projectionCenterY + rotatedY)
          if (targetX < 0 || targetX >= size.width || targetY < 0 || targetY >= size.height) continue
          const index = targetY * size.width + targetX
          const value = source[y * width + x]!
          // 深度提示：越远越暗（由远及近的比例 0..1）。
          const near = maxDepth > 0 ? Math.max(0, Math.min(1, targetDepth / maxDepth)) : 1
          const surfaceFactor = 1 - surfaceCueing * (1 - Math.max(0, Math.min(1, near)))
          const interiorFactor = 1 - interiorCueing * (1 - Math.max(0, Math.min(1, near)))

          // 表面缓冲始终取最近的采样点（Nearest Point 的结果）。
          if (targetDepth < depth[index]!) {
            depth[index] = targetDepth
            surface[index] = value * surfaceFactor
          }
          // 体渲染缓冲按方法累积。
          if (options.method === 'brightest') {
            if (value * interiorFactor > volume[index]!) volume[index] = value * interiorFactor
          } else {
            sum[index] += value * interiorFactor
            count[index] = (count[index] ?? 0) + 1
          }
        }
      }
    }

    for (let index = 0; index < pixels; index += 1) {
      const surfaceValue = surface[index]!
      let volumeValue: number
      if (options.method === 'brightest') volumeValue = volume[index]!
      else if (options.method === 'mean') volumeValue = count[index]! > 0 ? sum[index]! / count[index]! : 0
      else volumeValue = surfaceValue
      const blended = (opacity * surfaceValue + (100 - opacity) * volumeValue) / 100
      view[index] = clampToDtype(first.dtype, blended)
    }

    pages.push({
      dtype: first.dtype,
      axes: ['y', 'x'] as const,
      shape: [size.height, size.width],
      region: { start: [0, 0], shape: [size.height, size.width] },
      data: out,
    })
  }
  return pages
}
