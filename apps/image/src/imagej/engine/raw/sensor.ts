/**
 * 无头传感器裸数据导入（.raw）。
 *
 * 相机厂商的 RAW（DNG / CR2 / NEF / ARW …）外层是 TIFF 容器，头部自带宽高、位深与 CFA 图案，
 * 由 `raw/index.ts` 走 TIFF 索引解析。但相机 / 传感器直接落盘的裸数据（工业相机、FPGA、
 * sensor dump、MIPI 输出）通常**没有任何头**：宽、高、每像素位数、行填充、滤镜序列全都只能
 * 由用户给出。本模块负责两件事：
 *
 * 1. `guessSensorGeometry` 先替用户猜一遍：文件名里的 `4056x3040`、文件大小的精确整除、
 *    常见传感器尺寸表、以及宽高比近似，按可信度排序给出候选；
 * 2. `decodeRawSensor` 按最终参数解码成「单通道 CFA 马赛克灰度」，彩色交给 debayer 算子。
 *
 * 像素格式覆盖字节对齐容器（uint8 / uint16 / int16 / float32，各含大小端）与 MIPI 位打包
 * （RAW10 每 5 字节 4 像素、RAW12 每 3 字节 2 像素）——后者是传感器直出最常见的形态，
 * 用 `size ÷ 2` 去猜宽高一定会猜错，所以必须一并支持。
 */

import { allocateBuffer, type Dtype, type PixelArray } from '../types.ts'
import type { CfaPatternName } from '../debayer.ts'
import type { DecodedImage } from '../importer.ts'
import type { RawDecode } from './index.ts'

/** 像素容器类型：字节对齐的 8 / 16 / 32 位（含字节序），以及 MIPI 位打包。 */
export type RawSensorType =
  | 'uint8'
  | 'uint16-le' | 'uint16-be'
  | 'int16-le' | 'int16-be'
  | 'float32-le' | 'float32-be'
  | 'raw10' | 'raw12'

export const RAW_SENSOR_TYPES: readonly RawSensorType[] = [
  'uint16-le', 'uint8', 'raw10', 'raw12', 'uint16-be',
  'int16-le', 'float32-le', 'int16-be', 'float32-be',
]

/** 无头裸数据的导入参数。全部由用户给出，文件本身不携带这些信息。 */
export interface RawSensorOptions {
  width: number
  height: number
  type: RawSensorType
  /** 像素数据起始字节偏移（跳过文件头 / 行前置信息）。 */
  offset: number
  /** 每行字节数（行填充）；0 表示紧凑排列。 */
  stride: number
  /** 连续同尺寸帧数；> 1 时载入为 z 栈。 */
  frames: number
  /** 滤镜序列；'none' 表示单色传感器，不做 debayer。 */
  pattern: CfaPatternName | 'none'
}

/**
 * 单次导入的字节上限。
 *
 * 参数由用户手填，一个手误（少写一位宽）就能声明出几百 GB 的缓冲区并把 Worker 拖垮，
 * 所以分配之前必须先按这个上限挡掉。
 */
export const MAX_IMPORT_BYTES = 512 * 1024 * 1024

/** 单次导入的像素上限（约 2.7 亿），同样用于挡住手误参数。 */
export const MAX_IMPORT_PIXELS = 1 << 28

/** MIPI 位打包：每 N 个像素一组，占 M 字节。 */
const PACKING: Record<'raw10' | 'raw12', { pixels: number; bytes: number; bits: number }> = {
  raw10: { pixels: 4, bytes: 5, bits: 10 },
  raw12: { pixels: 2, bytes: 3, bits: 12 },
}

/** 是否 MIPI 位打包（无字节序概念，行内按位组打包）。 */
export function isPacked(type: RawSensorType): boolean {
  return type === 'raw10' || type === 'raw12'
}

/** 每个像素占用的位数。 */
export function bitsPerPixel(type: RawSensorType): number {
  switch (type) {
    case 'uint8': return 8
    case 'uint16-le': case 'uint16-be': case 'int16-le': case 'int16-be': return 16
    case 'float32-le': case 'float32-be': return 32
    case 'raw10': return 10
    case 'raw12': return 12
  }
}

