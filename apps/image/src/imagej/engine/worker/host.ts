/**
 * 引擎宿主：管理已导入的 Dataset/Storage 并执行 Recipe。
 *
 * Worker 与主线程回退路径共用这一实现，避免行为分叉。像素不跨线程复制时可直接用
 * 主线程宿主（测试、SSR、Worker 不可用时）。
 */
import { createDataset, type Dataset, type SliceSelection } from '../dataset.ts'
import { MemoryStorage, type Storage } from '../storage.ts'
import { PageMapStorage, type PageRef } from '../storage-pages.ts'
import { importFile, importImageStack, type ImportResult } from '../importer.ts'
import type { RawSensorOptions } from '../raw/sensor.ts'
import { analyzeBlock, type ImageAnalysis } from '../analysis.ts'
import { computeStackStats, type StackStatsCalibration, type StackStatsResult } from '../stackStats.ts'
import { computeStackProfiles, type StackProfilesResult } from '../stackProfiles.ts'
import { profileBlock } from '../analysis.ts'
import { pointsRoi } from '../../lib/roi.ts'
import type { RoiInput } from '../../lib/processor.ts'
import { assertSameShape, projectFrames, type ProjectionMethod } from '../stackProject.ts'
import { autoMontageLayout, makeMontage, splitMontage } from '../montage.ts'
import { reslice, type ResliceStart } from '../reslice.ts'
import { orthogonalViews } from '../orthogonal.ts'
import { blitPage, emptyBuffer, pageGeometry, type PageGeometry } from '../stackCombine.ts'
import { formatSliceLabel, padWidthFor, type SliceLabelFormat } from '../sliceLabel.ts'
import { defaultLabelColor, drawText, textWidth } from '../textRaster.ts'
import { project3d, type Projection3dAxis, type Projection3dMethod } from '../project3d.ts'
import { PureComputeEngine, type EngineRunResult } from '../compute/engine.ts'
import { createRecipe, type Recipe } from '../recipe.ts'
import { allocateBuffer, elementCount, type AxisName, type ChannelInfo, type Dtype, type ImageBlock, type PixelArray, type Region, type SourceRef, type SpatialTransform, type TimeCalibration } from '../types.ts'

export interface HostRunRequest {
  datasetId: string
  recipe: Recipe
  selection: SliceSelection
  roi?: Region
  throughStepId?: string
  /** 是否在算出图像后顺带产出整帧分析，供主线程直接读取（避免再复制一份画面）。 */
  analyze?: boolean
}

interface Entry {
  dataset: Dataset
  storage: Storage
  controller: AbortController
}

export class EngineHost {
  private readonly entries = new Map<string, Entry>()
  private readonly engine = new PureComputeEngine()

  async import(file: File, decoder?: (file: File) => Promise<unknown | null>, options?: RawSensorOptions): Promise<ImportResult> {
    const result = await importFile(file, decoder as never, options)
    this.entries.set(result.dataset.id, { dataset: result.dataset, storage: result.storage, controller: new AbortController() })
    return result
  }

  async importStack(files: File[], decoder?: (file: File) => Promise<unknown | null>, options?: ReadonlyMap<string, RawSensorOptions>): Promise<ImportResult> {
    const result = await importImageStack(files, decoder as never, options)
    this.entries.set(result.dataset.id, { dataset: result.dataset, storage: result.storage, controller: new AbortController() })
    return result
  }

  dataset(datasetId: string): Dataset | undefined {
    return this.entries.get(datasetId)?.dataset
  }

