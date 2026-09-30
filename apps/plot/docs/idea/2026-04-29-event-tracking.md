# Joplot Umami 事件埋点实施规范（V1）

## 1. 文档目的

这份文档不是想法草稿，而是一期可以直接执行的埋点实施规范。

目标是把 Joplot 现有的 Umami 页面访问统计，升级为可分析核心产品行为的事件埋点体系，让我们能够回答下面这些问题：

- 有多少访问用户真正开始使用产品
- 有多少用户成功完成 CSV 解析
- 有多少用户成功生成图表
- 有多少用户完成导出动作
- 用户更常用哪些图表类型
- 用户在哪个环节流失最多

---

## 2. 范围

本期只做匿名事件埋点和 Umami 后台分析配置，不做用户身份体系，不做广告追踪，不做内容级采集。

### 本期包含

- Joplot 前端自定义事件埋点
- Umami 事件属性上报
- Umami Goals 配置
- Umami Funnels 配置
- 上线后的验收与观察口径

### 本期不做

- 用户登录
- Cookie Banner
- Session Replay
- 用户画像
- 邮箱收集
- 广告像素
- 任何可识别个人身份的追踪

---

## 3. 隐私边界

Joplot 必须坚持隐私优先，所有埋点都只能上传匿名统计特征。

### 严禁上传的数据

- CSV 原始内容
- CSV 文件名
- 本地文件路径
- 邮箱
- 用户名
- 联系方式
- 精确 IP
- Cookie 追踪身份
- 任何可反推用户身份的自由文本

### 允许上传的数据

- `rows`
- `columns`
- `file_size_kb`
- `chart_type`
- `language`
- `input_method`
- `reason`

### 字段约束

- 所有事件属性统一使用 `snake_case`
- 事件名控制在 50 个字符以内
- 属性值只允许 `string`、`number`、`boolean`
- 未知值统一回退到 `unknown`

---

## 4. 事件设计原则

### 4.1 不阻塞主流程

埋点失败不能影响用户上传、解析、出图、下载等主功能。

### 4.2 统一口径

同一个业务动作只定义一套事件名和参数名，避免后续报表口径混乱。

### 4.3 只记录有价值动作

不记录无意义噪音，不为了“数据多”而加埋点。

### 4.4 先保证漏斗闭环

优先覆盖从访问到出图、导出的关键路径，而不是先做大量边缘行为。

---

## 5. 一期事件清单

以下事件为一期必做。

| 事件名 | 目的 | 触发时机 | 必带属性 | 备注 |
| --- | --- | --- | --- | --- |
| `upload_csv` | 判断有多少用户开始使用产品 | 用户成功提交可解析输入后立即触发 | `rows` `columns` `file_size_kb` `input_method` | 仅在拿到有效输入时触发 |
| `parse_success` | 判断解析链路是否顺畅 | CSV 成功解析为结构化数据后触发 | `rows` `columns` | 一次上传最多触发一次 |
| `parse_fail` | 判断用户在哪类解析问题上失败 | 解析失败后触发 | `reason` | 不上传原始错误内容 |
| `render_chart` | 判断用户是否完成核心价值动作 | 图表成功渲染到页面后触发 | `chart_type` `rows` `columns` | 首次成功出图必须触发；主动切换图表类型成功后可再次触发 |
| `download_png` | 判断导出意愿 | 用户点击下载并成功进入下载流程后触发 | `chart_type` | 只在成功开始导出时触发 |
| `copy_image` | 判断分享/复用意愿 | 用户成功复制图片到剪贴板后触发 | `chart_type` | 失败时不触发 |
| `load_demo_data` | 判断示例数据对激活的作用 | 用户点击并成功载入示例数据后触发 | `language` | 建议后续观察其转化表现 |
| `page_language` | 判断站点语言分布 | 首次进入页面并完成语言判定后触发一次 | `language` | 仅做分析辅助，不纳入核心漏斗 |

---

## 6. 事件属性定义

### `rows`

- 类型：`number`
- 含义：数据行数，不含表头

### `columns`

- 类型：`number`
- 含义：列数

### `file_size_kb`

- 类型：`number`
- 含义：文件大小，单位 KB
- 建议：四舍五入取整，避免出现无意义长小数