/** 字节对齐容器的每像素字节数；打包类型返回平均值（1.25 / 1.5），只用于估算。 */
export function bytesPerPixel(type: RawSensorType): number {
  return bitsPerPixel(type) / 8
}

/** 位打包要求宽度是每组像素数的整数倍，否则一行放不下整组。 */
export function packAlignment(type: RawSensorType): number {
  return isPacked(type) ? PACKING[type as 'raw10' | 'raw12'].pixels : 2
}

/** 一行占用的字节数；打包类型按位组向上取整。 */
export function rowByteLength(width: number, type: RawSensorType): number {
  if (!isPacked(type)) return width * bytesPerPixel(type)
  const { pixels, bytes } = PACKING[type as 'raw10' | 'raw12']
  return Math.ceil(width / pixels) * bytes
}

/** 容器类型映射到数据集 dtype；10 / 12 位解包后是 uint16。 */
export function sensorDtype(type: RawSensorType): Dtype {
  switch (type) {
    case 'uint8': return 'uint8'
    case 'uint16-le': case 'uint16-be': case 'raw10': case 'raw12': return 'uint16'
    case 'int16-le': case 'int16-be': return 'int16'
    case 'float32-le': case 'float32-be': return 'float32'
  }
}

/** 单帧占用的字节数（含行填充）。 */
export function frameByteLength(options: Pick<RawSensorOptions, 'width' | 'height' | 'type' | 'stride'>): number {
  const row = options.stride > 0 ? options.stride : rowByteLength(options.width, options.type)
  return row * options.height
}

/** 导入所需的文件字节数（偏移 + 全部帧）。 */
export function requiredByteLength(options: RawSensorOptions): number {
  return options.offset + frameByteLength(options) * options.frames
}

/**
 * 校验参数，返回规整后的选项（stride 补齐为紧凑值）。
 *
 * 报错信息带具体数字：这类错误的成因基本都是「宽高填错一位」，把期望与实际都写出来
 * 用户才能自己修正。
 */
export function normalizeSensorOptions(
  options: RawSensorOptions,
  byteLength: number,
): RawSensorOptions {
  const { width, height, type, offset, frames } = options
  if (!Number.isInteger(width) || width <= 0) throw new Error(`宽度必须是正整数，当前为 ${width}`)
  if (!Number.isInteger(height) || height <= 0) throw new Error(`高度必须是正整数，当前为 ${height}`)
  if (!Number.isInteger(frames) || frames <= 0) throw new Error(`帧数必须是正整数，当前为 ${frames}`)
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`数据偏移必须是非负整数，当前为 ${offset}`)

  const tight = rowByteLength(width, type)
  // 位打包必须整组对齐，否则一行字节数算不准；字节对齐容器允许奇数宽（单色传感器/裁剪数据），只提示。
  if (isPacked(type) && width % packAlignment(type) !== 0) {
    throw new Error(`${type.toUpperCase()} 位打包要求宽度是 ${packAlignment(type)} 的倍数，当前为 ${width}`)
  }
  const stride = options.stride > 0 ? options.stride : tight
  if (!Number.isInteger(stride) || stride < tight) {
    throw new Error(`行字节数不能小于每行像素占用的 ${tight} 字节，当前为 ${options.stride}`)
  }

  const normalized: RawSensorOptions = { ...options, stride }
  const pixels = width * height * frames
  if (pixels > MAX_IMPORT_PIXELS) {
    throw new Error(`像素数 ${pixels} 超过单次导入上限 ${MAX_IMPORT_PIXELS}；请确认宽高与帧数`)
  }
  const needed = requiredByteLength(normalized)
  if (needed > MAX_IMPORT_BYTES) {
    throw new Error(`需要 ${needed} 字节，超过单次导入上限 ${MAX_IMPORT_BYTES}；请确认宽高与帧数`)
  }
  if (needed > byteLength) {
    throw new Error(`文件数据不足：按当前参数需要 ${needed} 字节，文件只有 ${byteLength} 字节`)
  }
  return normalized
}

/**
 * 已知宽度（与可选偏移 / 帧数）时，按文件大小推算能放下的行数。
 * 用于对话框里的「按文件大小填高度」；除不尽或不足一行时返回 undefined。
 */
