# joplot monorepo

pnpm workspace，包含两个相互独立的 Next.js 应用和两个共享包。应用之间不互相 import，只通过 `packages/*` 共享真正通用的代码。

## 结构

```
apps/
  plot/     CSV / 科学数据绘图工作台（原 joplot 主应用）
  image/    ImageJ 风格的 8 位灰度图像工作台
packages/
  ui/       共享 shadcn/ui 原语（@joplot/ui）+ 设计令牌 theme.css
  i18n/     共享语言与本地化路由工具（@joplot/i18n）
```

- `apps/plot` 与 `apps/image` 各自拥有 `app/`、`src/`、`tests/` 和工程配置，互不引用。
- `packages/ui` 导出 `@joplot/ui/<primitive>` 与 `@joplot/ui/utils`（`cn`）、`@joplot/ui/theme.css`。
- `packages/i18n` 导出语言枚举、cookie 读写与 `resolveLanguage`、以及 `createI18n({ dictionaries })` 工厂；各应用自带字典与板块路径常量。

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

1. 读 cookie `joplot-language`（用户显式选择过语言）或 `Accept-Language`（浏览器偏好），**cookie 优先**；
2. 把请求内部 rewrite 到 `/<lang>` 前缀的静态路由，浏览器地址栏不变。

于是：

- 首次访问的中文 / 日文用户直接看到对应语言，不需要手动切换一次才生效；
- 客户端切换语言仍然只写 cookie 并就地重渲染，不跳转、不刷新；下次整页加载时由 proxy 生效；
- 语言来自 cookie 的响应对每个人不同，显式声明 `Cache-Control: private, no-store`；按 `Accept-Language` 分发的响应则是共享静态页（`s-maxage=31536000`），靠平台层的 `Vary: Accept-Language` 让 CDN 按语言分缓存。**App Router 页面会覆盖 Next 配置层与 `proxy.ts` 里设置的 Vary，所以这条只能在 `vercel.json` 声明**（见下）；
- 内部语言路径（`/zh-CN`、`/ja-JP/...`）会被各应用 `next.config.ts` 的 redirects 308 回对外地址，历史路径 `/zh`、`/en/function` 同理，保证每种语言只有一份可索引 URL（`sitemap` 只列静态页面，没有 hreflang）。

## 部署：同一域名、按路径拆分

生产环境是一个域名：

| 路径 | 应用 |
| --- | --- |
| `/`、`/science`、`/function`、`/super-plot` … | 绘图工作台 `apps/plot`（主应用，占域名根） |
| `/imagej` | 图像工作台 `apps/image` |

采用 Next.js 多 zone 的标准做法，两个应用各自独立部署：

1. 图像应用（`apps/image`）构建时设置 `IMAGE_ASSET_PREFIX=/imagej-assets`，让它的
   `/_next/static` 等资源带上同源路径前缀。**用路径前缀而不是绝对 URL**，否则浏览器跨源
   加载静态资源会被 CORS 拦下。
2. 主应用（`apps/plot`）设置 `IMAGE_APP_ORIGIN=<图像应用部署源>`，`next.config.ts` 的
   `rewrites` 会把 `/imagej*` 和 `/imagej-assets/*` 一起反代到图像应用。
3. 顶部导航里的「图像」入口指向 `/imagej`，因此无需改成外链。
4. 两个应用在 Vercel 上各建一个 Project，Root Directory 分别是 `apps/plot` 与 `apps/image`；
   环境变量见 `.env.example`（绘图工作台还要 `IMAGE_APP_ORIGIN`）。两个 `vercel.json` 里都
   声明了 `Vary: Accept-Language`：HTML 随 `Accept-Language` 变化，而 App Router 页面会覆盖
   Next 配置层与 `proxy.ts` 里设置的 Vary，只有平台层能盖回去，否则 CDN 会把最先缓存的那个
   语言发给所有人。部署后用下面的命令确认这条头真的生效了：

   ```bash
   curl -sI -H 'Accept-Language: zh-CN' https://joplot.com/ | grep -i '^vary'
   ```

本地同时开发两个应用（反代时也要带上资源前缀，否则 `/imagej` 页面加载不出样式脚本）：

```bash
# 终端 1
IMAGE_ASSET_PREFIX=/imagej-assets pnpm dev:image     # http://localhost:3001
# 终端 2
IMAGE_APP_ORIGIN=http://localhost:3001 pnpm dev:plot # http://localhost:3000
# Windows PowerShell 分别用 $env:IMAGE_ASSET_PREFIX / $env:IMAGE_APP_ORIGIN
```

反代的接入点集中在两处：`apps/plot/next.config.ts` 的 `rewrites` 与 `IMAGE_ASSET_PATH` 常量，
以及 `apps/image/next.config.ts` 的 `assetPrefix`。若改为使用外部反向代理（nginx / CDN），
把这两处逻辑搬到代理层即可，应用代码不用动。

