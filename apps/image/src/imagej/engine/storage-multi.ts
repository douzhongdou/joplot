/**
 * 多来源页存储。
 *
 * 用于两条路径：
 * - 导入一个文件夹（每张图片一页）。
 * - 把多个单图 tab 合并成一个 Stack tab。
 *
 * 关键点是**惰性**：导入时只解码第一页拿到 dtype / 尺寸 / 分量，其余页在翻到时才解码，
 * 并按字节预算做页级 LRU 缓存。这样 12 张 36MB 的 JPEG 不会在导入时一次性占满内存，
 * 翻页也只付「一页」的成本（配合运行时预取与缓存，来回翻页不重复解码）。
 *
 * 与 `TiffStackStorage` 的区别是页来自不同文件（而不是同一 TIFF 的多个 IFD）。
 * 约束与 ImageJ 的 VirtualStack 一致：所有页必须同 dtype、同 y/x 尺寸、同分量语义。
 *
 * 轴映射：
 * | 子来源 | dataset.axes | shape |
 * | --- | --- | --- |
 * | 标量 | `['z','y','x']` | `[n,h,w]` |
 * | RGB | `['c','z','y','x']` | `[3,n,h,w]` |
 */
import type { Dtype, ImageBlock, Region } from './types.ts'
import { DTYPE_BYTES } from './types.ts'
import { MemoryStorage, validateRegion, type Storage, type StorageCapabilities, type StorageMetadata } from './storage.ts'

function sliceAxisIndex(axes: readonly string[]): number {
  return axes.findIndex((axis) => axis === 'z' || axis === 't')
}

function blockBytes(block: ImageBlock): number {
  return block.data.length * block.data.BYTES_PER_ELEMENT
}

function frameSignature(block: ImageBlock): { dtype: Dtype; width: number; height: number; rgb: boolean; multiFrame: boolean } {
  const y = block.axes.indexOf('y'), x = block.axes.indexOf('x'), c = block.axes.indexOf('c')
  const multiFrame = block.axes.some((axis, index) => axis !== 'x' && axis !== 'y' && axis !== 'c' && (block.shape[index] ?? 1) > 1)
  return { dtype: block.dtype, width: block.shape[x] ?? 0, height: block.shape[y] ?? 0, rgb: c >= 0 && block.shape[c] === 3, multiFrame }
}

/** 解码某一页为「原生」块（axes 为 ['y','x'] 或 ['c','y','x']）。 */
export type PageDecoder = (file: File) => Promise<ImageBlock>

export class MultiFileStackStorage implements Storage {
  readonly id: string
  private readonly meta: StorageMetadata
  private readonly files: readonly File[]
  private readonly decode: PageDecoder
  private readonly zAxis: number
  private readonly maxCacheBytes: number
  private readonly expected: { dtype: Dtype; width: number; height: number; rgb: boolean }
  private readonly cache = new Map<number, ImageBlock>()
  private cacheBytes = 0
  private released = false

  constructor(id: string, meta: StorageMetadata, files: readonly File[], decode: PageDecoder, preload?: { index: number; block: ImageBlock }, maxCacheBytes = 128 * 1024 * 1024) {
    if (files.length === 0) throw new RangeError('MultiFileStackStorage 至少需要一个来源')
    this.id = id
    this.meta = meta
    this.files = files
    this.decode = decode
    this.zAxis = sliceAxisIndex(meta.axes)
    this.maxCacheBytes = maxCacheBytes
    const declared = this.zAxis >= 0 ? meta.shape[this.zAxis] : 1
    if (files.length !== declared) throw new RangeError(`MultiFileStackStorage 有 ${files.length} 个来源，与声明的 ${declared} 页不一致`)
    const ci = meta.axes.indexOf('c')
    this.expected = {
      dtype: meta.dtype,
      width: meta.shape[meta.axes.indexOf('x')] ?? 0,
      height: meta.shape[meta.axes.indexOf('y')] ?? 0,
      rgb: ci >= 0 && meta.shape[ci] === 3,
    }
    if (preload) { this.cache.set(preload.index, preload.block); this.cacheBytes += blockBytes(preload.block) }
  }

  metadata(): StorageMetadata {
    return this.meta
  }

  capabilities(): StorageCapabilities {
    return { regionRead: true, pageRead: true, compressed: false, dtypes: [this.meta.dtype], dimensions: this.meta.axes.length }
  }

