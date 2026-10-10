# Data Model Spike 0 / A / B 执行计划与决策矩阵

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用可抛弃的 spike 代码，在本仓库真实环境里验证 Data Model Contract v0.1 的关键未知数（运行时可行性、薄 descriptor 表达力、Arrow/DuckDB 互操作成本），产出一份带数据的结论，再决定 Contract v1 的最终形状。

**Architecture:** 三个 spike 全部**隔离在 `spike/` 目录 + 独立路由**，不接入 `src/`，不改动现有工作台 / superplot。每个 spike 只回答一组二元问题并记录量化指标，跑完**删除代码**，只把结论写回 spec。

**Tech Stack:** Next.js App Router、React 19、TypeScript、Node test runner、`apache-arrow`、`@duckdb/duckdb-wasm`、Web Worker、OPFS。

---

## 顺序

```text
Spike 0（运行时可行性，最高优先，可一票否决）
    ↓
Contract v0.1（已完成）
    ↓
Spike A（薄 descriptor）/ Spike B（Arrow + DuckDB）
    ↓
Contract v1（回填结论）
```

> 先跑 Spike 0 的原因：纸面设计再漂亮，如果 Next.js + Worker + WASM + Arrow 在本仓库根本装不下，后面全部要重估。

## 全局测量协议

三个 spike 统一在 `N ∈ {1e5, 1e6, 1e7}` 三点采集：

| 指标 | 采集方式 |
|---|---|
| 导入耗时 | `performance.now()` 包裹解析 |
| 峰值内存 | `performance.measureUserAgentSpecificMemory()`（不可用时 `performance.memory` 近似） |
| slice / transpose 耗时 | 微基准，重复取中位数 |
| Worker transfer 是否零拷贝 | 校验 `byteOffset` 与 transfer 后源 buffer 是否 `detached` |
| FFT 输入准备耗时 | 从任意 view 到 contiguous `Float64Array` 的 materialize 成本 |
| 绘图抽稀耗时 | 现有 downsample 路径跑在 `DenseArray` 上 |

**产物**：每个 spike 一份 `2026-09-27-spike-{0|a|b}-findings.md`（结论 + 数据表 + 截图/复现步骤），随后删除 spike 代码。

---

## Spike 0：运行时可行性

**要回答的问题**

- Next.js（App Router）+ Worker + WASM + `apache-arrow` + DuckDB-Wasm + OPFS 能否在本仓库**同时**打包并运行？
- 是否必须开 `COOP/COEP`（影响全站与第三方 embed）？
- Arrow / DuckDB 能否**完全惰性**加载，使 “Drag CSV → Plot” fast path 的初始 bundle 增量 ≈ 0？

**边界**：只做最小烟测，不做任何业务逻辑。

**步骤**

- [ ] **Step 1**：建可抛弃路由 `app/[lang]/spike/runtime/page.tsx`（client）与一个 worker 文件，全部放 `spike/`，确认不影响现有构建。
- [ ] **Step 2**：按 DuckDB-Wasm 当前要求**锁定** `apache-arrow` 主版本（核实其 `^17` 是否为当前值），`@duckdb/duckdb-wasm` 走动态 `import()`。
- [ ] **Step 3**：验证 `pnpm dev` 与 `pnpm build` 均通过；worker 能启动并能 postMessage 往返。
- [ ] **Step 4**：验证 OPFS：写入一个 ≥ 64MB 的 `ArrayBuffer`，再读回并校验字节一致。
- [ ] **Step 5**：记录下表指标。

**采集指标**

| 指标 | 说明 |
|---|---|
| 初始 JS bundle（该路由） | 是否随引入 Arrow/DuckDB 而增长 |
| lazy chunk：Arrow | 大小 |
| lazy chunk：DuckDB wasm | 大小 |
| Worker 启动耗时 | ms |
| DuckDB 初始化耗时 | ms |
| 是否需要 COOP/COEP | 是/否，用于什么 |
| fast path 是否被污染 | “Drag CSV → Plot” 是否触发 Arrow/DuckDB 下载 |

**Gate（不过则升级重估）**

1. 初始路由 bundle 增量 ≈ 0；Arrow/DuckDB **必须**惰性。
2. `build` 通过，worker URL 在 dev/prod 都能解析。
3. 若必须全站 `COOP/COEP` → 标记为**高风险决策**，需 owner 拍板（可能破坏现有 embed/第三方脚本）。

---

## Spike A：薄 descriptor

**要回答的问题**

- 一个约 200 行的 `DenseArray` descriptor（`dtype/shape/strides/offset/storage` + `slice/transpose/reshape/isContiguous`）能否表达科学计算全部所需视图？
- 从 descriptor 接到现有手写 FFT / 统计 / 绘图，需要多少“适配器/转换”代码？
- materialize contiguous 的成本是否可接受？

**步骤**

