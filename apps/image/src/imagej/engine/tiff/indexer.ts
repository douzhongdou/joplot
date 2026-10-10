/**
 * TIFF 索引建立：遍历 IFD 链，产出 `TiffIndex`。
 *
 * 本模块是 Stack 按页读取的地基。它**只读 IFD 区域与行外 tag 值数组，不读任何像素数据**，
 * 因此对数百页文件的索引开销在几十 KB 量级。
 *
 * IO 优化：ImageJ 对每个 `count>1` 的 tag 执行 `seek(saveLoc) → seek(lvalue) → 读 → seek(saveLoc)`
 * （`TiffDecoder.java:390-420`），一个 IFD 内会产生 4 次位置操作。此处改为
 * 「整 IFD 一次 slice」+「本页所有行外数组的区间合并为一次 slice」，
 * 典型单页 IO 由十余次降到 2 次。
 */

import { PHOTOMETRIC_CFA, PHOTOMETRIC_LINEAR_RAW, type IndexedTiff, type TiffCfaInfo, type TiffIndex, type TiffLayout, type TiffPage, type TiffSegment } from './index.ts'

/** TIFF 字段类型编号。 */
const TYPE_BYTE = 1
const TYPE_SHORT = 3
const TYPE_LONG = 4
const TYPE_RATIONAL = 5
const TYPE_SSHORT = 8
const TYPE_SLONG = 9
const TYPE_SRATIONAL = 10

/** 各字段类型的字节数；未列出的类型不支持读取 tag 值。 */
const FIELD_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4,
}

/**
 * BigTIFF 的 64 位字段类型。
 *
 * 经典 TIFF 中 type 13 是 4 字节的 IFD 指针，而 BigTIFF 需要 8 字节，因此
 * LONG8(16) / SLONG8(17) / IFD8(18) 以及复用为 LONG8 的 13 在 BigTIFF 下都占 8 字节。
 * BigTIFF 的偏移类 tag（StripOffsets、TileOffsets 等）正是以这些类型存储，
 * 若按 4 字节读取，超过 4 GiB 的偏移会被静默截断为 0。
 */
const BIG_FIELD_SIZE: Record<number, number> = { 13: 8, 16: 8, 17: 8, 18: 8 }

/** 取字段类型的字节数；BigTIFF 下 64 位类型按 8 字节处理。 */
function fieldSize(type: number, big: boolean): number | undefined {
  return big ? (FIELD_SIZE[type] ?? BIG_FIELD_SIZE[type]) : FIELD_SIZE[type]
}

const TAG_IMAGE_WIDTH = 256
const TAG_IMAGE_LENGTH = 257
const TAG_BITS_PER_SAMPLE = 258
const TAG_COMPRESSION = 259
const TAG_PHOTOMETRIC = 262
const TAG_STRIP_OFFSETS = 273
const TAG_SAMPLES_PER_PIXEL = 277
const TAG_ROWS_PER_STRIP = 278
const TAG_STRIP_BYTE_COUNTS = 279
const TAG_PLANAR_CONFIGURATION = 284
const TAG_PREDICTOR = 317
const TAG_TILE_WIDTH = 322
const TAG_TILE_LENGTH = 323
const TAG_TILE_OFFSETS = 324
const TAG_TILE_BYTE_COUNTS = 325
const TAG_SAMPLE_FORMAT = 339
const TAG_NEW_SUBFILE_TYPE = 254
const TAG_SUB_IFDS = 330
const TAG_CFA_REPEAT_PATTERN_DIM = 33421
const TAG_CFA_PATTERN = 33422
const TAG_BLACK_LEVEL = 50714
const TAG_WHITE_LEVEL = 50717
const TAG_DEFAULT_CROP_ORIGIN = 50719
const TAG_DEFAULT_CROP_SIZE = 50720

/** 一个已解析的 IFD 条目，值可能内联也可能位于文件中。 */
interface RawEntry {
  tag: number
  type: number
  count: number
  /** 内联值字节；为 undefined 表示值在文件的 offset 处。 */
  inline?: Uint8Array
  /** 行外值在文件中的偏移。 */
  offset?: number
}

/** 读取任意字节区间的函数。 */
type ByteReader = IndexedTiff['read']

