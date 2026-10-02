# Stack 架构决策

本文是《科学图像工作台架构方案》第 4、5、8 节的落地依据。Stack 是本工作台的核心功能，
其读取与渲染方案经过对 ImageJ 1、Napari、OME-Zarr/NGFF 的源码与规范调查后确定。

调查方式为逐行阅读源码并记录行号证据，所有结论均可复查。凡未在代码或规范中找到依据的，
本文明确标注“未验证”，不做推测。

## 1 调查范围

| 对象 | 版本 / 出处 | 调查重点 |
| --- | --- | --- |
| ImageJ 1 | 本地 `E:\Project\tool\imagej`，`ij/ImageJ.java:81` 声明 `1.54u` | 多页 TIFF 按页随机读取、翻页流程、二维显示绘制 |
| Napari | 官方文档 stable 显示 9.1.0；源码 `napari/napari` 主分支（`src/` 布局） | 多维栈渲染栈、缓存策略、超大图处理 |
| OME-Zarr / NGFF | 规范 0.6，2026-09-17 发布 | 轴顺序、分块、多分辨率 |

## 2 ImageJ 的实际做法

ImageJ 有三类栈，语义不同，不能混用：

| 类 | 位置 | 适用场景 | 取页方式 |
| --- | --- | --- | --- |
| `ImageStack` | `ij/ImageStack.java:308` | 全内存 | `stack[n-1]` 直接取数组 |
| `VirtualStack` | `ij/VirtualStack.java:172` | 目录 + 每页一个独立文件 | 每次 `new Opener().openTempImage(path, names[n-1])` |
| `FileInfoVirtualStack` | `ij/plugin/FileInfoVirtualStack.java:207` | **单文件多页 TIFF** | 每次 `new FileOpener(info[n-1]).openProcessor()` |

我们的场景对应第三类，它由 `IJ.openVirtual(path)` 进入（`ij/IJ.java:1992`）。

### 2.1 索引建立：零像素字节读取

`ij/io/TiffDecoder.java:824-835` 以 IFD 链式跳转遍历索引：

```java
while (ifdOffset>0L) {
    in.seek(ifdOffset);            // 随机跳到该页 IFD
    FileInfo fi = OpenIFD();       // 读这一页的 tag 条目
    if (fi!=null) {
        list.add(fi);
        ifdOffset = ((long)getInt())&0xffffffffL;   // next IFD 偏移 → 继续跳转
    } else ifdOffset = 0L;
}
```

`OpenIFD()`（同文件 `:364-420`）逐条读 tag，并在 `count>1` 时以
`saveLoc → seek(lvalue) → 读 count 个值 → seek(saveLoc)` 取行外值数组：

```java
case STRIP_OFFSETS:
    if (count==1) fi.stripOffsets = new int[] {value};
    else {
        long saveLoc = in.getLongFilePointer();
        in.seek(lvalue);
        fi.stripOffsets = new int[count];
        for (int c=0; c<count; c++) fi.stripOffsets[c] = getInt();
        in.seek(saveLoc);
    }
```

**每个分段（segment）的字节偏移与长度全部来自 IFD 条目及其行外值数组，一个像素字节都不读。**
因此索引 IO 量只与 `页数 × tag 数` 相关，与文件大小无关；数百页的索引通常在几十 KB 量级。

索引粒度是**每 IFD（每页）一个 `FileInfo`**；strip 只是该 `FileInfo` 内的 `int[] stripOffsets` /
`int[] stripLengths`，不是独立对象。

### 2.2 按页读取

`ij/plugin/FileInfoVirtualStack.java:207-228`：

```java
info[n-1].nImages = 1;              // 把该页当作单页图读
FileOpener fo = new FileOpener(info[n-1]);
ip = fo.openProcessor();            // 按 info[n-1].getOffset() 定位
```

### 2.3 缓存：没有

三类栈均无 cache 字段，`ij/ImagePlus.java` 中也搜不到任何缓存代码。
每次 `getProcessor` 都重新走完整的打开与读取流程，来回翻页重复读文件。

### 2.4 默认打开多页 TIFF 并未使用按页读

