/**
 * Worker ↔ 主线程协议。
 *
 * 解码与重计算在 Worker 中执行；主线程只发送文件、Recipe 与切片选择，接收最终图像与
 * 分析结果。图像块以 ArrayBuffer 转移（零拷贝）回主线程，发送侧随后不得再引用。
 */
import type { Dataset } from '../dataset.ts'
import type { SliceSelection } from '../dataset.ts'
import type { Recipe, StepScope } from '../recipe.ts'
import type { ChannelStats, ParticleRow } from '../../lib/engineTypes.ts'
import type { Dtype, Axes, Region } from '../types.ts'
import type { ImageAnalysis } from '../analysis.ts'
import type { StackStatsResult } from '../stackStats.ts'
import type { StackProfilesResult } from '../stackProfiles.ts'

export interface SerializedBlock {
  dtype: Dtype
  axes: Axes
  shape: number[]
  region: Region
  data: ArrayBuffer
}

export interface StepOutcomeWire {
  stepId: string
  status: 'ok' | 'error'
  error?: string
  stats?: ChannelStats[]
  table?: ParticleRow[]
  ms: number
}

export interface ImportRequest {
  type: 'import'
  id: number
  file: File
}

/** 把多个文件合成一个 Stack 导入。 */
export interface ImportStackRequest {
  type: 'import-stack'
  id: number
  files: File[]
}

/** 只计算当前切片的整帧分析（不返回图像）；用于把分析移出显示路径。 */
export interface AnalyzeRequest {
  type: 'analyze'
  id: number
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  throughStepId?: string
}

export interface RunRequest {
  type: 'run'
  id: number
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  throughStepId?: string
  analyze?: boolean
}

/**
 * 整栈逐页统计请求。
 *
 * Image ▸ Stacks 的三个命令共用这一条通路：Measure Stack...（逐页一行）、Statistics（整栈汇总）、
 * Plot Z-axis Profile（逐页均值曲线）。逐页会执行当前 Recipe，因此统计的是「画面上看到的结果」；
 * 整个过程留在 Worker 内，逐页像素不跨线程传输。
 */
export interface StackStatsRequest {
  type: 'stack-stats'
  id: number
  datasetId: string
  recipe: Recipe
  /** 当前切片选择；被遍历轴之外的轴固定在这里。 */
  selection: SliceSelection
  roi?: Region
  /** 要遍历的切片轴；缺省取 z → t → c 中第一个长度大于 1 的轴。 */
  axis?: 'z' | 't' | 'c'
}

/**
 * Z 投影请求（Image ▸ Stacks ▸ Z Project... 与 Tools ▸ Grouped Z Project...）。
 *
 * 与 `run` 不同：投影结果是**新的整块数据**，因此由引擎侧注册成一个新 Dataset 并只回传元信息，
 * 像素不跨线程。逐页会先执行当前 Recipe，因此投影的是「画面上看到的结果」。
 */
export interface ProjectRequest {
  type: 'project'
  id: number
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  /** 投影轴；缺省取 z → t → c 中第一个长度大于 1 的轴。 */
  axis?: 'z' | 't' | 'c'
  /** 参与投影的页区间（0-based，含两端）；缺省为整条轴。 */
  from?: number
  to?: number
  /** 投影方法；取值见 `engine/stackProject.ts` 的 `ProjectionMethod`。 */
  method: 'average' | 'max' | 'min' | 'sum' | 'sd' | 'median'
  /** 分组投影：每 groupSize 页投成一页（Grouped Z Project）；缺省表示整段投成一页。 */
  groupSize?: number
  /** 对每条时间帧各投影一次（ImageJ 的 All time frames）；结果保留 `t` 轴。 */
  allTimeFrames?: boolean
  /** 结果数据集标题。 */
  title?: string
}

/**
 * Make Montage 请求（Image ▸ Stacks ▸ Make Montage...）。
 *
 * 与 `project` 同属「产出一整块新像素」的命令：结果由引擎侧注册成新 Dataset，只回传元信息。
 */
