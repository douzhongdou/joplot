/**
 * Bayer 去马赛克（debayer / demosaic）。
 *
 * 输入是单通道 CFA 马赛克，输出平面分离的三通道 RGB（与本项目 `c` 轴布局一致）。
 * 提供两种算法：
 * - `bilinear`：双线性插值，快、实现简单，高对比边缘易出现伪色；
 * - `malvar`：Malvar-He-Cutler 5×5 梯度校正插值，边缘伪色更少。
 *
 * 滤镜序列（CFA 图案）可显式指定，覆盖文件元数据；用于厂商 RAW 未声明图案的情况。
 * 纯函数、不依赖浏览器 API，可在 Node 测试中直接验证。
 */

import { allocateBuffer, type Dtype, type PixelArray } from './types.ts'

/** 标准 2×2 Bayer 图案名。 */
export type CfaPatternName = 'rggb' | 'bggr' | 'grbg' | 'gbrg'

export type DebayerAlgorithm = 'bilinear' | 'malvar'

/** 图案编码 0=Red、1=Green、2=Blue，按行优先。 */
const PATTERN_TABLE: Record<CfaPatternName, readonly [number, number, number, number]> = {
  rggb: [0, 1, 1, 2],
  bggr: [2, 1, 1, 0],
  grbg: [1, 0, 2, 1],
  gbrg: [1, 2, 0, 1],
}

const PATTERN_NAMES: Record<string, CfaPatternName> = {
  '0,1,1,2': 'rggb',
  '2,1,1,0': 'bggr',
  '1,0,2,1': 'grbg',
  '1,2,0,1': 'gbrg',
}

/** 把 CFA 图案编码转成滤镜序列名；非标准 2×2 图案返回 undefined。 */
export function patternName(pattern: readonly number[]): CfaPatternName | undefined {
  return PATTERN_NAMES[pattern.join(',')]
}

/** 取图案在 `(row, col)` 处的颜色（0/1/2），支持负坐标。 */
export function cfaColorAt(pattern: CfaPatternName, row: number, col: number): 0 | 1 | 2 {
  const table = PATTERN_TABLE[pattern]
  const r = ((row % 2) + 2) % 2
  const c = ((col % 2) + 2) % 2
  return table[r * 2 + c] as 0 | 1 | 2
}

const ORTHO: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const DIAG: ReadonlyArray<readonly [number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]]

/** 双线性插值核（Malvar-He-Cutler 用的固定系数，除以 8）。 */
const G_AT_RB: readonly number[][] = [
  [0, 0, -1, 0, 0],
  [0, 0, 2, 0, 0],
  [-1, 2, 4, 2, -1],
  [0, 0, 2, 0, 0],
  [0, 0, -1, 0, 0],
]
const RB_AT_G_H: readonly number[][] = [
  [0, 0, 0.5, 0, 0],
  [0, -1, 0, -1, 0],
  [-1, 4, 5, 4, -1],
  [0, -1, 0, -1, 0],
  [0, 0, 0.5, 0, 0],
]
const RB_AT_G_V: readonly number[][] = transpose5(RB_AT_G_H)
const RB_AT_BR: readonly number[][] = [
  [0, 0, -1.5, 0, 0],
  [0, 2, 0, 2, 0],
  [-1.5, 0, 6, 0, -1.5],
  [0, 2, 0, 2, 0],
  [0, 0, -1.5, 0, 0],
]

export interface DebayerOptions {
  pattern: CfaPatternName
  algorithm: DebayerAlgorithm
}

/**
 * 去马赛克。
 *
 * 返回平面分离的三通道缓冲（长度 `3 × width × height`），dtype 与输入一致。
 * 算法产生的越界值按输入 dtype 的值域夹取（float32 不夹取）。
 */
export function demosaic(cfa: ArrayLike<number>, width: number, height: number, options: DebayerOptions): PixelArray {
  if (width < 1 || height < 1) throw new Error('debayer：尺寸必须为正')
  const pixels = width * height
  if (cfa.length < pixels) throw new Error(`debayer：输入长度 ${cfa.length} 小于 ${width}×${height}`)
  return options.algorithm === 'malvar'
    ? malvar(cfa, width, height, options.pattern)
    : bilinear(cfa, width, height, options.pattern)
}

