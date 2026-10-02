/**
 * ITK-Wasm 适配层。
 *
 * 负责：
 * 1. ImageBlock ↔ itk-wasm Image 的类型 / 布局转换；
 * 2. 通过 @itk-wasm/image-io 读写科学图像（保留原始 dtype，不在导入时降到 8 位）；
 * 3. 通过 itk-wasm 的 runPipeline 运行按需编译的算子 WASM。
 *
 * 本模块含浏览器 / WASM 依赖，只应从 Worker 或浏览器端动态载入，不要进入 SSR 路径。
 * itk-wasm 的 Image.size 按 [x, y, z] 排列，数据 x 变化最快，与我们的行优先布局一致。
 */
import type { Image as ItkImage, TypedArray, PipelineInput, PipelineOutput } from 'itk-wasm'
import { IntTypes, FloatTypes, PixelTypes, InterfaceTypes } from 'itk-wasm'
import type { Dtype, ImageBlock, PixelArray, Region, SpatialTransform, Axes } from '../types.ts'
import { elementCount } from '../types.ts'

export class ItkAdapterError extends Error {
  readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ItkAdapterError'
    this.cause = cause
  }
}

type ComponentType = (typeof IntTypes)[keyof typeof IntTypes] | (typeof FloatTypes)[keyof typeof FloatTypes]

export function dtypeToComponentType(dtype: Dtype): ComponentType {
  switch (dtype) {
    case 'uint8': return IntTypes.UInt8
    case 'uint16': return IntTypes.UInt16
    case 'int16': return IntTypes.Int16
    case 'float32': return FloatTypes.Float32
  }
}

export function componentTypeToDtype(componentType: unknown): Dtype {
  switch (componentType) {
    case IntTypes.UInt8:
    case IntTypes.Int8: return 'uint8'
    case IntTypes.UInt16: return 'uint16'
    case IntTypes.Int16: return 'int16'
    case FloatTypes.Float32:
    case FloatTypes.Float64:
    case IntTypes.Int32:
    case IntTypes.UInt32: return 'float32'
    default:
      throw new ItkAdapterError(`不支持的 ITK 分量类型 ${String(componentType)}`)
  }
}

export function dtypeToTypedArray(dtype: Dtype): new (length: number) => ArrayBufferView {
  switch (dtype) {
    case 'uint8': return Uint8Array
    case 'uint16': return Uint16Array
    case 'int16': return Int16Array
    case 'float32': return Float32Array
  }
}

/** 把 itk 的分量类型转成对应的 TypedArray 构造器。 */
function itkDataArray(image: ItkImage): TypedArray {
  if (!image.data) throw new ItkAdapterError('ITK 图像缺少像素数据')
  return image.data
}

/**
 * Block → itk Image（异步）。dimension 由 axes 末端的空间轴数量决定（2 或 3）。
 * spatial 缺失时按像素单位占位，并标记未标定。
 */
export async function blockToItkImageAsync(block: ImageBlock, spatial?: SpatialTransform): Promise<ItkImage> {
  const { Image, ImageType } = await import('itk-wasm')
  const dimension = block.axes.filter((axis) => axis === 'x' || axis === 'y' || axis === 'z').length
  const componentType = dtypeToComponentType(block.dtype)
  const image = new Image(new ImageType(dimension, componentType, PixelTypes.Scalar, 1))
  const x = block.axes.indexOf('x')
  const y = block.axes.indexOf('y')
  const z = block.axes.indexOf('z')
  const size = [block.shape[x]!, block.shape[y]!]
  if (dimension === 3) size.push(block.shape[z]!)
  image.size = size
  image.spacing = dimension === 3
    ? [spatial?.spacing[0] ?? 1, spatial?.spacing[1] ?? 1, spatial?.spacing[2] ?? 1]
    : [spatial?.spacing[0] ?? 1, spatial?.spacing[1] ?? 1]
  image.origin = dimension === 3
    ? [spatial?.origin[0] ?? 0, spatial?.origin[1] ?? 0, spatial?.origin[2] ?? 0]
    : [spatial?.origin[0] ?? 0, spatial?.origin[1] ?? 0]
  const d = spatial?.direction
  image.direction = dimension === 3
    ? new Float64Array(d ?? [1, 0, 0, 0, 1, 0, 0, 0, 1])
    : new Float64Array([d?.[0] ?? 1, d?.[1] ?? 0, d?.[3] ?? 0, d?.[4] ?? 1])
  image.data = asTypedArray(block.data)
  return image
}

function asTypedArray(view: ArrayBufferView): TypedArray {
  if (view instanceof Uint8Array || view instanceof Uint16Array || view instanceof Int16Array
    || view instanceof Float32Array || view instanceof Int8Array || view instanceof Uint32Array
    || view instanceof Int32Array || view instanceof Float64Array) {
    return view as TypedArray
  }
  throw new ItkAdapterError('不支持的像素缓冲类型')
}