export interface MontageRequest {
  type: 'montage'
  id: number
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  /** 参与拼接的切片轴；缺省取 z → t → c 中第一个长度大于 1 的轴。 */
  axis?: 'z' | 't' | 'c'
  /** 面板页区间（0-based，含两端）与步长；缺省为整条轴、步长 1。 */
  from?: number
  to?: number
  increment?: number
  /** 行列与缩放；缺省时由引擎按 ImageJ 的自动规则计算。 */
  columns?: number
  rows?: number
  scale?: number
  borderWidth?: number
  /** 在面板底部标注切片文本（ImageJ 的 Label slices）。 */
  labelSlices?: boolean
  fontSize?: number
  /** 各页的标签文本；缺省用页序号。 */
  labels?: string[]
  title?: string
}

/** Montage to Stack 请求（Image ▸ Stacks ▸ Tools ▸ Montage to Stack...）：把蒙太奇切回多页栈。 */
export interface MontageToStackRequest {
  type: 'montage-to-stack'
  id: number
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  /** 行列；缺省沿用元数据里的 montageColumns / montageRows，再退化为 2×2。 */
  columns?: number
  rows?: number
  borderWidth?: number
  title?: string
}

/** Reslice 请求（Image ▸ Stacks ▸ Reslice [/]...）：沿选区的垂直方向重切成新栈。 */
export interface ResliceRequest {
  type: 'reslice'
  id: number
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  /** 采样区域（图像坐标）；缺省为整帧。 */
  bounds?: { x: number; y: number; width: number; height: number }
  axis?: 'z' | 't' | 'c'
  from?: number
  to?: number
  /** 相邻输出页沿垂直方向移动的像素数。 */
  spacing?: number
  startAt?: 'top' | 'left' | 'bottom' | 'right'
  flip?: boolean
  rotate?: boolean
  title?: string
}

/** Orthogonal Views 请求（Image ▸ Stacks ▸ Orthogonal Views）：重建 XZ 与 YZ 两张视图。 */
export interface OrthogonalRequest {
  type: 'orthogonal'
  id: number
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  /** 交叉点（图像坐标）；缺省取图像中心。 */
  point?: { x: number; y: number }
  axis?: 'z' | 't' | 'c'
  from?: number
  to?: number
}

/**
 * 逐页剖面请求（Image ▸ Stacks ▸ Tools ▸ Plot XY Profile）。
 *
 * 逐页执行当前 Recipe 后取同一条剖面；所有曲线的纵轴范围由引擎统一给出。
 */
export interface StackProfilesRequest {
  type: 'stack-profiles'
  id: number
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  /** 矩形采样区域（同时用于裁剪读取范围）。 */
  roi?: Region
  /** 线 / 折线的采样点（图像坐标，扁平 `[x1,y1,x2,y2,…]`）；给出时走线剖面。 */
  line?: { points: number[]; closed?: boolean }
  axis?: 'z' | 't' | 'c'
}

/**
 * 栈结构编辑请求（Image ▸ Stacks 的 Add / Delete Slice 与 Tools ▸ Reduce / Make Substack / Reverse）。
 *
 * 只换一组页、不重算像素：结果数据集用页映射存储，像素仍按需从源读取。
 */
export interface RestructureRequest {
  type: 'restructure'
  id: number
  datasetId: string
  op: 'reverse' | 'reduce' | 'substack' | 'delete' | 'add'
  /** reduce 的步长。 */
  factor?: number
  /** substack 保留的页 / delete 移除的页（0-based）。 */
  pages?: number[]
  /** add 的插入位置（该页之前）与页数。 */
  at?: number
  count?: number
  title?: string
}

/**
 * 跨数据集页合成请求（Image ▸ Stacks ▸ Tools 的 Insert / Combine / Concatenate）。
 *
 * 三者都产出新数据集：本项目不原地改写文档。
 */
export interface CombineRequest {
  type: 'combine'
  id: number
  op: 'insert' | 'combine' | 'concatenate'
  datasetId: string
  /** 主数据集的处理链；其它数据集按源像素读取。 */
  recipe?: Recipe
  /** concatenate 的数据集列表（按顺序，含主数据集）。 */
  datasetIds?: string[]
  /** insert / combine 的另一个数据集。 */
  otherDatasetId?: string
  /** insert 的粘贴位置。 */
  x?: number
  y?: number
  /** combine 是否垂直拼接。 */
  vertical?: boolean
  title?: string
}

