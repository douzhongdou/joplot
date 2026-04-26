# 2026-04-26 — joplot SEO 优化设计

## 背景

joplot 是一个本地优先的 React SPA(Vite 多入口构建,产出 `/`、`/en`、`/zh`、`/ja` 四个入口)。当前 SEO 基础设施(三语 hreflang、sitemap、JSON-LD、analytics)已搭好,但仍存在多处技术性缺陷影响:

1. 搜索引擎对默认入口(`/`)的权重路由
2. 社交分享卡片(OG)的图片显示
3. PWA / 移动端"添加到主屏"
4. 多语言信号一致性

## 约束

**用户硬约束(必须遵守)**:
- 不改变现有任何**可见内容、文案、功能**
- 现有 `<title>` 与 `<meta description>` 一字不动
- 不引入 SSG/SSR 改造
- 不创建新的设计资源(OG 分享图、新图标等),只复用 `public/` 已有资源

**部署假设**:Vercel 或 Netlify。允许新增 `vercel.json` / `netlify.toml` / `_redirects` 配置文件。

**站点域名**:`https://joplot.com`(取自现有 canonical 和 sitemap)。

## 目标

把 SEO 基础设施一次性补齐到行业标准,**不触碰任何用户可见的内容**。

## 范围(In Scope)

### 1. 根 `/` 入口的 SEO 一致性
当前 [`index.html`](../../../index.html) 是 JS 软跳转页,缺少 canonical / hreflang / JSON-LD / analytics,与三语页严重不对称。

**改动**:
- 补 canonical 指向自身(`https://joplot.com/`)
- 补 hreflang 全集(`en`、`zh-CN`、`ja`、`x-default`)
- 补 OG / Twitter 标签(复用现有英文 meta 文案,不新写)
- 补 JSON-LD `WebApplication`(英文版本,复用 en 页内容)
- 补 analytics 脚本

