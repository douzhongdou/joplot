/**
 * 导入：文件 → Dataset + Storage。
 *
 * 优先使用 ITK-Wasm image-io 解码（保留 16 位 / 浮点精度，支持压缩 TIFF 等科学格式）；
 * 不可用时回退到仓库既有的 8 位经典 TIFF 解码器。源数据保持只读，导入不降精度。
 */
import type { Image as ItkImage } from 'itk-wasm'
import { createDataset, nextDatasetId, type Dataset } from './dataset.ts'
import { MemoryStorage, type Storage, type StorageMetadata } from './storage.ts'
import { TiffStackStorage } from './storage-tiff.ts'
import { MultiFileStackStorage, pageSignature } from './storage-multi.ts'
import { TiffPageSource, dtypeOf } from './tiff/source.ts'
import { type Dtype, type ChannelInfo, type ImageBlock, uncalibratedSpatialTransform, allocateBuffer, type PixelArray } from './types.ts'
import { decodeTiff } from '../lib/tiff.ts'
import type { GrayImage } from '../lib/processor.ts'

export interface ImportResult {
  dataset: Dataset
  storage: Storage
  /** 导入过程中的降精度 / 兼容性提示；UI 应显示。 */
  warnings: string[]
}

export function fileFingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function makeSource(file: File, format: StorageMetadata['source']['format']) {
  return {
    kind: 'file' as const,
    name: file.name,
    format,
    byteLength: file.size,
    lastModified: file.lastModified,
    fingerprint: fileFingerprint(file),
  }
}

/** FITS 常见扩展名：.fits / .fit / .fts。 */
const FITS_SUFFIX = /\.(fits|fit|fts)$/

/** 相机 RAW 扩展名；非 TIFF 容器会在解码时给出明确错误。 */
const RAW_SUFFIX = /\.(dng|cr2|crw|nef|nrw|arw|srf|sr2|orf|rw2|pef|srw|raf|3fr|fff|iiq|mrw|dcr|kdc|rwl|x3f|erf|mef|mos|mfw)$/i

function formatFor(file: File): StorageMetadata['source']['format'] {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.tif') || lower.endsWith('.tiff') || file.type === 'image/tiff') return 'tiff'
  if (lower.endsWith('.png') || file.type === 'image/png') return 'png'
  if (lower.endsWith('.webp') || file.type === 'image/webp') return 'webp'
  if (FITS_SUFFIX.test(lower) || file.type === 'image/fits' || file.type === 'application/fits') return 'fits'
  if (RAW_SUFFIX.test(lower)) return 'raw'
  return 'unknown'
}

function componentTypeByteLength(componentType: string): number {
  switch (componentType) {
    case 'uint8':
    case 'int8': return 1
    case 'uint16':
    case 'int16': return 2
    default: return 4
  }
}

/**
 * 各解码器（ITK / FITS / 原生位图）的统一产物：无标定默认值的中间表示。
 * 由 `datasetFromDecoded` 组装成 Dataset + Storage。
 */
export interface DecodedImage {
  dtype: Dtype
  axes: Dataset['axes']
  shape: number[]
  channels: ChannelInfo[]
  componentKind: 'scalar' | 'rgb'
  data: PixelArray
  spacing: [number, number, number]
  origin: [number, number, number]
  warnings: string[]
}

