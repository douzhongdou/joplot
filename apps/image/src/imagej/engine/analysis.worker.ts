import { analyzeBlock, profileBlock, type ImageAnalysis } from './analysis.ts'
import type { ImageBlock } from './types.ts'
import { analyzeParticles } from '../lib/binary.ts'
import type { Rect } from '../lib/processor.ts'
import { crop } from './compute/pureOps.ts'
import { colorHistogramBlock, type ColorChannel, type ColorAdjustment } from './colorAdjustments.ts'

let block: ImageBlock | null = null
let wholeAnalysis: ImageAnalysis | null = null
self.onmessage = (event: MessageEvent<{ type: 'image'; block: ImageBlock } | { type: 'analyze'; id: number; roi: Rect | null; profileRoi: Rect | null; particles: boolean; minArea: number; channel?: ColorChannel; adjustments: readonly ColorAdjustment[] }>) => {
  const request = event.data
  if (request.type === 'image') { block = request.block; wholeAnalysis = null; return }
  if (!block) return
  try {
    const analyzed = request.channel ? colorHistogramBlock(block, request.channel, request.adjustments) : block
    const base = request.channel || request.roi ? analyzeBlock(analyzed, request.roi) : wholeAnalysis ??= analyzeBlock(block)
    const analysis = { ...base, profile: profileBlock(analyzed, request.profileRoi) }
    const autoAnalysis = request.channel ? request.channel === 'all' ? analysis : analyzeBlock(colorHistogramBlock(block, 'all', request.adjustments), request.roi) : undefined
    let particles
    if (request.particles) {
      const input = request.roi ? crop(analyzed, request.roi) : analyzed
      const width = input.shape[input.axes.indexOf('x')]!, height = input.shape[input.axes.indexOf('y')]!
      const data = new Uint8Array(width * height)
      const ci = input.axes.indexOf('c'), rgb = ci >= 0 && input.shape[ci] === 3
      for (let i = 0; i < data.length; i++) {
        const value = rgb ? input.data[i]! + input.data[data.length + i]! + input.data[2 * data.length + i]! : input.data[i]!
        data[i] = Number.isFinite(value) && value !== 0 ? 255 : 0
      }
      particles = analyzeParticles({ width, height, data }, request.minArea).map((particle) => ({ ...particle, centroidX: particle.centroidX + (request.roi?.x ?? 0), centroidY: particle.centroidY + (request.roi?.y ?? 0), bounds: { ...particle.bounds, x: particle.bounds.x + (request.roi?.x ?? 0), y: particle.bounds.y + (request.roi?.y ?? 0) } }))
    }
    self.postMessage({ id: request.id, analysis, autoAnalysis, particles })
  } catch (error) { self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) }) }
}
