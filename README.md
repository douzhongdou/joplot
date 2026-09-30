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
- `packages/i18n` 导出语言枚举、路径前缀工具，以及 `createI18n({ dictionaries })` 工厂；各应用自带字典与板块路由段。

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

## 部署：同一域名、按路径拆分

生产环境是一个域名，两种路径：

| 路径 | 应用 |
| --- | --- |
| `/`、`/zh`、`/zh/science`、`/zh/function`、`/zh/super-plot` … | 绘图工作台 `apps/plot`（主应用，占域名根） |
| `/zh/imagej`、`/en/imagej`、`/ja/imagej` | 图像工作台 `apps/image` |

采用 Next.js 多 zone 的标准做法，两个应用各自独立部署：

1. 图像应用（`apps/image`）部署为独立项目，构建时设置
   `IMAGE_ASSET_PREFIX=<图像应用部署源>`（绝对 URL），让它的 `/_next/static` 资源
   直接指向自己，避免与主应用的静态资源路径冲突。
2. 主应用（`apps/plot`）设置 `IMAGE_APP_ORIGIN=<图像应用部署源>`，
   `next.config.ts` 里的 `rewrites` 会把 `/{zh|en|ja}/imagej*` 反代到图像应用。
3. 顶部导航里的「图像」入口指向 `/xx/imagej`，因此无需改成外链。

本地同时开发两个应用：

```bash
pnpm dev:plot     # http://localhost:3000
pnpm dev:image    # http://localhost:3001
# 若要验证主应用里的 /xx/imagej 跳转，另起一个带反代的 plot：
#   PowerShell: $env:IMAGE_APP_ORIGIN='http://localhost:3001'; pnpm dev:plot
```

反代的接入点集中在两处：`apps/plot/next.config.ts` 的 `rewrites`，以及
`apps/image/next.config.ts` 的 `assetPrefix`。若改为使用外部反向代理（nginx / CDN），
把这两处逻辑搬到代理层即可，应用代码不用动。

