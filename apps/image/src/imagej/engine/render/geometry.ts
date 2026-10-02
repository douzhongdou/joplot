/**
 * P0/P1：显示坐标与最近邻取样（对应架构方案第 8 节）。
 *
 * 相机是视图变换的唯一执行者，滚动/缩放通过适配层驱动相机，叠加层读取同一状态。
 * 约定：图像像素中心位于索引 + 0.5；屏幕坐标以 CSS 像素为单位；devicePixelRatio
 * 用于把 CSS 像素换算为物理像素，1:1 查看要求物理像素对齐。
 */

export interface CameraState {
  /** 每个图像像素对应的 CSS 像素数。 */
  zoom: number
  /** 平移（屏幕 CSS 像素），表示图像原点在视口中的位置。 */
  panX: number
  panY: number
  /** 设备像素比。 */
  devicePixelRatio: number
  /** 视口尺寸（CSS 像素）。 */
  viewportWidth: number
  viewportHeight: number
}

export const MIN_ZOOM = 0.01
export const MAX_ZOOM = 64

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
}

/** 图像坐标（连续，像素中心在 n+0.5）→ 屏幕 CSS 像素。 */
export function imageToScreen(imageX: number, imageY: number, camera: CameraState): { x: number; y: number } {
  return { x: camera.panX + imageX * camera.zoom, y: camera.panY + imageY * camera.zoom }
}

/** 屏幕 CSS 像素 → 图像坐标（连续）。 */
export function screenToImage(screenX: number, screenY: number, camera: CameraState): { x: number; y: number } {
  return { x: (screenX - camera.panX) / camera.zoom, y: (screenY - camera.panY) / camera.zoom }
}

/** 屏幕坐标 → 最近的像素索引；越界返回 undefined。 */
export function screenToPixel(
  screenX: number,
  screenY: number,
  camera: CameraState,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number } | undefined {
  const { x, y } = screenToImage(screenX, screenY, camera)
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || py < 0 || px >= imageWidth || py >= imageHeight) return undefined
  return { x: px, y: py }
}

/** 适应窗口的缩放。 */
export function fitZoom(imageWidth: number, imageHeight: number, viewportWidth: number, viewportHeight: number): number {
  if (imageWidth <= 0 || imageHeight <= 0) return 1
  return clampZoom(Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight))
}

/** 1:1 查看所需的缩放（一个图像像素对应一个物理像素）。 */
export function oneToOneZoom(devicePixelRatio: number): number {
  return clampZoom(1 / Math.max(1, devicePixelRatio))
}

/** 以某个屏幕锚点为中心缩放，保持锚点下的图像坐标不动。 */
export function zoomAt(camera: CameraState, factor: number, anchorX: number, anchorY: number): CameraState {
  const before = screenToImage(anchorX, anchorY, camera)
  const zoom = clampZoom(camera.zoom * factor)
  return {
    ...camera,
    zoom,
    panX: anchorX - before.x * zoom,
    panY: anchorY - before.y * zoom,
  }
}

/** 把图像居中到视口。 */
export function centerCamera(imageWidth: number, imageHeight: number, camera: CameraState): CameraState {
  return {
    ...camera,
    panX: (camera.viewportWidth - imageWidth * camera.zoom) / 2,
    panY: (camera.viewportHeight - imageHeight * camera.zoom) / 2,
  }
}

/** 报告当前缩放是否为「缩小显示不包含全部像素」。 */
export function isDownsampled(camera: CameraState): boolean {
  return camera.zoom * camera.devicePixelRatio < 1
}

/** 像素中心物理对齐误差（物理像素），用于校验 1:1 对齐。 */
export function physicalAlignmentError(camera: CameraState): number {
  return Math.abs((camera.zoom * camera.devicePixelRatio) % 1)
}
