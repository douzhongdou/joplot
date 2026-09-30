/**
 * Spike 0 一次性 Worker：验证 Next/Turbopack 能否打包 Worker，
 * 并在 Worker 内验证 OPFS 大 buffer 写/读往返。
 *
 * ⚠️ 可抛弃代码，Spike 0 结论产出后删除，不并入 src/ 业务。
 */

/** 只声明用到的子集，避免引入 webworker lib 与 DOM lib 冲突。 */
interface WorkerScope {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}

const scope = self as unknown as WorkerScope

interface PingRequest {
  type: 'ping'
}

interface OpfsRequest {
  type: 'opfs'
  file: string
  bytes: number
}

type Request = PingRequest | OpfsRequest

interface OpfsWritable {
  write: (data: BufferSource) => Promise<void>
  close: () => Promise<void>
}

interface OpfsFileHandle {
  getFile: () => Promise<File>
  createWritable: () => Promise<OpfsWritable>
}

interface OpfsDirHandle {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<OpfsFileHandle>
  removeEntry: (name: string) => Promise<void>
}

interface NavigatorWithOpfs {
  storage: { getDirectory: () => Promise<OpfsDirHandle> }
}

async function runOpfs(file: string, bytes: number) {
  const directory = await (navigator as unknown as NavigatorWithOpfs).storage.getDirectory()
  const handle = await directory.getFileHandle(file, { create: true })

  const payload = new Uint8Array(bytes)
  for (let i = 0; i < payload.length; i += 4096) {
    payload[i] = i & 0xff
  }

  const writeStart = performance.now()
  const writable = await handle.createWritable()
  await writable.write(payload)
  await writable.close()
  const writeMs = performance.now() - writeStart

  const readStart = performance.now()
  const readBack = new Uint8Array(await (await handle.getFile()).arrayBuffer())
  const readMs = performance.now() - readStart

  let matches = readBack.length === payload.length
  if (matches) {
    for (let i = 0; i < payload.length; i += 1) {
      if (readBack[i] !== payload[i]) {
        matches = false
        break
      }
    }
  }

  await directory.removeEntry(file)
  return { writeMs, readMs, matches, bytes }
}

scope.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as Request

  if (message.type === 'ping') {
    scope.postMessage({ type: 'pong', at: performance.now() })
    return
  }

  if (message.type === 'opfs') {
    runOpfs(message.file, message.bytes)
      .then((result) => scope.postMessage({ type: 'opfs-done', file: message.file, ...result }))
      .catch((error: unknown) => scope.postMessage({ type: 'opfs-error', message: String(error) }))
  }
})

export {}
