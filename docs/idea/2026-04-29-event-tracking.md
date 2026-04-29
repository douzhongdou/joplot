````markdown
# Joplot Analytics Upgrade PRD (Umami Privacy-Friendly Event Tracking)

## 项目目标

当前 Joplot 已接入 Umami 页面访问统计，但数据维度过浅，仅能看到：

- UV / Visits / Views
- Bounce Rate
- Visit Duration

对于工具型网站，这些指标参考价值有限。

本次目标：

> 建立隐私友好的事件埋点体系，真正理解用户如何使用产品，并为增长优化提供依据。

---

# 核心原则（必须遵守）

## 隐私优先

禁止采集任何用户敏感内容。

### 禁止上传：

- CSV 原始内容
- CSV 文件名
- 本地路径
- 邮箱
- 用户名
- 精确 IP
- 联系方式
- Cookie 追踪身份

### 允许上传：

仅匿名统计特征：

```ts
rows
columns
file_size_kb
chart_type
language
success / fail
````

---

# 技术栈假设

* Next.js（App Router / Pages Router 均可）
* React
* 已接入 Umami script

---

# 一、封装埋点工具

创建：

```text
/lib/track.ts
```

代码：

```ts
export function track(eventName: string, data?: Record<string, any>) {
  if (typeof window === 'undefined') return

  const umami = (window as any).umami

  if (!umami) return

  try {
    umami.track(eventName, data || {})
  } catch (err) {
    console.error('track failed', err)
  }
}
```

---

# 二、需要埋点的事件（第一期）

---

## 1. 上传 CSV

事件名：

```text
upload_csv
```

触发时机：

* 拖拽文件成功
* 点击上传成功
* 粘贴 CSV 成功

参数：

```ts
{
  rows: 1200,
  columns: 6,
  file_size_kb: 320
}
```

---

## 2. CSV 解析成功

事件名：

```text
parse_success
```

参数：

```ts
{
  rows: 1200,
  columns: 6
}
```

---

## 3. CSV 解析失败

事件名：

```text
parse_fail
```

参数：

```ts
{
  reason: "invalid_format"
}
```

reason 可选：

* invalid_format
* empty_file
* too_large
* encoding_error
* unknown

---

## 4. 图表渲染成功

事件名：

```text
render_chart
```

参数：

```ts
{
  type: "line",
  rows: 1200,
  columns: 6
}
```

type 可选：

* line
* bar
* scatter
* pie
* area
* histogram

---

## 5. 下载图片

事件名：

```text
download_png
```

参数：

```ts
{
  type: "line"
}
```

---

## 6. 复制图片

事件名：

```text
copy_image
```

---

## 7. 使用示例数据

事件名：

```text
load_demo_data
```

---

# 三、页面语言埋点（建议）

事件名：

```text
page_language
```

参数：

```ts
{
  lang: "en"
}
```

支持：

* en
* zh
* ja

仅首次进入页面触发一次。

---

# 四、Next.js 集成位置

---

## 上传完成后

```ts
track('upload_csv', {
  rows,
  columns,
  file_size_kb
})
```

---

## 解析成功后

```ts
track('parse_success', {
  rows,
  columns
})
```

---

## 解析失败后

```ts
track('parse_fail', {
  reason: 'invalid_format'
})
```

---

## 图表生成后

```ts
track('render_chart', {
  type: chartType,
  rows,
  columns
})
```

---

## 下载按钮点击

```ts
track('download_png', {
  type: chartType
})
```

---

## 复制图片按钮点击

```ts
track('copy_image')
```

---

# 五、建议增加页面底部隐私说明

页脚新增：

```text
Privacy
Terms
Contact
```

---

## Privacy 页面内容（极简版）

```text
We use privacy-friendly analytics to understand product usage and improve Joplot.

We do not collect personal information or uploaded CSV content.
```

---

# 六、后续分析目标（上线后观察）

## 核心漏斗

```text
Landing UV
→ upload_csv
→ parse_success
→ render_chart
→ download_png / copy_image
```

---

## 重点观察指标

### 上传率

```text
upload_csv / UV
```

### 解析成功率

```text
parse_success / upload_csv
```

### 出图率

```text
render_chart / upload_csv
```

### 导出率

```text
(download_png + copy_image) / render_chart
```

---

# 七、代码要求

* 所有埋点不得阻塞主流程
* 埋点失败不能影响用户使用
* 所有 track 放 try/catch
* SSR 环境安全判断 window

---

# 八、本次不做

暂不做：

* 用户登录
* Cookie Banner
* Session Replay
* 用户画像
* 邮箱收集
* Retargeting 广告像素

---

# 九、交付结果

完成后，Umami Dashboard 应能看到：

* upload_csv
* parse_success
* parse_fail
* render_chart
* download_png
* copy_image
* load_demo_data

并支持事件趋势分析。

---

# 十、最终目标

从“只知道多少人来了”

升级为：

> 知道多少人真正完成了价值动作（出图 / 下载 / 分享）

```
::contentReference[oaicite:0]{index=0}
```
