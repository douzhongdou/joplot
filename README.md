# joplot monorepo

pnpm workspace，包含两个相互独立的 Next.js 应用和两个共享包。应用之间不互相 import，只通过 `packages/*` 共享真正通用的代码。

## 结构

```
apps/
  plot/     CSV / 科学数据绘图工作台（原 joplot 主应用）
  image/    图像工作台（ImageJ 风格编辑器 + 科学图像引擎）
packages/
  ui/       共享 shadcn/ui 原语（@joplot/ui）+ 设计令牌 theme.css
  i18n/     共享语言与本地化路由工具（@joplot/i18n）
```

- `apps/plot` 与 `apps/image` 各自拥有 `app/`、`src/`、`tests/` 和工程配置，互不引用。
- `packages/ui` 导出 `@joplot/ui/<primitive>` 与 `@joplot/ui/utils`（`cn`）、`@joplot/ui/theme.css`。
- `packages/i18n` 导出语言枚举、cookie 读写与 `resolveLanguage`、语言分发工具（`@joplot/i18n/routing`）、以及 `createI18n({ dictionaries })` 工厂；各应用自带字典与板块路径常量。

## 常用命令

在仓库根运行：

```bash
pnpm install          # 安装并链接整个 workspace
pnpm -r typecheck     # 所有应用 tsc --noEmit
pnpm -r test          # 所有应用单元测试（node --test）
pnpm dev:plot         # 启动绘图工作台
pnpm dev:image        # 启动图像工作台
```

也可以在单个应用目录内运行 `pnpm dev` / `pnpm build` / `pnpm test` / `pnpm typecheck`。

## 多语言

语言**不进入对外 URL**，但每种语言各有**一份静态生成的 HTML**——语言是 `app/[lang]` 的路由段，`generateStaticParams` 为三种语言各生成一页，HTML 因此能进 CDN（而不是每个请求都跑一次 SSR）。对外地址由各应用的 `proxy.ts`（Next 16 里 Middleware 的新名字）分发：

1. 按优先级读语言来源：`?lang=` 查询参数（跨域跳转时带过来，见「部署」）> cookie `joplot-language` > `Accept-Language`；
2. 把请求内部 rewrite 到 `/<lang>` 前缀的静态路由，浏览器地址栏不变。

于是：

- 首次访问的中文 / 日文用户直接看到对应语言，不需要手动切换一次才生效；
- 客户端切换语言仍然只写 cookie 并就地重渲染，不跳转、不刷新；下次整页加载时由 proxy 生效；
- 语言来自参数或 cookie 的响应对每个人不同，显式声明 `Cache-Control: private, no-store`；按 `Accept-Language` 分发的响应则是共享静态页（`s-maxage=31536000`），靠平台层的 `Vary: Accept-Language` 让 CDN 按语言分缓存。**App Router 页面会覆盖 Next 配置层与 `proxy.ts` 里设置的 Vary，所以这条只能在 `vercel.json` 声明**（见下）；
- 内部语言路径（`/zh-CN`、`/ja-JP/...`）会被各应用 `next.config.ts` 的 redirects 308 回对外地址，历史路径 `/zh`、`/en/function` 同理，保证每种语言只有一份可索引 URL（`sitemap` 只列静态页面，没有 hreflang）。

## 部署：两个独立域名

两个应用各部署在自己的域名上，互不反代、互不依赖：

| 应用 | 域名 | 说明 |
| --- | --- | --- |
| `apps/plot` | 例如 `joplot.com` | 绘图工作台占用域名根，`/function`、`/science`、`/super-plot` 都在它下面 |
| `apps/image` | 例如 `joimage.com` | 图像工作台就挂在域名根 |

在 Vercel 上各建一个 Project，Root Directory 分别指向 `apps/plot` 与 `apps/image`。环境变量见 `.env.example`：

- `NEXT_PUBLIC_IMAGE_APP_URL`（绘图工作台）：图像工作台的站点地址，导航里的「图像」入口用它；
- `NEXT_PUBLIC_PLOT_APP_URL`（图像工作台）：绘图工作台的站点地址，导航里的「绘图」入口用它。

两个值都是站点根、不带路径。**不配则对应入口自动隐藏**，所以本地开发可以都不配。

### 跨域的语言与老链接

- 语言 cookie 按域名隔离，跨域跳转时带不过去，因此入口链接会带上 `?lang=<当前语言>`；对方的 `proxy.ts` 读到后写进自己域名的 cookie，并 307 跳回去掉该参数的干净地址（逻辑在 `packages/i18n/src/routing.ts`）。
- 图像工作台曾经反代在本域名的 `/imagej` 下。`apps/plot/next.config.ts` 会在配了 `NEXT_PUBLIC_IMAGE_APP_URL` 时把 `/imagej*` 308 到新站点，免得外链与搜索结果断掉；图像工作台自己也把 `/imagej*` 导回根路径。
- 两个 `vercel.json` 都声明了 `Vary: Accept-Language`：HTML 随 `Accept-Language` 变化，而 App Router 页面会覆盖 Next 配置层与 `proxy.ts` 里设置的 Vary，只有平台层能盖回去，否则 CDN 会把最先缓存的那个语言发给所有人。部署后确认这条头真的生效：

  ```bash
  curl -sI -H 'Accept-Language: zh-CN' https://joplot.com/ | grep -i '^vary'
  ```

### 站点地址写在哪

两个应用的站点地址目前是各自 metadata 里的常量：绘图工作台在 `apps/plot/src/lib/siteMetadata.ts` 的 `siteUrl`；图像工作台在 `apps/image/app/[lang]/layout.tsx`、`app/robots.ts`、`app/sitemap.ts` 的 `siteUrl`（canonical、OpenGraph 与 sitemap 都用它）。换域名时改这几处。

### 本地一起开发

两个应用互不依赖，各自启动即可（默认 3000 / 3001）：

```bash
pnpm dev:plot
pnpm dev:image
```
