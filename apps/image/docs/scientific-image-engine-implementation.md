# 科学图像引擎实现说明

更新日期：2026-10-02。此文档描述当前代码；长期计划见 [架构方案](scientific-image-engine-design.md)。

## 产品入口与交互

`/imagej` 使用 `ScientificImageWorkspace`，`/imagej/classic` 保留 Classic。主工作台接入 Classic 的三栏布局、搜索命令菜单、参数面板、显示切换、ROI、分析卡片与导出操作，数据与历史由科学引擎管理。

Stack 提供 T / C / Z 选择、滑杆、上一页 / 下一页及当前帧 / 整栈开关。RGB 的 C 轴用于合成；标量多通道按 C 选择。操作步骤保存作用范围：当前帧包含明确的 T / C / Z 与可选 ROI，整栈步骤对各帧重放。翻页不会清空历史。撤销 / 重做改变 Recipe，查看某步可暂时显示中间结果。

## 数据与执行

| 模块 | 当前职责 |
| --- | --- |
| `dataset.ts`, `types.ts` | 轴、数据类型、维度、通道与原精度 ImageBlock |
| `storage.ts`, `importer.ts` | 内存数据集、行复制的区域读取、ITK / 普通浏览器图像导入 |
| `recipe.ts` | 线性操作链、帧 / ROI / 整栈范围、参数、撤销与重做 |
| `runtime.ts` | UI 状态、版本保护、按字节缓存、邻页预取、源帧对照和顺序导出 |
| `worker/client.ts`, `worker/host.ts` | 懒创建计算 Worker、导入 / 计算通信、释放旧数据集与中间结果 |
| `compute/engine.ts`, `compute/pureOps.ts` | 当前帧算法、范围过滤、ROI 写回和分析结果 |
| `compute/itk.ts` | ITK-Wasm 图像转换、解码、编码与可配置管道接口 |
| `lib/gaussian.ts` | 可分离高斯行环形缓存，临时内存随行宽和核半径增长 |
| `analysis.ts`, `analysis.worker.ts` | 原精度统计、直方图、剖面和粒子分析 |
| `render/raster.ts`, `render/geometry.ts` | 视口大小 RGBA、最近邻采样、相机与坐标转换 |
| `render/display.ts`, `tiff.ts` | PNG 显示映射、原精度 TIFF 逐页编码 |

滤波、形态学、填孔和粒子分析不再以 400 万像素拒绝输入。TypeScript 内核在计算 Worker 执行；高斯临时缓冲使用行环形缓存。原先整幅高斯 Float32 临时数组和运行时保留每步整图的问题已修正。默认结果缓存预算为 256 MiB，仅固定当前结果，其余可淘汰；缓存命中同时恢复图像和分析结果。撤销保存 Recipe 元数据，不保存每步整幅图像。

这仍是内存内计算：源数据集与当前帧输入 / 输出会占用完整像素缓冲。形态学、填孔、粒子分析仍可能分配全帧辅助数组。计算 Worker 使 UI 可响应，但同步内核只在步骤之间检查取消，尚未实现内核执行中抢占或完整分块管道。

ITK-Wasm 当前提供图像 I/O 和 PNG 编码，滤波仍由 TypeScript 内核完成。`ItkWasmComputeEngine` 管道接口并不等于已经配置了 ITK 滤波 WASM。实现说明不会将这两个路径混为一谈。

## 视口与精度

二维显示已移除 VTK.js、类型 shim、raw-loader 及 GLSL 配置。`ImageViewport` 根据可见区域和 DPR 分配 Canvas，从原始 TypedArray 按最近邻读取颜色，不创建源尺寸 Canvas 或整图 RGBA。1:1 对应一个源像素占一个设备像素；ROI 保存图像索引坐标，探查读取原始值。

