# Next.js App Router 全量迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前 `Vite + React` 版本的 joplot 全量统一到 `Next.js App Router`，同时保持现有公开 URL、用户可见 UI 和核心交互行为不变。

**Architecture:** 采用 Next.js 作为唯一运行时与构建入口，使用 `app/[lang]` 承接多语言页面，使用 `middleware.ts` 处理根路径语言重定向，保留工作台为客户端组件并复用现有 TypeScript 业务逻辑与大部分 React 组件。

**Tech Stack:** Next.js App Router、React 19、TypeScript、Tailwind CSS 4、Plotly.js、Papa Parse、xlsx、Node test runner

---

### Task 1: 建立 Next.js 运行骨架

**Files:**
- Modify: `package.json`
- Create: `next.config.ts`
- Create: `app/layout.tsx`
- Create: `app/globals.css`
- Modify: `tsconfig.json`
- Test: `package.json`

- [ ] **Step 1: 先更新依赖和脚本定义**

把 `package.json` 中的构建/开发脚本从 Vite 切到 Next.js，并补上必要依赖：

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "node --experimental-strip-types --test tests/*.test.ts"
  },
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.2.5",
    "react-dom": "^19.2.5"
  }
}
```

- [ ] **Step 2: 运行安装，确认 lockfile 更新**

Run: `pnpm install`
Expected: `pnpm-lock.yaml` 更新，安装成功，无 `vite` / `@vitejs/plugin-react` 作为运行必需项。

- [ ] **Step 3: 创建 Next.js 根布局**

在 `app/layout.tsx` 中建立最小根布局，后续由语言布局覆写 `lang` 与 metadata：

```tsx
import './globals.css'
import type { ReactNode } from 'react'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 4: 迁移全局样式入口**

先把当前 `src/index.css` 内容整体迁移到 `app/globals.css`，仅调整导入路径，不做样式重写。

- [ ] **Step 5: 添加 Next.js 配置**

创建 `next.config.ts`，只放当前迁移必需配置，例如静态资源、实验项保持最少：

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {}

