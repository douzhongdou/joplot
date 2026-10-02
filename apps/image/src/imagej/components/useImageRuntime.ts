'use client'

import { useEffect, useRef, useState } from 'react'
import { ImageRuntime, type RuntimeState } from '../engine/runtime'
import { createEngineClient } from '../engine/worker/client'

/** React 绑定：订阅运行时的状态快照，并保持 Worker 客户端生命周期。 */
export function useImageRuntime(): { state: RuntimeState; runtime: ImageRuntime } {
  const runtimeRef = useRef<ImageRuntime | null>(null)
  if (!runtimeRef.current) {
    runtimeRef.current = new ImageRuntime({
      client: createEngineClient(),
      cacheBytes: 256 * 1024 * 1024,
      prefetch: true,
    })
  }
  const [state, setState] = useState<RuntimeState>(() => runtimeRef.current!.getState())

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    return runtime.subscribe(setState)
  }, [])

  return { state, runtime: runtimeRef.current }
}
