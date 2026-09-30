/** ImageJ TiffDecoder/FileSaver 基线子集：无压缩 8 位灰度、多页 IFD 与条带。 */
import { createImage, ImagejError, MAX_IMAGE_PIXELS, type GrayImage } from './processor.ts'

type TiffType = 3 | 4
interface Entry { type: TiffType; count: number; values: number[] }

const TYPE_BYTES: Record<TiffType, number> = { 3: 2, 4: 4 }
const MAX_PAGES = 256
const MAX_STACK_PIXELS = 100_000_000
const TAG_COUNT = 10
const IFD_BYTES = 2 + TAG_COUNT * 12 + 4

function invalid(message: string): never { throw new ImagejError('decode', `TIFF: ${message}`) }

/** 解码经典 TIFF。压缩、瓦片、RGB、16/32 位由调用方明确提示为暂不支持。 */
export function decodeTiff(buffer: ArrayBuffer): GrayImage[] {
  const view = new DataView(buffer)
  if (view.byteLength < 8) invalid('文件过短')
  const marker = String.fromCharCode(view.getUint8(0), view.getUint8(1))
  if (marker !== 'II' && marker !== 'MM') invalid('字节序标记错误')
  const little = marker === 'II'
  const u16 = (offset: number): number => {
    if (offset < 0 || offset + 2 > view.byteLength) invalid('读取越界')
    return view.getUint16(offset, little)
  }
  const u32 = (offset: number): number => {
    if (offset < 0 || offset + 4 > view.byteLength) invalid('读取越界')
    return view.getUint32(offset, little)
  }
  if (u16(2) !== 42) invalid('仅支持经典 TIFF 42')
  let offset = u32(4)
  const seen = new Set<number>()
  const pages: GrayImage[] = []
  let totalPixels = 0
  while (offset !== 0) {
    if (pages.length >= MAX_PAGES || seen.has(offset)) invalid('页数过多或 IFD 循环')
    seen.add(offset)
    const count = u16(offset)
    if (count > 256 || offset + 2 + count * 12 + 4 > view.byteLength) invalid('IFD 长度错误')
    const entries = new Map<number, Entry>()
    for (let i = 0; i < count; i += 1) {
      const entryOffset = offset + 2 + i * 12
      const tag = u16(entryOffset)
      const type = u16(entryOffset + 2)
      const valueCount = u32(entryOffset + 4)
      if (type !== 3 && type !== 4) continue
      if (valueCount > 100_000) invalid('标签长度过大')
      const bytes = valueCount * TYPE_BYTES[type]
      const dataOffset = bytes <= 4 ? entryOffset + 8 : u32(entryOffset + 8)
      if (dataOffset + bytes > view.byteLength) invalid('标签数据越界')
      const values: number[] = []
      for (let j = 0; j < valueCount; j += 1) {
        values.push(type === 3 ? u16(dataOffset + j * 2) : u32(dataOffset + j * 4))
      }
      entries.set(tag, { type, count: valueCount, values })
    }
    const scalar = (tag: number, fallback?: number): number => entries.get(tag)?.values[0] ?? fallback ?? invalid(`缺少标签 ${tag}`)
    const width = scalar(256)
    const height = scalar(257)
    if (width < 1 || height < 1 || width > 16_384 || height > 16_384 || width * height > MAX_IMAGE_PIXELS) {
      invalid('图像尺寸超出限制')
    }
    if (pages.length > 0 && (width !== pages[0].width || height !== pages[0].height)) {
      invalid('图像栈切片尺寸不一致')
    }
    totalPixels += width * height
    if (totalPixels > MAX_STACK_PIXELS) invalid('图像栈超过内存上限')
    if (scalar(258, 8) !== 8 || scalar(259, 1) !== 1 || scalar(277, 1) !== 1 || scalar(284, 1) !== 1) {
      invalid('仅支持无压缩 8 位单通道条带图像')
    }
    const photometric = scalar(262, 1)
    if (photometric !== 0 && photometric !== 1) invalid('不支持此颜色模型')
    const strips = entries.get(273)?.values
    const byteCounts = entries.get(279)?.values
    if (!strips || !byteCounts || strips.length !== byteCounts.length || strips.length === 0) invalid('条带信息缺失')
    const image = createImage(width, height)
    let written = 0
    for (let i = 0; i < strips.length; i += 1) {
      const length = Math.min(byteCounts[i], image.data.length - written)
      if (strips[i] + byteCounts[i] > view.byteLength || length < 0) invalid('条带数据越界')
      image.data.set(new Uint8Array(buffer, strips[i], length), written)
      written += length
    }
    if (written !== image.data.length) invalid('条带像素不足')
    if (photometric === 0) {
      for (let i = 0; i < image.data.length; i += 1) image.data[i] = 255 - image.data[i]
    }
    pages.push(image)
    offset = u32(offset + 2 + count * 12)
  }
  if (pages.length === 0) invalid('没有图像页')
  return pages
}

/** 将多张同尺寸 8 位灰度图编码为经典 TIFF，每页一个无压缩条带。 */
export function encodeTiff(images: readonly GrayImage[]): Uint8Array<ArrayBuffer> {
  if (images.length === 0 || images.length > MAX_PAGES) throw new ImagejError('invalid-value', 'TIFF 页数无效')
  const first = images[0]
  let pixels = 0
  for (const image of images) {
    if (image.width < 1 || image.height < 1 || image.width > 16_384 || image.height > 16_384
      || image.width * image.height > MAX_IMAGE_PIXELS
      || image.width !== first.width || image.height !== first.height || image.data.length !== image.width * image.height) {
      throw new ImagejError('invalid-size', 'TIFF 图像栈要求每页尺寸一致')
    }
    pixels += image.data.length
  }
  if (pixels > MAX_STACK_PIXELS) throw new ImagejError('too-large', 'TIFF 图像栈超过 100 MB')
  const pixelStart = 8 + images.length * IFD_BYTES
  const result = new Uint8Array(pixelStart + pixels)
  const view = new DataView(result.buffer)
  result[0] = 0x49; result[1] = 0x49
  view.setUint16(2, 42, true)
  view.setUint32(4, 8, true)
  let pixelOffset = pixelStart
  images.forEach((image, index) => {
    const ifd = 8 + index * IFD_BYTES
    view.setUint16(ifd, TAG_COUNT, true)
    const tags: Array<[number, TiffType, number]> = [
      [256, 4, image.width], [257, 4, image.height], [258, 3, 8], [259, 3, 1], [262, 3, 1],
      [273, 4, pixelOffset], [277, 3, 1], [278, 4, image.height], [279, 4, image.data.length], [284, 3, 1],
    ]
    tags.forEach(([tag, type, value], position) => {
      const at = ifd + 2 + position * 12
      view.setUint16(at, tag, true)
      view.setUint16(at + 2, type, true)
      view.setUint32(at + 4, 1, true)
      if (type === 3) view.setUint16(at + 8, value, true)
      else view.setUint32(at + 8, value, true)
    })
    view.setUint32(ifd + 2 + TAG_COUNT * 12, index + 1 < images.length ? ifd + IFD_BYTES : 0, true)
    result.set(image.data, pixelOffset)
    pixelOffset += image.data.length
  })
  return result
}
