import type { ImageBlock } from '../types.ts'
import type { DisplayWindowLevel } from './rgba.ts'
import type { RasterOptions } from './raster.ts'
import { adjustedColorValue } from '../colorAdjustments.ts'

/** PNG 显示图像只需单通道 8 位或平面 RGB，避免整幅 RGBA 与源尺寸 Canvas。 */
export function displayBlock(block: ImageBlock, settings: DisplayWindowLevel, options: RasterOptions = {}): ImageBlock {
  const width = block.shape[block.axes.indexOf('x')]!, height = block.shape[block.axes.indexOf('y')]!
  const ci = block.axes.indexOf('c'), rgb = ci >= 0 && block.shape[ci] === 3, pixels = width * height
  if (rgb && !options.gray && options.threshold === undefined) {
    if (!options.colorAdjustments?.length && block.dtype === 'uint8' && settings.window === 255 && settings.level === 127.5) return { ...block, axes: ['c', 'y', 'x'], shape: [3, height, width], region: { start: [0, 0, 0], shape: [3, height, width] } }
    const lo = settings.level - settings.window / 2, scale = 255 / (settings.window || 1)
    const data = new Uint8Array(pixels * 3)
    for (let i = 0; i < data.length; i++) {
      const pixel = i % pixels, value = adjustedColorValue(block.data[i]!, Math.floor(i / pixels), pixel % width, Math.floor(pixel / width), options.colorAdjustments ?? [], block.dtype === 'uint16' ? 65535 : 255)
      data[i] = Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round((value - lo) * scale))) : 0
    }
    return { dtype: 'uint8', data, axes: ['c', 'y', 'x'], shape: [3, height, width], region: { start: [0, 0, 0], shape: [3, height, width] } }
  }
  const data = new Uint8Array(pixels), lo = settings.level - settings.window / 2, scale = 255 / (settings.window || 1)
  const adjustments = options.colorAdjustments ?? []
  const ceiling = block.dtype === 'uint16' ? 65535 : 255
  /*
   * 灰度图的显示范围调整与视口（`raster.ts`）同口径：调整后的值已在 `[0, ceiling]` 域，
   * 直接映到 8 位，不再叠一层窗宽窗位。两处的公式必须保持逐位一致，否则 PNG 导出会与
   * 屏幕所见不同。
   */
  const grayRange = !rgb && options.threshold === undefined && adjustments.length > 0
  for (let i = 0; i < pixels; i++) {
    if (grayRange) {
      const adjusted = adjustedColorValue(block.data[i]!, 0, i % width, Math.floor(i / width), adjustments, ceiling)
      data[i] = Number.isFinite(adjusted) ? Math.max(0, Math.min(255, Math.round(adjusted * 255 / ceiling))) : 0
      continue
    }
    const colorValue = (channel: number) => adjustedColorValue(block.data[channel * pixels + i]!, channel, i % width, Math.floor(i / width), adjustments, ceiling)
    const value = rgb ? Math.round((colorValue(0) + colorValue(1) + colorValue(2)) / 3) : block.data[i]!
    const mapped = options.threshold === undefined ? Math.round((value - lo) * scale) : value > options.threshold ? 255 : 0
    data[i] = Number.isFinite(value) ? Math.max(0, Math.min(255, mapped)) : 0
  }
  return { dtype: 'uint8', axes: ['y', 'x'], shape: [height, width], region: { start: [0, 0], shape: [height, width] }, data }
}