  async run(request: HostRunRequest): Promise<EngineRunResult> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    entry.controller = new AbortController()
    const outcome = await this.engine.runRecipe(
      {
        dataset: entry.dataset,
        storage: entry.storage,
        selection: request.selection,
        roi: request.roi,
        signal: entry.controller.signal,
        retainStepImages: false,
      },
      request.recipe,
      request.throughStepId,
    )
    // 分析在同一线程里顺带完成：主线程无需再复制整帧、再跑第二个 Worker。
    if (request.analyze && outcome.image) outcome.analysis = analyzeBlock(outcome.image)
    return outcome
  }

  async analyze(request: { datasetId: string; recipe: Recipe; selection: SliceSelection; throughStepId?: string }): Promise<ImageAnalysis | undefined> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    entry.controller = new AbortController()
    const outcome = await this.engine.runRecipe(
      {
        dataset: entry.dataset,
        storage: entry.storage,
        selection: request.selection,
        signal: entry.controller.signal,
        retainStepImages: false,
      },
      request.recipe,
      request.throughStepId,
    )
    return outcome.image ? analyzeBlock(outcome.image) : undefined
  }

  /**
   * 整栈逐页统计：逐页执行当前 Recipe 后统计，全程留在本线程内。
   *
   * 三个命令共用这一条通路：Measure Stack 取 `frames`，Statistics 取 `summary`，
   * Plot Z-axis Profile 取 `profile`。ROI 通过逐页读取时的区域裁剪生效。
   */
  async stackStats(request: {
    datasetId: string
    recipe: Recipe
    selection: SliceSelection
    roi?: Region
    axis?: 'z' | 't' | 'c'
  }): Promise<StackStatsResult | undefined> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    const axis = request.axis ?? defaultSliceAxis(entry.dataset)
    if (!axis) return undefined
    entry.controller = new AbortController()
    const signal = entry.controller.signal
    const length = entry.dataset.shape[entry.dataset.axes.indexOf(axis)] ?? 1
    return computeStackStats({
      frameCount: length,
      axis,
      signal,
      calibration: sliceCalibration(entry.dataset, axis),
      readFrame: async (index) => {
        const selection: SliceSelection = { ...request.selection, [axis]: index }
        const outcome = await this.engine.runRecipe(
          {
            dataset: entry.dataset,
            storage: entry.storage,
            selection,
            roi: request.roi,
            signal,
            retainStepImages: false,
          },
          request.recipe,
        )
        const failure = outcome.results.find((result) => result.status === 'error')
        if (failure?.error) throw new Error(failure.error)
        if (!outcome.image) throw new Error('整栈统计未取得像素')
        return outcome.image
      },
    })
  }

  /**
   * Z 投影：逐页执行当前 Recipe 后投影，把结果注册成新的 Dataset 并返回其元信息。
   *
   * 单组（Z Project...）输出一张 2D 图 —— 被投影的轴从结果的轴列表里移除；
   * 分组（Grouped Z Project...）保留该轴、长度换成组数。像素全程留在本线程，不跨线程回传。
   */
  async project(request: {
    datasetId: string
    recipe: Recipe
    selection: SliceSelection
    roi?: Region
    axis?: 'z' | 't' | 'c'
    from?: number
    to?: number
    method: ProjectionMethod
    groupSize?: number
    /** 对每条时间帧各投影一次（ImageJ 的 All time frames），结果保留 `t` 轴。 */
    allTimeFrames?: boolean
    title?: string
  }): Promise<Dataset | undefined> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    const dataset = entry.dataset
    const axis = request.axis ?? defaultSliceAxis(dataset)
    if (!axis) return undefined
    const axisIndex = dataset.axes.indexOf(axis)
    const length = dataset.shape[axisIndex] ?? 1
    entry.controller = new AbortController()
    const signal = entry.controller.signal
    // 越界区间夹取到有效范围，而不是静默产出空结果。
    const from = Math.max(0, Math.min(length - 1, Math.floor(request.from ?? 0)))
    const to = Math.max(from, Math.min(length - 1, Math.floor(request.to ?? length - 1)))
    const span = to - from + 1
    const groupSize = Math.max(1, Math.floor(request.groupSize ?? span))
    // 与 ImageJ 的 GroupedZProjector（`:80-83`）一致：分组必须整除，否则明确报错，
    // 而不是把尾部不足一组的部分悄悄丢掉。
    if (groupSize > 1 && span % groupSize !== 0) {
      throw new Error(`组大小 ${groupSize} 不能整除 ${span} 页的切片区间`)
    }
    const groups: number[][] = []
    for (let start = from; start <= to; start += groupSize) {
      const group: number[] = []
      for (let index = start; index <= Math.min(to, start + groupSize - 1); index += 1) group.push(index)
      groups.push(group)
    }

    const timeIndex = dataset.axes.indexOf('t')
    // ImageJ 的 Z Project 只在「超栈且帧数>1 且切片数>1」时才提供 All time frames；
    // 这里同样只在 t 轴长度大于 1 时生效。
    const allTimeFrames = Boolean(request.allTimeFrames) && timeIndex >= 0 && (dataset.shape[timeIndex] ?? 1) > 1
    const timeCount = allTimeFrames ? dataset.shape[timeIndex]! : 1

    const readFrameAt = (frameTime: number) => async (index: number): Promise<ImageBlock> => {
      const selection: SliceSelection = { ...request.selection, [axis]: index }
      if (allTimeFrames && timeIndex >= 0) selection.t = frameTime
      const outcome = await this.engine.runRecipe(
        {
          dataset,
          storage: entry.storage,
          selection,
          roi: request.roi,
          signal,
          retainStepImages: false,
        },
        request.recipe,
      )
      const failure = outcome.results.find((result) => result.status === 'error')
      if (failure?.error) throw new Error(failure.error)
      if (!outcome.image) throw new Error('投影未取得像素')
      return outcome.image
    }

    // 外层时间帧、内层分组：页的先后顺序即输出布局里对应轴的顺序。
    const pageEntries: Array<{ time: number; group: number; block: ImageBlock }> = []
    for (let time = 0; time < timeCount; time += 1) {
      for (let group = 0; group < groups.length; group += 1) {
        pageEntries.push({
          time,
          group,
          block: await projectFrames({ method: request.method, frames: groups[group]!, readFrame: readFrameAt(time), signal }),
        })
      }
    }
    const pages = pageEntries.map((entry) => entry.block)
    assertSameShape(pages)

    const keepTimeAxis = timeCount > 1
    const keepProjectionAxis = groups.length > 1
    const outAxes: AxisName[] = []
    const outShape: number[] = []
    dataset.axes.forEach((name, index) => {
      const keepTime = name === 't' && keepTimeAxis
      const keepProjection = index === axisIndex && keepProjectionAxis
      const keepSpatial = name === 'y' || name === 'x' || (name === 'c' && index !== axisIndex)
      if (!keepTime && !keepProjection && !keepSpatial) return
      outAxes.push(name)
      outShape.push(keepTime ? timeCount : keepProjection ? groups.length : dataset.shape[index]!)
    })
    if (outAxes.length < 2 || !outAxes.includes('y') || !outAxes.includes('x')) {
      throw new Error('投影结果的维度不足两维')
    }

    // 逐页把像素摆进目标布局：时间帧对应 t 轴、组序号对应投影轴、页内平面序号对应 `c` 轴。
    const first = pages[0]!
    const strides = shapeStrides(outShape)
    const axisOut = outAxes.indexOf(axis)
    const timeOut = outAxes.indexOf('t')
    const cOut = outAxes.indexOf('c')
    const planeLength = (outShape[outAxes.indexOf('y')] ?? 0) * (outShape[outAxes.indexOf('x')] ?? 0)
    const sourcePlanes = planeLength > 0 ? first.data.length / planeLength : 1
    const buffer = allocateBuffer(first.dtype, elementCount(outShape))
    const destination = numberView(buffer)
    for (const page of pageEntries) {
      const source = numberView(page.block.data)
      for (let plane = 0; plane < sourcePlanes; plane += 1) {
        let target = 0
        if (timeOut >= 0) target += page.time * strides[timeOut]!
        if (axisOut >= 0 && keepProjectionAxis) target += page.group * strides[axisOut]!
        if (cOut >= 0) target += plane * strides[cOut]!
        const offset = plane * planeLength
        for (let i = 0; i < planeLength; i += 1) destination[target + i] = source[offset + i]!
      }
    }

    // 分组投影会改变沿投影轴的物理间距（ImageJ 的 GroupedZProjector 同样把 pixelDepth 乘以组大小）。
    const spacing = [...dataset.spatialTransform.spacing] as [number, number, number]
    if (keepProjectionAxis && axis === 'z' && dataset.spatialTransform.calibrated) spacing[2] *= groupSize
    const spatialTransform = { ...dataset.spatialTransform, spacing }
    const title = request.title?.trim() || `${METHOD_PREFIX[request.method]}${dataset.source.name}`
    const source: SourceRef = {
      kind: 'memory',
      name: title,
      format: 'memory',
      fingerprint: `project:${dataset.id}@${dataset.revision}:${axis}:${from}-${to}:${request.method}:${groupSize}`,
    }
    const metadata = {
      ...dataset.metadata,
      projectionMethod: request.method,
      projectionAxis: axis,
      projectionRange: `${from + 1}-${to + 1}`,
      projectionGroups: groups.length,
    }
    return registerMemoryDataset(this.entries, {
      dtype: first.dtype,
      axes: outAxes,
      shape: outShape,
      spatialTransform,
      timeCalibration: dataset.timeCalibration,
      channels: dataset.channels,
      source,
      componentKind: outAxes.includes('c') ? 'rgb' : 'scalar',
      metadata,
      buffer,
    })
  }

  /**
   * Make Montage：把当前栈的一段页拼成一张大图（单页），注册成新 Dataset 并返回元信息。
   *
   * 行列与缩放缺省时按 ImageJ 的自动规则算（见 `engine/montage.ts`）；像素全程留在本线程。
   */
  async montage(request: {
    datasetId: string
    recipe: Recipe
    selection: SliceSelection
    roi?: Region
    axis?: 'z' | 't' | 'c'
    from?: number
    to?: number
    increment?: number
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
  }): Promise<Dataset | undefined> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    const dataset = entry.dataset
    const axis = request.axis ?? defaultSliceAxis(dataset)
    if (!axis) return undefined
    const axisIndex = dataset.axes.indexOf(axis)
    const length = dataset.shape[axisIndex] ?? 1
    entry.controller = new AbortController()
    const signal = entry.controller.signal
    const from = Math.max(0, Math.min(length - 1, Math.floor(request.from ?? 0)))
    const to = Math.max(from, Math.min(length - 1, Math.floor(request.to ?? length - 1)))
    const increment = Math.max(1, Math.floor(request.increment ?? 1))
    const frames: number[] = []
    for (let index = from; index <= to; index += increment) frames.push(index)

    const readFrame = async (index: number): Promise<ImageBlock> => {
      const selection: SliceSelection = { ...request.selection, [axis]: index }
      const outcome = await this.engine.runRecipe(
        {
          dataset,
          storage: entry.storage,
          selection,
          roi: request.roi,
          signal,
          retainStepImages: false,
        },
        request.recipe,
      )
      const failure = outcome.results.find((result) => result.status === 'error')
      if (failure?.error) throw new Error(failure.error)
      if (!outcome.image) throw new Error('蒙太奇未取得像素')
      return outcome.image
    }

    // 自动布局要先知道单页宽度，因此首页在这里读一次并交给内核复用。
    const firstBlock = await readFrame(frames[0]!)
    const auto = autoMontageLayout(firstBlock.shape[firstBlock.axes.indexOf('x')]!, frames.length)
    const columns = Math.max(1, Math.floor(request.columns && request.columns > 0 ? request.columns : auto.columns))
    const rows = Math.max(1, Math.floor(request.rows && request.rows > 0 ? request.rows : auto.rows))
    const scale = request.scale && request.scale > 0 ? request.scale : auto.scale
    const borderWidth = Math.max(0, Math.floor(request.borderWidth ?? 0))

    const labels = request.labels
    const block = await makeMontage({
      columns,
      rows,
      scale,
      borderWidth,
      frames,
      readFrame,
      firstBlock,
      signal,
      labelSlices: Boolean(request.labelSlices),
      fontSize: request.fontSize,
      labelAt: labels ? (frameIndex) => labels[frameIndex] ?? String(frameIndex + 1) : undefined,
    })

    const spacing = [...dataset.spatialTransform.spacing] as [number, number, number]
    if (dataset.spatialTransform.calibrated) {
      spacing[0] /= scale
      spacing[1] /= scale
    }
    const title = request.title?.trim() || `${dataset.source.name} montage`
    // 被拼接的切片轴从结果里移除：蒙太奇是一张 2D 图（对应 ImageJ 的单个新窗口）。
    const axes: AxisName[] = []
    const shape: number[] = []
    dataset.axes.forEach((name, index) => {
      if (index === axisIndex) return
      axes.push(name)
      shape.push(block.shape[index]!)
    })
    return registerMemoryDataset(this.entries, {
      dtype: block.dtype,
      axes,
      shape,
      spatialTransform: { ...dataset.spatialTransform, spacing },
      timeCalibration: dataset.timeCalibration,
      channels: dataset.channels,
      source: {
        kind: 'memory',
        name: title,
        format: 'memory',
        fingerprint: `montage:${dataset.id}@${dataset.revision}:${axis}:${from}-${to}-${increment}:${columns}x${rows}@${scale}/${borderWidth}`,
      },
      componentKind: axes.includes('c') ? 'rgb' : 'scalar',
      metadata: {
        ...dataset.metadata,
        montageColumns: columns,
        montageRows: rows,
        montageBorderWidth: borderWidth,
      },
      buffer: block.data,
    })
  }

  /**
   * Montage to Stack：把当前蒙太奇图切回一个多页栈（ImageJ 的 StackMaker）。
   *
   * 行列缺省沿用 Make Montage 写进元数据的 `montageColumns` / `montageRows`
   * （对应 ImageJ 通过 `Info` 属性传递的 xMontage / yMontage）。
   */
  async montageToStack(request: {
    datasetId: string
    recipe: Recipe
    selection: SliceSelection
    roi?: Region
    columns?: number
    rows?: number
    borderWidth?: number
    title?: string
  }): Promise<Dataset | undefined> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    const dataset = entry.dataset
    entry.controller = new AbortController()
    const signal = entry.controller.signal
    const outcome = await this.engine.runRecipe(
      {
        dataset,
        storage: entry.storage,
        selection: { ...request.selection },
        roi: request.roi,
        signal,
        retainStepImages: false,
      },
      request.recipe,
    )
    const failure = outcome.results.find((result) => result.status === 'error')
    if (failure?.error) throw new Error(failure.error)
    if (!outcome.image) throw new Error('Montage to Stack 未取得像素')

    const declaredColumns = Number(dataset.metadata.montageColumns ?? 2)
    const declaredRows = Number(dataset.metadata.montageRows ?? 2)
    const columns = Math.max(1, Math.floor(request.columns && request.columns > 0
      ? request.columns
      : Number.isFinite(declaredColumns) && declaredColumns > 0 ? declaredColumns : 2))
    const rows = Math.max(1, Math.floor(request.rows && request.rows > 0
      ? request.rows
      : Number.isFinite(declaredRows) && declaredRows > 0 ? declaredRows : 2))
    const borderWidth = Math.max(0, Math.floor(request.borderWidth ?? 0))
    const pages = splitMontage(outcome.image, { columns, rows, borderWidth })

    // 输出轴：复用输入的轴序，缺 `z` 时插到 `y` 之前，切片长度等于面板数。
    const axes: AxisName[] = [...dataset.axes]
    if (!axes.includes('z')) axes.splice(axes.indexOf('y'), 0, 'z')
    const shape = axes.map((name) => (name === 'z' ? pages.length : pages[0]!.shape[dataset.axes.indexOf(name)] ?? 1))
    const strides = shapeStrides(shape)
    const zOut = axes.indexOf('z')
    const cOut = axes.indexOf('c')
    const planeLength = (shape[axes.indexOf('y')] ?? 0) * (shape[axes.indexOf('x')] ?? 0)
    const sourcePlanes = planeLength > 0 ? Math.max(1, pages[0]!.data.length / planeLength) : 1
    const buffer = allocateBuffer(pages[0]!.dtype, elementCount(shape))
    const destination = numberView(buffer)
    for (let page = 0; page < pages.length; page += 1) {
      const source = numberView(pages[page]!.data)
      for (let plane = 0; plane < sourcePlanes; plane += 1) {
        const target = page * strides[zOut]! + (cOut >= 0 ? plane * strides[cOut]! : 0)
        const offset = plane * planeLength
        for (let i = 0; i < planeLength; i += 1) destination[target + i] = source[offset + i]!
      }
    }

    const title = request.title?.trim() || `${dataset.source.name} stack`
    return registerMemoryDataset(this.entries, {
      dtype: pages[0]!.dtype,
      axes,
      shape,
      spatialTransform: dataset.spatialTransform,
      timeCalibration: dataset.timeCalibration,
      channels: dataset.channels,
      componentKind: axes.includes('c') ? 'rgb' : 'scalar',
      metadata: {
        ...dataset.metadata,
        montageToStack: `${columns}x${rows}`,
        stackSlices: pages.length,
      },
      source: {
        kind: 'memory',
        name: title,
        format: 'memory',
        fingerprint: `montage-to-stack:${dataset.id}@${dataset.revision}:${columns}x${rows}/${borderWidth}`,
      },
      buffer,
    })
  }

  /**
   * Reslice：沿选区的垂直方向逐条采样，产出一个新栈（ImageJ 的 `Slicer`）。
   *
   * 采样区域缺省是整帧；`bounds` 由 UI 从当前矩形 ROI 换算而来。
   */
  async reslice(request: {
    datasetId: string
    recipe: Recipe
    selection: SliceSelection
    bounds?: { x: number; y: number; width: number; height: number }
    axis?: 'z' | 't' | 'c'
    from?: number
    to?: number
    spacing?: number
    startAt?: ResliceStart
    flip?: boolean
    rotate?: boolean
    title?: string
  }): Promise<Dataset | undefined> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    const dataset = entry.dataset
    const axis = request.axis ?? defaultSliceAxis(dataset)
    if (!axis) return undefined
    const axisIndex = dataset.axes.indexOf(axis)
    const length = dataset.shape[axisIndex] ?? 1
    entry.controller = new AbortController()
    const signal = entry.controller.signal
    const from = Math.max(0, Math.min(length - 1, Math.floor(request.from ?? 0)))
    const to = Math.max(from, Math.min(length - 1, Math.floor(request.to ?? length - 1)))
    const frames: number[] = []
    for (let index = from; index <= to; index += 1) frames.push(index)

    const frameWidth = dataset.shape[dataset.axes.indexOf('x')] ?? 1
    const frameHeight = dataset.shape[dataset.axes.indexOf('y')] ?? 1
    const x = Math.max(0, Math.min(frameWidth - 1, Math.floor(request.bounds?.x ?? 0)))
    const y = Math.max(0, Math.min(frameHeight - 1, Math.floor(request.bounds?.y ?? 0)))
    const bounds = {
      x,
      y,
      width: Math.max(1, Math.min(frameWidth - x, Math.floor(request.bounds?.width ?? frameWidth))),
      height: Math.max(1, Math.min(frameHeight - y, Math.floor(request.bounds?.height ?? frameHeight))),
    }

    const readFrame = async (index: number): Promise<ImageBlock> => {
      const selection: SliceSelection = { ...request.selection, [axis]: index }
      const roi: Region = {
        start: dataset.axes.map((name) => (name === 'x' ? bounds.x : name === 'y' ? bounds.y : selection[name as 'z' | 't' | 'c'] ?? 0)),
        shape: dataset.axes.map((name) => (name === 'x' ? bounds.width : name === 'y' ? bounds.height : 1)),
      }
      const outcome = await this.engine.runRecipe(
        { dataset, storage: entry.storage, selection, roi, signal, retainStepImages: false },
        request.recipe,
      )
      const failure = outcome.results.find((result) => result.status === 'error')
      if (failure?.error) throw new Error(failure.error)
      if (!outcome.image) throw new Error('Reslice 未取得像素')
      const block = outcome.image
      const channels = block.axes.indexOf('c')
      if (channels >= 0 && (block.shape[channels] ?? 1) > 1) {
        throw new Error('Reslice 暂不支持多通道数据，请先转换为灰度')
      }
      return block
    }

    const pages = await reslice({
      bounds,
      spacing: request.spacing ?? 1,
      startAt: request.startAt ?? 'top',
      flip: Boolean(request.flip),
      rotate: Boolean(request.rotate),
      frames,
      readFrame,
      signal,
    })

    // 输出固定为 z-y-x 单栈：页顺序即 z 顺序，每页是内核给的二维剖面。
    const shape = [pages.length, pages[0]!.shape[0]!, pages[0]!.shape[1]!]
    const planeLength = shape[1]! * shape[2]!
    const buffer = allocateBuffer(pages[0]!.dtype, elementCount(shape))
    const destination = numberView(buffer)
    for (let page = 0; page < pages.length; page += 1) {
      const source = numberView(pages[page]!.data)
      for (let i = 0; i < planeLength; i += 1) destination[page * planeLength + i] = source[i]!
    }

    const startAt = request.startAt ?? 'top'
    return registerMemoryDataset(this.entries, {
      dtype: pages[0]!.dtype,
      axes: ['z', 'y', 'x'],
      shape,
      spatialTransform: dataset.spatialTransform,
      channels: dataset.channels,
      componentKind: 'scalar',
      metadata: {
        ...dataset.metadata,
        resliceStartAt: startAt,
        resliceSpacing: request.spacing ?? 1,
        resliceBounds: `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`,
      },
      source: {
        kind: 'memory',
        name: request.title?.trim() || `Reslice of ${dataset.source.name}`,
        format: 'memory',
        fingerprint: `reslice:${dataset.id}@${dataset.revision}:${axis}:${from}-${to}:${bounds.x},${bounds.y},${bounds.width},${bounds.height}:${startAt}/${request.spacing ?? 1}/${request.flip ? 1 : 0}/${request.rotate ? 1 : 0}`,
      },
      buffer,
    })
  }

  /**
   * Orthogonal Views：由当前 z 栈重建 XZ 与 YZ 两张正交视图，各注册成一个新数据集。
   *
   * 交叉点缺省取图像中心；只有 z 方向物理间距不等于像素间距时才做一次双线性重采样。
   */
  async orthogonal(request: {
    datasetId: string
    recipe: Recipe
    selection: SliceSelection
    point?: { x: number; y: number }
    axis?: 'z' | 't' | 'c'
    from?: number
    to?: number
  }): Promise<Dataset[]> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    const dataset = entry.dataset
    const axis = request.axis ?? defaultSliceAxis(dataset)
    if (!axis) return []
    const axisIndex = dataset.axes.indexOf(axis)
    const length = dataset.shape[axisIndex] ?? 1
    if (length < 2) return []
    entry.controller = new AbortController()
    const signal = entry.controller.signal
    const from = Math.max(0, Math.min(length - 1, Math.floor(request.from ?? 0)))
    const to = Math.max(from, Math.min(length - 1, Math.floor(request.to ?? length - 1)))
    const frames: number[] = []
    for (let index = from; index <= to; index += 1) frames.push(index)

    const frameWidth = dataset.shape[dataset.axes.indexOf('x')] ?? 1
    const frameHeight = dataset.shape[dataset.axes.indexOf('y')] ?? 1
    const point = {
      x: Math.round(request.point?.x ?? (frameWidth - 1) / 2),
      y: Math.round(request.point?.y ?? (frameHeight - 1) / 2),
    }
    const transform = dataset.spatialTransform
    const zScale = transform.calibrated && transform.spacing[0] > 0 ? transform.spacing[2] / transform.spacing[0] : 1

    const readFrame = async (index: number): Promise<ImageBlock> => {
      const selection: SliceSelection = { ...request.selection, [axis]: index }
      const outcome = await this.engine.runRecipe(
        { dataset, storage: entry.storage, selection, signal, retainStepImages: false },
        request.recipe,
      )
      const failure = outcome.results.find((result) => result.status === 'error')
      if (failure?.error) throw new Error(failure.error)
      if (!outcome.image) throw new Error('Orthogonal Views 未取得像素')
      const block = outcome.image
      const channels = block.axes.indexOf('c')
      if (channels >= 0 && (block.shape[channels] ?? 1) > 1) {
        throw new Error('Orthogonal Views 暂不支持多通道数据，请先转换为灰度')
      }
      return block
    }

    const views = await orthogonalViews({ point, frames, readFrame, zScale, signal })
    const fingerprint = `orthogonal:${dataset.id}@${dataset.revision}:${axis}:${from}-${to}:${point.x},${point.y}/${zScale}`
    return [
      registerMemoryDataset(this.entries, {
        dtype: views.xz.dtype,
        axes: ['y', 'x'],
        shape: [...views.xz.shape],
        spatialTransform: dataset.spatialTransform,
        channels: dataset.channels,
        componentKind: 'scalar',
        metadata: { ...dataset.metadata, orthogonalView: 'xz', orthogonalPoint: `${point.x},${point.y}` },
        source: { kind: 'memory', name: `XZ ${point.y}`, format: 'memory', fingerprint: `${fingerprint}:xz` },
        buffer: views.xz.data,
      }),
      registerMemoryDataset(this.entries, {
        dtype: views.yz.dtype,
        axes: ['y', 'x'],
        shape: [...views.yz.shape],
        spatialTransform: dataset.spatialTransform,
        channels: dataset.channels,
        componentKind: 'scalar',
        metadata: { ...dataset.metadata, orthogonalView: 'yz', orthogonalPoint: `${point.x},${point.y}` },
        source: { kind: 'memory', name: `YZ ${point.x}`, format: 'memory', fingerprint: `${fingerprint}:yz` },
        buffer: views.yz.data,
      }),
    ]
  }

  /**
   * 逐页剖面（Plot XY Profile）：逐页取同一条剖面，并给出所有曲线的共用纵轴范围。
   *
   * `line` 给出时按线 / 折线采样；否则按 `roi` 的矩形取水平中线（与工作台既有的剖面口径一致）。
   */
  async stackProfiles(request: {
    datasetId: string
    recipe: Recipe
    selection: SliceSelection
    roi?: Region
    line?: { points: number[]; closed?: boolean }
    axis?: 'z' | 't' | 'c'
  }): Promise<StackProfilesResult | undefined> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    const dataset = entry.dataset
    const axis = request.axis ?? defaultSliceAxis(dataset)
    if (!axis) return undefined
    const length = dataset.shape[dataset.axes.indexOf(axis)] ?? 1
    entry.controller = new AbortController()
    const signal = entry.controller.signal

    const xIndex = dataset.axes.indexOf('x')
    const yIndex = dataset.axes.indexOf('y')
    const sampleInput: RoiInput | null = request.line && request.line.points.length >= 4
      ? pointsRoi(request.line.closed ? 'polygon' : 'polyline', request.line.points)
      : request.roi
        ? {
            x: request.roi.start[xIndex] ?? 0,
            y: request.roi.start[yIndex] ?? 0,
            width: request.roi.shape[xIndex] ?? 1,
            height: request.roi.shape[yIndex] ?? 1,
          }
        : null

    return computeStackProfiles({
      frameCount: length,
      axis,
      signal,
      sample: (block) => profileBlock(block, sampleInput),
      readFrame: async (index) => {
        const selection: SliceSelection = { ...request.selection, [axis]: index }
        const outcome = await this.engine.runRecipe(
          { dataset, storage: entry.storage, selection, roi: request.roi, signal, retainStepImages: false },
          request.recipe,
        )
        const failure = outcome.results.find((result) => result.status === 'error')
        if (failure?.error) throw new Error(failure.error)
        if (!outcome.image) throw new Error('逐页剖面未取得像素')
        return outcome.image
      },
    })
  }

  /**
   * 栈结构编辑：Reverse / Reduce / Make Substack / Delete Slice / Add Slice。
   *
   * 这些命令只换一组页、不重算像素，因此结果数据集用 `PageMapStorage` 做**页映射**，
   * 像素仍按需从源读取（Add Slice 插入的空白页由 `'blank'` 标记表示）。
   */
  async restructure(request: {
    datasetId: string
    op: 'reverse' | 'reduce' | 'substack' | 'delete' | 'add'
    /** reduce 的步长。 */
    factor?: number
    /** substack 要保留的页；delete 要移除的页（均为 0-based）。 */
    pages?: number[]
    /** add 的插入位置（该页之前）与页数。 */
    at?: number
    count?: number
    title?: string
  }): Promise<Dataset | undefined> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    const dataset = entry.dataset
    const axis = plainSliceAxis(dataset)
    if (!axis) return undefined
    const axisIndex = dataset.axes.indexOf(axis)
    const length = dataset.shape[axisIndex] ?? 1
    const indexList = Array.from({ length }, (_, index) => index)

    let pages: PageRef[]
    let label: string
    switch (request.op) {
      case 'reverse':
        pages = [...indexList].reverse()
        label = 'reversed'
        break
      case 'reduce': {
        const factor = Math.max(1, Math.floor(request.factor ?? 2))
        pages = indexList.filter((index) => index % factor === 0)
        label = `reduced x${factor}`
        break
      }
      case 'substack': {
        const wanted = (request.pages ?? []).filter((index) => Number.isInteger(index) && index >= 0 && index < length)
        if (wanted.length === 0) throw new Error('子栈至少要保留一页')
        pages = wanted
        label = `substack ${wanted.length} pages`
        break
      }
      case 'delete': {
        const remove = new Set((request.pages ?? []).filter((index) => Number.isInteger(index) && index >= 0 && index < length))
        if (remove.size === 0) throw new Error('没有要删除的切片')
        if (remove.size >= length) throw new Error('不能删除全部切片')
        pages = indexList.filter((index) => !remove.has(index))
        label = `deleted ${remove.size} slice`
        break
      }
      case 'add': {
        const at = Math.max(0, Math.min(length, Math.floor(request.at ?? length)))
        const count = Math.max(1, Math.floor(request.count ?? 1))
        pages = [
          ...indexList.slice(0, at),
          ...Array.from({ length: count }, () => 'blank' as const),
          ...indexList.slice(at),
        ]
        label = `added ${count} slice`
        break
      }
    }

    const shape = [...dataset.shape]
    shape[axisIndex] = pages.length
    return registerMappedDataset(this.entries, {
      source: entry.storage,
      sourceDataset: dataset,
      pages,
      sliceAxis: axisIndex,
      shape,
      name: request.title?.trim() || `${dataset.source.name} (${label})`,
      fingerprint: `restructure:${dataset.id}@${dataset.revision}:${request.op}:${request.factor ?? ''}:${(request.pages ?? []).join('.')}:${request.at ?? ''}:${request.count ?? ''}`,
      metadata: { ...dataset.metadata, restructure: request.op },
    })
  }

  /**
   * 跨数据集的页合成：Insert / Combine / Concatenate。
   *
   * 三者都产出**新数据集**（本项目不原地改写文档）；主数据集走请求里的 Recipe，
   * 另一个数据集按源像素读取（跨文档取对方的处理链需要额外的信息，见移植文档 §4.14）。
   */
  async combine(request: {
    op: 'insert' | 'combine' | 'concatenate'
    datasetId: string
    recipe?: Recipe
    /** concatenate 的数据集列表（按顺序，含主数据集）。 */
    datasetIds?: string[]
    /** insert / combine 的另一个数据集。 */
    otherDatasetId?: string
    x?: number
    y?: number
    vertical?: boolean
    title?: string
  }): Promise<Dataset | undefined> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    entry.controller = new AbortController()
    const signal = entry.controller.signal

    const readPage = async (datasetId: string, selection: SliceSelection, recipe?: Recipe): Promise<ImageBlock> => {
      const target = this.entries.get(datasetId)
      if (!target) throw new Error(`未知数据集 ${datasetId}`)
      const outcome = await this.engine.runRecipe(
        { dataset: target.dataset, storage: target.storage, selection, signal, retainStepImages: false },
        recipe ?? createRecipe(target.dataset.id, target.dataset.revision),
      )
      const failure = outcome.results.find((result) => result.status === 'error')
      if (failure?.error) throw new Error(failure.error)
      if (!outcome.image) throw new Error('页合成未取得像素')
      return outcome.image
    }

    const pagesOf = (datasetId: string): number => {
      const target = this.entries.get(datasetId)
      if (!target) throw new Error(`未知数据集 ${datasetId}`)
      const axis = plainSliceAxis(target.dataset)
      return axis ? target.dataset.shape[target.dataset.axes.indexOf(axis)] ?? 1 : 1
    }
    const selectionFor = (datasetId: string, page: number): SliceSelection => {
      const target = this.entries.get(datasetId)!
      const axis = plainSliceAxis(target.dataset)
      return axis ? { [axis]: page } : {}
    }

    /** 把若干「页」规约成同一几何并组装成一个 z 栈数据集。 */
    const assemble = (blocks: ImageBlock[], name: string, fingerprint: string, metadata: Record<string, string | number | boolean>): Dataset => {
      const first = blocks[0]!
      const geometry = pageGeometry(first)
      const planeLength = geometry.width * geometry.height
      const channels = geometry.planes > 1 ? geometry.planes : 0
      const axes: AxisName[] = channels > 0 ? ['c', 'z', 'y', 'x'] : ['z', 'y', 'x']
      const shape = channels > 0
        ? [channels, blocks.length, geometry.height, geometry.width]
        : [blocks.length, geometry.height, geometry.width]
      const buffer = allocateBuffer(first.dtype, elementCount(shape))
      const destination = numberView(buffer)
      for (let page = 0; page < blocks.length; page += 1) {
        const source = numberView(blocks[page]!.data)
        for (let plane = 0; plane < geometry.planes; plane += 1) {
          const target = (plane * blocks.length + page) * planeLength
          const from = plane * planeLength
          for (let i = 0; i < planeLength; i += 1) destination[target + i] = source[from + i]!
        }
      }
      return registerMemoryDataset(this.entries, {
        dtype: first.dtype,
        axes,
        shape,
        spatialTransform: entry.dataset.spatialTransform,
        channels: entry.dataset.channels,
        componentKind: channels > 0 ? 'rgb' : 'scalar',
        metadata: { ...entry.dataset.metadata, ...metadata },
        source: { kind: 'memory', name: name, format: 'memory', fingerprint: fingerprint },
        buffer,
      })
    }

    if (request.op === 'insert') {
      const sourceId = request.otherDatasetId
      if (!sourceId) throw new Error('Insert 需要指定源数据集')
      const targetPages = pagesOf(request.datasetId)
      const sourcePages = pagesOf(sourceId)
      const blocks: ImageBlock[] = []
      for (let page = 0; page < targetPages; page += 1) {
        const target = await readPage(request.datasetId, selectionFor(request.datasetId, page), request.recipe)
        // 源页数不足时重复使用最后一页，与 ImageJ 的 min(i, size1) 一致。
        const source = await readPage(sourceId, selectionFor(sourceId, Math.min(page, sourcePages - 1)))
        const targetGeometry = pageGeometry(target)
        const sourceGeometry = pageGeometry(source)
        const buffer = target.data.slice()
        blitPage(buffer, targetGeometry, source.data, sourceGeometry, request.x ?? 0, request.y ?? 0)
        blocks.push({ ...target, data: buffer })
      }
      return assemble(blocks, request.title?.trim() || `${entry.dataset.source.name} + insert`, `insert:${request.datasetId}+${sourceId}@${request.x ?? 0},${request.y ?? 0}`, { combineOp: 'insert' })
    }

    if (request.op === 'combine') {
      const otherId = request.otherDatasetId
      if (!otherId) throw new Error('Combine 需要指定第二个数据集')
      const firstPages = pagesOf(request.datasetId)
      const secondPages = pagesOf(otherId)
      const vertical = Boolean(request.vertical)
      const blocks: ImageBlock[] = []
      for (let page = 0; page < Math.max(firstPages, secondPages); page += 1) {
        const first = page < firstPages ? await readPage(request.datasetId, selectionFor(request.datasetId, page), request.recipe) : null
        const second = page < secondPages ? await readPage(otherId, selectionFor(otherId, page)) : null
        const firstGeometry = first ? pageGeometry(first) : null
        const secondGeometry = second ? pageGeometry(second) : null
        const geometry: PageGeometry = vertical
          ? {
              width: Math.max(firstGeometry?.width ?? 0, secondGeometry?.width ?? 0),
              height: (firstGeometry?.height ?? 0) + (secondGeometry?.height ?? 0),
              planes: Math.max(firstGeometry?.planes ?? 1, secondGeometry?.planes ?? 1),
            }
          : {
              width: (firstGeometry?.width ?? 0) + (secondGeometry?.width ?? 0),
              height: Math.max(firstGeometry?.height ?? 0, secondGeometry?.height ?? 0),
              planes: Math.max(firstGeometry?.planes ?? 1, secondGeometry?.planes ?? 1),
            }
        const buffer = emptyBuffer((first ?? second)!.dtype, geometry)
        if (first && firstGeometry) blitPage(buffer, geometry, first.data, firstGeometry, 0, 0)
        if (second && secondGeometry) {
          blitPage(buffer, geometry, second.data, secondGeometry, vertical ? 0 : firstGeometry?.width ?? 0, vertical ? firstGeometry?.height ?? 0 : 0)
        }
        blocks.push({
          dtype: (first ?? second)!.dtype,
          // 临时块的 axes / shape / region 必须自洽：`pageGeometry` 依赖它们推导平面数。
          axes: geometry.planes > 1 ? ['c', 'y', 'x'] as const : ['y', 'x'] as const,
          shape: geometry.planes > 1 ? [geometry.planes, geometry.height, geometry.width] : [geometry.height, geometry.width],
          region: {
            start: geometry.planes > 1 ? [0, 0, 0] : [0, 0],
            shape: geometry.planes > 1 ? [geometry.planes, geometry.height, geometry.width] : [geometry.height, geometry.width],
          },
          data: buffer,
        })
      }
      return assemble(blocks, request.title?.trim() || 'Combined Stacks', `combine:${request.datasetId}+${otherId}@${vertical ? 'v' : 'h'}`, { combineOp: 'combine' })
    }

    const ids = request.datasetIds ?? []
    if (ids.length < 2) throw new Error('拼接至少需要两个数据集')
    // 各栈尺寸不同时，较小的页居中放到最大画布上（ImageJ 的 Concatenator 行为）。
    const canvas = ids.reduce((size, id) => {
      const target = this.entries.get(id)
      if (!target) throw new Error(`未知数据集 ${id}`)
      const width = target.dataset.shape[target.dataset.axes.indexOf('x')] ?? 1
      const height = target.dataset.shape[target.dataset.axes.indexOf('y')] ?? 1
      return { width: Math.max(size.width, width), height: Math.max(size.height, height) }
    }, { width: 1, height: 1 })

    const blocks: ImageBlock[] = []
    for (const id of ids) {
      const count = pagesOf(id)
      for (let page = 0; page < count; page += 1) {
        const block = await readPage(id, selectionFor(id, page), id === request.datasetId ? request.recipe : undefined)
        const geometry = pageGeometry(block)
        if (geometry.width === canvas.width && geometry.height === canvas.height) {
          blocks.push(block)
          continue
        }
        const target: PageGeometry = { ...canvas, planes: geometry.planes }
        const buffer = emptyBuffer(block.dtype, target)
        blitPage(buffer, target, block.data, geometry, Math.floor((canvas.width - geometry.width) / 2), Math.floor((canvas.height - geometry.height) / 2))
        blocks.push({
          dtype: block.dtype,
          axes: geometry.planes > 1 ? ['c', 'y', 'x'] as const : ['y', 'x'] as const,
          shape: geometry.planes > 1 ? [geometry.planes, canvas.height, canvas.width] : [canvas.height, canvas.width],
          region: {
            start: geometry.planes > 1 ? [0, 0, 0] : [0, 0],
            shape: geometry.planes > 1 ? [geometry.planes, canvas.height, canvas.width] : [canvas.height, canvas.width],
          },
          data: buffer,
        })
      }
    }
    return assemble(blocks, request.title?.trim() || 'Concatenated Stacks', `concat:${ids.join('+')}`, { combineOp: 'concatenate' })
  }

  /**
   * Label...：在指定切片范围内的每一页上标注文本。
   *
   * 文本由 `formatSliceLabel` 生成、字形由内置点阵绘制（`engine/textRaster.ts`）——
   * 不依赖 Canvas，因此在浏览器与测试环境里行为一致。范围之外的页原样保留。
   */
  async labelStack(request: {
    datasetId: string
    recipe?: Recipe
    selection?: SliceSelection
    format: SliceLabelFormat
    start?: number
    interval?: number
    text?: string
    /** 数字格式的锚点 X（右对齐到 x + 最长文本宽度）；Label 格式直接用该 X。 */
    x?: number
    y?: number
    fontSize?: number
    /** 要标注的页区间（0-based，含两端）；缺省为全部。 */
    from?: number
    to?: number
    color?: number
    /** `format = 'label'` 时各页的标签（来自运行时的页标签）。 */
    sliceLabels?: string[]
    title?: string
  }): Promise<Dataset | undefined> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    const dataset = entry.dataset
    const axis = plainSliceAxis(dataset)
    if (!axis) return undefined
    const axisIndex = dataset.axes.indexOf(axis)
    const length = dataset.shape[axisIndex] ?? 1
    entry.controller = new AbortController()
    const signal = entry.controller.signal
    const from = Math.max(0, Math.min(length - 1, Math.floor(request.from ?? 0)))
    const to = Math.max(from, Math.min(length - 1, Math.floor(request.to ?? length - 1)))
    const fontSize = Math.max(1, Math.floor(request.fontSize ?? 18))
    const pad = padWidthFor(length)
    const labels = request.sliceLabels ?? []

    const textAt = (index: number): string => formatSliceLabel({
      format: request.format,
      index,
      start: request.start ?? 0,
      interval: request.interval ?? 1,
      text: request.text,
      pad,
      sliceLabel: labels[index],
    })
    // 数字格式右对齐到 `x + maxWidth`，因此先算范围内最长的一条。
    let maxWidth = 0
    for (let index = from; index <= to; index += 1) maxWidth = Math.max(maxWidth, textWidth(textAt(index), fontSize))

    const blocks: ImageBlock[] = []
    for (let index = 0; index < length; index += 1) {
      const selection: SliceSelection = { ...request.selection, [axis]: index }
      const outcome = await this.engine.runRecipe(
        { dataset, storage: entry.storage, selection, signal, retainStepImages: false },
        request.recipe ?? createRecipe(dataset.id, dataset.revision),
      )
      const failure = outcome.results.find((result) => result.status === 'error')
      if (failure?.error) throw new Error(failure.error)
      if (!outcome.image) throw new Error('Label 未取得像素')
      const block = outcome.image
      const buffer = block.data.slice()
      const text = textAt(index)
      if (index >= from && index <= to && text) {
        const geometry = pageGeometry(block)
        const anchorX = request.x ?? 5
        const x = request.format === 'label' ? anchorX : anchorX + maxWidth - textWidth(text, fontSize)
        drawText(
          { data: buffer, width: geometry.width, height: geometry.height, planes: geometry.planes },
          text,
          x,
          request.y ?? 20,
          { fontSize, color: request.color ?? defaultLabelColor(block.dtype) },
        )
      }
      blocks.push({ ...block, data: buffer })
    }

    const assembled = assembleFrameStack(blocks)
    return registerMemoryDataset(this.entries, {
      dtype: blocks[0]!.dtype,
      axes: assembled.axes,
      shape: assembled.shape,
      spatialTransform: dataset.spatialTransform,
      timeCalibration: dataset.timeCalibration,
      channels: dataset.channels,
      componentKind: dataset.componentKind,
      metadata: { ...dataset.metadata, labelFormat: request.format, labelRange: `${from + 1}-${to + 1}` },
      source: {
        kind: 'memory',
        name: request.title?.trim() || `${dataset.source.name} labelled`,
        format: 'memory',
        fingerprint: `label:${dataset.id}@${dataset.revision}:${request.format}:${from}-${to}:${fontSize}:${request.x ?? 5},${request.y ?? 20}:${request.text ?? ''}`,
      },
      buffer: assembled.data,
    })
  }

  /**
   * 3D Project：绕指定轴逐角度旋转投影，每个角度产出一页。
   *
   * 切片间距取 `pixelDepth / pixelWidth`（未标定时为 1），与 ImageJ 的 Slice spacing 一致。
   */
  async project3d(request: {
    datasetId: string
    recipe?: Recipe
    selection?: SliceSelection
    method: Projection3dMethod
    axis: Projection3dAxis
    initialAngle?: number
    totalRotation?: number
    angleIncrement?: number
    opacity?: number
    surfaceCueing?: number
    interiorCueing?: number
    from?: number
    to?: number
    title?: string
  }): Promise<Dataset | undefined> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    const dataset = entry.dataset
    const axis = plainSliceAxis(dataset)
    if (!axis) return undefined
    const axisIndex = dataset.axes.indexOf(axis)
    const length = dataset.shape[axisIndex] ?? 1
    entry.controller = new AbortController()
    const signal = entry.controller.signal
    const from = Math.max(0, Math.min(length - 1, Math.floor(request.from ?? 0)))
    const to = Math.max(from, Math.min(length - 1, Math.floor(request.to ?? length - 1)))
    const frames: number[] = []
    for (let index = from; index <= to; index += 1) frames.push(index)

    const readFrame = async (index: number): Promise<ImageBlock> => {
      const selection: SliceSelection = { ...request.selection, [axis]: index }
      const outcome = await this.engine.runRecipe(
        { dataset, storage: entry.storage, selection, signal, retainStepImages: false },
        request.recipe ?? createRecipe(dataset.id, dataset.revision),
      )
      const failure = outcome.results.find((result) => result.status === 'error')
      if (failure?.error) throw new Error(failure.error)
      if (!outcome.image) throw new Error('3D Project 未取得像素')
      return outcome.image
    }

    const transform = dataset.spatialTransform
    const sliceInterval = transform.calibrated && transform.spacing[0] > 0 ? transform.spacing[2] / transform.spacing[0] : 1
    const pages = await project3d({
      method: request.method,
      axis: request.axis,
      initialAngle: request.initialAngle ?? 0,
      totalRotation: request.totalRotation ?? 360,
      angleIncrement: request.angleIncrement ?? 10,
      sliceInterval,
      opacity: request.opacity ?? 0,
      surfaceCueing: request.surfaceCueing ?? 100,
      interiorCueing: request.interiorCueing ?? 50,
      frames,
      readFrame,
      signal,
    })

    const assembled = assembleFrameStack(pages)
    return registerMemoryDataset(this.entries, {
      dtype: pages[0]!.dtype,
      axes: assembled.axes,
      shape: assembled.shape,
      spatialTransform: dataset.spatialTransform,
      channels: dataset.channels,
      componentKind: dataset.componentKind,
      metadata: {
        ...dataset.metadata,
        projection3dMethod: request.method,
        projection3dAxis: request.axis,
        projection3dAngles: pages.length,
      },
      source: {
        kind: 'memory',
        name: request.title?.trim() || `Projections of ${dataset.source.name}`,
        format: 'memory',
        fingerprint: `project3d:${dataset.id}@${dataset.revision}:${request.method}:${request.axis}:${from}-${to}:${request.initialAngle ?? 0}+${request.totalRotation ?? 360}/${request.angleIncrement ?? 10}`,
      },
      buffer: assembled.data,
    })
  }

  /**
   * 重排蒙太奇（Image ▸ Stacks ▸ Tools ▸ Magic Montage Tools 的核心动作）。
   *
   * 先把源蒙太奇按它自己的行列拆成页，再按新的行列重拼；结果仍是一张蒙太奇图，
   * 并把新的行列写进元数据，因此后续 Montage to Stack 会沿用新布局。
   */
  async remontage(request: {
    datasetId: string
    recipe?: Recipe
    selection?: SliceSelection
    columns: number
    rows: number
    sourceColumns?: number
    sourceRows?: number
    borderWidth?: number
    labelSlices?: boolean
    fontSize?: number
    title?: string
  }): Promise<Dataset | undefined> {
    const entry = this.entries.get(request.datasetId)
    if (!entry) throw new Error(`未知数据集 ${request.datasetId}`)
    const dataset = entry.dataset
    entry.controller = new AbortController()
    const signal = entry.controller.signal
    const outcome = await this.engine.runRecipe(
      { dataset, storage: entry.storage, selection: { ...request.selection }, signal, retainStepImages: false },
      request.recipe ?? createRecipe(dataset.id, dataset.revision),
    )
    const failure = outcome.results.find((result) => result.status === 'error')
    if (failure?.error) throw new Error(failure.error)
    if (!outcome.image) throw new Error('重排蒙太奇未取得像素')

    const declaredColumns = Number(dataset.metadata.montageColumns ?? 2)
    const declaredRows = Number(dataset.metadata.montageRows ?? 2)
    const sourceColumns = Math.max(1, Math.floor(request.sourceColumns && request.sourceColumns > 0
      ? request.sourceColumns
      : Number.isFinite(declaredColumns) && declaredColumns > 0 ? declaredColumns : 2))
    const sourceRows = Math.max(1, Math.floor(request.sourceRows && request.sourceRows > 0
      ? request.sourceRows
      : Number.isFinite(declaredRows) && declaredRows > 0 ? declaredRows : 2))
    const borderWidth = Math.max(0, Math.floor(request.borderWidth ?? 0))
    const columns = Math.max(1, Math.floor(request.columns))
    const rows = Math.max(1, Math.floor(request.rows))

    const pages = splitMontage(outcome.image, { columns: sourceColumns, rows: sourceRows, borderWidth })
    const montaged = await makeMontage({
      columns,
      rows,
      scale: 1,
      borderWidth,
      frames: pages.map((_, index) => index),
      readFrame: async (index) => pages[index]!,
      firstBlock: pages[0],
      labelSlices: Boolean(request.labelSlices),
      fontSize: request.fontSize,
      signal,
    })

    return registerMemoryDataset(this.entries, {
      dtype: montaged.dtype,
      axes: [...montaged.axes] as AxisName[],
      shape: [...montaged.shape],
      spatialTransform: dataset.spatialTransform,
      timeCalibration: dataset.timeCalibration,
      channels: dataset.channels,
      componentKind: montaged.axes.includes('c') ? 'rgb' : 'scalar',
      metadata: {
        ...dataset.metadata,
        montageColumns: columns,
        montageRows: rows,
        montageBorderWidth: borderWidth,
      },
      source: {
        kind: 'memory',
        name: request.title?.trim() || `${dataset.source.name} ${columns}x${rows}`,
        format: 'memory',
        fingerprint: `remontage:${dataset.id}@${dataset.revision}:${sourceColumns}x${sourceRows}->${columns}x${rows}/${borderWidth}`,
      },
      buffer: montaged.data,
    })
  }

  cancel(): void {
    for (const entry of this.entries.values()) entry.controller.abort()
  }

  dispose(datasetId?: string): void {
    if (datasetId) {
      this.entries.get(datasetId)?.storage.release()
      this.entries.delete(datasetId)
      return
    }
    for (const entry of this.entries.values()) entry.storage.release()
    this.entries.clear()
  }
}

