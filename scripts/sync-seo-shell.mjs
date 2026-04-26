import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { SUPPORTED_LANGUAGES, LANGUAGE_PATHS } from '../src/i18n/config.ts'
import { renderSeoShell } from '../src/lib/seoShell.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const blockStart = '<!-- SEO_SHELL:START -->'
const blockEnd = '<!-- SEO_SHELL:END -->'

function resolveHtmlPath(language) {
  const pathname = LANGUAGE_PATHS[language]
  return path.join(projectRoot, pathname.slice(1), 'index.html')
}

async function syncFile(language) {
  const filePath = resolveHtmlPath(language)
  const source = await readFile(filePath, 'utf8')
  const shellMarkup = `${blockStart}\n${renderSeoShell(language)}\n    ${blockEnd}`

  let next = source.replace(
    new RegExp(`${blockStart}[\\s\\S]*?${blockEnd}`, 'm'),
    shellMarkup,
  )

  if (next === source) {
    next = source.replace(
      '    <div id="root"></div>',
      `    ${shellMarkup}\n    <div id="root"></div>`,
    )
  }

  if (next === source) {
    throw new Error(`Could not inject SEO shell into ${filePath}`)
  }

  await writeFile(filePath, next, 'utf8')
}

for (const language of SUPPORTED_LANGUAGES) {
  await syncFile(language)
}