export function inferHeight(
  byteLength: number,
  width: number,
  type: RawSensorType,
  offset = 0,
  frames = 1,
): number | undefined {
  if (!Number.isInteger(width) || width <= 0) return undefined
  if (!Number.isInteger(frames) || frames <= 0) return undefined
  if (isPacked(type) && width % packAlignment(type) !== 0) return undefined
  const row = rowByteLength(width, type)
  if (row <= 0) return undefined
  const usable = byteLength - offset
  if (usable < row * frames) return undefined
  const rows = Math.floor(usable / row)
  if (rows % frames !== 0) return undefined
  const height = rows / frames
  return height > 0 ? height : undefined
}

/** 文件大小恰好能装下的最大帧数（至少 1）；用于对话框里提示「文件含 N 帧」。 */
export function inferFrames(
  byteLength: number,
  width: number,
  height: number,
  type: RawSensorType,
  offset = 0,
  stride = 0,
): number {
  const frame = frameByteLength({ width, height, type, stride })
  if (frame <= 0) return 1
  return Math.max(1, Math.floor((byteLength - offset) / frame))
}

/* ------------------------------------------------------------------ *
 * 几何推测
 * ------------------------------------------------------------------ */

/** 一条推测出来的几何参数。 */
export interface SensorGuess {
  width: number
  height: number
  type: RawSensorType
  /** 按此参数导入正好用完文件（尾部没有多余字节）。 */
  exact: boolean
  /** 线索来源：文件名 / 文件大小 / 常见尺寸表 / 宽高比近似。 */
  source: 'filename' | 'size' | 'table' | 'aspect'
  /** 该参数需要的字节数。 */
  needed: number
}

/**
 * 常见传感器 / 视频输出尺寸。
 *
 * 只用来给「文件大小精确整除」的结果加分：裸数据没有任何元数据，能同时解释「总字节数」
 * 又落在常见尺寸上的组合，基本就是答案。
 */
const COMMON_GEOMETRIES: readonly (readonly [number, number])[] = [
  [640, 480], [800, 600], [1024, 768], [1280, 960], [1600, 1200], [2048, 1536],
  [1024, 1024], [2048, 2048], [4096, 4096], [1280, 1024], [1920, 1200], [1920, 1440],
  [1456, 1088], [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160], [4096, 2160],
  [7680, 4320], [2688, 1520], [4000, 2250], [5312, 2988],
  [2048, 1088], [2592, 1944], [3280, 2464], [3264, 2448], [4032, 3024], [4056, 3040],
  [4128, 3096], [4208, 3120], [4608, 3456], [4656, 3496], [5184, 3888],
  [5472, 3648], [6000, 4000], [6240, 4160], [6960, 4640], [7728, 5152],
  [8192, 5464], [8256, 5504], [9600, 6400], [10368, 6912], [11648, 8736], [12288, 8192],
  [2448, 2048], [2592, 2048], [4096, 3072], [5120, 4096], [4112, 3008], [1626, 1236],
  [4080, 3060], [4624, 3472], [8000, 6000], [8160, 6120], [9248, 6936], [12000, 9000],
]

const COMMON_KEYS = new Set(COMMON_GEOMETRIES.map(([width, height]) => `${width}x${height}`))

/** 常见度的先验顺序：16 位小端与 8 位最可能，打包次之，其余往后。 */
const TYPE_RANK: Record<RawSensorType, number> = {
  'uint16-le': 0,
  'uint8': 1,
  'raw10': 2,
  'raw12': 3,
  'uint16-be': 4,
  'int16-le': 5,
  'float32-le': 6,
  'int16-be': 7,
  'float32-be': 8,
}

const ASPECT_PRIORS: readonly number[] = [4 / 3, 3 / 2, 16 / 9, 1, 5 / 4]

/** 从文件名里找 `4056x3040` / `1920×1080` / `1280*720` 这类写法。 */
function geometryFromFileName(fileName: string): { width: number; height: number } | undefined {
  const match = /(\d{2,5})\s*[x×*]\s*(\d{2,5})/i.exec(fileName)
  if (!match) return undefined
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return undefined
  if (width < height) return undefined
  return { width, height }
}

