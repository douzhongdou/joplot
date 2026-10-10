# Legacy joplot

本应用从 `origin/main` 的 `d1548e8d411cb57baf93e32c554e948dde0ac4e7` 原样迁入。
应用之间禁止互相 import。本应用保持原来的组件、主题、语言实现、URL 和存储协议，不引入 `@joplot/ui` 或 `@joplot/i18n`，避免新应用的共享包变更影响线上版本。

修改 Next.js 相关代码前，读取本应用 `node_modules/next/dist/docs/` 中的相关指南。
共享 UI 约定仅用于新应用；维护本应用时使用原有组件和样式。
