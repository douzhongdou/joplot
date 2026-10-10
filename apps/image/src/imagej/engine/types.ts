/**
 * P0 数据契约：科学图像的基础类型。
 *
 * 这些类型对应《科学图像工作台架构方案》第 3 节 Dataset 数据模型，
 * 供 Storage / Compute / Render 三个适配层共用。它们只描述“数据是什么”，
 * 不涉及任何算法实现，也不依赖 I/O 或视口框架，因此可以在 Node 测试中直接运行。
 *
 * 坐标系约定：
 * - 逻辑轴顺序统一为 `[t?, c?, z?, y, x]`，`y`、`x` 必须存在且位于最后两位。
 * - 内存布局默认行优先（C order），`x` 变化最快。Adapter 负责与文件实际布局互转。
 */

/** 首期支持的像素类型。 */
export type Dtype = 'uint8' | 'uint16' | 'int16' | 'float32'

export const DTYPES: readonly Dtype[] = ['uint8', 'uint16', 'int16', 'float32']

/** 有语义的轴名。 */
export type AxisName = 't' | 'c' | 'z' | 'y' | 'x'

/** 轴的语义类别，用于 UI 与算法校验。 */
export type AxisKind = 'time' | 'channel' | 'space'

export interface Axis {
  name: AxisName
  /** 轴长度；必须为正整数。 */
  length: number
  kind: AxisKind
  /** 物理单位（空间轴为长度、时间轴为时间）；未知时为 undefined，不能假定默认值。 */
  unit?: string
}

const AXIS_KIND: Record<AxisName, AxisKind> = {
  t: 'time',
  c: 'channel',
  z: 'space',
  y: 'space',
  x: 'space',
}

/** 每个 dtype 的单元素字节数。 */
export const DTYPE_BYTES: Record<Dtype, number> = {
  uint8: 1,
  uint16: 2,
  int16: 2,
  float32: 4,
}

/** 每个 dtype 的合法取值区间（float32 无界，用 ±Infinity 表示）。 */
export const DTYPE_RANGE: Record<Dtype, readonly [number, number]> = {
  uint8: [0, 255],
  uint16: [0, 65535],
  int16: [-32768, 32767],
  float32: [-Infinity, Infinity],
}

/**
 * 空间标定。矩阵按 `[x, y, z]` 轴顺序解释，方向矩阵为 3×3 行优先、9 个元素。
 * 缺失的标定必须显式标记为未知，不能自动假定 spacing = 1。
 */
export interface SpatialTransform {
  /** 每个空间轴的像素间距，[x, y, z]。 */
  spacing: [number, number, number]
  /** 图像原点在世界坐标中的位置，[x, y, z]。 */
  origin: [number, number, number]
  /** 方向余弦矩阵，3×3 行优先，共 9 个元素。 */
  direction: [number, number, number, number, number, number, number, number, number]
  /** 空间单位，例如 'um'、'mm'、'px'。 */
  unit: string
  /** 标定是否来自文件；false 表示按像素单位占位，UI 必须提示“未标定”。 */
  calibrated: boolean
}

export interface TimeCalibration {
  unit: string
  /** 相邻帧的固定时间间隔；与 timestamps 二选一。 */
  interval?: number
  /** 逐帧时间戳；非均匀采样时保留实际值。 */
  timestamps?: number[]
}

export type ChannelKind = 'fluorescence' | 'rgb' | 'other'

export interface ChannelInfo {
  /** 通道在 `c` 轴上的索引。 */
  index: number
  name: string
  kind: ChannelKind
  wavelengthNm?: number
  /** 显示用建议颜色，[r, g, b] 0..255；不是科学数据。 */
  displayColor?: [number, number, number]
}

export type SourceFormat = 'tiff' | 'png' | 'webp' | 'fits' | 'raw' | 'memory' | 'unknown'

export interface SourceRef {
  kind: 'file' | 'memory'
  name: string
  format: SourceFormat
  /** 原始文件字节数；内存来源可为 undefined。 */
  byteLength?: number
  lastModified?: number
  /** 原始文件身份指纹（大小 + 修改时间的稳定哈希），用于缓存键。 */
  fingerprint: string
}

/** 逻辑轴顺序，与 shape 一一对应。 */
export type Axes = readonly AxisName[]

/** 区域查询：按 Dataset 逻辑轴给出的起点与长度。 */
export interface Region {
  /** 每个轴的起点；长度与 Dataset.axes 一致。 */
  start: readonly number[]
  /** 每个轴的读取长度；长度与 Dataset.axes 一致。 */
  shape: readonly number[]
}

/** 内存中的像素缓冲类型联合。 */
export type PixelArray = Uint8Array | Uint16Array | Int16Array | Float32Array

/** 内存中的一块像素数据，带显式布局信息。 */
export interface ImageBlock {
  dtype: Dtype
  /** 逻辑轴顺序。 */
  axes: Axes
  /** 该块的形状，与 axes 对应。 */
  shape: readonly number[]
  /** 该块在源 Dataset 中的区域。 */
  region: Region
  /** 行优先、x 变化最快的连续缓冲。 */
  data: PixelArray
}

/** 默认的、未标定的空间变换（按像素单位占位）。 */
export function uncalibratedSpatialTransform(): SpatialTransform {
  return {
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    unit: 'px',
    calibrated: false,
  }
}

/** 根据轴名生成合适的 kind。 */
export function axisKind(name: AxisName): AxisKind {
  return AXIS_KIND[name]
}

/** 校验轴序列：必须包含 y、x，且 y 在 x 之前，无重复。 */
export function isValidAxes(axes: Axes): boolean {
  if (axes.length < 2) return false
  const set = new Set(axes)
  if (set.size !== axes.length) return false
  const y = axes.indexOf('y')
  const x = axes.indexOf('x')
  if (x < 0 || y < 0 || y >= x) return false
  return axes.every((name) => name in AXIS_KIND)
}

/** 校验 shape 与 axes 对应，且每个维度为正整数。 */
export function isValidShape(axes: Axes, shape: readonly number[]): boolean {
  if (axes.length !== shape.length) return false
  return shape.every((n) => Number.isInteger(n) && n > 0)
}

/** 维度索引：返回某轴在 axes 中的位置，找不到返回 -1。 */
export function axisIndex(axes: Axes, name: AxisName): number {
  return axes.indexOf(name)
}

/** 交换两个轴的顺序，同时交换对应的 shape（用于布局互转）。 */
export function permuteShape(shape: readonly number[], order: readonly number[]): number[] {
  return order.map((i) => {
    const value = shape[i]
    if (value === undefined) throw new RangeError(`permuteShape: 轴索引越界 ${i}`)
    return value
  })
}

/** 计算一组维度的元素总数。 */
export function elementCount(shape: readonly number[]): number {
  return shape.reduce((product, n) => product * n, 1)
}

/** 由 dtype 与元素数估算字节数。 */
export function byteLength(dtype: Dtype, count: number): number {
  return count * DTYPE_BYTES[dtype]
}

/** 将任意类型的数组视图转换为普通数字数组（测试与调试用）。 */
export function blockToNumbers(block: ImageBlock): number[] {
  return Array.from(block.data as unknown as ArrayLike<number>)
}

/** 分配指定 dtype 的连续缓冲。 */
export function allocateBuffer(dtype: Dtype, count: number): PixelArray {
  switch (dtype) {
    case 'uint8': return new Uint8Array(count)
    case 'uint16': return new Uint16Array(count)
    case 'int16': return new Int16Array(count)
    case 'float32': return new Float32Array(count)
  }
}
