import test from 'node:test'
import assert from 'node:assert/strict'
import robots from '../app/robots.ts'
import sitemap from '../app/sitemap.ts'
import { getFunctionStudioMetadata, getLanguageMetadata, getSoftwareApplicationJsonLd } from '../src/lib/siteMetadata.ts'

test('language metadata stays indexable and shares one canonical URL', () => {
  for (const language of ['en', 'zh-CN', 'ja-JP'] as const) {
    const metadata = getLanguageMetadata(language)
    const robots = typeof metadata.robots === 'string' ? undefined : metadata.robots

    assert.equal(robots?.index, true)
    assert.equal(robots?.follow, true)
    assert.equal(metadata.alternates?.canonical, 'https://joplot.com/')
    assert.equal(metadata.alternates?.languages, undefined)
  }
})

test('english metadata keeps the expected canonical title and description', () => {
  const metadata = getLanguageMetadata('en')

  assert.equal(metadata.title, 'joplot | Free online CSV plot tool')
  assert.equal(metadata.description, 'Plot CSV files online with joplot. Import CSV or Excel files, build charts quickly, filter data, and compare datasets in one workspace.')
  assert.equal(metadata.alternates?.canonical, 'https://joplot.com/')
  assert.deepEqual(metadata.keywords, [
    'joplot',
    'CSV plot tool',
    'plot CSV online',
    'CSV chart generator',
    'CSV to chart',
  ])
})

test('robots route allows crawling and points to the generated sitemap', () => {
  const result = robots()

  assert.deepEqual(result.rules, {
    userAgent: '*',
    allow: '/',
  })
  assert.equal(result.sitemap, 'https://joplot.com/sitemap.xml')
})

test('sitemap lists the canonical indexable pages without language variants', () => {
  const result = sitemap()

  assert.deepEqual(
    result.map((entry) => entry.url),
    ['https://joplot.com/', 'https://joplot.com/function'],
  )

  for (const entry of result) {
    assert.equal(entry.alternates, undefined)
  }
})

test('function studio metadata publishes its own canonical', () => {
  for (const language of ['en', 'zh-CN', 'ja-JP'] as const) {
    const metadata = getFunctionStudioMetadata(language)
    const robots = typeof metadata.robots === 'string' ? undefined : metadata.robots

    assert.equal(robots?.index, true)
    assert.equal(metadata.alternates?.canonical, 'https://joplot.com/function')
    assert.notEqual(metadata.title, getLanguageMetadata(language).title)
  }
})

test('software application json-ld identifies joplot as a csv plot tool', () => {
  const jsonLd = getSoftwareApplicationJsonLd()

  assert.equal(jsonLd['@type'], 'WebApplication')
  assert.equal(jsonLd.name, 'joplot')
  assert.equal(jsonLd.url, 'https://joplot.com/')
  assert.match(jsonLd.description, /CSV plot tool/i)
  assert.deepEqual(jsonLd.applicationCategory, ['DataVisualizationApplication', 'BusinessApplication'])
})
