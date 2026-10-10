# 新 joplot（开发预览）

根路径 `/` 是科学数据工作台，支持 CSV / TSV / Excel 导入、平滑、去趋势、微积分、FFT、拟合与统计。`/science` 跳转到首页，`/super-plot` 和 `/spike/runtime` 保留为实验页面。

老 CSV 工作台和函数画板由 `apps/legacy-plot` 独立发布。本应用不能绑定老站线上域名；metadata、robots 和 sitemap 已按未发布的预览应用配置。

从仓库根运行 `pnpm dev:plot`（3000）或 `pnpm build:plot`。

共享 UI 与语言来自 `@joplot/ui`、`@joplot/i18n`。Vercel Project 的 Root Directory 为 `apps/plot`，启用访问目录外源文件，保持预览部署。上线前再单独配置域名、SEO 和生产发布策略。

环境变量：

- `NEXT_PUBLIC_SITE_URL`：本应用自己的预览地址；不配置时省略 canonical。
- `NEXT_PUBLIC_IMAGE_APP_URL`：joimage 地址；不配置时跨应用入口隐藏。
- Umami 使用本应用自己的 Website ID。
