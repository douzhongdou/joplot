/**
 * TIFF 读取索引的数据契约。
 *
 * 参考实现为 ImageJ 1 的 `ij/io/TiffDecoder.java` 与 `ij/plugin/FileInfoVirtualStack.java`，
 * 关键做法沿用自 ImageJ：**遍历 IFD 链建立索引，一个像素字节都不读**。
 * `TiffDecoder.java:824-835` 以 `seek(ifdOffset)` 链式跳转，
 * `TiffDecoder.java:390-420` 通过 `saveLoc → seek(lvalue) → seek(saveLoc)` 取行外 tag 值数组，
 * 因此索引 IO 量只与「页数 × tag 数」相关，与文件大小无关。
 *
 * 与 ImageJ 的差异（均为补齐其缺口，证据见 docs/stack-architecture-decision.md §3）：
 * 1. ImageJ 拒绝 tiled TIFF（`TiffDecoder.java:538-540` 直接 `error()`），此处支持 tile。
 *    分段统一抽象为 `TiffSegment`，strip 与 tile 走同一结构。
 * 2. ImageJ 以 `getInt()` 读偏移，不支持 BigTIFF（`:398`、`:829`），此处支持。
 * 3. ImageJ 遇到 `nImages>1` 直接终止 IFD 链（`:833-834`），会丢失同一 IFD 内的其余帧，
 *    此处将其计入 `frames`。
 *
 * 本模块只做索引，不读取像素，也不做解压；取字节由 `PageSource` 负责。
 */

/** 分段布局方式。strip 为逐行条带，tile 为矩形块。 */
export type TiffLayout = 'strip' | 'tile'

/**
 * 一个像素分段（strip 或 tile）在文件中的字节位置与覆盖区域。
 *
 * strip 按行覆盖，tile 按矩形覆盖；两者字段相同，便于统一遍历。
 */
export interface TiffSegment {
  /** 该分段数据在文件中的起始字节偏移。 */
  offset: number
  /** 该分段数据字节数（压缩前）。 */
  byteLength: number
  /** 覆盖区域左上角 x，单位像素。 */
  x: number
  /** 覆盖区域左上角 y，单位像素。 */
  y: number
  /** 覆盖区域宽度，单位像素。 */
  width: number
  /** 覆盖区域高度，单位像素。 */
  height: number
}

/** 单页（单帧）的索引。 */
export interface TiffPage {
  width: number
  height: number
  /** 每通道位深，支持 8 / 16 / 32。 */
  bitsPerSample: number
  /** 每像素的通道数，1 为灰度，3 为 RGB。 */
  components: number
  /** SampleFormat：1 无符号整数，2 有符号整数，3 浮点。 */
  sampleFormat: number
  /** Compression tag 原值，未压缩为 1。 */
  compression: number
  /** PhotometricInterpretation tag 原值。 */
  photometric: number
  /** Predictor tag 原值，1 为无预测器。 */
  predictor: number
  layout: TiffLayout
  /** tile 边长；strip 布局下等于 width。 */
  tileWidth: number
  /** tile 边长；strip 布局下等于单条带行数。 */
  tileHeight: number
  segments: TiffSegment[]
  /**
   * 共享同一 IFD 的帧数。经典多页 TIFF 每个 IFD 一页，为 1；
   * 将多帧塞进单个 IFD 的格式（NIH Image 等）会大于 1。
   */
  frames: number
  /** 单帧解压后的像素字节数。 */
  pixelByteLength: number
}

/** 整个文件的索引。 */
export interface TiffIndex {
  /** 是否为 BigTIFF。 */
  big: boolean
  /** 是否小端字节序。 */
  littleEndian: boolean
  /** 文件字节数。 */
  byteLength: number
  pages: TiffPage[]
}

/** 已建立索引的 TIFF，可按需取页。 */
export interface IndexedTiff {
  index: TiffIndex
  /** 读取文件任意区间的字节。这是唯一的数据来源，必须保证惰性。 */
  read(offset: number, length: number): Promise<Uint8Array>
}

/** 取得某一页，页码 0 基。 */
export function pageAt(index: TiffIndex, page: number): TiffPage {
  const found = index.pages[page]
  if (!found) throw new RangeError(`page ${page} out of range (0..${index.pages.length - 1})`)
  return found
}

/** 索引总帧数，即所有页的 frames 之和。 */
export function totalFrames(index: TiffIndex): number {
  return index.pages.reduce((sum, page) => sum + page.frames, 0)
}

/**
 * 按可见区域裁剪出与之相交的分段，用于只读取视口所需的字节。
 *
 * 返回的分段保持原顺序，坐标仍为整页坐标系。
 * 未传 `region` 时返回全部分段。
 */
export function segmentsInRegion(page: TiffPage, region?: { x: number; y: number; width: number; height: number }): TiffSegment[] {
  if (!region) return page.segments
  const x1 = region.x + region.width
  const y1 = region.y + region.height
  return page.segments.filter((segment) => {
    if (region.x >= segment.x + segment.width || x1 <= segment.x) return false
    if (region.y >= segment.y + segment.height || y1 <= segment.y) return false
    return true
  })
}

/** 覆盖给定区域的分段字节数，用于估算读取量。 */
export function regionByteLength(page: TiffPage, region?: { x: number; y: number; width: number; height: number }): number {
  return segmentsInRegion(page, region).reduce((sum, segment) => sum + segment.byteLength, 0)
}