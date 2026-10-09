# 评估：把 jo image 并入 jo plot，回到单应用

> 结论先说：**技术上没有硬障碍，建议合并**，而且建议分两步——第一步纯搬运（对外行为完全不变），第二步才是门户页与路径改名。理由、冲突清单、风险、验证方式都在下面。

## 1. 这件事的由来

拆分不是历史包袱，是某一次重构主动做的：

```
55d93654  refactor: split into pnpm monorepo (apps/plot, apps/image, packages/ui, packages/i18n)
```

`origin/main` 上**没有 jo image 的代码**——main 是更早的纯 CSV 绘图单应用。也就是说 image 是那个分支上新增的第二个应用，拆分与新增同时发生。

## 2. 现状盘点

| | apps/plot | apps/image |
| --- | --- | --- |
| `src` | 115 文件 / 18,946 行 | 85 文件 / 23,037 行 |
| `app`（路由） | 8 文件 / 187 行 | 4 文件 / 78 行 |
| `tests` | 41 文件 / 3,541 行 | 39 文件 / 5,026 行 |
| `src` 顶层 | components, hooks, i18n, lib, science, spike, superplot | components, i18n, imagej, lib, types |
| 独有依赖 | plotly.js, @duckdb/duckdb-wasm, apache-arrow, papaparse, xlsx, @tanstack/react-table, @tanstack/react-virtual | itk-wasm, @itk-wasm/image-io, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/modifiers, @dnd-kit/utilities |
| 共有依赖 | next ^16.3.1, react ^19.2.5, lucide-react ^1.8.0, @joplot/ui, @joplot/i18n, tw-animate-css | 同左（版本完全一致） |

两个应用的依赖**没有交集冲突**，共用依赖的版本也完全一致——合并 `package.json` 只是做并集。

`postcss.config.mjs` 与 `tsconfig.json` 两个应用**逐字节相同**，合并时不用动。只有 `next.config.ts` 不同（plot 有 rewrites/redirects；image 有 assetPrefix + itk-wasm 的 turbopack alias）。

## 3. 为什么不担心"合并后包变大"

三个重量级依赖**都是按需加载**，不是首屏负担：

