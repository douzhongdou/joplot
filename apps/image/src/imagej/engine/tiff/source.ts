/**
 * 按页读取：依据 `TiffIndex` 从文件中取出单页像素，产出 `ImageBlock`。
 *
 * 借鉴 ImageJ `ij/plugin/FileInfoVirtualStack.java:207-228` 的按页取数，
 * 但补上它缺失的部分（见 docs/stack-architecture-decision.md §3）：
 * BigTIFF、多帧 IFD，以及本层特有的两项处理 —— 字节序与 RGB 布局。
 *
 * ## 与上游表示的三处约定差异
 *
 * **行序**：TIFF 的第一行是图像顶部，本模块原序保留，不做翻转。
 * ITK 导入路径同样不翻转（`importer.ts:86-98` 直接按 `size[0]/size[1]` 取宽高并顺序拷贝），
 * `rasterizeViewport` 也假设 `data` 第 0 行在顶部（`render/raster.ts` 的 `iy * iw + ix`）。
 * 三者一致，因此两条读取路径不会互相颠倒。
 *
 * **RGB 布局**：TIFF 以像素交织存储 RGB（`RGBRGB…`），而 `ImageBlock` 的 `c` 轴为平面分离
 * （`raster.ts` 按 `data[channel * pixels + index]` 取值，`importer.ts:116` 同样），
 * 因此彩色数据在此转换。
 *
 * **字节序**：TIFF 可为大端。解码出的多字节样本在平台字节序不符时需翻转。
 *
 * 本模块不含缓存。缓存与预取属于 L2（`engine/scheduler/cache.ts`）。
 */

import type { Dtype, ImageBlock, PixelArray } from '../types.ts'
import { DTYPE_BYTES, allocateBuffer } from '../types.ts'
import type { IndexedTiff, TiffIndex, TiffPage } from './index.ts'
import { pageAt } from './index.ts'
import { indexTiff } from './indexer.ts'

/** 平台字节序。 */
const PLATFORM_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

/** Compression=1 表示未压缩。 */
const COMPRESSION_NONE = 1

/** PhotometricInterpretation 取值。本模块不改变像素值，反相由显示层决定。 */
export const PHOTOMETRIC_WHITE_IS_ZERO = 0
export const PHOTOMETRIC_BLACK_IS_ZERO = 1
export const PHOTOMETRIC_RGB = 2

/** 读出的一页。颜色解释仍需上层决策，故单独带出。 */
export interface TiffFrame {
  block: ImageBlock
  /** PhotometricInterpretation 原值。 */
  photometric: number
  /** 该页实际参与读取的分段数。 */
  segmentCount: number
}

/**
 * 由位深与 SampleFormat 映射到本项目支持的 dtype。
 *
 * 导出供导入层使用：`createDataset` 的 `dtype` 必须与实际读出的页一致，
 * 否则 window/level 的取值范围与下游计算都会错。
 */
export function dtypeOf(page: TiffPage): Dtype | undefined {
  const { bitsPerSample: bits, sampleFormat: format } = page
  if (format === 1) return bits === 8 ? 'uint8' : bits === 16 ? 'uint16' : undefined
  if (format === 2) return bits === 16 ? 'int16' : undefined
  if (format === 3) return bits === 32 ? 'float32' : undefined
  return undefined
}

/** 多字节样本的字节序与平台不符时需要翻转。 */
function needsByteSwap(page: TiffPage, dtype: Dtype): boolean {
  return DTYPE_BYTES[dtype] > 1 && page.littleEndian !== PLATFORM_LITTLE_ENDIAN
}

/** 在无需翻转时零拷贝地建立视图。`bytes` 必须是独立缓冲以保证对齐。 */
function typedView(bytes: Uint8Array, dtype: Dtype): PixelArray {
  switch (dtype) {
    case 'uint8': return bytes
    case 'uint16': return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
    case 'int16': return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
    case 'float32': return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  }
}

/**
 * 逐样本翻转字节序。
 *
 * 对无符号/有符号整数与 IEEE754 浮点，按字节整体反转即为字节序转换。
 */
function swapBytes(bytes: Uint8Array, dtype: Dtype): PixelArray {
  const width = DTYPE_BYTES[dtype]
  if (width === 1) return bytes
  const copy = bytes.slice()
  for (let at = 0; at + width <= copy.length; at += width) {
    for (let i = 0, j = width - 1; i < j; i += 1, j -= 1) {
      const held = copy[at + i]!
      copy[at + i] = copy[at + j]!
      copy[at + j] = held
    }
  }
  return typedView(copy, dtype)
}

/** 按给定字节序读取一个样本。`view` 覆盖整个页缓冲，避免逐样本新建视图。 */
function sampleAt(view: DataView, at: number, dtype: Dtype, littleEndian: boolean): number {
  switch (dtype) {
    case 'uint8': return view.getUint8(at)
    case 'uint16': return view.getUint16(at, littleEndian)
    case 'int16': return view.getInt16(at, littleEndian)
    case 'float32': return view.getFloat32(at, littleEndian)
  }
}

export class TiffPageSource {
  private readonly handle: IndexedTiff

  private constructor(handle: IndexedTiff) {
    this.handle = handle
  }

