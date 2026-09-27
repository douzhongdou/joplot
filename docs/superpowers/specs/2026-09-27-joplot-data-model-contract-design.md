# Joplot Data Model Contract v0.1（设计）

> 状态：**预 Spike 草案**。Spike 0 / A / B 的结论回填后升为 v1。
> 本文只锁“契约”，不锁实现。凡是标注 `[待确认]` 的条目，是需要产品/架构 owner 明确点头的追加项。

## 背景

Joplot 的目标是做一个**浏览器端、纯前端、local-first、开箱即用**的科学数据处理与可视化工作台，体验介于 MATLAB（Workspace + 科学计算）、Origin（数据处理 + 科学绘图）、Figma（编辑/文档模型）之间。

当前仓库已存在三块资产：

- `src/lib/*`、`src/components/*`：CSV/Excel 工作台、图卡、函数画板（行对象 `CsvData` 模型）。
- `src/superplot/*`：解耦实验模块，含**自研列式数据集 `SuperDataset`**（`Float64Array` + missing 掩码 + 统计缓存 + `string[]`）、流式解析、自研 FFT。
- `src/lib/expression.ts`：表达式解析器（变量/参数/内置函数），未来用于自定义拟合模型与派生量。

继续加“统计 / 拟合 / 信号 / 谱”时，数据格式是最底层选型。经过两轮讨论，结论是：**Joplot 拥有自己的数据模型契约（语义层 + 薄描述层），但不拥有底层数学世界（ndarray 实现、内存分配器、表格格式、数值内核）。**

## 目标

- 定义一套稳定、可序列化、够长期的 **Value 契约**：所有科学计算对象如何描述自己的 `shape / dtype / storage / 语义`。
- 让 **DenseArray（数值）** 与 **Worksheet（表格）** 平级，共享底层 buffer 但语义永不合并。
- 让 storage / kernel / backend **可替换**：JS → Worker → WASM → WebGPU 演进时，上层 Workspace / Graph / View / Spectrum / FitResult 不变。
- 让“Drag CSV → Plot”这条核心体验在任何演进下都不退化。
- 为 DAG compute + 撤销重做预留身份、缓存、所有权语义。

## 非目标

- **不**自研 ndarray 算法世界：broadcast engine、ufunc 框架、BLAS/LAPACK、SVD/eig、FFT 框架、tensor 表达式编译器、GPU 调度器。
- **不**自研表格物理格式（nullable / UTF-8 / dictionary / timestamp / chunk）：采用 Arrow 兼容布局。
- **不**在本阶段实现 WASM / WebGPU / SharedArrayBuffer / GPU backend。
- **不**在契约层锁定某一版 `apache-arrow` 或 DuckDB。
- 本契约不涉及 UI 布局、图表类型、i18n 文案。

## 约束

- 运行环境：Next.js App Router（客户端重交互）+ React 19 + TypeScript，纯前端、无后端、local-first。
- 多语言（中/英/日）与现有 URL 不变。
- 现有 `SuperDataset`、手写 FFT、工作台行为**不删除、不回归**；通过适配器接入新契约。
- 大数值数据不得使用普通 `number[]` 作为主存储。
- Web Worker / WASM 若引入，必须**惰性加载**，不污染 fast path。
- 契约必须可序列化，且与运行时的后端实现解耦。

## 分层模型

```text
                     Workspace Value
                           │
             id + provenance（+ binding revision）
                           │
          ┌────────────────┼────────────────┐
          │                │                │
     DenseArray        Worksheet        DomainValue
          │                │                │
  shape/strides/dtype   Columns/meta      Spectrum
  offset/storage        Arrow-compatible  FitResult
          │                │              PeakSet
          └──────────┬─────┘
                     │
                 DataHandle
                     │
                  DataStore              ← 拥有 buffer 生命周期
                     │
             ArrayBuffer (v1 唯一 backend)
```

`Compute Runtime` 独立于上图，负责：materialization、transfer、scratch buffer、backend 选择。

