import { analyzeBlock, profileBlock, type ImageAnalysis } from './analysis.ts'
import type { ImageBlock } from './types.ts'
import { analyzeParticles } from '../lib/binary.ts'
import type { RoiInput } from '../lib/processor.ts'
import { isRoi, roiBounds, roiMask } from '../lib/roi.ts'
import { crop } from './compute/pureOps.ts'
import { colorHistogramBlock, type ColorChannel, type ColorAdjustment } from './colorAdjustments.ts'

interface AnalyzeRequest {
  type: 'analyze'
  id: number
  /** 统计范围：矩形字面量或任意形状 ROI；null 表示整图。 */
  roi: RoiInput | null
  /** 剖面范围（线 ROI 走沿线采样）。 */
  profileRoi: RoiInput | null
  particles: boolean
  minArea: number
  channel?: ColorChannel
  adjustments: readonly ColorAdjustment[]
}

let block: ImageBlock | null = null
let wholeAnalysis: ImageAnalysis | null = null
self.onmessage = (event: MessageEvent<{ type: 'image'; block: ImageBlock } | AnalyzeRequest>) => {
  const request = event.data
  if (request.type === 'image') { block = request.block; wholeAnalysis = null; return }
  if (!block) return
  try {
    const analyzed = request.channel ? colorHistogramBlock(block, request.channel, request.adjustments) : block
    const base = request.channel || request.roi ? analyzeBlock(analyzed, request.roi, false) : wholeAnalysis ??= analyzeBlock(block, null, false)
    const analysis = { ...base, profile: profileBlock(analyzed, request.profileRoi) }
    const autoAnalysis = request.channel ? request.channel === 'all' ? analysis : analyzeBlock(colorHistogramBlock(block, 'all', request.adjustments), request.roi, false) : undefined
    let particles
    if (request.particles) {
      const roi = request.roi ?? null
      const bounds = roi ? (isRoi(roi) ? roiBounds(roi) : roi) : null
      const input = bounds ? crop(analyzed, bounds) : analyzed
      const width = input.shape[input.axes.indexOf('x')]!, height = input.shape[input.axes.indexOf('y')]!
      const data = new Uint8Array(width * height)
      const ci = input.axes.indexOf('c'), rgb = ci >= 0 && input.shape[ci] === 3
      // 非矩形 ROI：把 ROI 外的像素清零，否则粒子会把包围盒内的"外部区域"也算进连通域。
      const raster = roi && isRoi(roi) && roi.kind !== 'rectangle' ? roiMask(roi, block.shape[block.axes.indexOf('x')]!, block.shape[block.axes.indexOf('y')]!) : null
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const i = y * width + x
        if (raster && bounds) {
          const imageX = bounds.x + x, imageY = bounds.y + y
          const insideBox = imageX >= raster.bounds.x && imageY >= raster.bounds.y
            && imageX < raster.bounds.x + raster.bounds.width && imageY < raster.bounds.y + raster.bounds.height
          if (!insideBox || !raster.mask[(imageY - raster.bounds.y) * raster.bounds.width + (imageX - raster.bounds.x)]) continue
        }
        const value = rgb ? input.data[i]! + input.data[data.length + i]! + input.data[2 * data.length + i]! : input.data[i]!
        data[i] = Number.isFinite(value) && value !== 0 ? 255 : 0
      }
      const offsetX = bounds?.x ?? 0, offsetY = bounds?.y ?? 0
      particles = analyzeParticles({ width, height, data }, request.minArea).map((particle) => ({
        ...particle,
        centroidX: particle.centroidX + offsetX,
        centroidY: particle.centroidY + offsetY,
        bounds: { ...particle.bounds, x: particle.bounds.x + offsetX, y: particle.bounds.y + offsetY },
      }))
    }
    self.postMessage({ id: request.id, analysis, autoAnalysis, particles })
  } catch (error) { self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) }) }
}
