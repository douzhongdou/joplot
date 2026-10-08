# ROI 模型与工具栏

本文记录「顶部工具栏 + 选区（ROI）」这一层的设计与 ImageJ 的对应关系。
与 `stack-architecture-decision.md` 的关系：那篇管**取页与渲染**，这篇管**选区与工具**。

调查对象为本地 ImageJ 1.54u 源码（`ij/`），行号可复查。

## 1 ImageJ 的工具栏

`ij/gui/Toolbar.java:24-38` 定义 15 个工具位：

```
RECTANGLE=0  OVAL=1  POLYGON=2  FREEROI=3  LINE=4  POLYLINE=5  FREELINE=6
POINT=7(也叫 CROSSHAIR)  WAND=8  TEXT=9  UNUSED=10  MAGNIFIER=11  HAND=12
DROPPER=13  ANGLE=14
```

一个图标其实是**工具族**，`Toolbar.getName()`（`:821-850`）按内部模式返回具体名字：

| 图标位 | 子类型 |
| --- | --- |
| 矩形 | `rectangle` / `roundrect` / `rotrect` |
| 椭圆 | `oval` / `ellipse` / `brush` |
| 直线 | `line` / `arrow` |
| 点 | `point` / `multipoint` |

切换靠**双击同一图标**（`DOUBLE_CLICK_THRESHOLD = 650`，`:47`；判定在 `:1224`），
且 `setTool` 专门给 `RECTANGLE / OVAL / POINT` 开了"允许重复点击"的例外（`:858`）。

## 2 我们的工具集

`lib/tools.ts` 用注册表描述 11 个工具（覆盖 ImageJ 上表中除 `WAND/TEXT/UNUSED`
之外的全部，外加把 `HAND/MAGNIFIER` 做成显式工具）：

| 工具 | 交互模型 | 产出 | 快捷键 |
| --- | --- | --- | --- |
| Pan | `pan` | — | `h` |
| Zoom | `zoom` | — | `z` |
| Color picker | `pick` | — | `i` |
| Rectangle | `drag` | `rectangle` | `r` |
| Oval | `drag` | `oval` | `o` |
| Line / **Arrow** | `drag` | `line` | `l` |
| Polyline | `multi` | `polyline` | `p` |
| Polygon | `multi` | `polygon` | `g` |
| Freehand | `freehand` | `freehand` | `f` |
| Point / **Multi-point** | `dot` | `point` | `t` |
| Angle | `multi` | `angle` | `a` |

`interaction` 决定 `ImageViewport` 如何解释指针事件，`roiKind` 决定产出类型。
子类型沿用 ImageJ 的**双击图标切换**（加粗项），快捷键是我们额外加的。

双击判定用「时间 + 位置」（`DOUBLE_CLICK_MS = 500`）而不是 `PointerEvent.detail`：
后者在注入事件下不可靠（实测双击收尾会多落一个顶点）。

## 3 ROI 模型（`lib/roi.ts`）

判别联合，对齐 `ij/gui/Roi.java:51-52` 的类型体系但只保留两类本质：

- **填充区域**：`rectangle` / `oval` / `polygon` / `freehand`
- **笔画**：`line` / `polyline` / `angle` / `point`

三个核心能力（这是把旧的 `Rect` 升级掉的原因——**ROI 不等于它的包围盒**）：

| 函数 | 语义 | 用途 |
| --- | --- | --- |
| `roiBounds` | 包围盒 | 分配缓冲、裁剪、显示范围 |
| `roiContains` | 逐像素判定（严格，像素中心） | 稀疏遍历 |
| `roiMask` | 包围盒内的 `Uint8Array` 掩码 | 统计、分析、算子 |
| `roiHit` | 手选命中（带容差） | 选中/拖动已有 ROI |

性能取法：多边形/手绘用**扫描线填充**（`fillPolygon`，O(行 × 边)），
线/折线/角度用**笔画光栅化**（`strokeSegments`，只在每条线的包围盒内判定），
椭圆用解析判定。`roiMask` 与 `roiContains` 的一致性由测试逐像素固定。

手柄规则：矩形/椭圆给 8 个（四角 + 四边中点，拖角保持对角锚点），
点序列类给每个顶点，**自由手绘不给手柄**（顶点可能上百个，ImageJ 也只在
ROI Manager 里编辑它们）；仍可整体拖动。

## 4 掩码语义接进了哪些地方

| 位置 | 变化 |
| --- | --- |
| `lib/processor.ts` | `histogram` / `measure` / `applyWithinRoi` 按掩码；`cropImage` 按包围盒（裁剪本就是矩形）；矩形仍走整行快路径 |
| `lib/rgb.ts` | `cropRgb` 按包围盒 |
| `engine/analysis.ts` | `analyzeBlock` 按掩码遍历；线/折线/角度 ROI 的 `profile` 改为**沿线采样**（ImageJ 的 Plot Profile 语义） |
| `engine/analysis.worker.ts` | 协议传 ROI 几何（几十字节）而非掩码位图；粒子统计把 ROI 外像素清零 |
| `engine/compute/pureOps.ts` | `crop` 接受 ROI（取包围盒） |
| `ImageViewport` | 交互按工具分派；选区改用 **SVG 叠加层**（`roiPathData`，与 canvas 同一套相机换算） |