| 依赖 | 加载方式 |
| --- | --- |
| itk-wasm | `await import('itk-wasm')`（[itk.ts:72](../apps/image/src/imagej/engine/compute/itk.ts#L72)、195 行处） |
| @duckdb/duckdb-wasm | `await import('@duckdb/duckdb-wasm')`（[duckdbProbe.ts:31](../apps/plot/src/spike/probes/duckdbProbe.ts#L31)） |
| plotly.js | 源码里只有 `import type`（类型引用），运行时另行加载 |

也就是说，打开 CSV 工作台不会加载图像引擎，反之亦然——**页面级代码分割天然隔离**。唯一变大的是一次构建的总产物，不是单个页面的首屏。

## 4. 冲突清单（合并时必须处理的 8 处）

| # | 冲突 | 现状 | 处理方式 | 风险 |
| --- | --- | --- | --- | --- |
| 1 | `components/AppNavbar.tsx` | 两份不同实现（plot 261 行带板块导航；image 139 行） | **保留两份**，image 版移入 `src/imagej/components/` | 低 |
| 2 | `components/ErrorBoundary.tsx` | 同路径两份 | 比对后去重（若不同则同 #1 各留一份） | 低 |
| 3 | `i18n/config.ts`、`i18n/index.tsx` | 两份 `createI18n` | **必须合并成一套**：Next 的根 layout 只能有一个 `I18nProvider` | 中 |
| 4 | `i18n/dictionaries/*.ts` | plot 285 行/语言；image 仅 12 行/语言 | image 的条目并入 plot 字典（新增命名空间） | 低（体量小） |
| 5 | `lib/routeLanguage.ts` | 两份几乎相同 | 去重成一份（放 `src/lib/`） | 低 |
| 6 | `public/navbar-icon.webp` | **同名但内容不同**（MD5 不同：jo plot 版 vs jo image 版） | **必须重命名**（如 `navbar-icon-plot.webp` / `navbar-icon-image.webp`）并改引用 | 中（漏改会串图） |
| 7 | `app/favicon.ico` vs `public/favicon.ico` | image 在 `app/` 下有 favicon.ico、icon.png、apple-icon.png；plot 的图标在 `public/` | 决定保留哪个 favicon；`app/` 下的文件路由优先级高于 `public/`，不处理会悄悄换掉 plot 的站点图标 | 中 |
| 8 | 双份 Tailwind 入口 | plot 的 `app/globals.css` 只有一行 `@import "../src/index.css"`；image 的 globals.css 自带完整 `@import "tailwindcss"` + `@source` + **`@custom-variant dark`** + 深色主题样式 | 把 image 的 `@custom-variant dark` 与深色样式并入 `apps/plot/src/index.css`（`@custom-variant` 是全局编译指令，**必须**在同一个 Tailwind 入口里，不能各留一份） | **高**（最容易出样式回归） |

其余：`tests/` 下两个应用**没有同名文件**（已核对），但 import 路径要跟着目录调整；`app/` 路由本身很薄（4 个文件）。

## 5. 目标结构

```
apps/plot/
  app/[lang]/
    layout.tsx               根 layout（唯一 I18nProvider，样式入口）
    page.tsx                 ← 门户：两个入口卡片（第二步）
    plot/page.tsx            ← CSV 绘图工作台（第二步从 / 挪来）
    function/page.tsx
    science/page.tsx
    super-plot/page.tsx
    image/page.tsx           ← jo image 图像工作台（第一步先保持 /imagej）
    image/classic/page.tsx   ← 旧版 ImageJ
  src/
    ...（现有 plot 代码不动）
    imagej/                  ← 从 apps/image/src/imagej 整体搬入
  proxy.ts                   仅此一份（不再需要排除 imagej 反代）
  vercel.json                仅此一份
packages/ui, packages/i18n   保留（成本低，是未来的扩展点）
```

**删除清单**：`apps/image` 整个目录；plot 的 `rewrites()`/`IMAGE_APP_ORIGIN`；image 的 `assetPrefix`/`IMAGE_ASSET_PREFIX`；`apps/image/vercel.json`；`.env.example` 里两个同域部署变量；README 的 multi-zone 章节。

## 6. 分步计划

### 第一步：合并（对外行为不变，URL 仍为 `/imagej`）

1. 搬运：`apps/image/app/[lang]/imagej*` → `apps/plot/app/[lang]/imagej*`；`apps/image/src/imagej` → `apps/plot/src/imagej`
2. 处理上表 8 处冲突（重点是 #3 字典/Provider 与 #8 样式入口）
3. 合并 `package.json` 依赖（并集，版本无冲突）、`next.config.ts`（搬 `turbopack.resolveAlias`，删 `assetPrefix` 与 `rewrites`）
4. 合并测试目录（无同名冲突，只需改 import 路径）
5. 删除 `apps/image` 与相关配置，更新 `.env.example`、README
6. 验证：`typecheck` + 全量测试 + `next build`（路由表全部 `● SSG`）+ 生产模式实测（语言分发、`/imagej`、资源、`/imagej/classic`）

### 第二步：门户页与路径（产品决策，会动 URL 与 canonical）

1. 新增 `[lang]/page.tsx` 门户（数据驱动卡片列表：jo plot → `/plot`，jo image → `/image`）
2. CSV 工作台从 `/` 挪到 `/plot`（`/` 本身不消失，只是换了内容，因此**不产生断链**）
3. `/imagej` → `/image` 改名；`IMAGEJ_PATH` 常量、导航、测试、canonical 同步
4. 更新 `sitemap.ts`、`siteMetadata.ts` 的 canonical、`robots.ts`
5. 决定 `HomeHero`（工作台空态上传引导）在新门户下的位置——建议留在 `/plot` 内不动
6. 验证：语言分发 + 各路径 200 + canonical 正确 + sitemap 内容

## 7. 风险与验证方式

| 风险 | 影响 | 验证方式 |
| --- | --- | --- |
| 样式回归（#8） | jo image 的深色主题、`dark:` 变体或 Tailwind 扫描失效 | 生产模式打开 `/imagej` 与 `/plot`，肉眼比对深浅主题与布局；检查构建产物 CSS 是否含两套样式 |
| itk-wasm alias 影响 plot 构建 | plot 页面构建失败或解析异常 | 合并后立刻 `next build`，再看 CSV 工作台能否正常绘图 |
| 字典/Provider 合并（#3） | 语言切换失效或文案缺失 | 三种语言各访问一次两个工具，切换语言后文案与 `<html lang>` 正确 |
| 图标串图（#6、#7） | 顶栏或 favicon 张冠李戴 | 断言两张 navbar 图的引用路径不同；`curl -I /favicon.ico` 与浏览器实际显示 |
| 路由冲突 | `/image` 与既有路径撞车 | 构建后核对路由表；`dynamicParams = false` 已能挡住未列出的语言段 |
| SEO 回归（第二步） | 旧 canonical/sitemap 指向不存在的路径 | 部署后核对 `/sitemap.xml` 与页面 canonical；老链接 308 |

## 8. 工作量估计

- **第一步（合并）**：主要工作。搬运 + 8 处冲突 + 构建/测试/端到端验证。量级与我刚做完的语言重构相当或略小。
- **第二步（门户 + 路径）**：路由与元数据调整为主，比第一步小。

对比参考：刚完成的「语言静态化 + proxy 分发」重构，涉及两个应用的路由迁移、新增 proxy 与共享包、测试与端到端验证，已全部跑通。

## 9. 不合并的代价

保留 multi-zone 也不是不能活——已经验证可用。但持续成本是：

- `IMAGE_ASSET_PREFIX` / `IMAGE_APP_ORIGIN` 两个易错配置（配错的表现是"样式加载不出来"或"404"，且只在部署环境暴露）
- 每个页面 `function → function` 两跳
- 两个 Vercel 项目、两套环境变量、两份 `vercel.json`、两个部署要同步
- Vercel Deployment Protection 打到 preview 域名时反代会拿到 401 登录页
- 两份重复骨架（AppNavbar / i18n / ErrorBoundary / 配置）长期各自演化

## 10. 待确认的决策

1. 是否执行第一步（纯合并）？这一步不改任何对外行为，可随时回退。
2. `favicon.ico` 最终用谁的（plot 现有图标，还是 image 的）？
3. 门户页归属：`apps/plot` 的根路由（改动小）还是新建 `apps/home`（职责干净但多一个部署）？
4. `packages/ui`、`packages/i18n` 是否保留？（建议保留）
