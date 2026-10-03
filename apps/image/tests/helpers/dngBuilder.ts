/**
 * 测试用的最小 TIFF / DNG 构造器（经典 TIFF，little-endian）。
 *
 * 只支持「内联（≤4 字节）tag 值」，足以构造 CFA 数据、SubIFD 与 Predictor 用例。
 * 单 strip 布局：`StripOffsets` / `StripByteCounts` 由构造器自动补齐。
 */

const BYTE = 1
const SHORT = 3
const LONG = 4

const typeSize = (type: number): number => (type === BYTE ? 1 : type === SHORT ? 2 : 4)

export interface WriterEntry {
  tag: number
  type: number
  values: number[]
}

export interface WriterIfd {
  entries: WriterEntry[]
  /** 单 strip 像素字节；自动补 StripOffsets / StripByteCounts。 */
  pixels?: Uint8Array
  /** SubIFD(330) 指向的 IFD 下标（同一 `ifds` 数组内）。 */
  subIfds?: number[]
}

/** 生成完整 TIFF 字节。第一个 IFD 位于主链，其余通过 SubIFD 引用。 */
export function writeTiff(ifds: readonly WriterIfd[]): Uint8Array<ArrayBuffer> {
  const prepared = ifds.map((ifd) => {
    const entries = ifd.entries.map((entry) => ({ ...entry }))
    if (ifd.pixels) {
      entries.push({ tag: 273, type: LONG, values: [0] })
      entries.push({ tag: 279, type: LONG, values: [ifd.pixels.length] })
    }
    if (ifd.subIfds && ifd.subIfds.length > 0) {
      entries.push({ tag: 330, type: LONG, values: ifd.subIfds.map(() => 0) })
    }
    for (const entry of entries) {
      if (entry.values.length * typeSize(entry.type) > 4) throw new Error(`writeTiff 仅支持内联 tag：${entry.tag}`)
    }
    return entries
  })

  const ifdOffset: number[] = []
  let cursor = 8
  for (const entries of prepared) {
    ifdOffset.push(cursor)
    cursor += 2 + entries.length * 12 + 4
  }
  const pixelOffset: number[] = []
  for (const ifd of ifds) {
    if (ifd.pixels) {
      if (cursor % 2 !== 0) cursor += 1
      pixelOffset.push(cursor)
      cursor += ifd.pixels.length
    } else {
      pixelOffset.push(-1)
    }
  }

  const out = new Uint8Array(cursor)
  const view = new DataView(out.buffer)
  out[0] = 0x49
  out[1] = 0x49
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset[0]!, true)

  for (let i = 0; i < ifds.length; i += 1) {
    const entries = prepared[i]!
    let at = ifdOffset[i]!
    view.setUint16(at, entries.length, true)
    at += 2
    for (const entry of entries) {
      view.setUint16(at, entry.tag, true)
      view.setUint16(at + 2, entry.type, true)
      view.setUint32(at + 4, entry.values.length, true)
      const valueAt = at + 8
      const values = entry.tag === 273
        ? [pixelOffset[i]!]
        : entry.tag === 330
          ? ifds[i]!.subIfds!.map((index) => ifdOffset[index]!)
          : entry.values
      for (let k = 0; k < values.length; k += 1) {
        const value = values[k]!
        if (entry.type === BYTE) out[valueAt + k] = value & 0xff
        else if (entry.type === SHORT) view.setUint16(valueAt + k * 2, value & 0xffff, true)
        else view.setUint32(valueAt + k * 4, value >>> 0, true)
      }
      at += 12
    }
    view.setUint32(at, 0, true)
  }

  for (let i = 0; i < ifds.length; i += 1) {
    const pixels = ifds[i]!.pixels
    if (pixels) out.set(pixels, pixelOffset[i]!)
  }
  return out
}

/** CFA 相关 tag：CFARepeatPatternDim / CFAPattern / PhotometricInterpretation。 */
export function cfaEntries(pattern: readonly number[], photometric = 32803): WriterEntry[] {
  return [
    { tag: 262, type: SHORT, values: [photometric] },
    { tag: 33421, type: SHORT, values: [2, 2] },
    { tag: 33422, type: BYTE, values: [...pattern] },
  ]
}

/** 通用图像 tag（宽高、位深、压缩、通道数）。 */
export function imageEntries(width: number, height: number, bits: number, compression = 1, samples = 1): WriterEntry[] {
  return [
    { tag: 256, type: LONG, values: [width] },
    { tag: 257, type: LONG, values: [height] },
    { tag: 258, type: SHORT, values: [bits] },
    { tag: 259, type: SHORT, values: [compression] },
    { tag: 277, type: SHORT, values: [samples] },
  ]
}

/** little-endian 有符号 16 位。 */
export function int16LE(values: readonly number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(values.length * 2)
  const view = new DataView(out.buffer)
  values.forEach((value, index) => view.setInt16(index * 2, value, true))
  return out
}