/** 一次 slice 读取。 */
async function readBytes(read: ByteReader, offset: number, length: number): Promise<Uint8Array> {
  if (length === 0) return new Uint8Array(0)
  const bytes = await read(offset, length)
  if (bytes.length < length) throw new Error(`TIFF 读取越界：offset=${offset} length=${length} 实际=${bytes.length}`)
  return bytes
}

/** 读取文件头，判定字节序与是否 BigTIFF，并返回首个 IFD 偏移。 */
async function readHeader(read: ByteReader, byteLength: number): Promise<{ littleEndian: boolean; big: boolean; firstIfd: number }> {
  if (byteLength < 8) throw new Error('TIFF 文件过小，缺少文件头')
  const head = await readBytes(read, 0, Math.min(byteLength, 20))
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const order = String.fromCharCode(head[0]!, head[1]!)
  if (order !== 'II' && order !== 'MM') throw new Error(`TIFF 字节序标记非法：${head[0]} ${head[1]}`)
  const littleEndian = order === 'II'
  const magic = view.getUint16(2, littleEndian)
  if (magic === 42) {
    if (byteLength < 8) throw new Error('经典 TIFF 文件过小')
    return { littleEndian, big: false, firstIfd: view.getUint32(4, littleEndian) }
  }
  if (magic === 43) {
    // BigTIFF 在 8 字节头之后追加：偏移 4 为 LengthOfOffsetField，偏移 8 为 tag 条目字节数，
    // 偏移 12 为首个 IFD 的 64 位偏移。
    if (byteLength < 20) throw new Error('BigTIFF 文件头不完整')
    const offsetSize = view.getUint16(4, littleEndian)
    if (offsetSize !== 8) throw new Error(`暂不支持 ${offsetSize * 8} 位偏移的 BigTIFF`)
    return { littleEndian, big: true, firstIfd: Number(view.getBigUint64(12, littleEndian)) }
  }
  throw new Error(`不是 TIFF 文件：magic=${magic}`)
}

/** 读取单个 IFD 的全部条目与下一个 IFD 偏移。 */
async function readIfd(read: ByteReader, offset: number, big: boolean, littleEndian: boolean, byteLength: number): Promise<{ entries: RawEntry[]; next: number }> {
  if (offset <= 0 || offset >= byteLength) return { entries: [], next: 0 }
  const entrySize = big ? 20 : 12
  const countSize = big ? 8 : 2
  const nextSize = big ? 8 : 4
  const valueSize = big ? 8 : 4

  // 先用一个探测窗口一次读入，典型 IFD（十余个 tag）在窗口内即可完成解析，
  // 只有条目数特别多时才补读，避免每页两三次 slice。
  const probeSize = Math.min(byteLength - offset, big ? 256 : 160)
  const head = await readBytes(read, offset, probeSize)
  const countView = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const count = big ? Number(countView.getBigUint64(0, littleEndian)) : countView.getUint16(0, littleEndian)
  if (count <= 0) return { entries: [], next: 0 }

  const total = countSize + count * entrySize + nextSize
  const block = total <= probeSize ? head : await readBytes(read, offset, total)
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength)

  const entries: RawEntry[] = []
  for (let i = 0; i < count; i += 1) {
    const at = countSize + i * entrySize
    const tag = view.getUint16(at, littleEndian)
    const type = view.getUint16(at + 2, littleEndian)
    const valueCount = big ? Number(view.getBigUint64(at + 4, littleEndian)) : view.getUint32(at + 4, littleEndian)
    const unit = fieldSize(type, big)
    const entry: RawEntry = { tag, type, count: valueCount }
    if (unit !== undefined && valueCount > 0) {
      const payload = valueCount * unit
      const valueAt = at + (big ? 12 : 8)
      if (payload <= valueSize) entry.inline = block.subarray(valueAt, valueAt + payload)
      else entry.offset = big ? Number(view.getBigUint64(valueAt, littleEndian)) : view.getUint32(valueAt, littleEndian)
    }
    entries.push(entry)
  }
  const next = big ? Number(view.getBigUint64(countSize + count * entrySize, littleEndian)) : view.getUint32(countSize + count * entrySize, littleEndian)
  return { entries, next }
}

