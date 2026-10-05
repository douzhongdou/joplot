/**
 * 计算引擎：把「Dataset + Storage + Recipe + 切片选择」执行成图像与分析结果。
 *
 * 提供两个实现：
 * - PureComputeEngine：纯 TS，当前默认可运行的通路；
 * - ItkWasmComputeEngine：为每个算子转发到按需编译的 ITK 管道，未配置时回退到纯 TS。
 *
 * 两者都实现 ComputeEngine，UI 只通过引擎适配器工作。执行以「当前切片的一帧」为单位；
 * 整卷操作（measure 的作用范围为 stack）逐帧读取后合并，符合架构方案的可合并统计约定。
 */
import type { Dataset, SliceSelection } from '../dataset.ts'
import { getOperator, type OperatorCapability } from '../operators.ts'
import { stepAppliesToSelection, stepsThrough, type Recipe, type RecipeStep } from '../recipe.ts'
import { StatsAccumulator, type MergedStats } from '../stats.ts'
import type { Storage } from '../storage.ts'
import { fullRegion } from '../storage.ts'
import type { ChannelStats, ParticleRow } from '../../lib/engineTypes.ts'
import { allocateBuffer, elementCount, type ImageBlock, type Region } from '../types.ts'
import * as ops from './pureOps.ts'
import { demosaicToDtype, type CfaPatternName } from '../debayer.ts'
import { computeWindowLevel } from '../render/rgba.ts'
import { applyColorAdjustments, type ColorChannel } from '../colorAdjustments.ts'
import type { ImageAnalysis } from '../analysis.ts'

export interface ExecuteContext {
  dataset: Dataset
  storage: Storage
  /** 当前 T/C/Z 选择。 */
  selection: SliceSelection
  /** 可选的 ROI（图像索引坐标，含 y/x 范围）。 */
  roi?: Region
  signal?: AbortSignal
  retainStepImages?: boolean
}

export interface StepOutcome {
  stepId: string
  status: 'ok' | 'error'
  error?: string
  /** 该步输出的图像（若为 image 类算子）。 */
  image?: ImageBlock
  stats?: ChannelStats[]
  table?: ParticleRow[]
  ms: number
}

export interface EngineRunResult {
  results: StepOutcome[]
  /** 最终图像；为 null 表示没有可用图像结果。 */
  image: ImageBlock | null
  ms: number
  /** 估算峰值：本帧输入 + 每步输出的字节之和。 */
  estimatedBytes: number
  /** 整帧分析（直方图 / 剖面 / 统计）；由宿主按需附带，见 `HostRunRequest.analyze`。 */
  analysis?: ImageAnalysis
}

export interface ComputeEngine {
  readonly name: string
  supports(op: string): boolean
  runRecipe(context: ExecuteContext, recipe: Recipe, throughStepId?: string): Promise<EngineRunResult>
}

function blockBytes(block: ImageBlock): number {
  const bytesPerElement = block.data.BYTES_PER_ELEMENT
  return block.data.length * bytesPerElement
}

function frameSelectionRegion(dataset: Dataset, selection: SliceSelection, roi?: Region): Region {
  const start: number[] = []
  const shape: number[] = []
  for (let i = 0; i < dataset.axes.length; i += 1) {
    const axis = dataset.axes[i]!
    if (axis === 'y' || axis === 'x') {
      const dim = dataset.axes.indexOf(axis)
      start.push(roi ? (roi.start[dim] ?? 0) : 0)
      shape.push(roi ? (roi.shape[dim] ?? dataset.shape[i]!) : dataset.shape[i]!)
    } else if (axis === 'c' && dataset.componentKind === 'rgb') {
      // RGB 合成显示：c 轴不作为可切换切片，整段读取。
      start.push(0)
      shape.push(dataset.shape[i]!)
    } else {
      start.push(selection[axis] ?? 0)
      shape.push(1)
    }
  }
  return { start, shape }
}

/** 块是否含多个通道（RGB 等）。 */
function isMultiChannel(block: ImageBlock): boolean {
  const c = block.axes.indexOf('c')
  return c >= 0 && (block.shape[c] ?? 1) > 1
}

