/**
 * Orthogonal Views 内核（Image ▸ Stacks ▸ Orthogonal Views，ImageJ 的
 * `ij/plugin/Orthogonal_Views.java`）。
 *
 * 与 ImageJ 一致的部分（`Orthogonal_Views.java:134-166`、`:406-565`）：
 * - 交叉点 `(x, y)` 默认取图像中心（ImageJ 也允许沿用上次位置）；
 * - **XZ 视图**：对每个 z 取源切片第 `y` 行 → 尺寸 `W × nSlices`，横轴是 x、纵轴是 z；
 * - **YZ 视图**：对每个 z 取源切片第 `x` 列 → 尺寸 `nSlices × H`（`rotateYZ=false` 时 z 在水平方向），
 *   横轴是 z、纵轴是 y；
 * - 只有 z 方向的物理间距与像素间距不相等（`az = pixelDepth / pixelWidth ≠ 1`）时才对整幅视图做一次
 *   双线性重采样（`Orthogonal_Views.java:98-107`、`:246-315`）。未标定的数据 `az = 1`，即不做缩放。
 *
 * 与 ImageJ 的差别：
 * - ImageJ 产出两个新窗口并带十字线覆盖层与联动交互；本项目只产出两张图（各自成为一个新文档），
 *   十字线这类覆盖层属于视图状态，不在数据层；
 * - ImageJ 的 `flipXZ` / `rotateYZ` 偏好（`Prefs`）未提供，输出固定为上面的默认朝向。
 */
import { allocateBuffer, type Dtype, type ImageBlock, type PixelArray } from './types.ts'

export interface OrthogonalPoint {
  x: number
  y: number
}

export interface OrthogonalOptions {
  /** 交叉点（图像坐标，0-based）；越界会被夹取。 */
  point: OrthogonalPoint
  /** 参与重建的源切片页下标（顺序即 z 顺序）。 */
  frames: readonly number[]
  readFrame(index: number): Promise<ImageBlock>
  /** z 方向相对像素的间距比 `pixelDepth / pixelWidth`；1 表示不缩放。 */
  zScale?: number
  signal?: AbortSignal
}

export interface OrthogonalResult {
  /** 横轴 x、纵轴 z（尺寸 `W × round(nSlices·zScale)`）。 */
  xz: ImageBlock
  /** 横轴 z、纵轴 y（尺寸 `round(nSlices·zScale) × H`）。 */
  yz: ImageBlock
}

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

/** 沿一条轴做双线性重采样（`targetLength === sourceLength` 时等价于直接拷贝）。 */
function resampleAxis(source: ArrayLike<number>, sourceLength: number, targetLength: number): Float64Array {
  const out = new Float64Array(targetLength)
  if (targetLength === sourceLength) {
    for (let i = 0; i < sourceLength; i += 1) out[i] = source[i]!
    return out
  }
  const step = sourceLength / targetLength
  for (let i = 0; i < targetLength; i += 1) {
    const position = (i + 0.5) * step - 0.5
    const i0 = Math.max(0, Math.min(sourceLength - 1, Math.floor(position)))
    const i1 = Math.max(0, Math.min(sourceLength - 1, i0 + 1))
    const weight = Math.max(0, Math.min(1, position - i0))
    out[i] = source[i0]! * (1 - weight) + source[i1]! * weight
  }
  return out
}

/** 由当前 z 栈重建 XZ 与 YZ 两张正交视图。 */
export async function orthogonalViews(options: OrthogonalOptions): Promise<OrthogonalResult> {
  if (options.frames.length === 0) throw new RangeError('Orthogonal Views 至少需要一页')
  const blocks: ImageBlock[] = []
  for (const index of options.frames) {
    if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    blocks.push(await options.readFrame(index))
  }
  if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError')

  const first = blocks[0]!
  const xi = first.axes.indexOf('x')
  const yi = first.axes.indexOf('y')
  const width = first.shape[xi]!
  const height = first.shape[yi]!
  const slices = blocks.length
  const x = Math.max(0, Math.min(width - 1, Math.round(options.point.x)))
  const y = Math.max(0, Math.min(height - 1, Math.round(options.point.y)))
  const zScale = options.zScale && options.zScale > 0 ? options.zScale : 1
  const zLength = Math.max(1, Math.round(slices * zScale))

  const planes = blocks.map((block) => numberView(block.data))
  const scratch = new Float64Array(slices)

  // XZ：逐 x 取一列 z 值，得到「横 x、纵 z」的视图。
  const xzData = allocateBuffer(first.dtype, width * zLength)
  const xz = numberView(xzData)
  for (let cx = 0; cx < width; cx += 1) {
    for (let z = 0; z < slices; z += 1) scratch[z] = planes[z]![y * width + cx]!
    const resampled = resampleAxis(scratch, slices, zLength)
    for (let row = 0; row < zLength; row += 1) xz[row * width + cx] = clampToDtype(first.dtype, resampled[row]!)
  }

  // YZ：逐 y 取一行 x 位置上的 z 值，得到「横 z、纵 y」的视图。
  const yzData = allocateBuffer(first.dtype, zLength * height)
  const yz = numberView(yzData)
  for (let cy = 0; cy < height; cy += 1) {
    for (let z = 0; z < slices; z += 1) scratch[z] = planes[z]![cy * width + x]!
    const resampled = resampleAxis(scratch, slices, zLength)
    for (let col = 0; col < zLength; col += 1) yz[cy * zLength + col] = clampToDtype(first.dtype, resampled[col]!)
  }

  const build = (data: PixelArray, shape: number[]): ImageBlock => ({
    dtype: first.dtype,
    axes: ['y', 'x'] as const,
    shape,
    region: { start: [0, 0], shape: [...shape] },
    data,
  })
  return { xz: build(xzData, [zLength, width]), yz: build(yzData, [height, zLength]) }
}
