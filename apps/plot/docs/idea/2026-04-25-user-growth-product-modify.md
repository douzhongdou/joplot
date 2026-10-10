````markdown id="joplot-pure-frontend-growth-v1"
# joplot 增长计划（Part 1 修正版）
# 纯前端产品迭代方案（不依赖后端）

> 当前约束：
- joplot 现阶段是纯前端项目
- 不引入后端数据库
- 不做账号系统
- 不做云端保存
- 优先低复杂度、高增长价值迭代

> 核心目标：
通过前端能力提升转化率、分享率、口碑传播率、SEO 收录能力，从而提高 UV。

---

# 一、增长逻辑（纯前端版本）

```text
UV = 搜索流量 + 社媒流量 + 用户分享传播 + 回访
````

产品迭代重点：

1. 首次访问立即理解价值
2. 立即体验到爽点
3. 容易分享成果
4. 页面容易被搜索引擎收录
5. 使用体验足够丝滑

---

# 二、优先级路线图

## P0（立刻做）

* 首页转化优化
* Sample CSV
* 一键复制图片
* 下载图片体验升级
* 埋点系统
* 页面速度优化

## P1（随后做）

* 更多图表类型
* SEO 落地页
* 智能图表推荐
* 模板系统（本地）

## P2（后续）

* PWA / 离线能力
* 本地历史记录
* 批量导出

---

# 三、P0：最值得马上做

---

# 1. 首页首屏重构（最高优先级）

## 当前问题

用户进入站点后，不一定立刻理解：

* 这是做什么的
* 为什么比 Excel 更方便
* 为什么值得尝试

---

## 目标

3 秒理解：

```text
上传 CSV → 自动生成漂亮图表 → 复制或下载
```

---

## 推荐 Hero

### Title

Turn CSV into beautiful charts instantly

### Subtitle

No signup. No Excel pain. Just upload and export.

### CTA

Upload CSV

### 下方直接展示：

* 图表示例图
* 支持格式
* 示例数据入口

---

# 2. Sample CSV（极重要）

## 原因

很多用户临时没有 CSV 文件。

---

## 新增入口

```text
Try Sample Data:
- Sales.csv
- Stock.csv
- Traffic.csv
- Sensor.csv
```

点击立即生成图。

---

## 价值

极大提升：

* 停留时间
* 试用率
* 首次爽感

---

# 3. 一键复制图片（重点）

> 这是纯前端神器级功能。

---

## 功能定义

图表生成后提供按钮：

```text
Copy Image
```

点击后：

* 复制 PNG 到剪贴板
* 可直接粘贴到：

  * 微信
  * Slack
  * 飞书
  * PPT
  * Docs
  * Figma

---

## 技术方案

浏览器 Clipboard API：

```ts
navigator.clipboard.write([
  new ClipboardItem({
    'image/png': blob
  })
])
```

---

## 用户价值

比下载再上传快 10 倍。

---

# 4. 下载图片体验升级

## 当前很多工具的问题：

下载文件名乱、分辨率低、操作麻烦。

---

## 建议升级

## 导出格式：

* PNG
* SVG（高优先级）
* JPG（可选）

---

## 文件名优化：

```text
joplot-line-chart-2026-04-25.png
```

---

## 分辨率选项：

* Standard
* HD
* 4K

---

## 透明背景选项：

适合 PPT。

---

# 5. 导出后引导传播

导出成功 toast：

```text
Chart copied successfully.
Tell your friends about joplot :)
```

或：

```text
Made with joplot.com
```

---

# 6. 埋点系统（必须做）

使用 Umami Event。

---

## 最低事件集

```text
visit_home
use_sample_csv
upload_csv
generate_chart
copy_image
download_png
download_svg
change_chart_type
parse_failed
```

---

## 重点观察

```text
访问人数
上传率
出图率
复制率
下载率
错误率
```

---

# 四、P1：自然增长增强

---

# 7. 更多图表类型

优先：

* Line
* Bar
* Scatter
* Pie
* Histogram
* Area
* Heatmap（后期）

---

# 8. 智能推荐图表

上传 CSV 后自动识别：

* 时间 + 数值 → Line
* 分类 + 数值 → Bar
* 两列数值 → Scatter

---

## 用户体验

减少选择成本。

---

# 9. SEO Landing Pages（非常重要）

生成页面：

```text
/csv-line-chart
/csv-scatter-plot
/csv-bar-chart
/csv-histogram
/csv-chart-maker
/plot-csv-online
```

---

## 每页内容：

* H1
* 示例图
* FAQ
* CTA

---

# 10. 模板系统（纯前端）

点击模板直接加载本地 JSON 数据：

```text
Sales Dashboard
Crypto Prices
Survey Results
Website Traffic
```

---

# 五、P2：纯前端高级体验

---

# 11. Local History（浏览器本地）

使用 localStorage 保存：

* 最近图表配置
* 最近导出记录

---

## 注意

不上传服务器。

---

# 12. PWA

支持：

* 手机桌面安装
* 离线打开

---

# 六、UI 细节优化

---

# 13. 空状态设计

未上传时不要空白：

展示：

* Demo 图
* 拖拽区域
* Sample CSV

---

# 14. 拖拽体验

拖文件进入时高亮。

---

# 15. Loading 动效

CSV 大文件解析时给反馈：

```text
Parsing data...
Generating chart...
```

---

# 七、Codex 开发优先级（建议）

## Sprint 1

* Copy Image
* Download HD PNG
* Sample CSV
* Hero 重构
* Umami 埋点

## Sprint 2

* SVG 导出
* 智能图表推荐
* 更多图表类型

## Sprint 3

* SEO 页面系统
* Local History
* PWA

---

# 八、阶段目标

## 当前阶段目标

访问用户里：

```text
上传率 > 30%
出图率 > 70%
复制/下载率 > 25%
```

---

# 九、最关键判断

纯前端不是劣势。

反而意味着：

* 快
* 免费
* 无注册 friction
* 隐私友好
* 全球可用

这是增长优势。

---

# 十、产品认知目标

让用户形成心智：

```text
CSV 要变图？
直接用 joplot。
```

---

```
```
