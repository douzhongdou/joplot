/**
 * P0 数据契约：Storage 与区域读取。
 *
 * Storage 以「读取指定区域」为主要接口，并提供元信息、能力查询和资源释放。
 * 第一版文件来源保留原始 File/Blob，内存缓存交给 scheduler 管理。后续接入
 * 磁盘派生缓存、Zarr 或远程来源时不改变这里的科学语义。
 */
import {
  DTYPE_BYTES,
  allocateBuffer,
  elementCount,
  type Dtype,
  type ImageBlock,
  type PixelArray,
  type Region,
  type Axes,
  type ChannelInfo,
  type SpatialTransform,
  type SourceRef,
  type TimeCalibration,
} from './types.ts'

export interface StorageMetadata {
  dtype: Dtype
  axes: Axes
  shape: readonly number[]
  spatialTransform?: SpatialTransform
  timeCalibration?: TimeCalibration
  channels?: readonly ChannelInfo[]
  source: SourceRef
  metadata?: Readonly<Record<string, string | number | boolean>>
}

export interface StorageCapabilities {
  /** 是否支持任意子区域读取。 */
  regionRead: boolean
  /** 是否支持按页读取（通常 regionRead 的子集）。 */
  pageRead: boolean
  /** 源是否压缩（读取时可能产生解码开销）。 */
  compressed: boolean
  /** 支持的 dtype 列表。 */
  dtypes: readonly Dtype[]
  /** 数据的维度。 */
  dimensions: number
}

export interface ReadRegionOptions {
  /** 取消信号；实现应在关键点检查。 */
  signal?: AbortSignal
  /** 允许把结果缓冲的所有权转交给调用方（转移后 Storage 不得再引用）。 */
  transfer?: boolean
}

export interface Storage {
  readonly id: string
  metadata(): StorageMetadata
  capabilities(): StorageCapabilities
  /** 读取指定区域，返回行优先、x 变化最快的连续缓冲。 */
  readRegion(region: Region, options?: ReadRegionOptions): Promise<ImageBlock>
  /** 释放底层资源（文件句柄、缓存等）。 */
  release(): void
}

/** 计算区域覆盖的元素数与字节数。 */
export function regionBytes(region: Region, dtype: Dtype): number {
  return elementCount(region.shape) * DTYPE_BYTES[dtype]
}

/** 校验区域与 axes/shape 是否一致，越界即抛出。 */
export function validateRegion(region: Region, axes: Axes, shape: readonly number[]): void {
  if (region.start.length !== axes.length || region.shape.length !== axes.length) {
    throw new RangeError('Region 的 start/shape 长度必须与 axes 一致')
  }
  for (let i = 0; i < shape.length; i += 1) {
    const begin = region.start[i] ?? 0
    const length = region.shape[i] ?? 0
    const total = shape[i] ?? 0
    if (!Number.isInteger(begin) || begin < 0 || begin >= total) {
      throw new RangeError(`Region 在轴 ${axes[i]} 的起点 ${begin} 越界`)
    }
    if (!Number.isInteger(length) || length < 1 || begin + length > total) {
      throw new RangeError(`Region 在轴 ${axes[i]} 的长度 ${length} 越界`)
    }
  }
}

/** 把区域夹取到有效范围内；完全越界时抛出。 */
export function clampRegion(region: Region, shape: readonly number[]): Region {
  const start: number[] = []
  const outShape: number[] = []
  for (let i = 0; i < shape.length; i += 1) {
    const total = shape[i] ?? 0
    const begin = Math.max(0, Math.min(total - 1, region.start[i] ?? 0))
    const length = Math.max(0, Math.min(total - begin, region.shape[i] ?? 0))
    if (length === 0) throw new RangeError(`Region 在轴 ${i} 夹取后为空`)
    start.push(begin)
    outShape.push(length)
  }
  return { start, shape: outShape }
}

/** 整个数据的区域。 */
export function fullRegion(shape: readonly number[]): Region {
  return { start: shape.map(() => 0), shape: [...shape] }
}

/**
 * 内存 Storage：持有一块完整的连续缓冲，按区域切片。
 * 用于测试与「已解码整卷」的简单来源；不是大 Stack 的默认路径。
 */
export class MemoryStorage implements Storage {
  readonly id: string
  private readonly meta: StorageMetadata
  private readonly buffer: PixelArray
  private released = false

  constructor(id: string, meta: StorageMetadata, buffer: PixelArray) {
    if (buffer.length !== elementCount(meta.shape)) {
      throw new RangeError(
        `MemoryStorage 缓冲长度 ${buffer.length} 与 shape 元素数 ${elementCount(meta.shape)} 不一致`,
      )
    }
    this.id = id
    this.meta = meta
    this.buffer = buffer
  }

  metadata(): StorageMetadata {
    return this.meta
  }

  capabilities(): StorageCapabilities {
    return {
      regionRead: true,
      pageRead: true,
      compressed: false,
      dtypes: [this.meta.dtype],
      dimensions: this.meta.axes.length,
    }
  }

  readRegion(region: Region, options?: ReadRegionOptions): Promise<ImageBlock> {
    if (this.released) return Promise.reject(new Error('MemoryStorage 已释放'))
    validateRegion(region, this.meta.axes, this.meta.shape)
    if (options?.signal?.aborted) return Promise.reject(new DOMException('已取消', 'AbortError'))
    const { axes, shape, dtype } = this.meta
    const outCount = elementCount(region.shape)
    const out = allocateBuffer(dtype, outCount)
    const outNumbers = out as unknown as { [index: number]: number }
    const srcNumbers = this.buffer as unknown as { [index: number]: number }

    // 行优先线性化：先把 start/shape 展开成每一维的步长。
    const strides = new Array<number>(shape.length)
    let stride = 1
    for (let i = shape.length - 1; i >= 0; i -= 1) {
      strides[i] = stride
      stride *= shape[i] ?? 1
    }
    const outStrides = new Array<number>(region.shape.length)
    let os = 1
    for (let i = region.shape.length - 1; i >= 0; i -= 1) {
      outStrides[i] = os
      os *= region.shape[i] ?? 1
    }

    const dims = region.shape.length
    for (let outIndex = 0; outIndex < outCount; outIndex += 1) {
      let remainder = outIndex
      let srcIndex = 0
      for (let i = 0; i < dims; i += 1) {
        const coordinate = Math.floor(remainder / outStrides[i]!)
        remainder %= outStrides[i]!
        srcIndex += ((region.start[i] ?? 0) + coordinate) * strides[i]!
      }
      outNumbers[outIndex] = srcNumbers[srcIndex]!
    }

    return Promise.resolve({
      dtype,
      axes,
      shape: region.shape,
      region,
      data: out,
    })
  }

  release(): void {
    this.released = true
  }
}
