# ImageJ Stacks 菜单移植：工作步骤与进度

本文记录把 ImageJ 1.54u 的 `Image ▸ Stacks` 移植到 `apps/image` 主工作台（`/imagej`）的**工作步骤与实时进度**。
每完成一步就更新对应小节；结论性设计写在最后一节。

## 1 基线依据

| 项 | 出处 |
| --- | --- |
| 菜单权威清单 | `IJ_Props.txt:146-182`（`Image/Stacks`、`Image/Stacks/Animation`、`Image/Stacks/Tools` 三个子菜单） |
| 各命令实现 | `ij/plugin/*.java`（逐命令行号见下表的「ImageJ 实现」列） |
| 版本 | `ij/ImageJ.java:81` 声明 `1.54u`；本地 checkout 为 1.54u8（git `4c4975d`，2026.07.22） |
| 本机源码路径 | 各开发机路径不同，统一记录在 [README 的「ImageJ 上游源码路径」](../README.md#imagej-上游源码路径) |

## 2 命令清单与现状

「现状」列只记事实：`已有` = 工作台现有入口可完成同一件事；`本轮` = 本文档进行中的工作；`待做` = 尚无入口。

### 2.1 Image ▸ Stacks（主菜单 17 项）

| # | 命令（菜单原文） | ImageJ 实现 | 现状 | 批次 |
| --- | --- | --- | --- | --- |
| 1 | Add Slice | `ij/plugin/StackEditor.java:30-49` | 已完成（插入空白页，位置可选） | 3 |
| 2 | Delete Slice | `ij/plugin/StackEditor.java:51-71` | 已完成（拒绝删空） | 3 |
| 3 | Next Slice [>] | `ij/plugin/Animator.java:266-293` | 已有（工具栏 T/C/Z 翻页、侧栏 Next Slice、滚轮翻页） | — |
| 4 | Previous Slice [<] | `ij/plugin/Animator.java:295-322` | 已有（同上） | — |
| 5 | Set Slice... | `ij/plugin/Animator.java:362-390` | 已有（工具栏 / 侧栏的切片选择器与滑块） | — |
| 6 | Images to Stack | `ij/plugin/ImagesToStack.java` | 已有（「创建 Stack…」对话框、打开文件夹、右键合并 tab） | — |
| 7 | Stack to Images | `ij/plugin/StackEditor.java:240-310` | 已有（右键「拆分 Stack」、单页「另存为 tab」） | — |
| 8 | Make Montage... | `ij/plugin/MontageMaker.java` | 已完成（含 `Label slices` 标注） | 4 |
| 9 | Reslice [/]... | `ij/plugin/Slicer.java` | 已完成（矩形选区路径；线选区未做） | 4 |
| 10 | Orthogonal Views[H] | `ij/plugin/Orthogonal_Views.java` | 已完成（无十字线覆盖层与联动） | 4 |
| 11 | Z Project... | `ij/plugin/ZProjector.java` | 本轮 | 1 |
| 12 | 3D Project... | `ij/plugin/Projector.java` | 已完成（三轴 × 三方法 × 角度序列 × 深度提示） | 5 |
| 13 | Plot Z-axis Profile | `ij/plugin/ZAxisProfiler.java:209-260` | 本轮 | 1 |
| 14 | Measure Stack... | `ij/plugin/SimpleCommands.java:266-274` + `macros/MeasureStack.txt` | 本轮 | 1 |
| 15 | Label... | `ij/plugin/filter/StackLabeler.java` | 已完成（六种格式；内置点阵，非 ASCII 显示为 `?`） | 5 |
| 16 | Statistics | `ij/plugin/Stack_Statistics.java:12-52` | 本轮 | 1 |

### 2.2 Image ▸ Stacks ▸ Animation（3 项）

| # | 命令 | ImageJ 实现 | 现状 | 批次 |
| --- | --- | --- | --- | --- |
| 17 | Start Animation [\\] | `ij/plugin/Animator.java:99-211` | 已完成（无快捷键，走命令目录） | 5 |
| 18 | Stop Animation | `ij/plugin/Animator.java:84-87` | 已完成 | 5 |
| 19 | Animation Options... | `ij/plugin/Animator.java:233-258` | 已完成（帧率 / 区间 / 折返） | 5 |

### 2.3 Image ▸ Stacks ▸ Tools（12 项）

| # | 命令 | ImageJ 实现 | 现状 | 批次 |
| --- | --- | --- | --- | --- |
| 20 | Combine... | `ij/plugin/StackCombiner.java` | 已完成（水平 / 垂直） | 3 |
| 21 | Concatenate... | `ij/plugin/Concatenator.java` | 已完成（拼接全部已打开文档，小页居中） | 3 |
| 22 | Grouped Z Project... | `ij/plugin/GroupedZProjector.java` | 本轮 | 1 |
| 23 | Insert... | `ij/plugin/StackInserter.java` | 已完成（粘贴位置，越界裁剪） | 3 |
| 24 | Magic Montage Tools | `ij/plugin/SimpleCommands.java:202-212` + `macros/MagicMontageTools.txt` | 已完成（核心动作：按新行列重排蒙太奇） | 5 |
| 25 | Make Substack... | `ij/plugin/SubstackMaker.java` | 已完成（切片表达式，如 `1-3,5`） | 3 |
| 26 | Montage to Stack... | `ij/plugin/StackMaker.java` | 已完成 | 4 |
| 27 | Plot XY Profile | `ij/plugin/StackPlotter.java` | 已完成（产出曲线数据而非栅格图） | 4 |
| 28 | Reduce... | `ij/plugin/StackReducer.java` | 已完成（步长从第 1 页起抽取） | 3 |
| 29 | Remove Slice Labels | `ij/plugin/SimpleCommands.java:160-169` | 已完成 | 5 |
| 30 | Reverse | `ij/plugin/StackReverser.java` | 已完成 | 3 |
| 31 | Set Label... | `ij/plugin/SimpleCommands.java:137-158` | 已完成（当前片，空串即清除） | 5 |

> 标签页右键菜单现有「合并为 Stack / 拆分 Stack / 调整顺序 / 另存为 tab」，覆盖的是 #6、#7 与「重排」；
> ImageJ 的 Add / Delete / Insert / Reduce / Reverse / Combine / Concatenate / Make Substack 还没有对应入口，
> 因此仍列在批次 3。

### 2.4 批次划分

| 批次 | 主题 | 命令 |
| --- | --- | --- |
| 1（本轮） | 跨帧处理 | Z Project、Grouped Z Project、Plot Z-axis Profile、Measure Stack、Statistics |
| 2 | 分析补充 | 与批次 1 同通道的 ROI / 超栈细化（按需） |
| 3 | 栈结构编辑 | Add / Delete / Set Slice、Insert、Reduce、Reverse、Combine、Concatenate、Make Substack |
| 4 | 几何与视图 | Make Montage、Montage to Stack、Reslice、Orthogonal Views、Plot XY Profile |
| 5 | 装饰与动画 | Label、Set Label、Remove Slice Labels、Animation、Magic Montage Tools、3D Project |

## 3 第一批工作步骤（进行中）

| 步骤 | 内容 | 状态 | 验证 |
| --- | --- | --- | --- |
| 1.1 | 取到权威菜单清单与各命令语义（含行号） | 已完成 | `IJ_Props.txt:146-182`；三个调查报告覆盖批次 1-5 的全部命令 |
| 1.2 | `engine/stackStats.ts`：整栈逐页统计内核（逐页 count/mean/min/max/stdDev/median/mode + 合并汇总 + 逐页均值曲线 + 横轴标定） | 已完成 | `tests/imagejStackStats.test.ts`（7 例） |
| 1.3 | 引擎通路：`stack-stats` 请求贯通 `protocol.ts` → `engine.worker.ts` → `host.ts` → `client.ts`（Worker 与主线程回退两条实现） | 已完成 | 同上，含 `EngineHost.stackStats` 端到端用例 |
| 1.4 | `runtime.measureStack()` 与 `RuntimeState.stackStats`（切片 / Recipe 变化自动失效） | 已完成 | `emit()` 集中失效；UI 已接通 |
| 1.5 | `engine/stackProject.ts` + `project` 通路：Z 投影产出新 Dataset（引擎侧注册，像素不跨线程） | 已完成 | `tests/imagejStackProject.test.ts`（7 例） |
| 1.6 | UI：左栏 Stacks 命令目录新增 5 项、Z 投影参数面板、z 轴曲线与两张统计卡片、投影结果另开 tab、中英日文案 | 已完成 | typecheck 通过；浏览器手测待补 |
| 1.7 | 更新 README「当前能力 / 当前边界」并回填本文档结论 | 已完成 | — |
| 1.8 | 收紧第一批边界：`float32` 也给出中位数/众数（第二遍建桶）、All time frames、统计结果过期提示、分组整除校验 | 已完成 | `tests/imagejStackStats.test.ts`、`tests/imagejStackProject.test.ts` |
| 2.1 | Make Montage...：自动行列与缩放、边框、双线性重采样、结果另开 tab | 已完成（缺标签绘制） | `tests/imagejMontage.test.ts`（7 例） |
| 2.2 | Make Montage 的 `Label slices` / 字体大小文本绘制 | 已完成 | `tests/imagejMontage.test.ts` |
| 2.3 | Montage to Stack...：反向切块，与 Make Montage 互逆（含边框） | 已完成 | `tests/imagejMontage.test.ts`（10 例） |
| 2.4 | Reslice [/]...：输出间距、起始边（上/左/下/右）、垂直翻转、90° 旋转，结果另开 tab | 已完成（矩形选区路径） | `tests/imagejReslice.test.ts`（8 例） |
| 2.5 | Reslice 的线 / 折线 / 自由线选区路径（沿线的剖面 + 线整体平移） | 未开始 | — |
| 2.6 | Orthogonal Views：交叉点处重建 XZ / YZ，两张图各开一个 tab | 已完成 | `tests/imagejOrthogonal.test.ts`（5 例） |
| 2.7 | Plot XY Profile（逐页剖面，共用纵轴刻度） | 已完成 | `tests/imagejStackProfiles.test.ts`（4 例） |
| 3.1 | 新增 `engine/storage-pages.ts`：页映射存储（含空白页），结构编辑不复制像素 | 已完成 | `tests/imagejRestructure.test.ts` |
| 3.2 | Reverse / Reduce / Make Substack / Delete Slice / Add Slice：`restructure` 通路 + UI + 三语文案 | 已完成 | 同上（7 例） |
| 3.3 | Insert（把源栈的页贴到目标栈上）、Combine（两栈并排拼页）、Concatenate（多栈首尾相接） | 已完成 | `tests/imagejCombine.test.ts`（7 例） |
| 3.4 | 单页图（无切片轴）上的 Add Slice：需要在结果里新建切片轴 | 未开始 | — |
| 4.1 | Animation：Start / Stop / Animation Options（帧率、播放区间、来回循环） | 已完成 | `tests/imagejAnimation.test.ts`（6 例） |
| 4.2 | 页标签：Set Label... / Remove Slice Labels（运行时状态 + 状态栏回显） | 已完成 | `tests/imagejSliceLabels.test.ts`（5 例） |
| 4.3 | Label...（把文本画进像素）：六种格式 + 内置点阵光栅器 | 已完成 | `tests/imagejLabel.test.ts`（9 例） |
| 4.4 | Make Montage 的 `Label slices`（复用内置点阵光栅器） | 已完成 | `tests/imagejMontage.test.ts`（12 例） |
| 4.5 | 3D Project：三轴 × 三方法 × 角度序列 × 两种深度提示 + 计算量保护 | 已完成 | `tests/imagejProject3d.test.ts`（9 例） |
| 4.6 | Magic Montage Tools：按新行列重排蒙太奇（拆开再重拼，写回元数据） | 已完成 | `tests/imagejMontage.test.ts` 的 remontage 用例 |

现有回归规模：`apps/image` 共 266 个用例，全部通过；`pnpm --filter @joplot/image typecheck` 干净。

**至此 `Image ▸ Stacks` 的 32 个命令全部落地**（其中 Next / Previous Slice、Set Slice、Images to Stack、
Stack to Images 在工作台里原本就有对应交互，未另建菜单项）。剩余的都是各命令内部的边缘特性，
逐条记录在上面的「现状」列与本文件的 §4 设计决策里。

上面步骤表里仍标 `未开始` 的三行都是**可选的边缘增强**，不影响 32 个命令的完整性：

| 项 | 说明 |
| --- | --- |
| 2.5 | Reslice 的线 / 折线 / 自由线选区路径（矩形选区路径已可用） |
| 3.4 | 单页图（无切片轴）上的 Add Slice：需要给结果新建一条轴 |
| — | 另有若干命令的次要参数未做，均在各命令的「现状」列注明（如 3D Project 的 Interpolate、Z Project 的 All time frames 之外的超栈细节） |

## 4 设计决策

### 4.1 三个分析命令共用一条引擎通路

Measure Stack / Statistics / Plot Z-axis Profile 在 ImageJ 里是三套代码（宏 + `StackStatistics` + `ZAxisProfiler`），
但三者要的都是「逐页统计」：前者取逐页行、中者取合并汇总、后者取逐页均值。
因此本项目只加**一条** `stack-stats` 通路产出 `StackStatsResult`，三个命令是同一份数据的三种呈现。

### 4.2 逐页执行当前 Recipe

统计发生在 Worker 内，逐页先跑一遍当前 Recipe 再统计，理由：
- 与画面上看到的结果一致（用户对图像做了处理，就该统计处理后的像素）；
- 逐页像素不跨线程，避免「每页一次整页回传」这种比统计本身还贵的开销。

代价：Recipe 步骤多时整栈统计耗时按页数线性增长，因此它是**显式触发**的一次性动作，不放在翻页路径上。

### 4.3 `float32` 不提供 median / mode

中位数与众数取自直方图。整数 dtype 用位宽满桶（uint8 256、uint16/int16 65536），与 ImageJ 的直方图口径一致；
`float32` 若要与 ImageJ 的通用路径对齐，需要把整卷像素读进内存再排序，这与本项目的惰性读取架构冲突，
故返回 `NaN`（UI 显示「—」）。这一点在 `stackStats.ts` 的模块注释里显式写明。

### 4.4 横轴标定沿用 ImageJ 的 origin 约定

未标定时 `origin = -1`、`spacing = 1`（横轴从 1 开始）；有标定（或 `t` 轴有 `interval`）时 `origin = 0`。
与 `ZAxisProfiler` 的 `x = (i - origin) * calFactor` 一致。

### 4.5 Z 投影的结果是「新数据集 + 新 tab」，不是当前文档的一个步骤

ImageJ 的 Z Project 产生新窗口。本项目的 Recipe 是「每步作用于当前切片」的模型，
把投影塞进步骤链会让「N 页数据集投影出 1 页图像」与翻页/帧计数语义相互矛盾；
而且投影结果需要能独立继续处理、导出、另存为 TIFF。

因此新增 `project` 引擎通路：逐页执行当前 Recipe → 投影 → 在**引擎侧**注册一个新 Dataset
（`MemoryStorage`）→ 只把元信息回传主线程 → 外壳据此另开一个 tab。
像素不跨线程（否则一次投影要白拷一整块数据）。

结果数据集的轴处理：单组投影**移除**被投影的轴（输出真正的 2D 图，与 ImageJ 的「新 2D 窗口」对应）；
分组投影保留该轴、长度换成组数，并把沿该轴的物理间距乘以组大小（对齐 `GroupedZProjector.java:27-29` 的 `pixelDepth *= groupSize`）。

### 4.6 RGB 栈不照抄 ImageJ 的逐通道归一化

ImageJ 的 `doRGBProjection` 会把三通道各自按自身 min/max 重新拉伸到 0..255 再合并
（`ZProjector.java:244-288`、`RGBStackMerge.java:424-440`），逐通道动态范围因此丢失。
本项目的数据模型里 RGB 就是 `c` 轴上的三个平面，直接逐元素投影即可，故保留原精度。
这是**有意的行为差异**，不是遗漏。

### 4.7 Make Montage 暂不做标签绘制

ImageJ 的 Make Montage 可以在面板底部写切片标签（`MontageMaker.java:267-280`），
那需要一个文本光栅器。本项目的引擎在 Worker 内跑、像素不跨线程，而 Worker 里可用的
`OffscreenCanvas` 在 Node 测试环境下不存在，会把回归测试变成只能手测。

因此本轮先只做几何拼接（行列、缩放、边框、双线性重采样），标签留到装饰批次；
UI 上不出现 `Label slices` / `Font size` 两个字段，避免给出无效选项。

### 4.8 统计结果的失效标记

切片或 Recipe 一变，整栈统计就对不上画面。`emit()` 里集中把 `stackStats` 置空并标记
`stackStatsStale`，UI 据此把卡片从「加载中」改说成「结果已过期」——
区分「没跑过」与「跑过但失效了」，不让用户对着旧数字做判断。

### 4.9 Montage to Stack 的面板定位取「与 Make Montage 互逆」的定义

ImageJ 的 `StackMaker` 把大图均分成 `columns` 份（`w = W/columns`，把面板间的边框也算进格子），
因此它自己的 Make Montage → Montage to Stack 往返在**带边框时并不精确**（源码注释也承认不是精确逆运算）。

本项目改成先扣除面板间的边框再定位：`w = (W - bw·(C-1))/C`、第 i 个面板起点 `i·(w+bw)`。
无边框时与 ImageJ 完全一致；带边框时严格互逆（`tests/imagejMontage.test.ts` 的往返用例固定了这一点）。
边框裁剪量仍照抄 ImageJ：左边裁 `border`、右边裁 `border/2`。

### 4.10 Reslice 先只做矩形选区路径

ImageJ 的 `Slicer` 有两条路径（`Slicer.java:261-335`）：

| 选区 | 对话框字段 | 采样方式 |
| --- | --- | --- |
| 矩形 | `Start at: Top/Left/Bottom/Right` | 沿水平线或竖直线逐条取，页数 = `(int)(跨度/d)` |
| 线 / 折线 / 自由线 | `Slice count:` | 沿线的剖面，每页把线整体沿垂直方向平移 |

本轮实现矩形路径（最常用、语义最清晰），线路径留待后续：它需要「沿线取样」的剖面工具，
而这正是 `Plot XY Profile` 与 `Orthogonal Views` 也需要的同一块能力，值得一次做好。

另外两处有意简化（都写在 `engine/reslice.ts` 的模块注释里）：
输出 Z 间距带来的 z 方向重采样未做（ImageJ 的默认 `Avoid interpolation` 同样是「不重采样」，
本项目未标定的数据与之等价）；输出栈的物理标定未按 `Slicer.java:129-171` 重算。

### 4.11 Orthogonal Views 只产出数据，不带交互层

ImageJ 的 `Orthogonal_Views` 是一个常驻窗口：三向联动、十字线随鼠标移动、`flipXZ` / `rotateYZ`
两个偏好改变朝向（`Orthogonal_Views.java:59-132`、`:568-577`、`:651-688`）。那些属于**视图状态**而非数据。

本项目把它拆成两层：
- 引擎侧只做数据重建（`engine/orthogonal.ts`）：XZ = 交叉点所在行沿 z 堆叠、YZ = 所在列沿 z 堆叠，
  只在 `az = pixelDepth/pixelWidth ≠ 1` 时做一次双线性重采样（未标定数据 `az = 1`，与 ImageJ 的默认路径一致）；
- 结果各注册成一个新 Dataset、各开一个 tab，因此可以继续处理、比对、导出。

十字线覆盖层与三向联动未做；`flipXZ` / `rotateYZ` 偏好也未提供，输出固定为默认朝向。

### 4.12 Plot XY Profile 只产曲线数据，不栅格化成图

ImageJ 的 `StackPlotter` 把每页曲线渲染成一张位图（含坐标轴与网格）再拼成 `"Profile Plots"` 栈
（`StackPlotter.java:80-88`）。本项目改为：引擎逐页采样、返回曲线数组与**共用纵轴范围**
（对应 `ProfilePlot.setMinAndMax`），绘制交给视图卡片。这样曲线能跟随主题缩放，也不必在 Worker 里
做文本与坐标轴的光栅化 —— 与 Make Montage 的标签绘制是同一类取舍。

剖面口径沿用本工作台既有的 `profileBlock`：矩形选区取水平中线、线 / 折线选区沿线采样。
ImageJ 的 `ProfilePlot` 对矩形选区取的是**每一列的平均**，两者对高度大于 1 的矩形会给出不同曲线；
本项目选择「全局只有一种剖面定义」，以免同一个词在界面里指两件事。

### 4.13 结构编辑走「页映射存储」，不复制像素

ImageJ 的 `ImageStack` 本身就是一个 `Object[]` 页数组，删页 / 逆序 / 抽取都只是搬数组元素。
本项目的数据集是不可变元信息 + 只读 Storage，因此新增 `engine/storage-pages.ts` 的 `PageMapStorage`：

```text
pages = [2, 0, 1]         // Reverse / Reduce / Make Substack / Delete 都归结为这种映射
pages = [1, 'blank', 3]   // Add Slice 插入的空白页
```

它只持有「目标页 → 源页」的索引，像素仍按需从源 Storage 读；`'blank'` 在读取时返回全 0 缓冲，
对应 `StackEditor.java:43` 新建未填充的同类型处理器。好处是大栈逆序 / 抽稀是**零成本**的
（对比 `registerMemoryDataset` 那条路径需要把整卷读进内存）。

三处有意简化：
- `Reduce` 不做 ImageJ 的 `VirtualStack.reduce` 快捷分支（它只在源本身就是虚拟栈时生效），
  行为与 ImageJ 的普通栈路径一致：从第 1 页起、固定偏移、步长 = factor；
- `Add Slice` 目前要求数据集**已有切片轴**（`z` / `t` / `c`）。单页图（如导入的单张 PNG，
  轴为 `y-x`）需要先给结果新建一条轴，留待 3.4；
- 逆序 / 抽稀等只改页，不改物理标定（ImageJ 的 `StackReducer` 会按 factor 缩放 `pixelDepth`，
  这里记录为已知差异）。

### 4.14 跨数据集合成：只应用主数据集的处理链

Insert / Combine / Concatenate 要同时读两个（或多个）数据集的像素。本项目里每个文档有自己的
Recipe（处理链），而引擎宿主只知道「数据集 id → 像素」，不知道文档级的处理状态。

因此约定：**请求里带主数据集的 Recipe，其它数据集按源像素读取**。
理由：主数据集就是用户当前正在看的那个，它的显示结果应当参与合成；而把别的文档的未提交预览
悄悄参与进来反而更容易让人意外。需要连同对方处理结果一起合成时，先在该文档里应用处理再合成。

像素层面三者共用 `engine/stackCombine.ts` 的两个纯函数（`pageGeometry` / `blitPage`）：

| 命令 | 几何 | 页数 |
| --- | --- | --- |
| Insert | 目标页尺寸不变，源页贴到 `(x, y)`，越界裁剪 | 目标页数（源不足时重复用最后一页） |
| Combine | 水平 `w1+w2 × max(h1,h2)`；垂直 `max(w1,w2) × h1+h2` | 两者较大者，缺页一侧留 0 |
| Concatenate | 各栈尺寸不同时，较小页**居中**放到最大画布 | 各栈页数之和 |

与 ImageJ 的差别：ImageJ 的 Insert / Combine 会**原地改写**目标图像并关闭 / 掏空源图像；
本项目一律产出新数据集（不破坏任何已打开文档），因此可以反复试参数。

### 4.15 Animation 是纯视图状态，实现为「推进切片选择」

ImageJ 的 Animator 直接操作 `StackWindow` 的滚动条（`Animator.java:99-211`）。本项目里「当前看哪一页」
是运行时的 `selection`，因此动画无非是**定时推进 selection**，不动数据、不进缓存键、也不产生新文档。

步进逻辑抽成 `lib/animation.ts` 的 `nextAnimationStep`（纯函数，可单测）：
- 帧率夹在 `[0.1, 1000]`（与 ImageJ 一致），非法值回落到默认 7 fps；
- 区间 `first..last` 与当前页都会先夹取，到端点后折返或回起点由 `loop` 决定；
- **与 ImageJ 的差别**：ImageJ 折返时会跳过端点那一帧（先 `slice += inc` 再判越界，翻向后取
  `last-1` / `first+1`），这里不跳帧 —— 端点播完再反向。

播放用 `setTimeout` 递归而不是 `setInterval`：每次翻页后按新的 `pageIndex` 重排定时器，
慢盘上不会堆积请求（与运行时「显示优先、合并请求」的策略一致）。

### 4.16 页标签放在运行时状态，不进 Dataset

ImageJ 的 slice label 挂在 `ImageStack` 上（`ImageStack.java:263-302`），随栈一起走。
本项目的数据集有「revision 参与缓存键」的约定：如果把标签放进 `Dataset`，改一次标签就会让
`datasetVersionKey` 变化，整卷像素缓存全部失效 —— 而标签根本不改变像素。

因此标签放在 `RuntimeState.sliceLabels`（下标对应切片轴）：
- `setSliceLabel(index, label)` / `clearSliceLabels()` 只 emit 状态，不触发重算
  （`tests/imagejSliceLabels.test.ts` 用缓存未命中计数固定了这一点）；
- 重新打开数据集会清空标签；
- 状态栏回显当前页标签，让用户知道设过什么。

`Label...`（把文本**画进像素**）与 Make Montage 的 `Label slices` 是另一类命令：它们需要文本光栅器，
放在 4.3 一起做 —— 那也正好是唯一还需要 Canvas 文本能力的地方。

### 4.17 文本用内置点阵，不依赖 Canvas

`Label...` 要把文本**画进像素**。本项目的引擎跑在 Worker 里：浏览器有 `OffscreenCanvas` 可以画字，
但 Node 测试环境没有 —— 一旦依赖它，标签这条路径就只能手测，与「每批都有单元测试」的目标冲突。

因此内置一套 3×5 点阵（`engine/textRaster.ts`），按字号整数倍放大：
- 浏览器与测试环境的行为**完全一致**，`tests/imagejLabel.test.ts` 能直接断言像素；
- 字符集覆盖 Label 自身会生成的全部文本（数字、冒号、小数点、负号、斜杠、空格），
  用户自定义 Text 里的其它字符统一显示为 `?`；
- 字号是"点阵的整数倍"，不是精确的字号（`fontSize = 18` → 3 倍 → 15 像素高）。

这是一处**有意的取舍**：用字体保真度换可测试性与零环境依赖。若之后需要任意字符 / 精确字号，
再引入 Canvas 路径并把它限定为"浏览器可选增强"。

`Label...` 的输出是**新的数据集**（标注后的整栈），范围之外的页原样保留；
默认前景色取 dtype 的最大值（白），在深色科学图像上可见（ImageJ 默认黑，但会按背景自动切白）。

### 4.18 3D Project 的核心语义照搬，边缘特性按代价取舍

ImageJ 的 `Projector` 是这套菜单里最长的一个（约 800 行）。本项目实现了它的核心链路：

| 维度 | 覆盖 |
| --- | --- |
| 旋转轴 | X / Y / Z 三个轴 |
| 投影方法 | Nearest Point / Brightest Point / Mean Value |
| 角度序列 | `floor(|总旋转| / 增量) + 1` 帧，支持反向步进 |
| 画布尺寸 | 按轴取对角包络（绕 Z 轴时宽度取偶数），与 `Projector.java:461-481` 一致 |
| 深度提示 | Surface 与 Interior 两档，系数为「由远及近的比例」 |
| 不透明度 | `(opacity·表面 + (100-opacity)·体渲染) / 100` |

未覆盖（都是代价明显、收益有限的边缘特性）：
- ImageJ 会先把 16/32 位输入降到 8 位（`Projector.java:276-281`）；本项目**保留输入 dtype**；
- `Interpolate` 的 z 方向插值与超栈的 `All time points` 未提供；
- ImageJ 用整数定点（`BIGPOWEROF2 = 8192`）算旋转，这里是浮点，逐像素的角度采样因此略有不同。

另外加了一道 ImageJ 没有的**计算量保护**：逐像素工作量 = 角度 × 切片 × 单页像素，
超过 4×10⁸ 时直接报错并提示「增大角度增量或缩小切片范围」，而不是让 Worker 跑上几分钟。
ImageJ 只是慢（它的错误提示里也建议同样的三件事），本项目选择尽早说清楚。

## 5 验证方式

```sh
pnpm --filter @joplot/image typecheck
pnpm --filter @joplot/image test
pnpm dev:image     # 浏览器手测：导入多页 TIFF / 文件夹 Stack 后逐个命令
```

注意：在受限沙箱下 `node --test` 默认会为每个测试文件 spawn 子进程，从而触发 `spawn EPERM`。
此时改用**同进程**模式即可（不改变测试语义）：

```sh
cd apps/image
node --experimental-strip-types --test --test-isolation=none "tests/*.test.ts"
```

同源问题：`pnpm --filter @joplot/image build` 在本机受限沙箱下会在 Next 的 TypeScript 检查阶段抛 `spawn EPERM`
（`✓ Compiled successfully in 22.3s` 已打印，失败发生在之后的类型检查子进程）。独立的
`pnpm --filter @joplot/image typecheck` 通过，因此该失败是环境限制而非代码问题；
需要完整构建产物时请在非受限终端执行。
