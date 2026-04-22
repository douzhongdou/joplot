# joplot Tailwind 全量迁移与主题系统重构设计

## 背景

当前 joplot 的 UI 样式主要集中在 [src/index.css](D:/HQL/code/tool/joplot/src/index.css) 中，组件层仍然大量依赖业务型 class 名和集中式样式定义。这种结构在快速迭代阶段可用，但已经出现几个明显问题：

- 样式入口过于集中，后续人工调整成本高
- 主题能力薄弱，不利于扩展浅色、深色和品牌主题
- 组件之间的视觉规范不够统一，局部交互样式容易漂移
- 筛选逻辑当前按数据集分别生效，和多 CSV 对比场景的用户心智不一致

本次改造目标是把项目 UI **全量迁移到 Tailwind utility 驱动**，同时引入 **daisyUI 主题变量规范** 作为全局主题 token 底座，并顺手把筛选逻辑重构为工作台级共享筛选。

## 目标

### 样式系统目标

- 页面 UI 主体样式迁移到 Tailwind class
- 不再让 [src/index.css](D:/HQL/code/tool/joplot/src/index.css) 承担整站业务样式
- 使用 daisyUI theme token 作为主题变量规范
- 为未来浅色、深色和品牌主题切换预留统一入口
- 避免继续散落硬编码颜色值

### 交互目标

- 工作台筛选逻辑切换为 **全局共享筛选**
- 支持筛选条件关系切换：`全与` / `全或`
- 取消顶部重复的筛选条件药丸显示
- 统一工作台按钮视觉，解决“添加组件”和“筛选”样式不一致的问题

## 非目标

- 本次不引入完整的 daisyUI 组件体系
- 本次不实现主题切换器 UI
- 本次不实现复杂筛选分组、嵌套逻辑、括号优先级
- 本次不重构 Plotly 图表绘制内核

## 设计原则

1. **主题变量使用 daisyUI 规范**
   页面颜色 token 使用 `--color-base-*`、`--color-primary`、`--color-success` 这类命名，不额外引入 `--color-primary-hover` 一类状态变量。

2. **状态通过 Tailwind 表达**
   悬停、激活、禁用、focus ring 等状态统一通过 Tailwind 状态类表达，如 `hover:bg-primary/10`、`focus-visible:ring-primary/30`，而不是再派生 hover token。

3. **图表颜色和 UI 语义色分离**
   UI 的 `primary / secondary / accent / success` 不直接等于图表系列色。图表保留独立 chart token，保证主题切换时可读性稳定。

4. **组件迁移以结果全量 Tailwind 为目标**
   实现过程允许分层改造，但最终页面主要样式应由 Tailwind utility 表达，旧业务型 CSS 应尽量清空。

## 主题系统设计

### daisyUI 风格主题变量

本次采用 **daisyUI 变量命名规范 + 自实现 theme token 映射层**，而不是直接依赖 daisyUI plugin。原因是当前项目使用的 Tailwind / Vite 组合下，daisyUI plugin 会带来额外兼容成本，而项目真正需要的是：

- 一套稳定的主题变量命名
- Tailwind utility 能直接消费这些变量
- 不把组件实现绑死到 daisyUI 组件类

至少定义两套主题：

- `light`：默认主题
- `dark`：预留暗色主题

核心 token 采用以下集合：

- `--color-base-100`
- `--color-base-200`
- `--color-base-300`
- `--color-base-content`
- `--color-primary`
- `--color-primary-content`
- `--color-secondary`
- `--color-secondary-content`
- `--color-accent`
- `--color-accent-content`
- `--color-neutral`
- `--color-neutral-content`
- `--color-info`
- `--color-info-content`
- `--color-success`
- `--color-success-content`
- `--color-warning`
- `--color-warning-content`
- `--color-error`
- `--color-error-content`
- `--radius-selector`
- `--radius-field`
- `--radius-box`
- `--size-selector`
- `--size-field`
- `--border`
- `--depth`
- `--noise`

### 图表主题 token

图表额外定义独立 token：

- `--chart-1`
- `--chart-2`
- `--chart-3`
- `--chart-4`
- `--chart-5`
- `--chart-6`
- `--chart-grid`
- `--chart-axis`
- `--chart-selection`

用途：

- 折线、散点、柱图的系列主色
- 坐标轴和网格线颜色
- 选中图卡的强调边框

### 结构 token

补充少量布局型 CSS 变量，供 Tailwind 的 arbitrary value 使用：

- `--navbar-height`
- `--inspector-width`
- `--dashboard-row-height`

这类变量不是颜色 token，但有助于保留整体结构稳定性。

## 样式迁移范围

### 需要迁移的组件

