/**
 * VTK.js 二维视口适配层（对应架构方案第 8 节）。
 *
 * - 使用 vtkGenericRenderWindow + vtkImageMapper + vtkActor 复用渲染资源；
 * - 翻页只更新输入数据与切片，不重建整个视口；
 * - 强制最近邻插值，禁止默认的线性混合；
 * - 窗宽窗位只改变屏幕颜色，不回写像素。
 *
 * VTK.js 使用 `vtk.js/Sources/...` 深层导入，且依赖 WebGL，只应在浏览器端动态载入。
 * 本模块不在模块顶层 import VTK，避免进入 SSR / Node 测试路径。
 */
import type { ImageBlock } from '../types.ts'

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
  setSlice(index: number): void
  setSlicingAxis(axis: 'i' | 'j' | 'k'): void
  /** 重新适应容器尺寸。 */
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
  ITKHelper: { convertItkToVtkImage(itkImage: unknown): unknown }
}

interface VtkRenderWindowLike {
  setContainer(element: HTMLElement): void
  getRenderer(): VtkRendererLike
  getRenderWindow?(): VtkRenderWindowCore
  resize(): void
  delete(): void
  render(): void
}

interface VtkRendererLike {
  addActor(actor: unknown): void
  removeActor(actor: unknown): void
  resetCamera(): void
  resetCameraClippingRange(): void
  getActiveCamera?(): { zoom(factor: number): void }
}

interface VtkRenderWindowCore {
  render(): void
}

interface VtkMapperLike {
  setInputData(data: unknown): void
  setSlicingMode(mode: number): void
  setSlice(slice: number): number
  getInputData(): unknown
  delete(): void
}

interface VtkImageSliceLike {
  setMapper(mapper: unknown): void
  getProperty(): VtkImagePropertyLike
  delete(): void
}
interface VtkImagePropertyLike {
  setInterpolationTypeToNearest(): void
  setColorWindow(window: number): boolean
  setColorLevel(level: number): boolean
}

interface VtkImageDataStatic {
  newInstance(initialValues?: unknown): VtkImageDataLike
  getData(): unknown
}
interface VtkImageDataLike {
  setDimensions(dimensions: number[]): void
  setSpacing(spacing: number[]): void
  setOrigin(origin: number[]): void
  getPointData(): { setScalars(array: unknown): void }
  delete?(): void
}

async function loadModules(): Promise<VtkModules> {
  // 必须先注册渲染 profile，否则 vtkRenderer 找不到 OpenGL 视图节点工厂。
  await import('vtk.js/Sources/Rendering/Profiles/All')
  const [genericRenderWindow, imageMapper, mapperConstants, actor, imageData, dataArray, itkHelper] = await Promise.all([
    import('vtk.js/Sources/Rendering/Misc/GenericRenderWindow'),
    import('vtk.js/Sources/Rendering/Core/ImageMapper'),
    import('vtk.js/Sources/Rendering/Core/ImageMapper/Constants'),
    import('vtk.js/Sources/Rendering/Core/ImageSlice'),
    import('vtk.js/Sources/Common/DataModel/ImageData'),
    import('vtk.js/Sources/Common/Core/DataArray'),
    import('vtk.js/Sources/Common/DataModel/ITKHelper'),
  ])
  return {
    GenericRenderWindow: genericRenderWindow.default as unknown as VtkModules['GenericRenderWindow'],
    ImageMapper: imageMapper.default as unknown as VtkModules['ImageMapper'],
    ImageSlice: actor.default as unknown as VtkModules['ImageSlice'],
    ImageData: imageData.default as unknown as VtkImageDataStatic,
    DataArray: dataArray.default as unknown as VtkModules['DataArray'],
    SlicingMode: mapperConstants.default.SlicingMode as unknown as VtkModules['SlicingMode'],
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

/**
 * 创建二维图像视口。所有 VTK 依赖在这里延迟载入。
 */
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

  return {
    setBlock(block) {
      mapper.setInputData(blockToVtkImageData(modules, block))
      mapper.setSlice(0)
      renderer.resetCamera()
      renderer.resetCameraClippingRange()
      render()
    },
    setItkImage(itkImage) {
      mapper.setInputData(modules.ITKHelper.convertItkToVtkImage(itkImage))
      mapper.setSlice(0)
      renderer.resetCamera()
      renderer.resetCameraClippingRange()
      render()
    },
    setWindowLevel(settings) {
      actor.getProperty().setColorWindow(settings.window)
      actor.getProperty().setColorLevel(settings.level)
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
      genericRenderWindow.resize()
      render()
    },
    destroy() {
      renderer.removeActor(actor)
      mapper.delete()
      actor.delete()
      genericRenderWindow.delete()
    },
  }
}