### `chart_type`

- 类型：`string`
- 可选值：
  - `line`
  - `bar`
  - `scatter`
  - `area`
  - `radar`
  - `heatmap`
  - `stats`
  - `unknown`

### `language`

- 类型：`string`
- 可选值：
  - `en`
  - `zh`
  - `ja`
  - `unknown`

### `input_method`

- 类型：`string`
- 可选值：
  - `drag_drop`
  - `file_picker`
  - `paste`
  - `demo`
  - `unknown`

### `reason`

- 类型：`string`
- 可选值：
  - `invalid_format`
  - `empty_file`
  - `too_large`
  - `encoding_error`
  - `parse_error`
  - `unknown`

说明：

- `reason` 只传归类后的错误类型，不传原始报错文案
- 如果现有代码里错误类型尚未标准化，先做一个错误映射函数

---

## 7. 事件触发口径

这是本方案里最重要的部分，研发实现时必须按下面口径执行。

### 7.1 `upload_csv`

触发条件：

- 用户通过拖拽、文件选择、粘贴文本三种方式之一，成功提交了可进入解析流程的内容

不要触发的情况：

- 仅打开文件选择器但未选择文件
- 用户拖拽了无效对象但未进入解析流程
- 用户点击上传但立刻取消

### 7.2 `parse_success`

触发条件：

- CSV 被成功解析为可用于图表渲染的结构化数据

不要触发的情况：

- 文件已读取但解析结果不可用
- 解析后因校验失败被拒绝

### 7.3 `parse_fail`

触发条件：

- CSV 进入了解析流程，但最终未能得到可用数据

要求：

- 必须归类到 `reason`
- 不上传异常堆栈
- 不上传用户输入内容

### 7.4 `render_chart`

触发条件：

- 图表成功渲染并对用户可见

推荐口径：

- 首次成功渲染必须触发一次
- 用户主动切换到另一种图表类型且成功渲染时，可以再次触发
- 纯粹因为组件重复渲染、状态抖动、窗口 resize 导致的重新渲染，不应重复触发

### 7.5 `download_png`

触发条件：

- 用户点击下载后，下载逻辑成功开始执行

不要触发的情况：

- 点击按钮但因运行时错误未能生成导出内容

### 7.6 `copy_image`

触发条件：

- 成功写入剪贴板后触发

不要触发的情况：

- 用户点击复制但浏览器拒绝权限
- 复制逻辑执行失败

### 7.7 `load_demo_data`

触发条件：

- 示例数据成功载入并进入正常流程

说明：

- 如果示例数据最终也会进入解析和出图流程，那么后续 `parse_success`、`render_chart` 也应正常触发

### 7.8 `page_language`

触发条件：

- 页面首次完成语言判定后触发一次

说明：

- 此事件主要用于后续看多语言分布
- 不建议在一次会话中频繁重复上报

---

## 8. 前端实现规范

### 8.1 埋点封装文件

创建文件：

```text
/lib/track.ts
```

推荐实现：

```ts
type TrackPayload = Record<string, string | number | boolean | null | undefined>

export function track(eventName: string, data?: TrackPayload) {
  if (typeof window === 'undefined') return

  const umami = (window as Window & { umami?: { track?: Function } }).umami

  if (!umami?.track) return

  try {
    umami.track(eventName, data ?? {})
  } catch (error) {
    console.error('[track] failed', error)
  }
}
```

要求：

- SSR 环境下安全
- Umami 未加载时静默跳过
- 埋点异常只记控制台，不影响主流程

### 8.2 推荐辅助函数

建议补两个小工具，避免每个业务点重复处理：

- `normalizeLanguage(input): 'en' | 'zh' | 'ja' | 'unknown'`
- `mapParseErrorToReason(error): ParseFailReason`

### 8.3 参数清洗

上报前做最小清洗：

- `rows`、`columns`、`file_size_kb` 必须是有限数字
- `chart_type`、`language`、`input_method`、`reason` 必须落在枚举内
- 不合法值回退到 `unknown`

---

## 9. 集成位置说明

下面是研发接入时应该落埋点的位置。

### 上传完成后

