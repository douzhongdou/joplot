# 图卡内聚合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现每张图卡独立配置的聚合数据管线，并同步升级显示设置中的 Switch 和 X/Y 轴范围。

**Architecture:** 新增独立聚合引擎，输入 `CsvData[] + AggregationConfig + filteredRowsByDataset`，输出标准化系列结果。`ChartCard` 保留旧 `series` 作为原始数据模式，同时新增 `dataConfig` 和 X 轴范围字段；渲染层先把图卡数据解析成 Plotly 数据，再交给 `PlotCanvas`。右侧检查面板只编辑当前图卡，不引入全局聚合状态。

**Tech Stack:** React 19、TypeScript、Vite、Plotly.js、Node 内置测试 runner。

---

## 文件职责

- `src/types.ts`：新增聚合配置、轴范围、图卡数据模式类型。
- `src/lib/aggregation.ts`：新增聚合引擎、常见时间解析、时间分桶、统计函数。
- `src/lib/workbench.ts`：创建/清洗图卡时补齐新字段，并保持旧图卡兼容。
- `src/components/ChartCard.tsx`：根据图卡数据模式构建 Plotly 数据和统计卡摘要。
- `src/components/CardInspector.tsx`：新增图卡数据模式、聚合配置 UI、Switch、X/Y 轴范围 UI。
- `src/components/Switch.tsx`：新增可复用 Switch 组件。
- `src/i18n/dictionaries/*.ts`：补充中文、英文、日文文案。
- `tests/aggregation.test.ts`：新增聚合引擎测试。
- `tests/workbench.test.ts`：补充旧图卡兼容和轴范围测试。

---

### Task 1: 聚合引擎测试

**Files:**
- Create: `tests/aggregation.test.ts`

- [ ] **Step 1: 写失败测试**

新增测试覆盖普通分组、时间分桶、多数据源按文件分组、多数据源按字段分组、跳过缺字段数据源、全部聚合函数。

关键测试形状：

```ts
test('aggregates multiple datasets by file', () => {
  const result = buildAggregatedSeries(
    [northDataset, southDataset],
    {
      datasetIds: [northDataset.id, southDataset.id],
      xColumn: 'month',
      xKind: 'category',
      groupMode: 'file',
      metricColumn: 'sales',
      aggregation: 'sum',
    },
    rowsByDataset,
  )

  assert.deepEqual(result.series.map((series) => series.name), ['north.csv', 'south.csv'])
  assert.deepEqual(result.series[0].points, [
    { x: '2026-01', y: 30 },
    { x: '2026-02', y: 30 },
  ])
})
```

- [ ] **Step 2: 验证失败**

Run: `node --test --experimental-strip-types ./tests/aggregation.test.ts`

Expected: FAIL，原因是 `src/lib/aggregation.ts` 或导出函数不存在。

---

### Task 2: 聚合引擎实现

**Files:**
- Create: `src/lib/aggregation.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: 新增类型**

在 `src/types.ts` 中新增：

```ts
export type ChartDataMode = 'raw' | 'aggregate'
export type AxisValueKind = 'category' | 'number' | 'time'
export type TimeBucket = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type AggregationKind =
  | 'sum'
  | 'mean'
  | 'count'
  | 'max'
  | 'min'
  | 'median'
  | 'distinctCount'
  | 'missingCount'
  | 'stddev'
  | 'variance'
export type AggregationGroupMode = 'file' | 'field'

export interface AggregationConfig {
  datasetIds: string[]
  xColumn: string
  xKind: AxisValueKind
  timeBucket: TimeBucket
  groupMode: AggregationGroupMode
  groupColumn: string | null
  metricColumn: string
  aggregation: AggregationKind
}
```

- [ ] **Step 2: 实现最小聚合引擎**

`buildAggregatedSeries()` 返回：

```ts
{
  series: Array<{
    key: string
    name: string
    points: Array<{ x: string | number; y: number | null }>
    sourceDatasetIds: string[]
  }>
  skippedDatasets: Array<{ datasetId: string; fileName: string; reason: string }>
  skippedRows: number
}
```

实现规则：

- `groupMode=file`：每个数据源一个系列。
- `groupMode=field`：多个数据源合并后按 `groupColumn` 字段值生成系列。
- 缺字段数据源跳过。
- 时间字段解析失败的行计入 `skippedRows`。
- 标准差和方差使用总体统计。

- [ ] **Step 3: 验证通过**

Run: `node --test --experimental-strip-types ./tests/aggregation.test.ts`

Expected: PASS。

---

### Task 3: 图卡模型兼容

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/workbench.ts`
- Modify: `tests/workbench.test.ts`

- [ ] **Step 1: 写失败测试**

新增测试：

