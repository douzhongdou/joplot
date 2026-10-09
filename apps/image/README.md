# 科学图像工作台

工作台就在域名根路径上，使用 Dataset / Storage / Recipe 引擎和 ITK-Wasm 图像 I/O。三栏布局、命令搜索、参数面板、ROI、统计图表与 Stack 控件都在这个工作台里；早期那套独立的 8 位实现（`/imagej/classic`）已删除。

二维显示使用视口尺寸的 Canvas：直接从原始 TypedArray 采样，按窗宽窗位映射屏幕颜色。缩放、平移和像素探查不会降低处理数据的精度，也不会创建与源图一样大的 Canvas。VTK.js 及其 GLSL loader 已移除。

## 当前能力

- 导入本地图像、多页 TIFF、WebP、FITS 与相机 RAW（DNG / CR2 / NEF / ARW 等 TIFF 容器的 CFA 数据），保留 `uint8`、`uint16`、`int16`、`float32` 数据类型。RAW 先以单通道马赛克灰度显示，再用 debayer 算子（可选滤镜序列与双线性 / Malvar-He-Cutler 算法）还原彩色；FITS 支持 BITPIX / BSCALE / BZERO 与多维 z 栈，WebP 走浏览器原生解码。RGB 合成显示与显式灰度转换。
- 平移、滚轮缩放、适应窗口、1:1、原图对照、矩形 ROI 绘制与移动、原值探查。
- 彩色亮度 / 对比度使用 ImageJ 四滑杆、All / Red / Green / Blue 通道、Auto / Reset / Set / Apply；分通道调整和切换快照保留颜色。反相、滤波与几何操作也可逐通道处理 RGB。另有手动阈值、Otsu、形态学与填孔。
- T / C / Z 选择、Stack 上一页 / 下一页、当前帧或整个 Stack 处理；切页保留处理记录。RGB 的 C 轴用于合成显示。
- Recipe 步骤查看 / 删除、撤销 / 重做；每步保存参数、帧选择与 ROI。
- 整图 / ROI 原精度统计、直方图、剖面、粒子分析及 CSV；统计与计算分别在 Worker 执行。
- Image ▸ Stacks 的跨帧处理：**Z 投影**（均值 / 最大 / 最小 / 求和 / 标准差 / 中位数六种方法，可限定切片范围与「全部时间帧」，结果另开一个 tab）、**分组 Z 投影**（每 N 页合成一页，沿轴物理间距按组大小换算）、**Z 轴剖面图**、**整栈测量**（逐切片一行）与 **统计**（整栈汇总）。后三者共用一次逐页统计。
- **制作蒙太奇**（Make Montage）：按行优先把选定的切片铺成一张大图；行列与缩放留空即走 ImageJ 的自动规则（列数 ≈ √n，面板过宽自动降倍率），支持面板间距、切片步长与双线性重采样，结果同样另开一个 tab。**蒙太奇转 Stack**（Montage to Stack）是它的逆运算：按行列把大图切回多页栈，行列留空即沿用蒙太奇记录的行列元数据。
- **重切**（Reslice）：沿矩形选区（无选区则整帧）的垂直方向逐条采样成新栈，可选输出间距、起始边（上 / 左 / 下 / 右）、垂直翻转与 90° 旋转；结果另开一个 tab。线选区的剖面路径尚未提供。
- **正交视图**（Orthogonal Views）：在指定的交叉点重建 XZ 与 YZ 两张视图（各开一个 tab），z 方向按 `pixelDepth / pixelWidth` 做一次双线性重采样（未标定数据不缩放）。
- **逐页剖面**（Plot XY Profile）：逐页取同一条剖面（矩形选区取水平中线、线 / 折线选区沿线采样），所有曲线共用同一纵轴刻度，画在右栏视图卡片里，当前切片高亮。
- **栈结构编辑**：**Reverse**（页序反转）、**Reduce**（按步长抽稀）、**Make Substack**（切片表达式如 `1-3,5`）、**Add Slice**（在当前位置插入空白页）、**Delete Slice**（删除当前页，拒绝删空）。这些命令只换一组页、不重算像素（结果用页映射存储），所以对大栈也是零成本的，结果同样各开一个 tab。
- **跨文档合成**：**Insert**（把另一个文档的页贴到当前文档上，可指定位置）、**Combine**（两个文档水平或垂直拼页）、**Concatenate**（把全部已打开文档首尾拼成一个栈，尺寸不同时小页居中）。三者都产出新数据集，不改动任何已打开文档；合成时只有当前文档应用其处理链。
- **动画播放**（Animation）：**开始动画** / **停止动画** / **动画选项…**（帧率 0.1–1000 fps、播放区间、来回循环）。播放只是定时推进当前切片，不动数据、不产生新文档；帧率与折返行为对齐 ImageJ（折返时不跳帧，这点与 ImageJ 的 off-by-one 不同）。
- **切片标签**：**设置标签…**（给当前切片写一个标签，空串即清除）与**清除切片标签**。标签只影响显示与导出，不参与像素缓存键，因此改标签不会让整卷重新解码；当前切片有标签时会在左下状态栏回显。另有 **Label…** 把文本画进像素（数值 / 零填充 / 分:秒 / 时:分:秒 / 自定义文本 / 切片标签六种格式，可设起始值、步长、位置与字号），产出标注后的新栈；文本用内置点阵渲染（不依赖 Canvas，浏览器与测试环境一致），非 ASCII 字符显示为 `?`。
- **3D 投影**（3D Project）：绕 X / Y / Z 轴逐角度旋转投影，投影方法可选最近点 / 最亮点 / 均值，可设初始角、总旋转角与角度增量，并提供表面与内部两档深度提示、不透明度；每个角度产出一页，结果另开一个 tab。计算量超过阈值时会明确报错并建议增大角度增量，而不是让 Worker 长时间空转。
- **蒙太奇工具**（Magic Montage Tools）：按新的行列重排当前蒙太奇图（拆开再重拼），源行列缺省沿用元数据，可同时重设面板间距与切片标注；新行列会写回元数据供后续「蒙太奇转 Stack」使用。Make Montage 也支持 `Label slices`（每个面板底部标注切片序号）。
- 当前显示的 PNG、当前结果 TIFF、整个 Stack 的 TIFF。TIFF 保留当前结果的数据类型；PNG 使用显示映射。
- 中 / 英 / 日文案与共享 shadcn/ui 控件。

