<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# UI conventions

This project uses shadcn/ui (new-york style, neutral base color). Reusable primitives live in `src/components/ui/` (button, select, switch, popover, dropdown-menu, sheet, label) — prefer them over hand-rolled controls. `cn()` is in `src/lib/utils.ts`; `@/*` maps to `./src/*`. Design tokens are in `src/index.css`: shadcn standard tokens plus legacy daisy-style aliases (`bg-base-100`, `text-base-content`, `--radius-field/box`, etc.) kept for existing markup.
