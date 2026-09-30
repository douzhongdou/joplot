/**
 * Spike 0 探测：惰性加载 @duckdb/duckdb-wasm，用 public/ 下本地 wasm 初始化，
 * 跑一次 SELECT，并回报 crossOriginIsolated（判断是否被迫全站 COOP/COEP）。
 *
 * 版本锁定：@duckdb/duckdb-wasm@1.32.0 依赖 apache-arrow ^17，故 apache-arrow 锁 17.0.0。
 *
 * ⚠️ 可抛弃代码，Spike 结论产出后删除。
 */

export interface DuckDbProbeResult {
  importMs: number
  initMs: number
  queryMs: number
  answer: number
  crossOriginIsolated: boolean
}

/** 只描述用到的 API，规避 duckdb-wasm 类型在不同版本间的漂移。 */
interface DuckDbConnection {
  query: (sql: string) => Promise<{ toArray: () => unknown[] }>
  close: () => Promise<void>
}

interface DuckDbInstance {
  instantiate: (mainModule: string, pthreadWorker?: string | null) => Promise<void>
  connect: () => Promise<DuckDbConnection>
}

export async function probeDuckDb(): Promise<DuckDbProbeResult> {
  const importStart = performance.now()
  const duckdb = await import('@duckdb/duckdb-wasm')
  const importMs = performance.now() - importStart

  const workerUrl = `${window.location.origin}/spike-duckdb/duckdb-browser-eh.worker.js`
  const wasmUrl = `${window.location.origin}/spike-duckdb/duckdb-eh.wasm`

  const initStart = performance.now()
  const worker = new Worker(workerUrl)
  const logger = new duckdb.ConsoleLogger()
  const db = new duckdb.AsyncDuckDB(logger, worker) as unknown as DuckDbInstance
  await db.instantiate(wasmUrl)
  const initMs = performance.now() - initStart

  const connection = await db.connect()
  const queryStart = performance.now()
  const result = await connection.query('SELECT 42 AS answer')
  const queryMs = performance.now() - queryStart
  const firstRow = result.toArray()[0] as { answer: number | bigint | string }
  await connection.close()

  return {
    importMs,
    initMs,
    queryMs,
    answer: Number(firstRow.answer),
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
  }
}
