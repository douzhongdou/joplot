/**
 * Spike A 前置探测：动态加载 apache-arrow 并构造一个 1e6 行、两列 f64 的 Table。
 * 用于验证「Arrow 是否被惰性加载」以及基础构造成本。
 *
 * ⚠️ 可抛弃代码，Spike 结论产出后删除。
 */

export interface ArrowProbeResult {
  importMs: number
  version: string
  numRows: number
  numCols: number
  buildMs: number
  chunkBytes: number
}

export async function probeArrow(): Promise<ArrowProbeResult> {
  const importStart = performance.now()
  const arrow = await import('apache-arrow')
  const importMs = performance.now() - importStart

  const length = 1_000_000
  const buildStart = performance.now()
  const x = Float64Array.from({ length }, (_, index) => index)
  const y = Float64Array.from({ length }, (_, index) => Math.sin(index / 1000))
  const table = arrow.tableFromArrays({ x, y })
  const buildMs = performance.now() - buildStart

  return {
    importMs,
    version: (arrow as unknown as { version?: string }).version ?? 'unknown',
    numRows: table.numRows,
    numCols: table.numCols,
    buildMs,
    chunkBytes: x.byteLength + y.byteLength,
  }
}