科学数据始终保留只读源缓冲。灰度显示窗宽窗位、阈值预览不修改结果；彩色亮度面板按 ImageJ RGB 的实时像素语义显示调整后的值，探查、统计与 PNG 同步。应用、关闭面板、切页或继续处理时将 RGB 调整写入 Recipe。阈值整图输出 8 位；ROI 阈值保留区域外原数据类型与像素。显式灰度转换基于当前结果生成 8 位数据，保留此前的亮度等处理，撤销可恢复原精度。统计使用原值与 Welford 样本标准差，忽略 NaN / Infinity；原始浮点剖面保留其值。整数直方图按数据类型范围，浮点直方图按当前统计范围分箱。

`ColorContrastPanel` 结合 ImageJ Brightness/Contrast 的 Minimum / Maximum / Brightness / Contrast 与 Color Balance 的 All / Red / Green / Blue。RGB 8 位映射依据 [ContrastAdjuster](https://github.com/imagej/ImageJ/blob/master/ij/plugin/frame/ContrastAdjuster.java) 和 [ColorProcessor](https://github.com/imagej/ImageJ/blob/master/ij/process/ColorProcessor.java)：256 位置滑杆、中心 / 宽度与分段斜率、最小值向零取整和 256 倍 LUT 截断。切换通道保存实时 RGB 快照并复位范围；Reset 恢复当前快照，Auto 使用 ImageJ 的峰值排除与重复点击阈值策略，Set 接受精确最小 / 最大值。Apply 保留彩色并复位控件，Stack 弹窗支持当前切片、整栈和取消。色彩平衡菜单也已接入。产品仍保留浏览器面板布局及 Recipe 撤销；不声称复制 Java 桌面窗口系统。

分析 Worker 每幅结果只接收一次像素副本，移动 ROI 时仅更新坐标；整图统计可复用。RGB 统计使用与 Classic 一致的等权灰度。基础 3×3 滤波读取选区外邻域并仅写回 ROI；高斯、秩滤波等按 Classic 的裁剪选区语义处理。

## 导出

PNG 将显示映射生成标量 8 位或 RGB 图像，再由 ITK 编码，不经过源尺寸 Canvas。TIFF 使用 Blob 按页编码，保留 `uint8`、`uint16`、`int16`、`float32` 与 RGB 的标签及原始像素；奇数像素页做偶数字节对齐。整栈逐页重放各帧 Recipe，不切换 UI 当前页，也不同时保留所有计算帧。

TIFF 输出为无压缩经典 TIFF，要求同尺寸 / 通道数 / 数据类型，小于 4 GiB。T / C / Z 展平，不保留 OME / ImageJ 多维元数据。BigTIFF、磁盘虚拟栈、压缩指定页解码、超内存分块处理、Z 投影与其他禁用菜单仍未实现。

## Next.js 集成

`next.config.ts` 保留 ITK 包的浏览器入口别名以供 Turbopack 解析。Worker 通过静态 `new URL(..., import.meta.url)` 构建。懒创建计算 Worker 与延迟最终释放避免 React StrictMode 的重复初始化 / 清理破坏运行时；真实卸载释放 Worker。

## 验证记录

- 图像应用 90 个测试通过，包括旧算法、RGB 轴与形状、ImageJ 彩色 LUT / 滑杆 / Auto / 分通道 / ROI / 4K RGB、缓存淘汰、Stack 作用范围、撤销 / 重做、ROI 原精度、浮点算子及 TIFF 像素回归。
- 算法实际运行 4096×2160 与 7680×4320 的最小 / 最大滤波及 8K 高斯；高斯行缓存对照整幅浮点参考。宽 65536 的视口单测验证原值与固定屏幕缓冲。
- 浏览器验证双页 TIFF 翻页、当前页 / 整栈操作、撤销 / 重做、ROI 绘制与选区像素写回、统计 / 剖面、16 位 TIFF 导入与原精度导出。
- 浏览器验证 7680×4320 导入、高斯 / 最小滤波、完整分辨率 ITK PNG 导出及视口尺寸；另验证 RGB PNG、自动灰度、亮度应用和阈值预览。无页面异常。
- 图像应用 TypeScript 检查和生产构建通过。

这些验证覆盖具体图像和算法，不构成任意图像尺寸或任意 Stack 页数的承诺。后续大数据能力需要按需读取和磁盘存储，而不只是提高分配上限。
