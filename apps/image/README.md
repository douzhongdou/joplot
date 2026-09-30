# 图像工作台（ImageJ 浏览器移植）README

本文档说明 joplot 中 `imagej` 图像工作台的**迁移范围**、**代码位置**与**不支持的 Java 桌面功能**。文档为中文，代码与注释遵循仓库既有约定。

## 1. 入口与路由

| 语言 | 路由 |
| --- | --- |
| 中文 | `/zh/imagej` |
| English | `/en/imagej` |
| 日本語 | `/ja/imagej` |

- 页面文件：`app/[lang]/imagej/page.tsx`（`generateStaticParams` 覆盖 `en` / `zh` / `ja`，与 `science`、`super-plot` 一致，`robots: noindex`）。
- 导航入口：`src/components/AppNavbar.tsx` 的板块导航新增「图像 / Images / 画像」，路由拼装函数为 `src/i18n/config.ts` 中的 `getImagejPath`。
- 文案：`src/imagej/lib/i18n.ts` 内置中英日三份等结构文案；`nav.imagej` 增补在 `src/i18n/dictionaries/*.ts`。

## 2. 代码结构

```
src/imagej/
├── lib/
│   ├── processor.ts   # 8 位像素算法、ROI、直方图、测量、Otsu、撤销历史、导出
│   ├── binary.ts      # 二值形态学、填孔、8 连通粒子分析
│   ├── tiff.ts        # 经典 TIFF 的 8 位灰度、多页 IFD 编解码
│   ├── filters.ts     # 高斯模糊、3×3 最小/最大值秩滤波
│   └── i18n.ts        # 中英日文案
└── components/
    └── ImageJApp.tsx  # 导入、画布、ROI 交互、操作面板、直方图与统计、PNG 导出
tests/imagej.test.ts   # 算法与文案结构单测（node --test）
```

- **算法全部为纯 TypeScript**，不引入任何 Java 文件、Java 运行时或字节码；参考实现只读来源于 `E:\Project\tool\imagej`。
- 所有处理均在浏览器本地完成：图片通过 `<input type="file">` / 拖拽解码到内存，**不上传服务器**，也没有任何网络请求。

## 3. 迁移范围（已实现）

参考源码：`ij/process/ByteProcessor.java`、`ij/process/ImageProcessor.java`、`ij/process/AutoThresholder.java`。

| ImageJ 概念 | joplot 实现 | 说明 |
| --- | --- | --- |
| `ByteProcessor` 8-bit 灰度 | `GrayImage { width, height, data: Uint8Array }` | 行优先 `data[y * width + x]` |
| `ColorProcessor` 转灰度 | `toGrayFromRgba` | 默认与 ImageJ 相同的 1/3 等权，可传 BT.601 权重 |
| `process(INVERT)` | `invert` | `255 - v` |
| Brightness/Contrast | `levelsRange` + `applyLevels` | 滑杆先做显示级预览，点「应用」写回像素（对应 ImageJ 的 Apply） |
| `threshold(level)` | `applyThreshold` | `≤ level → 0`，`> level → 255` |
| `AutoThresholder.Otsu` | `otsuThreshold` | 先走 `bilevel` 快捷判断（1~2 个非零桶），否则最大化类间方差 |
| `BLUR_MORE`（3×3 均值） | `mean3x3` | `(sum + 4) / 9` 整数口径 |
| `MEDIAN_FILTER` | `median3x3` | 9 邻域取中位数 |
| `sharpen()` | `sharpen3x3` | `{-1..12..-1}` 核，`scale/2` 舍入与向零取整与 Java 一致 |
| `findEdges()`（Sobel） | `sobelEdges` | `sqrt(gx² + gy²)` 截断到 255 |
| `convolve3x3(kernel)` | `convolve3x3` | 校验 9 核元素 |
| `crop()` / ROI | `cropImage` / `clampRect` / `resolveRoi` / `applyWithinRoi` | ROI 越界自动夹取，处理结果仅写回选区 |
| `flipHorizontal` / `flipVertical` | 同名函数 | 返回新图，不改入参 |
| `rotateRight` / `rotateLeft` | `rotate90(image, 'cw' \| 'ccw')` | 90° 旋转 |
| `getHistogram()` | `histogram(image, rect)` | 支持整图或 ROI 的 256 桶直方图 |
| `ImageStatistics` | `measure(image, rect)` | 面积、均值、最小/最大、样本标准差（`n-1` 口径，与 `calculateStdDev` 一致） |
| `BinaryProcessor` 子集 | `erode` / `dilate` / `openBinary` / `closeBinary` / `fillHoles` | 白色为前景的二值形态学 |
| `GaussianBlur` / `RankFilters` 子集 | `gaussianBlur` / `minimum3x3` / `maximum3x3` | 可调 σ 的可分离高斯滤波及 3×3 秩滤波 |
| `ParticleAnalyzer` 子集 | `analyzeParticles` | 8 连通标记、按最小面积筛选、面积/周长/圆度/质心/外接矩形，结果表可导出 CSV |
| `TiffDecoder` / `FileSaver` 子集 | `decodeTiff` / `encodeTiff` | 无压缩 8 位灰度、多页 IFD、切片切换与 TIFF 导出 |
| 撤销（`Undo`） | `ImageHistory` | 条目数上限 24 + 192 MB 字节预算，超限淘汰最旧快照 |
| 导出 | `toRgba` + Canvas `toBlob` | 结果以 PNG 下载 |

