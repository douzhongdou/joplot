'use client'
import { useEffect, useRef, useState } from 'react'
import type { ImageBlock } from '../engine/types'
import type { ImageAnalysis } from '../engine/analysis'
import type { Rect } from '../lib/processor'
import type { Particle } from '../lib/binary'
import type { ColorAdjustment, ColorChannel } from '../engine/colorAdjustments'
const NO_ADJUSTMENTS: readonly ColorAdjustment[] = []

export function useImageAnalysis(block: ImageBlock | null, roi: Rect | null, particles: boolean, minArea: number, profileRoi: Rect | null = roi, channel?: ColorChannel, adjustments: readonly ColorAdjustment[] = NO_ADJUSTMENTS) {
  const workerRef = useRef<Worker | null>(null), lastBlock = useRef<ImageBlock | null>(null), version = useRef(0)
  const [result, setResult] = useState<{ analysis?: ImageAnalysis; autoAnalysis?: ImageAnalysis; particles?: Particle[]; error?: string }>({})
  useEffect(() => {
    const worker = new Worker(new URL('../engine/analysis.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (event) => { if (event.data.id === version.current) setResult(event.data) }
    worker.onerror = (event) => setResult({ error: event.message })
    return () => { worker.terminate(); workerRef.current = null; lastBlock.current = null }
  }, [])
  useEffect(() => {
    const worker = workerRef.current, id = ++version.current
    setResult({})
    if (!worker || !block) return
    // 每幅图只复制一次给分析 Worker，ROI 移动仅传坐标，不重复复制大图。
    if (lastBlock.current !== block) {
      const data = block.data.slice()
      worker.postMessage({ type: 'image', block: { ...block, data } }, [data.buffer])
      lastBlock.current = block
    }
    const timeout = setTimeout(() => worker.postMessage({ type: 'analyze', id, roi, profileRoi, particles, minArea, channel, adjustments }), 80)
    return () => clearTimeout(timeout)
  }, [block, roi, profileRoi, particles, minArea, channel, adjustments])
  return result
}
