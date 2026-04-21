# CSV 可视化工作台 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前单图 CSV 原型重构为可运行的通用 CSV 可视化工作台 MVP。

**Architecture:** 保留 Vite + React + TypeScript，移除当前不稳定的 Tailwind 插件链路。围绕“数据集 + 全局筛选 + 多图卡 + 图卡内配置”建立新的前端状态模型，并把默认成图、统计卡、筛选和抽样逻辑下沉到纯函数工具中。

**Tech Stack:** React 19、TypeScript、Vite、Plotly.js、PapaParse、Node 内建 test runner

---

### Task 1: 建立纯函数工作台模型

**Files:**
- Create: `tests/workbench.test.ts`
- Create: `src/lib/workbench.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: 写失败测试，覆盖默认图卡、筛选和统计行为**

编写以下测试场景：

- 默认图卡使用第一列作为 X，优先第二列作为 Y，不可用时回退到首个数值列
- 数值非法值按空处理
- 组合筛选可过滤文本和数值
- 统计卡汇总忽略空值
- 超过阈值时触发抽样

- [ ] **Step 2: 运行测试，确认正确失败**

Run: `node --test --experimental-strip-types tests/workbench.test.ts`

Expected: 测试因 `src/lib/workbench.ts` 尚不存在或导出缺失而失败。

- [ ] **Step 3: 实现最小工作台纯函数与类型**

实现内容：

- CSV 行归一化
- 默认图卡推断
- 筛选应用
- 指标统计
- 抽样

- [ ] **Step 4: 重新运行测试，确认通过**

Run: `node --test --experimental-strip-types tests/workbench.test.ts`

Expected: 全部测试通过。

- [ ] **Step 5: 检查类型**

Run: `pnpm.cmd exec tsc --noEmit`

Expected: 与该任务相关的类型声明通过。

### Task 2: 重建数据加载与页面骨架

**Files:**
- Modify: `src/hooks/useCsvData.ts`
- Modify: `src/App.tsx`
- Modify: `src/index.css`
- Modify: `index.html`
- Modify: `vite.config.ts`
- Modify: `package.json`

- [ ] **Step 1: 去除阻塞 `dev/build` 的 Tailwind 依赖链**

移除 Tailwind Vite 插件和 `@import "tailwindcss"`，把页面样式切换为普通 CSS。

- [ ] **Step 2: 调整 CSV hook，输出适合工作台使用的数据集结构**

确保 hook 返回：

- 表头
- 原始行
- 归一化行
- 数值列列表
- 行数

- [ ] **Step 3: 重写 App 为工作台入口**

建立页面结构：

- 顶部标题与说明
- 上传区
- 全局筛选区
- 图卡工具栏
- 多图卡网格

- [ ] **Step 4: 本地验证开发启动**

Run: `pnpm.cmd dev`

Expected: Vite 能启动且不再报 Tailwind 配置错误。

### Task 3: 实现图卡与 Plotly 渲染层

**Files:**
- Create: `src/components/PlotCanvas.tsx`
- Create: `src/components/WorkbenchToolbar.tsx`
- Create: `src/components/FilterBar.tsx`
- Create: `src/components/ChartCard.tsx`
- Modify: `src/components/FileUploader.tsx`

- [ ] **Step 1: 用 Plotly.js 封装自定义画布组件**

避免依赖缺失的 `react-plotly.js`，改用 `plotly.js` + `useEffect` 渲染。

- [ ] **Step 2: 实现图卡工具栏**

支持新增：

- 折线图
- 散点图
- 柱状图
- 统计卡

- [ ] **Step 3: 实现全局筛选条**

支持增删筛选条件，以及文本/数值运算符。

- [ ] **Step 4: 实现图卡内配置**

支持：

- 标题编辑
- 图表类型切换
- X/Y 列选择
- 复制
- 删除

- [ ] **Step 5: 验证上传后默认成图与新增图卡**

Run: `pnpm.cmd exec tsc --noEmit`

Expected: 组件组合后的类型通过。

### Task 4: 加入持久化与 MVP 收口

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/lib/workbench.ts`

- [ ] **Step 1: 接入本地持久化**

使用 `localStorage` 保存：

- 图卡配置
- 全局筛选条件

- [ ] **Step 2: 新文件加载时做兼容恢复**

列名匹配不上时回退默认配置，不让界面因旧配置失效。

- [ ] **Step 3: 收口空态、异常态与提示文案**

确保以下状态清晰可用：

- 未上传文件
- 无有效数据
- 没有可绘制数值列

- [ ] **Step 4: 运行最终验证**

Run:

- `node --test --experimental-strip-types tests/workbench.test.ts`
- `pnpm.cmd exec tsc --noEmit`
- `pnpm.cmd build`

Expected:

- 纯函数测试通过
- 类型检查通过
- 前端构建通过

## 风险与缓解

- Plotly 大数据渲染风险：通过统一抽样函数限制点数。
- 配置恢复兼容性风险：按列名恢复，找不到时回退默认图卡。
- 旧原型逻辑残留风险：App 主入口重写，不继续复用单图状态模型。

## 验证步骤

- 上传样例 CSV，确认自动出现默认折线图
- 新增散点图、柱状图、统计卡各一张
- 添加一条文本筛选和一条数值筛选，确认所有图卡同步变化
- 刷新页面后重新上传兼容 CSV，确认图卡配置恢复
