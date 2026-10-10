# joplot monorepo

一个 pnpm workspace，三个独立的 Next.js 应用。应用之间不互相 import，各自构建、部署和发布。

## 应用

| 应用 | 目录 | 用途 | 本地端口 |
| --- | --- | --- | --- |
| 老 joplot | `apps/legacy-plot` | 线上稳定版 CSV 工作台和函数画板 | 3002 |
| 新 joplot | `apps/plot` | 科学数据处理工作台；目前只做开发预览 | 3000 |
| joimage | `apps/image` | 图像处理、分析与 Stack 工作台 | 3001 |

老 joplot 从 `origin/main` 的 `d1548e8d411cb57baf93e32c554e948dde0ac4e7` 迁入，来源记录在 `apps/legacy-plot/migration-source.json`。`app/`、`src/`、`public/`、`tests/` 保留原样，包括 `/zh`、`/en`、`/ja` 和函数页的原有行为，以及浏览器存储键。

新 joplot 的根路径进入科学工作台，旧 `/science` 地址跳转到 `/`，`/super-plot` 和 `/spike/runtime` 保留为实验页。旧 CSV 工作台和函数画板的页面只在 legacy 应用发布；新应用中保留的底层工具与组件可以在后续开发时逐步整理。

`packages/ui` 和 `packages/i18n` 供新 joplot、joimage 共享。老 joplot 保留原有 UI、主题和语言实现，不依赖这两个包。应用不得直接引用其他应用的源码。

## 开发与检查

从仓库根运行：

```bash
pnpm install --frozen-lockfile
pnpm dev:legacy       # 老 joplot，3002
pnpm dev:plot         # 新 joplot，3000
pnpm dev:image        # joimage，3001
pnpm dev             # 同时启动三个应用
pnpm typecheck       # 各应用类型检查
pnpm test            # 应用隔离检查 + 各应用测试
```

生产构建可分别运行，不需要把未完成的新 joplot 一起发布：

```bash
pnpm build:legacy
pnpm build:plot
pnpm build:image
```

`pnpm build` 适用于检查整个仓库，会构建所有应用；单个应用发布应使用对应构建命令或该应用的 Vercel Project。

## 部署：三个 Vercel Project

| Project | Root Directory | 域名与发布策略 |
| --- | --- | --- |
| 老 joplot | `apps/legacy-plot` | 保留原线上域名和环境变量 |
| 新 joplot | `apps/plot` | 使用独立预览域名，开发完成前不绑定老站域名 |
| joimage | `apps/image` | 独立域名、独立发布 |

每个 Project 单独配置 Root Directory、域名和环境变量。构建命令在应用目录执行 `pnpm build`，不要使用仓库根的递归构建作为单个 Project 的构建命令。各应用内都有 `vercel.json`。

新 joplot、joimage 需要开启 **Include source files outside of the Root Directory in the Build Step**，以访问 `packages/*`。Vercel 的 **Skip unaffected projects** 可减少无关构建，但共享包、根 lockfile 和 workspace 配置变更仍可能影响多个应用。新 joplot 开发期间保持 Preview 部署；在统一生产分支上运行它时，另行关闭自动生产发布，不要绑定线上域名。

### 迁移顺序

1. 现有线上老 joplot 先继续使用 `origin/main` 的根目录部署配置，joimage 可继续从 `cloud` 独立部署。
2. 用包含此 monorepo 的分支创建三个独立 Project 的预览，确认老站首页、函数页、静态资源、数据恢复和分析统计行为一致。
3. **在旧 Vercel Project 上切换生产分支之前**，把 Root Directory 改为 `apps/legacy-plot`；保留原域名与环境变量。项目根目录设置通常对整个 Project 生效，验证迁移应使用另建的预览 Project，不要把线上 Project 暂时指到错误目录。
4. joimage 的 Root Directory 保持 `apps/image`。新 joplot 保持预览状态。
5. 验证各自部署后，再把三个应用的代码统一到主分支；每次发布只操作目标 Project。

本仓库变更不会自动修改 Vercel Project 的生产分支、Root Directory 或域名。合并到当前线上 main 前必须先按以上顺序验证并调整部署配置。

## 语言与站点地址

老 joplot 保留原版带语言前缀的路由和 SEO，canonical 仍指向 `https://joplot.com`。

新 joplot、joimage 使用 `@joplot/i18n`：语言通过 cookie 与 `Accept-Language` 分发，对外 URL 不带语言前缀。两个应用的 `vercel.json` 保留 `Vary: Accept-Language`。

- `apps/plot`：`NEXT_PUBLIC_IMAGE_APP_URL` 控制去 joimage 的入口；`NEXT_PUBLIC_SITE_URL` 可设置新应用自己的预览地址。未配置时不生成 canonical，预览阶段始终 `noindex`，robots 禁止索引，sitemap 为空。
- `apps/image`：`NEXT_PUBLIC_PLOT_APP_URL` 控制去新 joplot 的入口。新 joplot 尚未上线时留空，入口自动隐藏。joimage 的站点 metadata、robots、sitemap 地址仍由该应用自己的配置管理。
- Umami 环境变量按 Project 分别配置；老站保留原有配置，新站使用自己的 Website ID。

跨域链接携带 `?lang=` 传递语言，对方应用会写入自己的 cookie，再跳回干净 URL。环境变量应配置在各个应用的 `.env.local` 或对应 Vercel Project，仓库根的 `.env.example` 仅用于说明。
