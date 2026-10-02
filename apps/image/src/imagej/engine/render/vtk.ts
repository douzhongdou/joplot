/**
 * VTK.js 二维视口适配层（对应架构方案第 8 节）。
 *
 * - 使用 vtkGenericRenderWindow + vtkImageMapper + vtkImageSlice 复用渲染资源；
 * - 翻页只更新输入数据与切片，不重建整个视口；
 * - 相机强制正交、正对图像平面，交互使用 InteractorStyleImage（只缩放/平移，不做 3D 旋转）；
 * - 单通道默认最近邻；多分量（RGB）默认线性以正常显示照片；
 * - 窗宽窗位只改变屏幕颜色，不回写像素。
 *
 * VTK.js 使用 `vtk.js/Sources/...` 深层导入，且依赖 WebGL，只应在浏览器端动态载入。
 */
import type { ImageBlock } from '../types.ts'

export type Interpolation = 'nearest' | 'linear'

export interface WindowLevel {
  window: number
  level: number
}

export interface VtkImageView {
  /** 用像素块更新当前显示（保持视口与相机）。 */
  setBlock(block: ImageBlock): void
  /** 由 itk-wasm Image 更新显示（经 ITKHelper 转换）。 */
  setItkImage(itkImage: unknown): void
  setWindowLevel(settings: WindowLevel): void
  setInterpolation(mode: Interpolation): void
  setSlice(index: number): void
  setSlicingAxis(axis: 'i' | 'j' | 'k'): void
  /** 重新适应容器尺寸并把相机复位为正视图。 */
  resize(): void
  /** 释放 WebGL 资源。 */
  destroy(): void
}

interface VtkModules {
  GenericRenderWindow: { newInstance(initialValues?: unknown): VtkRenderWindowLike }
  ImageMapper: { newInstance(initialValues?: unknown): VtkMapperLike }
  ImageSlice: { newInstance(initialValues?: unknown): VtkImageSliceLike }
  ImageData: VtkImageDataStatic
  DataArray: { newInstance(initialValues?: unknown): unknown }
  SlicingMode: { I: number; J: number; K: number }
  InteractorStyleImage: { newInstance(): unknown }
  ITKHelper: { convertItkToVtkImage(itkImage: unknown): unknown }
}

interface VtkRenderWindowLike {
  setContainer(element: HTMLElement): void
  getRenderer(): VtkRendererLike
  getInteractor?(): VtkInteractorLike
  getRenderWindow?(): { render(): void }
  resize(): void
  delete(): void
}
interface VtkInteractorLike {
  setInteractorStyle(style: unknown): void
}
interface VtkRendererLike {
  addActor(actor: unknown): void
  removeActor(actor: unknown): void
  resetCamera(): void
  resetCameraClippingRange(): void
  getActiveCamera(): VtkCameraLike
}
interface VtkCameraLike {
  setParallelProjection(value: boolean): unknown
  setViewUp(x: number, y: number, z: number): unknown
  setFocalPoint(x: number, y: number, z: number): unknown
  setPosition(x: number, y: number, z: number): unknown
  getFocalPoint(): number[]
  getDistance(): number
}
interface VtkMapperLike {
  setInputData(data: unknown): void
  setSlicingMode(mode: number): void
  setSlice(slice: number): number
  delete(): void
}
interface VtkImageSliceLike {
  setMapper(mapper: unknown): void
  getProperty(): VtkImagePropertyLike
  delete(): void
}
interface VtkImagePropertyLike {
  setInterpolationTypeToNearest(): void
  setInterpolationTypeToLinear(): void
  setColorWindow(window: number): boolean
  setColorLevel(level: number): boolean
}
interface VtkImageDataStatic {
  newInstance(initialValues?: unknown): VtkImageDataLike
}
interface VtkImageDataLike {
  setDimensions(dimensions: number[]): void
  setSpacing(spacing: number[]): void
  setOrigin(origin: number[]): void
  getPointData(): { setScalars(array: unknown): void }
}

async function loadModules(): Promise<VtkModules> {
  // 必须先注册渲染 profile，否则 vtkRenderer 找不到 OpenGL 视图节点工厂。
  await import('vtk.js/Sources/Rendering/Profiles/All')
  const [genericRenderWindow, imageMapper, mapperConstants, imageSlice, imageData, dataArray, interactorStyleImage, itkHelper] = await Promise.all([
    import('vtk.js/Sources/Rendering/Misc/GenericRenderWindow'),
    import('vtk.js/Sources/Rendering/Core/ImageMapper'),
    import('vtk.js/Sources/Rendering/Core/ImageMapper/Constants'),
    import('vtk.js/Sources/Rendering/Core/ImageSlice'),
    import('vtk.js/Sources/Common/DataModel/ImageData'),
    import('vtk.js/Sources/Common/Core/DataArray'),
    import('vtk.js/Sources/Interaction/Style/InteractorStyleImage'),
    import('vtk.js/Sources/Common/DataModel/ITKHelper'),
  ])
  return {
    GenericRenderWindow: genericRenderWindow.default as unknown as VtkModules['GenericRenderWindow'],
    ImageMapper: imageMapper.default as unknown as VtkModules['ImageMapper'],
    ImageSlice: imageSlice.default as unknown as VtkModules['ImageSlice'],
    ImageData: imageData.default as unknown as VtkImageDataStatic,
    DataArray: dataArray.default as unknown as VtkModules['DataArray'],
    SlicingMode: mapperConstants.default.SlicingMode as unknown as VtkModules['SlicingMode'],
    InteractorStyleImage: interactorStyleImage.default as unknown as VtkModules['InteractorStyleImage'],
    ITKHelper: { convertItkToVtkImage: itkHelper.convertItkToVtkImage },
  }
}

