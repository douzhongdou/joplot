import test from 'node:test'
import assert from 'node:assert/strict'
import robots from '../app/robots.ts'
import sitemap from '../app/sitemap.ts'
import { getLanguageMetadata } from '../src/lib/siteMetadata.ts'

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

  assert.equal(metadata.title, 'joplot | CSV charting and data analysis workspace')
  assert.equal(metadata.description, 'Import multiple CSV files, build charts quickly, filter data, and compare datasets in one workspace.')
  assert.equal(metadata.alternates?.canonical, 'https://joplot.com/en')
})

test('robots route allows crawling and points to the generated sitemap', () => {
  const result = robots()

  assert.deepEqual(result.rules, {
    userAgent: '*',
    allow: '/',
  })
  assert.equal(result.sitemap, 'https://joplot.com/sitemap.xml')
})

test('sitemap route includes root and all language pages', () => {
  const result = sitemap()

  assert.equal(result.length, 4)
  assert.deepEqual(
    result.map((entry) => entry.url),
    [
      'https://joplot.com/',
      'https://joplot.com/en',
      'https://joplot.com/zh',
      'https://joplot.com/ja',
    ],
  )
})

test('language sitemap entries publish hreflang alternates', () => {
  const entries = sitemap().filter((entry) => entry.url !== 'https://joplot.com/')

  for (const entry of entries) {
    assert.equal(entry.alternates?.languages?.en, 'https://joplot.com/en')
    assert.equal(entry.alternates?.languages?.['zh-CN'], 'https://joplot.com/zh')
    assert.equal(entry.alternates?.languages?.ja, 'https://joplot.com/ja')
    assert.equal(entry.alternates?.languages?.['x-default'], 'https://joplot.com/')
  }
})