/** 把若干页组装成一块 z 栈缓冲（多平面时按 `[c][z][y][x]` 交错）。 */
function assembleFrameStack(blocks: readonly ImageBlock[]): { data: PixelArray; axes: AxisName[]; shape: number[] } {
  const first = blocks[0]!
  const geometry = pageGeometry(first)
  const planeLength = geometry.width * geometry.height
  const channels = geometry.planes > 1 ? geometry.planes : 0
  const axes: AxisName[] = channels > 0 ? ['c', 'z', 'y', 'x'] : ['z', 'y', 'x']
  const shape = channels > 0
    ? [channels, blocks.length, geometry.height, geometry.width]
    : [blocks.length, geometry.height, geometry.width]
  const buffer = allocateBuffer(first.dtype, elementCount(shape))
  const destination = numberView(buffer)
  for (let page = 0; page < blocks.length; page += 1) {
    const source = numberView(blocks[page]!.data)
    for (let plane = 0; plane < geometry.planes; plane += 1) {
      const target = (plane * blocks.length + page) * planeLength
      const from = plane * planeLength
      for (let i = 0; i < planeLength; i += 1) destination[target + i] = source[from + i]!
    }
  }
  return { data: buffer, axes, shape }
}


/**
 * 用页映射注册一个新数据集：像素不复制，仍从源 Storage 按需读取。
 *
 * 与 `registerMemoryDataset` 的区别是它不持有像素缓冲 —— 因此可以零成本地改变页数
 * （逆序、抽取、插空白页），这正是结构编辑类命令需要的。
 */
