/**
 * 测试用的 TIFF 文件构造器。
 *
 * 布局为「头部 → 各页 IFD → 各页行外数组 → 全部像素数据」，即 IFD 全部前置、
 * 像素数据后置。这是科学 TIFF 的常见形态，也让「索引阶段是否读取像素」可以被精确断言：
 * 只要所有读取区间都落在 `pixelStart` 之前，就证明索引没有触碰像素数据。
 *
 * 像素内容以字节形式给出（`pixels`，已处于目标字节序），这样测试可以自行构造
 * 大端数据、RGB 交织数据等，用来验证读取层的字节序与布局转换。
 *
 * 构造分两阶段：先按 spec 定出每页 tag 计划（决定 IFD 与数组的字节数），
 * 再据此排布位置并填入依赖像素位置的偏移值。
 */

export interface BuildPage {
  width: number
  height: number
  /** 每通道位深，默认 16。 */
  bits?: 8 | 16 | 32
  /** 每像素通道数，默认 1。 */
  components?: 1 | 3
  /** SampleFormat：1 无符号整数、2 有符号整数、3 浮点。默认 1。 */
  sampleFormat?: 1 | 2 | 3
  /** 每条带的行数，默认整页一条带。 */
  rowsPerStrip?: number
  /** 该页像素字节，按 `x` 变化最快、行优先排列，已处于文件字节序。 */
  pixels?: Uint8Array
  /** Compression，默认 1（未压缩）。 */
  compression?: number
  layout?: 'strip' | 'tile'
  tileWidth?: number
  tileHeight?: number
  /** 强制写入的像素分段偏移，用于验证 BigTIFF 的 64 位偏移不被截断。 */
  pixelOffset?: number
  /** 省略 StripOffsets，用于构造非法样本。 */
  omitStripOffsets?: boolean
  /** 省略 TileOffsets，用于构造非法样本。 */
  omitTileOffsets?: boolean
}

interface EntryPlan {
  tag: number
  type: number
  count: number
}

/** 偏移类 tag：BigTIFF 下必须用 LONG8，否则 >4 GiB 的偏移无法表达。 */
const OFFSET_TAGS = new Set([273, 279, 324, 325])

export function segmentCountOf(spec: BuildPage): number {
  if (spec.layout === 'tile') {
    const tw = spec.tileWidth ?? 16
    const th = spec.tileHeight ?? 16
    return Math.ceil(spec.width / tw) * Math.ceil(spec.height / th)
  }
  return Math.ceil(spec.height / (spec.rowsPerStrip ?? spec.height))
}

/** SHORT 占 2 字节，LONG8 占 8 字节，其余按 LONG 4 字节。 */
const fieldSize = (type: number): number => (type === 3 ? 2 : type === 16 ? 8 : 4)

function planEntries(spec: BuildPage, big: boolean): EntryPlan[] {
  const bits = spec.bits ?? 16
  const components = spec.components ?? 1
  const count = segmentCountOf(spec)
  const list: EntryPlan[] = []
  const add = (tag: number, values: number[]): void => {
    const type = big && OFFSET_TAGS.has(tag)
      ? 16
      : values.length === 1 && values[0]! >= 0 && values[0]! <= 0xffff ? 3 : 4
    list.push({ tag, type, count: values.length })
  }
  add(256, [spec.width])
  add(257, [spec.height])
  add(258, [bits])
  add(259, [spec.compression ?? 1])
  add(262, [components === 3 ? 2 : 1])
  add(277, [components])
  if (spec.layout === 'tile') {
    add(284, [1])
    add(322, [spec.tileWidth ?? 16])
    add(323, [spec.tileHeight ?? 16])
    if (!spec.omitTileOffsets) {
      add(324, new Array<number>(count).fill(0))
      add(325, new Array<number>(count).fill(0))
    }
  } else {
    if (!spec.omitStripOffsets) add(273, new Array<number>(count).fill(0))
    add(278, [spec.rowsPerStrip ?? spec.height])
    add(279, new Array<number>(count).fill(0))
    add(284, [1])
  }
  add(339, [spec.sampleFormat ?? 1])
  return list
}