**语义边界一句话：矩阵（DenseArray）与工作表（Worksheet）共享存储，但语义平级，绝不互相定义。**

## 锁定决定

以下 15 条为已达成一致的核心契约。

1. **Joplot 自己拥有 Data Contract**（语义层 + 薄描述层）。
2. **DenseArray descriptor 自己实现**，但只实现描述与 view semantics，不发展成 NumPy。
3. **DenseArray 只服务数值密集 ndarray**。
4. **DenseArray 不自带 chunk，不自带 validity**；两者是 wrapper/capability（`ChunkedArray`、`NullableArray`）。
5. **Complex 是逻辑 dtype，physical layout 不锁死**（interleaved / planar 由 backend 决定）。
6. **Worksheet 与 DenseArray 平级语义**。
7. **Worksheet backend 必须 Arrow-compatible，但 domain API 不泄漏 Arrow JS 类型**。
8. **Arrow 负责 table / interchange / DuckDB，不进入数值热路径**。
9. **核心 physical dtype 封闭；扩展靠 semantic metadata（unit 等）**。
10. **Workspace Value 逻辑上 immutable；kernel 内部允许 mutable scratch / in-place**。
11. **runtime identity = `id`（+ 绑定 revision）；content hash 是 optional expensive capability**。
12. **DataStore 管理 buffer ownership / lifetime**；View 与 Operation 只持 handle。
13. **Storage 第一版只实现 JS ArrayBuffer**。
14. **WASM / WebGPU / SharedArrayBuffer 只留接口缝，不提前实现**。
15. **zero-copy 是优化策略，不是语义约束**（copy 是显式操作，不是失败）。

## 本轮追加（`[待确认]`）

> 以下 4 条是 OpenCode 在本轮提出的补充，标 `[待确认]` 供 owner 拍板；接受则并入 v1 的锁定决定。

1. `[待确认]` **R1｜把“值身份”和“绑定版本”拆开。**
   既然 Value 不可变，`Value.version` 是多余的：一个不可变 Value 的内容永不变，返回同一个 `id` 即足够。真正会变的是“某个名字当前指向哪个值”，因此版本属于**绑定**而非值：

   ```ts
   type ValueId = string
   interface Binding { name: string; valueId: ValueId; revision: number }
   ```

   缓存键 = `hash(opType, opVersion, params, inputValueIds)`。这样既不需要 O(N) 内容哈希，语义也不会打架。

2. `[待确认]` **R2｜“优先成熟库”要落到“先确认该库存在且可维护”。**
   特殊函数（`erf / gamma / incomplete beta / CDF / 逆 CDF`）确实是手写雷区，但浏览器侧可维护的实现并不多（`jstat` 停更、`@stdlib/math` 是庞杂包矩阵）。因此策略应为：**先核实存在可维护来源，否则从可信参考（Cephes / Boost）移植最小子集 + golden test**，而不是默认“有成熟库可用”。

3. `[待确认]` **R3｜v1 的 rank 实现范围限定为 rank-1 / rank-2。**
   descriptor 按 n-D 定义（不封死未来），但 `broadcast / expandDims / squeeze / fancy index` 等只在有真实功能需要时实现。

4. `[待确认]` **R4｜数值稳定性写成显式要求。**
   `mean / variance / 求和` 明令要求采用稳定算法（Kahan/Neumaier、Welford），并配 golden test。这条属于“科学正确性”，不是可选优化。

## 类型骨架

