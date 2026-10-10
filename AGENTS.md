<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Repository layout

pnpm workspace monorepo. Apps never import from each other; shared code lives in `packages/*`.

- `apps/legacy-plot` — stable joplot from origin/main; preserve its routes, theme and storage
- `apps/plot` — new scientific plotting workbench, preview only (Next.js)
- `apps/image` — ImageJ-style 8-bit image workbench (Next.js)
- `packages/ui` — shared shadcn/ui primitives (`@joplot/ui`) and the design-token stylesheet
- `packages/i18n` — shared language + localized-route helpers (`@joplot/i18n`)

Common commands (from the repo root): `pnpm install`, `pnpm -r typecheck`, `pnpm -r test`,
`pnpm dev:legacy`, `pnpm dev:plot`, `pnpm dev:image`.

Each app is deployed as a separate Vercel Project with its own root directory and domain.
Do not migrate legacy-plot to shared UI/i18n packages as part of changes to new apps.
Use `pnpm build:legacy`, `pnpm build:plot`, or `pnpm build:image` for an individual release.

# UI conventions

The new plot and image apps use shadcn/ui (new-york style, neutral base color). Reusable primitives live in
`packages/ui/src` and are imported as `@joplot/ui/<name>` (accordion, button, card, checkbox,
context-menu, dialog, dropdown-menu, input, label, popover, select, separator, sheet, slider,
switch, table, tabs, toggle-group, tooltip) — prefer them over hand-rolled controls.
`cn()` is exported from `@joplot/ui/utils`. Design tokens are in `packages/ui/src/theme.css`:
shadcn standard tokens plus legacy daisy-style aliases (`bg-base-100`, `text-base-content`,
`--radius-field/box`, etc.). Each app imports the theme from its `globals.css` and adds
`@source "../../../packages/ui/src"` so Tailwind scans the package for class names.
Language plumbing lives in `@joplot/i18n`; each app supplies its own dictionaries and route
segments.

思考过程一律使用中文：推理、分析、权衡、排查步骤都用中文展开，不要在思考中切换成英文。