已删除滤波、形态学和粒子分析的 400 万像素门槛。回归覆盖 4096×2160 与 7680×4320 的滤波，浏览器也验证了 8K 导入、处理及完整分辨率 PNG 导出。高斯使用行缓存，避免整图浮点中间缓冲；结果缓存按字节淘汰，撤销记录保存 Recipe。

图像数据在浏览器本地处理，不上传服务器。ITK 的 WASM 和图像 I/O 模块仍需要作为运行资源加载。当前滤波内核是 Worker 中的 TypeScript；ITK-Wasm 负责 I/O、PNG 编码与管道适配，尚未配置编译后的 ITK 滤波管道。

## 代码位置

| 路径 | 职责 |
| --- | --- |
| `src/imagej/components/ScientificImageWorkspace.tsx` | 主工作台交互与面板 |
| `src/imagej/components/ImageJSidebar.tsx` | 左栏命令目录，命令项下方内联展开自己的操作面板 |
| `src/imagej/components/CommandPanels.tsx` | 亮度/对比度、阈值、高斯模糊的内联参数面板 |
| `src/imagej/components/ImageViewport.tsx` | 二维视口、相机、ROI 与原值探查 |
| `src/imagej/components/useImageAnalysis.ts` | 分析 Worker 的图像与 ROI 同步 |
| `src/imagej/engine/stackStats.ts` | 整栈逐页统计内核（Measure Stack / Statistics / Plot Z-axis Profile 共用） |
| `src/imagej/engine/stackProject.ts` | Z 投影内核（六种方法与输出 dtype 规则） |
| `src/imagej/engine/` | Dataset、Storage、Recipe、调度、计算、I/O、TIFF / FITS / RAW / 原生位图解码、debayer 与渲染映射 |
| `src/imagej/lib/` | 共享的 8 位内核与算法、高斯行缓存与三语文案 |
| `tests/imagej*.test.ts` | 科学图像、Stack、算法、缓存、历史与编码回归 |

详细实现和已验证范围见 [实现说明](docs/scientific-image-engine-implementation.md)。[架构方案](docs/scientific-image-engine-design.md) 记录长期方向，其二维显示章节已更新为当前方案。
Stack 架构决策见 [Stack 架构决策](docs/stack-architecture-decision.md)；Image ▸ Stacks 各命令的移植清单、分批计划与逐批进度见 [Stacks 命令移植](docs/stack-commands-migration.md)。

## ImageJ 上游源码路径

本项目的 ImageJ 对照实现（`src/imagej/lib/processor.ts`、`src/imagej/engine/operators.ts`）与 Stack 架构调查
（`docs/stack-architecture-decision.md`）以本地只读的 ImageJ 1 源码为基准，其 `ij/ImageJ.java:81` 声明版本 `1.54u`。