/** 枚举 `pixels` 个像素的所有「像样」几何：宽 ≥ 高、宽高比 ≤ 2.6、按不同格式对齐。 */
function enumerateGeometry(pixels: number, type: RawSensorType): Array<{ width: number; height: number }> {
  const out: Array<{ width: number; height: number }> = []
  const align = packAlignment(type)
  const root = Math.sqrt(pixels)
  // 宽高比 ≤ 2.6 ⇒ 高 ≥ √(P/2.6)；宽 ≥ 高 ⇒ 高 ≤ √P。
  const minHeight = Math.max(2, Math.floor(root / 1.62))
  const maxHeight = Math.floor(root)
  for (let height = minHeight; height <= maxHeight; height += 1) {
    if (height % 2 !== 0) continue
    if (pixels % height !== 0) continue
    const width = pixels / height
    if (width % align !== 0) continue
    const ratio = width / height
    if (ratio < 1 || ratio > 2.6) continue
    out.push({ width, height })
  }
  return out
}

function aspectScore(width: number, height: number): number {
  const ratio = width / height
  const scores = [60, 55, 50, 45, 40]
  for (let i = 0; i < ASPECT_PRIORS.length; i += 1) {
    if (Math.abs(ratio - ASPECT_PRIORS[i]!) / ASPECT_PRIORS[i]! <= 0.015) return scores[i]!
  }
  return 0
}

/** 可信度：精确解远高于近似解，文件名与常见表再加权，格式按常见度微调。 */
function guessScore(guess: SensorGuess): number {
  let score = guess.exact ? 1000 : 0
  if (guess.source === 'filename') score += 800
  if (guess.source === 'table') score += 300
  score -= TYPE_RANK[guess.type] * 5
  score += aspectScore(guess.width, guess.height)
  if (guess.width % 8 === 0) score += 12
  if (guess.height % 8 === 0) score += 8
  return score
}

/**
 * 替用户猜宽高与像素格式，按可信度从高到低返回候选。
 *
 * 四条线索依次是：文件名里的 `WxH` → 文件大小的精确整除 → 常见尺寸表 → 宽高比近似。
 * 前三条都要求「按该参数导入正好用完文件」，所以只要命中就基本可以直接用；
 * 近似解只在完全猜不出时兜底，UI 需要明确标注它只是近似。
 */
export function guessSensorGeometry(
  byteLength: number,
  fileName = '',
  offset = 0,
  frames = 1,
  limit = 6,
): SensorGuess[] {
  const usable = byteLength - offset
  if (!Number.isFinite(byteLength) || usable <= 0) return []

  const candidates = new Map<string, SensorGuess>()
  const add = (guess: SensorGuess) => {
    const key = `${guess.width}x${guess.height}:${guess.type}`
    const existing = candidates.get(key)
    if (!existing || guessScore(guess) > guessScore(existing)) candidates.set(key, guess)
  }

  /** 该几何在此格式下是否正好用完文件。 */
  const exactNeeded = (width: number, height: number, type: RawSensorType): number | undefined => {
    if (width % packAlignment(type) !== 0) return undefined
    const needed = offset + rowByteLength(width, type) * height * frames
    return needed === byteLength ? needed : undefined
  }

  // 1) 文件名里的宽高
  const named = geometryFromFileName(fileName)
  if (named) {
    for (const type of RAW_SENSOR_TYPES) {
      const needed = exactNeeded(named.width, named.height, type)
      if (needed !== undefined) add({ ...named, type, exact: true, source: 'filename', needed })
    }
  }

  // 2) 文件大小精确整除（含帧数；常见尺寸在这里靠 source 加分体现，不重复枚举一遍）
  for (const type of RAW_SENSOR_TYPES) {
    const bits = bitsPerPixel(type)
    const totalBits = usable * 8
    if (totalBits % bits !== 0) continue
    const perFrame = totalBits / bits
    if (perFrame % frames !== 0) continue
    const pixels = perFrame / frames
    if (pixels < 4 || !Number.isFinite(pixels)) continue
    for (const { width, height } of enumerateGeometry(pixels, type)) {
      const needed = exactNeeded(width, height, type)
      if (needed === undefined) continue
      const source = COMMON_KEYS.has(`${width}x${height}`) ? 'table' : 'size'
      add({ width, height, type, exact: true, source, needed })
    }
  }

  if (candidates.size === 0) {
    // 4) 兜底：按最常见的 16 位容器 + 常见宽高比给近似解，交给用户核对。
    for (const ratio of ASPECT_PRIORS) {
      const pixels = Math.floor(usable / 2)
      if (pixels < 4) break
      const height = Math.max(2, Math.floor(Math.sqrt(pixels / ratio)) & ~1)
      const width = Math.floor(pixels / height) & ~1
      if (width < height || height <= 0) continue
      const needed = offset + rowByteLength(width, 'uint16-le') * height * frames
      add({ width, height, type: 'uint16-le', exact: false, source: 'aspect', needed })
    }
  }

  return [...candidates.values()]
    .sort((a, b) => guessScore(b) - guessScore(a) || b.width * b.height - a.width * a.height)
    .slice(0, limit)
}

