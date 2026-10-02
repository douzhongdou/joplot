/**
 * TIFF Stack 的惰性页存储。
 *
 * 这是 Stack 按页随机读取的接入点：整卷像素不驻留内存，`readRegion` 按需从文件读单页。
 *
 * 动机来自实测：`readImage` 会把整个 stack 一次性读入，
 * 300 页 4096×4096 uint16 推算为 9.6 GB，不可接受。
 * 本实现改为先用 `TiffPageSource` 建索引（索引阶段不读像素，见 `engine/tiff/indexer.ts`），
 * 翻页时才按页读。
 *
 * ## 轴映射
 *
 * TIFF 本身不携带 c/t/z 语义（OME-TIFF 的多维 metadata 需解析 OME-XML，不在本期范围），
 * 因此把「一个 IFD / 一页」映射为 z 轴上的一张切片：
 *
 * | 情况 | dataset.axes | shape |
 * | --- | --- | --- |
 * | 单页灰度 | `['y','x']` | `[h,w]` |
 * | 多页灰度 | `['z','y','x']` | `[pages,h,w]` |
 * | 单页 RGB | `['c','y','x']` | `[3,h,w]` |
 * | 多页 RGB | `['c','z','y','x']` | `[3,pages,h,w]` |
 *
 * ## 返回块的形状
 *
 * `TiffPageSource.readPage` 返回的块 axes 只有 `['y','x']` 或 `['c','y','x']`，
 * 而 `compute/engine.ts` 的 `frameSelectionRegion` 按 `dataset.axes` 全轴给出 region
 * （长度相等才合法）。因此这里必须把 axes / shape / region 重写为与 dataset 对齐，
 * 否则下游 `region.start[axisIndex]` 会错位。
 */
import type { Dtype, ImageBlock, Region } from './types.ts'
import { DTYPE_BYTES } from './types.ts'
import {
  MemoryStorage,
  validateRegion,
  type Storage,
  type StorageCapabilities,
  type StorageMetadata,
} from './storage.ts'
import type { TiffPageSource } from './tiff/source.ts'

/** dataset.axes 中表示「逐页切片」的轴：z 与 t。c 归 RGB 合成所有。 */
function sliceAxisIndex(axes: readonly string[]): number {
  return axes.findIndex((axis) => axis === 'z' || axis === 't')
}

export class TiffStackStorage implements Storage {
  readonly id: string
  private readonly meta: StorageMetadata
  private readonly source: TiffPageSource
  private readonly zAxis: number
  private readonly compressed: boolean
  private released = false

  constructor(id: string, meta: StorageMetadata, source: TiffPageSource) {
    this.id = id
    this.meta = meta
    this.source = source
    this.zAxis = sliceAxisIndex(meta.axes)
    this.compressed = source.index.pages.some((page) => page.compression !== 1)
    // 页数必须与 dataset 在切片轴上的长度一致，否则翻页会越界。
    const declared = this.zAxis >= 0 ? meta.shape[this.zAxis] : 1
    if (source.pageCount !== declared) {
      throw new RangeError(`TIFF 实际 ${source.pageCount} 页与 dataset 声明的 ${declared} 页不一致`)
    }
  }

  metadata(): StorageMetadata {
    return this.meta
  }

  capabilities(): StorageCapabilities {
    return {
      regionRead: true,
      pageRead: true,
      compressed: this.compressed,
      dtypes: [this.meta.dtype],
      dimensions: this.meta.axes.length,
    }
  }

  /** 单页解码后的字节数，供缓存预算估算。 */
  get pageByteLength(): number {
    return this.source.maxPageByteLength
  }

  async readRegion(region: Region, options?: { signal?: AbortSignal; transfer?: boolean }): Promise<ImageBlock> {
    if (this.released) throw new Error('TiffStackStorage 已释放')
    validateRegion(region, this.meta.axes, this.meta.shape)
    if (options?.signal?.aborted) throw new DOMException('已取消', 'AbortError')

    // 切片轴长度必须为 1（一次只读一页）；空间轴允许子区域，会在读出后裁剪。
    if (this.zAxis >= 0) {
      const length = region.shape[this.zAxis] ?? 0
      if (length !== 1) {
        throw new RangeError(`TiffStackStorage 每次只能读取一页，收到切片轴长度 ${length}`)
      }
    }
    const page = this.zAxis >= 0 ? (region.start[this.zAxis] ?? 0) : 0

    const frame = await this.source.readPage(page)
    if (options?.signal?.aborted) throw new DOMException('已取消', 'AbortError')

    return this.alignToDataset(frame.block, region)
  }

  /**
   * 把 `readPage` 的块重写为与 dataset.axes 对齐。
   *
   * 由块直接提供的轴（c / y / x）取块自身的形状；
   * 其余轴（z / t）来自切片选择，长度固定为 1。
   */
  private async alignToDataset(block: ImageBlock, region: Region): Promise<ImageBlock> {
    const axes = this.meta.axes
    // shape / start 一律取自请求的 region：由块提供的轴（c/y/x）与切片轴（z/t）都在其中。
    // 不能在此用 block.shape —— 非整页裁剪时 region 在空间轴上更短。
    const shape = [...region.shape]
    const start = [...region.start]

    // 整页且无空间裁剪时零拷贝返回，这是翻页的常见路径。
    const yAxis = axes.indexOf('y')
    const xAxis = axes.indexOf('x')
    const wholeFrame = yAxis >= 0 && xAxis >= 0
      && (start[yAxis] ?? 0) === 0
      && (start[xAxis] ?? 0) === 0
      && shape[yAxis] === block.shape[block.axes.indexOf('y')]
      && shape[xAxis] === block.shape[block.axes.indexOf('x')]
    if (wholeFrame) {
      return { dtype: block.dtype, axes, shape, region: { start, shape }, data: block.data }
    }

    // 需要空间裁剪。复用 MemoryStorage 的行拷贝实现，避免重复实现同一套步长逻辑。
    const cropRegion: Region = {
      start: block.axes.map((axis) => start[axes.indexOf(axis)] ?? 0),
      shape: block.axes.map((axis) => shape[axes.indexOf(axis)] ?? 0),
    }
    const passthrough = new MemoryStorage(
      this.id,
      {
        dtype: block.dtype,
        axes: block.axes,
        shape: block.shape,
        source: this.meta.source,
      },
      block.data,
    )
    const cropped = await passthrough.readRegion(cropRegion)
    return { dtype: block.dtype, axes, shape, region: { start, shape }, data: cropped.data }
  }

  release(): void {
    this.released = true
  }
}

/** 供 UI 展示的存储摘要：页数与单页字节数。 */
export interface TiffStackSummary {
  pages: number
  pageByteLength: number
  dtype: Dtype
  bytesPerElement: number
}

/** 汇总 Stack 的规模信息，用于内存预算提示。 */
export function summarizeStack(storage: TiffStackStorage): TiffStackSummary {
  return {
    pages: storage.metadata().shape[sliceAxisIndex(storage.metadata().axes)] ?? 1,
    pageByteLength: storage.pageByteLength,
    dtype: storage.metadata().dtype,
    bytesPerElement: DTYPE_BYTES[storage.metadata().dtype],
  }
}