  /** 为 `Blob` 建立索引并返回按页读取器。 */
  static async open(blob: Blob): Promise<TiffPageSource> {
    return new TiffPageSource(await indexTiff(blob))
  }

  /** 用已有索引构造，避免重复建索引。 */
  static fromIndex(handle: IndexedTiff): TiffPageSource {
    return new TiffPageSource(handle)
  }

  get index(): TiffIndex {
    return this.handle.index
  }

  get pageCount(): number {
    return this.handle.index.pages.length
  }

  /** 全部页中最大的单页像素字节数，用作缓存预算的保守估计。 */
  get maxPageByteLength(): number {
    return this.handle.index.pages.reduce((max, page) => Math.max(max, page.pixelByteLength), 0)
  }

  /** 该页能否直接读出。未压缩是硬性前提：压缩数据必须整段解压，本期不实现。 */
  canRead(page: number): boolean {
    const meta = pageAt(this.handle.index, page)
    return meta.compression === COMPRESSION_NONE
      && dtypeOf(meta) !== undefined
      && (meta.components === 1 || meta.components === 3)
  }

  /** 列出无法直接读取的页及原因，供 UI 明确告知用户而不是静默失败。 */
  unsupportedPages(): Array<{ page: number; reason: string }> {
    const problems: Array<{ page: number; reason: string }> = []
    for (let i = 0; i < this.pageCount; i += 1) {
      const meta = pageAt(this.handle.index, i)
      if (meta.compression !== COMPRESSION_NONE) {
        problems.push({ page: i, reason: `Compression=${meta.compression} 需解压，暂不支持` })
      } else if (dtypeOf(meta) === undefined) {
        problems.push({ page: i, reason: `位深 ${meta.bitsPerSample} 位 SampleFormat=${meta.sampleFormat} 暂不支持` })
      } else if (meta.components !== 1 && meta.components !== 3) {
        problems.push({ page: i, reason: `分量数 ${meta.components} 暂不支持` })
      }
    }
    return problems
  }

  /**
   * 读出第 `page` 页（0 基），产出行优先、`x` 变化最快的缓冲。
   *
   * 未压缩页的分段按各自坐标逐行放置，而不是简单拼接 ——
   * 多个条带在文件里是彼此独立的字节区间，顺序未必与行序一致。
   */
  async readPage(page: number): Promise<TiffFrame> {
    const meta = pageAt(this.handle.index, page)
    if (meta.compression !== COMPRESSION_NONE) {
      throw new Error(`第 ${page} 页为压缩 TIFF（Compression=${meta.compression}），解压暂未实现`)
    }
    const dtype = dtypeOf(meta)
    if (!dtype) throw new Error(`第 ${page} 页位深 ${meta.bitsPerSample} 位 SampleFormat=${meta.sampleFormat} 暂不支持`)
    if (meta.components !== 1 && meta.components !== 3) {
      throw new Error(`第 ${page} 页分量数 ${meta.components} 暂不支持`)
    }

    const sampleBytes = meta.bitsPerSample / 8
    const rowBytes = meta.width * meta.components * sampleBytes
    const raw = new Uint8Array(rowBytes * meta.height)

    for (const segment of meta.segments) {
      const need = segment.height * rowBytes
      if (segment.byteLength < need) {
        throw new Error(`第 ${page} 页分段字节不足：期望 ${need}，实际 ${segment.byteLength}（offset=${segment.offset}）`)
      }
      const bytes = await this.handle.read(segment.offset, need)
      for (let row = 0; row < segment.height; row += 1) {
        const from = row * rowBytes
        raw.set(bytes.subarray(from, from + rowBytes), (segment.y + row) * rowBytes)
      }
    }

    return { block: this.interpret(raw, meta, dtype), photometric: meta.photometric, segmentCount: meta.segments.length }
  }

  /** 把整页字节解释为 `ImageBlock`，处理字节序与 RGB 布局。 */
  private interpret(raw: Uint8Array, meta: TiffPage, dtype: Dtype): ImageBlock {
    const sampleBytes = DTYPE_BYTES[dtype]
    const pixels = meta.width * meta.height

    if (meta.components === 3) {
      // TIFF 像素交织 → `ImageBlock` 平面分离。字节序在此一并处理，
      // 免得先交换字节再分配一次中间缓冲。
      const planar = allocateBuffer(dtype, pixels * 3)
      const dst = planar as unknown as { [index: number]: number }
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
      for (let pixel = 0; pixel < pixels; pixel += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          dst[channel * pixels + pixel] = sampleAt(view, (pixel * 3 + channel) * sampleBytes, dtype, meta.littleEndian)
        }
      }
      return {
        dtype,
        axes: ['c', 'y', 'x'],
        shape: [3, meta.height, meta.width],
        region: { start: [0, 0, 0], shape: [3, meta.height, meta.width] },
        data: planar,
      }
    }

    const data = sampleBytes === 1
      ? (raw as unknown as PixelArray)
      : needsByteSwap(meta, dtype)
        ? swapBytes(raw, dtype)
        : typedView(raw, dtype)
    return {
      dtype,
      axes: ['y', 'x'],
      shape: [meta.height, meta.width],
      region: { start: [0, 0], shape: [meta.height, meta.width] },
      data,
    }
  }
}