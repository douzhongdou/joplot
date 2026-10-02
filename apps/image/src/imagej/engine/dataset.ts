/**
 * P0 数据契约：Dataset。
 *
 * Dataset 描述数据的科学语义与来源，不强制持有完整像素数组。像素按需从 Storage
 * 读取。revision 随内容版本变化，是缓存键与任务过期判断的基础。
 */
import {
  DTYPE_BYTES,
  axisKind,
  type Axis,
  type Axes,
  type AxisName,
  type ChannelInfo,
  type Dtype,
  type SpatialTransform,
  type SourceRef,
  type TimeCalibration,
  byteLength,
} from './types.ts'

export interface DatasetMeta {
  /** 稳定身份，跨 revision 不变。 */
  id: string
  /** 内容版本；任何影响像素解释的变更都应递增。 */
  revision: number
  dtype: Dtype
  axes: Axes
  shape: readonly number[]
  spatialTransform: SpatialTransform
  timeCalibration?: TimeCalibration
  channels: readonly ChannelInfo[]
  source: SourceRef
  /** 格式元信息与影响解释/计算/导出的必要属性。 */
  metadata: Readonly<Record<string, string | number | boolean>>
}

/** Dataset = 元信息 + 只读的像素读取能力由 Storage 提供。 */
export interface Dataset extends DatasetMeta {
  axesInfo: readonly Axis[]
}

let datasetCounter = 0

/** 生成进程内唯一的 Dataset id（不依赖 crypto，Node 与浏览器均可）。 */
export function nextDatasetId(prefix = 'ds'): string {
  datasetCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${datasetCounter.toString(36)}`
}

/** 由 axes 与 shape 派生带 kind 的 Axis 列表。 */
export function buildAxes(axes: Axes, shape: readonly number[], units?: Partial<Record<AxisName, string>>): Axis[] {
  return axes.map((name, i) => ({
    name,
    length: shape[i] ?? 0,
    kind: axisKind(name),
    unit: units?.[name],
  }))
}

export interface CreateDatasetInput {
  id?: string
  revision?: number
  dtype: Dtype
  axes: Axes
  shape: readonly number[]
  spatialTransform: SpatialTransform
  timeCalibration?: TimeCalibration
  channels?: readonly ChannelInfo[]
  source: SourceRef
  metadata?: Readonly<Record<string, string | number | boolean>>
  /** 空间轴单位覆盖，用于 buildAxes 展示。 */
  axisUnits?: Partial<Record<AxisName, string>>
}

/** 创建 Dataset，并在入口校验轴与形状的一致性。 */
export function createDataset(input: CreateDatasetInput): Dataset {
  const { axes, shape } = input
  if (axes.length < 2) throw new RangeError('Dataset 至少需要空间轴 y、x')
  if (axes.length !== shape.length) throw new RangeError('Dataset axes 与 shape 长度不一致')
  const seen = new Set(axes)
  if (seen.size !== axes.length) throw new RangeError('Dataset axes 含重复轴名')
  const y = axes.indexOf('y')
  const x = axes.indexOf('x')
  if (x < 0 || y < 0 || y >= x) throw new RangeError('Dataset 轴顺序必须满足 y 在 x 之前')
  if (!shape.every((n) => Number.isInteger(n) && n > 0)) throw new RangeError('Dataset shape 必须为正整数')
  const units = input.axisUnits ?? {}
  return {
    id: input.id ?? nextDatasetId(),
    revision: input.revision ?? 0,
    dtype: input.dtype,
    axes,
    shape,
    spatialTransform: input.spatialTransform,
    timeCalibration: input.timeCalibration,
    channels: input.channels ?? [],
    source: input.source,
    metadata: input.metadata ?? {},
    axesInfo: buildAxes(axes, shape, units),
  }
}

/** 单帧像素元素数（y×x）。 */
export function framePixels(dataset: Pick<DatasetMeta, 'axes' | 'shape'>): number {
  const y = dataset.axes.indexOf('y')
  const x = dataset.axes.indexOf('x')
  return (dataset.shape[y] ?? 0) * (dataset.shape[x] ?? 0)
}

/** 整卷像素元素数。 */
export function totalPixels(dataset: Pick<DatasetMeta, 'shape'>): number {
  return dataset.shape.reduce((product, n) => product * n, 1)
}

/** 整卷像素字节数（不含压缩与工作缓冲）。 */
export function datasetBytes(dataset: Pick<DatasetMeta, 'dtype' | 'shape'>): number {
  return byteLength(dataset.dtype, totalPixels(dataset))
}

/** 单帧字节数。 */
export function frameBytes(dataset: Pick<DatasetMeta, 'dtype' | 'axes' | 'shape'>): number {
  return framePixels(dataset) * DTYPE_BYTES[dataset.dtype]
}

/**
 * 内容版本键：参与缓存与任务过期判断。
 * 包含 dtype、轴顺序、shape 与 revision；不含显示状态。
 */
export function datasetVersionKey(dataset: Pick<DatasetMeta, 'id' | 'revision' | 'dtype' | 'axes' | 'shape'>): string {
  return `${dataset.id}@${dataset.revision}:${dataset.dtype}:${dataset.axes.join('')}:${dataset.shape.join('x')}`
}

/** 返回递增 revision 的新 Dataset（浅拷贝元信息，不复制像素）。 */
export function reviseDataset(dataset: Dataset, patch: Partial<Omit<CreateDatasetInput, 'id'>> = {}): Dataset {
  return createDataset({
    id: dataset.id,
    revision: (patch.revision ?? dataset.revision) + 1,
    dtype: patch.dtype ?? dataset.dtype,
    axes: patch.axes ?? dataset.axes,
    shape: patch.shape ?? dataset.shape,
    spatialTransform: patch.spatialTransform ?? dataset.spatialTransform,
    timeCalibration: patch.timeCalibration ?? dataset.timeCalibration,
    channels: patch.channels ?? dataset.channels,
    source: patch.source ?? dataset.source,
    metadata: patch.metadata ?? dataset.metadata,
    axisUnits: patch.axisUnits,
  })
}

/** 在指定轴上定位某个切片的定义（用于翻页 / 通道切换）。 */
export interface SliceSelection {
  t?: number
  c?: number
  z?: number
}

/** 查找轴上某个具体切片在整卷中的线性帧索引（其余 2D 空间轴的组合）。 */
export function frameIndex(dataset: Pick<DatasetMeta, 'axes' | 'shape'>, selection: SliceSelection): number {
  let index = 0
  for (let i = 0; i < dataset.axes.length; i += 1) {
    const name = dataset.axes[i]
    const length = dataset.shape[i] ?? 0
    if (name === 'y' || name === 'x') break
    const value = selection[name] ?? 0
    if (!Number.isInteger(value) || value < 0 || value >= length) {
      throw new RangeError(`切片轴 ${name} 的取值 ${String(value)} 超出 [0, ${length})`)
    }
    index = index * length + value
  }
  return index
}