/** 由像素块构造 vtkImageData；y 轴翻转以匹配「第 0 行在顶部」的屏幕约定。 */
export function blockToVtkImageData(modules: Pick<VtkModules, 'ImageData' | 'DataArray'>, block: ImageBlock): unknown {
  const x = block.axes.indexOf('x')
  const y = block.axes.indexOf('y')
  const c = block.axes.indexOf('c')
  const width = block.shape[x]!
  const height = block.shape[y]!
  const components = c >= 0 ? block.shape[c]! : 1
  const image = modules.ImageData.newInstance()
  image.setDimensions([width, height, 1])
  image.setSpacing([1, -1, 1])
  image.setOrigin([0, height - 1, 0])
  const scalars = modules.DataArray.newInstance({
    values: components === 1 ? block.data : interleaveComponents(block, components),
    numberOfComponents: components,
    name: 'scalars',
  })
  image.getPointData().setScalars(scalars)
  return image
}

/** 把平面通道（[c][y][x]）交织为 VTK 需要的逐点分量顺序。 */
function interleaveComponents(block: ImageBlock, components: number): ArrayBufferView {
  const x = block.axes.indexOf('x')
  const y = block.axes.indexOf('y')
  const pixels = block.shape[x]! * block.shape[y]!
  const source = block.data as unknown as { readonly [index: number]: number }
  const out = new Uint8Array(pixels * components)
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    for (let channel = 0; channel < components; channel += 1) {
      out[pixel * components + channel] = source[channel * pixels + pixel]!
    }
  }
  return out
}

function channelCount(block: ImageBlock): number {
  const c = block.axes.indexOf('c')
  return c >= 0 ? block.shape[c]! : 1
}

/** 创建二维图像视口。所有 VTK 依赖在这里延迟载入。 */
export async function createVtkImageView(
  container: HTMLElement,
  options?: { background?: [number, number, number]; initial?: WindowLevel },
): Promise<VtkImageView> {
  const modules = await loadModules()
  const genericRenderWindow = modules.GenericRenderWindow.newInstance({
    background: options?.background ?? [0, 0, 0],
    listenWindowResize: false,
  })
  genericRenderWindow.setContainer(container)
  genericRenderWindow.getInteractor?.().setInteractorStyle(modules.InteractorStyleImage.newInstance())
  const renderer = genericRenderWindow.getRenderer()
  const mapper = modules.ImageMapper.newInstance()
  mapper.setSlicingMode(modules.SlicingMode.K)
  const actor = modules.ImageSlice.newInstance()
  actor.setMapper(mapper)
  actor.getProperty().setInterpolationTypeToNearest()
  if (options?.initial) {
    actor.getProperty().setColorWindow(options.initial.window)
    actor.getProperty().setColorLevel(options.initial.level)
  }
  renderer.addActor(actor)

  const render = (): void => {
    genericRenderWindow.getRenderWindow?.()?.render()
  }

  /** 相机复位：正交投影、正对图像平面（viewUp +Y），避免出现 3D 倾斜。 */
  const resetFlatCamera = (): void => {
    renderer.resetCamera()
    const camera = renderer.getActiveCamera()
    camera.setParallelProjection(true)
    camera.setViewUp(0, 1, 0)
    const focal = camera.getFocalPoint()
    const distance = Math.abs(camera.getDistance()) || 1
    camera.setPosition(focal[0] ?? 0, focal[1] ?? 0, (focal[2] ?? 0) + distance)
    renderer.resetCameraClippingRange()
  }

  /** 让渲染窗口跟随容器尺寸；否则 VTK 会停留在默认 300×300 被 CSS 拉伸而发虚。 */
  const syncSize = (): void => {
    genericRenderWindow.resize()
    resetFlatCamera()
    render()
  }

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => syncSize())
  observer?.observe(container)
  // 容器在挂载后可能已有尺寸，立即同步一次。
  syncSize()

  return {
    setBlock(block) {
      mapper.setInputData(blockToVtkImageData(modules, block))
      mapper.setSlice(0)
      if (channelCount(block) > 1) actor.getProperty().setInterpolationTypeToLinear()
      else actor.getProperty().setInterpolationTypeToNearest()
      resetFlatCamera()
      render()
    },
    setItkImage(itkImage) {
      mapper.setInputData(modules.ITKHelper.convertItkToVtkImage(itkImage))
      mapper.setSlice(0)
      resetFlatCamera()
      render()
    },
    setWindowLevel(settings) {
      actor.getProperty().setColorWindow(settings.window)
      actor.getProperty().setColorLevel(settings.level)
      render()
    },
    setInterpolation(mode) {
      if (mode === 'linear') actor.getProperty().setInterpolationTypeToLinear()
      else actor.getProperty().setInterpolationTypeToNearest()
      render()
    },
    setSlice(index) {
      mapper.setSlice(index)
      render()
    },
    setSlicingAxis(axis) {
      mapper.setSlicingMode(modules.SlicingMode[axis.toUpperCase() as 'I' | 'J' | 'K'])
      render()
    },
    resize() {
      syncSize()
    },
    destroy() {
      observer?.disconnect()
      renderer.removeActor(actor)
      mapper.delete()
      actor.delete()
      genericRenderWindow.delete()
    },
  }
}