/** 从字节区间解析 tag 值数组。 */
function decodeValues(bytes: Uint8Array, type: number, count: number, littleEndian: boolean, big: boolean): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const values: number[] = []
  for (let i = 0; i < count; i += 1) {
    switch (type) {
      case TYPE_BYTE: values.push(bytes[i]!); break
      case TYPE_SHORT: values.push(view.getUint16(i * 2, littleEndian)); break
      case TYPE_LONG: values.push(view.getUint32(i * 4, littleEndian)); break
      case TYPE_SSHORT: values.push(view.getInt16(i * 2, littleEndian)); break
      case TYPE_SLONG: values.push(view.getInt32(i * 4, littleEndian)); break
      case TYPE_RATIONAL: {
        const numerator = view.getUint32(i * 8, littleEndian)
        const denominator = view.getUint32(i * 8 + 4, littleEndian)
        values.push(denominator === 0 ? 0 : numerator / denominator)
        break
      }
      case TYPE_SRATIONAL: {
        const numerator = view.getInt32(i * 8, littleEndian)
        const denominator = view.getInt32(i * 8 + 4, littleEndian)
        values.push(denominator === 0 ? 0 : numerator / denominator)
        break
      }
      default:
        if (big && (type === 13 || type === 16 || type === 17 || type === 18)) {
          values.push(Number(view.getBigUint64(i * 8, littleEndian)))
          break
        }
        throw new Error(`不支持的 TIFF 字段类型 ${type}（tag 值读取）`)
    }
  }
  return values
}

/** 合并本页需要的行外数组区间，减少 slice 次数。小于该间隙的区间直接合并。 */
function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (ranges.length < 2) return ranges
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = [{ ...sorted[0]! }]
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1]!
    if (range.start - last.end <= 4096) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