/** 双线性：非绿位置的绿取自正交邻域，另一非绿通道取自对角邻域；越界邻域跳过。 */
function bilinear(cfa: ArrayLike<number>, width: number, height: number, pattern: CfaPatternName): Float32Array {
  const pixels = width * height
  const out = new Float32Array(pixels * 3)
  const inside = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const value = cfa[i]!
      const color = cfaColorAt(pattern, y, x)
      let r: number
      let g: number
      let b: number
      if (color === 1) {
        g = value
        let sumR = 0, countR = 0, sumB = 0, countB = 0
        for (const [dx, dy] of ORTHO) {
          const nx = x + dx
          const ny = y + dy
          if (!inside(nx, ny)) continue
          const neighbor = cfaColorAt(pattern, ny, nx)
          if (neighbor === 0) { sumR += cfa[ny * width + nx]!; countR += 1 }
          else if (neighbor === 2) { sumB += cfa[ny * width + nx]!; countB += 1 }
        }
        r = countR > 0 ? sumR / countR : value
        b = countB > 0 ? sumB / countB : value
      } else {
        let sumG = 0, countG = 0
        for (const [dx, dy] of ORTHO) {
          const nx = x + dx
          const ny = y + dy
          if (!inside(nx, ny)) continue
          sumG += cfa[ny * width + nx]!
          countG += 1
        }
        g = countG > 0 ? sumG / countG : value
        const wantOther = color === 0 ? 2 : 0
        let sumOther = 0, countOther = 0
        for (const [dx, dy] of DIAG) {
          const nx = x + dx
          const ny = y + dy
          if (!inside(nx, ny)) continue
          if (cfaColorAt(pattern, ny, nx) === wantOther) { sumOther += cfa[ny * width + nx]!; countOther += 1 }
        }
        const other = countOther > 0 ? sumOther / countOther : value
        r = color === 0 ? value : other
        b = color === 2 ? value : other
      }
      out[i] = r
      out[pixels + i] = g
      out[2 * pixels + i] = b
    }
  }
  return out
}

/** Malvar-He-Cutler：用固定的 5×5 梯度校正核恢复缺失通道。 */
function malvar(cfa: ArrayLike<number>, width: number, height: number, pattern: CfaPatternName): Float32Array {
  const pixels = width * height
  const out = new Float32Array(pixels * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const value = cfa[i]!
      const color = cfaColorAt(pattern, y, x)
      let r: number
      let g: number
      let b: number
      if (color === 1) {
        g = value
        // 缺失的非绿通道：R / B 在水平或垂直方向，取决于图案。
        const horizontalRed = cfaColorAt(pattern, y, x - 1) === 0 || cfaColorAt(pattern, y, x + 1) === 0
        const horizontalBlue = cfaColorAt(pattern, y, x - 1) === 2 || cfaColorAt(pattern, y, x + 1) === 2
        r = convolve5(cfa, x, y, width, height, horizontalRed ? RB_AT_G_H : RB_AT_G_V)
        b = convolve5(cfa, x, y, width, height, horizontalBlue ? RB_AT_G_H : RB_AT_G_V)
      } else {
        // 非绿位置：绿用 G 核，另一个非绿通道用对角核。
        g = convolve5(cfa, x, y, width, height, G_AT_RB)
        const other = convolve5(cfa, x, y, width, height, RB_AT_BR)
        if (color === 0) { r = value; b = other } else { b = value; r = other }
      }
      out[i] = r
      out[pixels + i] = g
      out[2 * pixels + i] = b
    }
  }
  return out
}

/** 5×5 卷积，系数和为 8，边界钳制。 */
function convolve5(cfa: ArrayLike<number>, x: number, y: number, width: number, height: number, kernel: readonly number[][]): number {
  let sum = 0
  for (let dy = -2; dy <= 2; dy += 1) {
    const row = kernel[dy + 2]!
    const yy = clamp(y + dy, 0, height - 1)
    for (let dx = -2; dx <= 2; dx += 1) {
      const coefficient = row[dx + 2]!
      if (coefficient === 0) continue
      const xx = clamp(x + dx, 0, width - 1)
      sum += coefficient * cfa[yy * width + xx]!
    }
  }
  return sum / 8
}

function transpose5(kernel: readonly number[][]): number[][] {
  return kernel.map((_, r) => kernel.map((row) => row[r]!))
}

/** 把 Float32 结果按目标 dtype 夹取并写入平面分离缓冲。 */
export function demosaicToDtype(
  cfa: ArrayLike<number>,
  width: number,
  height: number,
  dtype: Dtype,
  options: DebayerOptions,
): PixelArray {
  const float = demosaic(cfa, width, height, options)
  const out = allocateBuffer(dtype, float.length)
  const dst = out as unknown as { [index: number]: number }
  for (let i = 0; i < float.length; i += 1) dst[i] = clampToDtype(float[i]!, dtype)
  return out
}

function clampToDtype(value: number, dtype: Dtype): number {
  if (!Number.isFinite(value)) return 0
  switch (dtype) {
    case 'uint8': return Math.max(0, Math.min(255, Math.round(value)))
    case 'uint16': return Math.max(0, Math.min(65535, Math.round(value)))
    case 'int16': return Math.max(-32768, Math.min(32767, Math.round(value)))
    case 'float32': return value
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}