### 2. 服务端 301 替换 JS 软跳
当前 [`index.html:35-52`](../../../index.html#L35) 用 `window.location.replace` 跳转。

**改动**:输出 `vercel.json` 与 `netlify.toml` + `_redirects`,在 CDN 边缘做基于 `Accept-Language` 的 302 重定向(语言协商应该用 302,不是 301,因为不同用户应去不同语言页)。
- 保留 HTML 内的 JS 跳转作为 `noscript` 兜底(实际上 noscript 触发不到 JS,但保留作为非平台部署时的 fallback)

### 3. OG 协议字段补齐
所有页面统一补:
- `og:url`(每页指向自己的绝对 URL)
- `og:image` 改成绝对 URL `https://joplot.com/icon.webp`
- `og:image:width="500"`、`og:image:height="500"`、`og:image:type="image/webp"`、`og:image:alt`(复用 `<meta name="description">`)
- `twitter:card` 从 `summary` 改成 `summary_large_image`
- `twitter:image` 同步绝对 URL

> **注**:`twitter:card` 是声明字段,不是文案。改它只影响渲染框尺寸,不动一个字。

### 4. PWA Manifest
新增 `public/manifest.webmanifest`,引用现有图标:
- `icon-32.png`、`icon-192.png`、`icon.webp`(500×500,声明为 `any maskable`)
- `name="joplot"`、`short_name="joplot"`(均已是现有 application-name)
- `display="standalone"`、`theme_color="#155eef"`(已有 meta theme-color)
- `start_url` 与 `scope` 按语言分别指向 `/en`、`/zh`、`/ja`

> 由于 manifest 是站点级单例,折衷方案:把 manifest 默认指向 `/`,让根的 301 把用户带到对应语言版。

四个 HTML 都补 `<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">`。

### 5. Sitemap 升级
[`public/sitemap.xml`](../../../public/sitemap.xml):
- 加根 URL `https://joplot.com/`(`hreflang="x-default"`)
- 每个 URL 补 `<lastmod>2026-04-26</lastmod>`
- 保持 `<changefreq>weekly</changefreq>` 与 `<priority>1.0</priority>` 不变

### 6. robots.txt 增强
[`public/robots.txt`](../../../public/robots.txt):
- 保留现有规则
- 加 `Host: joplot.com` 声明首选域(Yandex 等会用)
- 显式声明常用爬虫不被限速

### 7. hreflang / locale 一致性
当前不一致:
- `<html lang="zh-CN">` 但 `hreflang="zh"`
- `og:locale="zh_CN"`

**改动**:把所有 `hreflang="zh"` 统一为 `hreflang="zh-CN"`,与 html lang 对齐。`en`、`ja` 已一致,不动。

### 8. robots meta 增强
所有三语页 robots 内容:
- 当前:`index, follow, max-image-preview:large`
- 改为:`index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1`(允许 Google 完整展示)

## 范围外(Out of Scope)

- ❌ 不写任何静态正文(H1、段落、FAQ)— 用户硬约束
- ❌ 不动 `<title>` / `<meta description>` 的措辞
- ❌ 不生成新的 OG 图片、不做新设计
- ❌ 不引入 SSG / 预渲染框架
- ❌ 不动 React 组件树或 i18n 字典
- ❌ 不动 `vite.config.ts` 的入口配置
- ❌ 不加 BreadcrumbList / FAQPage 等富 schema(对 SPA 收益低)

## 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `index.html` | 修改 | 补 canonical / hreflang / JSON-LD / OG / Twitter / analytics / manifest link |
| `en/index.html` | 修改 | 补 og:url / og:image:* / twitter:card / manifest / robots max-snippet / hreflang zh-CN |
| `zh/index.html` | 修改 | 同上,且 hreflang 自身改 zh-CN |
| `ja/index.html` | 修改 | 同上(无 hreflang 自身变更) |
| `public/robots.txt` | 修改 | 加 `Host:` |
| `public/sitemap.xml` | 修改 | 加根 URL + lastmod |
| `public/manifest.webmanifest` | 新建 | PWA manifest |
| `vercel.json` | 新建 | Vercel 部署平台的 redirect 与 header 配置 |
| `netlify.toml` | 新建 | Netlify 部署平台的 redirect 配置 |
| `public/_redirects` | 新建 | Netlify `_redirects` 文件(冗余备份) |

## 风险与回滚

| 风险 | 概率 | 缓解 |
|---|---|---|
| Vercel/Netlify 平台未启用 → redirect 不生效 | 中 | HTML 内 JS 跳转保留作为 fallback |
| manifest crossorigin 配置错误 → PWA 安装失败 | 低 | 部署后用 Chrome DevTools Application 面板验证 |
| 修改 hreflang 后 Google 重新索引前出现短期波动 | 低 | 这是预期的搜索引擎再爬过程,不可避免 |
| 修改 og:image 绝对 URL 后 Facebook/X 缓存旧值 | 低 | 用 `https://developers.facebook.com/tools/debug/` 强制刷新 |

**回滚**:全部为新增或字段修改,可通过 `git revert` 单提交回滚。

## 验收标准

部署后:
1. **Google Rich Results Test** ([search.google.com/test/rich-results](https://search.google.com/test/rich-results)) — 三语页 + 根页都能识别 WebApplication
2. **Facebook OG Debugger** — 三语页 + 根页都拿到正确的 og:image 与 og:title
3. **Twitter Card Validator** — 显示 large image
4. **Lighthouse SEO 分数** — 95+ (基线已 90+,补完后到 95+)
5. **`curl -I https://joplot.com/` with `Accept-Language: zh`** — 返回 302/301 到 `/zh`
6. **PWA Manifest** — Chrome DevTools Application → Manifest 无错误,显示 install 按钮
7. **`https://joplot.com/sitemap.xml` 与 `/robots.txt`** — 200 OK,内容正确

## 后续(本次不做)

- 真正解决 SPA 内容空洞问题需要 SSG 改造(Astro / vite-plugin-ssr / react-router data routers SSG 模式)。这需要用户授权"可以加静态正文"。本次不动。
- OG 分享图设计(1200×630)。需要用户提供素材或授权生成。本次不做。
- 多区域 hreflang(`en-US` / `en-GB` / `ja-JP` 等)。仅当有真实区域差异化内容时才有意义。本次不做。
