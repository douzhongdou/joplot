/**
 * P0：算子能力声明与注册表（对应架构方案第 6 节）。
 *
 * 注册表同时向 UI 暴露参数、数据类型与输出含义，向调度器暴露作用范围与资源要求。
 * 这里只声明「能做什么、需要什么」，不含算法实现；实现由 ComputeEngine 提供。
 */
import type { NumberParamSpec, OperatorRegistry, OperatorSpec, ParamSpec } from '../lib/engineTypes.ts'
import type { Dtype } from './types.ts'

export type OperatorOutput = 'image' | 'table' | 'stats'
export type ScopeKind = 'image' | 'stack' | 'pages' | 'roi' | 'frame'
export type DimensionSupport = 2 | 3

export interface OperatorInput {
  /** 支持的 dtype；'any' 表示不限。 */
  dtypes: readonly Dtype[] | 'any'
  /** 支持的维度。 */
  dimensions: readonly DimensionSupport[]
  /** 通道语义。 */
  channels: 'single' | 'any'
}

export interface OutputImageSpec {
  /** 输出 dtype；'same' 表示与输入一致。 */
  dtype: Dtype | 'same'
  sizeChange: 'same' | 'crop' | 'rotate' | 'shrink'
}

export interface RegionDependency {
  /** point：逐像素；finite：有限邻域；mergeable：可合并统计；global：整图。 */
  kind: 'point' | 'finite' | 'mergeable' | 'global'
  /** 有限邻域的半径（像素）；point 为 0。 */
  halo?: number
  /** 是否可分离成多次一维卷积。 */
  separable?: boolean
}

export interface NumericRules {
  internalPrecision: 'dtype' | 'float32' | 'float64'
  rounding: 'round' | 'truncate' | 'clamp'
  boundary: 'replicate' | 'zero' | 'mirror'
  /** 是否可能产生 NaN/Inf。 */
  mayProduceNonFinite?: boolean
}

export interface ResourceEstimate {
  /** 临时内存相对输入字节的倍数（不含输出）。 */
  tempBytesFactor: number
  parallel: 'none' | 'slices' | 'blocks'
  cancellable: boolean
}

export interface OperatorCapability {
  kind: string
  category: string
  labelKey: string
  output: OperatorOutput
  params: readonly ParamSpec[]
  input: OperatorInput
  outputImage?: OutputImageSpec
  scope: readonly ScopeKind[]
  regionDependency: RegionDependency
  numeric: NumericRules
  resource: ResourceEstimate
  /** 算法版本，参与缓存键。 */
  algorithmVersion: string
}

const SINGLE: OperatorInput = { dtypes: 'any', dimensions: [2], channels: 'single' }
const SINGLE3D: OperatorInput = { dtypes: 'any', dimensions: [2, 3], channels: 'single' }

function num(
  key: string,
  labelKey: string,
  fallback: number,
  min?: number,
  max?: number,
  step?: number,
): NumberParamSpec {
  return { key, type: 'number', labelKey, default: fallback, min, max, step }
}

function convolved(halo: number, separable: boolean): OperatorCapability {
  return {
    kind: '',
    category: 'filter',
    labelKey: '',
    output: 'image',
    params: [],
    input: { ...SINGLE, channels: 'any' },
    outputImage: { dtype: 'same', sizeChange: 'same' },
    scope: ['image', 'roi'],
    regionDependency: { kind: 'finite', halo, separable },
    numeric: { internalPrecision: 'float32', rounding: 'round', boundary: 'replicate' },
    resource: { tempBytesFactor: 2, parallel: 'blocks', cancellable: true },
    algorithmVersion: 'v1',
  }
}

const CONVOLVE = convolved(1, false)
/** Rank 滤波的 Radius 参数：不设上限，允许小数（窗口半宽取 ceil）。 */
const RANK_RADIUS = num('radius', 'radius', 1, 0.1, undefined, 0.1)