`ij/io/Opener.java:1144-1148` 默认构造的是全内存 `ImageStack`，无大小阈值、无 UI 提示；
`FileInfoVirtualStack` 只能由用户显式选择触发（`ij/io/ImportDialog.java`，
`ij/plugin/FolderOpener.java:603`）。即 ImageJ 的日常使用路径并未启用按页读取。

### 2.5 显示：纯 CPU 软件绘制

`ij/gui/ImageCanvas.java` 全部为 AWT 软件绘制：`g.drawImage(...)`（`:235`、`:556`）、
`RenderingHints.KEY_INTERPOLATION`（`:257`）、`offScreenImage` 双缓冲（`:552-568`）。
无任何 GPU 渲染。

### 2.6 窗口 / level 走查找表

`ij/process/ImageProcessor.java:168` 要求色彩模型为 `IndexColorModel`，
即 256 级查找表；`setMinAndMax` 改变的是 LUT 而非逐像素浮点运算。

**本项目实测**：将逐像素浮点 `(value - lo) * scale` 换成 64K 项 LUT 查表后，
4096×4096 uint16 源、zoom=1 的视口光栅化耗时（中位，5 次取样）：

| 视口 | 逐像素浮点 | LUT 查表 | 提速 | 占 50ms 预算 |
| --- | --- | --- | --- | --- |
| 1920×1080 dpr=1 | 17.7 ms | 12.1 ms | 1.47× | 24% |
| 1920×1080 dpr=2 | 64.0 ms | 40.7 ms | 1.57× | 81% |
| 3840×2160 dpr=2 | 225.6 ms | 151.3 ms | 1.49× | 303% |

结论：LUT 是确定收益且零风险，但只值约 1.5 倍，**4K dpr=2 仍超预算 3 倍。
症结不在光栅化速度，而在需要处理的像素数量。**

## 3 ImageJ 不可照抄之处

| # | ImageJ 行为 | 证据 | 必须修改的原因 |
| --- | --- | --- | --- |
| 1 | 拒绝 tiled TIFF | `ij/io/TiffDecoder.java:538-540` `error("ImageJ cannot open tiled TIFFs...")` | 显微镜与扫描仪产出的文件普遍为 tiled。这是功能性缺口，不是优化空间 |
| 2 | 不支持 BigTIFF | 偏移以 `getInt()` 读取，如 `:398`、`:829` | 超过 4 GiB 的文件直接越界。本项目 `engine/tiff.ts:19-20` 的写出侧已明确拒绝 >4 GiB 并要求 BigTIFF，若读取侧不支持将无法读回自己格式支持的数据 |
| 3 | 无缓存 | 三类栈均无 cache 字段 | 来回翻页重复读文件 |
| 4 | 不支持“一个 IFD 多页” | `TiffDecoder.java:833-834` `if (fi.nImages>1) ifdOffset = 0L; // ignore extra IFDs in ImageJ and NIH Image stacks` | NIH Image 等格式将多页放入单个 IFD，直接忽略后续 IFD 会丢页 |

## 4 Napari 的做法

| 主题 | 结论 | 来源 |
| --- | --- | --- |
| 渲染后端 | VisPy（OpenGL）；napari 自身不含像素光栅化代码 | `src/napari/_vispy/layers/image.py` |
| 切片抽象 | **不存在 Slice layer**，切片是渲染管线阶段：`_SliceInput` / `_SliceRequest` / `_SliceResponse` | napari 主分支 |
| CPU 回退 | 未找到，全仓库无软件渲染路径 | 同上 |
| 超大图 | 自研 `TiledImageNode` | 见下 |

`_vispy/layers/image.py` 的选择规则：

```python
match ndisplay, shape:
    case 2, (s0, s1, *_) if s0 > M2D or s1 > M2D:
        res = self._tiledimage_node
    case 2, _:
        res = self._image_node
```

两点值得注意：

1. **napari 没有 CPU 回退**，与 ImageJ 构成明确的路线分野。
2. `TiledImageNode` 是为“图像尺寸超过 GPU 最大纹理尺寸”而专门实现的。
   这说明**分块支持不只是为了兼容既有文件格式，而是超大图渲染的必需品**。