export default nextConfig
```

- [ ] **Step 6: 更新 TypeScript 配置以支持 Next.js**

保证 `tsconfig.json` 包含 Next.js 需要的配置与插件，并保留现有路径解析能力。

- [ ] **Step 7: 运行开发服务器检查骨架可启动**

Run: `pnpm dev`
Expected: Next.js 成功启动，不再报 Vite 入口缺失错误。

### Task 2: 迁移国际化配置到 Next.js 路由模型

**Files:**
- Create: `lib/i18n/config.ts`
- Create: `lib/i18n/dictionaries/en.ts`
- Create: `lib/i18n/dictionaries/zh-CN.ts`
- Create: `lib/i18n/dictionaries/ja-JP.ts`
- Create: `lib/i18n/index.tsx`
- Create: `lib/i18n/server.ts`
- Create: `lib/i18n/types.ts`
- Modify: `tests/i18n.test.ts`
- Test: `tests/i18n.test.ts`

- [ ] **Step 1: 平移现有字典与语言配置**

将 `src/i18n/*` 迁移到 `lib/i18n/*`，保持现有 key、文案和值不变。

- [ ] **Step 2: 重写语言路径解析，使其兼容 `[lang]`**

在 `lib/i18n/config.ts` 中保留内部语言标识与公开 URL 的映射：

```ts
export const ROUTE_LANGUAGES = ['en', 'zh', 'ja'] as const
export type RouteLanguage = (typeof ROUTE_LANGUAGES)[number]

export const ROUTE_TO_DICTIONARY_LANGUAGE = {
  en: 'en',
  zh: 'zh-CN',
  ja: 'ja-JP',
} as const
```

- [ ] **Step 3: 提供服务端可用的语言辅助函数**

在 `lib/i18n/server.ts` 中实现：
- `isRouteLanguage`
- `getDictionaryLanguage`
- `getHtmlLang`
- `getLanguageMetadata`

- [ ] **Step 4: 调整测试覆盖新的路由语言模型**

为 `/en`、`/zh`、`/ja` 与内部字典语言的映射补测试，保留现有浏览器语言归一化测试。

- [ ] **Step 5: 运行 i18n 测试**

Run: `node --experimental-strip-types --test tests/i18n.test.ts`
Expected: 所有语言映射与回退逻辑测试通过。

### Task 3: 搭建根路径重定向和语言布局

**Files:**
- Create: `middleware.ts`
- Create: `app/[lang]/layout.tsx`
- Create: `app/[lang]/page.tsx`
- Create: `app/page.tsx`
- Create: `tests/routing.test.ts`
- Test: `tests/routing.test.ts`

- [ ] **Step 1: 编写语言协商函数测试**

先写一个纯函数测试，验证请求头到目标路径的映射：

```ts
test('resolveLocaleRedirect falls back to /en', () => {
  assert.equal(resolveLocaleRedirect(undefined), '/en')
})
```

- [ ] **Step 2: 跑测试确认先失败**

Run: `node --experimental-strip-types --test tests/routing.test.ts`
Expected: 因函数未定义或模块不存在而失败。

- [ ] **Step 3: 实现重定向纯函数与 middleware**

在 `middleware.ts` 中抽出纯函数并接入 Next.js：

```ts
export function resolveLocaleRedirect(acceptLanguage?: string | null) {
  const normalized = (acceptLanguage ?? '').toLowerCase()
  if (normalized.includes('zh')) return '/zh'
  if (normalized.includes('ja')) return '/ja'
  return '/en'
}
```

- [ ] **Step 4: 实现 `[lang]` 布局并校验非法语言**

`app/[lang]/layout.tsx` 负责：
- 设置 `html lang`
- 读取语言字典
- 包裹客户端 i18n provider
- 对非法 `lang` 调用 `notFound()`

- [ ] **Step 5: 让 `app/page.tsx` 仅作为兜底壳**

根页面可以返回 `null` 或极简内容，实际访问会由 middleware 重定向。

- [ ] **Step 6: 再次运行路由测试**

Run: `node --experimental-strip-types --test tests/routing.test.ts`
Expected: 语言协商测试通过。

### Task 4: 迁移工作台客户端入口

**Files:**
- Create: `components/app/WorkbenchApp.tsx`
- Create: `components/app/PlotCanvasClient.tsx`
- Modify: `components/AppNavbar.tsx`
- Modify: `components/HomeHero.tsx`
- Modify: `src/App.tsx` or replace by new file under `components/app`
- Test: `tests/workbench.test.ts`

- [ ] **Step 1: 把当前 `src/App.tsx` 平移到新的客户端入口**

新文件 `components/app/WorkbenchApp.tsx` 顶部加 `'use client'`，然后把现有 `App.tsx` 主要逻辑迁进去，先不改用户可见结构。

- [ ] **Step 2: 将浏览器专属依赖显式隔离**

对直接依赖 Plotly、剪贴板、拖拽和 `window` 的组件，必要时拆成客户端包装文件，如 `PlotCanvasClient.tsx`。

- [ ] **Step 3: 让语言切换继续走路径跳转**

保留当前导航的用户体验，但将跳转路径和字典来源切到新的 `lib/i18n`。

- [ ] **Step 4: 运行核心工作台逻辑测试**

Run: `node --experimental-strip-types --test tests/workbench.test.ts`
Expected: 纯逻辑测试仍然通过，说明迁移没有破坏底层工具。

### Task 5: 迁移数据、上传、持久化与样例逻辑

**Files:**
- Create: `lib/workbench/*`
- Create: `hooks/useCsvData.ts`
- Modify: `tests/datasetPersistence.test.ts`
- Modify: `tests/upload.test.ts`
- Modify: `tests/sampleData.test.ts`
- Test: `tests/datasetPersistence.test.ts`
- Test: `tests/upload.test.ts`
- Test: `tests/sampleData.test.ts`

- [ ] **Step 1: 平移 `src/lib/*` 到新的逻辑目录**

按职责迁移：
- `datasetPersistence.ts`
- `spreadsheetImport.ts`
- `sampleData.ts`
- `upload.ts`
- `workbench.ts`
- 其余图表与聚合工具

- [ ] **Step 2: 保持本地存储 key 不变**

`plotnow-language`、`csv-workbench-datasets`、`csv-workbench-dashboard` 不允许改名。

- [ ] **Step 3: 运行持久化与上传相关测试**

Run: `node --experimental-strip-types --test tests/datasetPersistence.test.ts tests/upload.test.ts tests/sampleData.test.ts`
Expected: 现有持久化、文件识别和样例数据测试全部通过。

### Task 6: 迁移页面级 SEO 产物

**Files:**
- Create: `app/robots.ts`
- Create: `app/sitemap.ts`
- Create: `lib/seo/metadata.ts`
- Modify: `app/[lang]/layout.tsx`
- Modify: `tests/seoShell.test.ts`
- Test: `tests/seoShell.test.ts`

- [ ] **Step 1: 删除对 SEO shell 的依赖预期**

先把测试从“检查静态 HTML SEO shell”改为“检查 Next.js SEO 产物函数”：
- 根页不再 `noindex`
- 语言页 metadata 可索引
- sitemap 包含 `/`、`/en`、`/zh`、`/ja`

- [ ] **Step 2: 运行测试确认先失败**

Run: `node --experimental-strip-types --test tests/seoShell.test.ts`
Expected: 因新 metadata / sitemap 函数不存在而失败。

- [ ] **Step 3: 实现 metadata 工具与语言页 metadata**

在 `lib/seo/metadata.ts` 中生成每个语言页的：
- title
- description
- canonical
- alternates
- openGraph
- twitter

- [ ] **Step 4: 实现 `app/robots.ts` 与 `app/sitemap.ts`**

确保：
- `robots` 允许抓取
- `sitemap` 返回四个入口
- `zh-CN` 和 `x-default` alternate 正确

- [ ] **Step 5: 再次运行 SEO 测试**

Run: `node --experimental-strip-types --test tests/seoShell.test.ts`
Expected: 新 SEO 产物测试通过，且不再依赖静态 HTML 注入。

### Task 7: 删除旧 Vite 入口和多语言静态壳

**Files:**
- Delete: `src/main.tsx`
- Delete: `index.html`
- Delete: `en/index.html`
- Delete: `zh/index.html`
- Delete: `ja/index.html`
- Delete: `scripts/sync-seo-shell.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Test: `git diff`

- [ ] **Step 1: 删除不再需要的 Vite 与 SEO shell 入口文件**

删除：
- `src/main.tsx`
- `index.html`
- `en/index.html`
- `zh/index.html`
- `ja/index.html`
- `scripts/sync-seo-shell.mjs`

- [ ] **Step 2: 删除废弃脚本与说明**

从 `package.json` 中移除：
- `preview`
- `seo:sync`

从 `README.md` 中改成 Next.js 的启动与构建说明。

- [ ] **Step 3: 检查 diff，确认没有遗留对旧入口的引用**

Run: `git diff --stat`
Expected: 旧静态壳文件已删除，README 和脚本已切换到 Next.js。

### Task 8: 迁移部署配置到 Next.js / Vercel 模式

**Files:**
- Modify: `vercel.json`
- Delete or Modify: `netlify.toml`
- Modify: `public/robots.txt` if still present
- Test: `vercel.json`

- [ ] **Step 1: 精简 `vercel.json`**

保留仅对 Next.js 仍有必要的配置；根路径语言跳转由 middleware 接管，不再依赖 Vercel redirect 规则做主要逻辑。

- [ ] **Step 2: 清理不再适用的 Netlify 配置**

如果项目部署目标已经明确为 Vercel，可删除 `netlify.toml`；若仍要兼容，则至少标注为历史兼容配置而不参与主流程。

- [ ] **Step 3: 人工检查部署入口**

确认仓库不再依赖 Vite `dist/` 目录作为发布物。

### Task 9: 全量验证

**Files:**
- Modify: as needed based on failures
- Test: `tests/*.test.ts`

- [ ] **Step 1: 跑全量测试**

Run: `pnpm test`
Expected: 全部测试通过。

- [ ] **Step 2: 跑生产构建**

Run: `pnpm build`
Expected: Next.js 成功产出生产构建，无阻塞错误。

- [ ] **Step 3: 启动本地服务抽查关键路径**

Run: `pnpm dev`
Expected:
- `/` 自动跳到对应语言页
- `/en`、`/zh`、`/ja` 可访问
- 上传 CSV / Excel、切语言、恢复本地工作区都可用

- [ ] **Step 4: 提交迁移结果**

```bash
git add .
git commit -m "统一 joplot 到 Next.js App Router 以稳定多语言 SEO 和部署行为

将现有 Vite 单页应用迁移到 Next.js App Router，保留公开 URL、
UI 文案和本地优先工作台交互，同时把多语言路由、metadata、
robots、sitemap 与根路径重定向收回到官方能力中。

Constraint: 公开 URL、用户可见交互与 localStorage key 必须兼容
Rejected: 继续维护 Vite SEO shell | 线上 SEO 产物与源码易失配
Confidence: medium
Scope-risk: broad
Directive: 后续新增公开页面必须走 app/[lang] 与统一 metadata 工具
Tested: pnpm test; pnpm build; 本地关键路径手测
Not-tested: Vercel 线上缓存刷新后的最终抓取表现"
```
