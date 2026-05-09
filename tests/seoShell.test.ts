import test from 'node:test'
import assert from 'node:assert/strict'
import robots from '../app/robots.ts'
import sitemap from '../app/sitemap.ts'
import { getLanguageMetadata, getSoftwareApplicationJsonLd } from '../src/lib/siteMetadata.ts'

test('language metadata stays indexable for every public locale', () => {
  for (const language of ['en', 'zh-CN', 'ja-JP'] as const) {
    const metadata = getLanguageMetadata(language)

    assert.equal(metadata.robots?.index, true)
    assert.equal(metadata.robots?.follow, true)
    assert.equal(metadata.alternates?.languages?.en, 'https://joplot.com/en')
    assert.equal(metadata.alternates?.languages?.['zh-CN'], 'https://joplot.com/zh')
    assert.equal(metadata.alternates?.languages?.ja, 'https://joplot.com/ja')
  }
})

test('english metadata keeps the expected canonical title and description', () => {
  const metadata = getLanguageMetadata('en')

  assert.equal(metadata.title, 'joplot | Free online CSV plot tool')
  assert.equal(metadata.description, 'Plot CSV files online with joplot. Import CSV or Excel files, build charts quickly, filter data, and compare datasets in one workspace.')
  assert.equal(metadata.alternates?.canonical, 'https://joplot.com/en')
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

test('sitemap route includes only canonical indexable language pages', () => {
  const result = sitemap()

  assert.equal(result.length, 3)
  assert.deepEqual(
    result.map((entry) => entry.url),
    [
      'https://joplot.com/en',
      'https://joplot.com/zh',
      'https://joplot.com/ja',
    ],
  )
})

test('language sitemap entries publish hreflang alternates', () => {
  const entries = sitemap()

  for (const entry of entries) {
    assert.equal(entry.alternates?.languages?.en, 'https://joplot.com/en')
    assert.equal(entry.alternates?.languages?.['zh-CN'], 'https://joplot.com/zh')
    assert.equal(entry.alternates?.languages?.ja, 'https://joplot.com/ja')
    assert.equal(entry.alternates?.languages?.['x-default'], 'https://joplot.com/en')
  }
})

test('software application json-ld identifies joplot as a csv plot tool', () => {
  const jsonLd = getSoftwareApplicationJsonLd()

  assert.equal(jsonLd['@type'], 'WebApplication')
  assert.equal(jsonLd.name, 'joplot')
  assert.equal(jsonLd.url, 'https://joplot.com/en')
  assert.match(jsonLd.description, /CSV plot tool/i)
  assert.deepEqual(jsonLd.applicationCategory, ['DataVisualizationApplication', 'BusinessApplication'])
})