页面能力：本地上传 / 拖拽导入、多页 TIFF 切片切换、原图与结果展示、缩放（12.5%~800%、适应窗口）、矩形 ROI 绘制与移动、灰度、反相、亮度/对比度、手动阈值与自动 Otsu、3×3 均值/中值/锐化/Sobel 边缘、二值形态学、粒子结果表、按 ROI 裁剪、水平/垂直翻转、90° 旋转、撤销/重做、PNG/TIFF 导出、直方图与整图/ROI 测量（面积、均值、最小、最大、标准差）。

## 4. 不支持的 Java 桌面功能

以下 ImageJ 1.x 能力**有意不迁移**（依赖 Swing/AWT 桌面栈、宏系统或超出本任务范围）：

- **桌面 UI 与窗口系统**：`ImageJ` 主窗口、`Menus`、`WindowManager`、`Macro`/`Executer` 宏语言、插件机制（`plugins/`、`ij/plugin/**`）、命令监听器。
- **高级图像栈**：`StackProcessor`、`StackConverter`、`VirtualStack`、自动播放与 `Overlay`；当前仅逐页切换、处理与导出无压缩灰度 TIFF。
- **非 8-bit 数据**：`ShortProcessor`（16-bit）、`FloatProcessor`（32-bit）、`IntProcessor` 及其标定（`Calibration`）、`cTable` 校准表。
- **彩色处理**：`ColorProcessor` 的逐通道运算、`LUT`/`IndexColorModel` 伪彩、`MedianCut` 量化、`ColorSpaceConverter` 色彩空间转换；本工作台只保留“彩色 → 灰度”一步。
- **完整 ROI 体系**：`Roi` 的椭圆/多边形/自由选取/线段、`PolygonFiller`、`FloodFiller`；本工作台只支持**矩形 ROI**。
- **高级形态学与滤波**：`outline`/`skeletonize`、滚动球背景减除、`FHT`（FFT 滤波）、任意尺寸卷积（`convolve(float[])`）、`rotate(angle)` 任意角度旋转与插值（BILINEAR/BICUBIC）、`resize`/`bin` 重采样。
- **高级分析**：`EllipseFitter`、粒子阈值筛选/叠加轮廓、阈值分割向量、`AutoThresholder` 中除 Otsu 外的其余方法（Huang、Li、Triangle、Yen、IsoData 等）。
- **测量选项**：除面积/均值/极值/标准差外的 `mode`、中位数、偏度/峰度、质心、`Area Fraction`、阈值内测量（`threshold(min,max)` 的测量窗口）。
- **8 位灰度之外的 LUT 操作**：`applyLut`、`invertLut`、阈值红黑覆盖显示（本工作台用二值化结果 + 直方图阈值标线代替）。
- **IO**：压缩 TIFF、RGB/16/32 位 TIFF、ImageJ 专有栈元数据、DICOM、FITS、ZIP 堆栈读写，以及 `Prefs`/`RecentOpener` 等桌面偏好。

## 5. 行为差异与限制

- **边界处理**：3×3 滤波使用边界复制（replicate padding）；有矩形 ROI 时读取整图邻域，仅写回 ROI 内像素。水平/垂直翻转在 ROI 内执行；90° 旋转整图并清除 ROI。亮度/对比度预览与应用作用于整图。
- **阈值语义**：`applyThreshold` 对应 `ByteProcessor.threshold(level)`（≤ level 为背景），未实现 ImageJ 的 `dark background` / `over-under LUT` 显示。
- **亮度/对比度**：拖动滑杆只是预览（按 `convertToByte(true)` 的 min/max 缩放），点击「应用亮度/对比度」才会写入像素并进入撤销历史。
- **内存限制**：单张图片上限 `MAX_IMAGE_PIXELS = 40,000,000` 像素且边长 ≤ 16,384（Canvas 限制）；撤销历史 24 条 / 192 MB。超限会给出明确错误提示，不会静默崩溃。
- **二值运算**：以非零像素为白色前景，粒子分析使用 8 连通、4 邻边界周长；二值形态学与粒子分析上限 400 万像素，目前在主线程运行，大图请先裁剪。算法定义与 ImageJ 完整配置并不完全等价。
- **高级滤波**：高斯与秩滤波上限 400 万像素；选择 ROI 时先裁剪选区再处理，边界复制取自选区边界。基础 3×3 滤波则读取选区外的邻域像素。
- **多页 TIFF**：每页必须同尺寸且为无压缩 8 位单通道，总像素上限 1 亿。可逐页做不改变尺寸的处理；多页栈禁用裁剪与 90° 旋转，撤销历史在切换切片时清空。当前 TIFF 解码不支持 ImageJ 仅用首个 IFD 描述其余切片的专有格式。
- **正确性边界**：算法测试覆盖固定像素样例与往返编码；尚未用原版 Java ImageJ 生成逐像素黄金基准，不能宣称所有边界行为与 ImageJ 完全一致。
- **执行环境**：图像处理目前在浏览器主线程运行，未接入 Worker 或 IndexedDB 恢复；大图操作可能暂时阻塞界面。
- **灰度工作流**：图片导入时自动生成灰度结果（原图彩色保留用于对照），「灰度」按钮用于从原图重建灰度基线。
- **导出**：导出的是当前显示结果（含未应用的亮度/对比度预览），格式固定 PNG。

## 6. 验证命令

```bash
# 类型检查（不要运行 next build / pnpm build）
npx tsc --noEmit

# 算法、TIFF 与文案测试
node --experimental-strip-types --test tests/imagej*.test.ts

# 全量测试（含既有用例，确认没有回归）
npm test
```

## 7. 未改动的部分

- `src/science/**`、`src/superplot/**` 等既有模块未做任何重构。
- 站点地图与 SEO 索引未新增条目（与 `science`/`super-plot` 一致，页面 `noindex`）。
- 未新增任何依赖，仅复用现有 shadcn/ui（`Button`、`Label`）与 lucide 图标。