/** 将一个 IFD 的条目解析为 `TiffPage`。 */
async function parsePage(read: ByteReader, entries: RawEntry[], big: boolean, littleEndian: boolean, byteLength: number, subIfd: boolean): Promise<TiffPage> {
  const byTag = new Map<number, RawEntry>()
  for (const entry of entries) if (!byTag.has(entry.tag)) byTag.set(entry.tag, entry)

  // 收集需要从文件读取的行外数组，然后合并区间一次性读取。
  const pending: Array<{ entry: RawEntry; unit: number; start: number; length: number }> = []
  for (const entry of byTag.values()) {
    const unit = fieldSize(entry.type, big)
    if (entry.inline || unit === undefined || entry.count <= 0) continue
    const length = entry.count * unit
    const start = entry.offset!
    if (start + length > byteLength) throw new Error(`tag ${entry.tag} 的值数组超出文件范围`)
    pending.push({ entry, unit, start, length })
  }
  const ranges = mergeRanges(pending.map((item) => ({ start: item.start, end: item.start + item.length })))
  const resolved = new Map<number, number[]>()
  for (const range of ranges) {
    const bytes = await readBytes(read, range.start, range.end - range.start)
    for (const item of pending) {
      if (item.start < range.start || item.start >= range.end) continue
      const at = item.start - range.start
      resolved.set(item.entry.tag, decodeValues(bytes.subarray(at, at + item.length), item.entry.type, item.entry.count, littleEndian, big))
    }
  }

  const first = (tag: number): number | undefined => {
    const entry = byTag.get(tag)
    if (!entry) return undefined
    const values = entry.inline
      ? decodeValues(entry.inline, entry.type, entry.count, littleEndian, big)
      : resolved.get(tag)
    return values?.[0]
  }
  const all = (tag: number): number[] => {
    const entry = byTag.get(tag)
    if (!entry) return []
    return entry.inline ? decodeValues(entry.inline, entry.type, entry.count, littleEndian, big) : resolved.get(tag) ?? []
  }

  const width = first(TAG_IMAGE_WIDTH) ?? 0
  const height = first(TAG_IMAGE_LENGTH) ?? 0
  if (width <= 0 || height <= 0) throw new Error('TIFF 页面缺少有效的宽高')
  const components = first(TAG_SAMPLES_PER_PIXEL) ?? 1
  const bits = all(TAG_BITS_PER_SAMPLE)[0] ?? 1
  const planar = first(TAG_PLANAR_CONFIGURATION) ?? 1
  // PlanarConfiguration=2 为平面分离，分段数是通道数倍，布局与合并逻辑均不同。
  // 与其静默产出错误像素，不如明确拒绝。
  if (planar === 2) throw new Error('暂不支持 PlanarConfiguration=2（平面分离）TIFF')

  const layout: TiffLayout = byTag.has(TAG_TILE_OFFSETS) || byTag.has(TAG_TILE_WIDTH) ? 'tile' : 'strip'
  let tileWidth: number
  let tileHeight: number
  let offsets: number[]
  let lengths: number[]

  if (layout === 'tile') {
    tileWidth = first(TAG_TILE_WIDTH) ?? 0
    tileHeight = first(TAG_TILE_LENGTH) ?? 0
    if (tileWidth <= 0 || tileHeight <= 0) throw new Error('tiled TIFF 缺少 TileWidth/TileLength')
    offsets = all(TAG_TILE_OFFSETS)
    lengths = all(TAG_TILE_BYTE_COUNTS)
  } else {
    const rowsPerStrip = first(TAG_ROWS_PER_STRIP) ?? height
    offsets = all(TAG_STRIP_OFFSETS)
    lengths = all(TAG_STRIP_BYTE_COUNTS)
    if (offsets.length === 0) throw new Error('TIFF 页面缺少 StripOffsets，无法定位像素数据')
    tileWidth = width
    tileHeight = rowsPerStrip
  }
  if (offsets.length === 0) throw new Error('TIFF 页面缺少像素数据偏移')
  if (lengths.length !== offsets.length) {
    throw new Error(`TIFF 页面偏移数(${offsets.length})与字节数数(${lengths.length})不一致`)
  }

  const across = Math.ceil(width / tileWidth)
  const down = Math.ceil(height / tileHeight)
  if (layout === 'tile' && offsets.length < across * down) {
    throw new Error(`tiled TIFF 分段数不足：期望 ${across * down}，实际 ${offsets.length}`)
  }

  const segments: TiffSegment[] = []
  const used = layout === 'tile' ? across * down : offsets.length
  for (let i = 0; i < used; i += 1) {
    let x: number
    let y: number
    let segmentWidth: number
    let segmentHeight: number
    if (layout === 'tile') {
      // TIFF 规定 tile 顺序为先水平后垂直（row-major）。
      const tx = i % across
      const ty = Math.floor(i / across)
      x = tx * tileWidth
      y = ty * tileHeight
      segmentWidth = Math.min(tileWidth, width - x)
      segmentHeight = Math.min(tileHeight, height - y)
    } else {
      x = 0
      y = i * tileHeight
      segmentWidth = width
      segmentHeight = Math.min(tileHeight, height - y)
      if (segmentHeight <= 0) continue
    }
    segments.push({ offset: offsets[i]!, byteLength: lengths[i]!, x, y, width: segmentWidth, height: segmentHeight })
  }

  const bitsTotal = bits * components
  const photometric = first(TAG_PHOTOMETRIC) ?? 1
  // DNG / 相机 RAW 的 CFA 与 LinearRaw 都携带 Bayer 图案描述。
  const cfa = cfaInfo(photometric, all(TAG_CFA_REPEAT_PATTERN_DIM), all(TAG_CFA_PATTERN))
  const blackValues = all(TAG_BLACK_LEVEL)
  const whiteValues = all(TAG_WHITE_LEVEL)
  return {
    width,
    height,
    littleEndian,
    bitsPerSample: bits,
    components,
    sampleFormat: first(TAG_SAMPLE_FORMAT) ?? 1,
    compression: first(TAG_COMPRESSION) ?? 1,
    photometric,
    predictor: first(TAG_PREDICTOR) ?? 1,
    layout,
    tileWidth,
    tileHeight,
    segments,
    // ImageJ 在 nImages>1 时会终止 IFD 链并丢掉其余帧（`TiffDecoder.java:833-834`），
    // 此处把帧数显式记录下来，交由调用方决定如何寻址。
    frames: Math.max(1, first(297) ?? 1),
    pixelByteLength: Math.ceil((width * height * bitsTotal) / 8),
    subfileType: first(TAG_NEW_SUBFILE_TYPE) ?? 0,
    subIfd,
    cfa,
    blackLevel: blackValues.length > 0 ? blackValues[0] : undefined,
    whiteLevel: whiteValues.length > 0 ? whiteValues[0] : undefined,
    activeArea: arrayOrUndefined(all(50829)),
    defaultCropOrigin: arrayOrUndefined(all(TAG_DEFAULT_CROP_ORIGIN)),
    defaultCropSize: arrayOrUndefined(all(TAG_DEFAULT_CROP_SIZE)),
  }
}

