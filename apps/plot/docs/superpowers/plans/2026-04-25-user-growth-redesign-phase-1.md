# 用户增长导向改版（第一阶段）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让首次访问用户更快理解 `joplot`、没有文件也能立刻试、导出图片默认即可分享。

**Architecture:** 保持现有 React + Vite + Plotly 工作台数据流不变，只在无数据首页态、样例数据入口和图片导出链路上做增强。新增逻辑尽量收敛到纯函数和小组件，避免把增长改版耦合进已有工作台核心。

**Tech Stack:** React 19、TypeScript、Vite、Plotly.js、Node built-in test runner

---

### Task 1: 为样例数据与首页文案建立可测试的纯函数入口

**Files:**
- Modify: `src/lib/upload.ts`
- Create: `src/lib/sampleData.ts`
- Test: `tests/upload.test.ts`

- [ ] 为首页首屏新增一组独立于现有上传按钮的文案字段，覆盖 Hero 标题、副标题、样例入口标题与快捷项标签。
- [ ] 先在 `tests/upload.test.ts` 写失败测试，断言新文案结构在中英文至少存在且默认中文可用。
- [ ] 新建 `src/lib/sampleData.ts`，定义样例数据元信息数组与读取函数签名，优先用纯函数描述文件名、标题、说明，避免一开始把 fetch 和 UI 强耦合。
- [ ] 运行 `node --test --experimental-strip-types ./tests/upload.test.ts`，确认新增断言先失败。
- [ ] 写最小实现，让首页文案和样例元信息测试转绿。

### Task 2: 把无数据状态改造成首页态并接入 Sample Data

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/HomeHero.tsx`
- Modify: `src/components/FileUploader.tsx`
- Modify: `src/i18n/dictionaries/en.ts`
- Modify: `src/i18n/dictionaries/zh-CN.ts`
- Modify: `src/i18n/dictionaries/ja-JP.ts`
- Create: `public/samples/*.csv`

- [ ] 新增首页态组件 `HomeHero`，承载 Hero、价值点、主 CTA、次 CTA 和样例入口。
- [ ] 在 `App.tsx` 中用 `!hasDatasets` 切换到首页态，而不是当前的单一上传面板。
- [ ] 给首页态接入 Sample Data 点击逻辑，点击后直接走现有数据导入和默认建图路径。
- [ ] 维持当前工作台态不变，避免这一步连带改动 DashboardCanvas、Inspector 和筛选逻辑。
- [ ] 补最小交互验证，确保样例数据进入后会创建默认图卡并切到可用工作台。

### Task 3: 统一图片导出为白底并优化下载文件名

**Files:**
- Modify: `src/components/PlotCanvas.tsx`
- Create: `src/lib/chartExport.ts`
- Test: `tests/workbench.test.ts`

- [ ] 抽出图表导出选项构造逻辑到 `src/lib/chartExport.ts`，避免把导出参数散落在 `PlotCanvas.tsx`。
- [ ] 先在 `tests/workbench.test.ts` 写失败测试，覆盖白底 PNG 导出配置与文件名清洗。
- [ ] 导出策略统一为：复制成功、复制失败回退下载、直接下载都输出白底 PNG。
- [ ] 文件名采用 `joplot-<sanitized-title-or-kind>-YYYY-MM-DD.png` 结构。
- [ ] 运行对应测试，确认从失败变为通过。

### Task 4: 补验证并控制回归面

**Files:**
- Test: `tests/upload.test.ts`
- Test: `tests/workbench.test.ts`

- [ ] 运行 `node --test --experimental-strip-types ./tests/upload.test.ts ./tests/workbench.test.ts`
- [ ] 再运行全量 `node --test --experimental-strip-types ./tests/*.test.ts`
- [ ] 手动验证首页上传、样例进入、复制图片、下载图片四条路径。
- [ ] 只有在测试和最小手动验证都通过后，才继续下一轮增长改版能力。
