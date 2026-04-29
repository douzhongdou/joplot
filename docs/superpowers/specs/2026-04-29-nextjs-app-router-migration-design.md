# joplot 全量迁移到 Next.js App Router 设计

## 背景

当前项目使用 `Vite + React + TypeScript` 构建，本质上仍然是一个前端单页应用。近期为了补 SEO，项目额外引入了多语言静态 HTML、SEO shell、重定向与 sitemap 维护逻辑，但线上已经暴露出以下问题：

- 根路径与语言页的索引策略、静态 HTML 与运行时代码容易不同步。
- 首屏 SEO 壳与 React 接管存在时序问题，部署后容易出现短暂闪屏。
- 多语言路由、页面元信息、站点地图、robots、canonical、hreflang 依赖手工拼装，维护成本高且容易出错。
- Vercel 线上产物与本地源码不一致时，很难快速确认“是框架问题、部署问题还是缓存问题”。

用户已经明确：

- 接受全量统一到 Next.js。
- 不接受用户可见 UI、文案、信息架构、交互行为的明显变动。
- URL 必须保持兼容：`/`、`/en`、`/zh`、`/ja` 等公开入口不能改。
- 根路径 `/` 继续按浏览器语言自动重定向到对应语言页。
- 多语言方案要使用 Next.js 正规的 `app/[lang]` 路由模式，而不是继续手搓 HTML 壳。

## 目标

把现有站点和工具工作台统一迁移到 `Next.js App Router`，在不改变用户可见行为和 URL 的前提下，获得稳定的多语言路由、页面级 SEO、规范的 sitemap / robots 产物、可控的 Vercel 部署行为，以及更容易维护的代码结构。

## 非目标

- 不重新设计首页视觉、导航布局或页面信息层级。
- 不借迁移新增用户可见功能。
- 不引入后端、数据库或账号系统。
- 不改变当前“本地优先、浏览器内解析 CSV / Excel、浏览器内持久化”的产品模型。

## 约束

- 保持现有公开 URL 不变。
- 保持当前文案、多语言内容与组件层级尽量不变。
- 保持现有本地持久化键值兼容，避免用户升级后丢失工作台状态。
- 继续使用 `pnpm`。
- 迁移后仍需能在 Vercel 上稳定部署。

## 推荐方案

采用“框架全量迁移、业务逻辑平移复用”的方案：

- 使用 `Next.js App Router` 重建应用入口、路由、页面元信息和部署产物。
- 复用当前 `src/components/*`、`src/lib/*`、`src/i18n/*` 的大部分实现。
- 将交互重的工作台页面保留为客户端组件，在需要浏览器 API 的边界显式标记 `'use client'`。
- 将根路径重定向、多语言元信息、robots、sitemap、alternate 链接交给 Next.js 官方能力与约定文件实现。
- 删除当前 Vite 专用入口、手工 SEO shell 注入与多份语言静态 HTML。

这是当前规模下性价比最高的方案：既能一次性解决 SEO 和架构问题，又不会把图表逻辑、CSV 解析逻辑整套重写。

## 备选方案

### 方案 A：继续保留 Vite，补齐预渲染与 SEO 工程

优点：

- 改动最小。
- 可以保留现有全部构建链。

缺点：

- 仍然需要维护额外的静态 HTML、SEO shell、同步脚本、重定向配置。
- 线上“源码、静态产物、缓存、部署”四者不一致的问题不会根治。
- 后续继续扩展 SEO 时仍然脆弱。

结论：不推荐。

### 方案 B：Next.js 仅承接营销页，工作台保留 Vite

优点：

- 风险较低。
- 可以先解决 SEO 问题。

缺点：

- 长期维护两套应用入口和两套构建部署链。
- 路由、资源、状态恢复和语言切换会更绕。
- 不符合“全部统一到 Next.js”的明确目标。

结论：不采用。

## 迁移后的目标结构

建议目录结构如下：

```text
app/
  [lang]/
    layout.tsx
    page.tsx
  layout.tsx
  page.tsx
  robots.ts
  sitemap.ts
components/
  app/              工作台客户端壳层与页面级客户端组件
  ui/               复用的通用 UI 组件
lib/
  i18n/             语言配置、字典、路径映射、服务端/客户端辅助函数
  workbench/        图表、数据、上传、持久化、筛选等核心逻辑
public/             图标、样例文件、站点静态资源
tests/              Node 测试，覆盖纯逻辑与 SEO 产物函数
middleware.ts       根路径语言重定向
next.config.ts
```

现有 `src/` 中的代码会按职责迁移，而不是原地保留：

- `src/components/*` 迁移到 `components/`
- `src/lib/*` 迁移到 `lib/workbench/` 或 `lib/seo/`
- `src/i18n/*` 迁移到 `lib/i18n/`
- `src/App.tsx` 拆成 Next.js 页面壳和客户端工作台入口
- `src/main.tsx` 删除

## 路由与多语言设计

### 根路径