/** Label 请求（Image ▸ Stacks ▸ Label...）：把文本画进指定范围的切片。 */
export interface LabelRequest {
  type: 'label'
  id: number
  datasetId: string
  recipe?: Recipe
  selection?: SliceSelection
  format: 'number' | 'zero-padded' | 'mm:ss' | 'hh:mm:ss' | 'text' | 'label'
  start?: number
  interval?: number
  text?: string
  x?: number
  y?: number
  fontSize?: number
  from?: number
  to?: number
  /** `format = 'label'` 时各页的标签。 */
  sliceLabels?: string[]
  title?: string
}

/** 重排蒙太奇请求（Image ▸ Stacks ▸ Tools ▸ Magic Montage Tools 的核心动作）。 */
export interface RemontageRequest {
  type: 'remontage'
  id: number
  datasetId: string
  recipe?: Recipe
  selection?: SliceSelection
  /** 新的行列。 */
  columns: number
  rows: number
  /** 源蒙太奇的行列；缺省从元数据里的 montageColumns / montageRows 读。 */
  sourceColumns?: number
  sourceRows?: number
  borderWidth?: number
  labelSlices?: boolean
  fontSize?: number
  title?: string
}

/** 3D Project 请求（Image ▸ Stacks ▸ 3D Project...）：逐角度旋转投影。 */
export interface Project3dRequest {
  type: 'project-3d'
  id: number
  datasetId: string
  recipe?: Recipe
  selection?: SliceSelection
  method: 'nearest' | 'brightest' | 'mean'
  axis: 'x' | 'y' | 'z'
  initialAngle?: number
  totalRotation?: number
  angleIncrement?: number
  opacity?: number
  surfaceCueing?: number
  interiorCueing?: number
  from?: number
  to?: number
  title?: string
}

export interface CancelRequest {
  type: 'cancel'
  id: number
  targetId: number
}

export interface DisposeRequest {
  type: 'dispose'
  id: number
  datasetId?: string
}

export type WorkerRequest = ImportRequest | ImportStackRequest | RunRequest | AnalyzeRequest | StackStatsRequest | StackProfilesRequest | ProjectRequest | MontageRequest | MontageToStackRequest | ResliceRequest | OrthogonalRequest | RestructureRequest | CombineRequest | LabelRequest | Project3dRequest | RemontageRequest | CancelRequest | DisposeRequest

export interface ImportedResponse {
  type: 'imported'
  id: number
  dataset: Dataset
}

export interface ResultResponse {
  type: 'result'
  id: number
  results: StepOutcomeWire[]
  image: SerializedBlock | null
  stats?: ChannelStats[]
  table?: ParticleRow[]
  analysis?: ImageAnalysis
  ms: number
  estimatedBytes: number
}

export interface ErrorResponse {
  type: 'error'
  id: number
  code: string
  message: string
}

export interface AnalysisResponse {
  type: 'analysis'
  id: number
  analysis?: ImageAnalysis
}

export interface StackStatsResponse {
  type: 'stack-stats'
  id: number
  stats?: StackStatsResult
}

export interface ProjectResponse {
  type: 'project'
  id: number
  dataset?: Dataset
}

export interface MontageResponse {
  type: 'montage'
  id: number
  dataset?: Dataset
}

export interface MontageToStackResponse {
  type: 'montage-to-stack'
  id: number
  dataset?: Dataset
}

export interface ResliceResponse {
  type: 'reslice'
  id: number
  dataset?: Dataset
}

export interface OrthogonalResponse {
  type: 'orthogonal'
  id: number
  datasets: Dataset[]
}

export interface StackProfilesResponse {
  type: 'stack-profiles'
  id: number
  profiles?: StackProfilesResult
}

export interface RestructureResponse {
  type: 'restructure'
  id: number
  dataset?: Dataset
}

export interface CombineResponse {
  type: 'combine'
  id: number
  dataset?: Dataset
}

export interface LabelResponse {
  type: 'label'
  id: number
  dataset?: Dataset
}

export interface Project3dResponse {
  type: 'project-3d'
  id: number
  dataset?: Dataset
}

export interface RemontageResponse {
  type: 'remontage'
  id: number
  dataset?: Dataset
}

export type WorkerResponse = ImportedResponse | ResultResponse | AnalysisResponse | StackStatsResponse | StackProfilesResponse | ProjectResponse | MontageResponse | MontageToStackResponse | ResliceResponse | OrthogonalResponse | RestructureResponse | CombineResponse | LabelResponse | Project3dResponse | RemontageResponse | ErrorResponse

/** 一步作用范围的可序列化描述（RecipeStep 的 scope 已满足）。 */
export type { StepScope }
