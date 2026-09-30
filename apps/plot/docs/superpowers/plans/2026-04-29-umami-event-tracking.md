# Joplot Umami 事件埋点实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Joplot 接入一期 Umami 事件埋点，覆盖上传、解析、示例数据、出图、下载、复制与页面语言，并保持隐私边界与现有交互不被破坏。

**Architecture:** 保持当前页面结构不变，在 `src/lib` 新增轻量埋点工具与事件辅助函数，把埋点调用接到 `App.tsx`、`useCsvData.ts`、`ChartCard.tsx` 与 i18n/语言链路。测试优先覆盖纯函数和埋点基础能力，UI 层只做最小接线。

**Tech Stack:** Next.js、React 19、TypeScript、Umami tracker、Node test runner

---

### Task 1: 建立埋点基础工具与纯函数

**Files:**
- Create: `src/lib/track.ts`
- Create: `src/lib/analytics.ts`
- Create: `tests/track.test.ts`
- Create: `tests/analytics.test.ts`
- Test: `tests/track.test.ts`
- Test: `tests/analytics.test.ts`

- [ ] **Step 1: 先写 `track()` 的失败测试**

覆盖：
- `window` 不存在时静默返回
- `window.umami.track` 不存在时静默返回
- 有效事件名和 payload 时会调用 Umami
- payload 中的 `undefined` 不会被透传

- [ ] **Step 2: 运行测试确认先失败**

Run: `node --experimental-strip-types --test tests/track.test.ts tests/analytics.test.ts`
Expected: 因 `src/lib/track.ts` / `src/lib/analytics.ts` 不存在而失败。

- [ ] **Step 3: 实现埋点基础工具与事件辅助函数**

实现：
- `track(eventName, payload?)`
- `normalizeTrackingLanguage(language)`
- `mapChartKindToTrackingType(kind)`
- `mapParseErrorToReason(error)`
- `buildUploadCsvPayload(dataset, file, inputMethod)`
- `buildParseSuccessPayload(dataset)`
- `buildRenderChartPayload(kind, dataset)`

- [ ] **Step 4: 再次运行基础测试**

Run: `node --experimental-strip-types --test tests/track.test.ts tests/analytics.test.ts`
Expected: 新增埋点工具与纯函数测试通过。

### Task 2: 接入上传、解析、示例数据与语言事件

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/hooks/useCsvData.ts`
- Modify: `src/components/FileUploader.tsx`
- Modify: `src/components/HomeHero.tsx`
- Modify: `docs/idea/2026-04-29-event-tracking.md`
- Test: `tests/useCsvData.test.ts`

- [ ] **Step 1: 先写或扩展测试，覆盖解析辅助行为**

至少覆盖：
- 语言归一化为 `en` / `zh` / `ja`
- 解析失败原因会映射到标准枚举
- 上传成功 payload 带 `rows`、`columns`、`file_size_kb`、`input_method`

- [ ] **Step 2: 运行相关测试确认先失败**

Run: `node --experimental-strip-types --test tests/useCsvData.test.ts tests/analytics.test.ts`
Expected: 因新行为未实现而失败。

- [ ] **Step 3: 在应用入口接上传/解析链路埋点**

实现：
- `handleIncomingFiles(files, inputMethod)` 支持上传来源
- 解析成功后逐文件触发 `upload_csv` 与 `parse_success`
- 解析失败时触发 `parse_fail`
- 加载示例数据时额外触发 `load_demo_data`
- 页面首次确定语言后触发 `page_language`

- [ ] **Step 4: 更新实施文档中的图表类型枚举与实际代码一致**

把文档中 `chart_type` 可选值同步为当前真实支持的图表类型，避免文档与实现脱节。

- [ ] **Step 5: 再次运行相关测试**

Run: `node --experimental-strip-types --test tests/useCsvData.test.ts tests/analytics.test.ts`
Expected: 上传、语言、解析相关测试通过。

### Task 3: 接入出图、下载、复制事件

**Files:**
- Modify: `src/components/ChartCard.tsx`
- Modify: `src/components/PlotCanvas.tsx` if needed
- Test: `tests/analytics.test.ts`

- [ ] **Step 1: 先写事件 payload 与图表类型映射测试**

覆盖：
- `render_chart` 使用标准化 `chart_type`
- 不支持的图表类型回退为 `unknown`
- 复制和下载沿用相同 `chart_type` 口径

- [ ] **Step 2: 运行测试确认先失败**

Run: `node --experimental-strip-types --test tests/analytics.test.ts`
Expected: 新的图表事件辅助行为缺失而失败。

- [ ] **Step 3: 接入图表类事件**

实现：
- 图表首次有效渲染时触发 `render_chart`
- 切换图表类型并成功渲染时允许再次触发
- 点击下载成功开始后触发 `download_png`
- 复制成功或退化到下载后按规则触发 `copy_image`

- [ ] **Step 4: 再次运行相关测试**

Run: `node --experimental-strip-types --test tests/analytics.test.ts`
Expected: 图表事件辅助函数与口径测试通过。

### Task 4: 全量验证

**Files:**
- Modify: as needed based on failures
- Test: `tests/*.test.ts`

- [ ] **Step 1: 跑全量测试**

Run: `pnpm test`
Expected: 全部测试通过。

- [ ] **Step 2: 跑生产构建**

Run: `pnpm build`
Expected: Next.js 构建通过，无新增阻塞错误。

- [ ] **Step 3: 人工抽查关键路径**

Run: `pnpm dev`
Expected:
- 上传 CSV 后能正常出图
- 加载示例数据后能正常出图
- 下载和复制图片仍然可用
- 语言切换不受影响

- [ ] **Step 4: 提交本次结果**

```bash
git add .
git commit -m "让 Joplot 能在 Umami 中看见真实价值动作

为上传、解析、示例数据、出图、下载、复制与页面语言接入
隐私友好的事件埋点，保持现有工作台交互不变，并通过轻量
辅助函数统一事件口径与字段清洗。

Constraint: 不得上传 CSV 内容、文件名、路径或其他敏感信息
Rejected: 直接在各组件散落调用 umami.track | 口径易漂移且难测试
Confidence: medium
Scope-risk: moderate
Directive: 后续新增关键动作时，优先在 analytics helper 中统一字段和枚举
Tested: pnpm test; pnpm build; 上传/示例数据/导出手测
Not-tested: 真实 Umami 生产实例中的最终数据延迟表现"
```