/* ------------------------------------------------------------------ *
 * 容器判定与解码
 * ------------------------------------------------------------------ */

/** 容器类型：`tiff` 说明是带头的 RAW（DNG/CR2/…），`headless` 才是需要参数的裸数据。 */
export type RawContainerKind = 'tiff' | 'headless'

/**
 * 相机 RAW 常见后缀，含无头裸数据最常用的 `.raw`。
 *
 * 名单只有这一份：`importer.ts` 的格式分派与 UI 的「是否需要先问参数」都取自这里，
 * 避免两处漂移（`.raw` 当初就是漏在名单外才被丢给兜底解码器的）。
 */
export const RAW_SUFFIX = /\.(dng|cr2|crw|nef|nrw|arw|srf|sr2|orf|rw2|pef|srw|raf|3fr|fff|iiq|mrw|dcr|kdc|rwl|x3f|erf|mef|mos|mfw|raw)$/i

/**
 * 这个文件是否必须先让用户给参数，解码器才算得出宽高。
 *
 * 判据是「像 RAW（按后缀）**且**没有 TIFF 容器头」——两个条件缺一不可：
 * 只看文件头的话，JPG / PNG 也不是 TIFF，会被误判成裸数据。
 * UI 与解码器共用这一个函数，保证「弹了对话框」与「解码器要参数」永远是同一件事。
 */
export async function needsSensorOptions(file: File): Promise<boolean> {
  if (!RAW_SUFFIX.test(file.name)) return false
  return await probeRawContainer(file) === 'headless'
}

/**
 * 只读文件头判断是不是 TIFF 容器（含 BigTIFF）。
 *
 * 厂商 RAW 几乎都是 TIFF，能自带宽高位深；只有确认没有容器头时才需要向用户要参数，
 * 避免对 DNG 这类文件也弹一遍对话框。
 */
export async function probeRawContainer(blob: Blob): Promise<RawContainerKind> {
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
  if (head.length >= 4) {
    const little = head[0] === 0x49 && head[1] === 0x49 && (head[2] === 0x2a || head[2] === 0x2b) && head[3] === 0
    const big = head[0] === 0x4d && head[1] === 0x4d && head[2] === 0 && (head[3] === 0x2a || head[3] === 0x2b)
    if (little || big) return 'tiff'
  }
  return 'headless'
}

/** 解码无头裸数据：按参数读出单通道 CFA 马赛克（多帧时按 z 栈）。 */
export async function decodeRawSensor(blob: Blob, input: RawSensorOptions): Promise<RawDecode> {
  const options = normalizeSensorOptions(input, blob.size)
  const { width, height, type, stride, frames, pattern } = options
  const dtype = sensorDtype(type)
  const pixels = width * height

  const needed = requiredByteLength(options)
  // 只读需要的那一段：几百 MB 的裸文件里往往只用得上开头的若干帧。
  const buffer = new Uint8Array(await blob.slice(0, needed).arrayBuffer())
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  const data = allocateBuffer(dtype, pixels * frames)
  const frameBytes = frameByteLength(options)
  const tight = rowByteLength(width, type)
  for (let frame = 0; frame < frames; frame += 1) {
    const frameStart = options.offset + frame * frameBytes
    if (isPacked(type)) unpackRows(view, data, type as 'raw10' | 'raw12', frameStart, stride, width, height, frame * pixels)
    else readRows(view, data, type, frameStart, stride, width, height, frame * pixels)
  }

  const warnings: string[] = []
  const metadata: Record<string, string | number | boolean> = {
    rawSensor: true,
    rawOffset: options.offset,
    rawStride: stride,
    rawFrames: frames,
    rawType: type,
  }
  if (pattern === 'none') {
    warnings.push('未选择滤镜序列：按单色灰度载入（若这是 CFA 马赛克数据，请重新导入并选择图案）')
  } else {
    metadata.cfaPattern = pattern
  }
  if (frames > 1) warnings.push(`已按 ${frames} 帧载入为 z 栈`)
  if (stride > tight) warnings.push(`每行跳过 ${stride - tight} 字节填充`)
  if (isPacked(type)) warnings.push(`已按 MIPI ${type.toUpperCase()} 位打包解包为 ${bitsPerPixel(type)} 位/像素`)
  if (!isPacked(type) && width % 2 !== 0) warnings.push('宽度为奇数：CFA 传感器的行通常按 2 像素对齐，请确认宽高是否填对')

  const decoded: DecodedImage = {
    dtype,
    axes: frames > 1 ? ['z', 'y', 'x'] : ['y', 'x'],
    shape: frames > 1 ? [frames, height, width] : [height, width],
    channels: [{ index: 0, name: pattern === 'none' ? 'Channel 1' : 'CFA', kind: 'other' }],
    componentKind: 'scalar',
    data: data as PixelArray,
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    warnings,
  }
  return { decoded, metadata }
}

