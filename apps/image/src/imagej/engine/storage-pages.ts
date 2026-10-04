/**
 * 页映射存储：在不复制像素的前提下改变栈的页结构。
 *
 * 结构编辑类命令（Image ▸ Stacks 的 Add / Delete Slice、Tools ▸ Reduce、Make Substack、Reverse）
 * 都只是「换一组页」，不需要重新计算像素。这里把目标页映射到源页：
 *
 * ```text
 * pages = [2, 0, 1]         // 逆序 / 抽取 / 子栈都是这种映射
 * pages = [1, 'blank', 3]   // Add Slice 插入的空白页
 * ```
 *
 * 与 ImageJ 的对照：
 * - `ImageStack.deleteSlice` / `StackReducer` / `SubstackMaker` 都在内存里重排页数组，
 *   本项目只存一份 `pages` 索引，像素仍按需从源 Storage 读；
 * - `StackEditor` 的 Add Slice 插入的是**空白页**（`ij/plugin/StackEditor.java:43` 新建未填充的
 *   同类型处理器），这里用 `'blank'` 标记表示，读取时返回全 0 的缓冲。
 *
 * 约束与其它 Storage 一致：每次只能读一页（切片轴长度为 1），页内容必须与源同 dtype、同尺寸。
 */
import { allocateBuffer, elementCount, type ImageBlock, type Region } from './types.ts'
import { validateRegion, type Storage, type StorageCapabilities, type StorageMetadata, type ReadRegionOptions } from './storage.ts'

/** 目标页指向的源页；`'blank'` 表示空白页（全 0）。 */
export type PageRef = number | 'blank'

function blankBlock(meta: StorageMetadata, region: Region): ImageBlock {
  return {
    dtype: meta.dtype,
    axes: meta.axes,
    shape: [...region.shape],
    region: { start: [...region.start], shape: [...region.shape] },
    data: allocateBuffer(meta.dtype, elementCount(region.shape)),
  }
}

export class PageMapStorage implements Storage {
  readonly id: string
  private readonly meta: StorageMetadata
  private readonly source: Storage
  private readonly pages: readonly PageRef[]
  /** 切片轴在 axes 中的下标；-1 表示数据本身没有切片轴。 */
  private readonly sliceAxis: number
  private released = false

  constructor(id: string, meta: StorageMetadata, source: Storage, pages: readonly PageRef[], sliceAxis: number) {
    if (meta.axes.length !== source.metadata().axes.length) {
      throw new RangeError('PageMapStorage 的形状必须与源保持一致')
    }
    this.id = id
    this.meta = meta
    this.source = source
    this.pages = pages
    this.sliceAxis = sliceAxis
  }

  metadata(): StorageMetadata {
    return this.meta
  }

  capabilities(): StorageCapabilities {
    /*
     * `regionRead` 只在源支持时成立：本实现的任意子区域读取完全委托给源，
     * 自己只负责把切片轴的下标换成源页号。
     */
    const source = this.source.capabilities()
    return {
      regionRead: source.regionRead,
      pageRead: source.pageRead,
      compressed: source.compressed,
      dtypes: [this.meta.dtype],
      dimensions: this.meta.axes.length,
    }
  }

  async readRegion(region: Region, options?: ReadRegionOptions): Promise<ImageBlock> {
    if (this.released) throw new Error('PageMapStorage 已释放')
    validateRegion(region, this.meta.axes, this.meta.shape)
    if (options?.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    const axis = this.sliceAxis
    if (axis >= 0 && (region.shape[axis] ?? 0) !== 1) {
      throw new RangeError(`PageMapStorage 每次只能读取一页，收到切片轴长度 ${region.shape[axis]}`)
    }
    const index = axis >= 0 ? region.start[axis]! : 0
    const reference = this.pages[index]
    if (reference === undefined) throw new RangeError(`PageMapStorage 的页下标 ${index} 越界`)
    if (reference === 'blank') return blankBlock(this.meta, region)
    const sourceRegion: Region = axis >= 0
      ? { start: region.start.map((value, i) => (i === axis ? reference : value)), shape: [...region.shape] }
      : { start: [...region.start], shape: [...region.shape] }
    return this.source.readRegion(sourceRegion, options)
  }

  release(): void {
    // 源 Storage 由拥有者释放（同一个源可能被多个映射共享）。
    this.released = true
  }
}
