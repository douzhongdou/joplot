# 老 joplot（线上稳定版）

从 `origin/main` 的 `d1548e8d411cb57baf93e32c554e948dde0ac4e7` 原样迁入。

- 首页：`/` 根据浏览器语言跳转到 `/zh`、`/en`、`/ja`。
- 函数画板：`/function` 及原来的多语言路径。
- UI、主题、图表、CSV/Excel 导入、localStorage 协议均保持原样。
- 不依赖 `packages/ui` 或 `packages/i18n`。

从仓库根运行 `pnpm dev:legacy`（端口 3002）或 `pnpm build:legacy`。也可在本目录运行 `pnpm dev`、`pnpm build`、`pnpm test`、`pnpm typecheck`。

Vercel Project 的 Root Directory 设置为 `apps/legacy-plot`，保留线上域名与原有 Umami 环境变量。迁移上线顺序见仓库根 README；切换目录前先在独立预览 Project 上验证。

迁入来源与保留范围见 `migration-source.json`。后续仅处理稳定版问题，新功能在新 joplot 或 joimage 中开发。
