/**
 * 多来源页存储：把多个「单帧」来源合成一个 z 轴 Stack。
 *
 * 用于两条路径：
 * - 导入一个文件夹（每张图片一页）。
 * - 把多个单图 tab 合并成一个 Stack tab。
 *
 * 与 `TiffStackStorage` 的区别是页来自不同来源（不同文件 / 不同 Storage），
 * 而不是同一个 TIFF 的多个 IFD。约束与 ImageJ 的 VirtualStack 一致：
 * 所有页必须同 dtype、同 y/x 尺寸、同分量语义（标量或 RGB），且每页都是单帧。
 *
 * 轴映射：
 * | 子来源 | dataset.axes | shape |
 * | --- | --- | --- |
 * | 标量 | `['z','y','x']` | `[n,h,w]` |
 * | RGB | `['c','z','y','x']` | `[3,n,h,w]` |
 */
import type { Dtype, ImageBlock, Region } from './types.ts'
import { DTYPE_BYTES } from './types.ts'
import { validateRegion, type Storage, type StorageCapabilities, type StorageMetadata } from './storage.ts'

function sliceAxisIndex(axes: readonly string[]): number {
  return axes.findIndex((axis) => axis === 'z' || axis === 't')
}

export class MultiFrameStorage implements Storage {
  readonly id: string
  private readonly meta: StorageMetadata
  private readonly children: readonly Storage[]
  private readonly zAxis: number
  private released = false

  constructor(id: string, meta: StorageMetadata, children: readonly Storage[]) {
    if (children.length === 0) throw new RangeError('MultiFrameStorage 至少需要一个来源')
    this.id = id
    this.meta = meta
    this.children = children
    this.zAxis = sliceAxisIndex(meta.axes)
    const declared = this.zAxis >= 0 ? meta.shape[this.zAxis] : 1
    if (children.length !== declared) {
      throw new RangeError(`MultiFrameStorage 有 ${children.length} 个来源，与声明的 ${declared} 页不一致`)
    }
  }

  metadata(): StorageMetadata {
    return this.meta
  }

  capabilities(): StorageCapabilities {
    return {
      regionRead: true,
      pageRead: true,
      compressed: this.children.some((child) => child.capabilities().compressed),
      dtypes: [this.meta.dtype],
      dimensions: this.meta.axes.length,
    }
  }

  async readRegion(region: Region, options?: { signal?: AbortSignal; transfer?: boolean }): Promise<ImageBlock> {
    if (this.released) throw new Error('MultiFrameStorage 已释放')
    validateRegion(region, this.meta.axes, this.meta.shape)
    if (options?.signal?.aborted) throw new DOMException('已取消', 'AbortError')

    if (this.zAxis >= 0 && (region.shape[this.zAxis] ?? 0) !== 1) {
      throw new RangeError(`MultiFrameStorage 每次只能读取一页，收到切片轴长度 ${region.shape[this.zAxis]}`)
    }
    const page = this.zAxis >= 0 ? (region.start[this.zAxis] ?? 0) : 0
    const child = this.children[page]
    if (!child) throw new RangeError(`MultiFrameStorage 页码 ${page} 越界`)

    // 把 dataset 全轴 region 投影到子来源自己的轴上：空间轴取请求的子区域，其余轴取整段。
    const childMeta = child.metadata()
    const yIndex = this.meta.axes.indexOf('y'), xIndex = this.meta.axes.indexOf('x')
    const childRegion: Region = {
      start: childMeta.axes.map((axis) => axis === 'y' ? (region.start[yIndex] ?? 0) : axis === 'x' ? (region.start[xIndex] ?? 0) : 0),
      shape: childMeta.axes.map((axis) => axis === 'y' ? (region.shape[yIndex] ?? 0) : axis === 'x' ? (region.shape[xIndex] ?? 0) : (childMeta.shape[childMeta.axes.indexOf(axis)] ?? 1)),
    }
    const block = await child.readRegion(childRegion, options)
    if (options?.signal?.aborted) throw new DOMException('已取消', 'AbortError')

    // 用 dataset 全轴重写 axes/shape/region；像素布局与子块一致（前置轴长度均为 1）。
    return { dtype: block.dtype, axes: this.meta.axes, shape: [...region.shape], region: { start: [...region.start], shape: [...region.shape] }, data: block.data }
  }

  release(): void {
    if (this.released) return
    this.released = true
    for (const child of this.children) child.release()
  }
}

/** 单帧子来源的 dtype/尺寸摘要，用于合并前的兼容性校验。 */
export interface FrameSignature {
  dtype: Dtype
  width: number
  height: number
  componentKind: 'scalar' | 'rgb'
  /** 是否还有除 c/y/x 之外的非空轴（多页 / 时间），这类来源不能作为一页。 */
  multiFrame: boolean
  bytesPerPixel: number
}

/** 读取一个来源的签名；用于判断多个来源能否合成 Stack。 */
export function frameSignature(meta: StorageMetadata): FrameSignature {
  const y = meta.axes.indexOf('y'), x = meta.axes.indexOf('x')
  const componentKind = meta.shape[meta.axes.indexOf('c')] === 3 ? 'rgb' : 'scalar'
  const multiFrame = meta.axes.some((axis, index) => axis !== 'x' && axis !== 'y' && axis !== 'c' && (meta.shape[index] ?? 1) > 1)
  return {
    dtype: meta.dtype,
    width: meta.shape[x] ?? 0,
    height: meta.shape[y] ?? 0,
    componentKind,
    multiFrame,
    bytesPerPixel: DTYPE_BYTES[meta.dtype],
  }
}
