# 科学图像计算引擎：实现说明与现状

日期：2026-10-02。本文件记录《科学图像工作台架构方案》（`scientific-image-engine-design.md`）
的落地情况：已实现的模块、与设计文档的对应关系、已验证与未验证的内容。

> 设计文档仍然有效，是目标契约；本文件只说明当前代码到了哪一步。

## 1. 结论速览

- 已按方案搭建 P0 数据契约、区域读取、Recipe/撤销、字节预算缓存、任务优先级/合并、
  统计合并、显示几何，并在纯 TS 后端上跑通「导入 → 显示源图 → 加步骤 → 撤销 → 跳页缓存」
  的完整链路，全部有单测（59 个用例通过）。
- 已接入 **ITK-Wasm** 做图像 I/O（`@itk-wasm/image-io` 的 `readImage` / `writeImage`），
  保留 16 位 / 浮点 / 多通道精度，并提供了运行按需编译算子的 `runPipeline` 适配。
- 已接入 **VTK.js** 二维视口（`vtkGenericRenderWindow` + `vtkImageMapper` + 最近邻插值），
  以及 `ITKHelper.convertItkToVtkImage`。
- 计算与解码走 **Worker**（`new Worker(new URL(...), { type: 'module' })`），Worker 不可用时
  回退到主线程宿主，行为一致。
- **已在真实浏览器 (`next dev`) 端到端验证**：导入 TIFF 与 PNG（PNG 走真实 ITK-Wasm 解码，
  无回退路径）、VTK 显示、添加 invert/measure 步骤、撤销、缓存命中、C 轴通道切换均正常，
  无控制台报错。
- **尚未完成**：方案第 6 节要求的 ITK 算子 WASM 只是「按需编译」的机制，官方 npm 上没有
  高斯 / 中值 / 形态学 / 连通域等滤波包；当前这些算子由纯 TS 后端实现，是 P1 可运行通路，
  不是最终的高性能实现。分块 / halo / 跨块连通域也尚未实现。

## 2. 代码结构

```
src/imagej/engine/
├── types.ts             # Dtype、命名轴、SpatialTransform、Region、ImageBlock、PixelArray
├── dataset.ts           # Dataset、revision、轴/形状派生、切片定位
├── storage.ts           # Storage 接口、能力查询、MemoryStorage 区域读取
├── recipe.ts            # Recipe、线性步骤链、版本键、RecipeHistory（撤销）
├── operators.ts         # 算子能力声明、参数校验、UI 注册表桥接
├── stats.ts             # 可合并统计（跨块 / 跨 Worker 合并）
├── importer.ts          # 文件 → Dataset + Storage（ITK 优先，内置 TIFF 回退）
├── runtime.ts           # 运行时：缓存、预取、步骤与撤销的状态编排
├── scheduler/
│   ├── cache.ts         # ByteCache：按字节预算的 LRU，支持 pin
│   └── queue.ts         # TaskQueue 优先级/合并、VersionGuard 过期检查
├── compute/
│   ├── pureOps.ts       # 纯 TS 算子（8 位委托既有 ImageJ 内核，其他 dtype 通用路径）
│   ├── engine.ts        # ComputeEngine + PureComputeEngine（Recipe 执行）
│   └── itk.ts           # ITK-Wasm 适配：Image↔Block、读写文件、runPipeline
├── render/
│   ├── geometry.ts      # 索引/屏幕坐标、DPR、1:1、缩放锚点
│   ├── rgba.ts          # 窗口映射到 RGBA（PNG 导出）
│   └── vtk.ts           # VTK.js 二维视口（动态载入）
└── worker/
    ├── host.ts          # EngineHost：管理 Dataset/Storage 并执行
    ├── engine.worker.ts # Worker 入口
    ├── client.ts        # EngineClient（Worker / 主线程回退）
    └── protocol.ts      # Worker 消息协议
```

UI：`src/imagej/components/ScientificImageWorkspace.tsx`（默认页 `/imagej`）与
`useImageRuntime.ts`。旧版 8 位工作台保留在 `/imagej/classic`（`ImageJApp.tsx`）。

## 3. 与架构方案各阶段的对应

| 阶段 | 方案要求 | 当前实现 |
| --- | --- | --- |
| P0 数据契约 | Dataset、ViewState、Recipe、Storage 区域接口、算子能力 | `types/dataset/storage/recipe/operators`，均有单测 |
| P1 原型通路 | 真实科学 TIFF 读取、ITK 代表算子、VTK 二维视口、原值探查 | I/O 与 VTK 已接；算子暂用纯 TS 后端。原值探查为窗口映射前读取 |
| P2 Stack 浏览 | 原分辨率邻页预取、队列优先级、有限缓存、过期结果 | `runtime.schedulePrefetch` + `TaskQueue` + `ByteCache` + `VersionGuard` |
| P3 步骤与撤销 | 参数提交、作用范围、步骤查看、撤销最近提交 | `RecipeHistory` + `runtime` 已实现；作用范围中 stack/roi 已用于 measure |
| P4 算法扩展 | 形态学、标签、统计、三维、批量导出 | 纯 TS 覆盖常见算子；三维与跨块连通域未实现 |

显示状态（ViewState）目前在运行时与组件中体现为切片选择与窗宽窗位，尚未抽出独立类型；
LUT / 缩放平移状态需要在 UI 层继续补齐。

## 4. ITK-Wasm 现状说明

