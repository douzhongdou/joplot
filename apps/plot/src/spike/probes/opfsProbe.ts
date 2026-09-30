/**
 * Spike 0 主线程侧包装：创建 opfsWorker、测启动往返、下发 OPFS 大 buffer 写读任务。
 *
 * ⚠️ 可抛弃代码，Spike 结论产出后删除。
 */

export interface OpfsProbeResult {
  startupMs: number
  writeMs: number
  readMs: number
  matches: boolean
  bytes: number
}

function onceMessage(
  worker: Worker,
  accept: (data: unknown) => boolean,
  timeoutMs = 180_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
    const onMessage = (event: MessageEvent) => {
      if (accept(event.data)) {
        cleanup()
        resolve(event.data)
      }
    }
    const onError = (event: ErrorEvent) => {
      cleanup()
      reject(new Error(event.message))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('opfs worker timeout'))
    }, timeoutMs)
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
  })
}

export async function probeOpfs(file: string, bytes: number): Promise<OpfsProbeResult> {
  const created = performance.now()
  const worker = new Worker(new URL('./opfsWorker.ts', import.meta.url), { type: 'module' })

  try {
    worker.postMessage({ type: 'ping' })
    await onceMessage(worker, (data) => (data as { type?: string }).type === 'pong')
    const startupMs = performance.now() - created

    worker.postMessage({ type: 'opfs', file, bytes })
    const done = (await onceMessage(
      worker,
      (data) => {
        const type = (data as { type?: string }).type
        return type === 'opfs-done' || type === 'opfs-error'
      },
    )) as { type: string; writeMs: number; readMs: number; matches: boolean; bytes: number; message?: string }

    if (done.type === 'opfs-error') {
      throw new Error(done.message ?? 'opfs worker error')
    }

    return {
      startupMs,
      writeMs: done.writeMs,
      readMs: done.readMs,
      matches: done.matches,
      bytes: done.bytes,
    }
  } finally {
    worker.terminate()
  }
}