/** 字节对齐容器：逐像素读取，字节序在闭包里固定，循环里不再判断。 */
function readRows(
  view: DataView,
  data: PixelArray,
  type: RawSensorType,
  frameStart: number,
  stride: number,
  width: number,
  height: number,
  base: number,
): void {
  const read = readerFor(type as Exclude<RawSensorType, 'raw10' | 'raw12'>, view)
  const step = bytesPerPixel(type)
  for (let row = 0; row < height; row += 1) {
    const rowStart = frameStart + row * stride
    const rowBase = base + row * width
    for (let col = 0; col < width; col += 1) data[rowBase + col] = read(rowStart + col * step)
  }
}

/**
 * MIPI 位打包：RAW10 每 5 字节 4 个像素（每个像素的低 2 位挤在第 5 字节），
 * RAW12 每 3 字节 2 个像素（低 4 位挤在第 3 字节）。
 */
function unpackRows(
  view: DataView,
  data: PixelArray,
  type: 'raw10' | 'raw12',
  frameStart: number,
  stride: number,
  width: number,
  height: number,
  base: number,
): void {
  for (let row = 0; row < height; row += 1) {
    const rowStart = frameStart + row * stride
    const rowBase = base + row * width
    if (type === 'raw10') {
      const groups = width / 4
      for (let group = 0; group < groups; group += 1) {
        const at = rowStart + group * 5
        const b0 = view.getUint8(at), b1 = view.getUint8(at + 1), b2 = view.getUint8(at + 2), b3 = view.getUint8(at + 3), b4 = view.getUint8(at + 4)
        const out = rowBase + group * 4
        data[out] = (b0 << 2) | (b4 & 0x03)
        data[out + 1] = (b1 << 2) | ((b4 >> 2) & 0x03)
        data[out + 2] = (b2 << 2) | ((b4 >> 4) & 0x03)
        data[out + 3] = (b3 << 2) | ((b4 >> 6) & 0x03)
      }
    } else {
      const groups = width / 2
      for (let group = 0; group < groups; group += 1) {
        const at = rowStart + group * 3
        const b0 = view.getUint8(at), b1 = view.getUint8(at + 1), b2 = view.getUint8(at + 2)
        const out = rowBase + group * 2
        data[out] = (b0 << 4) | (b2 & 0x0f)
        data[out + 1] = (b1 << 4) | ((b2 >> 4) & 0x0f)
      }
    }
  }
}

/** 按容器类型选对应的读取函数。 */
function readerFor(type: Exclude<RawSensorType, 'raw10' | 'raw12'>, view: DataView): (at: number) => number {
  switch (type) {
    case 'uint8': return (at) => view.getUint8(at)
    case 'uint16-le': return (at) => view.getUint16(at, true)
    case 'uint16-be': return (at) => view.getUint16(at, false)
    case 'int16-le': return (at) => view.getInt16(at, true)
    case 'int16-be': return (at) => view.getInt16(at, false)
    case 'float32-le': return (at) => view.getFloat32(at, true)
    case 'float32-be': return (at) => view.getFloat32(at, false)
  }
}