  /** 取某一页（解码 + 校验 + LRU 缓存）。 */
  private async page(index: number): Promise<ImageBlock> {
    const cached = this.cache.get(index)
    if (cached) {
      // LRU：命中后移到队尾。
      this.cache.delete(index)
      this.cache.set(index, cached)
      return cached
    }
    if (this.released) throw new Error('MultiFileStackStorage 已释放')
    const file = this.files[index]
    if (!file) throw new RangeError(`MultiFileStackStorage 页码 ${index} 越界`)
    const block = await this.decode(file)
    const actual = frameSignature(block)
    if (actual.multiFrame) throw new Error(`「${file.name}」本身是多页 Stack，不能再作为一页合成 Stack`)
    if (actual.dtype !== this.expected.dtype || actual.width !== this.expected.width || actual.height !== this.expected.height || actual.rgb !== this.expected.rgb) {
      throw new Error(`「${file.name}」的位深 / 尺寸 / 分量与第一页不一致，无法作为同一 Stack`)
    }
    this.cache.set(index, block)
    this.cacheBytes += blockBytes(block)
    this.evict()
    return block
  }

  private evict(): void {
    while (this.cacheBytes > this.maxCacheBytes && this.cache.size > 1) {
      const oldest = this.cache.keys().next().value as number | undefined
      if (oldest === undefined) break
      const block = this.cache.get(oldest)!
      this.cache.delete(oldest)
      this.cacheBytes -= blockBytes(block)
    }
  }

  async readRegion(region: Region, options?: { signal?: AbortSignal; transfer?: boolean }): Promise<ImageBlock> {
    if (this.released) throw new Error('MultiFileStackStorage 已释放')
    validateRegion(region, this.meta.axes, this.meta.shape)
    if (options?.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    if (this.zAxis >= 0 && (region.shape[this.zAxis] ?? 0) !== 1) {
      throw new RangeError(`MultiFileStackStorage 每次只能读取一页，收到切片轴长度 ${region.shape[this.zAxis]}`)
    }
    const page = this.zAxis >= 0 ? (region.start[this.zAxis] ?? 0) : 0
    const frame = await this.page(page)
    if (options?.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    return this.align(frame, region)
  }

  /** 把原生页块裁剪/重写到 dataset 全轴。 */
  private async align(frame: ImageBlock, region: Region): Promise<ImageBlock> {
    const axes = this.meta.axes
    const yAxis = axes.indexOf('y'), xAxis = axes.indexOf('x')
    const whole = frame.axes.every((axis) => {
      const target = axis === 'y' ? yAxis : axis === 'x' ? xAxis : axes.indexOf(axis)
      return (region.start[target] ?? 0) === 0 && region.shape[target] === frame.shape[frame.axes.indexOf(axis)]
    })
    if (whole) return { dtype: frame.dtype, axes, shape: [...region.shape], region: { start: [...region.start], shape: [...region.shape] }, data: frame.data }
    // 需要空间裁剪：复用 MemoryStorage 的行拷贝实现。
    const cropRegion: Region = { start: frame.axes.map((axis) => region.start[axes.indexOf(axis)] ?? 0), shape: frame.axes.map((axis) => region.shape[axes.indexOf(axis)] ?? frame.shape[frame.axes.indexOf(axis)]) }
    const passthrough = new MemoryStorage(this.id, { dtype: frame.dtype, axes: frame.axes, shape: frame.shape, source: this.meta.source }, frame.data)
    const cropped = await passthrough.readRegion(cropRegion)
    return { dtype: frame.dtype, axes, shape: [...region.shape], region: { start: [...region.start], shape: [...region.shape] }, data: cropped.data }
  }

  release(): void {
    if (this.released) return
    this.released = true
    this.cache.clear()
    this.cacheBytes = 0
  }
}

/** 由块推导其签名，供导入期校验第一页。 */
export function pageSignature(block: ImageBlock): { dtype: Dtype; width: number; height: number; componentKind: 'scalar' | 'rgb'; bytesPerPixel: number } {
  const sig = frameSignature(block)
  return { dtype: sig.dtype, width: sig.width, height: sig.height, componentKind: sig.rgb ? 'rgb' : 'scalar', bytesPerPixel: DTYPE_BYTES[sig.dtype] }
}
