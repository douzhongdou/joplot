/**
 * FITS 像素解码：依据 `FitsHdu` 读出数据段，还原成项目内部的 `DecodedImage`。
 *
 * 三条约定：
 * - FITS 数据恒为大端，`DataView` 的 `littleEndian` 参数一律传 false。
 * - 数据在文件里就是「x 变化最快、其后 y、再后 z」的行优先布局，与内部缓冲一致，
 *   因此不需要重排，只需按 BITPIX 解释并做 BSCALE/BZERO 变换。
 * - BITPIX 只有 8/16/32/64/-32/-64；内部 dtype 只有四种，超出部分统一转 float32 并提示。
 *
 * BSCALE/BZERO 的两个「无损特例」保持整数 dtype：
 * - `BITPIX=16, BZERO=32768, BSCALE=1` 表示无符号 16 位，读成 `uint16`；
 * - `BITPIX=8, BZERO=128, BSCALE=1` 表示有符号字节存储的无符号 8 位，读成 `uint8`。
 * 其余非平凡变换落到 float32，并提示已应用物理值。
 */

import type { AxisName, ChannelInfo, Dtype, PixelArray } from '../types.ts'
import { readBlobBytes, indexFits, type FitsHdu, type FitsIndex } from './index.ts'
import type { DecodedImage } from '../importer.ts'

/** 原始样本的读取方式。 */
export type FitsRawKind = 'u8' | 'i8' | 'i16' | 'i32' | 'i64' | 'f32' | 'f64'

export interface FitsDecodePlan {
  /** 按此类型从字节中取出原始样本。 */
  kind: FitsRawKind
  /** 输出缓冲的类型。 */
  dtype: Dtype
  /** 物理值 = offset + scale × raw。 */
  scale: number
  offset: number
  warnings: string[]
}

/** `[NAXIS1, …]` → 内部逻辑轴与形状。FITS 维度顺序与内部行优先一致。 */
export function fitsLayout(hdu: FitsHdu): { axes: AxisName[]; shape: number[] } {
  const lengths = hdu.axes
  if (lengths.length === 1) return { axes: ['y', 'x'], shape: [1, lengths[0]!] }
  if (lengths.length === 2) return { axes: ['y', 'x'], shape: [lengths[1]!, lengths[0]!] }
  if (lengths.length === 3) return { axes: ['z', 'y', 'x'], shape: [lengths[2]!, lengths[1]!, lengths[0]!] }
  throw new Error(`FITS 暂只支持 1~3 维图像，当前 NAXIS=${lengths.length}`)
}

/** 依据 BITPIX 与 BSCALE/BZERO 决定读取方式与输出 dtype。 */
export function fitsDecodePlan(hdu: FitsHdu): FitsDecodePlan {
  const bitpix = hdu.bitpix
  if (bitpix === undefined) throw new Error('FITS HDU 缺少 BITPIX')
  const bscale = hdu.header.number('BSCALE') ?? 1
  const bzero = hdu.header.number('BZERO') ?? 0
  const warnings: string[] = []
  const plan = (kind: FitsRawKind, dtype: Dtype, scale = 1, offset = 0): FitsDecodePlan =>
    ({ kind, dtype, scale, offset, warnings })
  const physics = (): void => {
    if (bscale !== 1 || bzero !== 0) warnings.push(`已应用 BZERO=${bzero}、BSCALE=${bscale} 的物理值变换`)
  }

  switch (bitpix) {
    case 8:
      if (bscale === 1 && bzero === 0) return plan('u8', 'uint8')
      if (bscale === 1 && bzero === 128) return plan('i8', 'uint8')
      physics()
      return plan('i8', 'float32', bscale, bzero)
    case 16:
      if (bscale === 1 && bzero === 0) return plan('i16', 'int16')
      if (bscale === 1 && bzero === 32768) return plan('i16', 'uint16')
      physics()
      return plan('i16', 'float32', bscale, bzero)
    case 32:
      warnings.push('BITPIX=32 的 32 位整数已转换为 float32 载入')
      physics()
      return plan('i32', 'float32', bscale, bzero)
    case 64:
      warnings.push('BITPIX=64 的 64 位整数已转换为 float32 载入，可能损失精度')
      physics()
      return plan('i64', 'float32', bscale, bzero)
    case -32:
      physics()
      return plan('f32', 'float32', bscale, bzero)
    case -64:
      warnings.push('BITPIX=-64 的双精度浮点已转换为 float32 载入，可能损失精度')
      physics()
      return plan('f64', 'float32', bscale, bzero)
    default:
      throw new Error(`不支持的 FITS BITPIX=${bitpix}`)
  }
}