/** 逐帧遍历所有前导维度（用于整卷统计）。 */
function* iterateLeadingFrames(dataset: Dataset): Generator<SliceSelection> {
  const leading = dataset.axes
    .map((axis, index) => ({ axis, length: dataset.shape[index]! }))
    .filter((entry): entry is { axis: 't' | 'c' | 'z'; length: number } =>
      entry.axis === 't' || entry.axis === 'c' || entry.axis === 'z')
  const counters = new Array<number>(leading.length).fill(0)
  for (;;) {
    const selection: SliceSelection = {}
    leading.forEach((entry, i) => {
      selection[entry.axis] = counters[i]
    })
    yield selection
    let position = leading.length - 1
    for (;;) {
      if (position < 0) return
      counters[position] = (counters[position] ?? 0) + 1
      if (counters[position]! < (leading[position]?.length ?? 1)) break
      counters[position] = 0
      position -= 1
    }
  }
}

function toChannelStats(dataset: Dataset, merged: MergedStats): ChannelStats[] {
  const channelName = dataset.channels[0]?.name ?? 'Channel 1'
  return [{
    channel: channelName,
    count: merged.count,
    mean: merged.mean,
    min: merged.min,
    max: merged.max,
    stdDev: merged.sampleStdDev,
  }]
}

/** 纯 TS 计算引擎。 */
export class PureComputeEngine implements ComputeEngine {
  readonly name = 'pure-ts'

  supports(op: string): boolean {
    return getOperator(op) !== undefined
  }

  async runRecipe(context: ExecuteContext, recipe: Recipe, throughStepId?: string): Promise<EngineRunResult> {
    const started = Date.now()
    const steps = stepsThrough(recipe, throughStepId)
    const results: StepOutcome[] = []
    let current: ImageBlock | null = null
    let estimatedBytes = 0
    const sourceRegion = frameSelectionRegion(context.dataset, context.selection, context.roi)

    // 空 Recipe：直接显示源数据（当前切片）。
    if (steps.length === 0) {
      const source = await context.storage.readRegion(sourceRegion, { signal: context.signal })
      return {
        results,
        image: source,
        ms: Date.now() - started,
        estimatedBytes: blockBytes(source),
      }
    }

    for (const step of steps) {
      if (!stepAppliesToSelection(step, context.selection)) continue
      if (context.signal?.aborted) throw new DOMException('已取消', 'AbortError')
      const stepStarted = Date.now()
      const capability = getOperator(step.op)
      if (!capability) {
        results.push({ stepId: step.id, status: 'error', error: `未知算子 ${step.op}`, ms: 0 })
        break
      }
      try {
        if (step.op === 'measure') {
          let stats: ChannelStats[]
          if (step.scope?.kind === 'stack') stats = await this.measure(context, step)
          else {
            current ??= await context.storage.readRegion(sourceRegion, { signal: context.signal })
            const acc = new StatsAccumulator(current.dtype)
            const region = step.scope?.kind === 'roi' ? step.scope.region : step.scope?.kind === 'frame' ? step.scope.region : undefined
            acc.add(region ? ops.crop(current, { x: region.start[current.axes.indexOf('x')]!, y: region.start[current.axes.indexOf('y')]!, width: region.shape[current.axes.indexOf('x')]!, height: region.shape[current.axes.indexOf('y')]! }) : current)
            stats = toChannelStats(context.dataset, acc.merged())
          }
          results.push({ stepId: step.id, status: 'ok', stats, ms: Date.now() - stepStarted })
          continue
        }
        if (!current) {
          current = await context.storage.readRegion(sourceRegion, { signal: context.signal })
          estimatedBytes += blockBytes(current)
        }
        const region = step.scope?.kind === 'roi' ? step.scope.region : step.scope?.kind === 'frame' ? step.scope.region : undefined
        const { image, table } = region && step.op !== 'crop' && step.op !== 'grayscale'
          ? await this.applyRoi(step, capability, current, context, region)
          : await this.applyStep(step, capability, current, context)
        if (image) {
          current = image
          estimatedBytes += blockBytes(image)
        }
        if (context.retainStepImages === false) for (const outcome of results) delete outcome.image
        results.push({ stepId: step.id, status: 'ok', image: current ?? undefined, table, ms: Date.now() - stepStarted })
      } catch (error) {
        results.push({
          stepId: step.id,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          ms: Date.now() - stepStarted,
        })
        break
      }
    }
    current ??= await context.storage.readRegion(sourceRegion, { signal: context.signal })
    return { results, image: current, ms: Date.now() - started, estimatedBytes }
  }

