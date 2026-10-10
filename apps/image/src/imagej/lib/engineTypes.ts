/**
 * UI ↔ 计算引擎的接缝（只定义类型，不含任何算法）。
 *
 * UI 只依赖这里的类型：算子注册表决定参数面板长什么样，请求/响应决定怎么驱动执行。
 * 引擎实现（TypedArray 内核或 ITK-Wasm 管道）通过 EngineAdapter 注入，
 * 替换引擎时 UI 一行都不用改。
 */

/** 图像值的句柄：UI 只关心元信息，像素与渲染由引擎处理。 */
export interface ImageHandle {
  id: string
  width: number
  height: number
  /** 通道类型；彩色为 rgb，八位单通道为 gray。 */
  kind: 'rgb' | 'gray'
}

/** 源图像（导入结果）。 */
export interface SourceInfo extends ImageHandle {
  name: string
  /** 多页栈的页数（非栈为 1）。 */
  pages: number
}

export type ParamType = 'number' | 'select'

export interface NumberParamSpec {
  key: string
  type: 'number'
  labelKey: string
  default: number
  min?: number
  max?: number
  step?: number
}

export interface SelectParamSpec {
  key: string
  type: 'select'
  labelKey: string
  default: string
  options: Array<{ value: string; labelKey: string }>
}

export type ParamSpec = NumberParamSpec | SelectParamSpec

/** 算子声明：引擎发布，UI 据此渲染参数面板与添加菜单。 */
export interface OperatorSpec {
  kind: string
  category: string
  labelKey: string
  /** 产出类型：image 会改变图像，table/stats 是分析结果。 */
  output: 'image' | 'table' | 'stats'
  params: ParamSpec[]
}

export interface OperatorRegistry {
  categories: string[]
  operators: OperatorSpec[]
}

export type StepParamValue = number | string

/** 步骤台账里的一步：UI 持有并编辑它。 */
export interface RecipeStep {
  id: string
  op: string
  params: Record<string, StepParamValue>
}

export interface ChannelStats {
  channel: string
  count: number
  mean: number
  min: number
  max: number
  stdDev: number
}

export interface ParticleRow {
  channel: string
  id: number
  area: number
  perimeter: number
  circularity: number
  centroidX: number
  centroidY: number
}

/** 单步执行结果。 */
export interface StepResult {
  stepId: string
  status: 'ok' | 'error'
  error?: string
  /** 该步产出的图像句柄（image 类算子）。 */
  image?: ImageHandle
  /** 该步产出的统计（stats 类算子）。 */
  stats?: ChannelStats[]
  /** 该步产出的粒子表（table 类算子）。 */
  table?: ParticleRow[]
  ms?: number
}

export interface RunRequest {
  requestId: string
  source: SourceInfo
  steps: RecipeStep[]
}

export interface RunResponse {
  requestId: string
  results: StepResult[]
  /** 最终图像句柄；为 null 表示栈执行有错、没有可用结果。 */
  image: ImageHandle | null
  ms: number
}

/** 引擎适配器：UI 只通过它工作。 */
export interface EngineAdapter {
  registry(): OperatorRegistry
  /** 导入文件；解码归引擎，UI 只转交 File。 */
  importFile(file: File): Promise<SourceInfo>
  /** 执行整个台账；引擎内部应做缓存与脏传播。 */
  run(request: RunRequest): Promise<RunResponse>
  /** 中断进行中的执行（可选）。 */
  cancel?(requestId: string): void
}


