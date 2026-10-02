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
import { stepsThrough, type Recipe, type RecipeStep } from '../recipe.ts'
import { StatsAccumulator, type MergedStats } from '../stats.ts'
import type { Storage } from '../storage.ts'
import { fullRegion } from '../storage.ts'
import type { ChannelStats, ParticleRow } from '../../lib/engineTypes.ts'
import { allocateBuffer, elementCount, type ImageBlock, type Region } from '../types.ts'
import * as ops from './pureOps.ts'

export interface ExecuteContext {
  dataset: Dataset
  storage: Storage
  /** 当前 T/C/Z 选择。 */
  selection: SliceSelection
  /** 可选的 ROI（图像索引坐标，含 y/x 范围）。 */
  roi?: Region
  signal?: AbortSignal
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
      if (context.signal?.aborted) throw new DOMException('已取消', 'AbortError')
      const stepStarted = Date.now()
      const capability = getOperator(step.op)
      if (!capability) {
        results.push({ stepId: step.id, status: 'error', error: `未知算子 ${step.op}`, ms: 0 })
        break
      }
      try {
        if (step.op === 'measure') {
          const stats = await this.measure(context, step)
          results.push({ stepId: step.id, status: 'ok', stats, ms: Date.now() - stepStarted })
          continue
        }
        if (!current) {
          current = await context.storage.readRegion(sourceRegion, { signal: context.signal })
          estimatedBytes += blockBytes(current)
        }
        const { image, table } = await this.applyStep(step, capability, current, context)
        if (image) {
          current = image
          estimatedBytes += blockBytes(image)
        }
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
    return { results, image: current, ms: Date.now() - started, estimatedBytes }
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
      throw new ops.ComputeError('unsupported', '彩色（多通道）图像暂只支持先做灰度化，请先添加 grayscale 步骤')
    }
    switch (step.op) {
      case 'grayscale': return { image: await this.grayscale(context) }
      case 'invert': return { image: ops.invert(block) }
      case 'levels': return { image: ops.levels(block, params.brightness ?? 0, params.contrast ?? 50) }
      case 'threshold': return { image: ops.threshold(block, params.level ?? 128) }
      case 'otsu': return { image: ops.otsu(block) }
      case 'mean3x3': return { image: ops.mean3x3(block) }
      case 'median3x3': return { image: ops.median3x3(block) }
      case 'sharpen3x3': return { image: ops.sharpen3x3(block) }
      case 'sobel': return { image: ops.sobel(block) }
      case 'minimum3x3': return { image: ops.minimum3x3(block) }
      case 'maximum3x3': return { image: ops.maximum3x3(block) }
      case 'gaussian': return { image: ops.gaussian(block, params.sigma ?? 1.5) }
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

  /** RGB → 灰度：读取 c 轴全部通道做等权平均（对应 ImageJ 的 1/3 等权）。 */
  private async grayscale(context: ExecuteContext): Promise<ImageBlock> {
    const cIndex = context.dataset.axes.indexOf('c')
    if (cIndex < 0) return context.storage.readRegion(frameSelectionRegion(context.dataset, context.selection), {})
    const channels = context.dataset.shape[cIndex]!
    if (channels !== 3) throw new ops.ComputeError('unsupported', '灰度只支持 3 通道 RGB 输入')
    const frameRegion = frameSelectionRegion(context.dataset, context.selection)
    const start = [...frameRegion.start]
    const shape = [...frameRegion.shape]
    start[cIndex] = 0
    shape[cIndex] = channels
    const block = await context.storage.readRegion({ start, shape }, { signal: context.signal })
    const pixels = elementCount(block.shape) / channels
    const data = new Uint8Array(pixels)
    const src = block.data as unknown as { readonly length: number; readonly [index: number]: number }
    // 数据按 c 轴平面存放（[c][y][x]），不是逐像素交织。
    for (let i = 0; i < pixels; i += 1) {
      data[i] = Math.round((src[i]! + src[pixels + i]! + src[2 * pixels + i]!) / 3)
    }
    const outputShape = context.dataset.axes.map((axis, index) => (axis === 'c' ? 1 : context.dataset.shape[index]!))
    return {
      dtype: 'uint8',
      axes: context.dataset.axes,
      shape: outputShape,
      region: { start, shape: shape.map((n, i) => (i === cIndex ? 1 : n)) },
      data,
    }
  }
}

/** 内存中重新分配一个与输入同形的块，供引擎测试使用。 */
export function emptyBlock(dtype: ImageBlock['dtype'], axes: ImageBlock['axes'], shape: readonly number[]): ImageBlock {
  return { dtype, axes, shape, region: fullRegion(shape), data: allocateBuffer(dtype, elementCount(shape)) }
}
