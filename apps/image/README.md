# 科学图像工作台

`/imagej` 是主工作台，使用 Dataset / Storage / Recipe 引擎和 ITK-Wasm 图像 I/O。Classic 的三栏布局、命令搜索、参数面板、ROI、统计图表与 Stack 控件已迁入主工作台。`/imagej/classic` 保留原来的 8 位实现。

二维显示使用视口尺寸的 Canvas：直接从原始 TypedArray 采样，按窗宽窗位映射屏幕颜色。缩放、平移和像素探查不会降低处理数据的精度，也不会创建与源图一样大的 Canvas。VTK.js 及其 GLSL loader 已移除。

## 当前能力

- 导入本地图像与多页 TIFF，保留 `uint8`、`uint16`、`int16`、`float32` 数据类型；RGB 合成显示与显式灰度转换。
- 平移、滚轮缩放、适应窗口、1:1、原图对照、矩形 ROI 绘制与移动、原值探查。
- 彩色亮度 / 对比度使用 ImageJ 四滑杆、All / Red / Green / Blue 通道、Auto / Reset / Set / Apply；分通道调整和切换快照保留颜色。反相、滤波与几何操作也可逐通道处理 RGB。另有手动阈值、Otsu、形态学与填孔。
- T / C / Z 选择、Stack 上一页 / 下一页、当前帧或整个 Stack 处理；切页保留处理记录。RGB 的 C 轴用于合成显示。
- Recipe 步骤查看 / 删除、撤销 / 重做；每步保存参数、帧选择与 ROI。
- 整图 / ROI 原精度统计、直方图、剖面、粒子分析及 CSV；统计与计算分别在 Worker 执行。
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
| `src/imagej/engine/` | Dataset、Storage、Recipe、调度、计算、I/O、TIFF 与渲染映射 |
| `src/imagej/lib/` | Classic 算法、共享 8 位内核、高斯行缓存与三语文案 |
| `src/imagej/components/ImageJApp.tsx` | Classic 入口 |
| `tests/imagej*.test.ts` | 科学图像、Stack、算法、缓存、历史与编码回归 |

详细实现和已验证范围见 [实现说明](docs/scientific-image-engine-implementation.md)。[架构方案](docs/scientific-image-engine-design.md) 记录长期方向，其二维显示章节已更新为当前方案。

## 当前边界

当前 ITK 导入仍将完整数据集解码到内存，滤波仍需要当前帧的输入与输出。大 Stack 受设备可用内存约束；尚未实现磁盘虚拟栈、按需解码、完整分块计算或 BigTIFF 导出。视口尺寸与图像尺寸分离并不代表无限制的数据规模。

原精度 TIFF 导出使用无压缩经典 TIFF，要求各页尺寸、通道数、数据类型一致，文件小于 4 GiB。T / C / Z 展平为多页 TIFF，暂不写出 OME / ImageJ 的多维元数据。若仅对某页执行改变数据类型的转换，应导出该页，或对整栈统一转换。多页栈暂禁用裁剪和 90° 旋转。

Classic 保留原来的 Canvas 导入边长限制、8 位历史快照与简单 TIFF 解码器；共享 8 位单缓冲分配预算为 512 MiB。主工作台的原精度数据路径不使用 Classic 的 Canvas 导入限制。菜单里原先未实现的 Z 投影、虚拟栈、16 / 32 位转换等命令仍禁用；迁移现有交互不代表完整复刻 ImageJ。

矩形 ROI 是当前唯一选区类型。科学算子的边界与数值行为由回归测试约束，尚未用 Java ImageJ 的完整黄金样例逐项验证。

## 验证

从仓库根目录运行：

```sh
pnpm --filter @joplot/image typecheck
pnpm --filter @joplot/image test
pnpm --filter @joplot/image build
pnpm dev:image
```