function registerMappedDataset(entries: Map<string, Entry>, input: {
  source: Storage
  sourceDataset: Dataset
  pages: readonly PageRef[]
  sliceAxis: number
  shape: number[]
  name: string
  fingerprint: string
  metadata: Readonly<Record<string, string | number | boolean>>
}): Dataset {
  const source: SourceRef = { kind: 'memory', name: input.name, format: 'memory', fingerprint: input.fingerprint }
  const dataset = createDataset({
    dtype: input.sourceDataset.dtype,
    axes: input.sourceDataset.axes,
    shape: input.shape,
    spatialTransform: input.sourceDataset.spatialTransform,
    timeCalibration: input.sourceDataset.timeCalibration,
    channels: input.sourceDataset.channels,
    componentKind: input.sourceDataset.componentKind,
    metadata: input.metadata,
    source,
  })
  const storage = new PageMapStorage(dataset.id, {
    dtype: dataset.dtype,
    axes: dataset.axes,
    shape: dataset.shape,
    spatialTransform: dataset.spatialTransform,
    timeCalibration: dataset.timeCalibration,
    channels: dataset.channels,
    metadata: input.metadata,
    source,
  }, input.source, input.pages, input.sliceAxis)
  entries.set(dataset.id, { dataset, storage, controller: new AbortController() })
  return dataset
}