- `GET /` 不再由浏览器端脚本跳转。
- 改为由 `middleware.ts` 在服务端/边缘按 `Accept-Language` 重定向到 `/zh`、`/ja` 或 `/en`。
- 默认回退到 `/en`。

### 语言路由

- 公开页面入口保持：
  - `/en`
  - `/zh`
  - `/ja`
- Next.js 内部使用 `app/[lang]/page.tsx`，其中 `lang` 允许值为 `en`、`zh`、`ja`。
- 现有字典内部仍可映射为：
  - `en`
  - `zh-CN`
  - `ja-JP`

这样既满足公开 URL 简洁，也保留现有字典和语言格式。

### 语言切换

- 当前导航中的语言切换继续存在，用户交互不变。
- 切换时仍跳转到对应语言路径。
- 语言偏好继续写入 `localStorage`，但服务端路由不依赖它；服务端仅以 URL 和请求头为准。

## 渲染策略

### 语言页

- `/en`、`/zh`、`/ja` 由 Next.js 直接输出完整 HTML。
- 这些页面在服务端即可产出可索引的标题、描述、canonical、hreflang、OG/Twitter 元信息。
- 不再依赖手写 SEO shell 先显示、React 再删除的机制。

### 工作台

- 工作台继续使用客户端组件，因为其依赖：
  - `window`
  - `localStorage`
  - 文件上传
  - 拖拽事件
  - Plotly
  - 剪贴板 API
- 仅将不能在服务端运行的部分放在客户端边界内，不把整个站点退化回 SPA。

## SEO 设计

迁移后由 Next.js 统一管理：

- `generateMetadata` 或静态 `metadata`
- `app/robots.ts`
- `app/sitemap.ts`
- 页面级 `alternates.languages`
- 语言页 `openGraph` / `twitter`

明确要求：

- 根路径不再输出 `noindex`。
- `robots` 允许抓取公开页面。
- `sitemap` 包含 `/`、`/en`、`/zh`、`/ja`。
- `hreflang` 使用：
  - `en`
  - `zh-CN`
  - `ja`
  - `x-default`

## 状态与持久化兼容

当前工作台依赖以下浏览器存储：

- `plotnow-language`
- `csv-workbench-datasets`
- `csv-workbench-dashboard`

迁移后应保持这些 key 不变，避免用户升级后丢失语言偏好、数据集和图卡布局。

## 测试策略

迁移后至少覆盖以下验证：

1. 纯逻辑测试继续可运行：
   - i18n
   - 数据集构建
   - 上传与样例
   - 图卡与筛选
2. 新增路由与 SEO 测试：
   - 根路径语言映射函数
   - metadata 生成
   - sitemap 产出
   - robots 产出
3. 构建验证：
   - `pnpm build`
4. 如条件允许，补充一条对 `/en` 页 HTML 的集成检查，确认标题、canonical、alternate 存在。

## 风险

### 1. Plotly 与 App Router 的客户端边界

如果图表相关组件在服务端被误导入，可能触发 `window is not defined` 一类错误。

应对：

- 明确用客户端壳包裹工作台。
- 必要时对图表组件做动态导入并禁用 SSR。

### 2. Tailwind / 全局样式迁移

当前样式基于现有构建链，迁移时容易出现全局样式缺失或顺序变化。

应对：

- 先迁移现有 `index.css` 为 Next.js 全局样式。
- 迁移后优先做像素级肉眼核对，而不是顺手改样式。

### 3. 线上缓存与旧产物残留

Vercel 可能短时间继续缓存旧 HTML 或旧 sitemap。

应对：

- 部署后核对线上响应头和页面源码。
- 必要时触发重新部署与缓存刷新。

## 分阶段实施

### 阶段 1：框架骨架

- 引入 Next.js 依赖与配置。
- 建立 `app/`、`middleware.ts`、基础布局与全局样式。
- 迁移 i18n 配置到 URL 驱动模式。

### 阶段 2：页面与工作台迁移

- 把现有首页/工作台页面接到 `app/[lang]/page.tsx`。
- 把客户端工作台逻辑接入新的客户端入口。

### 阶段 3：SEO 与部署

- 迁移 metadata、robots、sitemap。
- 删除 Vite 静态 HTML、多语言目录、SEO shell 同步脚本与旧部署配置。

### 阶段 4：验证与清理

- 跑测试与构建。
- 清理死代码、死配置与旧产物目录依赖。

## 验收标准

- 运行 `pnpm dev` 后可通过 Next.js 正常访问 `/en`、`/zh`、`/ja`。
- `/` 会按请求语言自动跳转，默认回退 `/en`。
- 现有首页与工作台的用户可见 UI、文案、交互基本保持一致。
- 本地数据集、图卡、筛选状态仍能从浏览器存储恢复。
- 页面不再依赖 SEO shell 机制。
- `robots`、`sitemap`、`canonical`、`hreflang` 由 Next.js 正常输出。
- `pnpm build` 通过。