**本项目在多台开发机上并行开发，同一个 checkout 在各机器上的绝对路径不同。** 所有已知路径统一记录在此表；
换机器时若本地路径不在表内，请把该机器的路径追加一行，不要在任何代码或文档里写死某个盘符。

| 机器 | 路径 | 版本 / 备注 |
| --- | --- | --- |
| 开发机 A | `D:\HQL\code\tool\imagej-upstream` | 1.54u8，git `4c4975d`（2026.07.22）；完整仓库，含 `ij/`、`plugins/`、`tests/`、`macros/` |
| 开发机 B | `E:\Project\tool\imagej` | 1.54u；`lib/processor.ts` 与 `docs/stack-architecture-decision.md` 早期引用的路径 |

引用源码时只写仓库内的相对路径（如 `ij/process/ByteProcessor.java`、`ij/plugin/ZProjector.java`、`ij/ImageStack.java`），
并注明行号；行号与该 checkout 的版本绑定，版本不一致时先复核行号再看结论。

## 当前边界

当前 ITK 导入仍将完整数据集解码到内存，滤波仍需要当前帧的输入与输出。大 Stack 受设备可用内存约束；尚未实现磁盘虚拟栈、按需解码、完整分块计算或 BigTIFF 导出。视口尺寸与图像尺寸分离并不代表无限制的数据规模。

原精度 TIFF 导出使用无压缩经典 TIFF，要求各页尺寸、通道数、数据类型一致，文件小于 4 GiB。T / C / Z 展平为多页 TIFF，暂不写出 OME / ImageJ 的多维元数据。若仅对某页执行改变数据类型的转换，应导出该页，或对整栈统一转换。多页栈暂禁用裁剪和 90° 旋转。

跨帧命令默认只作用于当前选中的 T 帧；Z Project 另有「全部时间帧」选项（对应 ImageJ 的 All time frames），勾选后对每条时间帧各投影一次、结果保留 `t` 轴。整栈统计的中位数与众数取自直方图：整数 dtype 的桶宽为 1（与逐像素排序一致），`float32` 需要再读一遍数据、按 256 桶取桶中心（误差不超过一个桶宽）。分组 Z 投影要求组大小整除切片区间，与 ImageJ 的 GroupedZProjector 一致。Make Montage 只做几何拼接，尚未提供 ImageJ 的切片标签文本绘制。Reslice 目前只走矩形选区（无选区即整帧）那条路径，ImageJ 的线 / 折线 / 自由线剖面路径尚未提供，输出栈的物理标定也未按 ImageJ 重算。Z 投影对 RGB 保留各通道原始动态范围，与 ImageJ「先按各通道自身 min/max 拉伸到 0..255 再合并」的做法不同（见移植文档 §4.6）。

FITS 暂只载入第一个图像 HDU（NAXIS ≤ 3，第 3 维按 z 轴）；文件含多个图像 HDU 时会提示但不会合并，NAXIS > 3、大端以外的编码与随机组不处理。WebP 依赖浏览器原生 `createImageBitmap`（Worker 里用 `OffscreenCanvas`），Alpha 通道忽略；不支持的 32/64 位整数与双精度浮点 FITS 会统一转 float32 并提示精度损失。

RAW 走自研路线，仅覆盖 TIFF 容器（DNG / CR2 / NEF / ARW / ORF / RW2 等）且要求 strip 布局与未压缩 / Deflate 压缩；JPEG、LZW、厂商私有压缩（Sony ARW、Nikon 压缩等）与 CR3 / X3F / RAF 等非 TIFF 容器会明确报错。导入只取第一个 CFA 数据页，暂不裁剪 ActiveArea，也不读取相机色彩矩阵与白平衡；debayer 的滤镜序列优先取 DNG 的 `CFAPattern`，缺失时默认 RGGB，可在算子参数中手动指定。

共享的 8 位单缓冲分配预算为 512 MiB；工作台的原精度数据路径不受早期 Canvas 导入边长限制的约束。菜单里未实现的虚拟栈、16 / 32 位转换等命令仍禁用；迁移现有交互不代表完整复刻 ImageJ。

矩形 ROI 是当前唯一选区类型。科学算子的边界与数值行为由回归测试约束，尚未用 Java ImageJ 的完整黄金样例逐项验证。

## 验证

从仓库根目录运行：

```sh
pnpm --filter @joplot/image typecheck
pnpm --filter @joplot/image test
pnpm --filter @joplot/image build
pnpm dev:image
```
