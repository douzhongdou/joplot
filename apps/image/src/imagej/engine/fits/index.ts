/**
 * FITS HDU 索引：只读头部，建立「每个 HDU 的像素在哪、多大、什么类型」的索引。
 *
 * FITS 文件是一串 HDU（Header + Data Unit）。每个 HDU 以 2880 字节对齐：
 * 头部由若干块组成、以 `END` 结束并补齐；数据段紧跟其后，大小为
 * `|BITPIX|/8 × NAXIS1 × … × NAXISn`，同样补齐到 2880。
 *
 * 索引阶段不读取任何像素，只按需切片读取头部，因此大文件也能快速打开。
 * 这与 TIFF 的 `indexTiff`（`engine/tiff/indexer.ts`）是同一种懒加载思路。
 */

import { FITS_BLOCK_BYTES, FITS_CARD_BYTES, FitsHeader, isEndCard, parseFitsCard, type FitsCard } from './header.ts'

/** FITS 支持的 BITPIX：8/16/32/64 位整数与 -32/-64 位 IEEE 浮点。 */
const KNOWN_BITPIX = new Set([8, 16, 32, 64, -32, -64])

/** 头部按块保护的读取上限，避免损坏文件把索引拖进死循环。 */
const MAX_HEADER_BLOCKS = 4096

export interface FitsHdu {
  /** 在文件中的序数（0 基）。 */
  ordinal: number
  /** 头部起始偏移。 */
  headerStart: number
  /** 头部长度；含 `END` 后补齐到 2880 的填充字节。 */
  headerLength: number
  /** 数据段起始偏移。 */
  dataStart: number
  /** 像素数据字节数（未补齐）。 */
  dataLength: number
  /** 下一个 HDU 的起始偏移（数据段补齐到 2880 之后）。 */
  nextOffset: number
  /** BITPIX 原值；缺失时为 undefined。 */
  bitpix?: number
  /** NAXIS 原值。 */
  naxis: number
  /** `[NAXIS1, NAXIS2, …]`，即 x 最快的各轴长度。 */
  axes: readonly number[]
  header: FitsHeader
  cards: readonly FitsCard[]
}

export interface FitsIndex {
  hdus: readonly FitsHdu[]
  /** 含图像数据的 HDU（按文件顺序）。 */
  imageHdus: readonly FitsHdu[]
}

/** 从 Blob 的 [start, start+length) 读取字节；越界部分自然截断。 */
export async function readBlobBytes(blob: Blob, start: number, length: number): Promise<Uint8Array> {
  if (start >= blob.size || length <= 0) return new Uint8Array(0)
  const end = Math.min(start + length, blob.size)
  return new Uint8Array(await blob.slice(start, end).arrayBuffer())
}

const ASCII = new TextDecoder('ascii')

/** 建立 FITS 索引。 */
export async function indexFits(blob: Blob): Promise<FitsIndex> {
  const hdus: FitsHdu[] = []
  let offset = 0
  while (offset < blob.size) {
    const { header, cards, headerLength } = await readHeader(blob, offset)
    const bitpix = header.number('BITPIX')
    const naxis = header.number('NAXIS') ?? 0
    const axes = axisLengths(header, naxis)
    const dataLength = pixelByteLength(bitpix, axes)
    const dataStart = offset + headerLength
    const nextOffset = dataStart + alignToBlock(dataLength)
    const hdu: FitsHdu = {
      ordinal: hdus.length,
      headerStart: offset,
      headerLength,
      dataStart,
      dataLength,
      nextOffset,
      bitpix,
      naxis,
      axes,
      header,
      cards,
    }
    hdus.push(hdu)
    if (nextOffset <= offset) throw new Error('FITS HDU 偏移未前进，文件可能损坏')
    offset = nextOffset
  }
  return { hdus, imageHdus: hdus.filter(isImageHdu) }
}

/** 该 HDU 是否携带可解码的图像数据。 */
export function isImageHdu(hdu: FitsHdu): boolean {
  if (hdu.bitpix === undefined || !KNOWN_BITPIX.has(hdu.bitpix)) return false
  if (hdu.naxis < 1 || hdu.axes.length !== hdu.naxis) return false
  if (hdu.axes.some((length) => !Number.isFinite(length) || length < 1)) return false
  const xtension = hdu.header.string('XTENSION')
  // 扩展 HDU 若不是 IMAGE（如 BINTABLE / TABLE）不按图像处理。
  if (xtension && xtension.trim().toUpperCase() !== 'IMAGE') return false
  return true
}

/** 逐块读取头部直到 `END`，返回卡片表与补齐后的头部长度。 */
async function readHeader(blob: Blob, start: number): Promise<{ header: FitsHeader; cards: FitsCard[]; headerLength: number }> {
  const cards: FitsCard[] = []
  let relative = 0
  for (let block = 0; block < MAX_HEADER_BLOCKS; block += 1) {
    const bytes = await readBlobBytes(blob, start + relative, FITS_BLOCK_BYTES)
    if (bytes.byteLength < FITS_CARD_BYTES) throw new Error('FITS 头部不完整或文件被截断')
    for (let offset = 0; offset + FITS_CARD_BYTES <= bytes.byteLength; offset += FITS_CARD_BYTES) {
      const text = ASCII.decode(bytes.subarray(offset, offset + FITS_CARD_BYTES))
      if (isEndCard(text)) {
        const used = relative + offset + FITS_CARD_BYTES
        return { header: new FitsHeader(cards), cards, headerLength: alignToBlock(used) }
      }
      const card = parseFitsCard(text)
      if (card) cards.push(card)
    }
    relative += FITS_BLOCK_BYTES
  }
  throw new Error('FITS 头部过长，可能不是有效的 FITS 文件')
}

/** 读取 NAXIS1..NAXISn；任一轴缺失或非法时返回空数组表示不可用。 */
function axisLengths(header: FitsHeader, naxis: number): number[] {
  if (naxis <= 0) return []
  const axes: number[] = []
  for (let i = 1; i <= naxis; i += 1) {
    const length = header.number(`NAXIS${i}`)
    if (length === undefined || !Number.isFinite(length) || length < 0) return []
    axes.push(length)
  }
  return axes
}

/** 像素数据字节数；无法确定时返回 0。 */
function pixelByteLength(bitpix: number | undefined, axes: readonly number[]): number {
  if (bitpix === undefined || axes.length === 0) return 0
  const bytesPerSample = Math.abs(bitpix) / 8
  const samples = axes.reduce((product, length) => product * length, 1)
  return bytesPerSample * samples
}

/** 向上对齐到 2880 的整数倍。 */
function alignToBlock(bytes: number): number {
  return Math.ceil(bytes / FITS_BLOCK_BYTES) * FITS_BLOCK_BYTES
}