/** 切片轴：z 优先，其次 t，最后非 RGB 的 c；不要求长度大于 1（Add Slice 要能作用于单页栈）。 */
function plainSliceAxis(dataset: Dataset): 'z' | 't' | 'c' | undefined {
  return (['z', 't', 'c'] as const).find((axis) =>
    dataset.axes.includes(axis) && !(axis === 'c' && dataset.componentKind === 'rgb'))
}

/**
 * 用一块内存像素注册一个新数据集。
 *
 * 「产出新图」的命令（Z 投影、Make Montage）共用这一条路径：先建 Dataset 元信息，
 * 再用同一份元信息建 `MemoryStorage`，最后登记进宿主的数据集表。
 */
function registerMemoryDataset(entries: Map<string, Entry>, input: {
  dtype: Dtype
  axes: AxisName[]
  shape: number[]
  spatialTransform: SpatialTransform
  timeCalibration?: TimeCalibration
  channels: readonly ChannelInfo[]
  componentKind: 'scalar' | 'rgb'
  metadata: Readonly<Record<string, string | number | boolean>>
  source: SourceRef
  buffer: PixelArray
}): Dataset {
  const dataset = createDataset({
    dtype: input.dtype,
    axes: input.axes,
    shape: input.shape,
    spatialTransform: input.spatialTransform,
    timeCalibration: input.timeCalibration,
    channels: input.channels,
    componentKind: input.componentKind,
    metadata: input.metadata,
    source: input.source,
  })
  const storage = new MemoryStorage(dataset.id, {
    dtype: dataset.dtype,
    axes: dataset.axes,
    shape: dataset.shape,
    spatialTransform: dataset.spatialTransform,
    timeCalibration: dataset.timeCalibration,
    channels: dataset.channels,
    metadata: input.metadata,
    source: input.source,
  }, input.buffer)
  entries.set(dataset.id, { dataset, storage, controller: new AbortController() })
  return dataset
}