```ts
test('sanitizeCardsForDatasets keeps legacy cards in raw mode and adds empty axis ranges', () => {
  const dataset = createDataset()
  const legacyCard = createDefaultCard(dataset) as ChartCard
  const [sanitized] = sanitizeCardsForDatasets([legacyCard], [dataset], dataset.id)

  assert.equal(sanitized.dataConfig.mode, 'raw')
  assert.deepEqual(sanitized.xRange, { min: '', max: '' })
  assert.deepEqual(sanitized.yRange, { min: '', max: '' })
})
```

- [ ] **Step 2: 验证失败**

Run: `node --test --experimental-strip-types ./tests/workbench.test.ts`

Expected: FAIL，原因是 `dataConfig` 或 `xRange/yRange` 不存在。

- [ ] **Step 3: 实现模型兼容**

`ChartCard` 新增：

```ts
dataConfig: { mode: 'raw' } | { mode: 'aggregate'; aggregation: AggregationConfig }
xRange: { min: string; max: string }
yRange: { min: string; max: string }
```

`createCard()` 默认原始数据模式。`sanitizeCardsForDatasets()` 为旧图卡补齐这些字段，并把旧 `yMin/yMax` 转成 `yRange`。

- [ ] **Step 4: 验证通过**

Run: `node --test --experimental-strip-types ./tests/workbench.test.ts`

Expected: PASS。

---

### Task 4: 图卡渲染接入聚合数据

**Files:**
- Modify: `src/components/ChartCard.tsx`

- [ ] **Step 1: 写失败测试或扩大聚合单测**

用 `tests/aggregation.test.ts` 增加 `toPlotSeries` 风格测试，证明聚合输出能稳定转换为 `x/y/name`。

- [ ] **Step 2: 验证失败**

Run: `node --test --experimental-strip-types ./tests/aggregation.test.ts`

Expected: FAIL，原因是转换函数不存在。

- [ ] **Step 3: 实现渲染接入**

`ChartCard.tsx` 根据 `card.dataConfig.mode` 分支：

- `raw`：继续走现有 `validSeries` 逻辑。
- `aggregate`：调用聚合引擎，生成 Plotly 数据。

图表类型仍统一展示：

- `bar` 使用 `type: 'bar'`
- 其他非统计图使用 `type: 'scattergl'`
- `stats` 使用第一条系列第一组结果展示统计摘要

- [ ] **Step 4: 验证通过**

Run: `pnpm build`

Expected: TypeScript 编译通过。

---

### Task 5: 检查面板聚合配置 UI

**Files:**
- Modify: `src/components/CardInspector.tsx`
- Modify: `src/i18n/dictionaries/zh-CN.ts`
- Modify: `src/i18n/dictionaries/en.ts`
- Modify: `src/i18n/dictionaries/ja-JP.ts`

- [ ] **Step 1: 新增文案**

补充数据模式、聚合字段、时间粒度、分组方式、聚合方式、跳过提示相关文案。

- [ ] **Step 2: 实现 UI**

基础页增加：

- 数据模式选择
- 数据源选择
- X 轴字段
- X 轴类型
- 时间粒度
- 分组方式
- 分组字段
- 指标字段
- 聚合方式

聚合配置变化只 patch 当前 `card.dataConfig`。

- [ ] **Step 3: 验证**

Run: `pnpm build`

Expected: TypeScript 编译通过。

---

### Task 6: Switch 和坐标轴范围

**Files:**
- Create: `src/components/Switch.tsx`
- Modify: `src/components/CardInspector.tsx`
- Modify: `src/components/ChartCard.tsx`

- [ ] **Step 1: 新增 Switch 组件**

组件 API：

```ts
interface SwitchProps {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}
```

- [ ] **Step 2: 替换显示页开关**

把图例、网格线、坐标轴从按钮切换为 `Switch`。

- [ ] **Step 3: 删除主题色占位**

移除显示页中不可用主题色按钮。

- [ ] **Step 4: 新增 X/Y 轴范围 UI**

显示页增加：

- X 轴最小/开始
- X 轴最大/结束
- Y 轴最小
- Y 轴最大

空值表示自动范围。

- [ ] **Step 5: 接入 Plotly layout**

`ChartCard.tsx` 将有效范围传给 `xaxis.range` 和 `yaxis.range`。旧 `yMin/yMax` 不再作为主要 UI，但兼容迁移后仍能生效。

- [ ] **Step 6: 验证**

Run: `pnpm build`

Expected: TypeScript 编译通过。

---

### Task 7: 全量验证和提交

**Files:**
- Verify all touched files

- [ ] **Step 1: 跑核心测试**

Run: `node --test --experimental-strip-types ./tests/*.test.ts`

Expected: all tests pass。

- [ ] **Step 2: 跑构建**

Run: `pnpm build`

Expected: build succeeds。

- [ ] **Step 3: 检查差异**

Run: `git diff --stat`

Expected: 差异集中在聚合引擎、图卡模型、检查面板、文案、测试和文档。

- [ ] **Step 4: 提交**

按 Lore Commit Protocol 提交，说明为什么聚合配置必须归属单张图卡，以及为什么第一阶段不做全局数据视图。