/** 按计划把大端字节解释为像素缓冲。 */
export function decodeFitsSamples(bytes: Uint8Array, plan: FitsDecodePlan, count: number): PixelArray {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  switch (plan.dtype) {
    case 'uint8': {
      const out = new Uint8Array(count)
      if (plan.kind === 'i8') {
        // 有符号字节 + 128 ≡ 与 0x80 异或，值域回到 0..255 且无需分支。
        for (let i = 0; i < count; i += 1) out[i] = bytes[i]! ^ 0x80
      } else {
        for (let i = 0; i < count; i += 1) out[i] = bytes[i]!
      }
      return out
    }
    case 'int16': {
      const out = new Int16Array(count)
      for (let i = 0; i < count; i += 1) out[i] = view.getInt16(i * 2, false)
      return out
    }
    case 'uint16': {
      const out = new Uint16Array(count)
      for (let i = 0; i < count; i += 1) out[i] = view.getInt16(i * 2, false) + 32768
      return out
    }
    case 'float32': {
      const out = new Float32Array(count)
      for (let i = 0; i < count; i += 1) {
        out[i] = plan.offset + plan.scale * readRaw(view, bytes, i, plan.kind)
      }
      return out
    }
  }
}

function readRaw(view: DataView, bytes: Uint8Array, index: number, kind: FitsRawKind): number {
  switch (kind) {
    case 'u8': return bytes[index]!
    case 'i8': return view.getInt8(index)
    case 'i16': return view.getInt16(index * 2, false)
    case 'i32': return view.getInt32(index * 4, false)
    case 'i64': return Number(view.getBigInt64(index * 8, false))
    case 'f32': return view.getFloat32(index * 4, false)
    case 'f64': return view.getFloat64(index * 8, false)
  }
}

/** 取第一个可解码的图像 HDU；没有则给出可读错误。 */
export function pickImageHdu(index: FitsIndex): FitsHdu {
  const hdu = index.imageHdus[0]
  if (!hdu) throw new Error('FITS 文件中没有可解码的图像 HDU')
  return hdu
}

/** 解码 FITS 文件的主图像 HDU。 */
export async function decodeFitsFile(blob: Blob): Promise<DecodedImage> {
  const index = await indexFits(blob)
  const hdu = pickImageHdu(index)
  const { axes, shape } = fitsLayout(hdu)
  const plan = fitsDecodePlan(hdu)
  const count = shape.reduce((product, length) => product * length, 1)
  const bytes = await readBlobBytes(blob, hdu.dataStart, hdu.dataLength)
  if (bytes.byteLength < hdu.dataLength) throw new Error('FITS 数据段不完整或文件被截断')
  const data = decodeFitsSamples(bytes, plan, count)

  const warnings = [...plan.warnings]
  if (index.imageHdus.length > 1) {
    warnings.push(`文件含 ${index.imageHdus.length} 个图像 HDU，本次载入第 ${hdu.ordinal + 1} 个`)
  }
  if (hdu.header.number('BLANK') !== undefined) {
    warnings.push('文件声明了 BLANK 缺失值，当前按原始值保留')
  }
  if (axes.length === 3) warnings.push('第 3 维按 z 轴载入')

  const channels: ChannelInfo[] = [{ index: 0, name: 'Channel 1', kind: 'other' }]
  return {
    dtype: plan.dtype,
    axes,
    shape,
    data,
    channels,
    componentKind: 'scalar',
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    warnings,
  }
}