/** 结果标题前缀，与 ImageJ 的 `ZProjector.makeTitle`（`:606-616`）一致。 */
const METHOD_PREFIX: Record<ProjectionMethod, string> = {
  average: 'AVG_',
  max: 'MAX_',
  min: 'MIN_',
  sum: 'SUM_',
  sd: 'STD_',
  median: 'MED_',
}

/** 行优先布局下每一维的步长。 */
function shapeStrides(shape: readonly number[]): number[] {
  const strides = new Array<number>(shape.length).fill(1)
  let stride = 1
  for (let index = shape.length - 1; index >= 0; index -= 1) {
    strides[index] = stride
    stride *= shape[index] ?? 1
  }
  return strides
}

/** 以 number 读写 TypedArray：联合类型的索引赋值在 TS 下需要这一层转换。 */
function numberView(view: PixelArray): { [index: number]: number } {
  return view as unknown as { [index: number]: number }
}

/** 可遍历的切片轴：z 优先，其次 t，最后非 RGB 的 c；要求长度大于 1。 */
function defaultSliceAxis(dataset: Dataset): 'z' | 't' | 'c' | undefined {
  return (['z', 't', 'c'] as const).find((axis) =>
    !(axis === 'c' && dataset.componentKind === 'rgb')
    && (dataset.shape[dataset.axes.indexOf(axis)] ?? 1) > 1)
}

/**
 * 切片轴横轴的标定。
 *
 * 未标定（或标定值退化为占位值）时返回 undefined，由内核退化为「从 1 开始、间距 1」，
 * 与 ImageJ 的 `ZAxisProfiler` 在未校准时的 origin=-1、calFactor=1 一致。
 */
function sliceCalibration(dataset: Dataset, axis: 'z' | 't' | 'c'): StackStatsCalibration | undefined {
  if (axis === 't') {
    const interval = dataset.timeCalibration?.interval
    if (!interval || !Number.isFinite(interval) || interval <= 0) return undefined
    return { spacing: interval, origin: 0, unit: dataset.timeCalibration?.unit ?? '' }
  }
  const transform = dataset.spatialTransform
  if (!transform.calibrated) return undefined
  const spacing = axis === 'z' ? transform.spacing[2] : transform.spacing[0]
  if (!Number.isFinite(spacing) || spacing <= 0) return undefined
  return { spacing, origin: 0, unit: transform.unit }
}