/** 把 itk Image 规整为单分量、x 最快的行优先缓冲。 */
function normalizeItkImage(image: ItkImage): DecodedImage {
  if (!image.data) throw new Error('ITK 图像缺少像素数据')
  const warnings: string[] = []
  const components = image.imageType.components
  const componentType = String(image.imageType.componentType)
  let dtype: Dtype
  switch (componentType) {
    case 'uint8': case 'int8': dtype = 'uint8'; break
    case 'uint16': dtype = 'uint16'; break
    case 'int16': dtype = 'int16'; break
    case 'float32': dtype = 'float32'; break
    default:
      dtype = 'float32'
      warnings.push(`分量类型 ${componentType} 暂以 float32 载入，可能损失精度`)
  }
  const size = image.size
  const dimension = size.length
  if (dimension !== 2 && dimension !== 3) {
    throw new Error(`暂不支持 ${dimension} 维图像`)
  }
  const [width, height] = [size[0]!, size[1]!]
  const depth = dimension === 3 ? size[2]! : 1
  const pixels = width * height * depth
  const source = image.data as unknown as { readonly length: number; readonly [index: number]: number }

  if (components === 1) {
    const data = allocateBuffer(dtype, pixels)
    const dst = data as unknown as { [index: number]: number }
    const needsCast = componentTypeByteLength(componentType) !== componentTypeByteLength(String(dtype))
    for (let i = 0; i < pixels; i += 1) dst[i] = source[i]!
    if (needsCast) warnings.push(`已把 ${componentType} 转换为 ${dtype}`)
    const axes: Dataset['axes'] = dimension === 3 ? ['z', 'y', 'x'] : ['y', 'x']
    const shape = dimension === 3 ? [depth, height, width] : [height, width]
    return {
      dtype, axes, shape, channels: [{ index: 0, name: 'Channel 1', kind: 'other' }],
      componentKind: 'scalar',
      data, spacing: spacingOf(image), origin: originOf(image), warnings,
    }
  }

  if (components === 3 || components === 4) {
    if (dtype !== 'uint8') warnings.push('彩色图像按 uint8 载入')
    const data = new Uint8Array(pixels * 3)
    const channels: ChannelInfo[] = [
      { index: 0, name: 'Red', kind: 'rgb', displayColor: [255, 0, 0] },
      { index: 1, name: 'Green', kind: 'rgb', displayColor: [0, 255, 0] },
      { index: 2, name: 'Blue', kind: 'rgb', displayColor: [0, 0, 255] },
    ]
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      for (let c = 0; c < 3; c += 1) {
        data[c * pixels + pixel] = source[pixel * components + c]!
      }
    }
    const axes: Dataset['axes'] = dimension === 3 ? ['c', 'z', 'y', 'x'] : ['c', 'y', 'x']
    const shape = dimension === 3 ? [3, depth, height, width] : [3, height, width]
    return { dtype: 'uint8', axes, shape, channels, componentKind: 'rgb', data, spacing: spacingOf(image), origin: originOf(image), warnings }
  }

  throw new Error(`暂不支持 ${components} 分量图像`)
}

function spacingOf(image: ItkImage): [number, number, number] {
  const spacing = image.spacing
  return [spacing[0] ?? 1, spacing[1] ?? 1, spacing[2] ?? 1]
}
function originOf(image: ItkImage): [number, number, number] {
  const origin = image.origin
  return [origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0]
}

function datasetFromDecoded(file: File, imported: DecodedImage, decodedWith: string, extraMetadata?: Readonly<Record<string, string | number | boolean>>): ImportResult {
  const calibrated = imported.spacing.some((s) => s !== 1) || imported.origin.some((o) => o !== 0)
  const dataset = createDataset({
    dtype: imported.dtype,
    axes: imported.axes,
    shape: imported.shape,
    spatialTransform: {
      spacing: imported.spacing,
      origin: imported.origin,
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      unit: calibrated ? 'um' : 'px',
      calibrated,
    },
    channels: imported.channels,
    componentKind: imported.componentKind,
    source: makeSource(file, formatFor(file)),
    metadata: { decodedWith, ...extraMetadata },
  })
  const storageMeta: StorageMetadata = {
    dtype: dataset.dtype,
    axes: dataset.axes,
    shape: dataset.shape,
    spatialTransform: dataset.spatialTransform,
    channels: dataset.channels,
    source: dataset.source,
  }
  return {
    dataset,
    storage: new MemoryStorage(nextDatasetId('store'), storageMeta, imported.data),
    warnings: imported.warnings,
  }
}

