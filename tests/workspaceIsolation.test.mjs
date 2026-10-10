import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const apps = ['legacy-plot', 'plot', 'image']
const read = (relative) => readFile(path.join(root, relative), 'utf8')

async function* sourceFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(location)
    else if (/\.(tsx?|jsx?|css)$/.test(entry.name)) yield location
  }
}

test('apps do not import or depend on another app; legacy does not use shared UI or language', async () => {
  for (const app of apps) {
    const directory = path.join(root, 'apps', app)
    const manifest = JSON.parse(await read(`apps/${app}/package.json`))
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies }
    for (const other of apps.filter((value) => value !== app)) {
      assert.equal(dependencies[`@joplot/${other}`], undefined, `${app} depends on ${other}`)
    }
    if (app === 'legacy-plot') {
      assert.equal(dependencies['@joplot/ui'], undefined)
      assert.equal(dependencies['@joplot/i18n'], undefined)
    }
    for (const source of ['src', 'app']) {
      for await (const filename of sourceFiles(path.join(directory, source))) {
        const content = await readFile(filename, 'utf8')
        for (const match of content.matchAll(/(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)) {
          const specifier = match[1]
          if (app === 'legacy-plot') assert.ok(!specifier.startsWith('@joplot/'), `${filename}: ${specifier}`)
          if (!specifier.startsWith('.')) continue
          const target = path.resolve(path.dirname(filename), specifier)
          for (const other of apps.filter((value) => value !== app)) {
            const otherRoot = path.join(root, 'apps', other)
            assert.ok(target !== otherRoot && !target.startsWith(otherRoot + path.sep), `${filename}: ${specifier}`)
          }
        }
      }
    }
  }
})

test('old and new workbenches have separate route entry points', async () => {
  assert.match(await read('apps/legacy-plot/app/[lang]/page.tsx'), /<App\s*\/>/)
  await access(path.join(root, 'apps/legacy-plot/app/[lang]/function/page.tsx'))
  assert.match(await read('apps/plot/app/[lang]/page.tsx'), /<ScienceApp\b/)
  await assert.rejects(access(path.join(root, 'apps/plot/app/[lang]/function/page.tsx')))
  assert.match(await read('apps/image/app/[lang]/page.tsx'), /<ScientificImageWorkspace\b/)
})

test('each deployment builds its own app instead of the whole workspace', async () => {
  for (const app of apps) {
    const config = JSON.parse(await read(`apps/${app}/vercel.json`))
    assert.equal(config.buildCommand, 'pnpm build')
    const manifest = JSON.parse(await read(`apps/${app}/package.json`))
    assert.equal(manifest.scripts.build, 'next build')
  }
})