```ts
track('upload_csv', {
  rows,
  columns,
  file_size_kb,
  input_method,
})
```

### 解析成功后

```ts
track('parse_success', {
  rows,
  columns,
})
```

### 解析失败后

```ts
track('parse_fail', {
  reason,
})
```

### 图表成功渲染后

```ts
track('render_chart', {
  chart_type,
  rows,
  columns,
})
```

### 下载 PNG 成功开始后

```ts
track('download_png', {
  chart_type,
})
```

### 复制图片成功后

```ts
track('copy_image', {
  chart_type,
})
```

### 加载示例数据后

```ts
track('load_demo_data', {
  language,
})
```

### 首次确定页面语言后

```ts
track('page_language', {
  language,
})
```

---

## 10. 你需要在 Umami 里做什么

这一节是面向产品/站长/实施者的后台操作说明。

### 10.1 确认 Website 已创建

如果 Joplot 还没有在 Umami 里建站点：

1. 登录 Umami
2. 进入 `Websites`
3. 点击 `Add Website`
4. 创建 `Joplot` 站点
5. 填入生产环境域名

建议：

- 生产环境和预发布环境分开建站
- 不要把测试流量和正式流量混在同一个 Website 里

### 10.2 确认 Tracking Code 已正确接入

如果页面访问数据已经有了，说明大概率已接入，但仍然建议核对一次。

在 Umami 中：

1. 进入 `Websites`
2. 找到 `Joplot`
3. 点击 `Edit`
4. 在 `Tracking code` 区域复制脚本
5. 确认该脚本已放入站点页面的 `<head>` 中

如果是 Next.js，优先使用 `next/script` 挂载。

### 10.3 发布后先验证基础采集

部署埋点代码后，在浏览器里手动走一遍流程：

1. 打开首页
2. 上传一个正常 CSV
3. 成功生成图表
4. 下载一次 PNG
5. 复制一次图片
6. 再故意上传一个错误样例，验证 `parse_fail`

然后在 Umami 中查看：

1. `Websites`
2. 点击 `View`
3. 打开顶部或导航中的 `Events`

你应该能看到这些事件开始出现：

- `upload_csv`
- `parse_success`
- `parse_fail`
- `render_chart`
- `download_png`
- `copy_image`
- `load_demo_data`
- `page_language`

### 10.4 在 Event data 中查看属性是否正确

仅看到事件名还不够，还要确认事件属性也进来了。

在 Umami 中：

1. 进入 `Websites`
2. 点击 `View`
3. 点击顶部导航中的 `Event data`

重点检查下面这些字段是否能看到：

- `rows`
- `columns`
- `file_size_kb`
- `chart_type`
- `language`
- `input_method`
- `reason`

验收标准：

- 能看到字段名
- 能看到字段值分布
- 没有出现文件名、原始 CSV、报错堆栈等敏感内容

### 10.5 创建 Goals

Goals 用来观察“某个关键动作的转化率”。

建议至少建立下面 3 个 Goal：

#### Goal A：开始使用产品

- 类型：`Triggered event`
- 值：`upload_csv`

含义：

- 有多少访问用户真正开始上传/粘贴数据

#### Goal B：完成核心价值动作

- 类型：`Triggered event`
- 值：`render_chart`

含义：

- 有多少访问用户真正完成了“出图”

#### Goal C：完成导出

- 类型：`Triggered event`
- 值：`download_png`

含义：

- 有多少访问用户完成了高意图导出动作

如果你也很在意复制行为，可以额外加一个：

- 类型：`Triggered event`
- 值：`copy_image`

在 Umami 中创建方式：

1. 进入对应 Website
2. 打开 `Goals`
3. 点击 `Add Goal`
4. 选择 `Triggered event`
5. 输入事件名
6. 保存并运行

### 10.6 创建 Funnel

Funnels 用来观察用户在哪一步流失。

建议至少建 2 条 Funnel。

#### Funnel 1：核心激活漏斗

窗口建议：`60 minutes`

步骤：

1. `Viewed page` -> `/`
2. `Triggered event` -> `upload_csv`
3. `Triggered event` -> `parse_success`
4. `Triggered event` -> `render_chart`

用途：

- 看访问用户从进入首页到最终出图的完整流失情况