  private async applyRoi(step: RecipeStep, capability: OperatorCapability, block: ImageBlock, context: ExecuteContext, region: Region) {
    const xi = block.axes.indexOf('x'), yi = block.axes.indexOf('y')
    const rect = { x: region.start[xi] ?? 0, y: region.start[yi] ?? 0, width: region.shape[xi]!, height: region.shape[yi]! }
    const local = ['gaussian', 'unsharpMask', 'mean3x3', 'median3x3', 'minimum3x3', 'maximum3x3', 'erode', 'dilate', 'open', 'close', 'fillHoles', 'flipH', 'flipV', 'particles'].includes(step.op)
    const input = local ? ops.crop(block, rect) : block
    const output = await this.applyStep(step, capability, input, context)
    if (!output.image) return output
    const width = block.shape[xi]!, height = block.shape[yi]!
    const x0 = Math.max(0, Math.min(width - 1, Math.floor(rect.x)))
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(rect.y)))
    const w = Math.max(1, Math.min(width - x0, Math.floor(rect.width)))
    const h = Math.max(1, Math.min(height - y0, Math.floor(rect.height)))
    const image = output.image
    // ROI 不能把区域外的 16 位/浮点像素截断为 8 位；保持原块精度，只写回选区。
    const planes = block.data.length / (width * height)
    const data = allocateBuffer(block.dtype, block.data.length)
    data.set(block.data)
    for (let plane = 0; plane < planes; plane++) for (let row = 0; row < h; row++) {
      const start = local ? plane * w * h + row * w : plane * width * height + (y0 + row) * width + x0
      data.set(image.data.subarray(start, start + w), plane * width * height + (y0 + row) * width + x0)
    }
    return { image: { ...block, data } }
  }

  /** 整卷 / ROI 统计：逐帧读取后合并。 */
  private async measure(context: ExecuteContext, step: RecipeStep): Promise<ChannelStats[]> {
    const scopeKind = step.scope?.kind ?? 'image'
    const accumulator = new StatsAccumulator(context.dataset.dtype)
    if (scopeKind === 'stack') {
      for (const selection of iterateLeadingFrames(context.dataset)) {
        if (context.signal?.aborted) throw new DOMException('已取消', 'AbortError')
        const region = frameSelectionRegion(context.dataset, selection)
        const block = await context.storage.readRegion(region, { signal: context.signal })
        accumulator.add(block)
      }
    } else {
      const region = frameSelectionRegion(context.dataset, context.selection, context.roi)
      const block = await context.storage.readRegion(region, { signal: context.signal })
      accumulator.add(block)
    }
    return toChannelStats(context.dataset, accumulator.merged())
  }

  private async applyStep(
    step: RecipeStep,
    capability: OperatorCapability,
    block: ImageBlock,
    context: ExecuteContext,
  ): Promise<{ image?: ImageBlock; table?: ParticleRow[] }> {
    const params = step.params as Record<string, number>
    if (isMultiChannel(block) && step.op !== 'grayscale') {
      if (capability.input.channels !== 'any') throw new ops.ComputeError('unsupported', '该算子需要单通道图像，请先添加 grayscale 步骤')
      if (step.op !== 'levels' && step.op !== 'invert') return this.applyRgbStep(step, capability, block, context)
    }
    switch (step.op) {
      case 'grayscale': return { image: this.grayscale(block) }
      case 'debayer': return { image: this.debayer(block, context.dataset.metadata, step.params) }
      case 'invert': return { image: ops.invert(block) }
      case 'levels': return { image: step.params.mode === 'rgb-range' ? applyColorAdjustments(block, [{ min: Number(step.params.minimum), max: Number(step.params.maximum), channel: step.params.channel as ColorChannel }]) : ops.levels(block, params.brightness ?? 0, params.contrast ?? 50) }
      case 'threshold': return { image: ops.threshold(block, params.level ?? 128) }
      case 'otsu': return { image: ops.otsu(block) }
      case 'mean3x3': return { image: ops.mean3x3(block, step.params) }
      case 'median3x3': return { image: ops.median3x3(block, step.params) }
      case 'sharpen3x3': return { image: ops.sharpen3x3(block, step.params) }
      case 'sobel': return { image: ops.sobel(block) }
      case 'minimum3x3': return { image: ops.minimum3x3(block, step.params) }
      case 'maximum3x3': return { image: ops.maximum3x3(block, step.params) }
      case 'gaussian': return { image: ops.gaussian(block, params.sigma ?? 1.5) }
      case 'unsharpMask': return { image: ops.unsharpMask(block, step.params) }
      case 'erode': return { image: ops.erode(block, params.radius ?? 1) }
      case 'dilate': return { image: ops.dilate(block, params.radius ?? 1) }
      case 'open': return { image: ops.open(block, params.radius ?? 1) }
      case 'close': return { image: ops.close(block, params.radius ?? 1) }
      case 'fillHoles': return { image: ops.fillHoles(block) }
      case 'flipH': return { image: ops.flipHorizontalBlock(block) }
      case 'flipV': return { image: ops.flipVerticalBlock(block) }
      case 'rotateCW': return { image: ops.rotateBlock(block, 'cw') }
      case 'rotateCCW': return { image: ops.rotateBlock(block, 'ccw') }
      case 'crop': return {
        image: ops.crop(block, {
          x: params.x ?? 0,
          y: params.y ?? 0,
          width: params.width ?? block.shape[context.dataset.axes.indexOf('x')]!,
          height: params.height ?? block.shape[context.dataset.axes.indexOf('y')]!,
        }),
      }
      case 'particles': return {
        table: ops.particles(block, params.minArea ?? 1).map((particle) => ({
          channel: context.dataset.channels[0]?.name ?? 'Channel 1',
          id: particle.id,
          area: particle.area,
          perimeter: particle.perimeter,
          circularity: particle.circularity,
          centroidX: particle.centroidX,
          centroidY: particle.centroidY,
        })),
      }
      default:
        void capability
        throw new ops.ComputeError('unsupported', `纯 TS 后端未实现算子 ${step.op}`)
    }
  }

  /** 同一参数独立处理 RGB 平面，再组装原精度彩色结果。 */
  private async applyRgbStep(step: RecipeStep, capability: OperatorCapability, block: ImageBlock, context: ExecuteContext): Promise<{ image: ImageBlock }> {
    const ci = block.axes.indexOf('c'), channels = block.shape[ci]!, planeSize = block.data.length / channels
    let combined: ImageBlock | undefined
    for (let channel = 0; channel < channels; channel++) {
      const shape = block.shape.map((size, index) => index === ci ? 1 : size)
      const input = { ...block, shape, region: { ...block.region, shape }, data: block.data.subarray(channel * planeSize, (channel + 1) * planeSize) }
      const output = (await this.applyStep(step, capability, input, context)).image
      if (!output) throw new ops.ComputeError('unsupported', 'RGB 算子必须输出图像')
      combined ??= { ...output, shape: output.shape.map((size, index) => index === ci ? channels : size), region: { ...output.region, shape: output.region.shape.map((size, index) => index === ci ? channels : size) }, data: allocateBuffer(output.dtype, output.data.length * channels) }
      combined.data.set(output.data, channel * output.data.length)
    }
    return { image: combined! }
  }

  /** 当前结果 → 灰度，保留此前处理；RGB 使用 ImageJ 的 1/3 等权。 */
  private grayscale(source: ImageBlock): ImageBlock {
    const cIndex = source.axes.indexOf('c')
    if (!isMultiChannel(source)) {
      if (source.dtype === 'uint8') return source
      const settings = computeWindowLevel(source), lo = settings.level - settings.window / 2
      const data = new Uint8Array(source.data.length)
      for (let i = 0; i < data.length; i++) data[i] = Number.isFinite(source.data[i]) ? Math.max(0, Math.min(255, Math.round((source.data[i]! - lo) * 255 / settings.window))) : 0
      return { ...source, dtype: 'uint8', data }
    }
    const channels = source.shape[cIndex]!
    if (channels !== 3) throw new ops.ComputeError('unsupported', '灰度只支持 3 通道 RGB 输入')
    const pixels = elementCount(source.shape) / channels
    const data = new Uint8Array(pixels)
    const src = source.data
    const settings = source.dtype === 'uint8' ? { window: 255, level: 127.5 } : computeWindowLevel(source)
    const lo = settings.level - settings.window / 2
    // 数据按 c 轴平面存放（[c][y][x]），不是逐像素交织。
    for (let i = 0; i < pixels; i += 1) {
      const value = (src[i]! + src[pixels + i]! + src[2 * pixels + i]!) / 3
      data[i] = Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round((value - lo) * 255 / settings.window))) : 0
    }
    const outputShape = source.shape.map((size, index) => index === cIndex ? 1 : size)
    return {
      dtype: 'uint8',
      axes: source.axes,
      shape: outputShape,
      region: { start: [...source.region.start], shape: source.region.shape.map((n, i) => (i === cIndex ? 1 : n)) },
      data,
    }
  }

  /**
   * CFA 马赛克 → 三通道 RGB（debayer）。
   *
   * 滤镜序列优先取算子参数，其次 dataset 元数据（RAW 导入时写入 `cfaPattern`），最后默认 RGGB。
   * 输出在 `c` 轴前插入 3 个通道，与本项目 RGB 块布局一致。
   */
  private debayer(source: ImageBlock, metadata: Readonly<Record<string, string | number | boolean>> | undefined, params: Readonly<Record<string, number | string>>): ImageBlock {
    if (isMultiChannel(source)) throw new ops.ComputeError('unsupported', 'debayer 需要单通道 CFA 图像，不能作用在彩色图上')
    const xi = source.axes.indexOf('x')
    const yi = source.axes.indexOf('y')
    const width = source.shape[xi]!
    const height = source.shape[yi]!
    const algorithm = params.algorithm === 'bilinear' ? 'bilinear' : 'malvar'
    const data = demosaicToDtype(source.data, width, height, source.dtype, {
      pattern: resolveCfaPattern(params.pattern, metadata),
      algorithm,
    })
    return {
      dtype: source.dtype,
      axes: ['c', ...source.axes] as ImageBlock['axes'],
      shape: [3, ...source.shape],
      region: { start: [0, ...source.region.start], shape: [3, ...source.region.shape] },
      data,
    }
  }
}

const CFA_PATTERNS: readonly CfaPatternName[] = ['rggb', 'bggr', 'grbg', 'gbrg']

/** 解析生效的滤镜序列：算子参数 > dataset 元数据 > RGGB。 */
function resolveCfaPattern(
  option: string | number | undefined,
  metadata?: Readonly<Record<string, string | number | boolean>>,
): CfaPatternName {
  const chosen = String(option ?? 'auto')
  if ((CFA_PATTERNS as readonly string[]).includes(chosen)) return chosen as CfaPatternName
  const declared = metadata?.cfaPattern
  if (typeof declared === 'string' && (CFA_PATTERNS as readonly string[]).includes(declared)) return declared as CfaPatternName
  return 'rggb'
}

/** 内存中重新分配一个与输入同形的块，供引擎测试使用。 */
export function emptyBlock(dtype: ImageBlock['dtype'], axes: ImageBlock['axes'], shape: readonly number[]): ImageBlock {
  return { dtype, axes, shape, region: fullRegion(shape), data: allocateBuffer(dtype, elementCount(shape)) }
}