- `itk-wasm@1.0.0-b.201` 已是「管道」模型：核心提供 `runPipeline`，具体算子由独立 WASM 提供。
- `@itk-wasm/image-io@1.6.1` 提供 `readImage` / `writeImage`，用于保留精度的科学图像读写；
  其中 `readImage` 已在浏览器中验证可解码 PNG（无回退路径），TIFF 也走同一入口。
- 官方 npm 上目前**没有**高斯、中值、形态学、连通域等滤波包；这些需要按方案「按需编译」，
  编译产物通过 `compute/itk.ts` 的 `runItkPipeline({ pipelinePath, args, inputs, outputs })` 接入。
- 因此当前算子的执行后端是 `PureComputeEngine`。`ItkWasmComputeEngine` 的接入点是
  `operators.ts` 的能力声明 + `runItkPipeline`，替换时 UI 无需改动。

## 5. Worker 与所有权

- 解码与计算在 Worker 中；主线程只发送 `File` 与 Recipe。
- 结果图像以 `ArrayBuffer` **转移**回主线程（`engine.worker.ts` 的 `serializeBlock`），
  发送侧随后不可再引用，符合方案的转移所有权约定。
- Worker 创建失败时 `createEngineClient` 回退主线程宿主（测试与旧环境）。

## 6. 已验证

- `npx tsc --noEmit`：通过。
- `npm test`：59 个用例通过，覆盖数据契约、区域读取、Recipe/撤销、统计合并、缓存淘汰、
  任务优先级与合并、版本过期、坐标换算、算子参数校验、纯 TS 引擎（含 8/16 位、整卷统计）、
  运行时缓存命中与撤销驱动重算、RGBA 映射。
- 浏览器（`next dev`，Turbopack）端到端：`/imagej` 导入 8 位 TIFF 显示正确；导入 PNG 时
  `@itk-wasm/image-io` 真实解码成功且无回退警告；invert 步骤生效；measure 输出
  1024 像素 / 均值 126 / min 0 / max 252 / 标准差 73.93；撤销后缓存命中；C 轴 1/3 通道切换正常；
  页脚显示「引擎：worker」，即 `new Worker(new URL(...))` 在 Turbopack 下成功打包并执行；
  控制台无错误。
- 2D 视口正确性（像素采样）：渲染画布随容器尺寸（877×749，非默认 300×300）；图像内容外接框
  与源比例一致且水平垂直对齐（无 3D 倾斜）；左上白块 / 中央蓝底 / 右下红块的 RGB 与位置都正确，
  说明彩色合成与方向均正确。

命令（在 `apps/image` 下）：

```bash
npx tsc --noEmit
npm test
```

### Turbopack 配置要求

VTK.js 与 ITK-Wasm 在本项目的 Next 16（Turbopack 默认）下需要两项配置（见 `next.config.ts`）：

```ts
turbopack: {
  rules: {
    // VTK.js 以字符串导入 .glsl；Turbopack 内置 type:'raw' 对深层导入不生效，改用 raw-loader。
    '*.glsl': { loaders: ['raw-loader'], as: '*.js' },
  },
  resolveAlias: {
    // 这两个包的 exports 条件里没有 import，Turbopack 无法直接解析，指到具体浏览器入口。
    'itk-wasm': 'itk-wasm/dist/index.js',
    '@itk-wasm/image-io': '@itk-wasm/image-io/dist/index.js',
  },
}
```

`raw-loader` 是 `apps/image` 的开发依赖。缺少上述配置时，动态 import 会静默失败并回退到内置
8 位 TIFF 解码器，VTK 则会因着色器为空而在渲染时抛错。

## 7. 未验证 / 限制

- 浏览器验证覆盖的是 `next dev`（Turbopack 开发构建）与主路径；**生产构建（`next build`）未运行**
  （仓库约定不运行 build），其他浏览器、GPU 与 WebGPU 后端未验证。
- Worker 路径已确认（页脚显示「引擎：worker」）；主线程回退路径仅在单测中以注入客户端方式覆盖。
- 纯 TS 后端整帧处理，未做分块 / halo / 重叠块，也未实现跨块连通域合并（方案第 6 节）。
- `measure` 仅产出单通道统计；粒子表与直方图尚未接入新工作台。
- RGB/彩色图像以 `c` 轴平面存放并合成彩色显示（`componentKind: 'rgb'`，默认线性插值）；逐像素
  算子暂不支持彩色输入，会给出明确错误，需先添加 grayscale 步骤。
- 新工作台 UI 文案目前为中文，尚未接入 `@joplot/i18n` 的中英日字典。
- 递归高斯的分块限制、GPU 纹理精度、默认内存预算与 Worker 数量等，仍属方案第 13 节
  要求的实测项。
- 磁盘派生缓存、刷新恢复、OME-Zarr、远程存储 / 计算未实现（方案列为后续）。

## 8. 后续建议顺序

1. 在真实浏览器验证 P1 链路（读取指定页、一个滤波、一个统计、VTK 显示、翻页、撤销）。
2. 编译所需的 ITK 算子 WASM，逐个替换 `PureComputeEngine` 的对应分支，并用黄金样例比对。
3. 实现分块执行与 halo 管理，替换「整帧处理」；补跨块连通域标签合并。
4. 把 ViewState（LUT、缩放、平移、当前工具）抽成独立类型并接入运行时。
5. 接入 i18n 与更多分析视图（直方图、粒子表、ROI）。