- [src/App.tsx](D:/HQL/code/tool/joplot/src/App.tsx)
- [src/components/AppNavbar.tsx](D:/HQL/code/tool/joplot/src/components/AppNavbar.tsx)
- [src/components/FileUploader.tsx](D:/HQL/code/tool/joplot/src/components/FileUploader.tsx)
- [src/components/WorkbenchHeader.tsx](D:/HQL/code/tool/joplot/src/components/WorkbenchHeader.tsx)
- [src/components/CardInspector.tsx](D:/HQL/code/tool/joplot/src/components/CardInspector.tsx)
- [src/components/ChartCard.tsx](D:/HQL/code/tool/joplot/src/components/ChartCard.tsx)
- [src/components/DashboardCanvas.tsx](D:/HQL/code/tool/joplot/src/components/DashboardCanvas.tsx)
- [src/components/PlotCanvas.tsx](D:/HQL/code/tool/joplot/src/components/PlotCanvas.tsx)

### 保留少量全局样式的内容

[src/index.css](D:/HQL/code/tool/joplot/src/index.css) 最终只保留：

- Tailwind / daisyUI 主题接入
- 主题变量定义
- `html / body / #root` 基础层
- 极少量第三方样式兼容
- 必要的 Plotly 容器覆盖

## 组件层设计

### App Shell

- 用 Tailwind 重建整体两栏结构
- 主画布和右侧 inspector 通过 `grid` 或 `flex` 组合实现
- 响应式下保留现有单列回落行为

### Navbar

- 保留品牌区、状态文本、上传入口
- 改为纯 Tailwind utility
- 顶部品牌图标继续使用 [src/icon.svg](D:/HQL/code/tool/joplot/src/icon.svg)

### Workbench Header

调整为：

- 标题区：仪表盘标识
- 操作区：`添加组件 / 筛选 / 主题`
- 数据上下文区：`焦点数据集 / 当前组 / 范围`
- 筛选面板：统一承载全部筛选配置

具体变化：

- 移除顶部筛选药丸显示
- 添加组件和筛选按钮统一为同一按钮体系
- 筛选关系切换放入筛选面板头部

### Card Inspector

- 保留 `基础配置 / 显示设置`
- 延续当前单系列两行结构
- 所有输入、下拉、按钮改用 Tailwind utility

### Chart Card

- 图卡头部改为更稳定的 Tailwind 栅格结构
- drag handle、toolbar、resize handle 保持统一 icon 风格
- plot toolbar 继续保留复制成功提示

## 筛选逻辑重构

### 当前问题

当前筛选是按数据集分别生效：

- 状态结构是 `filtersByDataset`
- 当前选中的 `activeDataset` 决定你编辑的是哪一组筛选
- 多 CSV 叠图时，不是同一套筛选作用到所有系列

这不符合工作台对比场景。

### 新模型

改为工作台级筛选：

- `workspaceFilters: FilterRule[]`
- `filterJoinOperator: "and" | "or"`

行为规则：

1. 所有筛选条件默认作用于当前工作台中的所有数据集
2. 某数据集如果没有该字段，则跳过该条件，不报错
3. 所有条件关系通过全局关系运算符控制
   - `and`：全部满足
   - `or`：满足任一条件
4. 没有条件时，数据不过滤

### 输入规则

- `contains`：大小写不敏感
- `equals`：字符串严格相等
- `gt / lt / between`：基于数值列比较
- 非法数值输入视为条件不成立

## 数据持久化与兼容

### 新持久化结构

本地存储迁移为：

- `workspaceFilters`
- `filterJoinOperator`
- `activeDatasetId`
- `cards`

### 兼容旧数据

旧数据若存在：

- `filtersByDataset`
- `filters`

迁移策略：

- 优先读取新结构
- 若只有旧结构，则取当前激活数据集或首个数据集对应的过滤条件作为初始 `workspaceFilters`
- 迁移完成后按新结构写回

## 实施顺序

1. 写入 spec 文档
2. 接入 daisyUI 主题 token
3. 精简 [src/index.css](D:/HQL/code/tool/joplot/src/index.css)
4. Tailwind 化 Navbar、FileUploader、App Shell
5. Tailwind 化 WorkbenchHeader 并接入新的筛选 UI
6. 重构筛选数据结构与过滤逻辑
7. Tailwind 化 CardInspector、ChartCard、DashboardCanvas
8. 构建验证

## 风险与控制

### 风险

- 全量迁移 Tailwind 期间可能出现局部布局回归
- Plotly 容器受父层样式影响，容易出现高度塌陷
- 旧持久化结构和新筛选结构转换可能带来状态兼容问题

### 控制策略

- 每完成一个结构层就构建验证
- 保留 Plotly 容器必要的最小兼容样式
- 对旧存储结构做容错迁移

## 验证标准

### 样式层

- 页面主体样式不再依赖旧业务型 class 样式表
- 顶部、工作台 header、右侧 inspector、图卡都以 Tailwind class 为主
- light 主题正常工作，dark 主题定义完整

### 交互层

- 多个筛选条件支持 `AND / OR` 切换
- 顶部不再显示重复筛选药丸
- 添加组件与筛选按钮样式统一
- 多 CSV 图表在同一套筛选条件下同步变化

### 工程层

- `pnpm build` 通过
- 类型检查通过