export function buildTiffBytes(pages: BuildPage[], options: { big?: boolean; bigEndian?: boolean } = {}) {
  const big = options.big ?? false
  // 字节序是文件级属性，由文件头的 II/MM 决定，因此整个文件统一。
  const little = !(options.bigEndian ?? false)
  const plans = pages.map((spec) => planEntries(spec, big))
  const entrySize = big ? 20 : 12
  const countSize = big ? 8 : 2
  const nextSize = big ? 8 : 4
  const stride = big ? 8 : 4

  // 经典 TIFF 头占 0..7（首个 IFD 偏移 4 字节）；BigTIFF 占 0..19
  // （偏移宽度 4、保留 2、条目长度 2、首个 IFD 偏移 8 字节）。
  let cursor = big ? 20 : 8
  const ifdAt: number[] = []
  const arraysAt: number[] = []
  plans.forEach((plan) => {
    ifdAt.push(cursor)
    cursor += countSize + plan.length * entrySize + nextSize
    arraysAt.push(cursor)
    cursor += plan.reduce((sum, item) => {
      const size = item.count * fieldSize(item.type)
      return size <= stride ? sum : sum + size
    }, 0)
  })
  const pixelStart = cursor

  const bytesPerPage = pages.map((spec) =>
    (spec.width * spec.height * (spec.bits ?? 16) * (spec.components ?? 1)) / 8)
  // 显式标注为 Uint8Array<ArrayBuffer>，以便调用方直接用作 BlobPart。
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(pixelStart + bytesPerPage.reduce((a, b) => a + b, 0))
  const view = new DataView(bytes.buffer)

  let pixelCursor = pixelStart
  pages.forEach((spec, page) => {
    const bits = spec.bits ?? 16
    const components = spec.components ?? 1
    const count = segmentCountOf(spec)
    const perSegment = Math.floor(bytesPerPage[page]! / count)
    const offsets = Array.from({ length: count }, (_, i) =>
      spec.pixelOffset ?? pixelCursor + i * perSegment)

    const values = new Map<number, number[]>()
    values.set(256, [spec.width])
    values.set(257, [spec.height])
    values.set(258, [bits])
    values.set(259, [spec.compression ?? 1])
    values.set(262, [components === 3 ? 2 : 1])
    values.set(277, [components])
    values.set(284, [1])
    values.set(339, [spec.sampleFormat ?? 1])
    if (spec.layout === 'tile') {
      values.set(322, [spec.tileWidth ?? 16])
      values.set(323, [spec.tileHeight ?? 16])
      if (!spec.omitTileOffsets) {
        values.set(324, offsets)
        values.set(325, new Array<number>(count).fill(perSegment))
      }
    } else {
      if (!spec.omitStripOffsets) values.set(273, offsets)
      values.set(278, [spec.rowsPerStrip ?? spec.height])
      values.set(279, new Array<number>(count).fill(perSegment))
    }

    const at = ifdAt[page]!
    if (big) view.setBigUint64(at, BigInt(plans[page]!.length), little)
    else view.setUint16(at, plans[page]!.length, little)

    let arrayCursor = arraysAt[page]!
    plans[page]!.forEach((item, index) => {
      const at2 = at + countSize + index * entrySize
      const data = values.get(item.tag)!
      view.setUint16(at2, item.tag, little)
      view.setUint16(at2 + 2, item.type, little)
      if (big) view.setBigUint64(at2 + 4, BigInt(item.count), little)
      else view.setUint32(at2 + 4, item.count, little)
      const size = item.count * fieldSize(item.type)
      const writeAt = size <= stride ? at2 + (big ? 12 : 8) : arrayCursor
      data.forEach((value, i) => {
        if (item.type === 3) view.setUint16(writeAt + i * 2, value, little)
        else if (item.type === 16) view.setBigUint64(writeAt + i * 8, BigInt(value), little)
        else view.setUint32(writeAt + i * 4, value, little)
      })
      if (size > stride) {
        arrayCursor += size
        if (big) view.setBigUint64(at2 + 12, BigInt(writeAt), little)
        else view.setUint32(at2 + 8, writeAt, little)
      }
    })
    const nextAt = at + countSize + plans[page]!.length * entrySize
    const next = page + 1 < pages.length ? ifdAt[page + 1]! : 0
    if (big) view.setBigUint64(nextAt, BigInt(next), little)
    else view.setUint32(nextAt, next, little)

    // 写入像素：按分段切分，段内保持行优先。
    const source = spec.pixels
    if (source) {
      for (let i = 0; i < count; i += 1) {
        const target = offsets[i]!
        if (target + perSegment > bytes.length) break
        bytes.set(source.subarray(i * perSegment, (i + 1) * perSegment), target)
      }
    }
    // 下一页的像素区紧跟本页，占位推进与是否实际写入无关。
    pixelCursor += bytesPerPage[page]!
  })

  if (big) {
    bytes[0] = 0x49
    bytes[1] = 0x49
    view.setUint16(2, 43, little)
    view.setUint16(4, 8, little)   // LengthOfOffsetField
    view.setUint16(6, 0, little)   // reserved
    view.setUint16(8, 20, little)  // tag 条目字节数
    view.setBigUint64(12, BigInt(ifdAt[0]!), little)
  } else {
    bytes[0] = little ? 0x49 : 0x4d   // 'II' 小端 / 'MM' 大端
    bytes[1] = little ? 0x49 : 0x4d
    view.setUint16(2, 42, little)
    view.setUint32(4, ifdAt[0]!, little)
  }

  return { bytes, pixelStart, ifdAt }
}

/** 生成 16 位像素字节（`x` 最快、行优先），`little` 决定字节序。 */
export function uint16Pixels(values: readonly number[], little = true): Uint8Array {
  const out = new Uint8Array(values.length * 2)
  const view = new DataView(out.buffer)
  values.forEach((value, i) => view.setUint16(i * 2, value & 0xffff, little))
  return out
}