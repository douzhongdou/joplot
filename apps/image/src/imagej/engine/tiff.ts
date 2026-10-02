import type { ImageBlock } from './types.ts'
import { DTYPE_BYTES } from './types.ts'

/** 原始精度的经典 TIFF：逐页形成 Blob，支持 uint8/uint16/int16/float32 和 RGB。 */
export async function encodeTiffStack(frames: AsyncIterable<ImageBlock>, count: number): Promise<Blob> {
  const header = new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0])
  const parts: BlobPart[] = [header]
  let offset = 8, page = 0, signature = ''
  for await (const block of frames) {
    const width = block.shape[block.axes.indexOf('x')]!, height = block.shape[block.axes.indexOf('y')]!
    const ci = block.axes.indexOf('c'), components = ci >= 0 ? block.shape[ci]! : 1
    if (components !== 1 && components !== 3) throw new Error('TIFF supports scalar or RGB pixels')
    const key = `${width}:${height}:${components}:${block.dtype}`
    if (signature && signature !== key) throw new Error('TIFF stack pages must have the same size, components and dtype')
    signature = key
    const bytes = width * height * components * DTYPE_BYTES[block.dtype]
    if (block.data.byteLength !== bytes) throw new Error('TIFF pixel buffer does not match its dimensions')
    const tags = 11, ifdSize = 2 + tags * 12 + 4, extra = components === 3 ? 12 : 0
    const pixelOffset = offset + ifdSize + extra, padding = bytes % 2, next = pixelOffset + bytes + padding
    if (next > 0xffffffff) throw new Error('Classic TIFF exceeds 4 GiB; BigTIFF is required')
    const ifd = new Uint8Array(ifdSize + extra), view = new DataView(ifd.buffer)
    view.setUint16(0, tags, true)
    const bits = DTYPE_BYTES[block.dtype] * 8, format = block.dtype === 'float32' ? 3 : block.dtype === 'int16' ? 2 : 1
    const entries = [
      [256, 4, 1, width], [257, 4, 1, height], [258, 3, components, components === 3 ? offset + ifdSize : bits],
      [259, 3, 1, 1], [262, 3, 1, components === 3 ? 2 : 1], [273, 4, 1, pixelOffset],
      [277, 3, 1, components], [278, 4, 1, height], [279, 4, 1, bytes], [284, 3, 1, 1],
      [339, 3, components, components === 3 ? offset + ifdSize + 6 : format],
    ]
    entries.forEach(([tag, type, length, value], index) => {
      const at = 2 + index * 12
      view.setUint16(at, tag!, true); view.setUint16(at + 2, type!, true); view.setUint32(at + 4, length!, true)
      if (type === 3 && length === 1) view.setUint16(at + 8, value!, true)
      else view.setUint32(at + 8, value!, true)
    })
    view.setUint32(2 + tags * 12, page + 1 < count ? next : 0, true)
    for (let c = 0; c < (components === 3 ? 3 : 0); c++) {
      view.setUint16(ifdSize + c * 2, bits, true); view.setUint16(ifdSize + 6 + c * 2, format, true)
    }
    parts.push(ifd)
    if (components === 1) parts.push(new Blob([block.data as unknown as BlobPart]))
    else {
      const pixels = width * height, values = new Uint8Array(bytes), raw = new DataView(values.buffer)
      for (let i = 0; i < pixels; i++) for (let c = 0; c < components; c++) {
        const at = (i * components + c) * DTYPE_BYTES[block.dtype], value = block.data[c * pixels + i]!
        switch (block.dtype) {
          case 'uint8': raw.setUint8(at, value); break
          case 'uint16': raw.setUint16(at, value, true); break
          case 'int16': raw.setInt16(at, value, true); break
          case 'float32': raw.setFloat32(at, value, true); break
        }
      }
      parts.push(new Blob([values]))
    }
    if (padding) parts.push(new Uint8Array(1))
    offset = next; page++
  }
  if (page !== count || !page) throw new Error('TIFF stack frame count mismatch')
  return new Blob(parts, { type: 'image/tiff' })
}