function datasetFromGrayPages(file: File, pages: GrayImage[], w: number, h: number): ImportResult {
  const total = pages.reduce((sum, page) => sum + page.data.length, 0)
  const data = new Uint8Array(total)
  let offset = 0
  for (const page of pages) {
    data.set(page.data, offset)
    offset += page.data.length
  }
  const axes: Dataset['axes'] = pages.length > 1 ? ['z', 'y', 'x'] : ['y', 'x']
  const shape = pages.length > 1 ? [pages.length, h, w] : [h, w]
  const dataset = createDataset({
    dtype: 'uint8',
    axes,
    shape,
    spatialTransform: uncalibratedSpatialTransform(),
    channels: [{ index: 0, name: 'Channel 1', kind: 'other' }],
    source: makeSource(file, formatFor(file)),
    metadata: { decodedWith: 'fallback-tiff' },
  })
  const storageMeta: StorageMetadata = {
    dtype: dataset.dtype,
    axes: dataset.axes,
    shape: dataset.shape,
    spatialTransform: dataset.spatialTransform,
    channels: dataset.channels,
    source: dataset.source,
  }
  return {
    dataset,
    storage: new MemoryStorage(nextDatasetId('store'), storageMeta, data),
    warnings: ['ITK-Wasm 解码不可用，使用内置 8 位 TIFF 解码器；压缩 / 16 位文件可能失败'],
  }
}

/**
 * 尝试把 TIFF 作为惰性页栈导入。
 *
 * 只在「索引建立成功」且「全部页都能未压缩读取」时接管，否则返回 null 交回 ITK。
 * 这样既让 Stack 具备按页随机读取能力，又不会削弱既有的格式覆盖面
 * （压缩 TIFF、PNG 等仍由 ITK-Wasm 处理）。
 *
 * 页映射为 z 轴切片，详见 `storage-tiff.ts` 的轴映射表。
 */
async function tryTiffStack(file: File): Promise<ImportResult | null> {
  if (formatFor(file) !== 'tiff') return null
  let source: TiffPageSource
  try {
    source = await TiffPageSource.open(file)
  } catch {
    // 不是可索引的 TIFF（损坏、被截断、变体不受支持等），交回 ITK 尝试。
    return null
  }
  const first = source.index.pages[0]
  if (!first) return null
  const dtype = dtypeOf(first)
  if (!dtype) return null
  // 只要有任意一页读不了，整个栈就不能按页浏览；此时交回 ITK 全量解码。
  const unsupported = source.unsupportedPages()
  if (unsupported.length > 0) return null

  const pages = source.pageCount
  const height = first.height
  const width = first.width
  const rgb = first.components === 3
  const axes: Dataset['axes'] = rgb
    ? (pages > 1 ? ['c', 'z', 'y', 'x'] : ['c', 'y', 'x'])
    : (pages > 1 ? ['z', 'y', 'x'] : ['y', 'x'])
  const shape = rgb
    ? (pages > 1 ? [3, pages, height, width] : [3, height, width])
    : (pages > 1 ? [pages, height, width] : [height, width])

  const channels: ChannelInfo[] = rgb
    ? [
      { index: 0, name: 'Red', kind: 'rgb', displayColor: [255, 0, 0] },
      { index: 1, name: 'Green', kind: 'rgb', displayColor: [0, 255, 0] },
      { index: 2, name: 'Blue', kind: 'rgb', displayColor: [0, 0, 255] },
    ]
    : [{ index: 0, name: 'Channel 1', kind: 'other' }]

  const dataset = createDataset({
    dtype,
    axes,
    shape,
    spatialTransform: uncalibratedSpatialTransform(),
    channels,
    source: makeSource(file, 'tiff'),
    componentKind: rgb ? 'rgb' : 'scalar',
    metadata: { decodedWith: 'tiff-index', pages, pageRead: true },
  })
  const storageMeta: StorageMetadata = {
    dtype: dataset.dtype,
    axes: dataset.axes,
    shape: dataset.shape,
    spatialTransform: dataset.spatialTransform,
    channels: dataset.channels,
    source: dataset.source,
    metadata: dataset.metadata,
  }
  const warnings = [
    `已按页随机读取 TIFF：共 ${pages} 页，单页 ${width}×${height}，不整卷载入内存`,
  ]
  if (pages === 1) warnings.push('该 TIFF 只有 1 页，无可翻页的 Stack')
  return {
    dataset,
    storage: new TiffStackStorage(nextDatasetId('store'), storageMeta, source),
    warnings,
  }
}