/** 由 tag 值构造 CFA 信息；图案不完整时返回 undefined。 */
function cfaInfo(photometric: number, repeat: number[], pattern: number[]): TiffCfaInfo | undefined {
  if (photometric !== PHOTOMETRIC_CFA && photometric !== PHOTOMETRIC_LINEAR_RAW) return undefined
  if (repeat.length < 2) return undefined
  const rows = repeat[0]!
  const cols = repeat[1]!
  if (rows <= 0 || cols <= 0 || pattern.length < rows * cols) return undefined
  return { repeat: [rows, cols], pattern: pattern.slice(0, rows * cols) }
}

function arrayOrUndefined(values: number[]): number[] | undefined {
  return values.length > 0 ? values : undefined
}

/** 建立索引的选项。 */
export interface TiffIndexOptions {
  /**
   * 是否递归解析 SubIFD(330)。
   *
   * DNG 与多数相机 RAW 把原始 CFA 数据放在 SubIFD，而主 IFD 只是缩略图 / 预览，
   * 因此 RAW 路径需要开启；普通 TIFF 页栈保持默认关闭，避免改变既有页序。
   */
  subIfds?: boolean
}

/** 遍历 IFD 链并建立索引。 */
export async function buildTiffIndex(read: ByteReader, byteLength: number, options: TiffIndexOptions = {}): Promise<TiffIndex> {
  const { littleEndian, big, firstIfd } = await readHeader(read, byteLength)
  const pages: TiffPage[] = []
  const seen = new Set<number>()
  const queue: Array<{ offset: number; subIfd: boolean }> = [{ offset: firstIfd, subIfd: false }]
  while (queue.length > 0) {
    const item = queue.shift()!
    let offset = item.offset
    while (offset > 0) {
      if (seen.has(offset)) {
        // SubIFD 的 tag 330 可能与主链重叠，容忍；主链成环则视为损坏。
        if (item.subIfd) break
        throw new Error(`TIFF IFD 链出现环：offset=${offset}`)
      }
      seen.add(offset)
      const { entries, next } = await readIfd(read, offset, big, littleEndian, byteLength)
      if (entries.length === 0) break
      pages.push(await parsePage(read, entries, big, littleEndian, byteLength, item.subIfd))
      if (pages.length > 1_000_000) throw new Error('TIFF 页数异常，疑似 IFD 链损坏')
      if (options.subIfds) {
        const entry = entries.find((candidate) => candidate.tag === TAG_SUB_IFDS)
        if (entry) {
          for (const sub of await readEntryValues(read, entry, big, littleEndian)) {
            if (sub > 0) queue.push({ offset: sub, subIfd: true })
          }
        }
      }
      // SubIFD 只解析单个 IFD：同链的其余子图已由父 IFD 的 tag 330 数组列出。
      if (item.subIfd) break
      offset = next
    }
  }
  if (pages.length === 0) throw new Error('TIFF 未包含任何页面')
  return { big, littleEndian, byteLength, pages }
}

/** 读取 tag 值数组，供索引阶段提取 SubIFD 偏移等标量列表。 */
async function readEntryValues(read: ByteReader, entry: RawEntry, big: boolean, littleEndian: boolean): Promise<number[]> {
  if (entry.inline) return decodeValues(entry.inline, entry.type, entry.count, littleEndian, big)
  const unit = fieldSize(entry.type, big)
  if (unit === undefined || entry.count <= 0) return []
  const bytes = await readBytes(read, entry.offset!, entry.count * unit)
  return decodeValues(bytes, entry.type, entry.count, littleEndian, big)
}

/**
 * 为 `Blob` 建立索引，得到可按页读取的句柄。
 *
 * 读取完全惰性：建索引阶段只读 IFD 区域。
 */
export async function indexTiff(blob: Blob, options?: TiffIndexOptions): Promise<IndexedTiff> {
  const reader: ByteReader = async (offset, length) => {
    const end = Math.min(blob.size, offset + length)
    if (end <= offset) return new Uint8Array(0)
    return new Uint8Array(await blob.slice(offset, end).arrayBuffer())
  }
  return { read: reader, index: await buildTiffIndex(reader, blob.size, options) }
}