- [ ] **Step 1**：在 `spike/descriptor.ts` 实现最小 descriptor 与 view 操作，**控制在 ~200 行**。
- [ ] **Step 2**：写 `spike/descriptor.test.ts`（Node test runner），断言：
  - `slice` / `transpose` 为**零拷贝**（`storage.buffer` 同一，仅 `offset/strides` 变）；
  - 覆盖 contiguous、negative stride、transpose、subarray、non-contiguous；
  - `materialize` 产出正确结果。
- [ ] **Step 3**：写适配器，把 descriptor 接到：现有 `fft.ts`、一个统计 reduce（mean/std）、现有 downsample。
- [ ] **Step 4**：跑 1e5 / 1e6 / 1e7 三点，记录指标。

**采集指标**

| 指标 | 说明 |
|---|---|
| descriptor LOC | 实际行数（看“薄”是否成立） |
| 所需 adapter 数量 | 每个接入点 = 一次转换成本 |
| zero-copy 验证 | 断言是否全部通过 |
| FFT 输入准备耗时 | non-contiguous → contiguous 的代价 |
| slice/transpose/plot 耗时 | 见全局协议 |

**Gate**

1. 所有要求的视图都能表达；零拷贝断言通过。
2. 接入现有 FFT/统计/绘图所需 adapter 数量在可接受范围（建议 ≤ 3）。
3. descriptor LOC 未显著超出规模（否则说明在滑向 NumPy）。

---

## Spike B：Arrow + DuckDB 互操作

**要回答的问题**

- `Arrow Vector → Joplot DenseArray` 到底能多低成本？**分场景**测，不用最理想 case 下结论。
- Arrow 是否适合作为 Worksheet 的默认后端？
- DuckDB 值不值得引入（作为重型关系运算的惰性后端）？
- OPFS 往返是否稳定？

**步骤**

- [ ] **Step 1**：生成/加载 1e6 行 CSV，构建四类列：`no-null float64`、`nullable float64`、`chunked float64`、`dictionary/string`。
- [ ] **Step 2**：对每类，测 `Arrow Vector → DenseArray` 的**拷贝成本**（用 `byteOffset`/`storage.buffer` 判定是否真零拷贝）与耗时。
- [ ] **Step 3**：DuckDB filter / group-by 一次，验证结果回 JS 的路径与成本。
- [ ] **Step 4**：OPFS 写入 / 读回该 Arrow Table 的二进制。
- [ ] **Step 5**：与现有 `SuperDataset` 路径对比：同样 CSV 的导入耗时与峰值内存。

**采集指标**

| 场景 | 是否零拷贝 | 转换耗时 | 峰值内存 |
|---|---|---|---|
| no-null float64 | | | |
| nullable float64 | | | |
| chunked float64 | | | |
| dictionary/string | | | |

**Gate**

1. 明确**哪些场景是真零拷贝**，哪些必须 copy（写进 Contract v1）。
2. Arrow 作为 Worksheet 后端的可行性有数据支撑（是/否/部分）。
3. DuckDB **惰性可用**且不污染 fast path；若初始化过重，则降级为“可选高级能力”。
4. OPFS 往返字节一致。

---

## 风险清单

| 风险 | 影响 | 处理 |
|---|---|---|
| Next.js + WASM 打包（`asyncWebAssembly` / Turbopack） | 可能阻塞 WASM 路线 | Spike 0 验证 |
| 全站 `COOP/COEP` | 破坏 embed / 第三方脚本 | Spike 0 标记，需 owner 决策 |
| `apache-arrow` ↔ DuckDB 主版本耦合 | 升级互相绑架 | 锁 Contract：Arrow 仅 backend，不进 public domain API |
| 特殊函数（erf/gamma/ibeta）无可靠浏览器库 | 统计/分布实现受阻 | 见 Contract R2：先核实，否则移植最小子集 |
| Arrow / DuckDB bundle 过大 | 伤害 “Drag → Plot” | Spike 0 强制惰性加载 + 体积门 |
| spike 代码被当成架构起点 | 技术债 | 纪律：spike 跑完**删除**，只留 findings |

## 决策矩阵（Contract v1 需回答）

| 决策 | 依据 | 候选 |
|---|---|---|
| 薄 descriptor 的最终形状 | Spike A | 采用 / 调整 / 需要 Arrow 辅助 |
| Arrow 是否作为 Worksheet 默认后端 | Spike B | 默认 / 仅导入导出 / 暂不 |
| DuckDB 引入方式 | Spike 0 + B | 惰性可选 / 不引入 |
| 是否引入 WASM | Spike 0 + A | 暂不 / 仅特定算子 |
| 是否需要全站 COOP/COEP | Spike 0 | 是 / 否 |

## 完成标准

- 三份 findings 文档产出，数据完整。
- 上表五条决策全部有结论。
- `docs/superpowers/specs/2026-09-27-joplot-data-model-contract-design.md` 升级为 v1（含 `[待确认]` 条目的最终裁定）。
- `spike/` 目录清空（或明确标注为一次性、不并入 `src/`）。
