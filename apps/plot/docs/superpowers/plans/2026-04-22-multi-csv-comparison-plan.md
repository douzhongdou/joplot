# 多 CSV 对比与叠图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持一次性导入多个 CSV，并允许同一张图卡叠加多个 CSV 的数据系列进行对比

**Architecture:** 将单数据集工作台升级为多数据集工作台。图卡改为持有多个 series，每个 series 指向一个数据集和一个 Y 列，而图卡自身统一控制公共 X 轴与图表类型。筛选改为按数据集独立存储与应用。

**Tech Stack:** React 19、TypeScript、Vite、Plotly.js、PapaParse、Node 内建 test runner

---

### Task 1: 建立多 CSV 与多系列纯函数模型

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/workbench.ts`
- Modify: `tests/workbench.test.ts`
- Modify: `src/lib/upload.ts`
- Modify: `tests/upload.test.ts`

- [ ] 定义数据集 id、图卡 series、按数据集筛选的核心类型
- [ ] 先写失败测试，覆盖多 CSV 提取、默认图卡 series、追加 series、筛选隔离
- [ ] 运行测试，确认因为实现缺失或旧模型不兼容而失败
- [ ] 实现最小纯函数让测试通过
- [ ] 重跑上传与工作台测试确认转绿

### Task 2: 升级 CSV 解析入口为多数据集模式

**Files:**
- Modify: `src/hooks/useCsvData.ts`
- Modify: `src/App.tsx`

- [ ] 将单文件解析升级为多文件解析
- [ ] 让拖拽和点击上传都接受多个 CSV
- [ ] 在应用状态中维护 `datasets` 与 `activeDatasetId`
- [ ] 把旧的单 `csv` 状态迁移到多数据集状态

### Task 3: 接入多数据集筛选与侧栏管理

**Files:**
- Create: `src/components/DatasetSidebar.tsx`
- Modify: `src/components/WorkbenchToolbar.tsx`
- Modify: `src/components/FilterBar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`

- [ ] 新增数据集列表区
- [ ] 支持切换当前激活数据集
- [ ] 让筛选面板编辑当前激活数据集自己的筛选条件
- [ ] 更新侧栏摘要以显示当前数据集上下文

### Task 4: 升级图卡与配置区为多系列模式

**Files:**
- Modify: `src/components/ChartCard.tsx`
- Modify: `src/components/CardInspector.tsx`
- Modify: `src/App.tsx`

- [ ] 图卡渲染多个 series
- [ ] 图卡配置区支持新增、修改、删除 series
- [ ] 统计卡保持单 series 模式
- [ ] 无效 series 只跳过渲染，不让整张图卡报错

### Task 5: 最终验证

**Files:**
- Review only

- [ ] 运行 `node --test tests/upload.test.ts`
- [ ] 运行 `node --test tests/workbench.test.ts`
- [ ] 运行 `pnpm exec tsc --noEmit`
- [ ] 运行 `pnpm build`

## 风险

- 多数据集与旧持久化结构混用时，恢复逻辑需要谨慎回退
- 图卡多 series 后，配置区复杂度会明显上升，必须保持信息结构清晰
- Plotly 图例与颜色配置在多系列场景下更容易混乱，需要控制首版复杂度

## 验收标准

- 一次可拖入多个 CSV
- 右侧能看到多个数据集条目并切换当前激活数据集
- 同一张折线图、散点图或柱状图可显示来自多个 CSV 的多个 series
- 每个 series 使用自己的数据集和 Y 列
- 图卡通过公共 X 列进行对齐
- 每个数据集有自己的筛选条件