/** itk Image → Block。axes 由调用方给出（必须与 image.size 的空间维度一致）。 */
export function itkImageToBlock(image: ItkImage, axes: Axes, region?: Region): ImageBlock {
  const data = itkDataArray(image)
  const dtype = componentTypeToDtype(image.imageType.componentType)
  if (image.imageType.components !== 1) {
    throw new ItkAdapterError('当前只支持单分量图像；RGB/矢量需先拆分通道')
  }
  const spatialAxes = axes.filter((axis) => axis === 'x' || axis === 'y' || axis === 'z')
  if (spatialAxes.length !== image.size.length) {
    throw new ItkAdapterError(`axes 空间维度 ${spatialAxes.length} 与 ITK 图像维度 ${image.size.length} 不一致`)
  }
  const shape: number[] = []
  for (const axis of axes) {
    if (axis === 'x') shape.push(image.size[0]!)
    else if (axis === 'y') shape.push(image.size[1]!)
    else if (axis === 'z') shape.push(image.size[2]!)
    else shape.push(1)
  }
  // itk 数据为 x 最快、其后 y、再 z，与 axes 行优先（x 最快）一致，无需重排。
  const expected = elementCount(shape)
  if (data.length !== expected) {
    throw new ItkAdapterError(`ITK 数据长度 ${data.length} 与期望 ${expected} 不一致`)
  }
  const fullRegion: Region = region ?? { start: shape.map(() => 0), shape }
  return { dtype, axes, shape, region: fullRegion, data: data as unknown as PixelArray }
}

/** 读取科学图像文件（保留原始分量类型）。 */
export async function decodeImageFile(
  file: File | Blob,
  options?: { informationOnly?: boolean; webWorker?: Worker | null | boolean },
): Promise<{ image: ItkImage; webWorker?: Worker }> {
  const { readImage } = await import('@itk-wasm/image-io')
  const result = await readImage(file as File, {
    informationOnly: options?.informationOnly,
    webWorker: options?.webWorker,
  })
  return { image: result.image as ItkImage, webWorker: result.webWorker }
}

/** 把 Block 编码为图像文件字节（例如 TIFF）。 */
export async function encodeImageBlock(
  block: ImageBlock,
  mimeType: string,
  spatial?: SpatialTransform,
  options?: { useCompression?: boolean; componentType?: ComponentType },
): Promise<Uint8Array> {
  const image = await blockToItkImageAsync(block, spatial)
  const { writeImage } = await import('@itk-wasm/image-io')
  const result = await writeImage(image, 'output', {
    mimeType,
    useCompression: options?.useCompression,
    componentType: options?.componentType,
    pixelType: PixelTypes.Scalar,
  })
  const serialized = result.serializedImage
  if (serialized?.data) return new Uint8Array(serialized.data as Uint8Array)
  throw new ItkAdapterError('writeImage 未返回序列化数据')
}

export interface ItkPipelineRequest {
  /** 算子 WASM 的路径 / URL（按需编译产物）。 */
  pipelinePath: string | URL
  args: string[]
  /** 输入 itk 图像，按管道输入顺序。 */
  inputs: PipelineInput[]
  /** 期望的输出；identifier 为输出文件参数名。 */
  outputs: PipelineOutput[]
  webWorker?: Worker | null | boolean
  pipelineBaseUrl?: string | URL
}

export interface ItkPipelineResult {
  outputs: Array<{ type: string; data: ItkImage }>
  stdout: string
  stderr: string
  returnValue: number
}

/**
 * 运行一个按需编译的 ITK 管道算子。
 * 注意：管道返回的 itk Image 与输入可能是共享 / 拷贝内存，调用方需按所有权归还。
 */
export async function runItkPipeline(request: ItkPipelineRequest): Promise<ItkPipelineResult> {
  const { runPipeline } = await import('itk-wasm')
  const result = await runPipeline(
    request.pipelinePath,
    request.args,
    request.outputs,
    request.inputs,
    {
      webWorker: request.webWorker,
      pipelineBaseUrl: request.pipelineBaseUrl,
    },
  )
  const outputs = result.outputs
    .filter((output): output is PipelineOutput & { data: ItkImage } => output.type === InterfaceTypes.Image && output.data != null)
    .map((output) => ({ type: output.type, data: output.data as ItkImage }))
  return { outputs, stdout: result.stdout, stderr: result.stderr, returnValue: result.returnValue }
}

/** 释放 itk 图像持有的像素缓冲（帮助 GC 与 WASM 内存回收）。 */
export function releaseItkImage(image: ItkImage | undefined): void {
  if (image) image.data = null
}
