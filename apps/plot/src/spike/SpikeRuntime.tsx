'use client'

/**
 * Spike 0 一次性验证面板。
 *
 * 依次验证：
 *  1. Worker 能否打包并启动（ping 往返）
 *  2. OPFS 能否写入/读回 64MB 并字节一致
 *  3. apache-arrow 是否惰性加载、构造成本
 *  4. @duckdb/duckdb-wasm 本地 wasm 能否初始化、是否被迫 COOP/COEP
 *
 * ⚠️ 可抛弃代码，Spike 结论产出后删除，不并入 src/ 业务。
 */

import { useState } from 'react'
import { probeArrow, type ArrowProbeResult } from './probes/arrowProbe'
import { probeDuckDb, type DuckDbProbeResult } from './probes/duckdbProbe'
import { probeOpfs, type OpfsProbeResult } from './probes/opfsProbe'

type Status = 'idle' | 'running' | 'done' | 'error'

interface ProbeState<T> {
  status: Status
  result?: T
  error?: string
}

function initial<T>(): ProbeState<T> {
  return { status: 'idle' }
}

function ms(value: number): string {
  return `${value.toFixed(1)} ms`
}

export function SpikeRuntime() {
  const [opfs, setOpfs] = useState<ProbeState<OpfsProbeResult>>(initial)
  const [arrow, setArrow] = useState<ProbeState<ArrowProbeResult>>(initial)
  const [duckdb, setDuckdb] = useState<ProbeState<DuckDbProbeResult>>(initial)
  const [quota, setQuota] = useState<string>('—')

  const runOpfs = async () => {
    setOpfs({ status: 'running' })
    try {
      const result = await probeOpfs('spike-opfs.bin', 64 * 1024 * 1024)
      setOpfs({ status: 'done', result })
    } catch (error) {
      setOpfs({ status: 'error', error: String(error) })
    }
  }

  const runArrow = async () => {
    setArrow({ status: 'running' })
    try {
      const result = await probeArrow()
      setArrow({ status: 'done', result })
    } catch (error) {
      setArrow({ status: 'error', error: String(error) })
    }
  }

  const runDuckDb = async () => {
    setDuckdb({ status: 'running' })
    try {
      const result = await probeDuckDb()
      setDuckdb({ status: 'done', result })
    } catch (error) {
      setDuckdb({ status: 'error', error: String(error) })
    }
  }

  const runQuota = async () => {
    try {
      const estimate = await navigator.storage.estimate()
      const usage = estimate.usage ?? 0
      const total = estimate.quota ?? 0
      setQuota(`${(usage / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(0)} MB`)
    } catch (error) {
      setQuota(String(error))
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: 'monospace', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 18 }}>Spike 0 · data-model runtime probe</h1>
      <p style={{ opacity: 0.7 }}>
        crossOriginIsolated: {String(typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false)}
      </p>

      <section style={{ marginTop: 16 }}>
        <button onClick={runQuota}>Storage estimate</button>
        <span style={{ marginLeft: 12 }}>{quota}</span>
      </section>

      <hr style={{ margin: '20px 0' }} />

      <section>
        <button onClick={runOpfs} disabled={opfs.status === 'running'}>
          Run worker + OPFS (64MB)
        </button>
        <pre>
          {opfs.status === 'error'
            ? opfs.error
            : opfs.status === 'done' && opfs.result
              ? [
                  `worker startup: ${ms(opfs.result.startupMs)}`,
                  `opfs write: ${ms(opfs.result.writeMs)}`,
                  `opfs read: ${ms(opfs.result.readMs)}`,
                  `bytes match: ${opfs.result.matches}`,
                  `bytes: ${(opfs.result.bytes / 1024 / 1024).toFixed(1)} MB`,
                ].join('\n')
              : opfs.status}
        </pre>
      </section>

      <section>
        <button onClick={runArrow} disabled={arrow.status === 'running'}>
          Probe apache-arrow (1e6 rows)
        </button>
        <pre>
          {arrow.status === 'error'
            ? arrow.error
            : arrow.status === 'done' && arrow.result
              ? [
                  `dynamic import: ${ms(arrow.result.importMs)}`,
                  `version: ${arrow.result.version}`,
                  `rows: ${arrow.result.numRows}`,
                  `cols: ${arrow.result.numCols}`,
                  `build: ${ms(arrow.result.buildMs)}`,
                  `payload: ${(arrow.result.chunkBytes / 1024 / 1024).toFixed(1)} MB`,
                ].join('\n')
              : arrow.status}
        </pre>
      </section>

      <section>
        <button onClick={runDuckDb} disabled={duckdb.status === 'running'}>
          Probe DuckDB-Wasm (local wasm)
        </button>
        <pre>
          {duckdb.status === 'error'
            ? duckdb.error
            : duckdb.status === 'done' && duckdb.result
              ? [
                  `dynamic import: ${ms(duckdb.result.importMs)}`,
                  `db init: ${ms(duckdb.result.initMs)}`,
                  `query: ${ms(duckdb.result.queryMs)}`,
                  `SELECT 42 = ${duckdb.result.answer}`,
                  `crossOriginIsolated: ${duckdb.result.crossOriginIsolated}`,
                ].join('\n')
              : duckdb.status}
        </pre>
      </section>
    </main>
  )
}