/** 内置算子目录。实现见 compute/pureOps.ts 与 compute/itkWasm.ts。 */
export const OPERATOR_CATALOG: readonly OperatorCapability[] = [
  {
    kind: 'grayscale',
    category: 'format',
    labelKey: 'grayscale',
    output: 'image',
    params: [],
    input: { dtypes: 'any', dimensions: [2], channels: 'any' },
    outputImage: { dtype: 'uint8', sizeChange: 'same' },
    scope: ['image', 'stack'],
    regionDependency: { kind: 'point' },
    numeric: { internalPrecision: 'float32', rounding: 'round', boundary: 'replicate' },
    resource: { tempBytesFactor: 1, parallel: 'slices', cancellable: true },
    algorithmVersion: 'v1',
  },
  {
    kind: 'debayer',
    category: 'format',
    labelKey: 'debayer',
    output: 'image',
    params: [
      {
        key: 'pattern',
        type: 'select',
        labelKey: 'cfaPattern',
        default: 'auto',
        options: ['auto', 'rggb', 'bggr', 'grbg', 'gbrg'].map((value) => ({ value, labelKey: value })),
      },
      {
        key: 'algorithm',
        type: 'select',
        labelKey: 'debayerAlgorithm',
        default: 'malvar',
        options: ['malvar', 'bilinear'].map((value) => ({ value, labelKey: value })),
      },
    ],
    input: { dtypes: 'any', dimensions: [2], channels: 'single' },
    outputImage: { dtype: 'same', sizeChange: 'same' },
    scope: ['image', 'stack'],
    regionDependency: { kind: 'finite', halo: 2 },
    numeric: { internalPrecision: 'float32', rounding: 'clamp', boundary: 'replicate' },
    resource: { tempBytesFactor: 3, parallel: 'slices', cancellable: true },
    algorithmVersion: 'v1',
  },
  {
    kind: 'invert',
    category: 'adjust',
    labelKey: 'invert',
    output: 'image',
    params: [],
    input: { ...SINGLE3D, channels: 'any' },
    outputImage: { dtype: 'same', sizeChange: 'same' },
    scope: ['image', 'stack', 'roi'],
    regionDependency: { kind: 'point' },
    numeric: { internalPrecision: 'dtype', rounding: 'clamp', boundary: 'replicate' },
    resource: { tempBytesFactor: 0, parallel: 'slices', cancellable: true },
    algorithmVersion: 'v1',
  },
  {
    kind: 'levels',
    category: 'adjust',
    labelKey: 'levels',
    output: 'image',
    params: [num('brightness', 'brightness', 0, -127, 127), num('contrast', 'contrast', 50, 1, 100), num('minimum', 'minimum', 0), num('maximum', 'maximum', 255),
      { key: 'mode', type: 'select', labelKey: 'mode', default: 'brightness-contrast', options: [{ value: 'brightness-contrast', labelKey: 'levels' }, { value: 'rgb-range', labelKey: 'levels' }] },
      { key: 'channel', type: 'select', labelKey: 'channel', default: 'all', options: ['all', 'red', 'green', 'blue'].map((value) => ({ value, labelKey: value })) }],
    input: { ...SINGLE, channels: 'any' },
    outputImage: { dtype: 'same', sizeChange: 'same' },
    scope: ['image', 'frame', 'stack', 'roi'],
    regionDependency: { kind: 'point' },
    numeric: { internalPrecision: 'float32', rounding: 'truncate', boundary: 'replicate' },
    resource: { tempBytesFactor: 0, parallel: 'slices', cancellable: true },
    algorithmVersion: 'v1',
  },
  {
    kind: 'threshold',
    category: 'threshold',
    labelKey: 'threshold',
    output: 'image',
    params: [num('level', 'level', 128, 0, 65_535)],
    input: SINGLE,
    outputImage: { dtype: 'uint8', sizeChange: 'same' },
    scope: ['image', 'stack', 'roi'],
    regionDependency: { kind: 'point' },
    numeric: { internalPrecision: 'dtype', rounding: 'clamp', boundary: 'replicate' },
    resource: { tempBytesFactor: 0, parallel: 'slices', cancellable: true },
    algorithmVersion: 'v1',
  },
  {
    kind: 'otsu',
    category: 'threshold',
    labelKey: 'otsu',
    output: 'image',
    params: [],
    input: SINGLE,
    outputImage: { dtype: 'uint8', sizeChange: 'same' },
    scope: ['image', 'roi'],
    regionDependency: { kind: 'global' },
    numeric: { internalPrecision: 'float64', rounding: 'clamp', boundary: 'replicate' },
    resource: { tempBytesFactor: 1, parallel: 'none', cancellable: false },
    algorithmVersion: 'v1',
  },
  // Rank 滤波族：半径由用户给（可为小数、无上限），因此邻域依赖声明为整图。
  { ...convolved(0, false), kind: 'mean3x3', labelKey: 'mean3x3', params: [RANK_RADIUS], regionDependency: { kind: 'global' } },
  { ...convolved(0, false), kind: 'median3x3', labelKey: 'median3x3', params: [RANK_RADIUS], regionDependency: { kind: 'global' } },
  { ...convolved(0, false), kind: 'minimum3x3', labelKey: 'minimum3x3', params: [RANK_RADIUS], regionDependency: { kind: 'global' } },
  { ...convolved(0, false), kind: 'maximum3x3', labelKey: 'maximum3x3', params: [RANK_RADIUS], regionDependency: { kind: 'global' } },
  { ...CONVOLVE, kind: 'sharpen3x3', labelKey: 'sharpen3x3', params: [num('amount', 'amount', 1, 0, undefined, 0.1)] },
  { ...CONVOLVE, kind: 'sobel', labelKey: 'sobel' },
  {
    kind: 'unsharpMask',
    category: 'filter',
    labelKey: 'unsharpMask',
    output: 'image',
    params: [num('sigma', 'sigma', 2, 0.1, undefined, 0.1), num('amount', 'amount', 0.6, 0, undefined, 0.1)],
    input: { ...SINGLE3D, channels: 'any' },
    outputImage: { dtype: 'same', sizeChange: 'same' },
    scope: ['image', 'stack', 'roi'],
    regionDependency: { kind: 'finite', separable: true },
    numeric: { internalPrecision: 'float32', rounding: 'round', boundary: 'replicate' },
    resource: { tempBytesFactor: 2, parallel: 'blocks', cancellable: true },
    algorithmVersion: 'v1',
  },
  {
    kind: 'gaussian',
    category: 'filter',
    labelKey: 'gaussian',
    output: 'image',
    params: [num('sigma', 'sigma', 1.5, 0.1, undefined, 0.1)],
    input: { ...SINGLE3D, channels: 'any' },
    outputImage: { dtype: 'same', sizeChange: 'same' },
    scope: ['image', 'stack', 'roi'],
    regionDependency: { kind: 'finite', separable: true },
    numeric: { internalPrecision: 'float32', rounding: 'round', boundary: 'replicate' },
    resource: { tempBytesFactor: 2, parallel: 'blocks', cancellable: true },
    algorithmVersion: 'v1',
    // 递归高斯：分块 halo 不能简单假定有限，需按算法实现声明。
  },
  {
    kind: 'erode',
    category: 'morphology',
    labelKey: 'erode',
    output: 'image',
    params: [num('radius', 'radius', 1, 1, 16)],
    input: SINGLE,
    outputImage: { dtype: 'same', sizeChange: 'same' },
    scope: ['image', 'roi'],
    regionDependency: { kind: 'finite', halo: 1 },
    numeric: { internalPrecision: 'dtype', rounding: 'clamp', boundary: 'replicate' },
    resource: { tempBytesFactor: 1, parallel: 'blocks', cancellable: true },
    algorithmVersion: 'v1',
  },
  {
    kind: 'dilate',
    category: 'morphology',
    labelKey: 'dilate',
    output: 'image',
    params: [num('radius', 'radius', 1, 1, 16)],
    input: SINGLE,
    outputImage: { dtype: 'same', sizeChange: 'same' },
    scope: ['image', 'roi'],
    regionDependency: { kind: 'finite', halo: 1 },
    numeric: { internalPrecision: 'dtype', rounding: 'clamp', boundary: 'replicate' },
    resource: { tempBytesFactor: 1, parallel: 'blocks', cancellable: true },
    algorithmVersion: 'v1',
  },
  {
    kind: 'open',
    category: 'morphology',
    labelKey: 'open',
    output: 'image',
    params: [num('radius', 'radius', 1, 1, 16)],
    input: SINGLE,
    outputImage: { dtype: 'same', sizeChange: 'same' },
    scope: ['image', 'roi'],
    regionDependency: { kind: 'finite', halo: 2 },
    numeric: { internalPrecision: 'dtype', rounding: 'clamp', boundary: 'replicate' },
    resource: { tempBytesFactor: 2, parallel: 'blocks', cancellable: true },
    algorithmVersion: 'v1',
  },
  {
    kind: 'close',
    category: 'morphology',
    labelKey: 'close',
    output: 'image',
    params: [num('radius', 'radius', 1, 1, 16)],
    input: SINGLE,
    outputImage: { dtype: 'same', sizeChange: 'same' },
    scope: ['image', 'roi'],
    regionDependency: { kind: 'finite', halo: 2 },
    numeric: { internalPrecision: 'dtype', rounding: 'clamp', boundary: 'replicate' },
    resource: { tempBytesFactor: 2, parallel: 'blocks', cancellable: true },
    algorithmVersion: 'v1',
  },
  {
    kind: 'fillHoles',
    category: 'morphology',
    labelKey: 'fillHoles',
    output: 'image',
    params: [],
    input: SINGLE,
    outputImage: { dtype: 'same', sizeChange: 'same' },
    scope: ['image', 'roi'],
    regionDependency: { kind: 'global' },
    numeric: { internalPrecision: 'dtype', rounding: 'clamp', boundary: 'replicate' },
    resource: { tempBytesFactor: 1, parallel: 'none', cancellable: false },
    algorithmVersion: 'v1',
  },
  {
    kind: 'crop',
    category: 'geometry',
    labelKey: 'crop',
    output: 'image',
    params: [num('x', 'x', 0, 0), num('y', 'y', 0, 0), num('width', 'width', 128, 1), num('height', 'height', 128, 1)],
    input: { ...SINGLE3D, channels: 'any' },
    outputImage: { dtype: 'same', sizeChange: 'crop' },
    scope: ['image'],
    regionDependency: { kind: 'point' },
    numeric: { internalPrecision: 'dtype', rounding: 'clamp', boundary: 'replicate' },
    resource: { tempBytesFactor: 0, parallel: 'slices', cancellable: true },
    algorithmVersion: 'v1',
  },
  { ...CONVOLVE, kind: 'flipH', labelKey: 'flipH', regionDependency: { kind: 'point' }, resource: { tempBytesFactor: 0, parallel: 'slices', cancellable: true } },
  { ...CONVOLVE, kind: 'flipV', labelKey: 'flipV', regionDependency: { kind: 'point' }, resource: { tempBytesFactor: 0, parallel: 'slices', cancellable: true } },
  { ...CONVOLVE, kind: 'rotateCW', labelKey: 'rotateCW', regionDependency: { kind: 'point' }, resource: { tempBytesFactor: 1, parallel: 'none', cancellable: true } },
  { ...CONVOLVE, kind: 'rotateCCW', labelKey: 'rotateCCW', regionDependency: { kind: 'point' }, resource: { tempBytesFactor: 1, parallel: 'none', cancellable: true } },
  {
    kind: 'measure',
    category: 'analysis',
    labelKey: 'measure',
    output: 'stats',
    params: [],
    input: SINGLE3D,
    scope: ['image', 'stack', 'roi'],
    regionDependency: { kind: 'mergeable' },
    numeric: { internalPrecision: 'float64', rounding: 'round', boundary: 'replicate' },
    resource: { tempBytesFactor: 0, parallel: 'slices', cancellable: true },
    algorithmVersion: 'v1',
  },
  {
    kind: 'particles',
    category: 'analysis',
    labelKey: 'particles',
    output: 'table',
    params: [num('minArea', 'minArea', 1, 1)],
    input: SINGLE,
    scope: ['image'],
    regionDependency: { kind: 'global' },
    numeric: { internalPrecision: 'float64', rounding: 'round', boundary: 'replicate' },
    resource: { tempBytesFactor: 1, parallel: 'none', cancellable: false },
    algorithmVersion: 'v1',
  },
] as const