/**
 * 导入文件。
 *
 * 先按扩展名分派自研解码器：FITS 走 `fits/`，WebP 走浏览器原生位图。
 * 其余文件 TIFF 优先走惰性页栈（整卷像素不驻留内存，翻页时按页读取）；
 * 再尝试 ITK-Wasm；失败后回退内置 8 位 TIFF 解码器。
 * 可用 `decoder` 覆盖 ITK 解码器（测试注入），不影响 TIFF / FITS / WebP 路径。
 */
export async function importFile(
  file: File,
  decoder?: (file: File) => Promise<ItkImage | null>,
): Promise<ImportResult> {
  const format = formatFor(file)
  if (format === 'fits') return importFits(file)
  if (format === 'webp') return importWebp(file)
  if (format === 'raw') return importRaw(file)

  const stack = await tryTiffStack(file)
  if (stack) return stack

  const decode = decoder ?? defaultItkDecoder()
  if (decode) {
    try {
      const image = await decode(file)
      if (image) return datasetFromDecoded(file, normalizeItkImage(image), 'itk-wasm')
    } catch (error) {
      // 继续走回退路径，但保留提示。
      const fallback = await fallbackTiff(file)
      if (fallback) {
        fallback.warnings.unshift(`ITK 解码失败：${error instanceof Error ? error.message : String(error)}`)
        return fallback
      }
      throw error
    }
  }
  const fallback = await fallbackTiff(file)
  if (fallback) return fallback
  throw new Error('无法解码该文件：既不是可解码的 TIFF / FITS / WebP，也不是 ITK 支持的格式')
}

/** FITS：自研解析器，保留整数 / 浮点精度与多维 z 栈。 */
async function importFits(file: File): Promise<ImportResult> {
  const { decodeFitsFile } = await import('./fits/source.ts')
  return datasetFromDecoded(file, await decodeFitsFile(file), 'fits')
}

/** WebP：ITK 不覆盖，交由浏览器原生解码（OffscreenCanvas / Canvas）。 */
async function importWebp(file: File): Promise<ImportResult> {
  const { decodeWebpFile } = await import('./bitmap.ts')
  const decoded = await decodeWebpFile(file)
  if (!decoded) throw new Error('当前环境不支持原生 WebP 解码（缺少 createImageBitmap / Canvas）')
  return datasetFromDecoded(file, decoded, 'webp-native')
}

/** RAW：自研解码，输出单通道 CFA 马赛克灰度 + CFA 元数据，彩色由 debayer 算子还原。 */
async function importRaw(file: File): Promise<ImportResult> {
  const { decodeRawFile } = await import('./raw/index.ts')
  const { decoded, metadata } = await decodeRawFile(file)
  return datasetFromDecoded(file, decoded, 'raw-tiff', metadata)
}

function defaultItkDecoder(): (file: File) => Promise<ItkImage | null> {
  return async (file: File) => {
    const { decodeImageFile } = await import('./compute/itk.ts')
    const { image } = await decodeImageFile(file)
    return image
  }
}

async function fallbackTiff(file: File): Promise<ImportResult | null> {
  const lower = file.name.toLowerCase()
  if (!lower.endsWith('.tif') && !lower.endsWith('.tiff')) return null
  const buffer = await file.arrayBuffer()
  const pages = decodeTiff(buffer)
  return datasetFromGrayPages(file, pages, pages[0]!.width, pages[0]!.height)
}

/**
 * 把多个图像文件合成一个 Stack（惰性）。
 *
 * 页映射为 z 轴切片（与 `storage-tiff.ts` 的轴映射一致）。导入时**只解码第一页**拿到
 * dtype / 尺寸 / 分量，其余页在翻到时才解码并按字节预算缓存；因此 12 张 36MB 的 JPEG
 * 不会在导入时一次性占满内存。要求各页同 dtype、同 y/x 尺寸、同分量语义且均为单帧，
 * 不一致会在该页首次被读到时抛出可读错误。
 */
