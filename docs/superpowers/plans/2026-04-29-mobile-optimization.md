# Joplot Mobile Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Joplot 在手机尺寸下形成“顶部极简、底部导航、底部操作面板、底部抽屉编辑”的完整工作台主流程，同时不破坏桌面端布局。

**Architecture:** 保持现有业务逻辑不变，把移动端优化集中在布局层与交互承载层。桌面端继续使用双栏工作台；移动端保留单栏工作台，但进一步将 `图表 / 数据 / 操作` 收口到底部导航，并把上传、添加组件、筛选、重置统一收纳到底部操作面板中；图卡编辑继续通过底部抽屉承载现有 `CardInspector`。

**Tech Stack:** Next.js、React 19、TypeScript、Tailwind CSS 4、Node test runner

---

### Task 1: 提取移动端布局辅助逻辑

**Files:**
- Create: `src/lib/mobileLayout.ts`
- Create: `tests/mobileLayout.test.ts`
- Test: `tests/mobileLayout.test.ts`

- [ ] **Step 1: 先写失败测试**

覆盖：
- 画布卡片在移动端时转为单列布局
- 桌面端保持原有布局数据
- 选中图卡时能决定是否显示移动端编辑入口

- [ ] **Step 2: 运行测试确认先失败**

Run: `pnpm exec node --experimental-strip-types --test tests/mobileLayout.test.ts`
Expected: 因 `src/lib/mobileLayout.ts` 不存在而失败。

- [ ] **Step 3: 写最小实现**

实现纯函数：
- `isMobileViewport(width)`
- `toResponsiveCardLayout(cards, isMobile)`
- `shouldShowMobileInspector(hasDatasets, selectedCardId, isMobile)`

- [ ] **Step 4: 再跑测试**

Run: `pnpm exec node --experimental-strip-types --test tests/mobileLayout.test.ts`
Expected: 测试通过。

### Task 2: 改造应用壳层与移动端抽屉

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/MobileInspectorDrawer.tsx`
- Modify: `src/components/DashboardCanvas.tsx`
- Test: `tests/mobileLayout.test.ts`

- [ ] **Step 1: 基于测试结果先接入视口判断和单栏布局**

在 `App.tsx` 中：
- 监听视口宽度
- 移动端时改用单栏内容区
- 图卡区和面板区不再同时并列显示

- [ ] **Step 2: 新增移动端底部抽屉组件**

`MobileInspectorDrawer.tsx` 负责：
- 底部浮出
- 遮罩层
- 关闭按钮
- 承载现有 `CardInspector`

- [ ] **Step 3: 改造 `DashboardCanvas` 的小屏布局**

移动端时卡片改为全宽纵向堆叠，不要求复杂拖拽栅格体验。

- [ ] **Step 4: 验证纯逻辑测试仍通过**

Run: `pnpm exec node --experimental-strip-types --test tests/mobileLayout.test.ts`
Expected: 响应式布局辅助逻辑测试通过。

### Task 3: 收敛移动端导航与底部操作面板

**Files:**
- Modify: `src/components/FileUploader.tsx`
- Modify: `src/components/AppNavbar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/WorkbenchHeader.tsx`
- Create: `src/components/MobileBottomNav.tsx`
- Test: `tests/upload.test.ts`

- [ ] **Step 1: 移动端顶部改为极简模式**

要求：
- 顶部不再展示 `图表 / 数据` 导航
- 仅保留品牌和全局轻量入口

- [ ] **Step 2: 新增底部导航栏**

要求：
- 图表 / 数据 通过底部切换
- 操作入口通过底部面板展开

- [ ] **Step 3: 让 `WorkbenchHeader` 可复用到移动端操作面板**

要求：
- 桌面端继续作为顶部工具条
- 移动端仅在底部面板内展示
- 上传、添加组件、筛选、重置能力不丢失

- [ ] **Step 4: 运行上传相关测试**

Run: `pnpm exec node --experimental-strip-types --test tests/upload.test.ts`
Expected: 上传相关纯逻辑测试继续通过。

### Task 4: 优化图卡移动端触摸体验

**Files:**
- Modify: `src/components/ChartCard.tsx`
- Modify: `src/components/CardInspector.tsx`
- Modify: `src/index.css`
- Test: `pnpm build`

- [ ] **Step 1: 调整图卡内容密度和按钮排布**

确保在窄屏下：
- 操作按钮不挤压
- 标题和标签不溢出
- 触摸区足够大

- [ ] **Step 2: 优化 `CardInspector` 在抽屉中的滚动与头部结构**

保证：
- 标签页和按钮在手机上可点击
- 内容区可滚动
- 不出现整页双重滚动冲突

- [ ] **Step 3: 把整宽编辑按钮收敛为小号浮动编辑入口**

要求：
- 只在移动端图表视图下出现
- 不遮挡主要图表内容
- 为底部导航预留安全区

- [ ] **Step 4: 跑构建验证**

Run: `pnpm build`
Expected: 构建通过，无类型和样式集成错误。

### Task 5: 全量验证

**Files:**
- Modify: as needed based on failures
- Test: `tests/*.test.ts`

- [ ] **Step 1: 跑全量测试**

Run: `pnpm test`
Expected: 全部测试通过。

- [ ] **Step 2: 跑生产构建**

Run: `pnpm build`
Expected: 构建通过。

- [ ] **Step 3: 浏览器手测**

Run: `pnpm dev`
Expected:
- 手机宽度下顶部改为轻量模式
- 图表 / 数据 / 操作通过底部导航完成
- 工作台顶部不再长期占据首屏
- 可打开底部操作面板完成上传、添加组件、筛选和重置
- 可打开底部抽屉编辑图表
- 桌面端布局不回归