const BY_KIND = new Map(OPERATOR_CATALOG.map((cap) => [cap.kind, cap]))

export function getOperator(kind: string): OperatorCapability | undefined {
  return BY_KIND.get(kind)
}

export function requireOperator(kind: string): OperatorCapability {
  const capability = BY_KIND.get(kind)
  if (!capability) throw new RangeError(`未知算子 ${kind}`)
  return capability
}

/** 从能力声明生成缺省参数。 */
export function defaultOperatorParams(capability: OperatorCapability): Record<string, number | string> {
  const params: Record<string, number | string> = {}
  for (const spec of capability.params) params[spec.key] = spec.default
  return params
}

export interface ParamValidation {
  ok: boolean
  errors: string[]
  /** 归一化后的参数（补默认值、数值夹取）。 */
  values: Record<string, number | string>
}

/** 校验并归一化一步的参数。 */
export function validateOperatorParams(
  capability: OperatorCapability,
  input: Record<string, number | string>,
): ParamValidation {
  const errors: string[] = []
  const values = defaultOperatorParams(capability)
  for (const spec of capability.params) {
    const provided = input[spec.key]
    if (provided === undefined) continue
    if (spec.type === 'number') {
      const value = typeof provided === 'number' ? provided : Number(provided)
      if (!Number.isFinite(value)) {
        errors.push(`参数 ${spec.key} 不是有限数值`)
        continue
      }
      let normalized = value
      if (spec.min !== undefined && normalized < spec.min) {
        errors.push(`参数 ${spec.key} 小于下限 ${spec.min}`)
        normalized = spec.min
      }
      if (spec.max !== undefined && normalized > spec.max) {
        errors.push(`参数 ${spec.key} 大于上限 ${spec.max}`)
        normalized = spec.max
      }
      values[spec.key] = normalized
    } else {
      const value = String(provided)
      if (!spec.options.some((option) => option.value === value)) {
        errors.push(`参数 ${spec.key} 取值 ${value} 非法`)
        continue
      }
      values[spec.key] = value
    }
  }
  return { ok: errors.length === 0, errors, values }
}

const CATEGORY_ORDER = ['format', 'adjust', 'threshold', 'filter', 'morphology', 'geometry', 'analysis']

/** 转成 UI 使用的 OperatorRegistry（engineTypes 里的接缝类型）。 */
export function toUiRegistry(catalog: readonly OperatorCapability[] = OPERATOR_CATALOG): OperatorRegistry {
  const categories = CATEGORY_ORDER.filter((category) => catalog.some((cap) => cap.category === category))
  const operators: OperatorSpec[] = catalog.map((cap) => ({
    kind: cap.kind,
    category: cap.category,
    labelKey: cap.labelKey,
    output: cap.output,
    params: [...cap.params],
  }))
  return { categories, operators }
}