```ts
// ---------- 数值 ----------
export type NumericDType =
  | 'float32' | 'float64'
  | 'int32' | 'uint32'
  | 'bool'
  | 'complex64' | 'complex128'

export interface JsBufferStorage {
  kind: 'js'
  buffer: ArrayBuffer
}
// 未来扩展（本期不实现）：
//   | { kind: 'shared'; buffer: SharedArrayBuffer }
//   | { kind: 'wasm'; memory: WebAssembly.Memory; ptr: number }
//   | { kind: 'gpu'; buffer: GPUBuffer }
export type StorageHandle = JsBufferStorage

export interface DenseArray {
  readonly dtype: NumericDType
  readonly shape: readonly number[]
  readonly strides: readonly number[] // 以“元素”为单位
  readonly offset: number             // 以“元素”为单位
  readonly storage: StorageHandle
}

// ---------- nullable / chunked 是 wrapper，不是核心 ----------
export interface NullableArray { values: DenseArray; validity: Uint8Array }
export interface ChunkedArray<T = DenseArray> { chunks: readonly T[] }

// ---------- 表格 ----------
export type ColumnDesignation = 'X' | 'Y' | 'Z' | 'error' | 'label' | 'ignore' | 'none'

export interface ColumnMeta {
  longName?: string
  unit?: string              // 展示/语义；将来升级为 dimensional quantity
  designation?: ColumnDesignation
  comment?: string
}

export interface Column {
  data: ColumnStorageRef     // Arrow-compatible backend；不泄漏 Arrow JS 类型
  meta: ColumnMeta
  nullable: boolean
}

export interface Worksheet {
  columns: readonly Column[]
  rowCount: number
}

// ---------- Value 元信息 ----------
export interface ValueMeta {
  id: ValueId
  unit?: string              // 将来升级：dimension / unit / displayUnit
  label?: string
  provenance?: Provenance    // 来源 operation / source
}

// ---------- 领域值（薄包装，持 DenseArray 指针） ----------
export interface Spectrum {
  meta: ValueMeta
  frequency: DenseArray
  magnitude: DenseArray
  sampleRate: number
  fftSize: number
  window: string
  detrend: string
  normalization: 'amplitude' | 'power' | 'none'
}
```

## 语义规则

- **不可变性**：publish 到 Workspace 的 Value 不可原地改；`normalize(voltage)` 产出新值 `voltage_normalized`。kernel 内部 scratch / in-place 允许。
- **所有权**：`DataStore` 拥有 buffer；`DenseArray` / `View` 只持 `StorageHandle`。Worker 的 `transfer` / `clone` / `share` / `materialize` 由 Compute Runtime 决定。
- **恒等与缓存**：见 R1。content hash 仅用于导入去重 / 跨 session，不作为每次 operation 的默认动作。
- **零拷贝策略**：`slice` / `transpose` 为 view；当 kernel 只接受 contiguous 输入时，显式 `materialize` 连续副本是正确行为。
- **dtype**：核心封闭集合见上；扩展走 semantic type（`float64 + unit=V`），不新增 `dtype=voltage`。
- **单位**：v1 只落 `unit?: string`，但 Contract 明确其为可升级的语义元数据，避免将来做量纲传播时重构。
- **rank 范围**：见 R3。

## 显式延后 / 开放问题

- WASM / WebGPU / SharedArrayBuffer backend 与多线程（COOP/COEP 影响）。
- Op 缓存失效策略细节（LRU、内存预算、eviction）。
- 拟合 / 统计 kernel 的最终来源清单（依赖 Spike 与 R2 结论）。
- Arrow backend 是否作为 Worksheet 默认存储（依赖 Spike B）。
- 单位量纲系统（dimension / unit / displayUnit）。
- 64-bit 索引策略（`i64` 需 BigInt；超 2^31 元素时的索引类型）。

## 与现有资产的映射

| 现有资产 | 在新契约中的位置 | 处理方式 |
|---|---|---|
| `SuperDataset` | Worksheet 的一个后端实现 | **保留**，作为 `SuperDatasetBackend` 适配器接入 |
| 手写 `fft.ts` | Spectrum backend 之一 | **保留**，藏在可替换 backend 后 |
| `expression.ts` | 自定义拟合模型 / 派生量 | 直接复用 |
| 工作台 `CsvData`（行对象） | 旧模型 | 隔离，不进入科学契约；按需适配 |
| `PlotlyChart` 封装 | View 层 | 改为消费 `DenseArray` / `Worksheet` 视图 |

## 关联文档

- 执行与验收：`docs/superpowers/plans/2026-09-27-data-model-spike-0ab-decision-matrix.md`
