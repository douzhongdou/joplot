# Spike 0 Findings：运行时可行性

> 结论：**PASS，未触发一票否决。** 但暴露了 3 条必须在 Contract v1 里固化的约束。
> 采集环境：Windows / Node 24.14.0 / pnpm 11.20.0 / Next 16.3.1（Turbopack）/ React 19.2.5，生产构建 `next start -p 3210`。

## 版本锁定

| 包 | 采用 | 说明 |
|---|---|---|
| `apache-arrow` | **17.0.0** | 唯一 17.x；最新为 21.2.0 |
| `@duckdb/duckdb-wasm` | **1.32.0** | **最近的稳定版**；`npm latest` 实际指向 `1.33.1-dev57.0`（dev） |

> ⚠️ **发现 A（版本耦合真实存在）**：`@duckdb/duckdb-wasm@1.32.0` 依赖 `apache-arrow ^17.0.0`。若我们用 arrow 21，则 Arrow↔DuckDB 的 `insertArrowTable` 会静默失败。这条印证了 Contract 决定 7/8：**Arrow 只能当 backend，不能进 public domain API。**

## 构建结果

- `pnpm build` 通过；TypeScript 通过；spike 路由 `/[lang]/spike/runtime` 对 en/zh/ja 三语 SSG 成功。
- Turbopack **能正确处理** `new Worker(new URL('./opfsWorker.ts', import.meta.url), { type: 'module' })`。
- 本地 wasm 走 `public/spike-duckdb/`（不依赖 CDN），API 用 `new Worker(计算出的 origin URL)` 规避打包器静态改写。

## Chunk 体积

| 资源 | 大小 | 加载时机 |
|---|---|---|
| `2luufa_rvnad1.js`（Arrow 主体） | 213.8 KB | 点击 Arrow 按钮后 |
| `0ahq5p00rye_r.js`（Arrow 辅助） | 11 KB | 点击 Arrow 按钮后 |
| `2hgukbp-6gjjb.js`（DuckDB JS wrapper） | 26.8 KB | 点击 DuckDB 按钮后 |
| `duckdb-eh.wasm` | **32.66 MB** | `public/` 静态资源，init 时 fetch |
| OPFS worker chunk | 0.9 KB | 点击 OPFS 按钮后 |
| `36fxj6jz8ir0e.js`（Plotly，**既有依赖**） | 4.35 MB | 与本次无关，但已存在 |

## Fast path 是否被污染 → 否

打开 `/zh/spike/runtime` 的**初始加载**共 10 个请求、8 个 JS，**无任何 Arrow / DuckDB chunk、无 wasm**。Arrow/DuckDB 只在点击对应按钮后才请求。

唯一初始加载的"沾边" chunk 是 `2mzvsqadloj77.js`（5.4 KB），仅含共享 glue，不含实现主体，可忽略。

## 运行时数据

### Worker + OPFS（64 MB）

| 指标 | 值 |
|---|---|
| worker 启动（ping 往返） | 56.8 ms |
| OPFS 写 64 MB | 141.7 ms |
| OPFS 读 64 MB | 34.3 ms |
| 字节一致 | **true** |

### apache-arrow（1e6 行 × 2 列 f64）

| 指标 | 值 |
|---|---|
| 动态 import | 41.9 ms |
| `tableFromArrays` 构造 | 152.5 ms |
| 行×列 | 1,000,000 × 2 |
| payload | 15.3 MB |
| `arrow.version` 导出 | 不存在（unknown） |

### @duckdb/duckdb-wasm（本地 EH wasm）

| 指标 | 值 |
|---|---|
| 动态 import | 16.9 ms |
| db init（含 32.66 MB wasm 编译） | **1367.7 ms** |
| `SELECT 42` | 31.0 ms |
| 结果 | 42 |
| `crossOriginIsolated` | **false** |

> 注：wasm 的 fetch 发生在 DuckDB 内部 worker（嵌套 worker），页面级 network 抓不到，故无其传输体积记录；但 init 成功即证明已拉取并编译。

## Gate 判定

| Gate | 结果 |
|---|---|
| 初始路由 bundle 增量 ≈ 0，Arrow/DuckDB 必须惰性 | ✅ PASS |
| `build` 通过，worker URL 在 prod 可解析 | ✅ PASS |
| 是否被迫全站 `COOP/COEP` | ✅ **不需要**（单线程 EH wasm 在非隔离下可跑）；线程/SharedArrayBuffer 才需要 |

## 固化进 Contract v1 的结论

1. **DuckDB 必须惰性 + 用户显式触发**：init ≈1.4s + 32.66 MB wasm，不能进 fast path；只作为"重型关系运算"的可选高级能力。
2. **精确锁版本**：`@duckdb/duckdb-wasm` 用稳定版 `1.32.0`（避开 dev `latest`），`apache-arrow` 锁 `17.0.0`；Arrow 仅 backend。
3. **暂不需要 COOP/COEP**：当前能力（单线程 DuckDB、OPFS、Worker）均可在非隔离环境工作。若将来要 DuckDB 多线程或 SharedArrayBuffer，需重新评估全站 `COOP/COEP` 的副作用。
4. Turbopack 对模块 Worker 与静态 wasm 资源的支持可用，WASM 路线**没有被构建链否决**。

## 复现步骤

```bash
pnpm install
pnpm build
pnpm exec next start -p 3210
# 打开 http://localhost:3210/zh/spike/runtime
# 依次点击 Storage estimate / OPFS / apache-arrow / DuckDB 按钮
```

## 待清理的一次性代码

```
app/[lang]/spike/runtime/page.tsx
src/spike/SpikeRuntime.tsx
src/spike/probes/opfsWorker.ts
src/spike/probes/opfsProbe.ts
src/spike/probes/arrowProbe.ts
src/spike/probes/duckdbProbe.ts
public/spike-duckdb/
package.json 中的 apache-arrow / @duckdb/duckdb-wasm（若 Spike A/B 不再需要，或转为 spike 专用）
```
