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
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    if (disposeTimer.current) clearTimeout(disposeTimer.current)
    const unsubscribe = runtime.subscribe(setState)
    return () => {
      unsubscribe()
      // Strict Mode 会立即再次订阅；真正离开页面后才释放运行时。
      disposeTimer.current = setTimeout(() => runtime.dispose(), 0)
    }
  }, [])

  return { state, runtime: runtimeRef.current }
}