export async function importImageStack(
  files: readonly File[],
  decoder?: (file: File) => Promise<ItkImage | null>,
): Promise<ImportResult> {
  if (files.length < 2) throw new Error('合成 Stack 至少需要两张图像')

  /** 解码某一页为原生块（读完整帧后释放临时存储）。 */
  const decodePage = async (file: File): Promise<ImageBlock> => {
    const result = await importFile(file, decoder)
    const meta = result.storage.metadata()
    const region = { start: meta.axes.map(() => 0), shape: [...meta.shape] }
    try {
      return await result.storage.readRegion(region)
    } finally {
      result.storage.release()
    }
  }

  const firstBlock = await decodePage(files[0]!)
  const signature = pageSignature(firstBlock)
  if (signature.componentKind === 'scalar' && firstBlock.axes.some((axis, index) => (axis === 'z' || axis === 't') && (firstBlock.shape[index] ?? 1) > 1)) {
    throw new Error(`第 1 张「${files[0]!.name}」本身是多页 Stack，不能再合成 Stack`)
  }

  const rgb = signature.componentKind === 'rgb'
  const axes: Dataset['axes'] = rgb ? ['c', 'z', 'y', 'x'] : ['z', 'y', 'x']
  const shape = rgb ? [3, files.length, signature.height, signature.width] : [files.length, signature.height, signature.width]
  const channels: ChannelInfo[] = rgb
    ? [
      { index: 0, name: 'Red', kind: 'rgb', displayColor: [255, 0, 0] },
      { index: 1, name: 'Green', kind: 'rgb', displayColor: [0, 255, 0] },
      { index: 2, name: 'Blue', kind: 'rgb', displayColor: [0, 0, 255] },
    ]
    : [{ index: 0, name: 'Channel 1', kind: 'other' }]
  const dataset = createDataset({
    dtype: signature.dtype,
    axes,
    shape,
    spatialTransform: uncalibratedSpatialTransform(),
    channels,
    componentKind: signature.componentKind,
    source: {
      kind: 'memory',
      name: stackName(files),
      format: 'unknown',
      fingerprint: `stack:${files.map(fileFingerprint).join('|')}`,
    },
    metadata: { decodedWith: 'multi-file', pages: files.length, lazy: true },
  })
  const storageMeta: StorageMetadata = {
    dtype: dataset.dtype,
    axes: dataset.axes,
    shape: dataset.shape,
    spatialTransform: dataset.spatialTransform,
    channels: dataset.channels,
    source: dataset.source,
  }
  return {
    dataset,
    storage: new MultiFileStackStorage(nextDatasetId('store'), storageMeta, files, decodePage, { index: 0, block: firstBlock }),
    warnings: [`已按需懒加载 ${files.length} 页：翻页时才解码（导入只解码第 1 页取尺寸）`],
  }
}

/** Stack 的展示名：文件夹导入取目录名，其余用页数。 */
function stackName(files: readonly File[]): string {
  const relative = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath
  if (relative && relative.includes('/')) return relative.split('/')[0]!
  return `${files.length} images`
}

/** 由内存中的像素数组直接构造 Dataset（测试与生成的样例）。 */
export function importMemory(input: {
  name: string
  dtype: Dtype
  axes: Dataset['axes']
  shape: readonly number[]
  data: PixelArray
  channels?: readonly ChannelInfo[]
  componentKind?: 'scalar' | 'rgb'
  spacing?: [number, number, number]
}): ImportResult {
  const dataset = createDataset({
    dtype: input.dtype,
    axes: input.axes,
    shape: input.shape,
    spatialTransform: input.spacing
      ? { spacing: input.spacing, origin: [0, 0, 0], direction: [1, 0, 0, 0, 1, 0, 0, 0, 1], unit: 'um', calibrated: true }
      : uncalibratedSpatialTransform(),
    channels: input.channels ?? [{ index: 0, name: 'Channel 1', kind: 'other' }],
    componentKind: input.componentKind,
    source: { kind: 'memory', name: input.name, format: 'memory', fingerprint: `memory:${input.name}:${input.shape.join('x')}` },
  })
  const storageMeta: StorageMetadata = {
    dtype: dataset.dtype,
    axes: dataset.axes,
    shape: dataset.shape,
    spatialTransform: dataset.spatialTransform,
    channels: dataset.channels,
    source: dataset.source,
  }
  return { dataset, storage: new MemoryStorage(nextDatasetId('store'), storageMeta, input.data), warnings: [] }
}