#### Funnel 2：导出漏斗（下载）

窗口建议：`60 minutes`

步骤：

1. `Triggered event` -> `render_chart`
2. `Triggered event` -> `download_png`

用途：

- 看已经出图的用户里，有多少人愿意继续导出

#### Funnel 3：导出漏斗（复制，可选）

窗口建议：`60 minutes`

步骤：

1. `Triggered event` -> `render_chart`
2. `Triggered event` -> `copy_image`

用途：

- 看已经出图的用户里，有多少人偏向复制而不是下载

注意：

- Umami Funnel 的步骤是顺序型的
- 导出终点如果想同时覆盖 `download_png` 和 `copy_image`，通常需要拆成两条 Funnel 分开看

### 10.7 用过滤器看细分表现

当事件和属性都稳定后，建议在 Umami 中用过滤器看分组表现。

优先看这些维度：

- `Event = render_chart`
- `chart_type = line / bar / scatter ...`
- `language = en / zh / ja`
- `input_method = drag_drop / file_picker / paste`
- `reason = invalid_format / too_large / encoding_error`

你可以回答类似问题：

- 哪种图表类型最常被生成
- 哪种上传方式最常用
- 哪种解析错误最常见
- 哪个语言版本激活率更高

### 10.8 可选：建立 Board

如果后续你希望每次打开 Umami 就直接看到核心指标，可以再建一个 Board。

建议放这些组件：

- 网站总体访问概览
- 事件趋势图
- `render_chart` 趋势
- `download_png` 趋势
- `parse_fail` 趋势

这一步不是一期必须项，但很适合后续日常查看。

---

## 11. 上线后重点观察指标

注意：下面这些指标优先看“用户数/会话数维度”，不要只看原始事件次数，否则会被重复操作放大。

### 上传率

```text
upload_csv / Visits
```

### 解析成功率

```text
parse_success / upload_csv
```

### 出图率

```text
render_chart / upload_csv
```

### 下载转化率

```text
download_png / render_chart
```

### 复制转化率

```text
copy_image / render_chart
```

### 解析失败结构

按 `reason` 拆分观察：

- `invalid_format`
- `empty_file`
- `too_large`
- `encoding_error`
- `parse_error`

### 图表类型偏好

按 `chart_type` 拆分观察：

- 哪种图表使用频率最高
- 哪些图表类型有高出图但低导出

---

## 12. 验收清单

研发完成后，至少满足下面这些验收项。

### 代码层

- 已存在统一 `track()` 封装
- 所有埋点都通过统一封装触发
- SSR 下不会报错
- Umami 未加载时不会报错
- 埋点失败不会影响主流程
- 所有属性名已统一为 `snake_case`
- 所有错误都已映射为标准 `reason`

### Umami 后台层

- `Events` 页面能看到全部一期事件
- `Event data` 能看到全部一期属性
- 未出现敏感数据
- 至少已建立 3 个 Goals
- 至少已建立 1 条核心 Funnel

### 人工走查层

- 正常 CSV 可触发 `upload_csv`、`parse_success`、`render_chart`
- 错误 CSV 可触发 `parse_fail`
- 下载成功可触发 `download_png`
- 复制成功可触发 `copy_image`
- 示例数据可触发 `load_demo_data`

---

## 13. 推荐实施顺序

为了降低返工，建议按下面顺序推进：

1. 保留现有 Umami pageview 接入不动
2. 增加 `/lib/track.ts`
3. 接入一期 8 个事件
4. 本地和预发环境手动验证事件
5. 上线生产环境
6. 在 Umami 中验证 `Events` 和 `Event data`
7. 创建 Goals 和 Funnels
8. 连续观察 3 到 7 天，确认数据口径稳定

---

## 14. 最终交付结果

完成后，你应当能够在 Umami 中做到这些事情：

- 看到 Joplot 的核心自定义事件趋势
- 看到每个事件的属性分布
- 看到上传、解析、出图、导出这条链路的转化情况
- 看出失败主要发生在哪种解析原因
- 看出用户偏好哪些图表类型和语言版本

最终目标不是“知道来了多少人”，而是：

> 知道多少人真正完成了 Joplot 的价值动作，以及他们卡在哪一步。
