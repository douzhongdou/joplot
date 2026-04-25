# 新图表类型与数据视图设计

日期：2026-04-25

## 目标

扩展 joplot 的图表类型和数据浏览能力：

1. 新增三种图表类型：面积图、雷达图、热力图
2. 现有折线图默认绘制模式改为平滑曲线（spline），用户可在显示设置中切换折线/平滑曲线
3. 新增"数据视图"，在 Navbar 中与"图表视图"并列切换，提供虚拟滚动的表格浏览能力

## 设计原则

- 平滑曲线不作为独立图表类型，而是折线图的 drawMode 变体
- 数据视图复用现有 useCsvData hook 的 datasets 数据，不引入新的数据管线
- 新图表类型遵循现有 ChartCard → PlotCanvas → Plotly 的渲染路径
- TanStack Table + react-virtual 处理大数据量表格，保持现有精简依赖风格

---

## 一、视图模式切换

### Navbar 标签

在 `AppNavbar` 中新增"图表 | 数据"切换标签，管理 `viewMode: 'chart' | 'data'` 状态。

- 默认 `'chart'`，保持现有 DashboardCanvas + CardInspector 布局不变
- 切到 `'data'` 时：
  - 内容区替换为 `DataView` 组件
  - CardInspector 隐藏（数据视图不需要图表配置面板）
  - 搜索栏、聚合面板等图表专属 UI 隐藏

### 状态管理

`viewMode` 状态在 App 组件中管理，通过 props 传递给 AppNavbar 和内容区。不需要持久化到 localStorage（会话内保持即可）。

---

## 二、数据视图组件

### 组件结构

```
DataView（新增）
├── 文件 Tab 列表（横向滚动）
│   ├── 长文件名截断 + title 属性显示全名
│   ├── 滚动渐变遮罩提示可滚动
│   └── 点击切换 activeDatasetId
└── DataTable（新增，基于 TanStack Table + react-virtual）
    ├── 列头：可点击排序（升序/降序/原始）
    ├── 列宽：拖拽调整
    ├── 行：虚拟滚动，只渲染可见 ~20-30 行 DOM
    └── 底部状态栏：显示总行数、当前可见范围
```

### 新增依赖

- `@tanstack/react-table`：表格逻辑、排序、列配置
- `@tanstack/react-virtual`：虚拟滚动

总增量约 30KB，与现有精简风格一致。

### 数据源

直接使用 `useCsvData` hook 已有的 `datasets` 数组。每个 dataset 的 `rows[].raw` 是 `Record<string, string>` 格式，直接喂给 TanStack Table 作为数据源。

列定义从 `dataset.headers` 动态生成，每列配置：
- `accessorKey`：header 名称
- `header`：显示名称（同 accessorKey）
- `cell`：渲染原始字符串值

### 文件 Tab 滚动

- 容器 `overflow-x: auto`，`scrollbar-width: thin`
- Tab 项 `max-width: 160px`，超出部分 `text-overflow: ellipsis`
- CSS 渐变遮罩：左右边缘半透明渐变表示可滚动

---

## 三、新增图表类型

### 类型扩展

在 `ChartKind` 类型中新增：

```typescript
export type ChartKind = 'line' | 'scatter' | 'bar' | 'stats' | 'area' | 'radar' | 'heatmap'
```

### DrawMode 扩展

新增 `'spline'` 选项，并改为默认值：

```typescript
export type DrawMode = 'lines' | 'spline' | 'lines+markers' | 'markers'
```

### 各类型实现细节

#### 面积图 `'area'`

- Plotly trace 类型：`scattergl`
- `fill: 'tozeroy'`（填充到 Y=0）
- 支持 drawMode（lines/spline/markers）
- 支持 raw 模式和 aggregate 模式，与现有折线图数据管线一致
- 默认布局：与折线图相同（12 列宽，7 行高）

#### 雷达图 `'radar'`

