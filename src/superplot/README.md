# super-plot

一个与主工作台**完全解耦**的实验模块，专注两件事：

1. **看大数据**：把 CSV 解析成列式类型化数组，百万行级波形也能流畅导入、缩放、导出。
2. **做 FFT**：内置独立频谱分析面板（窗函数、去趋势、Welch 平均、峰值标注）。

它与 `src/App.tsx`、`src/lib/*`、`src/components/*` 之间没有引用关系，也不写入工作台的
`localStorage`，因此可以独立迭代、独立开关。

## 访问方式

路由：`/zh/super-plot`、`/en/super-plot`、`/ja/super-plot`。

当前没有在导航栏挂入口，直接访问 URL 即可（避免影响既有页面）。页面 `metadata` 已设为
`noindex`。

## 目录结构

```text
src/superplot/
  types.ts                 列式数据集、频谱配置/结果类型
  index.ts                 模块公共出口
  components/
    SuperPlotApp.tsx       顶栏（品牌/文件/数据集/语言）+ 空态 + 元信息条
    SuperPlotWorkspace.tsx 工作区布局：上排双 plot，下排通栏设置区，持有全部交互状态
    WaveformPanel.tsx      波形三件套：WaveformPlot（图表+按窗口重抽稀）/
                           WaveformControls（X 轴/抽稀/信号）/ WaveformStats（统计）
    SpectrumPanel.tsx      频谱三件套：useSpectrumModel（状态+FFT 派生）/
                           SpectrumPlot / SpectrumControls（含 FFT 参数组）/ SpectrumResults（峰值表+摘要）
    PlotlyChart.tsx        通用 Plotly 封装（react/restyle/导出/视野回调）
    Controls.tsx           轻量表单控件
  lib/
    parse.ts               流式 CSV → 列式类型化数组，含时间列/采样率推断
    columns.ts             取列、窗口切片、统计
    downsample.ts          极值包络 / LTTB / 区间二分切片
    fft.ts                 基 2 FFT、窗函数、去趋势、单边幅度谱、Welch、找峰
    plotly.ts              Plotly 懒加载
    format.ts              工程计数法格式化
    i18n.ts                模块自带中英文案（ja 回退 en）
    colors.ts              模块调色板
```

## 关键设计

### 列式数据模型

`SuperDataset` 不再为每一行创建对象，而是按列存储：

- 数值列：`Float64Array` + 可选缺失掩码 `Uint8Array`，并缓存 `min/max/mean/validCount`。
- 字符串列：`string[]`。

导入走 `readSuperDataset()`：用 `file.stream()` 分块读取，按 `Date.now()`/行数预算主动让出主
线程，先采样判定列类型，再直接写入列缓冲，最后一次性生成 `Float64Array`。实测 53 MB /
140 万行 CSV 解析约 **275 ms**。

### 按窗口重新抽稀（progressive detail）

波形默认用**极值包络**抽稀：每个像素柱保留该区间的 min 与 max，尖峰/毛刺不会被抹掉。
用户缩放后，`PlotlyChart` 通过交互事件回调当前 X 视野，`WaveformPlot` 只截取该窗口内的原始
样本重新抽稀，再用 `Plotly.restyle` 就地替换数据，因此：

- 全览时 140 万行 → 约 4000 个包络点；
- 放大后同一窗口内重新取点，细节随缩放逐级增加；
- 视野不被打断（`uirevision` + restyle 而非 react）。

### FFT

`computeSpectrum()` 提供单边幅度谱：

- 窗函数：矩形 / Hann / Hamming / Blackman / Flat-top；
- 去趋势：无 / 去均值 / 去线性趋势；
- FFT 长度：自动（下一个 2 的幂）或手动指定（长度不足时安全截断，长度过剩时补零）；
- Welch：多段功率平均，段长自动向下取 2 的幂以保证段数真实生效；
- 幅度归一化：`A = 2·|X| / Σw`，可还原正弦真实幅度；
- `findSpectrumPeaks()` 做局部极大值 + 最小间隔筛选，并给出相对峰值 dB。

## 测试

纯逻辑均可在 Node 下直接测试，无需浏览器：

```bash
pnpm test          # tests/superplotFft.test.ts / superplotDownsample.test.ts / superplotParse.test.ts
```

覆盖：FFT 正确性与幅度标定、窗函数、Welch 段规划、抽稀保尖峰、CSV 列式解析、采样率推断、
窗口切片等。

## 已知边界

- 导入目前仅支持 CSV；Excel 请先用工作台转换。
- 字符串列会完整驻留内存（数值列才是类型化数组）；超大且字符串列很多的文件仍需谨慎。
- 频谱计算在主线程同步执行（140 万点约 126 ms），暂未放入 Worker。
- ja 文案回退到英文。

## 后续可做

- 把解析与 FFT 放进 Web Worker；
- 双光标测量（Δt / ΔV / 频率差）；
- 频谱触发电平、包络/峰值保持、瀑布图；
- 与主工作台的单向「发送到工作台」桥接（当前刻意不做）。
