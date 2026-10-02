/**
 * 导入：文件 → Dataset + Storage。
 *
 * 优先使用 ITK-Wasm image-io 解码（保留 16 位 / 浮点精度，支持压缩 TIFF 等科学格式）；
 * 不可用时回退到仓库既有的 8 位经典 TIFF 解码器。源数据保持只读，导入不降精度。
 */
import type { Image as ItkImage } from 'itk-wasm'
import { createDataset, nextDatasetId, type Dataset } from './dataset.ts'
import { MemoryStorage, type Storage, type StorageMetadata } from './storage.ts'
import { type Dtype, type ChannelInfo, uncalibratedSpatialTransform, allocateBuffer, type PixelArray } from './types.ts'
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

function formatFor(file: File): StorageMetadata['source']['format'] {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.tif') || lower.endsWith('.tiff') || file.type === 'image/tiff') return 'tiff'
  if (lower.endsWith('.png') || file.type === 'image/png') return 'png'
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

interface ItkImport {
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
function normalizeItkImage(image: ItkImage): ItkImport {
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

function datasetFromItk(file: File, imported: ItkImport): ImportResult {
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
    metadata: { decodedWith: 'itk-wasm' },
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
 * 导入文件。默认先尝试 ITK-Wasm；失败后回退内置 TIFF。
 * 可用 `decoder` 覆盖解码器（测试注入）。
 */
export async function importFile(
  file: File,
  decoder?: (file: File) => Promise<ItkImage | null>,
): Promise<ImportResult> {
  const decode = decoder ?? defaultItkDecoder()
  if (decode) {
    try {
      const image = await decode(file)
      if (image) return datasetFromItk(file, normalizeItkImage(image))
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
  throw new Error('无法解码该文件：既不是 ITK 支持的格式，也不是内置解码器支持的 TIFF')
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
