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
    const worker = workerRef.current
    const id = ++version.current
    if (!worker) return
    if (!block) { lastBlock.current = null; setResult({}); return }
    const pageChanged = lastBlock.current !== block
    if (pageChanged) {
      // 每幅图只复制一次给分析 Worker；切片切换时立即分析，旧结果保留到新结果返回，
      // 从而不会先闪空再填充（避免「重载 UI」的观感）。
      const data = block.data.slice()
      worker.postMessage({ type: 'image', block: { ...block, data } }, [data.buffer])
      lastBlock.current = block
      worker.postMessage({ type: 'analyze', id, roi, profileRoi, particles, minArea, channel, adjustments })
      return
    }
    // ROI / 参数变化：80ms 防抖，避免连续拖动时堆积请求。
    const timeout = setTimeout(() => worker.postMessage({ type: 'analyze', id, roi, profileRoi, particles, minArea, channel, adjustments }), 80)
    return () => clearTimeout(timeout)
  }, [block, roi, profileRoi, particles, minArea, channel, adjustments])
  return result
}