- Plotly trace 类型：`scatterpolar`
- `fill: 'toself'`（填充闭合区域）
- 数据结构：X 列值作为角度（theta），Y 列值作为半径（r）
- 仅支持 raw 模式（聚合模式不适合雷达图的多维度对比语义）
- 每个系列自动闭合（最后一个点连回第一个点）
- 默认布局：正方形（6 列宽，6 行高）

#### 热力图 `'heatmap'`

- Plotly trace 类型：`heatmap`
- 需要二维数值矩阵
- 配置项：X 轴字段、Y 轴字段、值字段、聚合函数（sum/mean/count）
- 对原始数据按 X×Y 分组聚合生成矩阵
- 支持 colorscale 配置
- 默认布局：较大（10 列宽，8 行高）

### 平滑曲线（DrawMode `'spline'`）

- 不新增 ChartKind
- 在 `scattergl` trace 上设置 `line.shape: 'spline'`
- 默认 drawMode 改为 `'spline'`（createCard 中 scatter 除外，scatter 仍默认 'markers'）
- CardInspector 显示设置中"绘制模式"选项：
  - 折线（lines）
  - 平滑曲线（spline）— 默认选中
  - 折线+标记点（lines+markers）
  - 仅标记点（markers）

---

## 四、i18n 扩展

三个字典文件需要新增翻译键：

**chartKinds：**
- `area`：面积图 / Area Chart / エリアチャート
- `radar`：雷达图 / Radar Chart / レーダーチャート
- `heatmap`：热力图 / Heatmap / ヒートマップ

**drawModes：**
- `lines`：折线 / Straight Lines / 直線
- `spline`：平滑曲线 / Smooth Curve / スムーズカーブ
- `lines+markers`：折线+标记 / Lines + Markers / 直線+マーカー
- `markers`：仅标记 / Markers Only / マーカーのみ

**dataView：**
- `tabLabel`：数据 / Data / データ
- `emptyState`：请先上传数据文件 / Upload a data file first / データファイルを先にアップロードしてください

---

## 五、受影响的文件

| 文件 | 改动 |
|------|------|
| `src/types.ts` | ChartKind 新增 area/radar/heatmap；DrawMode 新增 spline |
| `src/App.tsx` | 新增 viewMode 状态；条件渲染 DataView |
| `src/components/AppNavbar.tsx` | 新增图表/数据切换标签 |
| `src/components/ChartCard.tsx` | 新增 area/radar/heatmap 渲染分支；spline drawMode 处理 |
| `src/components/CardInspector.tsx` | drawMode 选项更新；新增图表类型的配置项 |
| `src/components/WorkbenchHeader.tsx` | 新增图表类型的添加选项 |
| `src/lib/workbench.ts` | createCard 默认 drawMode 改为 spline；新增类型的默认配置 |
| `src/components/DataView.tsx` | **新增**，数据视图主组件 |
| `src/components/DataTable.tsx` | **新增**，TanStack Table 虚拟滚动表格 |
| `src/i18n/dictionaries/*.ts` | 三个字典新增翻译 |
| `package.json` | 新增 @tanstack/react-table、@tanstack/react-virtual |

---

## 六、实现顺序

1. TanStack Table 依赖安装 + DataTable 组件
2. DataView 组件 + 文件 Tab 列表
3. AppNavbar 视图切换 + App 状态管理
4. DrawMode 扩展（spline）+ 默认值修改
5. 面积图（最简单的 Plotly 改动）
6. 雷达图
7. 热力图（含聚合逻辑）
8. i18n 翻译
9. 测试

## 七、测试策略

- `tests/workbench.test.ts`：createCard 默认 drawMode 变化、新增类型的卡片创建
- `tests/dataTable.test.ts`：DataTable 组件的排序、列宽、虚拟滚动逻辑
- `src/components/__tests__/`：新组件的渲染测试（如需要）
- 手动测试：大数据量 CSV（10万+行）的 Data View 性能