## 5 OME-Zarr / NGFF

| 版本 | 底层存储 | 状态 |
| --- | --- | --- |
| 0.4 | Zarr v2 | 历史数据量大，规范仍建议支持读取 |
| 0.5 | Zarr v3 | 生态主力 |
| 0.6 | Zarr v3 | 2026-09-17 发布 |

0.6 的主要变化在坐标系统而非存储：`axes` 升级为具名 coordinate systems，
并引入 `coordinateTransformations`（identity / scale / translation / affine 等）。
就纯栈浏览而言，0.5 与 0.6 的读取路径基本一致。

分块（chunk）是 Zarr 的原生设计，适配随机访问；但它的前提是数据以 Zarr 存储。
面对来源不可控的第三方 TIFF，业界做法仍是建立索引后按需读取。

## 6 融合方案

ImageJ 因不支持 tile 而停留在 stripped-only，Napari 因分块而需要 Zarr 式存储。
二者之间存在一个结合点：**把 strip 与 tile 统一抽象为分段索引（segment index），
让同一份索引同时服务读取与渲染。**

| 用途 | 用法 | 收益 |
| --- | --- | --- |
| 读取 | 按页读该页全部分段的字节 | 不读整个 stack |
| 渲染 | 只上传可见区域覆盖的分段到 GPU | 高倍缩放时可见区域远小于全图 |

第二项直接针对第 2.6 节的结论：4K dpr=2 超预算并非光栅化不够快，
而是需要上传与处理的像素过多。缩放到 8× 时可见区域约为全图的 1/64，
只传可见分段可把需要处理的数据量降低一到两个数量级。
这一收益与“选 Canvas 还是 WebGL”无关，读取层与渲染层都受益。

据此确定五层实现顺序：

| 层 | 内容 | 依据 |
| --- | --- | --- |
| L0 | `TiffIndexer`：IFD 链式遍历，输出 `PageIndex[]`，每页含统一 `segments`；支持 strip + tile + BigTIFF | §2.1 已验证的零像素读索引，补齐 §3 的三项缺口 |
| L1 | `PageSource.readPage(n, region?)`：按索引只读所需字节，压缩解码委托 ITK-Wasm | §2.2 的按页读，补齐 tile 与区域读取 |
| L2 | 字节预算 LRU 缓存 + 邻页预取 | 现有 `engine/scheduler/cache.ts`；ImageJ 无此能力（§2.3） |
| L3 | WebGL2 主渲染（只传可见区域分段）/ `rasterizeViewport` + LUT 回退 | §4 的 GPU 路线 + §2.6 的 LUT 思路 |
| L4 | `encodeTiffStack` 增加多分辨率金字塔 | §5 的金字塔思路 |

L1、L2 是栈浏览的地基，与 L3 的渲染后端选型正交，可以先行实现。

## 7 与既有文档的关系

第 8 节关于二维视口的“LUT 优化”在本轮实测后应补充：LUT 只值约 1.5 倍，
不足以覆盖 4K dpr=2。真正的杠杆是减少需要传输与处理的像素数量（§6）。

第 4 节“优先按偏移读取所需字节，避免大文件一开始就调用完整 `file.arrayBuffer`”
与 §2.1 的实测一致，且明确了实现方式为 IFD 链式遍历。

## 8 未验证事项

- 压缩 TIFF 的分段级随机读取未验证。压缩数据必须整段解压，
  因此 `readPage` 对压缩页只能整页读，无法按可见区域部分读。压缩页的渲染收益因此受限。
- 页面文件的 `TIFFTAG_PAGE_NUMBER` 与 SubIFDs（多页嵌套在单一 IFD 内）未纳入索引，
  仅覆盖“一个 IFD 一页”与“一个 IFD 多页（nImages）”两种情形。
- IFD 链式遍历在 IFD 全部前置、像素数据后置的常见布局下已由 ImageJ 验证；
  但像素数据与 IFD 交错排布的文件中，索引仍只读 IFD 区域，不受影响。