`RoiInput = Rect | Roi` 是迁移期双收类型：旧调用点可以逐个换，不必一次性改完。

## 5 明确没做的部分

- **算子作用域仍是矩形**：`recipe.ts` 的 `{ kind: 'roi'; region }` 与 `engine` 的
  `Region` 都是矩形，所以「应用到 ROI」目前按**包围盒**生效（椭圆/多边形会多改到
  包围盒内、形状外的像素）。要让算子也吃掩码，得把 ROI 几何放进 step scope 并让
  引擎侧重建掩码——这是下一步。
- **ROI Manager**：状态仍是单个 `roi`，但所有函数是纯函数且 ROI 带 `id`，
  换成 `Roi[]` 即可支持多 ROI 列表 / 批量测量 / 导出。
- **会改像素的工具**（ImageJ 的 `TEXT`、`WAND` 填充、画笔）与经典版的工具栏
  （`ImageJApp.tsx` 仍是 `pan | roi` 两态）都未纳入本轮。

## 6 实测（真实 Chrome，走 dev server）

用 CDP 驱动真实浏览器（12 张 4096×3072 JPEG 之一）：

- 工具栏 11 个工具渲染正确，默认选中 Rectangle（与 ImageJ 一致）；
- 快捷键 `o` `p` `f` `l` `r` 全部切换成功；
- 矩形/椭圆拖拽产出选区，SVG 路径与 8 个手柄正确，状态栏显示
  `Rectangle · 1231×862 @ (443, 222)`；
- 多边形逐点构造时显示**虚线橡皮筋预览**，双击（或点回起点）提交为 4 顶点多边形；
- 自由手绘走完一圈后提交为闭合区域，且**不显示顶点手柄**；
- 双击直线图标后工具名变为 `Arrow`，用箭头画线成功。

验收截图见 `.tmp-shot/roi-toolbar-*.png`（临时产物，不入库）。

## 7 切片栏的位置

切片控件（轴名 + 上一片/下一片 + 滑块 + `i / n`）原先挤在顶部工具栏里，现已移出，
成为**图像窗口自己的一条矮栏**（每轴一行 24px），位置在视口**下方**、tab 栏之外。

这与 ImageJ 一致：`ImageWindow` 用自定义 `ImageLayout`（`ImageWindow.java:93`
`setLayout(new ImageLayout(ic))`），`ImageLayout.moveComponents`（`:59-70`）把第 0 个
组件当画布、其余组件依次排在它下面，窗口高度再按 `getMaximumBounds`
（`ImageWindow.java:556-564`）把每个滚动条的高度累加进 `extraHeight`。
控件本身也对应它的 `ScrollbarWithLabel`：轴名 + 滚动条 + 位置读数。

多轴 hyperstack（c/z/t）时每轴独占一行，因此仍是一条矮栏，不会挤压图像。
翻页在途时页码显示 `…`（架构方案第 1 节禁止"新页码配旧像素"）。

实测（真实 Chrome，12 页 Stack）：切片栏行顶 `880` vs 视口底 `879`，即紧贴视口下方；
行高 24px；工具栏内已无滑块；滚轮翻 5 次后滑块与页码同步为 `6 / 12`。

## 8 顶栏的分区纪律

顶栏（`ScientificImageWorkspace.tsx` 里传给 `AppNavbar` 的 `toolbar`）只有三种按钮规格，
新控件必须落进其中一种，否则又会滑回"五花八门"：

| 规格 | 用在哪 | 外观 |
| --- | --- | --- |
| 主操作 | 打开图片 | 顶栏唯一的实心 `primary` 按钮 |
| 图标项 | 工具 11 个、缩放步进、适应窗口 | 药丸内的 28×28 图标按钮 |
| 文字项 | 彩色 / 灰度 / 原图、清除 ROI | 药丸内的文字按钮 |

三条约束：

1. **一个药丸里只用一种语汇**：工具与缩放是图标语汇，显示是文字语汇，两者不装进同一个容器。
   顶栏不再出现 `outline` 描边按钮（描边留给侧栏与对话框）。
2. **层级只用两种手段**：药丸 = 一组控件，间距 = 组与组的分界。
   `ToolFamilyDivider` 那根短线**只在药丸内部**划分工具族 —— 它曾经和"分区分隔线"长得一模一样，
   两个层级因此分不出来，顶栏越划越碎。
3. **一项一个反馈**：hover 与激活共用 `TOOLBAR_ITEM` / `TOOLBAR_ITEM_ON`
   （浮起一层 `bg-base-100`，激活留在那一层并提亮文字）。过去工具项走 ghost 自带的
   `bg-accent`、缩放项写死 `bg-base-100`，同一排里两套 hover。

窄屏（< 1280px，即 Tailwind `xl` 以下）时「显示」这一组折进 `⋯` 菜单，两处共用同一份状态：
1440 下顶栏内容约 750px，1024 视口不再需要横向滚动。

缩放读数（`46%`）**本身就是**过去的「1:1」按钮 —— 两者语义重复，所以点读数即回到实际像素。
「清除 ROI」只在真的有选区时渲染，位置紧挨右侧的选区读数。
