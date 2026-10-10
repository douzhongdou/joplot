'use client'

import { useEffect, useState } from 'react'
import { ImageRuntime, type RuntimeState } from '../engine/runtime'
import { ByteCache } from '../engine/scheduler/cache'
import { createEngineClient, type EngineClient, type EngineResult } from '../engine/worker/client'

/**
 * 多文档（tab）共享的引擎资源。
 *
 * 引擎本身按 `datasetId` 索引数据集，因此一个 client 与一份字节缓存可以服务多个文档：
 * 每个文档只拥有自己的 `ImageRuntime`（Recipe 历史 / selection / 状态），
 * 底层 Worker 与缓存不重复创建。文档关闭时只 dispose 自己的 datasetId。
 */
export interface ImageWorkspaceEngine {
  client: EngineClient
  cache: ByteCache<EngineResult>
}

export function createWorkspaceEngine(): ImageWorkspaceEngine {
  return { client: createEngineClient(), cache: new ByteCache<EngineResult>(256 * 1024 * 1024) }
}

/** 为一个文档创建运行时；client 与 cache 由上层共享，因此不由文档负责 terminate。 */
export function createDocumentRuntime(engine: ImageWorkspaceEngine): ImageRuntime {
  return new ImageRuntime({ client: engine.client, cache: engine.cache, prefetch: true, ownsClient: false })
}

/** React 绑定：订阅某个文档运行时的状态快照。 */
export function useRuntimeState(runtime: ImageRuntime): RuntimeState {
  const [state, setState] = useState<RuntimeState>(() => runtime.getState())
  useEffect(() => {
    setState(runtime.getState())
    return runtime.subscribe(setState)
  }, [runtime])
  return state
}
